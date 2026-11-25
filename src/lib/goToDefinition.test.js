import { beforeEach, describe, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { destinations, linkAt, MOST_PLACES, placesMenu } from "./goToDefinition.js";
import { repositoryFiles } from "./repositoryFiles.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const FILES = ["src/App.vue", "src/components/FileTabs.vue", "src/lib/fileTabs.js", "src/lib/format.js"];
let found;
// Each test has a repository of its own, as its files are kept by path.
let repo = 0;
let path;
beforeEach(() => {
  found = [];
  path = `/code/repo${++repo}`;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => (command === "tracked_files" ? FILES : found));
});

const name = (n, owner = null) => ({ kind: "name", name: n, owner, from: 0, to: n.length });
const searches = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "find_definitions").map(([, args]) => args);

describe("what a click could go to", () => {
  test("a name, at once", () => {
    expect(linkAt(path, "src/App.vue", "  formatSize(1);", 4)).toMatchObject({ kind: "name", name: "formatSize" });
  });

  test("a path, once the repository's files are known to have it", async () => {
    const line = 'import FileTabs from "./components/FileTabs.vue";';
    expect(linkAt(path, "src/App.vue", line, 30)).toBeNull();
    await repositoryFiles(path, { untracked: true });
    expect(linkAt(path, "src/App.vue", line, 30)).toMatchObject({ kind: "path", file: "src/components/FileTabs.vue" });
    expect(linkAt(path, "src/App.vue", 'import x from "./missing.js";', 18)).toBeNull();
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "tracked_files")).toHaveLength(1);
  });
});

describe("where a click goes", () => {
  test("a path, to its file's top", async () => {
    const target = { kind: "path", paths: ["src/nope.js", "src/lib/format.js"] };
    expect(await destinations(path, "src/App.vue", "", target, 1)).toEqual([{ file: "src/lib/format.js", line: null, text: "" }]);
  });

  test("a name a script imports whole, to the file it's from, without searching", async () => {
    const text = 'import FileTabs from "./components/FileTabs.vue";\n<FileTabs />';
    expect(await destinations(path, "src/App.vue", text, name("FileTabs"), 2)).toEqual([{ file: "src/components/FileTabs.vue", line: null, text: "" }]);
    expect(searches()).toEqual([]);
  });

  test("one of a file's names a script imports, to its definition in that file, by its own name there", async () => {
    found = [{ file: "src/lib/fileTabs.js", line: 90, text: "export function shownFile(path) {" }];
    const text = 'import { shownFile as shown } from "./lib/fileTabs.js";\nshown(p);';
    expect(await destinations(path, "src/App.vue", text, name("shown"), 2)).toEqual(found);
    expect(searches()[0]).toMatchObject({ globs: [], files: ["src/lib/fileTabs.js"] });
    expect(searches()[0].patterns.join()).toContain("shownFile");
  });

  test("another name, to where the repository's searched finds it, most likely first, and no more than so many", async () => {
    found = [
      { file: "other/format.js", line: 1, text: "function formatSize() {}" },
      ...Array.from({ length: MOST_PLACES }, (_, i) => ({ file: "other/many.js", line: i + 1, text: "" })),
      { file: "src/App.vue", line: 30, text: "function formatSize() {}" },
    ];
    const result = await destinations(path, "src/App.vue", "formatSize(1)", name("formatSize"), 1);
    expect(result).toHaveLength(MOST_PLACES);
    expect(result[0].file).toBe("src/App.vue");
    expect(searches()[0]).toMatchObject({ path, files: [], globs: expect.arrayContaining(["*.vue"]) });
  });

  test("a name found nowhere, after ::, to what it's in", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "tracked_files") return FILES;
      return args.patterns[0].includes("TicketStatus") ? [{ file: "src/Enums/TicketStatus.php", line: 5, text: "enum TicketStatus: string" }] : [];
    });
    expect(await destinations(path, "src/Tools/Search.php", "", name("cases", "TicketStatus"), 19)).toEqual([
      { file: "src/Enums/TicketStatus.php", line: 5, text: "enum TicketStatus: string" },
    ]);
    // With no owner, nowhere.
    expect(await destinations(path, "src/Tools/Search.php", "", name("cases"), 19)).toEqual([]);
  });
});

describe("where an environment variable goes", () => {
  const env = (n, find) => ({ kind: "env", name: n, find, from: 0, to: n.length });

  test("read, to where the .env files set it, those git ignores too, the one it's in first", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "tracked_files") return [".env", ".env.example", "config/app.php", ".envrc"];
      return [
        { file: ".env.example", line: 1, text: "APP_NAME=Laravel" },
        { file: ".env", line: 2, text: "APP_NAME=Ticketing" },
      ];
    });
    expect((await destinations(path, "config/app.php", "", env("APP_NAME", "set"), 16)).map((p) => p.file)).toEqual([".env", ".env.example"]);
    expect(searches()[0]).toMatchObject({ files: [".env", ".env.example"], globs: [], includeIgnored: true });
    // From a .env file's ${APP_NAME}, its own first.
    expect((await destinations(path, ".env.example", "", env("APP_NAME", "set"), 9)).map((p) => p.file)).toEqual([".env.example", ".env"]);
  });

  test("set, to where the app reads it, in any file it doesn't ignore", async () => {
    found = [{ file: "config/app.php", line: 16, text: "'name' => env('APP_NAME', 'Laravel')," }];
    expect(await destinations(path, ".env", "", env("APP_NAME", "read"), 2)).toEqual(found);
    expect(searches()[0]).toMatchObject({ globs: [], files: [], includeIgnored: false });
  });

  test("with no .env files, isn't set anywhere, and says so", async () => {
    expect(await destinations(path, "config/app.php", "", env("APP_NAME", "set"), 16)).toEqual([]);
    expect(searches()).toEqual([]);
    expect(placesMenu([], env("APP_NAME", "set"), vi.fn())[0].label).toBe("“APP_NAME” isn't set in a .env file");
    expect(placesMenu([], env("APP_NAME", "read"), vi.fn())[0].label).toBe("Nothing reads “APP_NAME”");
  });
});

describe("the menu of places", () => {
  const place = (i) => ({ file: `src/f${i}.js`, line: i, text: `line ${i}` });

  test("goes to the one chosen, filtered once there are many", () => {
    const go = vi.fn();
    const few = placesMenu([place(1), place(2)], name("x"), go);
    expect(few.map((item) => item.label)).toEqual(["src/f1.js:1", "src/f2.js:2"]);
    few[1].action();
    expect(go).toHaveBeenCalledWith(place(2));
    const many = placesMenu(Array.from({ length: 9 }, (_, i) => place(i)), name("x"), go);
    expect(many[0]).toMatchObject({ filter: "Filter" });
    expect(many[1]).toMatchObject({ filterable: true, detail: "line 0" });
  });

  test("with none, says the name wasn't found", () => {
    expect(placesMenu([], name("cases"), vi.fn())).toEqual([{ label: "No definition found for “cases”", disabled: true }]);
  });
});
