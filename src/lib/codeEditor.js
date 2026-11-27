import { Compartment, countColumn, EditorState, Facet, Prec, RangeSet, StateEffect, StateField, Text } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { gotoLine, highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { Chunk } from "@codemirror/merge";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";
import { isMac } from "./platform.js";
import { dotenvParser, isDotenv } from "./dotenv.js";

// The Files view's editor: CodeMirror, in Recastle's colors and fonts, loaded the first
// time a file is opened there. Each file's editor state is made here; FileEditor.vue
// shows one at a time and keeps those with edits that aren't saved.

// Recastle's colors, which follow its theme, so the editor needs no theme of its own.
const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    color: "var(--text-primary)",
    backgroundColor: "var(--content-bg)",
  },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, "Ubuntu Mono", "DejaVu Sans Mono", monospace',
    lineHeight: "18px",
  },
  ".cm-content": { caretColor: "var(--accent)", padding: "6px 0" },
  ".cm-gutters": {
    border: "none",
    color: "var(--text-tertiary)",
    backgroundColor: "var(--diff-gutter-bg)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px" },
  ".cm-activeLine": { backgroundColor: "var(--row-hover)" },
  ".cm-activeLineGutter": { color: "var(--text-secondary)", backgroundColor: "var(--row-selected)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 16%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, #f5c542 40%, transparent)", outline: "none" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, #f59e0b 60%, transparent)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)", outline: "none" },
  ".cm-foldPlaceholder": { border: "none", color: "var(--text-secondary)", backgroundColor: "var(--pill-bg)" },
  ".cm-tooltip": { border: "1px solid var(--border)", backgroundColor: "var(--content-bg)", color: "var(--text-primary)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { color: "#fff", backgroundColor: "var(--accent)" },
  ".cm-panels": { color: "var(--text-primary)", backgroundColor: "var(--sidebar-bg)" },
  ".cm-comment-gutter": { width: "20px" },
  ".cm-comment-gutter .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center", padding: "0" },
  ".cm-comment-button": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    borderRadius: "4px",
    backgroundColor: "var(--accent)",
    color: "#fff",
    cursor: "pointer",
  },
  ".cm-review-note": { padding: "1px 0" },
  // What Ctrl+click (⌘-click) goes to, under the pointer with the key held.
  ".cm-goto-link": { textDecoration: "underline", textUnderlineOffset: "2px", cursor: "pointer" },
  ".cm-changes-gutter": { width: "6px", backgroundColor: "var(--diff-gutter-bg)" },
  ".cm-changes-gutter .cm-gutterElement": { padding: "0", cursor: "pointer" },
  ".cm-change-mark": { height: "100%", width: "3px", margin: "0 1px", borderRadius: "1px" },
  ".cm-change-mark.added": { backgroundColor: "var(--diff-added-text)" },
  ".cm-change-mark.changed": { backgroundColor: "var(--ref-tag)" },
  ".cm-change-mark.removed": {
    width: "0",
    height: "0",
    margin: "0",
    borderTop: "4px solid transparent",
    borderBottom: "4px solid transparent",
    borderLeft: "5px solid var(--diff-removed-text)",
    transform: "translateY(-4px)",
  },
  ".cm-change-box": {
    margin: "2px 0 4px",
    borderTop: "1px solid var(--border)",
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--diff-removed-bg)",
    fontFamily: "system-ui, sans-serif",
  },
  ".cm-change-head": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 10px",
    fontSize: "12px",
    color: "var(--text-secondary)",
    backgroundColor: "var(--diff-hunk-bg)",
  },
  ".cm-change-head span": { flex: "1" },
  ".cm-change-head button": {
    padding: "1px 9px",
    border: "1px solid var(--border)",
    borderRadius: "5px",
    background: "var(--content-bg)",
    font: "inherit",
    color: "var(--text-primary)",
    cursor: "pointer",
  },
  ".cm-change-box pre": {
    margin: "0",
    padding: "4px 10px",
    fontFamily: 'ui-monospace, "SF Mono", Menlo, "Ubuntu Mono", monospace',
    fontSize: "12px",
    lineHeight: "18px",
    whiteSpace: "pre-wrap",
    color: "var(--text-primary)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 10px", fontSize: "12.5px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": { fontSize: "12.5px" },
  ".cm-textfield": {
    padding: "2px 6px",
    border: "1px solid var(--border)",
    borderRadius: "5px",
    color: "var(--text-primary)",
    backgroundColor: "var(--input-bg)",
  },
  ".cm-button": {
    border: "1px solid var(--border)",
    borderRadius: "5px",
    color: "var(--text-primary)",
    backgroundImage: "none",
    backgroundColor: "var(--content-bg)",
  },
});

