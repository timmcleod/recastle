import { beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { filesChanged, knownFiles, repositoryFiles } from "./repositoryFiles.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Each test has a repository of its own, as the lists are kept by path.
let repo = 0;
let path;
beforeEach(() => {
  path = `/code/files${++repo}`;
  vi.mocked(invoke).mockReset();
});
const reads = () => vi.mocked(invoke).mock.calls.length;

test("are read once, the tracked ones or all of them, until a refresh", async () => {
  vi.mocked(invoke).mockImplementation(async (_, { untracked }) => (untracked ? ["a.js", ".env"] : ["a.js"]));
  expect(knownFiles(path)).toBeNull();
  expect(await repositoryFiles(path)).toEqual(["a.js"]);
  expect(await repositoryFiles(path, { untracked: true })).toEqual(["a.js", ".env"]);
  await repositoryFiles(path);
  expect(reads()).toBe(2);
  expect(knownFiles(path)).toEqual(["a.js"]);
});

test("after a refresh, are read again when wanted, the last kept meanwhile", async () => {
  let answer;
  vi.mocked(invoke).mockResolvedValueOnce(["old.js"]);
  await repositoryFiles(path);
  filesChanged(path);
  expect(reads()).toBe(1);
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  expect(knownFiles(path)).toEqual(["old.js"]);
  const reading = repositoryFiles(path);
  answer(["new.js"]);
  expect(await reading).toEqual(["new.js"]);
  expect(knownFiles(path)).toEqual(["new.js"]);
  expect(reads()).toBe(2);
});

test("read before a refresh, aren't kept over those read after it", async () => {
  const answers = [];
  vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
  const before = repositoryFiles(path);
  filesChanged(path);
  const after = repositoryFiles(path);
  answers[1](["new.js"]);
  await after;
  answers[0](["old.js"]);
  await before;
  expect(knownFiles(path)).toEqual(["new.js"]);
});

test("that can't be read are none, and aren't read again until a refresh", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("gone"));
  expect(await repositoryFiles(path)).toEqual([]);
  knownFiles(path);
  await repositoryFiles(path);
  expect(reads()).toBe(1);
  filesChanged(path);
  await repositoryFiles(path);
  expect(reads()).toBe(2);
});
