//! Running the git CLI. Recastle uses it for everything that changes a repository, so
//! hooks, signing, credential helpers and the user's git config all apply.

use git2::Repository;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// Runs git to completion. On failure, returns what git printed so the user can see
/// why (a failing hook, a missing identity, …).
pub(crate) fn git(path: &str, args: &[&str], stdin: Option<&str>) -> Result<String, String> {
    git_input(path, args, stdin.map(str::as_bytes))
}

/// `git`, with input that needn't be UTF-8, such as a patch of a file in another
/// encoding.
pub(crate) fn git_input(path: &str, args: &[&str], stdin: Option<&[u8]>) -> Result<String, String> {
    let mut child = command(&workdir(path)?, args)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run git: {e}"))?;

    if let Some(input) = stdin {
        child
            .stdin
            .take()
            .expect("stdin is piped")
            .write_all(input)
            .map_err(|e| format!("Couldn't send input to git: {e}"))?;
    }

    let output = child.wait_with_output().map_err(|e| format!("git failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() { Ok(stdout) } else { Err(join_output(&stderr, &stdout)) }
}

/// Runs git in a folder that needn't be in a repository yet.
pub(crate) fn git_in(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = command(&dir.to_path_buf(), args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Couldn't run git: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() { Ok(stdout) } else { Err(join_output(&stderr, &stdout)) }
}

/// The oldest git Recastle works with: `git fetch --no-write-fetch-head` needs 2.29, for
/// fetching a pull request's commits alongside a pull (see pulls.rs), which reads
/// FETCH_HEAD; and `git pull --autostash` needs 2.27 when merging.
const MINIMUM_GIT: (u32, u32) = (2, 29);

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct GitCheck {
    /// The installed version, e.g. "2.34.1", or None when git isn't installed.
    version: Option<String>,
    minimum: String,
    supported: bool,
}

/// Whether a git Recastle can use is installed. Checked at startup.
#[tauri::command]
pub async fn git_check() -> GitCheck {
    let output = Command::new("git").arg("--version").stdin(Stdio::null()).output();
    let text = output.ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
    check_version(text.as_deref())
}

/// Opens Apple's installer for the Command Line Tools, which include git. It runs on
/// its own; Recastle checks for git again when the user says it's done.
#[tauri::command]
pub async fn install_git_tools() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("xcode-select")
            .arg("--install")
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Couldn't start the installer: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
    #[cfg(not(target_os = "macos"))]
    Err("The Command Line Tools are only for macOS.".into())
}

fn check_version(output: Option<&str>) -> GitCheck {
    // "git version 2.34.1", sometimes with more after it, e.g. " (Apple Git-145)".
    let version = output.and_then(|o| o.trim().strip_prefix("git version ")).and_then(|v| v.split_whitespace().next());
    let parts: Vec<u32> = version.map(|v| v.split('.').map_while(|p| p.parse().ok()).collect()).unwrap_or_default();
    let supported = match parts.as_slice() {
        [major, minor, ..] => (*major, *minor) >= MINIMUM_GIT,
        _ => false,
    };
    GitCheck {
        version: version.map(str::to_string),
        minimum: format!("{}.{}", MINIMUM_GIT.0, MINIMUM_GIT.1),
        supported,
    }
}

/// The git process currently doing network work, so it can be canceled.
#[derive(Default)]
pub struct Running(Mutex<Slot>);

#[derive(Default)]
struct Slot {
    /// The process running, if any.
    pid: Option<u32>,
    /// Closed for good (see Running::close): nothing more is to run on it.
    closed: bool,
}

/// The network work of each repository a window has open (see per_repo.rs): one fetch,
/// pull or push at a time in each, while other repositories go on with theirs.
#[derive(Default)]
pub struct Runnings(crate::per_repo::PerRepo<std::sync::Arc<Running>>);

impl Runnings {
    pub(crate) fn of(&self, window: &str, path: &str) -> std::sync::Arc<Running> {
        self.0.of(window, path)
    }

    /// Lets go of a repository the window's done with, so a long-open window doesn't keep
    /// one for every repository it's had. Not while work's still running there, which
    /// holds it: a push isn't cut off as its tab shows another repository, and Cancel,
    /// still shown for it, can still stop it, as can an operation stopping a background
    /// fetch.
    pub fn release(&self, window: &str, path: &str) {
        let _ = self.0.release_unless(window, path, |running| std::sync::Arc::strong_count(running) > 1);
    }

    /// Stops the network work of a window that's closed.
    pub fn forget(&self, window: &str) {
        for running in self.0.forget(window) {
            running.cancel();
        }
    }
}

impl Running {
    /// Stops the running process and anything it started (ssh, credential helpers).
    /// What runs on it after still runs.
    pub(crate) fn cancel(&self) {
        Self::stop(&self.0.lock().unwrap());
    }

    /// Stops what's running, as `cancel` does, and what was to run on it but hasn't
    /// started yet, which fails with CANCELED instead: for work that's been asked for
    /// and may not have got as far as starting git, as while it asks GitHub something
    /// first. Not for one that's used again, as each repository's fetches are.
    pub(crate) fn close(&self) {
        let mut slot = self.0.lock().unwrap();
        slot.closed = true;
        Self::stop(&slot);
    }

    /// Whether a process is running on it.
    #[cfg(test)]
    pub(crate) fn is_running(&self) -> bool {
        self.0.lock().unwrap().pid.is_some()
    }

    fn stop(slot: &Slot) {
        if let Some(pid) = slot.pid {
            #[cfg(unix)]
            // Each git runs in its own session, so its process group holds exactly
            // git and its helpers.
            unsafe {
                libc::killpg(pid as libc::pid_t, libc::SIGTERM);
            }
            #[cfg(not(unix))]
            let _ = pid;
        }
    }
}

/// Runs a long git command (fetch, pull, push), passing each progress update git
/// prints to `on_progress` as it arrives. Only one runs at a time.
pub(crate) fn git_with_progress(
    path: &str,
    args: &[&str],
    running: &Running,
    on_progress: impl FnMut(&str),
) -> Result<String, String> {
    git_with_progress_in(&workdir(path)?, args, running, on_progress)
}

/// `git_with_progress` in any folder, for commands like clone that don't run inside
/// a repository.
pub(crate) fn git_with_progress_in(
    dir: &PathBuf,
    args: &[&str],
    running: &Running,
    on_progress: impl FnMut(&str),
) -> Result<String, String> {
    run_with_progress(command(dir, args), running, on_progress)
}

/// Runs git with nobody watching, as background fetches do: anything that would ask
/// for a password or passphrase fails instead of opening a prompt.
pub(crate) fn git_unattended(path: &str, args: &[&str], running: &Running) -> Result<String, String> {
    run_with_progress(unattended(path, args)?, running, |_| {})
}

/// What git_unattended_within fails with when it's stopped for going quiet.
pub(crate) const STALLED: &str = "Stalled.";

/// `git_unattended`, on `running` of its own rather than as one of the repository's
/// fetches, pulls and pushes, and stopped once it's gone `quiet` without a word of
/// progress, as over a stalled connection, failing with STALLED: one that's slow but
/// getting somewhere goes on. For network work nobody watches, so pass `--progress`.
/// Canceled with `running`, it fails with CANCELED.
pub(crate) fn git_unattended_within(
    path: &str,
    args: &[&str],
    quiet: std::time::Duration,
    running: &std::sync::Arc<Running>,
) -> Result<String, String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{RecvTimeoutError, channel};
    let command = unattended(path, args)?;
    let stalled = std::sync::Arc::new(AtomicBool::new(false));
    let (progress, heard) = channel::<()>();
    let (timer, timed_out) = (std::sync::Arc::clone(running), std::sync::Arc::clone(&stalled));
    std::thread::spawn(move || {
        loop {
            match heard.recv_timeout(quiet) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => {
                    timed_out.store(true, Ordering::SeqCst);
                    break timer.cancel();
                }
                // Git's done.
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    let result = run_with_progress(command, running, move |_| {
        let _ = progress.send(());
    });
    match result {
        Err(e) if e == crate::errors::CANCELED && stalled.load(Ordering::SeqCst) => Err(STALLED.to_string()),
        result => result,
    }
}

/// git, to run with nobody watching (see git_unattended).
fn unattended(path: &str, args: &[&str]) -> Result<Command, String> {
    let mut command = command(&workdir(path)?, args);
    command
        // ssh's graphical passphrase prompt.
        .env("SSH_ASKPASS_REQUIRE", "never")
        // Git Credential Manager's sign-in window.
        .env("GCM_INTERACTIVE", "never");
    Ok(command)
}

fn run_with_progress(mut command: Command, running: &Running, mut on_progress: impl FnMut(&str)) -> Result<String, String> {
    let mut child: Child = {
        let mut slot = running.0.lock().unwrap();
        if slot.closed {
            return Err(crate::errors::CANCELED.into());
        }
        if slot.pid.is_some() {
            return Err("Another fetch, pull or push is still running.".into());
        }
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Couldn't run git: {e}"))?;
        slot.pid = Some(child.id());
        child
    };

    let mut stdout = child.stdout.take().expect("stdout is piped");
    let stdout_reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });

    // Git redraws progress in place with \r and ends finished lines with \n. Every
    // fragment is reported as progress; only finished lines are kept for messages.
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let mut transcript = String::new();
    let mut pending = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = match stderr.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        for &byte in &buf[..n] {
            if byte == b'\r' || byte == b'\n' {
                let line = String::from_utf8_lossy(&pending).trim().to_string();
                if !line.is_empty() {
                    on_progress(&line);
                    if byte == b'\n' {
                        transcript.push_str(&line);
                        transcript.push('\n');
                    }
                }
                pending.clear();
            } else {
                pending.push(byte);
            }
        }
    }
    let leftover = String::from_utf8_lossy(&pending).trim().to_string();
    transcript.push_str(&leftover);

    let status = child.wait();
    running.0.lock().unwrap().pid = None;
    let stdout = stdout_reader.join().unwrap_or_default().trim().to_string();
    let transcript = transcript.trim().to_string();

    match status {
        Ok(s) if s.success() => Ok(join_output(&transcript, &stdout)),
        #[cfg(unix)]
        Ok(s) if std::os::unix::process::ExitStatusExt::signal(&s) == Some(libc::SIGTERM) => {
            Err(crate::errors::CANCELED.into())
        }
        Ok(_) => Err(join_output(&transcript, &stdout)),
        Err(e) => Err(format!("git failed: {e}")),
    }
}

pub(crate) fn command(workdir: &PathBuf, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        // When signed in to GitHub in Recastle, git asks Recastle for github.com logins.
        .args(crate::github::git_config_args())
        .args(args)
        .current_dir(workdir)
        // Fail instead of prompting for a password nobody can see. Credential helpers
        // and SSH agents still work.
        .env("GIT_TERMINAL_PROMPT", "0");
    // File names are only ever names, never patterns: discarding "[id].tsx" mustn't
    // also discard "i.tsx". Except for stash, whose --include-untracked leaves
    // untracked files behind with this set; it marks each name literal instead. And
    // find_definitions (definitions.rs), which searches by patterns too, marking each.
    if args.first() != Some(&"stash") {
        command.env("GIT_LITERAL_PATHSPECS", "1");
    }

    // Start git in a new session with no controlling terminal. Otherwise, when Recastle
    // is launched from a terminal, ssh would ask for a passphrase there and hang.
    // Without a terminal, ssh and gpg fall back to the desktop's agent or GUI prompt.
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }

    command
}

