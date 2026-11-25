import { isDotenv } from "./dotenv.js";

// Going to a definition, with Ctrl+click (⌘-click) in the Files view's editor: what's
// under the pointer, a file's path, a name or an environment variable, and where that
// could be. Read from the
// text, not understood as code, so a name is looked for by the lines that would define
// it in the file's language (see definitions.rs, which searches for them): a good guess,
// in any repository, though one that can't tell two things of the same name apart.

// Characters a name is made of, in most languages: $ for JavaScript's, and PHP's
// variables.
const NAME = /[A-Za-z0-9_$]/;
// What can't come right before or after a name it's part of, in a pattern.
const EDGE = "[^A-Za-z0-9_$]";

const extensionOf = (file) => /\.([^./]+)$/.exec(file)?.[1].toLowerCase() ?? "";
const folderOf = (file) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
const isMarkdown = (file) => ["md", "markdown", "mdown", "mkd", "mkdn"].includes(extensionOf(file));

// --- What's under the pointer ---------------------------------------------------------

/**
 * What going to a definition from `column` (from 0) in `text`, a line of `file`, would
 * go to: { kind: "path", paths, from, to }, a file, the first of `paths` there is;
 * { kind: "name", name, owner, from, to }, `owner` the name before it and ::, as the
 * class in PHP's TicketStatus::cases(), or null; { kind: "env", name, find, from, to },
 * an environment variable, to `find` where it's "set", in .env files, or where it's
 * "read", by the app; or null. `from` and `to` are where it is in the line.
 */
export function targetAt(text, column, file) {
  if (isDotenv(file)) return inDotenv(text, column);
  const target =
    rustModule(text, column, file) ??
    envRead(text, column) ??
    markdownLink(text, column, file) ??
    quoted(text, column, file) ??
    nameAt(text, column, file);
  // Text in quotes, or a link, that isn't a file: nothing to go to, though it has names.
  return target?.kind === "text" ? null : target;
}

// --- Environment variables ---------------------------------------------------------------
// In a .env file, a variable's name goes to where the app reads it, as Laravel's
// config/*.php do with env('NAME'); and the app's reading it, to where it's set.

const ENV_NAME = "[A-Za-z_][A-Za-z0-9_]*";

// Where a program reads a variable, by its name: in PHP, env(), getenv(), Env::get(),
// $_ENV and $_SERVER; in JavaScript, process.env and import.meta.env; and Python's,
// Go's, Rust's and Ruby's. Each ends with the name, or its closing quote.
const ENV_READS = [
  // Not a method of the same name, as $app->env('local'), which isn't one.
  new RegExp(`(?:(?<![\\w$>.])(?:env|getenv)|Env::get|os\\.Getenv|env::var(?:_os)?|ENV\\.fetch|os\\.environ\\.get)\\(\\s*(['"])(${ENV_NAME})\\1`, "g"),
  new RegExp(`(?:\\$_(?:ENV|SERVER)|process\\.env|os\\.environ|\\bENV)\\[\\s*(['"])(${ENV_NAME})\\1`, "g"),
  new RegExp(`(?:process|import\\.meta)\\.env\\.()(${ENV_NAME})`, "g"),
];

// The variable a program reads at the column, to go to where it's set.
function envRead(text, column) {
  for (const pattern of ENV_READS) {
    for (const match of text.matchAll(pattern)) {
      const name = match[2];
      const to = match.index + match[0].length - match[1].length;
      const from = to - name.length;
      if (column >= from && column <= to) return { kind: "env", name, find: "set", from, to };
    }
  }
  return null;
}

// In a .env file: a variable's name, at the line's start, goes to where it's read; one
// a value refers to, as ${NAME}, to where it's set.
function inDotenv(text, column) {
  const set = new RegExp(`^(\\s*(?:export\\s+)?)(${ENV_NAME})\\s*=`).exec(text);
  if (set) {
    const from = set[1].length;
    const to = from + set[2].length;
    if (column >= from && column <= to) return { kind: "env", name: set[2], find: "read", from, to };
  }
  for (const match of text.matchAll(new RegExp(`\\$\\{?(${ENV_NAME})`, "g"))) {
    const from = match.index + match[0].length - match[1].length;
    const to = from + match[1].length;
    if (column >= from && column <= to) return { kind: "env", name: match[1], find: "set", from, to };
  }
  return null;
}

/**
 * What to search for, to find where the environment variable `name` is set, in .env
 * files, as find_definitions takes them: { patterns }.
 */
