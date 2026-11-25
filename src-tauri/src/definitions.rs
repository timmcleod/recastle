//! Finding where a name is defined, for Ctrl+click (⌘-click) in the Files view's editor:
//! `git grep` for the lines that would define it, by patterns the page makes for its
//! language (see definitions.js). A guess, as it reads text, not code, but one that
//! needs nothing but git, in any repository. Reading only: nothing here changes it.

use crate::cli;
use std::process::Stdio;

/// No more are read than this, so a name found everywhere can't take all the memory. The
/// page ranks them, nearest the file first, and shows fewer (see goToDefinition.js).
const MOST_MATCHES: usize = 5000;
/// A line's text is cut to this many characters, for the list of matches.
const LONGEST_TEXT: usize = 200;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Match {
    /// The file's path from the top of the repository.
    file: String,
    /// The line it's on, from 1.
    line: u32,
    /// The line, trimmed, and cut short if long.
    text: String,
}

/// The lines in the working copy matching any of `patterns` (POSIX extended regular
/// expressions), in files whose names match any of `globs` (such as "*.js", in any
/// folder) or are any of `files` (paths from the top, as written); in all files with
/// neither. Untracked files too, but not binary ones or those in submodules; nor those
/// git ignores, unless `include_ignored`, as for .env files, which it does ignore: only
/// with `files` named, as otherwise every ignored folder, as node_modules, would be.
#[tauri::command]
pub async fn find_definitions(
    path: String,
    patterns: Vec<String>,
    globs: Vec<String>,
    files: Vec<String>,
    include_ignored: Option<bool>,
) -> Result<Vec<Match>, String> {
    if patterns.is_empty() {
        return Ok(Vec::new());
    }
    let workdir = cli::workdir(&path)?;
    // Whatever the user's config says: --untracked can't search submodules, and a column
    // would come before each line's text.
    let mut args = vec!["grep", "-n", "-z", "-I", "-E", "--untracked", "--no-recurse-submodules", "--no-column", "--full-name", "--no-color"];
    if include_ignored.unwrap_or(false) {
        if files.is_empty() {
            return Err("Ignored files are searched only by name.".into());
        }
        args.push("--no-exclude-standard");
    }
    for pattern in &patterns {
        args.extend(["-e", pattern]);
    }
    args.push("--");
    // Each says whether it's a pattern or a name, as git otherwise reads both as patterns.
    let pathspecs: Vec<String> =
        globs.iter().map(|glob| format!(":(glob)**/{glob}")).chain(files.iter().map(|file| format!(":(literal){file}"))).collect();
    args.extend(pathspecs.iter().map(String::as_str));
    let output = cli::command(&workdir, &args)
        // Read as each one says, rather than all as names (see cli::command).
        .env_remove("GIT_LITERAL_PATHSPECS")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Couldn't run git: {e}"))?;
    // 1 is git grep finding nothing.
    match output.status.code() {
        Some(0) => Ok(parse(&String::from_utf8_lossy(&output.stdout))),
        Some(1) if output.stderr.is_empty() => Ok(Vec::new()),
        _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
    }
}