// Code in the colors the rest of Recastle uses for it (see styles.css).
const highlighting = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.self], color: "var(--syntax-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--syntax-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syntax-comment)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: "var(--syntax-number)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.className, t.macroName],
    color: "var(--syntax-title)",
  },
  { tag: [t.typeName, t.namespace, t.attributeName], color: "var(--syntax-type)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--syntax-tag)" },
  { tag: t.heading, fontWeight: "bold", color: "var(--syntax-title)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.url, color: "var(--syntax-string)" },
  { tag: t.invalid, color: "var(--danger)" },
]);

const language = new Compartment();
const coloring = new Compartment();
const tabs = new Compartment();
const wrapping = new Compartment();
// The page's own callbacks, swapped when a state kept from an editor that's since gone
// is shown in a new one (see rebind).
const host = new Compartment();
const hostHooks = Facet.define({ combine: (values) => values[0] ?? {} });
const hostOf = ({ onSave, onChange, onCursor, goTo = null, review = null }) => [
  hostHooks.of({ onSave, onChange, onCursor, goTo }),
  reviewHooks.of(review),
];

/** How the text indents: tabs, or the smallest run of spaces most lines start with. */
function detectIndent(text) {
  const lines = text.split("\n", 2000);
  let tabbed = 0;
  let spaced = 0;
  const widths = new Map();
  let previous = 0;
  for (const line of lines) {
    if (line.startsWith("\t")) tabbed++;
    const spaces = /^ +/.exec(line)?.[0].length ?? 0;
    if (spaces && line.trim()) {
      spaced++;
      // The step from the line before, which is the indent unit for most code.
      const step = Math.abs(spaces - previous);
      if (step >= 2 && step <= 8) widths.set(step, (widths.get(step) ?? 0) + 1);
    }
    if (line.trim()) previous = spaces;
  }
  if (tabbed > spaced) return "\t";
  const [width] = [...widths.entries()].sort((a, b) => b[1] - a[1])[0] ?? [2];
  return " ".repeat(width);
}

/**
 * A new editor state for `text` from `file`. `onSave` runs on Cmd+S (Ctrl+S) and
 * `onChange` with each change to the text.
 */
// --- Lines changed since the last commit --------------------------------------------
// A bar beside each line added or changed since the last commit, and a mark where
// lines were removed, kept up to date while typing. Clicking one shows the lines as
// they were, with Revert to put them back.

const setCommitted = StateEffect.define();
// The start of the change being shown, or null.
const showChange = StateEffect.define();

const changes = StateField.define({
  create: () => ({ committed: null, chunks: [], shown: null }),
  update(value, tr) {
    let { committed, chunks, shown } = value;
    for (const effect of tr.effects) {
      if (effect.is(setCommitted)) {
        committed = effect.value == null ? null : Text.of(effect.value.split("\n"));
        chunks = committed ? Chunk.build(committed, tr.state.doc) : [];
        shown = null;
      } else if (effect.is(showChange)) {
        shown = effect.value;
      }
    }
    if (tr.docChanged && committed) {
      chunks = Chunk.updateB(chunks, committed, tr.state.doc, tr.changes);
      if (shown != null) shown = tr.changes.mapPos(shown);
    }
    return { committed, chunks, shown };
  },
  provide: (field) => EditorView.decorations.from(field, shownChange),
});

