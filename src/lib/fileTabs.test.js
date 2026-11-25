import { beforeEach, describe, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { askConfirm } from "./overlays.js";
import { settings } from "./settings.js";
import { finishSaving, forgetEdits, isUnsaved, markUnsaved } from "./editing.js";
import { readJson, writeJson } from "./storage.js";

// storage.js listens for Recastle's other windows' saves as it loads: `saved` sends one.
const saved = vi.hoisted(() => ({ send: null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_, handler) => {
    saved.send = (values) => handler({ payload: { window: "other", values } });
    return () => {};
  }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "main" }) }));
vi.mock("./overlays.js", () => ({ askConfirm: vi.fn() }));
vi.mock("./settings.js", () => ({ settings: { autoSave: false } }));
vi.mock("./editing.js", () => ({ finishSaving: vi.fn(), forgetEdits: vi.fn(), isUnsaved: vi.fn(() => false), markUnsaved: vi.fn() }));

const { closeDeleted, closeTabs, fileTabs, MOST_TABS, moveTab, openTab, pinTab, renameInTabs, tabLabels, tabsToClose } = await import("./fileTabs.js");

// Each test has a repository of its own, as the tabs are kept by path.
let repo = 0;
let path;
beforeEach(() => {
  path = `/code/repo${++repo}`;
  vi.mocked(invoke).mockReset();
  vi.mocked(askConfirm).mockReset();
  vi.mocked(finishSaving).mockReset();
  vi.mocked(forgetEdits).mockReset();
  vi.mocked(markUnsaved).mockReset();
  vi.mocked(isUnsaved).mockReset().mockReturnValue(false);
  settings.autoSave = false;
});

const open = (...files) => files.forEach((file) => openTab(path, file));
const files = () => fileTabs(path).files;
const active = () => fileTabs(path).active;

describe("opening a file", () => {
  test("gives it a tab just right of the one showing, and shows it", () => {
    open("a.js", "b.js");
    openTab(path, "a.js");
    openTab(path, "c.js");
    expect(files()).toEqual(["a.js", "c.js", "b.js"]);
    expect(active()).toBe("c.js");
  });

  test("open already, shows its tab, rather than opening another", () => {
    open("a.js", "b.js", "a.js");
    expect(files()).toEqual(["a.js", "b.js"]);
    expect(active()).toBe("a.js");
  });

  test("one too many closes the tab used longest ago", () => {
    const many = Array.from({ length: MOST_TABS }, (_, i) => `f${i}.js`);
    open(...many);
    openTab(path, "f0.js");
    openTab(path, "new.js");
    expect(files()).toHaveLength(MOST_TABS);
    expect(files()).not.toContain("f1.js");
    expect(files()).toContain("f0.js");
  });

  test("one too many leaves those pinned, and those with edits not saved", () => {
    const many = Array.from({ length: MOST_TABS }, (_, i) => `f${i}.js`);
    open(...many);
    pinTab(path, "f0.js", true);
    vi.mocked(isUnsaved).mockImplementation((_, file) => file === "f1.js");
    openTab(path, "new.js");
    expect(files()).toContain("f0.js");
    expect(files()).toContain("f1.js");
    expect(files()).not.toContain("f2.js");
  });

  test("with every other tab kept, one too many stays open", () => {
    vi.mocked(isUnsaved).mockReturnValue(true);
    open(...Array.from({ length: MOST_TABS + 1 }, (_, i) => `f${i}.js`));
    expect(files()).toHaveLength(MOST_TABS + 1);
  });

});

