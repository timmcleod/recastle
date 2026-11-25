// .env files, and those named for them, as .env.example, .env.local and production.env:
// read here, once, for the editor to color (CodeMirror, see codeEditor.js), diffs to
// color (highlightWorker.js, which has highlight.js color other files) and Ctrl+click to
// go from (definitions.js), so the three agree. Nothing here imports anything, for the
// worker to load.
//
// A line is NAME=value, perhaps after `export`, or a # comment. In a value, ${NAME} or
// $NAME refers to another variable, but not in single quotes; true, false, null and
// numbers stand on their own; the rest is text, quoted or not. A quote opens a quoted
// value only at its start, and one left open goes on over the lines after, as a key
// or certificate does. A # starts a comment at a line's start, after a space, or after
// a quoted value's closing quote; elsewhere, as in a#b, it's text.

// Files named for .env that are something else: code and settings named after it, as
// Laravel's old .env.local.php, and encrypted ones, which aren't anything to read.
const NOT_DOTENV = /\.(php|js|mjs|cjs|ts|json|ya?ml|toml|xml|py|rb|sh|encrypted|enc|gpg|age)$/i;

/** Whether `file` (a path) is a .env file, or one named for one, but not direnv's .envrc, a shell script. */
export const isDotenv = (file) => /(^|\/)(\.env(\.[^/]*)?|[^/]+\.env)$/i.test(file ?? "") && !NOT_DOTENV.test(file);

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*/;
const REFERENCE = /^\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/;
const LITERAL = /^(true|false|null)(?=\s|$)/i;
const NUMBER = /^-?\d+(\.\d+)?(?=\s|$)/;

/** A state to read a file's lines with, from its first: tokenizeLine carries it from each line to the next. */
export const startState = () => ({ quote: null });

/**
 * The pieces of `line` worth coloring, in order, as { from, to, kind }: "keyword"
 * (export), "name" (a variable's, setting it), "reference" (another's, in a value, as
 * { from, to, kind, name }), "string", "literal", "number" or "comment". `state`,
 * from startState or the line before, is changed for the line after.
 */
export function tokenizeLine(line, state) {
  const tokens = [];
  let pos = 0;
  // What's next: the "name", the "equals", the "value", a quoted value's text, or
  // what's "after" one, where only a comment can be.
  let at = state.quote ? "quoted" : "name";
  // Takes the line up to `to` as a piece of `kind`, or none; the same kind as the piece
  // just before it, as a quote and the text it opens, it's one with it, but for a
  // reference, which has its own name.
  const take = (to, kind, more) => {
    const last = tokens.at(-1);
    if (kind && to > pos && last?.kind === kind && last.to === pos && kind !== "reference") last.to = to;
    else if (kind && to > pos) tokens.push({ from: pos, to, kind, ...more });
    pos = to;
  };
  const rest = () => line.slice(pos);
  const reference = () => {
    const match = REFERENCE.exec(rest());
    if (match) take(pos + match[0].length, "reference", { name: match[1].replace(/^\{|\}$/g, "") });
    return !!match;
  };
  // Where the value starts, for a quote to open it only there.
  let valueAt = -1;

  while (pos < line.length) {
    if (at === "quoted") {
      const quote = state.quote;
      let start = pos;
      while (pos < line.length) {
        const char = line[pos];
        if (char === "\\" && quote !== "'") {
          pos = Math.min(pos + 2, line.length);
        } else if (char === quote) {
          pos++;
          state.quote = null;
          break;
        } else if (quote === '"' && char === "$" && REFERENCE.test(line.slice(pos))) {
          const end = pos;
          pos = start;
          take(end, "string");
          reference();
          start = pos;
        } else pos++;
      }
      const end = pos;
      pos = start;
      take(end, "string");
      at = state.quote ? "quoted" : "after";
      continue;
    }
    const space = /^\s+/.exec(rest());
    if (space) {
      take(pos + space[0].length, null);
      continue;
    }
    if (line[pos] === "#" && (at !== "value" || pos === valueAt || /\s/.test(line[pos - 1]))) {
      take(line.length, "comment");
      break;
    }
    if (at === "name") {
      if (!tokens.length && /^export\s/.test(rest())) {
        take(pos + "export".length, "keyword");
        continue;
      }
      const name = NAME.exec(rest());
      if (!name) break;
      take(pos + name[0].length, "name");
      at = "equals";
    } else if (at === "equals") {
      if (line[pos] !== "=") break;
      take(pos + 1, null);
      at = "value";
      valueAt = pos;
    } else if (at === "value") {
      const wordStart = pos === valueAt || /\s/.test(line[pos - 1]);
      if (pos === valueAt && /["'`]/.test(line[pos])) {
        state.quote = line[pos];
        take(pos + 1, "string");
        at = "quoted";
      } else if (wordStart && LITERAL.test(rest())) {
        take(pos + LITERAL.exec(rest())[0].length, "literal");
      } else if (wordStart && NUMBER.test(rest())) {
        take(pos + NUMBER.exec(rest())[0].length, "number");
      } else if (!reference()) {
        // Text, up to a space, which a comment may follow, or a reference.
        let end = pos + 1;
        while (end < line.length && !/\s/.test(line[end]) && !(line[end] === "$" && REFERENCE.test(line.slice(end)))) end++;
        take(end, "string");
      }
    } else break;
  }
  return tokens;
}

// The editor's names for the kinds, as the tags CodeMirror colors them by: a name and a
// reference in the type's color, a literal and a number in the number's.
const EDITOR = { keyword: "keyword", name: "attributeName", reference: "attributeName", string: "string", literal: "bool", number: "number", comment: "comment" };

/** For CodeMirror's StreamLanguage: each line read by tokenizeLine as it starts, then given out a piece at a time. */
export const dotenvParser = {
  name: "dotenv",
  startState: () => ({ ...startState(), tokens: [] }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (stream.sol()) state.tokens = tokenizeLine(stream.string, state);
    const next = state.tokens.find((token) => token.to > stream.pos);
    if (!next) {
      stream.skipToEnd();
      return null;
    }
    if (next.from > stream.pos) {
      stream.pos = next.from;
      return null;
    }
    stream.pos = next.to;
    return EDITOR[next.kind];
  },
};

// Diffs' names for the kinds, as highlight.js's classes, which styles.css colors as the
// editor colors the kinds.
const DIFFS = { keyword: "keyword", name: "variable", reference: "template-variable", string: "string", literal: "literal", number: "number", comment: "comment" };

const escaped = (text) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[char]);

/** `text` highlighted as HTML, as highlight.js would, with its classes. */
export function dotenvHtml(text) {
  const state = startState();
  return text
    .split("\n")
    .map((line) => {
      let html = "";
      let pos = 0;
      for (const { from, to, kind } of tokenizeLine(line, state)) {
        html += `${escaped(line.slice(pos, from))}<span class="hljs-${DIFFS[kind]}">${escaped(line.slice(from, to))}</span>`;
        pos = to;
      }
      return html + escaped(line.slice(pos));
    })
    .join("\n");
}
