import { reactive, shallowRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { folderName } from "./format.js";

// What the Files view is editing: edits that aren't saved yet, kept while moving
// between files, views and repositories, the way commit message drafts are. Quitting
// with any asks first (see quit.rs). The files open in it are its tabs' (fileTabs.js).

// Whether the next file opened takes the keys. Asked for by what opens a file to write
// in, such as New File or the search; opened from the tree, the keys stay in the tree.
// A request that no file opens for, as when the file was open already, soon lapses.
let focusAskedAt = 0;
export const focusOnOpen = () => (focusAskedAt = Date.now());
export function takeFocusRequest() {
  const wanted = Date.now() - focusAskedAt < 1000;
  focusAskedAt = 0;
  return wanted;
}

// Images to edit as text instead, such as SVGs, as keys from keyFor.
export const asText = reactive(new Set());

// Files with edits that aren't saved, as keys from keyFor.
export const unsaved = reactive(new Set());

// The editor for each of those files as it was left: key -> { state, saved, base },
// with `saved` the text as last saved or read and `base` what it was read with
// ({ version, crlf, bom }). Not reactive: CodeMirror's states are kept as they are.
export const buffers = new Map();

// Saves under way, and what starts saving the files open in editors now: for quitting
// to finish saving first, when saving automatically.
export const savesUnderWay = new Set();
export const openEditors = new Set();

/** Saves what's open in editors, and waits for every save under way to finish. */
export async function finishSaving() {
  for (const save of openEditors) save();
  while (savesUnderWay.size) await Promise.allSettled([...savesUnderWay]);
}

export const keyFor = (path, file) => `${path}\n${file}`;

// Where each file's cursor was left, to come back to there, as an editor does: key ->
// { anchor, head }. Not kept once Recastle quits.
export const positions = new Map();

// A line to show in a file as it opens, or in the file showing, as on going to a
// definition there, or back to where one was gone to from: { key, line }, or null.
export const lineRequest = shallowRef(null);

/** Shows `line` of `file`, in the repository at `path`, once it's open in the Files view. */
export const requestLine = (path, file, line) => (lineRequest.value = { key: keyFor(path, file), line });

/** Whether `file` in the repository at `path` has edits that aren't saved. */
export const isUnsaved = (path, file) => unsaved.has(keyFor(path, file));

/**
 * Notes whether the file has edits that aren't saved, and tells Recastle which files
 * have, so quitting from another window can name them.
 */
export function markUnsaved(path, file, dirty) {
  const key = keyFor(path, file);
  if (dirty === unsaved.has(key)) return;
  if (dirty) unsaved.add(key);
  else unsaved.delete(key);
  const files = unsavedFiles().map((f) => ({ path: f.path, described: `“${f.file.split("/").pop()}” in ${folderName(f.path)}` }));
  invoke("set_unsaved_edits", { files }).catch(() => {});
}

/** Drops the edits not saved to `file`, or to anything in it if it's a folder, as when it's deleted, and where its cursor was left. */
export function forgetEdits(path, file) {
  forgetWhere((repo, edited) => repo === path && (edited === file || edited.startsWith(`${file}/`)));
}

// Drops the edits not saved to each file `which(repo, file)` picks, and where its cursor
// was left.
function forgetWhere(which) {
  for (const key of [...unsaved, ...buffers.keys(), ...positions.keys()]) {
    const [repo, edited] = key.split("\n");
    if (!which(repo, edited)) continue;
    buffers.delete(key);
    positions.delete(key);
    markUnsaved(repo, edited, false);
  }
}

/** Drops the edits not saved in the repository at `path`, as when its tab closes, and where cursors were left. */
export function forgetEditsIn(path) {
  forgetWhere((repo) => repo === path);
}

/**
 * Moves the edits not saved to `from`, or to anything in it if it's a folder, as when
 * it's renamed to `to`, and where its cursor was left.
 */
export function renameEdits(path, from, to) {
  const moved = (file) => (file === from ? to : file.startsWith(`${from}/`) ? to + file.slice(from.length) : null);
  for (const key of [...new Set([...unsaved, ...buffers.keys(), ...positions.keys()])]) {
    const [repo, edited] = key.split("\n");
    const renamed = repo === path && moved(edited);
    if (!renamed) continue;
    for (const kept of [buffers, positions]) {
      if (!kept.has(key)) continue;
      kept.set(keyFor(repo, renamed), kept.get(key));
      kept.delete(key);
    }
    if (unsaved.has(key)) {
      markUnsaved(repo, edited, false);
      markUnsaved(repo, renamed, true);
    }
  }
}

/** The files with edits that aren't saved, as { path, file }. */
export const unsavedFiles = () =>
  [...unsaved].map((key) => {
    const [path, file] = key.split("\n");
    return { path, file };
  });
