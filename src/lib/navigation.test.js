import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import { mountComposable } from "../test/mount.js";
import { describe as describePlace, useNavigation } from "./navigation.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setUp({ active } = {}) {
  const view = {
    selected: ref("workspace:history"),
    selectedCommit: ref(null),
    selectedStash: ref(null),
    fileFilter: ref(null),
    detailMode: ref("changeset"),
    treeFile: ref(null),
    treeReveal: ref(null),
    comparison: ref(null),
  };
  const openFiles = reactive({});
  // The line the Files view's cursor is on, and the lines it's been asked to show.
  const cursor = ref(1);
  const linesShown = [];
  const { result, unmount } = mountComposable(() =>
    useNavigation({
      overview: ref({ path: "/repo" }),
      view,
      fileShown: () => (view.selected.value === "workspace:files" ? (openFiles["/repo"] ?? null) : null),
      showFile: (file) => (openFiles["/repo"] = file),
      fileLine: () => cursor.value,
      showLine: (file, line) => {
        linesShown.push([file, line]);
        cursor.value = line;
      },
      active,
    }),
  );
  return { ...result, view, openFiles, cursor, linesShown, unmount };
}

// Lets the views settle, as go() does, after `ms` spent in the place before.
async function moveTo(change, ms = 5000) {
  vi.advanceTimersByTime(ms);
  change();
  await nextTick();
  await nextTick();
}