/// git grep -n -z's lines: the file, a NUL, the line number, a NUL, then the text.
fn parse(output: &str) -> Vec<Match> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\0');
            let file = parts.next()?.to_string();
            let line = parts.next()?.parse().ok()?;
            let text: String = parts.next()?.trim().chars().take(LONGEST_TEXT).collect();
            Some(Match { file, line, text })
        })
        .take(MOST_MATCHES)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempRepo;
    use std::fs;
    use tauri::async_runtime::block_on;

    fn find(t: &TempRepo, patterns: &[&str], globs: &[&str]) -> Result<Vec<Match>, String> {
        find_in(t, patterns, globs, &[])
    }

    fn find_in(t: &TempRepo, patterns: &[&str], globs: &[&str], files: &[&str]) -> Result<Vec<Match>, String> {
        let strings = |list: &[&str]| list.iter().map(|s| s.to_string()).collect();
        block_on(find_definitions(t.dir.to_string_lossy().into_owned(), strings(patterns), strings(globs), strings(files), None))
    }

    fn found(file: &str, line: u32, text: &str) -> Match {
        Match { file: file.into(), line, text: text.into() }
    }

    #[test]
    fn finds_the_lines_in_the_files_named_untracked_ones_too_but_not_ignored() {
        let t = TempRepo::new("definitions-find");
        fs::create_dir_all(t.dir.join("src/lib")).unwrap();
        fs::write(t.dir.join(".gitignore"), "build/\n").unwrap();
        fs::write(t.dir.join("src/lib/format.js"), "// helpers\nexport function formatSize(bytes) {\n}\n").unwrap();
        fs::write(t.dir.join("src/notes.md"), "function formatSize(bytes) is in format.js\n").unwrap();
        fs::create_dir_all(t.dir.join("build")).unwrap();
        fs::write(t.dir.join("build/out.js"), "function formatSize(b) {}\n").unwrap();

        let matches = find(&t, &["function formatSize[^A-Za-z0-9_$]"], &["*.js"]).unwrap();
        assert_eq!(matches, [found("src/lib/format.js", 2, "export function formatSize(bytes) {")]);
        // With no files named, any.
        assert_eq!(find(&t, &["function formatSize[^A-Za-z0-9_$]"], &[]).unwrap().len(), 2);
    }

    #[test]
    fn nothing_found_is_no_matches_and_a_bad_pattern_says_why() {
        let t = TempRepo::new("definitions-none");
        fs::write(t.dir.join("a.js"), "const a = 1;\n").unwrap();
        assert_eq!(find(&t, &["function nowhere"], &[]).unwrap(), []);
        assert_eq!(find(&t, &[], &[]).unwrap(), []);
        assert!(find(&t, &["("], &[]).is_err());
    }

    #[test]
    fn a_file_named_is_only_that_file_however_its_name_reads_as_a_pattern() {
        let t = TempRepo::new("definitions-literal");
        fs::create_dir_all(t.dir.join("pages")).unwrap();
        fs::write(t.dir.join("pages/[id].vue"), "const id = 1;\n").unwrap();
        fs::write(t.dir.join("pages/i.vue"), "const id = 2;\n").unwrap();
        let matches = find_in(&t, &["const id"], &[], &["pages/[id].vue"]).unwrap();
        assert_eq!(matches, [found("pages/[id].vue", 1, "const id = 1;")]);
    }

    #[test]
    fn the_users_config_for_submodules_and_columns_changes_nothing() {
        let t = TempRepo::new("definitions-config");
        let mut config = t.repo.config().unwrap();
        config.set_bool("submodule.recurse", true).unwrap();
        config.set_bool("grep.column", true).unwrap();
        fs::write(t.dir.join("a.js"), "  function go() {}\n").unwrap();
        assert_eq!(find(&t, &["function go"], &["*.js"]).unwrap(), [found("a.js", 1, "function go() {}")]);
    }

    #[test]
    fn ignored_files_are_searched_when_asked_as_env_files_are() {
        let t = TempRepo::new("definitions-ignored");
        fs::write(t.dir.join(".gitignore"), ".env\n").unwrap();
        fs::write(t.dir.join(".env"), "APP_NAME=Recastle\n").unwrap();
        let strings = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let find = |files: &[&str], include_ignored| {
            block_on(find_definitions(t.dir.to_string_lossy().into_owned(), strings(&["^APP_NAME="]), vec![], strings(files), include_ignored))
        };
        assert_eq!(find(&[".env"], None).unwrap(), []);
        assert_eq!(find(&[".env"], Some(true)).unwrap(), [found(".env", 1, "APP_NAME=Recastle")]);
        // Not every ignored file, as in node_modules.
        assert!(find(&[], Some(true)).is_err());
    }

    #[test]
    fn a_long_line_is_cut_short() {
        let t = TempRepo::new("definitions-long");
        fs::write(t.dir.join("a.js"), format!("  const long = \"{}\";\n", "x".repeat(500))).unwrap();
        let matches = find(&t, &["const long"], &[]).unwrap();
        assert_eq!(matches[0].text.chars().count(), LONGEST_TEXT);
        assert!(matches[0].text.starts_with("const long"));
    }
}
