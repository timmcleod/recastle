//! GitHub pull requests: opening one for a branch, with its title and description
//! started from the branch's commits or the repository's template.

use crate::cli::Running;
use crate::github::{Method, api, api_get, blocking, token};
use crate::history::FoundCommit;
use crate::per_repo::PerRepo;
use crate::issues::{TOKEN_HELP, encode};
use git2::{Oid, Repository, Sort};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{State, WebviewWindow};

#[derive(Serialize, Deserialize, Debug)]
pub struct PullSummary {
    number: u64,
    title: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
}

#[derive(Serialize, Debug)]
pub struct BranchPull {
    /// The repository's default branch, which pull requests usually go into.
    default_branch: String,
    /// The open pull request from the branch, if there is one.
    pull: Option<PullSummary>,
}

#[derive(Deserialize)]
struct RepoDefaults {
    default_branch: String,
}

#[derive(Deserialize)]
struct BranchName {
    name: String,
}

/// owner/repo's default branch, and its open pull request from `head` ("branch", or
/// "owner:branch" for a branch in a fork), if there is one.
#[tauri::command]
pub async fn github_branch_pull(owner: String, repo: String, head: String) -> Result<BranchPull, String> {
    let token = token()?;
    blocking(move || {
        let info: RepoDefaults = api_get(&token, &format!("/repos/{owner}/{repo}")).map_err(plain)?;
        // GitHub only matches `head` written as "owner:branch".
        let head = if head.contains(':') { head } else { format!("{owner}:{head}") };
        let path = format!("/repos/{owner}/{repo}/pulls?state=open&per_page=1&head={}", encode(&head));
        let pulls: Vec<PullSummary> = api_get(&token, &path).map_err(plain)?;
        Ok(BranchPull { default_branch: info.default_branch, pull: pulls.into_iter().next() })
    })
    .await
}

/// owner/repo's branches on GitHub, for choosing where a pull request goes.
#[tauri::command]
pub async fn github_branches(owner: String, repo: String) -> Result<Vec<String>, String> {
    let token = token()?;
    blocking(move || {
        // A page at a time, up to a thousand.
        let mut names = Vec::new();
        for page in 1..=10 {
            let branches: Vec<BranchName> =
                api_get(&token, &format!("/repos/{owner}/{repo}/branches?per_page=100&page={page}")).map_err(plain)?;
            let last = branches.len() < 100;
            names.extend(branches.into_iter().map(|b| b.name));
            if last {
                break;
            }
        }
        Ok(names)
    })
    .await
}

/// Opens a pull request into owner/repo's `base` branch from `head`.
#[tauri::command]
pub async fn github_create_pull(
    owner: String,
    repo: String,
    base: String,
    head: String,
    title: String,
    body: String,
    draft: bool,
) -> Result<PullSummary, String> {
    let token = token()?;
    let fields = serde_json::json!({ "base": base, "head": head, "title": title.trim(), "body": body, "draft": draft });
    blocking(move || api(&token, Method::Post(fields), &format!("/repos/{owner}/{repo}/pulls")).map_err(plain)).await
}

/// Where a pull request stands for merging, and what merging it would write.
#[derive(Serialize, Debug)]
pub struct MergeState {
    /// GitHub's GraphQL id, for marking a draft ready.
    node_id: String,
    draft: bool,
    merged: bool,
    /// GitHub's verdict: "clean", "unstable" (checks haven't passed but aren't
    /// required), "dirty" (conflicts), "blocked", "behind", "draft", "has_hooks" or
    /// "unknown" while it's still working it out.
    mergeable_state: String,
    base: String,
    head: String,
    /// The repository the head branch is in, as "owner/repo".
    head_repo: Option<String>,
    head_sha: String,
    /// The ways the repository allows: "merge", "squash" and "rebase".
    methods: Vec<&'static str>,
    /// Whether the account may merge into the repository.
    can_merge: bool,
    /// Whether GitHub deletes the head branch itself after merging.
    deletes_branch: bool,
    checks: Option<Checks>,
    /// The commit title and message GitHub would write, for a merge commit and for a
    /// squash, as the repository's settings say.
    merge_title: String,
    merge_message: String,
    squash_title: String,
    squash_message: String,
}

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct Checks {
    passed: usize,
    failed: usize,
    pending: usize,
}

#[derive(Deserialize)]
struct Pull {
    number: u64,
    node_id: String,
    title: String,
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    merged: bool,
    mergeable: Option<bool>,
    #[serde(default)]
    mergeable_state: String,
    head: PullBranch,
    base: PullBranch,
}

#[derive(Deserialize)]
struct PullBranch {
    #[serde(rename = "ref")]
    name: String,
    sha: String,
    /// "owner:branch".
    label: String,
    repo: Option<RepoName>,
}

#[derive(Deserialize)]
struct RepoName {
    full_name: String,
}