export const envSetSearch = (name) => ({ patterns: [`^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=`] });

/**
 * What to search for, to find where a program reads the environment variable `name`,
 * as ENV_READS has it, in any file: { patterns, globs }.
 */
export function envReadSearch(name) {
  const quoted = `[[:space:]]*['"]${name}['"]`;
  return {
    patterns: [
      `(^|[^A-Za-z0-9_$>.])(env|getenv)\\(${quoted}`,
      `(Env::get|os\\.Getenv|env::var(_os)?|ENV\\.fetch|os\\.environ\\.get)\\(${quoted}`,
      `(\\$_(ENV|SERVER)|process\\.env|os\\.environ|(^|[^A-Za-z0-9_])ENV)\\[${quoted}`,
      `(process|import\\.meta)\\.env\\.${name}([^A-Za-z0-9_$]|$)`,
    ],
    globs: [],
  };
}

// `mod name;` in Rust: the file that's the module, name.rs or name/mod.rs, beside a
// mod.rs, lib.rs or main.rs, or otherwise in a folder named for the file.
function rustModule(text, column, file) {
  if (extensionOf(file) !== "rs") return null;
  const match = /^(\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+)([A-Za-z_][A-Za-z0-9_]*)\s*;/.exec(text);
  if (!match) return null;
  const from = match[1].length;
  const to = from + match[2].length;
  if (column < from || column > to) return null;
  const name = file.split("/").pop();
  const folder = ["mod.rs", "lib.rs", "main.rs"].includes(name) ? folderOf(file) : file.slice(0, -".rs".length);
  const within = (path) => (folder ? `${folder}/${path}` : path);
  return { kind: "path", paths: [within(`${match[2]}.rs`), within(`${match[2]}/mod.rs`)], from, to };
}

// A Markdown link's target, [text](target), relative to the file.
function markdownLink(text, column, file) {
  if (!isMarkdown(file)) return null;
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const from = match.index + 2;
    const to = from + match[1].length;
    if (column < from || column > to) continue;
    const target = decoded(match[1].replace(/#.*$/, ""));
    // A web address, or a place in the same file, isn't a file here.
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: "text" };
    return { kind: "path", paths: pathsOf(target, file), from, to };
  }
  return null;
}

// "%20" and the like in a link, as the characters they stand for.
function decoded(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

// A quoted string the column is in. One that could be a file's path is that, as in an
// import, a require, an include or an @import; another, plain text, isn't anything.
// In Markdown, only `code` is quoted, as its quotes are prose's. In Rust, ' starts a
// lifetime or a character as often as a string. Elsewhere, ' after a letter is an
// apostrophe, as in a comment's "don't"; and in a `template`, ${...} is code.
function quoted(text, column, file) {
  const quotes = isMarkdown(file) ? ["`"] : extensionOf(file) === "rs" ? ['"'] : ['"', "'", "`"];
  let open = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!open) {
      if (quotes.includes(char) && !(char === "'" && /[A-Za-z0-9]/.test(text[i - 1] ?? ""))) open = { quote: char, at: i };
    } else if (char === "\\") {
      i++;
    } else if (open.quote === "`" && char === "$" && text[i + 1] === "{" && !isMarkdown(file)) {
      const end = closingBrace(text, i + 1);
      if (column > i + 1 && column <= end) return null;
      i = end;
    } else if (char === open.quote) {
      if (column > open.at && column <= i) {
        const spec = text.slice(open.at + 1, i);
        const looksLikePath = /^[\w@.~\-/]+$/.test(spec) && (spec.includes("/") || /\.\w+$/.test(spec));
        return looksLikePath ? { kind: "path", paths: pathsOf(spec, file), from: open.at + 1, to: i } : { kind: "text" };
      }
      open = null;
    }
  }
  return null;
}

// Where the } closing the { at `at` is, or the line's end.
function closingBrace(text, at) {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return text.length;
}

// Extensions a path in an import can leave off, for a file, or a folder's index file.
const LEFT_OFF = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".json", ".css", ".scss"];

/**
 * The files `spec`, a path written in `file`, could mean, most likely first: from the
 * file's folder, or for one that doesn't start with . or /, the repository's top too;
 * each as written, then with an extension left off, or as a folder's index file.
 */
