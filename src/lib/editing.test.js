import { beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

const { buffers, forgetEdits, forgetEditsIn, keyFor, markUnsaved, positions, renameEdits, unsavedFiles } = await import("./editing.js");

beforeEach(() => vi.mocked(invoke).mockClear());

test("Recastle is told the files with edits not saved, each with the repository it's in", () => {
  markUnsaved("/code/recastle", "src/App.vue", true);
  expect(vi.mocked(invoke).mock.calls.at(-1)).toEqual(["set_unsaved_edits", { files: [{ path: "/code/recastle", described: "“App.vue” in recastle" }] }]);
  markUnsaved("/code/recastle", "src/App.vue", false);
});

test("a repository's tab closing lets go of its edits not saved, and no other's", () => {
  markUnsaved("/code/a", "one.txt", true);
  markUnsaved("/code/a", "src/two.txt", true);
  markUnsaved("/code/b", "three.txt", true);
  buffers.set(keyFor("/code/a", "one.txt"), "edited");
  forgetEditsIn("/code/a");
  expect(unsavedFiles()).toEqual([{ path: "/code/b", file: "three.txt" }]);
  expect(buffers.has(keyFor("/code/a", "one.txt"))).toBe(false);
  forgetEditsIn("/code/b");
});

test("where a file's cursor was left follows it renamed, and goes with it deleted or its repository's tab closed", () => {
  const at = { anchor: 5, head: 5 };
  positions.set(keyFor("/code/a", "src/old/x.js"), at);
  renameEdits("/code/a", "src/old", "src/new");
  expect(positions.get(keyFor("/code/a", "src/new/x.js"))).toBe(at);
  expect(positions.has(keyFor("/code/a", "src/old/x.js"))).toBe(false);
  forgetEdits("/code/a", "src/new");
  expect(positions.size).toBe(0);
  positions.set(keyFor("/code/b", "y.js"), at);
  forgetEditsIn("/code/b");
  expect(positions.size).toBe(0);
});