/// A repository's merge settings. Those about commit messages are only there for
/// accounts that can merge; GitHub's defaults stand in for the others.
#[derive(Deserialize, Default)]
#[serde(default)]
struct MergeSettings {
    allow_merge_commit: Option<bool>,
    allow_squash_merge: Option<bool>,
    allow_rebase_merge: Option<bool>,
    delete_branch_on_merge: bool,
    merge_commit_title: Option<String>,
    merge_commit_message: Option<String>,
    squash_merge_commit_title: Option<String>,
    squash_merge_commit_message: Option<String>,
    permissions: Option<Permissions>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Permissions {
    push: bool,
}

#[derive(Deserialize)]
struct PullCommit {
    commit: CommitMessage,
}

#[derive(Deserialize)]
struct CommitMessage {
    message: String,
}

#[derive(Deserialize)]
struct CheckRuns {
    check_runs: Vec<CheckRun>,
}

#[derive(Deserialize)]
struct CheckRun {
    status: String,
    conclusion: Option<String>,
}

#[derive(Deserialize)]
struct CombinedStatus {
    statuses: Vec<Status>,
}

#[derive(Deserialize)]
struct Status {
    state: String,
}

/// Whether pull request `number` can be merged, how, and with what message.
#[tauri::command]
pub async fn github_merge_state(owner: String, repo: String, number: u64) -> Result<MergeState, String> {
    let token = token()?;
    blocking(move || {
        let path = format!("/repos/{owner}/{repo}/pulls/{number}");
        let mut pull: Pull = api_get(&token, &path).map_err(plain)?;
        // GitHub works mergeability out in the background after changes; it's
        // usually ready a moment later.
        for _ in 0..3 {
            if pull.mergeable.is_some() || pull.merged {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1500));
            pull = api_get(&token, &path).map_err(plain)?;
        }
        let settings: MergeSettings = api_get(&token, &format!("/repos/{owner}/{repo}")).map_err(plain)?;
        let commits: Vec<PullCommit> = api_get(&token, &format!("{path}/commits?per_page=100")).unwrap_or_default();
        let messages: Vec<String> = commits.into_iter().map(|c| c.commit.message).collect();
        let checks = read_checks(&token, &owner, &repo, &pull.head.sha);
        Ok(merge_state(pull, &settings, &messages, checks))
    })
    .await
}

fn merge_state(pull: Pull, settings: &MergeSettings, messages: &[String], checks: Option<Checks>) -> MergeState {
    let allowed = |setting: Option<bool>| setting.unwrap_or(true);
    let methods = [
        (allowed(settings.allow_merge_commit), "merge"),
        (allowed(settings.allow_squash_merge), "squash"),
        (allowed(settings.allow_rebase_merge), "rebase"),
    ]
    .into_iter()
    .filter_map(|(on, method)| on.then_some(method))
    .collect();
    let (merge_title, merge_message, squash_title, squash_message) = commit_texts(&pull, settings, messages);
    let same_repo = same_repo(&pull);
    MergeState {
        node_id: pull.node_id,
        draft: pull.draft,
        merged: pull.merged,
        mergeable_state: if pull.mergeable.is_none() && !pull.merged { "unknown".into() } else { pull.mergeable_state },
        base: pull.base.name,
        head: pull.head.name,
        head_repo: pull.head.repo.map(|r| r.full_name),
        head_sha: pull.head.sha,
        methods,
        can_merge: settings.permissions.as_ref().is_some_and(|p| p.push),
        // Only for branches in the repository itself, not in forks.
        deletes_branch: settings.delete_branch_on_merge && same_repo,
        checks,
        merge_title,
        merge_message,
        squash_title,
        squash_message,
    }
}

/// The titles and messages GitHub writes for a merge commit and a squash, following
/// the repository's settings, or GitHub's defaults where it doesn't say.
fn commit_texts(pull: &Pull, settings: &MergeSettings, messages: &[String]) -> (String, String, String, String) {
    let numbered = format!("{} (#{})", pull.title, pull.number);
    let body = pull.body.clone().unwrap_or_default();
    let merge_title = match settings.merge_commit_title.as_deref() {
        Some("PR_TITLE") => numbered.clone(),
        _ => format!("Merge pull request #{} from {}", pull.number, pull.head.label.replacen(':', "/", 1)),
    };
    let merge_message = match settings.merge_commit_message.as_deref() {
        Some("PR_BODY") => body.clone(),
        Some("BLANK") => String::new(),
        _ => pull.title.clone(),
    };
    let subject = |message: &String| message.lines().next().unwrap_or_default().to_string();
    let squash_title = match (settings.squash_merge_commit_title.as_deref(), messages) {
        (Some("PR_TITLE"), _) | (_, [] | [_, _, ..]) => numbered,
        (_, [only]) => format!("{} (#{})", subject(only), pull.number),
    };
    let squash_message = match (settings.squash_merge_commit_message.as_deref(), messages) {
        (Some("PR_BODY"), _) => body,
        (Some("BLANK"), _) => String::new(),
        (_, [only]) => only.lines().skip(1).collect::<Vec<_>>().join("\n").trim().to_string(),
        (_, many) => many.iter().map(|m| format!("* {}", m.trim())).collect::<Vec<_>>().join("\n\n"),
    };
    (merge_title, merge_message, squash_title, squash_message)
}

/// How the head commit's checks and statuses stand, or None when the token can't
/// read them.
fn read_checks(token: &str, owner: &str, repo: &str, sha: &str) -> Option<Checks> {
    let runs: Option<CheckRuns> = api_get(token, &format!("/repos/{owner}/{repo}/commits/{sha}/check-runs?per_page=100")).ok();
    let statuses: Option<CombinedStatus> = api_get(token, &format!("/repos/{owner}/{repo}/commits/{sha}/status")).ok();
    if runs.is_none() && statuses.is_none() {
        return None;
    }
    let mut checks = Checks::default();
    for run in runs.map(|r| r.check_runs).unwrap_or_default() {
        match (run.status.as_str(), run.conclusion.as_deref()) {
            ("completed", Some("success" | "neutral" | "skipped")) => checks.passed += 1,
            ("completed", _) => checks.failed += 1,
            _ => checks.pending += 1,
        }
    }
    for status in statuses.map(|s| s.statuses).unwrap_or_default() {
        match status.state.as_str() {
            "success" => checks.passed += 1,
            "pending" => checks.pending += 1,
            _ => checks.failed += 1,
        }
    }
    Some(checks)
}