describe("useNavigation", () => {
  test("goes back and forward through the places visited, the Files view's file too", async () => {
    const { nav, go, view, openFiles } = setUp();
    await moveTo(() => (view.selectedCommit.value = { id: "a", short_id: "aaa" }));
    await moveTo(() => (view.selected.value = "branch:feature/x"));
    await moveTo(() => {
      view.selected.value = "workspace:files";
      view.selectedCommit.value = null;
      openFiles["/repo"] = "src/main.js";
    });
    await moveTo(() => (view.selected.value = "workspace:history"));
    expect(nav.back.map(describePlace)).toEqual(["History › aaa", "feature/x › aaa", "Files › main.js"]);

    openFiles["/repo"] = null;
    await go("back");
    expect(view.selected.value).toBe("workspace:files");
    expect(openFiles["/repo"]).toBe("src/main.js");
    await go("back");
    expect(view.selected.value).toBe("branch:feature/x");
    await go("forward");
    expect(view.selected.value).toBe("workspace:files");
    expect(nav.forward).toHaveLength(1);
  });

  test("reopens a file closed in the Files view going back, and closes it again going forward", async () => {
    const { go, view, openFiles } = setUp();
    await moveTo(() => (view.selected.value = "workspace:files"));
    await moveTo(() => (openFiles["/repo"] = "src/main.js"));
    await moveTo(() => (openFiles["/repo"] = null));
    await go("back");
    expect(openFiles["/repo"]).toBe("src/main.js");
    await go("forward");
    expect(openFiles["/repo"]).toBeNull();
    // Away from the Files view, its file stays as it was.
    await moveTo(() => (openFiles["/repo"] = "src/app.js"));
    await moveTo(() => (view.selected.value = "workspace:history"));
    await moveTo(() => (view.selected.value = "branch:main"));
    await go("back");
    expect(view.selected.value).toBe("workspace:history");
    expect(openFiles["/repo"]).toBe("src/app.js");
  });

  // Where it starts isn't a place until something changes.
  test("keeps only the last of places replaced quickly in the same view", async () => {
    const { nav, view } = setUp();
    await moveTo(() => (view.selected.value = "branch:main"));
    await moveTo(() => (view.selected.value = "workspace:history"));
    await moveTo(() => (view.selectedCommit.value = { id: "b" }), 100);
    await moveTo(() => (view.selectedCommit.value = { id: "c" }), 100);
    await moveTo(() => (view.selected.value = "workspace:stashes"));
    expect(nav.back.map((p) => p.commit?.id ?? p.selected)).toEqual(["branch:main", "c"]);
  });

  test("going somewhere new drops what was forward", async () => {
    const { nav, go, view } = setUp();
    await moveTo(() => (view.selected.value = "branch:main"));
    await moveTo(() => (view.selected.value = "workspace:stashes"));
    await go("back");
    expect(nav.forward).toHaveLength(1);
    await moveTo(() => (view.selected.value = "workspace:files"));
    expect(nav.forward).toHaveLength(0);
  });

  test("the mouse's back and forward buttons go, until unmounted", async () => {
    const { view, unmount } = setUp();
    await moveTo(() => (view.selected.value = "branch:main"));
    await moveTo(() => (view.selected.value = "workspace:stashes"));
    const back = new MouseEvent("mouseup", { button: 3, cancelable: true });
    window.dispatchEvent(back);
    await nextTick();
    expect(back.defaultPrevented).toBe(true);
    expect(view.selected.value).toBe("branch:main");

    unmount();
    window.dispatchEvent(new MouseEvent("mouseup", { button: 4 }));
    await nextTick();
    expect(view.selected.value).toBe("branch:main");
  });

  test("the mouse's buttons go only in the workspace showing", async () => {
    let showing = false;
    const { view } = setUp({ active: () => showing });
    await moveTo(() => (view.selected.value = "branch:main"));
    await moveTo(() => (view.selected.value = "workspace:stashes"));
    window.dispatchEvent(new MouseEvent("mouseup", { button: 3 }));
    await nextTick();
    expect(view.selected.value).toBe("workspace:stashes");
    showing = true;
    window.dispatchEvent(new MouseEvent("mouseup", { button: 3 }));
    await nextTick();
    expect(view.selected.value).toBe("branch:main");
  });

  test("a jump to a definition is a place of its own, in the same file too, and Back comes back to its line", async () => {
    const { nav, go, jump, view, openFiles, cursor, linesShown } = setUp();
    await moveTo(() => {
      view.selected.value = "workspace:files";
      openFiles["/repo"] = "src/a.js";
    });
    cursor.value = 12;
    // Within the file, at once: no time spent there makes it any less a place.
    jump(() => (cursor.value = 40), "src/a.js", 40);
    await nextTick();
    jump(
      () => {
        openFiles["/repo"] = "src/b.js";
        cursor.value = 7;
      },
      "src/b.js",
      7,
    );
    await nextTick();
    expect(nav.back.map((p) => [p.file, p.line])).toEqual([
      ["src/a.js", 12],
      ["src/a.js", 40],
    ]);

    await go("back");
    expect(openFiles["/repo"]).toBe("src/a.js");
    expect(linesShown.at(-1)).toEqual(["src/a.js", 40]);
    await go("back");
    expect(linesShown.at(-1)).toEqual(["src/a.js", 12]);
    // Forward again, to where the cursor was as it was left.
    await go("forward");
    expect(linesShown.at(-1)).toEqual(["src/a.js", 40]);
    expect(nav.forward.map((p) => [p.file, p.line])).toEqual([["src/b.js", 7]]);
  });

  test("a place gone to, then left for another file, comes back where the file was left, not where it was gone to", async () => {
    const { nav, jump, view, openFiles, cursor } = setUp();
    await moveTo(() => {
      view.selected.value = "workspace:files";
      openFiles["/repo"] = "src/a.js";
    });
    jump(() => (cursor.value = 2), "src/a.js", 2);
    cursor.value = 50;
    await moveTo(() => (openFiles["/repo"] = "src/b.js"));
    expect(nav.back.at(-1)).toMatchObject({ file: "src/a.js", line: null });
  });

  test("forget starts over, for another repository", async () => {
    const { nav, forget, view } = setUp();
    await moveTo(() => (view.selected.value = "branch:main"));
    await moveTo(() => (view.selected.value = "workspace:stashes"));
    forget();
    expect([nav.back.length, nav.forward.length]).toEqual([0, 0]);
  });
});

describe("describe", () => {
  test("names the view and what's chosen in it", () => {
    expect(describePlace(null)).toBe("");
    expect(describePlace({ selected: "workspace:stashes", stash: 2 })).toBe("Stashes › stash@{2}");
    expect(describePlace({ selected: "workspace:compare", comparison: { head: "a", base: "b" } })).toBe("a with b");
    expect(describePlace({ selected: "tag:v1.0" })).toBe("v1.0");
  });
});
