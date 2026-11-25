import { describe, expect, test } from "vitest";
import { StringStream } from "@codemirror/language";
import hljs from "highlight.js/lib/core";
import { dotenvGrammar, dotenvParser, isDotenv } from "./dotenv.js";

test("a .env file is one named .env, or for it", () => {
  for (const file of [".env", ".env.example", "config/.env.local", ".ENV.testing", "deploy/production.env"]) expect(isDotenv(file), file).toBe(true);
  for (const file of ["env", ".envrc", "src/.environment", ".env/x", "a.envx", null]) expect(isDotenv(file), file).toBe(false);
});

// The tokens of `text`'s lines as the editor reads them, [text, token], without spaces.
function tokens(text) {
  const state = dotenvParser.startState();
  const out = [];
  for (const line of text.split("\n")) {
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      const token = dotenvParser.token(stream, state);
      const piece = stream.current();
      if (piece.trim()) out.push([piece.trim(), token]);
      stream.start = stream.pos;
    }
  }
  return out;
}

describe("in the editor", () => {
  test("a name, its value, and a comment", () => {
    expect(tokens("# The app\nAPP_NAME=Laravel\nAPP_URL=http://localhost # here")).toEqual([
      ["# The app", "comment"],
      ["APP_NAME", "attributeName"],
      ["=", null],
      ["Laravel", "string"],
      ["APP_URL", "attributeName"],
      ["=", null],
      ["http://localhost", "string"],
      ["# here", "comment"],
    ]);
  });

  test("export, words, numbers, and a # inside a value", () => {
    expect(tokens("export APP_DEBUG=true\nPORT=8080\nHASH=a#b\nEMPTY=")).toEqual([
      ["export", "keyword"],
      ["APP_DEBUG", "attributeName"],
      ["=", null],
      ["true", "bool"],
      ["PORT", "attributeName"],
      ["=", null],
      ["8080", "number"],
      ["HASH", "attributeName"],
      ["=", null],
      ["a#b", "string"],
      ["EMPTY", "attributeName"],
      ["=", null],
    ]);
  });

  test("references in double quotes and bare values, not in single quotes", () => {
    expect(tokens('URL="${HOST}:${PORT}/x"\nRAW=\'${HOST}\'\nBARE=$HOST/api')).toEqual([
      ["URL", "attributeName"],
      ["=", null],
      ['"', "string"],
      ["${HOST}", "attributeName"],
      [":", "string"],
      ["${PORT}", "attributeName"],
      ['/x"', "string"],
      ["RAW", "attributeName"],
      ["=", null],
      ["'", "string"],
      ["${HOST}'", "string"],
      ["BARE", "attributeName"],
      ["=", null],
      ["$HOST", "attributeName"],
      ["/api", "string"],
    ]);
  });

  test("a double-quoted value goes on over lines, and a comment can follow a quoted one", () => {
    expect(tokens('KEY="line one\nline two" # pem\nNEXT=1')).toEqual([
      ["KEY", "attributeName"],
      ["=", null],
      ['"', "string"],
      ["line one", "string"],
      ['line two"', "string"],
      ["# pem", "comment"],
      ["NEXT", "attributeName"],
      ["=", null],
      ["1", "number"],
    ]);
  });
});

describe("in diffs", () => {
  hljs.registerLanguage("dotenv", dotenvGrammar);
  const classes = (text) =>
    [...hljs.highlight(text, { language: "dotenv" }).value.matchAll(/<span class="hljs-([\w-]+)">([^<]*)/g)].map(([, kind, piece]) => [
      kind,
      piece.replaceAll("&quot;", '"'),
    ]);

  test("names, values, references, words, numbers and comments, classed as the editor colors them", () => {
    expect(classes("# The app\nexport APP_NAME=Laravel # name\nAPP_DEBUG=true\nPORT=8080\nHASH=a#b\nURL=\"${HOST}/x\"\nBARE=$HOST/api")).toEqual([
      ["comment", "# The app"],
      ["keyword", "export"],
      ["variable", "APP_NAME"],
      ["string", "Laravel"],
      ["comment", "# name"],
      ["variable", "APP_DEBUG"],
      ["literal", "true"],
      ["variable", "PORT"],
      ["number", "8080"],
      ["variable", "HASH"],
      ["string", "a#b"],
      ["variable", "URL"],
      ["string", '"'],
      ["template-variable", "${HOST}"],
      ["variable", "BARE"],
      ["template-variable", "$HOST"],
      ["string", "/api"],
    ]);
  });
});