pub(crate) fn workdir(path: &str) -> Result<PathBuf, String> {
    let repo = Repository::discover(path).map_err(|e| e.message().to_string())?;
    repo.workdir().map(PathBuf::from).ok_or_else(|| "This repository has no working copy.".to_string())
}

fn join_output(first: &str, second: &str) -> String {
    [first, second].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_repository_with_network_work_running_is_kept_till_it_ends() {
        let runnings = Runnings::default();
        let running = runnings.of("main", "/a");
        runnings.release("main", "/a");
        // Canceling finds the one running.
        assert!(std::sync::Arc::ptr_eq(&runnings.of("main", "/a"), &running));
        drop(running);
        runnings.release("main", "/a");
        assert!(runnings.0.release("main", "/a").is_none());
    }

    #[test]
    fn checking_git_versions() {
        let check = |o| check_version(o);
        assert!(check(Some("git version 2.34.1\n")).supported);
        assert!(check(Some("git version 2.29.0")).supported);
        assert!(!check(Some("git version 2.28.1")).supported);
        assert!(check(Some("git version 3.0.0")).supported);
        assert!(check(Some("git version 2.39.3 (Apple Git-145)")).supported);
        assert_eq!(check(Some("git version 2.39.3 (Apple Git-145)")).version.as_deref(), Some("2.39.3"));
        assert!(!check(Some("git version 2.25.1")).supported);
        assert_eq!(check(None), GitCheck { version: None, minimum: "2.29".into(), supported: false });
        assert!(!check(Some("something else")).supported);
    }

    #[test]
    fn the_installed_git_is_found() {
        let found = tauri::async_runtime::block_on(git_check());
        assert!(found.version.is_some() && found.supported, "{found:?}");
    }

    #[test]
    fn unattended_git_goes_on_while_it_reports_progress_and_stops_once_it_goes_quiet() {
        let t = crate::test_support::TempRepo::new("cli-quiet");
        // Longer than `quiet` in all, but never quiet for anything like as long.
        let quiet = std::time::Duration::from_secs(2);
        let talking = ["-c", "alias.slow=!for i in 1 2 3 4 5 6 7 8; do echo working >&2; sleep 0.3; done", "slow"];
        assert!(git_unattended_within(t.path(), &talking, quiet, &Default::default()).is_ok());

        let started = std::time::Instant::now();
        let silent = ["-c", "alias.stall=!sleep 20", "stall"];
        assert_eq!(git_unattended_within(t.path(), &silent, quiet, &Default::default()).unwrap_err(), STALLED);
        assert!(started.elapsed() < std::time::Duration::from_secs(10));

        // Canceled, as for another pull request, rather than stalled.
        let running = std::sync::Arc::new(Running::default());
        let canceler = std::sync::Arc::clone(&running);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            canceler.cancel();
        });
        let error = git_unattended_within(t.path(), &silent, std::time::Duration::from_secs(20), &running).unwrap_err();
        assert_eq!(error, crate::errors::CANCELED);
        // Canceled, it can run again; closed, nothing more starts on it.
        assert!(git_unattended_within(t.path(), &talking, quiet, &running).is_ok());
        running.close();
        let started = std::time::Instant::now();
        assert_eq!(git_unattended_within(t.path(), &silent, quiet, &running).unwrap_err(), crate::errors::CANCELED);
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }
}
