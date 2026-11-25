import { shallowRef, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";

// What a changed file's mark shows, as the Working Copy, the Files view and its tabs show
// it: a conflict first, then the unstaged change, then the staged one.

/** A changed file's status, as working_status reads it: "modified", "added", "conflicted" and so on. */
export const statusOf = (file) => (file.conflicted ? "conflicted" : (file.unstaged ?? file.staged));

/** The changed files' statuses, by path. */
export const statusesOf = (files) => new Map(files.map((file) => [file.path, statusOf(file)]));

/**
 * The changed files' statuses, by path, in the repository at `path()`, for the Files
 * view's tree and tabs: from `statusFiles()`, the changed files the tab's last refresh
 * read, or when it didn't, as on coming to the Files view from one that doesn't list
 * them, read here, and again with each `refreshKey()`. Null until they're known, and
 * while `path()` is null.
 */
export function useFileStatuses({ path, statusFiles, refreshKey }) {
  const statuses = shallowRef(null);
  let seq = 0;
  watch(
    [path, statusFiles, refreshKey],
    async ([now], [before] = []) => {
      const asked = ++seq;
      if (now !== before) statuses.value = null;
      if (!now) return;
      const files = statusFiles() ?? (await invoke("working_status", { path: now }).catch(() => null));
      if (asked === seq && files) statuses.value = statusesOf(files);
    },
    { immediate: true },
  );
  return statuses;
}
