import { describe, expect, test } from "vitest";
import { definitionSearch, envReadSearch, envSetSearch, importOf, pathsOf, ranked, targetAt } from "./definitions.js";

// What's under the column marked | in `marked`, a line of `file`.
function at(marked, file) {
  const column = marked.indexOf("|");
  return targetAt(marked.replace("|", ""), column, file);
}

describe("what's under the pointer", () => {
  test("is the name it's on, or just after", () => {
    expect(at("const size = format|Size(bytes);", "src/a.js")).toEqual({ kind: "name", name: "formatSize", owner: null, from: 13, to: 23 });
    expect(at("  return |size;", "src/a.js")).toMatchObject({ kind: "name", name: "size" });
    expect(at("  return size|;", "src/a.js")).toMatchObject({ kind: "name", name: "size" });
  });

  test("isn't a keyword, a number or nothing", () => {
    expect(at("  ret|urn size;", "src/a.js")).toBeNull();
    expect(at("const a = 4|2;", "src/a.js")).toBeNull();
    expect(at("a = b; |  ", "src/a.js")).toBeNull();
  });

  test("is a name another language has as a keyword", () => {
    expect(at("const m = mat|ch[1];", "src/a.js")).toMatchObject({ name: "match" });
    expect(at("let x = mat|ch y {", "src/a.rs")).toBeNull();
    expect(at("const t = ty|pe;", "src/a.js")).toMatchObject({ name: "type" });
  });

  test("past an apostrophe, as in a comment, is still a name", () => {
    expect(at("// don't call format|Size here, it's slow", "src/a.js")).toMatchObject({ name: "formatSize" });
    expect(at("# it's the user|Name", "a.py")).toMatchObject({ name: "userName" });
  });

  test("in a template's ${...}, is a name, not text", () => {
    expect(at("const s = `${format|Size(1)} kb`;", "src/a.js")).toMatchObject({ name: "formatSize" });
    expect(at("const s = `${a} kb ${b} m|b`;", "src/a.js")).toBeNull();
  });

  test("after ::, has what it's in, as a PHP class's", () => {
    expect(at("$all = TicketStatus::ca|ses();", "a.php")).toMatchObject({ kind: "name", name: "cases", owner: "TicketStatus" });
    expect(at("let v = Vec::ne|w();", "a.rs")).toMatchObject({ name: "new", owner: "Vec" });
    expect(at("Ticket|Status::cases()", "a.php")).toMatchObject({ name: "TicketStatus", owner: null });
  });

  test("in PHP, is a variable's name without its $", () => {
    expect(at("$tot|al = 1;", "a.php")).toMatchObject({ kind: "name", name: "total" });
  });

  test("in quotes, is a file's path, from the file's folder, with what an import leaves off", () => {
    const target = at('import FileTabs from "./File|Tabs.vue";', "src/components/Workspace.vue");
    expect(target).toMatchObject({ kind: "path", from: 22, to: 36 });
    expect(target.paths[0]).toBe("src/components/FileTabs.vue");
    const bare = at('import { x } from "../lib/fi|le";', "src/components/A.vue").paths;
    expect(bare).toContain("src/lib/file.js");
    expect(bare).toContain("src/lib/file/index.ts");
    expect(bare.indexOf("src/lib/file.js")).toBeLessThan(bare.indexOf("src/lib/file/index.js"));
  });

  test("in quotes, a path not starting with . is tried from the repository's top too", () => {
    expect(at("require '|lib/helpers.rb'", "app/models/user.rb").paths).toEqual(
      expect.arrayContaining(["app/models/lib/helpers.rb", "lib/helpers.rb"]),
    );
  });

  test("in quotes, plain text is nothing to go to", () => {
    expect(at('tell("Couldn\'t Save the |File", message);', "src/a.js")).toBeNull();
  });

  test("in Rust, a module declared is its file, and ' isn't a quote", () => {
    expect(at("pub mod de|finitions;", "src-tauri/src/lib.rs").paths).toEqual(["src-tauri/src/definitions.rs", "src-tauri/src/definitions/mod.rs"]);
    expect(at("mod |tests;", "src/cli.rs").paths).toEqual(["src/cli/tests.rs", "src/cli/tests/mod.rs"]);
    expect(at("fn first<'a>(s: &'a str) -> &'a str { s|ize(s) }", "src/a.rs")).toMatchObject({ kind: "name", name: "size" });
  });

  test("in Markdown, `code` that's a path is its file, quotes in prose aren't quotes", () => {
    expect(at("Don't edit `src/lib/fo|o.js`, it's generated.", "README.md").paths[0]).toBe("src/lib/foo.js");
    expect(at("Don't edit `formatSize`, it's |used.", "README.md")).toMatchObject({ name: "used" });
  });

  test("in Markdown, a link's target is its file, its %20s as spaces", () => {
    expect(at("See [it](my%20fi|le.md).", "docs/x.md").paths[0]).toBe("docs/my file.md");
  });

  test("in Markdown, a link's target is its file, but not a web address", () => {
    expect(at("Read [the map](ARCHITE|CTURE.md#the-page) first.", "README.md").paths[0]).toBe("ARCHITECTURE.md");
    expect(at("See [docs](docs/gu|ide.md).", "notes/x.md").paths[0]).toBe("notes/docs/guide.md");
    expect(at("[site](https://exa|mple.com)", "README.md")).toBeNull();
  });

  test("a path that leaves the repository is nowhere", () => {
    expect(at('import x from "../../../o|ut.js";', "src/a.js").paths).toEqual([]);
  });
});

