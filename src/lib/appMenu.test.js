import { beforeEach, expect, test, vi } from "vitest";
import { mountComposable } from "../test/mount.js";
import { useAppMenu } from "./appMenu.js";
import { checkForUpdates } from "./updates.js";

vi.mock("./updates.js", () => ({ checkForUpdates: vi.fn() }));

let chosen;
const stop = vi.fn();
const window = { listen: vi.fn(async (event, handler) => ((chosen = (payload) => handler({ payload })), stop)) };
beforeEach(() => vi.clearAllMocks());

test("About Recastle shows the About page, and Check for Updates checks there too", async () => {
  const showAbout = vi.fn();
  const { unmount } = mountComposable(() => useAppMenu({ window, showAbout }));
  expect(window.listen).toHaveBeenCalledWith("menu", expect.any(Function));
  chosen("about");
  expect(showAbout).toHaveBeenCalledTimes(1);
  expect(checkForUpdates).not.toHaveBeenCalled();
  chosen("check-for-updates");
  expect(showAbout).toHaveBeenCalledTimes(2);
  expect(checkForUpdates).toHaveBeenCalledTimes(1);
  unmount();
  await Promise.resolve();
  expect(stop).toHaveBeenCalled();
});

test("Close Tab closes the file's tab with the keys in the Files view's editor, and otherwise leaves it", () => {
  const closeFile = vi.fn();
  const { unmount } = mountComposable(() => useAppMenu({ window, showAbout: vi.fn(), closeFile }));
  chosen("close-tab");
  expect(closeFile).not.toHaveBeenCalled();
  const editor = document.createElement("div");
  editor.className = "cm-editor";
  const content = document.createElement("div");
  content.tabIndex = 0;
  editor.append(content);
  document.body.append(editor);
  content.focus();
  chosen("close-tab");
  expect(closeFile).toHaveBeenCalledTimes(1);
  editor.remove();
  unmount();
});

test("the menu's items go to the workspace showing only", () => {
  const showAbout = vi.fn();
  let showing = false;
  const { unmount } = mountComposable(() => useAppMenu({ window, showAbout, active: () => showing }));
  chosen("check-for-updates");
  expect(showAbout).not.toHaveBeenCalled();
  expect(checkForUpdates).not.toHaveBeenCalled();
  showing = true;
  chosen("about");
  expect(showAbout).toHaveBeenCalledTimes(1);
  unmount();
});