/** The change at `line` (a line's block), if any. */
function changeAt(chunks, line) {
  return chunks.find((c) => (c.fromB === c.toB ? c.fromB === line.from : c.fromB <= line.from && line.from < c.toB));
}

class ChangeMark extends GutterMarker {
  constructor(kind) {
    super();
    this.kind = kind;
  }
  eq(other) {
    return other.kind === this.kind;
  }
  toDOM() {
    const mark = document.createElement("div");
    mark.className = `cm-change-mark ${this.kind}`;
    mark.title = {
      added: "Added since the last commit. Click to see.",
      changed: "Changed since the last commit. Click to see how it was.",
      removed: "Lines removed here since the last commit. Click to see them.",
    }[this.kind];
    return mark;
  }
}
const MARKS = { added: new ChangeMark("added"), changed: new ChangeMark("changed"), removed: new ChangeMark("removed") };

const changeGutter = gutter({
  class: "cm-changes-gutter",
  markers(view) {
    const { doc } = view.state;
    const marks = [];
    for (const chunk of view.state.field(changes).chunks) {
      if (chunk.fromB === chunk.toB) {
        marks.push(MARKS.removed.range(doc.lineAt(Math.min(chunk.fromB, doc.length)).from));
        continue;
      }
      const kind = chunk.fromA === chunk.toA ? "added" : "changed";
      for (let pos = chunk.fromB; pos < chunk.toB && pos <= doc.length; ) {
        const line = doc.lineAt(pos);
        marks.push(MARKS[kind].range(line.from));
        pos = line.to + 1;
      }
    }
    return RangeSet.of(marks, true);
  },
  domEventHandlers: {
    mousedown(view, line) {
      const { chunks, shown } = view.state.field(changes);
      const chunk = changeAt(chunks, line);
      if (!chunk) return false;
      const open = shown != null && chunk.fromB <= shown && shown <= chunk.endB;
      view.dispatch({ effects: showChange.of(open ? null : chunk.fromB) });
      return true;
    },
  },
  initialSpacer: () => MARKS.added,
});

