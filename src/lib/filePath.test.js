import { describe, expect, test } from "vitest";
import { splitPath } from "./filePath.js";

describe("splitPath", () => {
  test("splits off the folder, keeping its slash", () => {
    expect(splitPath("src/lib/a.js")).toEqual({ dir: "src/lib/", name: "a.js" });
  });

  test("a file at the top has no folder", () => {
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
  });

  test("a repository inside this one keeps its slash as part of its name", () => {
    expect(splitPath("vendor/nested/")).toEqual({ dir: "vendor/", name: "nested/" });
    expect(splitPath("nested/")).toEqual({ dir: "", name: "nested/" });
  });
});
