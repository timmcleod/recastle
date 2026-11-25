import { nextTick, reactive } from "vue";
import { finishSaving, forgetEdits, isUnsaved, markUnsaved } from "./editing.js";
import { losses, quoted } from "./losses.js";
import { askConfirm } from "./overlays.js";
import { settings } from "./settings.js";
import { onSavedElsewhere, readJson, writeJson } from "./storage.js";

// The Files view's tabs, opened as a code editor opens them: each file gets a tab of its
// own, just right of the one showing, or its tab shows if it has one. No more than
// MOST_TABS stay open: another closes the one used longest ago, not one that's pinned,
// or that has edits that aren't saved. Pinned tabs come first, and are closed only one at a time.
// One tab always shows while there are any: closing the tab showing shows the one shown
// before it. Each repository's are kept, to open again as they were with it.

export const MOST_TABS = 10;

// Saved by repository path, the most recently changed last, each with when it was
// (`at`); no more are kept than this.
const KEY = "recastle.fileTabs";
const MOST_KEPT = 200;

// Each repository's tabs, by path: { files, active, pinned, used, at }, with `files` in
// order, `active` the file showing, null only with none, `pinned` those pinned, `used`
// the files in the order they were last shown, the most recent last, and `at` when they
// last changed.
const byRepo = reactive({});

/** The tabs of the repository at `path`, as they were left. */
export function fileTabs(path) {
  if (!byRepo[path]) byRepo[path] = restored(readJson(KEY, {})[path]);
  return byRepo[path];
}

/** The file showing in the repository at `path`, or null with no tabs open. */
export const shownFile = (path) => fileTabs(path).active;

// Tabs as saved, tidied, since what's saved may be from an older version or damaged.
function restored(saved) {
  const pinned = names(saved?.pinned).filter((file) => names(saved?.files).includes(file));
  const files = [...pinned, ...names(saved?.files).filter((file) => !pinned.includes(file))];
  const used = names(saved?.used).filter((file) => files.includes(file));
  return {
    files,
    active: files.includes(saved?.active) ? saved.active : (used.at(-1) ?? files[0] ?? null),
    pinned,
    used,
    at: Number.isFinite(saved?.at) ? saved.at : 0,
  };
}

const names = (list) => (Array.isArray(list) ? [...new Set(list.filter((name) => typeof name === "string" && name))] : []);

// Saves the tabs of the repository at `path`, as changed now, or saves them again as
// they were changed `at`. Kept with none, until there are too many, for when they
// changed to be known.
function remember(path, at = null) {
  const tabs = fileTabs(path);
  // Later each time, though the clock isn't.
  tabs.at = at ?? Math.max(Date.now(), tabs.at + 1);
  const { files, active, pinned, used } = tabs;
  const all = readJson(KEY, {});
  delete all[path];
  all[path] = { files, active, pinned, used, at: tabs.at };
  const paths = Object.keys(all);
  for (const old of paths.slice(0, Math.max(0, paths.length - MOST_KEPT))) delete all[old];
  writeJson(KEY, all);
}

// Every window saves every repository's tabs, as one value: those another window saved
// are taken in, by when each changed. One changed there since here takes their change.
// One changed here since, as when two windows save at once, the other's carrying what it
// had of this one's, is saved again, so both end up with the latest.
onSavedElsewhere((key, all) => {
  if (key !== KEY) return;
  for (const path of Object.keys(byRepo)) {
    const theirs = all?.[path]?.at ?? 0;
    if (theirs > byRepo[path].at) byRepo[path] = restored(all[path]);
    else if (theirs < byRepo[path].at) remember(path, byRepo[path].at);
  }
});

function show(tabs, file) {
  tabs.active = file;
  if (file) tabs.used = [...tabs.used.filter((f) => f !== file), file];
}

// Takes `gone` out of the tabs, with no asking. The tab showing gone, the one shown
// before it shows, or with none, as for tabs restored, the one that's taken its place.
function drop(tabs, gone) {
  const index = tabs.files.indexOf(tabs.active);
  const keep = (file) => !gone.includes(file);
  tabs.files = tabs.files.filter(keep);
  tabs.pinned = tabs.pinned.filter(keep);
  tabs.used = tabs.used.filter(keep);
  if (keep(tabs.active)) return;
  tabs.active = tabs.used.at(-1) ?? tabs.files[Math.min(index, tabs.files.length - 1)] ?? null;
}

/**
 * Shows `file` in the repository at `path`: its tab, opening one just right of the tab
 * showing if it has none, and closing the one used longest ago if that's too many.
 */
export function openTab(path, file) {
  const tabs = fileTabs(path);
  if (!tabs.files.includes(file)) {
    const at = Math.max(tabs.files.indexOf(tabs.active) + 1, tabs.pinned.length);
    tabs.files.splice(at, 0, file);
  }
  show(tabs, file);
  while (tabs.files.length > MOST_TABS) {
    const closable = tabs.files.filter((f) => f !== tabs.active && !tabs.pinned.includes(f) && !isUnsaved(path, f));
    if (!closable.length) break;
    // Never shown, as a tab restored and not shown since, counts as longest ago.
    const used = (f) => tabs.used.indexOf(f);
    drop(tabs, [closable.reduce((oldest, f) => (used(f) < used(oldest) ? f : oldest))]);
  }
  remember(path);
}