describe("an environment variable", () => {
  test("a program reads, goes to where it's set", () => {
    expect(at("    'name' => env('APP_N|AME', 'Laravel'),", "config/app.php")).toEqual({ kind: "env", name: "APP_NAME", find: "set", from: 19, to: 27 });
    expect(at("Str::slug(env('APP_NAME', 'x')), env(\"CACHE_PRE|FIX\")", "config/cache.php")).toMatchObject({ name: "CACHE_PREFIX" });
    expect(at("$key = getenv('AWS_|KEY');", "a.php")).toMatchObject({ name: "AWS_KEY", find: "set" });
    expect(at("$url = $_SERVER['DB_|URL'];", "a.php")).toMatchObject({ name: "DB_URL" });
    expect(at("const mode = process.env.NODE_|ENV;", "a.js")).toMatchObject({ name: "NODE_ENV" });
    expect(at("const key = import.meta.env.VITE_|KEY;", "a.vue")).toMatchObject({ name: "VITE_KEY" });
    expect(at("host = os.environ.get('DB_|HOST')", "a.py")).toMatchObject({ name: "DB_HOST" });
    // A method of the same name isn't one.
    expect(at("if ($app->env('loc|al')) {", "a.php")).toBeNull();
  });

  test("in a .env file, its name goes to where it's read, and one a value refers to, to where it's set", () => {
    expect(at("APP_N|AME=Laravel", ".env")).toEqual({ kind: "env", name: "APP_NAME", find: "read", from: 0, to: 8 });
    expect(at("export DB_|HOST=localhost", ".env.example")).toMatchObject({ name: "DB_HOST", find: "read" });
    expect(at('MAIL_FROM_NAME="${APP_N|AME}"', ".env")).toMatchObject({ name: "APP_NAME", find: "set" });
    expect(at("URL=$HO|ST/api", ".env")).toMatchObject({ name: "HOST", find: "set" });
    expect(at("APP_NAME=Lara|vel", ".env")).toBeNull();
    expect(at("# The app's na|me", ".env")).toBeNull();
  });

  const matcher = (patterns) => {
    const regexes = patterns.map((pattern) => new RegExp(pattern.replaceAll("[[:space:]]", "\\s")));
    return (line) => regexes.some((regex) => regex.test(line));
  };

  test("is set by its line in a .env file", () => {
    const sets = matcher(envSetSearch("APP_NAME").patterns);
    expect(sets("APP_NAME=Laravel")).toBe(true);
    expect(sets("export APP_NAME = x")).toBe(true);
    expect(sets("APP_NAME_TOO=x")).toBe(false);
    expect(sets("# APP_NAME=x")).toBe(false);
  });

  test("is read as any language reads one, in any file", () => {
    const { patterns, globs } = envReadSearch("APP_NAME");
    expect(globs).toEqual([]);
    const reads = matcher(patterns);
    for (const line of [
      "'name' => env('APP_NAME', 'Laravel'),",
      'Str::slug(env("APP_NAME"), "_")',
      "getenv('APP_NAME')",
      "Env::get('APP_NAME')",
      "$_ENV['APP_NAME']",
      "process.env.APP_NAME",
      "process.env['APP_NAME']",
      "import.meta.env.APP_NAME",
      "os.environ['APP_NAME']",
      'os.Getenv("APP_NAME")',
      'std::env::var("APP_NAME")',
      "ENV.fetch('APP_NAME')",
    ]) {
      expect(reads(line), line).toBe(true);
    }
    for (const line of ["env('APP_NAME_TOO')", "$app->env('APP_NAME')", "process.env.APP_NAMES", "APP_NAME=x"]) {
      expect(reads(line), line).toBe(false);
    }
  });
});