// The lines as they were at the last commit, below the change (above it, for lines
// removed), with Revert and Close.
class ChangeWidget extends WidgetType {
  constructor(before, chunk) {
    super();
    this.before = before;
    this.chunk = chunk;
  }
  eq(other) {
    return other.before === this.before && other.chunk.fromB === this.chunk.fromB && other.chunk.toB === this.chunk.toB;
  }
  toDOM(view) {
    const box = document.createElement("div");
    box.className = "cm-change-box";
    const head = document.createElement("div");
    head.className = "cm-change-head";
    const label = document.createElement("span");
    label.textContent = this.before ? "At the last commit:" : "New since the last commit.";
    const revert = document.createElement("button");
    revert.textContent = this.before ? "Revert" : "Remove";
    revert.title = this.before ? "Put these lines back as they were" : "Remove these new lines";
    revert.onclick = () => revertChange(view, this.chunk);
    const close = document.createElement("button");
    close.textContent = "Close";
    close.onclick = () => view.dispatch({ effects: showChange.of(null) });
    head.append(label, revert, close);
    box.append(head);
    if (this.before) {
      const lines = document.createElement("pre");
      lines.textContent = this.before.replace(/\n$/, "");
      box.append(lines);
    }
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

function shownChange({ committed, chunks, shown }) {
  if (shown == null || !committed) return Decoration.none;
  const chunk = chunks.find((c) => c.fromB <= shown && shown <= c.endB);
  if (!chunk) return Decoration.none;
  const before = committed.sliceString(chunk.fromA, Math.min(chunk.toA, committed.length));
  const widget = Decoration.widget({ widget: new ChangeWidget(before, chunk), block: true, side: chunk.fromB === chunk.toB ? -1 : 1 });
  return Decoration.set([widget.range(chunk.fromB === chunk.toB ? chunk.fromB : chunk.endB)]);
}

/** Puts a change's lines back as they were at the last commit. */
function revertChange(view, chunk) {
  const { committed } = view.state.field(changes);
  const { doc } = view.state;
  // A chunk at the end may run one past it, for the line break the last line lacks.
  const pastEndA = chunk.toA > committed.length;
  const pastEndB = chunk.toB > doc.length;
  let insert = committed.sliceString(chunk.fromA, Math.min(chunk.toA, committed.length));
  if (pastEndB && !pastEndA && insert.endsWith("\n")) insert = insert.slice(0, -1);
  if (pastEndA && !pastEndB && chunk.toA > chunk.fromA) insert += "\n";
  view.dispatch({ changes: { from: chunk.fromB, to: Math.min(chunk.toB, doc.length), insert }, effects: showChange.of(null) });
  view.focus();
}

/** Marks the lines that differ from `text`, the file as of the last commit, or none if it's null. */
export function setCommittedText(view, text) {
  view.dispatch({ effects: setCommitted.of(text) });
}

// --- Review comments ----------------------------------------------------------------
// Comments for the agent under the lines they're on (see review.js), shown by the
// page's own components in boxes the editor makes room for, and a button beside the
// line under the pointer for writing one. The boxes follow their lines as the text
// changes around them.

/**
 * What the page gives the editor for comments: mount(el, data) and unmount(el) show a
 * comment's box, and comment(view, line) starts one on the line (a line number), or on
 * the lines selected, if it's one of them or null.
 */
const reviewHooks = Facet.define({ combine: (values) => values[0] ?? null });

// [{ key, version, pos, data }]: each box, after the end of its line at `pos`.
const setNotes = StateEffect.define();
const notesField = StateField.define({
  create: () => [],
  update(notes, tr) {
    for (const effect of tr.effects) if (effect.is(setNotes)) return effect.value;
    return tr.docChanged ? notes.map((note) => ({ ...note, pos: tr.changes.mapPos(note.pos, 1) })) : notes;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (notes) =>
      Decoration.set(
        notes.map((note) => Decoration.widget({ widget: new NoteWidget(note), block: true, side: 1 }).range(note.pos)),
        true,
      ),
    ),
});

class NoteWidget extends WidgetType {
  constructor(note) {
    super();
    this.note = note;
  }
  eq(other) {
    return other.note.key === this.note.key && other.note.version === this.note.version;
  }
  toDOM(view) {
    const box = document.createElement("div");
    box.className = "cm-review-note";
    const hooks = view.state.facet(reviewHooks);
    box.unmountNote = () => hooks?.unmount(box);
    hooks?.mount(box, this.note.data);
    return box;
  }
  destroy(box) {
    box.unmountNote?.();
  }
  ignoreEvent() {
    return true;
  }
}

/** Shows the comment boxes: [{ key, version, line (the line number it goes under), data }]. */
export function setReviewNotes(view, notes) {
  const { doc } = view.state;
  const placed = notes
    .filter((n) => n.line >= 1 && n.line <= doc.lines)
    .map(({ key, version, line, data }) => ({ key, version, pos: doc.line(line).to, data }));
  view.dispatch({ effects: setNotes.of(placed) });
}

// The line under the pointer, by where it starts, or null.
const setHover = StateEffect.define();
const hoverField = StateField.define({
  create: () => null,
  update(at, tr) {
    for (const effect of tr.effects) if (effect.is(setHover)) at = effect.value;
    return at != null && tr.docChanged ? tr.changes.mapPos(at) : at;
  },
});

class CommentButton extends GutterMarker {
  eq() {
    return true;
  }
  toDOM() {
    const button = document.createElement("div");
    button.className = "cm-comment-button";
    button.title = "Comment for the agent";
    button.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';
    return button;
  }
}
const COMMENT_BUTTON = new CommentButton();

const commentGutter = gutter({
  class: "cm-comment-gutter",
  markers(view) {
    const at = view.state.field(hoverField);
    return at == null || at > view.state.doc.length ? RangeSet.empty : RangeSet.of([COMMENT_BUTTON.range(at)]);
  },
  domEventHandlers: {
    mousedown(view, line) {
      if (view.state.field(hoverField) !== line.from) return false;
      view.state.facet(reviewHooks)?.comment(view, view.state.doc.lineAt(line.from).number);
      return true;
    },
  },
});

// Over the whole editor, gutters included, so the button stays while the pointer moves
// from the line onto it. The line is found by height, which works over the gutters too.
const hoverTracking = ViewPlugin.define((view) => {
  const move = (event) => {
    const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
    const from = view.state.doc.lineAt(Math.min(block.from, view.state.doc.length)).from;
    if (from !== view.state.field(hoverField)) view.dispatch({ effects: setHover.of(from) });
  };
  const leave = () => {
    if (view.state.field(hoverField) != null) view.dispatch({ effects: setHover.of(null) });
  };
  view.dom.addEventListener("mousemove", move);
  view.dom.addEventListener("mouseleave", leave);
  return {
    destroy() {
      view.dom.removeEventListener("mousemove", move);
      view.dom.removeEventListener("mouseleave", leave);
    },
  };
});

/**
 * The lines a comment started at `line` is on, as [first, last] line numbers: the
 * lines selected, if `line` is one of them or null, and otherwise just `line`.
 */
export function commentLines(state, line = null) {
  const { from, to, empty } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  // A selection ending at the start of a line leaves that line out.
  let last = state.doc.lineAt(to).number;
  if (!empty && last > first && state.doc.line(last).from === to) last--;
  if (line == null) return [first, last];
  return !empty && line >= first && line <= last ? [first, last] : [line, line];
}

/** The text of lines `first` to `last`. */
export function linesText(state, first, last) {
  const texts = [];
  for (let n = first; n <= last; n++) texts.push(state.doc.line(n).text);
  return texts;
}

const reviewExtensions = (hooks) =>
  hooks
    ? [
        notesField,
        hoverField,
        commentGutter,
        hoverTracking,
        Prec.highest(keymap.of([{ key: "Mod-Shift-c", run: (view) => (view.state.facet(reviewHooks)?.comment(view, null), true), preventDefault: true }])),
      ]
    : [];

// --- Going to a definition -----------------------------------------------------------
// With Ctrl (⌘) held, what's under the pointer that goes somewhere is underlined, as a
// link, and clicking it goes there. The page says what does and where to (see
// goToDefinition.js), by its `goTo` hook: at(text, column), a line's text and where in
// it, gives { from, to, ... } or null, and go(target, line, event) goes to what `at`
// gave, from line `line`. Alt+click adds a cursor instead (see basics, below).

const modHeld = (event) => (isMac ? event.metaKey : event.ctrlKey);

// What `pos` is on that goes somewhere: { from, to, target, line }, or null.
function linkAtPos(state, pos) {
  const goTo = state.facet(hostHooks).goTo;
  if (!goTo) return null;
  const line = state.doc.lineAt(pos);
  const target = goTo.at(line.text, pos - line.from);
  return target ? { from: line.from + target.from, to: line.from + target.to, target, line: line.number } : null;
}

/**
 * What's under the pointer at `x`, `y` in `view` that goes somewhere, as the page's goTo
 * hook says: { from, to, target, line }, or null. Only with the pointer on it, not on
 * the space beside it, which posAtCoords takes as nearest.
 */
export function linkUnder(view, x, y) {
  const pos = view.posAtCoords({ x, y });
  const link = pos == null ? null : linkAtPos(view.state, pos);
  if (!link) return null;
  const start = view.coordsAtPos(link.from, 1);
  const end = view.coordsAtPos(link.to, -1);
  const on = start && end && x >= start.left && x <= end.right && y >= Math.min(start.top, end.top) && y <= Math.max(start.bottom, end.bottom);
  return on ? link : null;
}

const setLink = StateEffect.define();
const linkMark = Decoration.mark({ class: "cm-goto-link" });
const linkField = StateField.define({
  create: () => null,
  update(link, tr) {
    for (const effect of tr.effects) if (effect.is(setLink)) link = effect.value;
    return tr.docChanged ? null : link;
  },
  provide: (field) => EditorView.decorations.from(field, (link) => (link ? Decoration.set([linkMark.range(link.from, link.to)]) : Decoration.none)),
});

// Underlines the link under the pointer while Ctrl (⌘) is held, as the pointer moves or
// the key's pressed with it still.
const linkHover = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.pointer = null;
      this.onKey = (event) => this.show(modHeld(event));
      this.onBlur = () => this.show(false);
      window.addEventListener("keydown", this.onKey);
      window.addEventListener("keyup", this.onKey);
      window.addEventListener("blur", this.onBlur);
    }
    show(held) {
      const { view, pointer } = this;
      const link = held && pointer ? linkUnder(view, pointer.x, pointer.y) : null;
      const shown = view.state.field(linkField);
      if (shown?.from !== link?.from || shown?.to !== link?.to) view.dispatch({ effects: setLink.of(link && { from: link.from, to: link.to }) });
    }
    destroy() {
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("keyup", this.onKey);
      window.removeEventListener("blur", this.onBlur);
    }
  },
  {
    eventHandlers: {
      mousemove(event) {
        this.pointer = { x: event.clientX, y: event.clientY };
        this.show(modHeld(event));
      },
      mouseleave() {
        this.pointer = null;
        this.show(false);
      },
    },
  },
);

const goToClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !modHeld(event)) return false;
    const link = linkUnder(view, event.clientX, event.clientY);
    if (!link) return false;
    event.preventDefault();
    // The cursor goes where the click was, for Back to come back to there.
    view.dispatch({ selection: { anchor: view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? link.from } });
    view.state.facet(hostHooks).goTo.go(link.target, link.line, event);
    return true;
  },
});

const goToDefinitions = [linkField, linkHover, Prec.highest(goToClick)];

/** Puts the cursor at the start of `line` (from 1), in the middle of the editor. */
export function showLine(view, line) {
  const { from } = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
  view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
}

/**
 * Where the file was left, to come back to with showPlace: the cursor, and how far it was
 * scrolled, which scrolling with the wheel leaves apart from the cursor. `scroll` is
 * passed in for an editor that's hidden, as behind a preview, as its own reads as the top.
 */
export const placeOf = (view, scroll = view.scrollSnapshot()) => ({
  anchor: view.state.selection.main.anchor,
  head: view.state.selection.main.head,
  scroll,
});

/**
 * Puts the cursor back where placeOf had it, or as near as the text allows, scrolled as
 * it was. Without a place, the file shows from its start: the one editor shows each file
 * in turn, and would otherwise show it as far down as the file before was scrolled.
 */
