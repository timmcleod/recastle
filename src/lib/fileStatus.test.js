import { beforeEach, describe, expect, test, vi } from "vitest";
import { nextTick, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { mountComposable } from "../test/mount.js";
import { statusesOf, statusOf, useFileStatuses } from "./fileStatus.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

async function flushPromises() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await nextTick();
  }
}

test("a file's status is its conflict, then its unstaged change, then its staged one", () => {
  expect(statusOf({ path: "a", conflicted: true, unstaged: "modified" })).toBe("conflicted");
  expect(statusOf({ path: "a", unstaged: "modified", staged: "added" })).toBe("modified");
  expect(statusOf({ path: "a", staged: "added" })).toBe("added");
});

test("the files' statuses are by path", () => {
  expect(statusesOf([{ path: "a", staged: "added" }, { path: "b", unstaged: "untracked" }])).toEqual(
    new Map([
      ["a", "added"],
      ["b", "untracked"],
    ]),
  );
});

describe("the Files view's statuses", () => {
  const changed = (path) => ({ path, staged: null, unstaged: "modified", conflicted: false });

  test("are the refresh's, when it read the changed files", async () => {
    const statusFiles = ref([changed("a.js")]);
    const { result: statuses, unmount } = mountComposable(() =>
      useFileStatuses({ path: () => "/repo", statusFiles: () => statusFiles.value, refreshKey: () => 0 }),
    );
    await flushPromises();
    expect(statuses.value).toEqual(new Map([["a.js", "modified"]]));
    expect(invoke).not.toHaveBeenCalled();
    unmount();
  });

  test("are read, when it didn't, and again with each refresh", async () => {
    vi.mocked(invoke).mockResolvedValue([changed("b.js")]);
    const refreshKey = ref(0);
    const { result: statuses, unmount } = mountComposable(() =>
      useFileStatuses({ path: () => "/repo", statusFiles: () => null, refreshKey: () => refreshKey.value }),
    );
    expect(statuses.value).toBeNull();
    await flushPromises();
    expect(statuses.value).toEqual(new Map([["b.js", "modified"]]));
    refreshKey.value++;
    await flushPromises();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("working_status", { path: "/repo" });
    unmount();
  });

  test("are unknown for another repository, until read", async () => {
    const path = ref("/one");
    const answers = [];
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { result: statuses, unmount } = mountComposable(() =>
      useFileStatuses({ path: () => path.value, statusFiles: () => null, refreshKey: () => 0 }),
    );
    answers[0]([changed("a.js")]);
    await flushPromises();
    expect(statuses.value).toEqual(new Map([["a.js", "modified"]]));
    path.value = "/two";
    await flushPromises();
    expect(statuses.value).toBeNull();
    answers[1]([]);
    await flushPromises();
    expect(statuses.value).toEqual(new Map());
    unmount();
  });
});
