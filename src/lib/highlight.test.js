import { expect, test } from "vitest";
import { languageFor } from "./highlight.js";

test("a file's language for diffs is by its name or extension, .env files their own", () => {
  expect(languageFor("src/App.vue")).toBe("xml");
  expect(languageFor("Dockerfile")).toBe("dockerfile");
  expect(languageFor(".env")).toBe("dotenv");
  expect(languageFor("config/.env.example")).toBe("dotenv");
  expect(languageFor("deploy/production.env")).toBe("dotenv");
  // direnv's, a shell script.
  expect(languageFor(".envrc")).toBe("bash");
  // Code named for .env is code.
  expect(languageFor(".env.local.php")).toBe("php");
  expect(languageFor("notes")).toBeNull();
});