describe("closing tabs", () => {
  test("the one showing shows the one shown before it", async () => {
    open("a.js", "b.js", "c.js");
    openTab(path, "a.js");
    openTab(path, "c.js");
    await closeTabs(path, ["c.js"]);
    expect(files()).toEqual(["a.js", "b.js"]);
    expect(active()).toBe("a.js");
  });

  test("another leaves the one showing", async () => {
    open("a.js", "b.js");
    expect(await closeTabs(path, ["a.js"])).toBe(true);
    expect(active()).toBe("b.js");
  });

  test("the last shows none", async () => {
    open("a.js");
    await closeTabs(path, ["a.js"]);
    expect(files()).toEqual([]);
    expect(active()).toBeNull();
  });

  test("saves first when saving automatically", async () => {
    settings.autoSave = true;
    open("a.js");
    await closeTabs(path, ["a.js"]);
    expect(finishSaving).toHaveBeenCalled();
    expect(askConfirm).not.toHaveBeenCalled();
  });

  test("with edits not saved asks, and closing loses them", async () => {
    open("a.js", "src/b.js");
    vi.mocked(isUnsaved).mockImplementation((_, file) => file === "src/b.js");
    vi.mocked(askConfirm).mockResolvedValue(true);
    expect(await closeTabs(path, ["a.js", "src/b.js"])).toBe(true);
    expect(vi.mocked(askConfirm).mock.calls[0][0]).toMatchObject({ title: "Close Files?", message: "Edits to “b.js” aren't saved. Closing loses them." });
    expect(files()).toEqual([]);
    expect(forgetEdits).toHaveBeenCalledWith(path, "src/b.js");
    // Before the editor lets go of it, which would otherwise save them, saving automatically.
    expect(markUnsaved).toHaveBeenCalledWith(path, "src/b.js", false);
    expect(forgetEdits).not.toHaveBeenCalledWith(path, "a.js");
  });

  test("with edits not saved, said not to, leaves them open", async () => {
    open("a.js");
    vi.mocked(isUnsaved).mockReturnValue(true);
    vi.mocked(askConfirm).mockResolvedValue(false);
    expect(await closeTabs(path, ["a.js"])).toBe(false);
    expect(files()).toEqual(["a.js"]);
    expect(forgetEdits).not.toHaveBeenCalled();
  });

  test("a tab's menu closes others, to either side, all or the unmodified, never those pinned", () => {
    open("p.js", "a.js", "b.js", "c.js", "d.js");
    pinTab(path, "p.js", true);
    expect(tabsToClose(path, "b.js", "others")).toEqual(["a.js", "c.js", "d.js"]);
    expect(tabsToClose(path, "b.js", "left")).toEqual(["a.js"]);
    expect(tabsToClose(path, "b.js", "right")).toEqual(["c.js", "d.js"]);
    expect(tabsToClose(path, "b.js", "all")).toEqual(["a.js", "b.js", "c.js", "d.js"]);
    vi.mocked(isUnsaved).mockImplementation((_, file) => file === "d.js");
    expect(tabsToClose(path, "b.js", "unmodified", (file) => file === "a.js")).toEqual(["b.js", "c.js"]);
  });
});

describe("pinning and moving tabs", () => {
  test("pinned tabs come first, in the order pinned, and unpinned go after them", () => {
    open("a.js", "b.js", "c.js");
    pinTab(path, "c.js", true);
    pinTab(path, "b.js", true);
    expect(files()).toEqual(["c.js", "b.js", "a.js"]);
    pinTab(path, "c.js", false);
    expect(files()).toEqual(["b.js", "c.js", "a.js"]);
  });

  test("a file opened from a pinned tab opens after them", () => {
    open("a.js", "b.js");
    pinTab(path, "a.js", true);
    openTab(path, "a.js");
    openTab(path, "c.js");
    expect(files()).toEqual(["a.js", "c.js", "b.js"]);
  });

  test("a tab dragged stays among the pinned, or among the others", () => {
    open("a.js", "b.js", "c.js");
    pinTab(path, "a.js", true);
    moveTab(path, "c.js", 0);
    expect(files()).toEqual(["a.js", "c.js", "b.js"]);
    moveTab(path, "a.js", 2);
    expect(files()).toEqual(["a.js", "c.js", "b.js"]);
    moveTab(path, "c.js", 2);
    expect(files()).toEqual(["a.js", "b.js", "c.js"]);
  });
});