#[derive(Deserialize, Serialize)]
pub struct Merged {
    sha: String,
}

/// Merges pull request `number` by `method` ("merge", "squash" or "rebase"), as long
/// as its head is still `sha`. A rebase takes no title or message.
#[tauri::command]
pub async fn github_merge_pull(
    owner: String,
    repo: String,
    number: u64,
    method: String,
    title: Option<String>,
    message: Option<String>,
    sha: String,
) -> Result<Merged, String> {
    let token = token()?;
    let mut fields = serde_json::json!({ "merge_method": method, "sha": sha });
    if let Some(title) = title {
        fields["commit_title"] = title.trim().into();
    }
    if let Some(message) = message {
        fields["commit_message"] = message.into();
    }
    let path = format!("/repos/{owner}/{repo}/pulls/{number}/merge");
    blocking(move || api(&token, Method::Put(Some(fields)), &path).map_err(plain)).await
}

#[derive(Deserialize)]
struct GraphQlReply {
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Deserialize)]
struct GraphQlError {
    message: String,
}

/// Marks a draft pull request ready for review. Only GitHub's GraphQL API can.
#[tauri::command]
pub async fn github_ready_for_review(node_id: String) -> Result<(), String> {
    let token = token()?;
    let query = "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }";
    let fields = serde_json::json!({ "query": query, "variables": { "id": node_id } });
    blocking(move || {
        let reply: GraphQlReply = api(&token, Method::Post(fields), "/graphql").map_err(plain)?;
        match reply.errors.first() {
            Some(error) => Err(plain(format!("GitHub said: {}", error.message))),
            None => Ok(()),
        }
    })
    .await
}

/// Renames a branch on GitHub, which moves its open pull requests to the new name.
#[tauri::command]
pub async fn github_rename_branch(owner: String, repo: String, branch: String, new_name: String) -> Result<(), String> {
    let token = token()?;
    let fields = serde_json::json!({ "new_name": new_name.trim() });
    let path = format!("/repos/{owner}/{repo}/branches/{}/rename", encode_branch(&branch));
    // Renaming is about the repository's contents rather than its pull requests.
    let plain = |e| plain(e).replace("the Pull requests permission", "the Contents permission");
    blocking(move || api::<serde_json::Value>(&token, Method::Post(fields), &path).map(drop).map_err(plain)).await
}

#[derive(Deserialize)]
struct GitRef {
    object: GitObject,
}

#[derive(Deserialize)]
struct GitObject {
    sha: String,
}

/// Deletes a branch on GitHub, as after merging its pull request: only while it's
/// still at `sha`, the commit that was merged, so nothing pushed since is lost.
#[tauri::command]
pub async fn github_delete_branch(owner: String, repo: String, branch: String, sha: String) -> Result<(), String> {
    let token = token()?;
    let path = format!("/repos/{owner}/{repo}/git/refs/heads/{}", encode_branch(&branch));
    let one = format!("/repos/{owner}/{repo}/git/ref/heads/{}", encode_branch(&branch));
    blocking(move || {
        let now: GitRef = api_get(&token, &one).map_err(plain)?;
        if now.object.sha != sha {
            return Err(format!("{branch} has commits pushed since it was merged, so it's been kept on GitHub."));
        }
        api(&token, Method::Delete, &path).map_err(plain)
    })
    .await
}

/// The full messages of the commits on `head` that `base` doesn't have, newest first
/// and at most 100, for starting a pull request's title and description.
#[tauri::command]
pub async fn branch_commit_messages(path: String, base: String, head: String) -> Result<Vec<String>, String> {
    commit_messages(&path, &base, &head).map_err(|e| e.message().to_string())
}

fn commit_messages(path: &str, base: &str, head: &str) -> Result<Vec<String>, git2::Error> {
    let repo = Repository::discover(path)?;
    let mut walk = repo.revwalk()?;
    walk.push(repo.revparse_single(head)?.peel_to_commit()?.id())?;
    walk.hide(repo.revparse_single(base)?.peel_to_commit()?.id())?;
    let mut messages = Vec::new();
    for id in walk.take(100) {
        let commit = repo.find_commit(id?)?;
        messages.push(commit.message().unwrap_or_default().trim().to_string());
    }
    Ok(messages)
}

/// Whether a pull request's head branch is in the repository it's to be merged into,
/// rather than in a fork, or one since deleted.
fn same_repo(pull: &Pull) -> bool {
    let name = |branch: &PullBranch| branch.repo.as_ref().map(|r| r.full_name.to_lowercase());
    name(&pull.head).is_some() && name(&pull.head) == name(&pull.base)
}

/// What pull request `number` changes, for its Commits tab.
#[derive(Serialize, Debug)]
pub struct PullChanges {
    /// Where the pull request split from its base branch, and its head commit: its
    /// changes are those made on head since, as GitHub shows them, even once it's merged.
    /// The split moves only as the pull request's rebased or the base merged into it, not
    /// as the base branch goes on, so its changes, open, stay open.
    base: String,
    head: String,
    /// The branches they're on, to name them by: "owner:branch" for a fork's.
    base_name: String,
    head_name: String,
    /// Its commits, parents before children, at most MAX_PULL_COMMITS.
    commits: Vec<FoundCommit>,
    /// Whether it has more commits than are listed.
    more: bool,
}

/// As many of a pull request's commits as GitHub lists.
const MAX_PULL_COMMITS: usize = 250;

