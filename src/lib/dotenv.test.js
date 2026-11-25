import { describe, expect, test } from "vitest";
import { StringStream } from "@codemirror/language";
import { dotenvHtml, dotenvParser, isDotenv, startState, tokenizeLine } from "./dotenv.js";

test("a .env file is one named .env, or for it, but not code or encrypted files named so", () => {
  for (const file of [".env", ".env.example", "config/.env.local", ".ENV.testing", "deploy/production.env", ".env.tickets.warrenlamb.dev"]) {
    expect(isDotenv(file), file).toBe(true);
  }
  for (const file of ["env", ".envrc", "src/.environment", ".env/x", "a.envx", ".env.local.php", ".env.js", ".env.prod.encrypted", null]) {
    expect(isDotenv(file), file).toBe(false);
  }
});

// `text`'s pieces as tokenizeLine reads them: [text, kind], line by line.
function pieces(text) {
  const state = startState();
  return text.split("\n").flatMap((line) => tokenizeLine(line, state).map(({ from, to, kind }) => [line.slice(from, to), kind]));
}

describe("reading a file", () => {
  test("a name, its value, and a comment", () => {
    expect(pieces("# The app\nAPP_NAME=Laravel\nAPP_URL=http://localhost # here")).toEqual([
      ["# The app", "comment"],
      ["APP_NAME", "name"],
      ["Laravel", "string"],
      ["APP_URL", "name"],
      ["http://localhost", "string"],
      ["# here", "comment"],
    ]);
  });

  test("export, words in any case, numbers, and a # inside a value", () => {
    expect(pieces("export APP_DEBUG=TRUE\nPORT=8080\nHASH=a#b\nEMPTY=\nCOST=$5")).toEqual([
      ["export", "keyword"],
      ["APP_DEBUG", "name"],
      ["TRUE", "literal"],
      ["PORT", "name"],
      ["8080", "number"],
      ["HASH", "name"],
      ["a#b", "string"],
      ["EMPTY", "name"],
      ["COST", "name"],
      ["$5", "string"],
    ]);
  });

  test("references in double quotes and bare values, not in single quotes, and only whole ones", () => {
    expect(pieces('URL="${HOST}:${PORT}/x"\nRAW=\'${HOST}\'\nBARE=$HOST/api\nOPEN="${HOST"')).toEqual([
      ["URL", "name"],
      ['"', "string"],
      ["${HOST}", "reference"],
      [":", "string"],
      ["${PORT}", "reference"],
      ['/x"', "string"],
      ["RAW", "name"],
      ["'${HOST}'", "string"],
      ["BARE", "name"],
      ["$HOST", "reference"],
      ["/api", "string"],
      ["OPEN", "name"],
      ['"${HOST"', "string"],
    ]);
  });

  test("a reference has the name it refers to", () => {
    expect(tokenizeLine('A="${HOST}"', startState())[2]).toMatchObject({ kind: "reference", name: "HOST" });
    expect(tokenizeLine("A=$PORT", startState())[1]).toMatchObject({ kind: "reference", name: "PORT" });
  });

  test("a quote opens a value only at its start, and a value left open goes on over lines", () => {
    expect(pieces("NAME=don't stop\nNEXT=1")).toEqual([
      ["NAME", "name"],
      ["don't", "string"],
      ["stop", "string"],
      ["NEXT", "name"],
      ["1", "number"],
    ]);
    expect(pieces('KEY="line one\nline two"#pem\nNEXT=1')).toEqual([
      ["KEY", "name"],
      ['"line one', "string"],
      ['line two"', "string"],
      ["#pem", "comment"],
      ["NEXT", "name"],
      ["1", "number"],
    ]);
  });
});

// The same text as the editor colors it and as diffs do, each character's kind in
// the reader's own terms, for the two to be compared.
const EDITOR_KINDS = { keyword: "keyword", attributeName: "name", string: "string", bool: "literal", number: "number", comment: "comment" };
const DIFF_KINDS = { keyword: "keyword", variable: "name", "template-variable": "name", string: "string", literal: "literal", number: "number", comment: "comment" };

function editorKinds(text) {
  const state = dotenvParser.startState();
  return text.split("\n").map((line) => {
    const kinds = Array(line.length).fill(null);
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      const start = stream.pos;
      const token = dotenvParser.token(stream, state);
      expect(stream.pos, `the editor moves on in ${JSON.stringify(line)}`).toBeGreaterThan(start);
      kinds.fill(EDITOR_KINDS[token] ?? null, start, stream.pos);
    }
    return kinds;
  });
}

function diffKinds(text) {
  const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };
  return dotenvHtml(text)
    .split("\n")
    .map((html) =>
      [...html.matchAll(/<span class="hljs-([\w-]+)">([^<]*)<\/span>|([^<]+)/g)].flatMap(([, kind, inSpan, plain]) => {
        const piece = (inSpan ?? plain).replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
        return Array(piece.length).fill(kind ? DIFF_KINDS[kind] : null);
      }),
    );
}

test("the editor and diffs color every line alike", () => {
  const lines = [
    "# a comment",
    "APP_NAME=Laravel",
    "export APP_DEBUG=true",
    "A=TRUE",
    "B=False # c",
    "C=null",
    "PORT=8080",
    "RATE=-1.5",
    "KEY = value",
    "EMPTY=",
    "HASH=a#b",
    "D=x #c",
    "#E=1",
    'F="x"#c',
    "-x=1 #c",
    "export FOO",
    "FOO BAR=1",
    "NAME=don't stop",
    'P=abc"def',
    "A='x' 'y'",
    "A=${FOO",
    'A="${HOST"',
    "A=$",
    "B=$5",
    "A=abc$123",
    "URL=$HOST/api",
    'URL="${HOST}:${PORT}/x"',
    "RAW='${HOST}'",
    'ESC="say \\"hi\\" $HOST"',
    "TPL=`a ${B}`",
    "my.key-name=1",
    "WINDOWS=yes\r",
    'MULTI="one',
    "two $X",
    'three"',
    "AFTER=1",
    "<b>=&amp;",
  ];
  const text = lines.join("\n");
  expect(diffKinds(text)).toEqual(editorKinds(text));
});
