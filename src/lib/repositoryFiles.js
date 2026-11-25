import { invoke } from "@tauri-apps/api/core";

// Each repository's files, as the toolbar's search finds them and Ctrl+click goes to
// them (see tracked_files): read once, when first wanted, and again when wanted after a
// refresh. Until the new list's read, the last is kept, so what's found by it doesn't
// come and go with every save. A list that can't be read is empty until the next refresh.

// By repository path and whether untracked files are in it: { files, loading, stale },
// `files` the list last read or null, `loading` its reading under way or null, and
// `stale` whether a refresh has happened since.
const lists = new Map();

const keyOf = (path, untracked) => `${untracked ? "all" : "tracked"}\n${path}`;

// The list for `path`, read now if there's none or it's stale, and not already being read.
function entryFor(path, untracked) {
  const key = keyOf(path, untracked);
  let entry = lists.get(key);
  if (!entry) lists.set(key, (entry = { files: null, loading: null, stale: true }));
  if (entry.stale && !entry.loading) {
    entry.stale = false;
    const loading = invoke("tracked_files", { path, untracked })
      .catch(() => entry.files ?? [])
      .then((files) => {
        // A refresh since asked for another, which may have started: this one's older.
        if (entry.loading === loading) {
          entry.files = files;
          entry.loading = null;
        }
        return files;
      });
    entry.loading = loading;
  }
  return entry;
}

/**
 * The files in the repository at `path`, with `untracked` those git doesn't track too
 * (new ones, and ignored ones such as .env), as the Files view shows them: the list as
 * last read, or once it's been read again since a refresh, the new one.
 */
export function repositoryFiles(path, { untracked = false } = {}) {
  const entry = entryFor(path, untracked);
  return entry.loading ?? Promise.resolve(entry.files);
}

/** The files as repositoryFiles last read them, or null before they've been read; reading them if they're stale. */
export const knownFiles = (path, { untracked = false } = {}) => entryFor(path, untracked).files;

/** Marks the repository at `path`'s files as changed, as on a refresh, to be read again when next wanted. */
export function filesChanged(path) {
  for (const untracked of [false, true]) {
    const entry = lists.get(keyOf(path, untracked));
    if (!entry) continue;
    entry.stale = true;
    // Whatever's being read may be from before it.
    entry.loading = null;
  }
}