/// The fetch of a pull request's commits under way in each repository a window has open:
/// one at a time, the one before stopped as another pull request's are asked for, as
/// its tab's done with the repository (see windows::release_repo), and as its window
/// closes (see windows::forget). Stopped even before it's started, as while GitHub's
/// still being asked where the pull request is (see Running::close). Not one of the
/// repository's fetches, pulls and pushes (see cli::Runnings), so one of the user's
/// isn't kept waiting for it, nor turned away.
#[derive(Default)]
pub struct PullFetches(PerRepo<Arc<Running>>);

impl PullFetches {
    /// A fresh one for the repository in the window, the one before stopped.
    fn start(&self, window: &str, path: &str) -> Arc<Running> {
        let running = Arc::new(Running::default());
        if let Some(before) = self.0.set(window, path, Arc::clone(&running)) {
            before.close();
        }
        running
    }

    /// Stops the repository's in the window, which is done with it.
    pub fn release(&self, window: &str, path: &str) {
        if let Some(running) = self.0.release(window, path) {
            running.close();
        }
    }

    /// Stops those of a window that's closed.
    pub fn forget(&self, window: &str) {
        for running in self.0.forget(window) {
            running.close();
        }
    }
}

/// Pull request `number` of owner/repo's changes and commits, read from the repository
/// at `path`. Its commits are fetched where they aren't here already, from owner/repo on
/// GitHub, over HTTPS with the account Recastle's signed in to, as it must be to show
/// pull requests: whatever the repository's remotes are, or whether it has one for
/// owner/repo at all, as a fork's parent may not, and with no passphrase to ask for.
#[tauri::command]
pub async fn pull_changes(
    window: WebviewWindow,
    fetches: State<'_, PullFetches>,
    path: String,
    owner: String,
    repo: String,
    number: u64,
) -> Result<PullChanges, String> {
    let token = token()?;
    let running = fetches.start(window.label(), &path);
    blocking(move || {
        // Before asking GitHub, which a shallow clone would only be refused after.
        refuse_shallow(&path)?;
        let pull: Pull = api_get(&token, &format!("/repos/{owner}/{repo}/pulls/{number}")).map_err(plain)?;
        let from = format!("https://github.com/{owner}/{repo}.git");
        let refs = format!("{PULL_REFS}{}/{}/{number}", ref_part(&owner), ref_part(&repo));
        let head = fetch_missing(&path, &from, &refs, number, &pull.base.sha, &pull.head.sha, FETCH_QUIET_LIMIT, &running)?;
        let base = split_point(&path, &pull.base.sha, &head).map_err(|e| e.message().to_string())?;
        let (commits, more) = pull_commits(&path, &base, &head).map_err(|e| e.message().to_string())?;
        let (base_name, head_name) = branch_names(&pull);
        Ok(PullChanges { base, head, base_name, head_name, commits, more })
    })
    .await
}

/// What a pull request's base and head branches are called: a fork's as "owner:branch",
/// as GitHub shows it.
fn branch_names(pull: &Pull) -> (String, String) {
    let head = if same_repo(pull) { &pull.head.name } else { &pull.head.label };
    (pull.base.name.clone(), head.clone())
}

/// Where pull requests' commits are fetched to, as "owner/repo/number/head" and "…/base":
/// out of sight of the branch list, and kept, so git doesn't clean them away as unused,
/// to be fetched again.
const PULL_REFS: &str = "refs/recastle/pulls/";

/// An owner's or repository's name as part of a ref's: as it is, but for a leading "."
/// or a trailing ".lock", which git doesn't allow there, as in ".github", the name of an
/// organization's repository for its community files.
fn ref_part(name: &str) -> String {
    let name = name.strip_prefix('.').map_or_else(|| name.to_string(), |rest| format!("%2E{rest}"));
    match name.strip_suffix(".lock") {
        Some(rest) => format!("{rest}%2Elock"),
        None => name,
    }
}

/// For each repository and pull request's refs, the head GitHub said it had when they
/// were last fetched, and when. Just after a push, GitHub can say where the pull request
/// is before its refs/pull ref has caught up: what's fetched isn't that commit, and
/// fetching again each time the fetch itself sets off a refresh would go round and
/// round. Asked for the same head again soon after, what was fetched shows instead; a
/// while after, it's fetched again, by when refs/pull will have caught up.
static FETCHED_FOR: LazyLock<Mutex<HashMap<(String, String), Asked>>> = LazyLock::new(Default::default);

/// The head GitHub said a pull request had, and when it was fetched for.
type Asked = (String, Instant);

/// How long what's fetched shows in place of a head GitHub's refs hadn't caught up with.
const FETCHED_FOR_WHILE: Duration = Duration::from_secs(30);

/// How long fetching a pull request's commits may go without progress before it's given
/// up on, as when the network's stalled: nobody can cancel it, only choose another.
const FETCH_QUIET_LIMIT: Duration = Duration::from_secs(60);

/// In a shallow clone, the history where a pull request split from its base is mostly
/// missing: its commits would take in the base's older ones, and its changes undo what
/// the base did since. Rather than show those, or fetch history the user chose to do
/// without, it says so.
fn refuse_shallow(path: &str) -> Result<(), String> {
    let repo = Repository::discover(path).map_err(|e| e.message().to_string())?;
    if repo.is_shallow() {
        return Err("This repository is a shallow clone, without the history to find a pull request's commits in. Fetch all of it with “git fetch --unshallow”, then try again.".to_string());
    }
    Ok(())
}