describe("files changed in the Files view", () => {
  test("deleted, close, with what was in a folder", () => {
    open("src/a.js", "src/b.js", "c.js");
    openTab(path, "src/a.js");
    closeDeleted(path, "src");
    expect(files()).toEqual(["c.js"]);
    expect(active()).toBe("c.js");
  });

  test("renamed, keep their tabs, pinned or showing", () => {
    open("src/a.js", "b.js");
    pinTab(path, "src/a.js", true);
    openTab(path, "src/a.js");
    renameInTabs(path, "src", "lib");
    expect(files()).toEqual(["lib/a.js", "b.js"]);
    expect(fileTabs(path).pinned).toEqual(["lib/a.js"]);
    expect(active()).toBe("lib/a.js");
  });
});

describe("kept for the next time", () => {
  test("the tabs are saved by repository", () => {
    open("a.js", "b.js");
    expect(readJson("recastle.fileTabs", {})[path]).toEqual({ files: ["a.js", "b.js"], active: "b.js", pinned: [], used: ["a.js", "b.js"], at: expect.any(Number) });
  });

  test("saved tabs from an older version or damaged open what they can", () => {
    writeJson("recastle.fileTabs", { "/code/saved": { files: ["a.js", 3, "b.js", "a.js"], active: "gone.js", pinned: ["b.js", "x.js"] } });
    // The file that was showing gone, the first shows.
    expect(fileTabs("/code/saved")).toEqual({ files: ["b.js", "a.js"], active: "b.js", pinned: ["b.js"], used: [], at: 0 });
  });

  test("restored, the tab shown last shows, where the one showing is gone", () => {
    writeJson("recastle.fileTabs", { "/code/used": { files: ["a.js", "b.js"], active: "gone.js", used: ["b.js", "a.js"] } });
    expect(fileTabs("/code/used").active).toBe("a.js");
  });

  test("a repository with none keeps when they changed, for another window to go by", async () => {
    open("a.js");
    await closeTabs(path, ["a.js"]);
    expect(readJson("recastle.fileTabs", {})[path]).toMatchObject({ files: [], active: null });
  });
});

describe("another window's saves", () => {
  test("take in a repository's tabs changed there since", () => {
    open("a.js");
    const at = fileTabs(path).at;
    saved.send({ "recastle.fileTabs": { [path]: { files: ["b.js"], active: "b.js", pinned: [], used: ["b.js"], at: at + 1 } } });
    expect(files()).toEqual(["b.js"]);
  });

  test("carrying an older copy of one changed here keep this one's, and save it again", () => {
    open("a.js", "b.js");
    const at = fileTabs(path).at;
    saved.send({ "recastle.fileTabs": { [path]: { files: ["a.js"], active: "a.js", pinned: [], used: ["a.js"], at: at - 1 } } });
    expect(files()).toEqual(["a.js", "b.js"]);
    expect(readJson("recastle.fileTabs", {})[path]).toMatchObject({ files: ["a.js", "b.js"], at });
  });
});

test("a tab is called by its file's name, with as many folders as tell it from another's of the same name", () => {
  expect(tabLabels(["src/index.js", "lib/index.js", "README.md", "index.js"])).toEqual(
    new Map([
      ["src/index.js", "src/index.js"],
      ["lib/index.js", "lib/index.js"],
      ["README.md", "README.md"],
      ["index.js", "index.js"],
    ]),
  );
  expect(tabLabels(["a/src/x.js", "b/src/x.js", "c/lib/x.js"])).toEqual(
    new Map([
      ["a/src/x.js", "a/src/x.js"],
      ["b/src/x.js", "b/src/x.js"],
      ["c/lib/x.js", "lib/x.js"],
    ]),
  );
});
