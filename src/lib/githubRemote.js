// Which GitHub repositories the open repository's remotes point to, for the Issues
// view. Remotes elsewhere, or behind an SSH host alias, aren't recognized.

// A GitHub remote URL's end: the host, then owner and repository, then any ".git" or
// slash, over HTTPS ("github.com/") or SSH ("github.com:").
const GITHUB_PATH = /(github\.com[:/])([^/]+)\/([^/]+?)((?:\.git)?\/?)$/i;

/** The GitHub repository a remote URL points to, as { owner, repo }, or null. */
export function githubRepoOf(url) {
  const match = url?.match(GITHUB_PATH);
  return match ? { owner: match[2], repo: match[3] } : null;
}

/**
 * A remote URL pointed at the GitHub repository `to` ("owner/repo") instead, as it's
 * moved there, written the same way: over HTTPS or SSH, with or without ".git".
 */
export function movedUrl(url, to) {
  return url.replace(GITHUB_PATH, (_, host, _owner, _repo, end) => `${host}${to}${end}`);
}

/** "owner/repo", the same however it was capitalized. */
export const repoKey = (r) => `${r.owner}/${r.repo}`.toLowerCase();

/**
 * The GitHub repositories the remotes point to, as { owner, repo, remotes }, each
 * once however many remotes share it, with origin's first.
 */
export function githubRemotes(overview) {
  const repos = new Map();
  for (const remote of overview?.remotes ?? []) {
    const found = githubRepoOf(remote.url);
    if (!found) continue;
    const key = repoKey(found);
    if (!repos.has(key)) repos.set(key, { ...found, remotes: [] });
    repos.get(key).remotes.push(remote.name);
  }
  const hasOrigin = (r) => r.remotes.includes("origin");
  return [...repos.values()].sort((a, b) => hasOrigin(b) - hasOrigin(a));
}

/** The remote that points to the GitHub repository `fullName` ("owner/repo"), if any. */
export function githubRemoteOf(remotes, fullName) {
  if (!fullName) return undefined;
  return remotes.find((remote) => {
    const found = githubRepoOf(remote.url);
    return found && repoKey(found) === fullName.toLowerCase();
  });
}