/// Fetches whichever of `base` and `head` the repository hasn't got from `from`, a URL
/// or a remote, into `refs`: the head as GitHub keeps it for pull request `number`,
/// there still once its branch is deleted, and the base by its commit. Only into those
/// refs: no branch changes, nor FETCH_HEAD, which a pull running alongside reads; nor
/// submodules, which aren't shown, and would be fetched from elsewhere. `from` stays
/// as it is, whatever the user's `url.*.insteadOf` would make it, as SSH for GitHub. As
/// a background fetch is, it asks for no password or passphrase; and it's stopped once
/// it's gone `quiet` without progress, or with `running`. Without `gc --auto` after,
/// which, quiet, could be taken for a stall. The head to show: `head`, or where the pull
/// request's been pushed to since, or not yet, GitHub said, the one fetched (see
/// FETCHED_FOR).
#[expect(clippy::too_many_arguments, reason = "what to fetch, from where, to where, and how it stops")]
fn fetch_missing(
    path: &str,
    from: &str,
    refs: &str,
    number: u64,
    base: &str,
    head: &str,
    quiet: Duration,
    running: &Arc<Running>,
) -> Result<String, String> {
    let repo = Repository::discover(path).map_err(|e| e.message().to_string())?;
    let has = |id: &str| Oid::from_str(id).is_ok_and(|oid| repo.find_commit(oid).is_ok());
    let fetched = || repo.refname_to_id(&format!("{refs}/head")).map(|id| id.to_string());
    let memo = (path.to_string(), refs.to_string());
    let lately = FETCHED_FOR
        .lock()
        .unwrap()
        .get(&memo)
        .is_some_and(|(asked, at)| asked == head && at.elapsed() < FETCHED_FOR_WHILE);
    let mut wanted = Vec::new();
    if !has(head) {
        match fetched() {
            Ok(tip) if lately && has(&tip) && has(base) => return Ok(tip),
            _ => wanted.push(format!("+refs/pull/{number}/head:{refs}/head")),
        }
    }
    if !has(base) {
        wanted.push(format!("+{base}:{refs}/base"));
    }
    if wanted.is_empty() {
        return Ok(head.to_string());
    }
    // Rewritten to itself, which is longer, and so wins over any rule of the user's.
    let as_it_is = format!("url.{from}.insteadOf={from}");
    let mut args = vec!["-c", &as_it_is, "fetch", "--progress", "--no-tags", "--no-auto-gc"];
    args.extend(["--no-write-fetch-head", "--no-recurse-submodules", from]);
    args.extend(wanted.iter().map(String::as_str));
    match crate::cli::git_unattended_within(path, &args, quiet, running) {
        Err(e) if e == crate::cli::STALLED => {
            return Err("Fetching the pull request's commits stalled. Check your connection, then try again.".to_string());
        }
        Err(e) if refused(&e) => {
            return Err(format!(
                "{TOKEN_HELP}Your GitHub token can't read this repository's code, which the pull request's \
                 commits are fetched from. Fine-grained tokens need the Contents permission, set to Read, for \
                 this repository. Change it on GitHub, or sign in with a classic token."
            ));
        }
        result => result?,
    };
    FETCHED_FOR.lock().unwrap().insert(memo, (head.to_string(), Instant::now()));
    if has(head) {
        return Ok(head.to_string());
    }
    fetched().map_err(|e| e.message().to_string())
}

/// Whether git was refused what it fetched, as GitHub refuses a token that can read a
/// repository's pull requests but not its code, saying it isn't there.
fn refused(error: &str) -> bool {
    ["Authentication failed", "returned error: 403", "Repository not found", "could not read Username"]
        .iter()
        .any(|said| error.contains(said))
        || (error.contains("fatal: repository") && error.contains("not found"))
}

/// Where `head` split from `base`; `base` itself where they share no history.
fn split_point(path: &str, base: &str, head: &str) -> Result<String, git2::Error> {
    let repo = Repository::discover(path)?;
    Ok(repo.merge_base(Oid::from_str(base)?, Oid::from_str(head)?).map_or_else(|_| base.to_string(), |id| id.to_string()))
}

/// The commits on `head` that `base` doesn't have, oldest first, at most
/// MAX_PULL_COMMITS, and whether there are more.
fn pull_commits(path: &str, base: &str, head: &str) -> Result<(Vec<FoundCommit>, bool), git2::Error> {
    let repo = Repository::discover(path)?;
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)?;
    walk.push(Oid::from_str(head)?)?;
    walk.hide(Oid::from_str(base)?)?;
    let mut commits = Vec::new();
    for id in walk {
        if commits.len() == MAX_PULL_COMMITS {
            return Ok((commits, true));
        }
        commits.push(FoundCommit::of(&repo.find_commit(id?)?));
    }
    Ok((commits, false))
}

/// The repository's pull request template, if it has one: pull_request_template.md
/// in .github, the top folder or docs, however it's capitalized.
#[tauri::command]
pub async fn pull_request_template(path: String) -> Option<String> {
    let repo = Repository::discover(&path).ok()?;
    find_template(repo.workdir()?)
}

fn find_template(workdir: &Path) -> Option<String> {
    [".github", "", "docs"].iter().find_map(|dir| {
        let found = std::fs::read_dir(workdir.join(dir)).ok()?.flatten().find(|entry| {
            entry.file_name().to_str().is_some_and(|name| name.eq_ignore_ascii_case("pull_request_template.md"))
                && entry.path().is_file()
        })?;
        std::fs::read_to_string(found.path()).ok()
    })
}

/// A branch name for a URL path: each part percent-encoded, keeping the slashes
/// between them, so a "#" or "?" in a name can't cut it short.
fn encode_branch(branch: &str) -> String {
    branch.split('/').map(encode).collect::<Vec<_>>().join("/")
}