describe("where a name is defined", () => {
  // The patterns as JavaScript reads them: POSIX's [[:space:]] is \s.
  const matcher = (name, file) => {
    const { patterns } = definitionSearch(name, file);
    const regexes = patterns.map((pattern) => new RegExp(pattern.replaceAll("[[:space:]]", "\\s")));
    return (line) => regexes.some((regex) => regex.test(line));
  };

  test("in JavaScript and Vue, is a function, class, constant or method, searched for in their files", () => {
    const defines = matcher("formatSize", "src/components/A.vue");
    for (const line of [
      "export function formatSize(bytes) {",
      "async function formatSize() {",
      "export const formatSize = (bytes) => {",
      "let formatSize;",
      "class formatSize extends Base {",
      "  formatSize(bytes) {",
      "  async formatSize(bytes): string {",
      "  formatSize: function (bytes) {",
      "  formatSize: (bytes) => bytes,",
      "export type formatSize = string;",
      "  formatSize: null,",
      '  "formatSize": 1,',
      "  formatSize?: (bytes: number) => string;",
      "  static formatSize = 1;",
      "  private readonly formatSize: Formatter;",
      "  #formatSize = null;",
    ]) {
      expect(defines(line), line).toBe(true);
    }
    for (const line of [
      "const size = formatSize(bytes);",
      "  return formatSize(b) + 1;",
      "this.formatSize = 1",
      "    this.formatSize = null;",
      "const formatSizes = 1;",
      "x.formatSize(bytes) {",
      "  size: formatSize,",
      "  formatSize = 2;",
    ]) {
      expect(defines(line), line).toBe(false);
    }
    expect(definitionSearch("formatSize", "a.ts").globs).toContain("*.vue");
  });

  test("in Rust, is an item of any kind", () => {
    const defines = matcher("find_definitions", "src/lib.rs");
    expect(defines("pub async fn find_definitions(path: String) {")).toBe(true);
    expect(defines("pub(crate) const find_definitions: u8 = 1;")).toBe(true);
    expect(defines("    definitions::find_definitions,")).toBe(false);
  });

  test("in Python, Go, PHP and Ruby, is their functions and types", () => {
    expect(matcher("load", "a.py")("    async def load(self):")).toBe(true);
    expect(matcher("LIMIT", "a.py")("LIMIT = 10")).toBe(true);
    expect(matcher("LIMIT", "a.py")("if LIMIT == 10:")).toBe(false);
    expect(matcher("Serve", "a.go")("func (s *Server) Serve(l net.Listener) error {")).toBe(true);
    expect(matcher("render", "a.php")("    public function render(): View")).toBe(true);
    expect(matcher("valid?", "a.rb")("  def valid?")).toBe(false);
    expect(matcher("valid", "a.rb")("  def self.valid(x)")).toBe(true);
  });

  test("in another language, is what defines things in most, in any file", () => {
    const { globs } = definitionSearch("parse", "a.kt");
    expect(globs).toEqual([]);
    expect(matcher("parse", "a.kt")("    fun parse(text: String): Tree {")).toBe(true);
    expect(matcher("parse", "a.c")("static struct tree *parse(const char *text)")).toBe(true);
    expect(matcher("parse", "a.c")("  tree = parse(text);")).toBe(false);
  });

  test("a name with $ in it is searched for as written", () => {
    expect(matcher("$el", "a.js")("const $el = document.body;")).toBe(true);
    expect(matcher("$el", "a.js")("const xel = document.body;")).toBe(false);
  });
});

describe("where a name is imported from", () => {
  const text = `import FileTabs from "./FileTabs.vue";
import { openTab, shownFile as shown } from "../lib/fileTabs.js";
import * as cm from "../lib/codeEditor.js";
import Default, { named } from "./both.js";`;

  test("is the file for the file's own import, or its names", () => {
    expect(importOf(text, "FileTabs")).toEqual({ spec: "./FileTabs.vue", named: false, original: null });
    expect(importOf(text, "openTab")).toEqual({ spec: "../lib/fileTabs.js", named: true, original: "openTab" });
    expect(importOf(text, "shown")).toEqual({ spec: "../lib/fileTabs.js", named: true, original: "shownFile" });
    expect(importOf(text, "cm")).toEqual({ spec: "../lib/codeEditor.js", named: false, original: null });
    expect(importOf(text, "Default")).toEqual({ spec: "./both.js", named: false, original: null });
    expect(importOf(text, "named")).toEqual({ spec: "./both.js", named: true, original: "named" });
  });

  test("is nowhere for a name that isn't imported", () => {
    expect(importOf(text, "shownFile")).toBeNull();
    expect(importOf(text, "nothing")).toBeNull();
  });
});

test("a path's files are tried with each extension an import leaves off", () => {
  expect(pathsOf("./a", "src/b.js").slice(0, 3)).toEqual(["src/a", "src/a.js", "src/a.ts"]);
});

test("places found are the file's own first, then its folder's, without where it's used", () => {
  const found = [
    { file: "src/z.js", line: 3 },
    { file: "lib/a.js", line: 1 },
    { file: "src/lib/here.js", line: 40 },
    { file: "src/lib/near.js", line: 2 },
    { file: "src/lib/here.js", line: 10 },
  ];
  expect(ranked(found, "src/lib/here.js", 10)).toEqual([
    { file: "src/lib/here.js", line: 40 },
    { file: "src/lib/near.js", line: 2 },
    { file: "lib/a.js", line: 1 },
    { file: "src/z.js", line: 3 },
  ]);
});