export function showPlace(view, place) {
  if (!place) {
    view.scrollDOM.scrollTop = 0;
    view.scrollDOM.scrollLeft = 0;
    return;
  }
  const end = view.state.doc.length;
  const at = (pos) => Math.min(pos, end);
  // CodeMirror pulls a snapshot past the end of a file since shortened back to its end.
  const scroll = place.scroll ?? EditorView.scrollIntoView(at(place.head), { y: "center" });
  view.dispatch({ selection: { anchor: at(place.anchor), head: at(place.head) }, effects: scroll });
}

// --- The editor's basics -------------------------------------------------------------
// CodeMirror's basicSetup, as its docs suggest copying it once it needs configuring, for
// the mouse: Alt+click adds a cursor (Ctrl+click goes to a definition), and Shift+Alt+drag
// selects a block, as in VS Code. With basicSetup's Alt+drag, a block selected would be
// added to the cursors already there, as Alt+click adds one. Its crosshair, shown while
// Alt's held, is left out, as Alt alone no longer selects a block, and its lint keys,
// with nothing linting.

const addsCursor = (event) => event.altKey && !event.shiftKey;
const selectsBlock = (event) => event.altKey && event.shiftKey;

const basics = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of(addsCursor),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection({ eventFilter: selectsBlock }),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap]),
];