/// GitHub's refusals about pull requests in plain words. Those about the token start
/// with TOKEN_HELP.
fn plain(error: String) -> String {
    let error = crate::github::in_moved_repo(error);
    if error.contains("Resource not accessible by personal access token") {
        format!(
            "{TOKEN_HELP}Your GitHub token isn't allowed to do that. Fine-grained tokens need the Pull requests \
             permission, set to Read and write, for this repository. Change it on GitHub, or sign in with a \
             classic token."
        )
    } else if error.contains("No commits between") {
        "There's nothing to merge: the branch has no commits that the base branch doesn't.".into()
    } else if error.contains("A pull request already exists") {
        "This branch already has an open pull request into that branch.".into()
    } else if error.contains("Head branch was modified") {
        "The branch has changed since this was loaded. Look over the new commits, then merge again.".into()
    } else if error.contains("Draft pull requests are not supported") {
        "This repository doesn't allow draft pull requests. Create it as a regular one instead.".into()
    } else {
        error
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempRepo;
    use crate::cli::git;

    #[test]
    fn listing_a_branchs_own_commits() {
        let t = TempRepo::new("pull-commits");
        t.commit(&[("a.txt", Some("1\n"))], "First");
        let main = t.branch();
        git(t.path(), &["switch", "-q", "-c", "feature"], None).unwrap();
        t.commit(&[("b.txt", Some("1\n"))], "Add b\n\nBecause.");
        t.commit(&[("c.txt", Some("1\n"))], "Add c");
        assert_eq!(commit_messages(t.path(), &main, "feature").unwrap(), ["Add c", "Add b\n\nBecause."]);
        assert!(commit_messages(t.path(), "no-such-branch", "feature").is_err());
    }

    #[test]
    fn finding_the_template() {
        let t = TempRepo::new("pull-template");
        assert_eq!(find_template(&t.dir), None);
        t.write(&[("docs/pull_request_template.md", Some("From docs\n"))]);
        assert_eq!(find_template(&t.dir).as_deref(), Some("From docs\n"));
        t.write(&[(".github/PULL_REQUEST_TEMPLATE.md", Some("## What\n"))]);
        assert_eq!(find_template(&t.dir).as_deref(), Some("## What\n"));
    }

    fn pull(title: &str) -> Pull {
        let branch = |name: &str| PullBranch { name: name.into(), sha: "abc".into(), label: format!("tim:{name}"), repo: None };
        Pull {
            number: 7,
            node_id: "PR_1".into(),
            title: title.into(),
            body: Some("Adds it.".into()),
            draft: false,
            merged: false,
            mergeable: Some(true),
            mergeable_state: "clean".into(),
            head: branch("dark-mode"),
            base: branch("main"),
        }
    }

    #[test]
    fn writing_merge_messages_as_github_does() {
        let defaults = MergeSettings::default();
        let one = ["Add a toggle\n\nIn the toolbar.".to_string()];
        let (merge_title, merge_message, squash_title, squash_message) = commit_texts(&pull("Dark mode"), &defaults, &one);
        assert_eq!(merge_title, "Merge pull request #7 from tim/dark-mode");
        assert_eq!(merge_message, "Dark mode");
        assert_eq!(squash_title, "Add a toggle (#7)");
        assert_eq!(squash_message, "In the toolbar.");

        let two = ["Add colors".to_string(), "Add a toggle\n\nIn the toolbar.".to_string()];
        let (_, _, squash_title, squash_message) = commit_texts(&pull("Dark mode"), &defaults, &two);
        assert_eq!(squash_title, "Dark mode (#7)");
        assert_eq!(squash_message, "* Add colors\n\n* Add a toggle\n\nIn the toolbar.");

        let settings = MergeSettings {
            merge_commit_title: Some("PR_TITLE".into()),
            merge_commit_message: Some("PR_BODY".into()),
            squash_merge_commit_message: Some("BLANK".into()),
            ..Default::default()
        };
        let (merge_title, merge_message, _, squash_message) = commit_texts(&pull("Dark mode"), &settings, &two);
        assert_eq!((merge_title.as_str(), merge_message.as_str(), squash_message.as_str()), ("Dark mode (#7)", "Adds it.", ""));
    }

    #[test]
    fn offering_the_allowed_ways_to_merge() {
        let settings = MergeSettings { allow_merge_commit: Some(false), permissions: Some(Permissions { push: true }), ..Default::default() };
        let state = merge_state(pull("Dark mode"), &settings, &[], None);
        assert_eq!(state.methods, ["squash", "rebase"]);
        assert!(state.can_merge);
        let unknown = Pull { mergeable: None, ..pull("Dark mode") };
        assert_eq!(merge_state(unknown, &settings, &[], None).mergeable_state, "unknown");
    }

    #[test]
    fn encoding_branch_names_for_urls() {
        assert_eq!(encode_branch("feature/fix#12?"), "feature/fix%2312%3F");
    }

    #[test]
    fn github_deletes_only_its_own_branches_after_merging() {
        let settings = MergeSettings { delete_branch_on_merge: true, ..Default::default() };
        let in_repo = |owner: &str| Some(RepoName { full_name: format!("{owner}/lantern") });
        let mut own = pull("Dark mode");
        own.head.repo = in_repo("tim");
        own.base.repo = in_repo("tim");
        assert!(merge_state(own, &settings, &[], None).deletes_branch);
        let mut forked = pull("Dark mode");
        forked.head.repo = in_repo("maya");
        forked.base.repo = in_repo("tim");
        assert!(!merge_state(forked, &settings, &[], None).deletes_branch);
    }

    #[test]
    fn explaining_refusals() {
        assert!(plain("GitHub said: Validation Failed: No commits between main and x.".into()).starts_with("There's nothing"));
        assert!(plain("GitHub said: Resource not accessible by personal access token".into()).starts_with(TOKEN_HELP));
        assert_eq!(plain("GitHub said: Not Found".into()), "GitHub said: Not Found");
    }

    const REFS: &str = "refs/recastle/pulls/ada/engine/7";

    #[test]
    fn a_pull_request_s_commits_are_fetched_where_missing_and_listed_from_where_it_split() {
        // Standing in for GitHub, which keeps each pull request's head at refs/pull/N/head.
        let github = TempRepo::new("pull-github");
        let split = github.commit(&[("a.txt", Some("1\n"))], "First").to_string();
        let main = github.branch();
        let clone = TempRepo::clone_of("pull-clone", &github);
        git(github.path(), &["switch", "-q", "-c", "feature"], None).unwrap();
        github.commit(&[("b.txt", Some("1\n"))], "Add b");
        let head = github.commit(&[("c.txt", Some("1\n"))], "Add c").to_string();
        github.repo.reference("refs/pull/7/head", Oid::from_str(&head).unwrap(), true, "").unwrap();
        // The base moved on since the clone, and the pull request's branch is gone.
        git(github.path(), &["switch", "-q", &main], None).unwrap();
        let base = github.commit(&[("d.txt", Some("1\n"))], "Add d").to_string();
        git(github.path(), &["branch", "-q", "-D", "feature"], None).unwrap();
        git(github.path(), &["config", "uploadpack.allowAnySHA1InWant", "true"], None).unwrap();

        let running = Arc::default();
        assert_eq!(fetch_missing(clone.path(), "origin", REFS, 7, &base, &head, FETCH_QUIET_LIMIT, &running).unwrap(), head);
        // As the base goes on, the changes are still from where the pull request split.
        assert_eq!(split_point(clone.path(), &base, &head).unwrap(), split);
        let (commits, more) = pull_commits(clone.path(), &split, &head).unwrap();
        assert_eq!(commits.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["Add b", "Add c"]);
        assert!(!more);
        // Into refs of their own, kept so they aren't cleaned away, and no branch.
        assert_eq!(clone.repo.refname_to_id(&format!("{REFS}/head")).unwrap().to_string(), head);
        assert_eq!(clone.repo.refname_to_id(&format!("{REFS}/base")).unwrap().to_string(), base);
        assert_eq!(clone.repo.references_glob("refs/pull/*").unwrap().count(), 0);
        assert!(clone.repo.find_reference("FETCH_HEAD").is_err());

        // Here already, nothing's fetched: with nowhere to fetch from, it still works.
        fetch_missing(clone.path(), "no-such-remote", REFS, 7, &base, &head, FETCH_QUIET_LIMIT, &running).unwrap();
    }

    #[test]
    fn a_pull_request_rewritten_since_github_said_where_it_was_shows_as_it_is_now() {
        let github = TempRepo::new("pull-rewritten-github");
        let base = github.commit(&[("a.txt", Some("1\n"))], "First").to_string();
        let clone = TempRepo::clone_of("pull-rewritten-clone", &github);
        let said = github.commit(&[("b.txt", Some("1\n"))], "Add b").to_string();
        // Force-pushed over, so what GitHub said is gone from it.
        git(github.path(), &["reset", "-q", "--hard", &base], None).unwrap();
        let now = github.commit(&[("b.txt", Some("2\n"))], "Add b, again").to_string();
        github.repo.reference("refs/pull/7/head", Oid::from_str(&now).unwrap(), true, "").unwrap();

        let shown = fetch_missing(clone.path(), "origin", REFS, 7, &base, &said, FETCH_QUIET_LIMIT, &Arc::default()).unwrap();
        assert_eq!(shown, now);
    }

    #[test]
    fn a_fetch_that_stalls_is_given_up_on() {
        let github = TempRepo::new("pull-stall-github");
        github.commit(&[("a.txt", Some("1\n"))], "First");
        let clone = TempRepo::clone_of("pull-stall-clone", &github);
        let head = github.commit(&[("b.txt", Some("1\n"))], "Add b").to_string();
        github.repo.reference("refs/pull/7/head", Oid::from_str(&head).unwrap(), true, "").unwrap();
        // The other side hangs, as over a stalled connection.
        git(clone.path(), &["config", "remote.origin.uploadpack", "sleep 30; git-upload-pack"], None).unwrap();

        let started = std::time::Instant::now();
        let base = clone.head().to_string();
        let error = fetch_missing(clone.path(), "origin", REFS, 7, &base, &head, Duration::from_secs(1), &Arc::default()).unwrap_err();
        assert!(error.contains("stalled"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn asking_for_another_pull_request_s_commits_stops_the_fetch_before_even_if_it_hasn_t_started() {
        let t = TempRepo::new("pull-fetches");
        let fetches = PullFetches::default();
        let silent = ["-c", "alias.stall=!sleep 20", "stall"];
        let first = fetches.start("main", t.path());
        let path = t.path().to_string();
        let fetching = std::thread::spawn(move || crate::cli::git_unattended_within(&path, &silent, Duration::from_secs(20), &first));
        std::thread::sleep(Duration::from_millis(300));
        let second = fetches.start("main", t.path());
        assert_eq!(fetching.join().unwrap().unwrap_err(), crate::errors::CANCELED);

        // Not started yet, as while GitHub's still being asked: it never does.
        fetches.release("main", t.path());
        let started = std::time::Instant::now();
        let error = crate::cli::git_unattended_within(t.path(), &silent, Duration::from_secs(20), &second).unwrap_err();
        assert_eq!(error, crate::errors::CANCELED);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn asked_again_for_a_head_github_s_refs_haven_t_caught_up_with_it_isn_t_fetched_again() {
        let github = TempRepo::new("pull-lag-github");
        let base = github.commit(&[("a.txt", Some("1\n"))], "First").to_string();
        let clone = TempRepo::clone_of("pull-lag-clone", &github);
        let fetched = github.commit(&[("b.txt", Some("1\n"))], "Add b").to_string();
        github.repo.reference("refs/pull/7/head", Oid::from_str(&fetched).unwrap(), true, "").unwrap();
        // GitHub says the pull request's at a commit refs/pull/7/head doesn't have yet.
        let said = "1".repeat(40);
        let refs = "refs/recastle/pulls/ada/engine/8";
        assert_eq!(fetch_missing(clone.path(), "origin", refs, 7, &base, &said, FETCH_QUIET_LIMIT, &Arc::default()).unwrap(), fetched);
        // With nowhere to fetch from, asking again would fail if it fetched.
        assert_eq!(fetch_missing(clone.path(), "no-such-remote", refs, 7, &base, &said, FETCH_QUIET_LIMIT, &Arc::default()).unwrap(), fetched);

        // A while after, it's fetched again, by when GitHub's refs will have caught up.
        let memo = (clone.path().to_string(), refs.to_string());
        let long_ago = Instant::now().checked_sub(FETCHED_FOR_WHILE + Duration::from_secs(1)).unwrap();
        FETCHED_FOR.lock().unwrap().get_mut(&memo).unwrap().1 = long_ago;
        assert!(fetch_missing(clone.path(), "no-such-remote", refs, 7, &base, &said, FETCH_QUIET_LIMIT, &Arc::default()).is_err());
    }

    #[test]
    fn names_git_doesn_t_allow_in_a_ref_are_made_ones_it_does() {
        for name in ["engine", ".github", "x.lock", ".x.lock", "a.b-c_d"] {
            let refname = format!("{PULL_REFS}ada/{}/7/head", ref_part(name));
            assert!(git2::Reference::is_valid_name(&refname), "{refname}");
        }
        assert_eq!(ref_part("engine"), "engine");
        assert_eq!(ref_part(".github"), "%2Egithub");
    }

    #[test]
    fn a_shallow_clone_is_refused_rather_than_misread() {
        let github = TempRepo::new("pull-shallow-github");
        github.commit(&[("a.txt", Some("1\n"))], "First");
        github.commit(&[("a.txt", Some("2\n"))], "Second");
        assert!(refuse_shallow(TempRepo::clone_of("pull-shallow-full", &github).path()).is_ok());
        let error = refuse_shallow(TempRepo::shallow_clone_of("pull-shallow", &github).path()).unwrap_err();
        assert!(error.contains("shallow clone"), "{error}");
    }

    // A pull request as GitHub gives it, from `head_repo` into ada/engine.
    fn pull_from(head_repo: Option<&str>) -> Pull {
        let repo = |name: Option<&str>| name.map_or(serde_json::Value::Null, |n| serde_json::json!({ "full_name": n }));
        serde_json::from_value(serde_json::json!({
            "number": 7, "node_id": "PR_1", "title": "Fix", "body": null, "mergeable": null,
            "head": { "ref": "fix", "sha": "1", "label": "grace:fix", "repo": repo(head_repo) },
            "base": { "ref": "main", "sha": "2", "label": "ada:main", "repo": repo(Some("ada/engine")) },
        }))
        .unwrap()
    }

    #[test]
    fn a_fork_s_branch_is_named_with_its_owner() {
        let names = |head_repo| branch_names(&pull_from(head_repo));
        assert_eq!(names(Some("ada/engine")), ("main".into(), "fix".into()));
        // However it's capitalized.
        assert_eq!(names(Some("Ada/Engine")), ("main".into(), "fix".into()));
        assert_eq!(names(Some("grace/engine")), ("main".into(), "grace:fix".into()));
        // A fork that's since been deleted.
        assert_eq!(names(None), ("main".into(), "grace:fix".into()));
    }

    #[test]
    fn what_s_fetched_from_stays_as_it_is_whatever_the_user_s_git_would_make_it() {
        let github = TempRepo::new("pull-instead-github");
        let base = github.commit(&[("a.txt", Some("1\n"))], "First").to_string();
        let clone = TempRepo::clone_of("pull-instead-clone", &github);
        let head = github.commit(&[("b.txt", Some("1\n"))], "Add b").to_string();
        github.repo.reference("refs/pull/7/head", Oid::from_str(&head).unwrap(), true, "").unwrap();
        // As `url."git@github.com:".insteadOf https://github.com/` would, somewhere it can't fetch from.
        let parent = format!("{}/", std::path::Path::new(github.path()).parent().unwrap().display());
        git(clone.path(), &["config", "url./nowhere/.insteadOf", &parent], None).unwrap();

        assert_eq!(fetch_missing(clone.path(), github.path(), REFS, 7, &base, &head, FETCH_QUIET_LIMIT, &Arc::default()).unwrap(), head);
    }

    #[test]
    fn a_token_refused_the_code_is_told_how_to_change_it() {
        assert!(refused("remote: Repository not found.\nfatal: repository 'https://github.com/ada/engine.git/' not found"));
        assert!(refused("fatal: Authentication failed for 'https://github.com/ada/engine.git/'"));
        assert!(refused("fatal: unable to access 'https://github.com/ada/engine.git/': The requested URL returned error: 403"));
        assert!(!refused("fatal: unable to access 'https://github.com/ada/engine.git/': Could not resolve host: github.com"));
    }
}
