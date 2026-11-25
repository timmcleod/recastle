import { nextTick, onBeforeUnmount, reactive, watch } from "vue";
import { splitKey } from "./sidebarKeys.js";

// Back and Forward, like a browser's: each place is a sidebar item with the commit,
// stash and file filter chosen there. Choosing something new starts a new place; Back
// and Forward return to them. Places quickly replaced by others in the same view
// (arrowing through the history, say) aren't kept, so Back doesn't step through every
// one.

const MAX_PLACES = 100;
const QUICK_CHANGE = 800;

/**
 * `view` holds the refs that make up where the user is, which going Back or Forward
 * sets: selected (the sidebar item's key), selectedCommit, selectedStash, fileFilter,
 * detailMode, treeFile, treeReveal and comparison. treeReveal is only set: it's the
 * file a commit's Files tab opens on arrival. fileShown() is the file open in the Files
 * view while it's shown, and showFile(file) opens one there; fileLine() is the line its
 * cursor's on, or null, and showLine(file, line) shows that line of it, once it's open.
 * overview is the repository overview ref; places are only kept while a repository is
 * open.
 *
 * Returns nav ({ back, forward }, the places either way, newest last), go(direction),
 * jump(change), describe(place) for the buttons' tooltips, and forget(), for when another
 * repository opens.
 */
export function useNavigation({
  overview,
  view,
  fileShown,
  showFile,
  fileLine = () => null,
  showLine = () => {},
  active = () => true,
}) {
  const { selected, selectedCommit, selectedStash, fileFilter, detailMode, treeFile, treeReveal, comparison } = view;
  const nav = reactive({ back: [], forward: [] });
  let here = null;
  let hereSince = 0;
  let restoring = false;

  const placeHere = () => ({
    selected: selected.value,
    commit: selectedCommit.value,
    stash: selectedStash.value,
    fileFilter: fileFilter.value,
    detailMode: detailMode.value,
    treeFile: treeFile.value,
    comparison: comparison.value,
    file: fileShown(),
  });

  const samePlace = (a, b) =>
    a.selected === b.selected &&
    a.commit?.id === b.commit?.id &&
    a.stash === b.stash &&
    a.fileFilter === b.fileFilter &&
    a.detailMode === b.detailMode &&
    a.treeFile === b.treeFile &&
    a.comparison === b.comparison &&
    a.file === b.file;

  watch([selected, () => selectedCommit.value?.id, selectedStash, fileFilter, detailMode, treeFile, comparison, fileShown], () => {
    if (restoring || !overview.value) return;
    const place = placeHere();
    if (here && samePlace(here, place)) return;
    const quick = here && here.selected === place.selected && Date.now() - hereSince < QUICK_CHANGE;
    if (here && !quick) {
      // Left by another file or view, its line is no longer known here, as the cursor may
      // have moved since it was gone to: the Files view shows the file where it was left.
      nav.back.push({ ...here, line: null });
      if (nav.back.length > MAX_PLACES) nav.back.shift();
    }
    here = place;
    hereSince = Date.now();
    nav.forward = [];
  });

  // A place in the Files view keeps the line its file's cursor is on as it's left, by
  // Back, Forward or a jump, to come back to it there.
  function leaving(place) {
    if (place.file && place.file === fileShown()) place.line = fileLine();
    return place;
  }

  /**
   * Goes somewhere, by `change()`, to `file` at `line` in the Files view, as a definition
   * gone to, as a place of its own, though it's in the same file, for Back to come back
   * to the line it was gone to from.
   */
  function jump(change, file, line) {
    if (!overview.value) return change();
    const from = leaving(here ?? placeHere());
    nav.back.push(from);
    if (nav.back.length > MAX_PLACES) nav.back.shift();
    nav.forward = [];
    change();
    here = { ...placeHere(), file, line };
    hereSince = Date.now();
  }

  async function go(direction) {
    const [from, to] = direction === "back" ? [nav.back, nav.forward] : [nav.forward, nav.back];
    const place = from.pop();
    if (!place) return;
    if (here) to.push(leaving(here));
    here = place;
    hereSince = 0;
    restoring = true;
    selected.value = place.selected;
    selectedCommit.value = place.commit;
    selectedStash.value = place.stash;
    fileFilter.value = place.fileFilter;
    detailMode.value = place.detailMode;
    treeFile.value = place.treeFile;
    treeReveal.value = place.treeFile;
    comparison.value = place.comparison;
    // The file it had open, or none, where the Files view is shown: what showing none
    // means is showFile's. Elsewhere both are null, and the Files view keeps its file.
    if (place.file !== fileShown()) showFile(place.file);
    if (place.file && place.line != null) showLine(place.file, place.line);
    // Let the views settle (opening a stash's view picks one, say) before recording again.
    await nextTick();
    await nextTick();
    restoring = false;
  }

  // Places belong to a repository.
  function forget() {
    nav.back = [];
    nav.forward = [];
    here = null;
  }

  // Mice with back and forward buttons report them as buttons 3 and 4, in the workspace
  // showing.
  function onMouseup(event) {
    if (active() && (event.button === 3 || event.button === 4)) {
      event.preventDefault();
      go(event.button === 3 ? "back" : "forward");
    }
  }
  window.addEventListener("mouseup", onMouseup);
  onBeforeUnmount(() => window.removeEventListener("mouseup", onMouseup));

  return { nav, go, jump, describe, forget };
}

// A short description of a place, for the buttons' tooltips.
export function describe(place) {
  if (!place) return "";
  const [kind, name] = splitKey(place.selected);
  const view = {
    "workspace:working-copy": "Working Copy",
    "workspace:files": "Files",
    "workspace:stashes": "Stashes",
    "workspace:issues": "Issues",
    "workspace:pulls": "Pull Requests",
    "workspace:github": "GitHub",
    "workspace:settings": "Settings",
    "workspace:history": "History",
    "workspace:compare": place.comparison && `${place.comparison.head} with ${place.comparison.base}`,
  }[place.selected] ?? name ?? kind;
  const detail =
    place.commit?.short_id ??
    place.file?.split("/").pop() ??
    (place.selected === "workspace:stashes" && place.stash != null ? `stash@{${place.stash}}` : "");
  return [view, detail].filter(Boolean).join(" › ");
}
