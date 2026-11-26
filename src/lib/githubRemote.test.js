import { describe, expect, test } from "vitest";
import { githubRepoOf, movedUrl } from "./githubRemote.js";

describe("movedUrl", () => {
  test("points a remote at where its repository's moved, written as it was", () => {
    expect(movedUrl("https://github.com/smokycastle/recastle.git", "tim/recastle")).toBe("https://github.com/tim/recastle.git");
    expect(movedUrl("https://me@github.com/old/app", "new/app")).toBe("https://me@github.com/new/app");
    expect(movedUrl("git@github.com:old/app.git", "new/app-2")).toBe("git@github.com:new/app-2.git");
    expect(movedUrl("ssh://git@github.com/old/app/", "new/app")).toBe("ssh://git@github.com/new/app/");
    expect(movedUrl("https://GitHub.com/old/app.git", "new/app")).toBe("https://GitHub.com/new/app.git");
  });

  test("leaves a URL that isn't GitHub's as it is", () => {
    expect(movedUrl("https://gitlab.com/old/app.git", "new/app")).toBe("https://gitlab.com/old/app.git");
    expect(movedUrl("git@work:old/app.git", "new/app")).toBe("git@work:old/app.git");
  });
});

describe("githubRepoOf", () => {
  test("reads the owner and repository from HTTPS and SSH URLs, but not others", () => {
    expect(githubRepoOf("https://github.com/me/app.git")).toEqual({ owner: "me", repo: "app" });
    expect(githubRepoOf("git@github.com:me/app")).toEqual({ owner: "me", repo: "app" });
    expect(githubRepoOf("https://gitlab.com/me/app.git")).toBeNull();
  });
});
