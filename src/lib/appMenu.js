// The menu's items for the workspace showing, on macOS (see menu.rs): the Recastle
// menu's About Recastle and Check for Updates… show Recastle's page for them, the top of
// Settings, the second checking as it opens. The File menu's Close Tab, chosen with ⌘W
// in the Files view's editor, closes the file's tab there, as the key does elsewhere
// (see shortcuts.js); App.vue leaves it alone then, going by closesFileTab too. The
// window in front is told which was chosen.
import { onBeforeUnmount } from "vue";
import { inFileEditor } from "./shortcuts.js";
import { checkForUpdates } from "./updates.js";

/** Whether the File menu's Close Tab, chosen now, closes the Files view's file, not the window's tab. */
export const closesFileTab = () => inFileEditor(document.activeElement);

/**
 * Listens on `window` for the menu's items, showing the About page with `showAbout()`,
 * and closing the file showing with `closeFile()`, while `active()`, the workspace
 * calling it is showing.
 */
export function useAppMenu({ window, showAbout, closeFile = () => {}, active = () => true }) {
  const unlisten = window.listen("menu", ({ payload }) => {
    if (!active()) return;
    if (payload === "close-tab" && closesFileTab()) closeFile();
    if (payload === "about") showAbout();
    if (payload === "check-for-updates") {
      showAbout();
      checkForUpdates();
    }
  });
  onBeforeUnmount(() => unlisten.then((stop) => stop()));
}