// --- Status -----------------------------------------------------------------------

/** Where the cursor is and how the text is laid out, for the status bar. */
export function statusOf(state) {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const unit = state.facet(indentUnit);
  return {
    line: line.number,
    column: countColumn(line.text.slice(0, main.head - line.from), state.tabSize) + 1,
    selected: state.selection.ranges.reduce((sum, r) => sum + (r.to - r.from), 0),
    cursors: state.selection.ranges.length,
    indent: unit === "\t" ? "Tabs" : `${unit.length} Spaces`,
  };
}

/** Asks for a line to go to. */
export function goToLine(view) {
  gotoLine(view);
}

export function createState(text, file, { tabSize, highlight, wrap, readOnly = false, onSave, onChange, onCursor, goTo = null, review = null }) {
  return EditorState.create({
    doc: text,
    extensions: [
      basics,
      keymap.of([indentWithTab]),
      Prec.highest(
        keymap.of([
          { key: "Mod-s", run: (view) => (view.state.facet(hostHooks).onSave?.(), true), preventDefault: true },
          // As in most editors; Mod-Alt-g works too.
          { key: "Ctrl-g", run: gotoLine, preventDefault: true },
        ]),
      ),
      host.of(hostOf({ onSave, onChange, onCursor, goTo, review })),
      reviewExtensions(review),
      goToDefinitions,
      changes,
      changeGutter,
      theme,
      coloring.of(highlight ? syntaxHighlighting(highlighting) : []),
      tabs.of([EditorState.tabSize.of(tabSize), indentUnit.of(detectIndent(text))]),
      wrapping.of(wrap ? EditorView.lineWrapping : []),
      language.of([]),
      EditorView.updateListener.of((update) => {
        const hooks = update.state.facet(hostHooks);
        if (update.docChanged) hooks.onChange?.(update.state);
        if (update.docChanged || update.selectionSet) hooks.onCursor?.(update.state);
      }),
      // Still selectable, to copy from.
      readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
    ],
  });
}

/**
 * `state` with the page's callbacks replaced, as createState takes them, keeping its
 * text, selection and undo history: for a state kept from an editor that's since gone,
 * whose callbacks would otherwise still be that editor's.
 */
export function rebind(state, hooks) {
  return state.update({ effects: host.reconfigure(hostOf(hooks)) }).state;
}

/** An editor showing `state` in `parent`. */
export function createView(parent, state) {
  return new EditorView({ state, parent });
}

// The .env files' language, made once, when the first is opened.
let dotenvLanguage = null;

/**
 * Loads the language for `file`, if CodeMirror has one, and colors the editor with it,
 * unless `stillShown` says another file is in the editor by then. Returns its name.
 */
export async function loadLanguage(view, file, stillShown) {
  // .env files, which CodeMirror has no language for, have their own (see dotenv.js).
  if (isDotenv(file)) {
    dotenvLanguage ??= StreamLanguage.define(dotenvParser);
    if (stillShown()) view.dispatch({ effects: language.reconfigure(dotenvLanguage) });
    return ".env";
  }
  const description = LanguageDescription.matchFilename(languages, file.split("/").pop());
  if (!description) return;
  const support = await description.load().catch(() => null);
  if (support && stillShown()) view.dispatch({ effects: language.reconfigure(support) });
  return description.name;
}

/** Applies Recastle's settings for tab width, syntax highlighting and wrapping long lines. */
export function applySettings(view, { tabSize, highlight, wrap }) {
  view.dispatch({
    effects: [
      coloring.reconfigure(highlight ? syntaxHighlighting(highlighting) : []),
      wrapping.reconfigure(wrap ? EditorView.lineWrapping : []),
      tabs.reconfigure([EditorState.tabSize.of(tabSize), indentUnit.of(view.state.facet(indentUnit))]),
    ],
  });
}

/** Replaces the whole text, as when the file changed on disk, keeping the cursor near where it was. */
export function replaceText(view, text) {
  const head = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head } });
}