/**
 * Closes the tabs of `files` in the repository at `path`. Their edits are saved first
 * when saving automatically; any that aren't, closing asks about, as it loses them.
 * Resolves to whether they closed.
 */
export async function closeTabs(path, files) {
  files = files.filter((file) => fileTabs(path).files.includes(file));
  if (!files.length) return false;
  if (settings.autoSave) await finishSaving();
  const edited = files.filter((file) => isUnsaved(path, file));
  if (edited.length) {
    const [message] = losses({ edited: edited.map((file) => quoted(file.split("/").pop())), doing: "Closing" });
    const title = files.length === 1 ? "Close File?" : "Close Files?";
    if (!(await askConfirm({ title, message, confirmLabel: "Close", danger: true }))) return false;
  }
  // Not saved, now, so the editor letting go of the file it shows doesn't save them after
  // all, as it does with edits, saving automatically, when one that failed is retried.
  for (const file of edited) markUnsaved(path, file, false);
  drop(fileTabs(path), files);
  remember(path);
  // Once the editor has let go of the file it was showing, which it keeps with its edits.
  await nextTick();
  for (const file of edited) forgetEdits(path, file);
  return true;
}

const within = (file, folder) => file === folder || file.startsWith(`${folder}/`);

/** Closes the tab of `file`, deleted, or of anything in it if it's a folder, with no asking. */
export function closeDeleted(path, file) {
  const tabs = fileTabs(path);
  drop(tabs, tabs.files.filter((f) => within(f, file)));
  remember(path);
}

/** Follows `from` renamed to `to`, or the files in it if it's a folder. */
export function renameInTabs(path, from, to) {
  const tabs = fileTabs(path);
  const moved = (file) => (file && within(file, from) ? to + file.slice(from.length) : file);
  tabs.files = tabs.files.map(moved);
  tabs.pinned = tabs.pinned.map(moved);
  tabs.used = tabs.used.map(moved);
  tabs.active = moved(tabs.active);
  remember(path);
}

/** Pins `file`'s tab, putting it after those pinned already, or unpins it, putting it after those left pinned. */
export function pinTab(path, file, pin) {
  const tabs = fileTabs(path);
  if (!tabs.files.includes(file) || pin === tabs.pinned.includes(file)) return;
  tabs.pinned = pin ? [...tabs.pinned, file] : tabs.pinned.filter((f) => f !== file);
  const others = tabs.files.filter((f) => f !== file);
  others.splice(tabs.pinned.length - (pin ? 1 : 0), 0, file);
  tabs.files = others;
  remember(path);
}

/** Moves `file`'s tab to `to` among them, as dragged there, staying among the pinned or the others. */
export function moveTab(path, file, to) {
  const tabs = fileTabs(path);
  if (!tabs.files.includes(file)) return;
  const pinned = tabs.pinned.length;
  const [first, last] = tabs.pinned.includes(file) ? [0, pinned - 1] : [pinned, tabs.files.length - 1];
  const others = tabs.files.filter((f) => f !== file);
  others.splice(Math.min(Math.max(to, first), last), 0, file);
  tabs.files = others;
  remember(path);
}

/**
 * The tabs a tab's menu closes, from that of `file`: "others", those to its "left" or
 * "right", "all", or "unmodified", those whose files have no changes, `changed(file)`
 * saying which do, and no edits that aren't saved. Never those pinned.
 */
export function tabsToClose(path, file, which, changed = () => false) {
  const { files, pinned } = fileTabs(path);
  const at = files.indexOf(file);
  const picks = {
    others: (f) => f !== file,
    left: (_, i) => i < at,
    right: (_, i) => i > at,
    all: () => true,
    unmodified: (f) => !changed(f) && !isUnsaved(path, f),
  };
  return files.filter((f, i) => !pinned.includes(f) && picks[which](f, i));
}

/**
 * What each of `files`' tabs is called, by file: its name, or with another's of the
 * same name, as many of the folders it's in before it as tell them apart.
 */
export function tabLabels(files) {
  const parts = new Map(files.map((file) => [file, file.split("/")]));
  const depth = new Map(files.map((file) => [file, 1]));
  const label = (file) => parts.get(file).slice(-depth.get(file)).join("/");
  for (;;) {
    const count = new Map();
    for (const file of files) count.set(label(file), (count.get(label(file)) ?? 0) + 1);
    const clashing = files.filter((file) => count.get(label(file)) > 1);
    // Each takes another folder, while it has one; a clash none can tell apart stays.
    const deeper = clashing.filter((file) => depth.get(file) < parts.get(file).length);
    if (!deeper.length) return new Map(files.map((file) => [file, label(file)]));
    for (const file of deeper) depth.set(file, depth.get(file) + 1);
  }
}