export function pathsOf(spec, file) {
  const bases = [];
  if (spec.startsWith("/")) bases.push(normalized(spec.slice(1)));
  else {
    bases.push(normalized(folderOf(file) ? `${folderOf(file)}/${spec}` : spec));
    if (!spec.startsWith(".")) bases.push(normalized(spec));
  }
  return bases
    .filter((base) => base != null)
    .flatMap((base) => [base, ...LEFT_OFF.map((ext) => base + ext), ...LEFT_OFF.map((ext) => `${base}/index${ext}`)]);
}

// A path from the repository's top with its . and .. taken out, or null if it leaves it.
function normalized(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

// The name the column's in or just after, unless it's one of the language's keywords or
// a number.
function nameAt(text, column, file) {
  let from = column;
  let to = column;
  while (from > 0 && NAME.test(text[from - 1])) from--;
  while (to < text.length && NAME.test(text[to])) to++;
  // PHP's $ is its variables', not their names'.
  if (extensionOf(file) === "php" && text[from] === "$") from++;
  const name = text.slice(from, to);
  const owner = /([A-Za-z_][A-Za-z0-9_]*)::$/.exec(text.slice(0, from))?.[1] ?? null;
  // After ::, a keyword is a name of what it's in, as Rust's Vec::new.
  if (!name || /^[0-9]/.test(name) || (languageOf(file).keywords.has(name) && !owner)) return null;
  return { kind: "name", name, owner, from, to };
}

// --- Where a name is defined ------------------------------------------------------------

// For each kind of file: the files a name used in one is likely defined in, and the
// patterns of the lines that would define it, <name> standing for the name. POSIX extended
// regular expressions, as git grep takes them, so no \b or \s.
const S = "[[:space:]]";
const words = (list) => new Set(list.split(" "));
// JavaScript and TypeScript, and components with them in, which import by path.
const SCRIPT = {
  extensions: ["js", "mjs", "cjs", "jsx", "ts", "tsx", "vue", "svelte"],
  globs: ["*.js", "*.mjs", "*.cjs", "*.jsx", "*.ts", "*.tsx", "*.vue", "*.svelte"],
  // Not those that are names too, as from, of, get, set and type are.
  keywords: words(
    "async await break case catch class const continue debugger default delete do else enum export extends false " +
      "finally for function if implements import in instanceof interface let new null return super switch this throw " +
      "true try typeof undefined var void while with yield",
  ),
  patterns: [
    `(^|[^A-Za-z0-9_$.])(function\\*?|class|interface|type|enum|namespace)${S}+<name>(${EDGE}|$)`,
    `(^|[^A-Za-z0-9_$.])(const|let|var)${S}+<name>${S}*([=:;,]|$)`,
    // A method, in a class or an object.
    `^${S}*((async|static|get|set|public|private|protected|readonly|override)${S}+)*<name>${S}*\\([^)]*\\)${S}*(:[^{]*)?\\{`,
    // A property, in an object or a TypeScript interface, of any value or type, its
    // name quoted or not; or a class's field, with a modifier or #.
    `^${S}*["']?<name>["']?${S}*\\??${S}*:`,
    `^${S}*((static|readonly|private|public|protected|declare|override|accessor)${S}+)+#?<name>${S}*[?!]?${S}*[=:;]`,
    `^${S}*#<name>${S}*[=;]`,
  ],
};

const LANGUAGES = [
  SCRIPT,
  {
    extensions: ["rs"],
    globs: ["*.rs"],
    keywords: words(
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move " +
        "mut pub ref return self Self static struct super trait true type unsafe use where while",
    ),
    patterns: [`(^|[^A-Za-z0-9_])(fn|struct|enum|trait|type|union|mod|const|static|macro_rules!)${S}+<name>([^A-Za-z0-9_]|$)`],
  },
  {
    extensions: ["py", "pyi"],
    globs: ["*.py", "*.pyi"],
    keywords: words(
      "and as assert async await break class continue def del elif else except False finally for from global if " +
        "import in is lambda None nonlocal not or pass raise return self True try while with yield",
    ),
    patterns: [`^${S}*(async${S}+)?(def|class)${S}+<name>([^A-Za-z0-9_]|$)`, `^<name>${S}*(:[^=]*)?=([^=]|$)`],
  },
  {
    extensions: ["go"],
    globs: ["*.go"],
    keywords: words(
      "break case chan const continue default defer else fallthrough false for func go goto if import interface map " +
        "nil package range return select struct switch true type var",
    ),
    patterns: [`^func${S}+(\\([^)]*\\)${S}*)?<name>${S}*[[(]`, `^${S}*(type|const|var)${S}+<name>([^A-Za-z0-9_]|$)`],
  },
  {
    extensions: ["php"],
    globs: ["*.php"],
    keywords: words(
      "abstract and array as break case catch class clone const continue declare default do echo else elseif empty " +
        "enum extends false final finally fn for foreach function global if implements include instanceof interface " +
        "isset list match namespace new null or parent print private protected public readonly require return self " +
        "static switch this throw trait true try unset use var while yield",
    ),
    patterns: [`function${S}+&?<name>${S}*\\(`, `(class|interface|trait|enum)${S}+<name>([^A-Za-z0-9_]|$)`, `const${S}+<name>${S}*=`],
  },
  {
    extensions: ["rb"],
    globs: ["*.rb"],
    keywords: words(
      "alias and begin break case class def do else elsif end ensure false for if in module next nil not or redo " +
        "rescue retry return self super then true undef unless until when while yield",
    ),
    patterns: [`^${S}*def${S}+(self\\.)?<name>([^A-Za-z0-9_?!]|$)`, `^${S}*(class|module)${S}+<name>([^A-Za-z0-9_]|$)`],
  },
];

// For other files, the words that start definitions in many languages, in any file.
const ANY_LANGUAGE = {
  globs: [],
  keywords: words("break case class const continue def do else false fn for func function if new nil null return self this true var while"),
  patterns: [
    `(^|[^A-Za-z0-9_$])(class|interface|struct|enum|trait|record|object|protocol|typedef|type)${S}+<name>([^A-Za-z0-9_$]|$)`,
    `(^|[^A-Za-z0-9_$])(fun|func|def|function|fn|sub|proc)${S}+<name>([^A-Za-z0-9_$]|$)`,
    // A C-like function: a type, then the name and its parameters, at the line's start.
    `^[A-Za-z_][A-Za-z0-9_ \t*&<>:,]*[ \t*&]<name>${S}*\\([^;]*$`,
  ],
};

const languageOf = (file) => LANGUAGES.find((l) => l.extensions.includes(extensionOf(file))) ?? ANY_LANGUAGE;

/**
 * What to search for, to find where `name`, used in `file`, is defined: { patterns,
 * globs }, the patterns as find_definitions takes them, and globs for the files to
 * search, none meaning all.
 */
export function definitionSearch(name, file) {
  const { patterns, globs } = languageOf(file);
  // Names are made of letters, digits, _ and $, of which only $ means anything here.
  const escaped = name.replaceAll("$", "\\$");
  return { patterns: patterns.map((pattern) => pattern.replaceAll("<name>", escaped)), globs };
}

/** Whether `file` is JavaScript or TypeScript, or a component with it in, which imports by path. */
export const importsByPath = (file) => SCRIPT.extensions.includes(extensionOf(file));

/**
 * Where `name` is imported from in `text`, a JavaScript file or a Vue component:
 * { spec, named, original }, the path as written, whether it's one of the file's names
 * (as `import { name }`) rather than the file itself (`import name`), and for one, its
 * name there, which `import { original as name }` renames; or null.
 */
export function importOf(text, name) {
  for (const match of text.matchAll(/import\s+([^'"`;]*?)\s+from\s+(['"`])([^'"`]+)\2/g)) {
    const [, what, , spec] = match;
    const braces = /\{([^}]*)\}/.exec(what);
    for (const part of braces?.[1].split(",") ?? []) {
      const [original, local = original] = part.trim().split(/\s+as\s+/);
      if (local === name) return { spec, named: true, original };
    }
    const whole = what.replace(/\{[^}]*\}/, "").split(",").some((part) => part.trim().replace(/^\*\s+as\s+/, "") === name);
    if (whole) return { spec, named: false, original: null };
  }
  return null;
}

/**
 * The places a search found, `matches` ({ file, line, text }), most likely first: in
 * `file`, the one it's used in, then its folder, then the rest, by path. Without the
 * line it's used on, `line` in `file`, which would go nowhere.
 */
export function ranked(matches, file, line) {
  const folder = folderOf(file);
  const nearness = (match) => (match.file === file ? 0 : folderOf(match.file) === folder ? 1 : 2);
  return matches
    .filter((match) => !(match.file === file && match.line === line))
    .map((match, i) => ({ match, i }))
    .sort((a, b) => nearness(a.match) - nearness(b.match) || a.match.file.localeCompare(b.match.file) || a.i - b.i)
    .map(({ match }) => match);
}
