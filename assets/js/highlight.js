// A small syntax highlighter for the demos' code: enough for their few lines of
// JavaScript, Vue, Markdown and .env, not a general one. Each line is highlighted on its
// own, so a string or comment running over lines isn't followed; the demos have none.

const KEYWORDS = new Set(
  'import from export function const let var return if else new await async true false null undefined of in for while'.split(' '),
);

// Comments, strings, numbers, tags, a name that's called, and any other name, in that order.
const TOKEN = /(\/\/.*$|<!--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|(<\/?[a-zA-Z][\w-]*|\/?>)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;

export function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const wrap = (kind, text) => `<span class="syn-${kind}">${escapeHtml(text)}</span>`;

/** One line of code as HTML, its parts in spans whose classes name what they are. */
export function highlight(line, language) {
  if (language === 'env') return highlightEnv(line);
  if (language === 'md') return /^#/.test(line) ? wrap('keyword', line) : escapeHtml(line);
  let html = '';
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    const [text, comment, string, number, tag, called, name] = match;
    const word = called || name;
    const kind = comment ? 'comment'
      : string ? 'string'
      : number ? 'number'
      : tag ? 'tag'
      : KEYWORDS.has(word) ? 'keyword'
      : called ? 'name'
      : null;
    html += escapeHtml(line.slice(last, match.index)) + (kind ? wrap(kind, text) : escapeHtml(text));
    last = match.index + text.length;
  }
  return html + escapeHtml(line.slice(last));
}

function highlightEnv(line) {
  if (/^\s*#/.test(line)) return wrap('comment', line);
  const setting = line.match(/^([A-Za-z_][A-Za-z0-9_]*)(=)(.*)$/);
  if (!setting) return escapeHtml(line);
  return wrap('name', setting[1]) + escapeHtml(setting[2]) + wrap('string', setting[3]);
}
