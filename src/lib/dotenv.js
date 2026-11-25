// .env files, and those named for them, as .env.example, .env.local and production.env
// (but not direnv's .envrc, a shell script): highlighted the
// same in the editor (CodeMirror, see codeEditor.js) and in diffs (highlight.js, see
// highlightWorker.js), each by a grammar here, as neither has one, and each colors
// differently by its own names for things. Lines are NAME=value, perhaps after
// `export`, or # comments. The names, and ${NAME} or $NAME in a value, are variables;
// a value is text, quoted or not, but for true, false, null and numbers; # after a
// space starts a comment. Nothing here imports anything, for the worker to load.

/** Whether `file` (a path) is a .env file, or one named for one. */
export const isDotenv = (file) => /(^|\/)(\.env(\.[^/]*)?|[^/]+\.env)$/i.test(file ?? "");

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*/;
// The same, before an =, for highlight.js, which matches anywhere.
const NAME_PATTERN = /[A-Za-z_][A-Za-z0-9_.-]*(?=\s*=)/;
const REFERENCE = /^\$(\{[^}]*\}?|[A-Za-z_][A-Za-z0-9_]*)/;
// A value that's a word or number of its own, up to a space, a comment or the line's end.
const LITERAL = /^(true|false|null)(?=\s|$)/i;
const NUMBER = /^-?\d+(\.\d+)?(?=\s|$)/;

/**
 * For CodeMirror's StreamLanguage: tokens named for the tags they're colored as, the
 * names attributeName (the type's color, as highlight.js's variable is), bool and
 * number (the number's), string, comment and keyword.
 */
export const dotenvParser = {
  name: "dotenv",
  // `at`: what's next on the line, "name", "equals", "value" or "after" a quoted one;
  // `quote`: the quote a value's in, which a double quote's can go on to other lines.
  startState: () => ({ at: "name", quote: null }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (stream.sol() && !state.quote) state.at = "name";
    if (state.quote) return inQuotes(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#" && (state.at !== "value" || stream.sol() || /\s/.test(stream.string[stream.pos - 1]))) {
      stream.skipToEnd();
      return "comment";
    }
    if (state.at === "name") {
      if (stream.match(/^export(?=\s)/)) return "keyword";
      if (stream.match(NAME)) {
        state.at = "equals";
        return "attributeName";
      }
      stream.skipToEnd();
      return null;
    }
    if (state.at === "equals") {
      if (stream.eat("=")) state.at = "value";
      else stream.skipToEnd();
      return null;
    }
    if (state.at === "value") {
      const quote = stream.eat(/["'`]/);
      if (quote) {
        state.quote = quote;
        return "string";
      }
      if (stream.match(LITERAL)) return "bool";
      if (stream.match(NUMBER)) return "number";
      if (stream.match(REFERENCE)) return "attributeName";
      // Text, up to a reference, or a space, which a comment may follow.
      stream.next();
      stream.eatWhile(/[^\s$]/);
      return "string";
    }
    // After a quoted value, only a comment.
    stream.skipToEnd();
    return null;
  },
};

// Inside a quoted value: text, and in double quotes, references and escaped characters.
function inQuotes(stream, state) {
  const double = state.quote === '"';
  if (double && stream.match(REFERENCE)) return "attributeName";
  while (!stream.eol()) {
    const char = stream.next();
    if (char === state.quote) {
      state.quote = null;
      state.at = "after";
      break;
    }
    if (char === "\\" && state.quote !== "'") stream.next();
    else if (double && char === "$" && REFERENCE.test(stream.string.slice(stream.pos - 1))) {
      stream.backUp(1);
      break;
    }
  }
  return "string";
}

/**
 * For highlight.js: the same, its names classing them as the editor colors them:
 * variable (and template-variable, for references) in the type's color, literal and
 * number in the number's, string, comment and keyword.
 */
export function dotenvGrammar(hljs) {
  const reference = { scope: "template-variable", match: /\$(\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)/ };
  const comment = hljs.COMMENT(/(?<=^|\s)#/, /$/);
  // After a name, started at once (not at its begin): the = plain, as in the editor,
  // then the value, its text unquoted or quoted, a word or number on its own before
  // text, which would take it in otherwise.
  const value = {
    begin: /(?==)/,
    end: /$/,
    contains: [
      { match: /=/ },
      comment,
      reference,
      { scope: "string", begin: /"/, end: /"/, contains: [hljs.BACKSLASH_ESCAPE, reference] },
      { scope: "string", begin: /'/, end: /'/ },
      { scope: "string", begin: /`/, end: /`/, contains: [hljs.BACKSLASH_ESCAPE] },
      { scope: "literal", match: /(true|false|null)(?=\s|$)/i },
      { scope: "number", match: /-?\d+(\.\d+)?(?=\s|$)/ },
      { scope: "string", match: /[^\s$"'`]+/ },
    ],
  };
  return {
    name: "dotenv",
    contains: [
      comment,
      { begin: [/^\s*/, /export/, /\s+/, NAME_PATTERN], beginScope: { 2: "keyword", 4: "variable" }, starts: value },
      { begin: [/^\s*/, NAME_PATTERN], beginScope: { 2: "variable" }, starts: value },
    ],
  };
}
