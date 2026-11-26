// The Files section's demo, played by itself (see autoplay.js): the editor, with a tab
// for each file opened, and ⌘-click (Ctrl+click) going from an import, a name or an
// environment variable to where it's defined. Back retraces the jumps.

import { h, isMac, scrollWithin } from '../util.js';
import { highlight } from '../highlight.js';
import { autoplay } from '../autoplay.js';

// The demo's files. Each link is text that, Ctrl+clicked wherever it appears in that
// file, goes to the first line of `to[0]` that contains `to[1]`.
const FILES = {
  'src/App.vue': {
    language: 'js', label: 'Vue',
    lines: [
      '<script setup>',
      'import { computed, ref, watch } from "vue";',
      'import NoteEditor from "./components/NoteEditor.vue";',
      'import { loadNotes, saveNotes } from "./lib/storage.js";',
      'import { startSync } from "./lib/sync.js";',
      '',
      'const notes = ref(loadNotes());',
      'const selectedId = ref(null);',
      'const selectedNote = computed(() =>',
      '  notes.value.find((note) => note.id === selectedId.value));',
      '',
      'watch(notes, saveNotes, { deep: true });',
      'startSync(import.meta.env.VITE_SYNC_URL);',
      '</script>',
    ],
    links: [
      { text: '"./components/NoteEditor.vue"', to: ['src/components/NoteEditor.vue', '<script setup>'] },
      { text: '"./lib/storage.js"', to: ['src/lib/storage.js', 'const KEY'] },
      { text: '"./lib/sync.js"', to: ['src/lib/sync.js', 'import'] },
      { text: 'loadNotes', to: ['src/lib/storage.js', 'function loadNotes'] },
      { text: 'saveNotes', to: ['src/lib/storage.js', 'function saveNotes'] },
      { text: 'startSync', to: ['src/lib/sync.js', 'function startSync'] },
      { text: 'NoteEditor', to: ['src/components/NoteEditor.vue', '<script setup>'] },
      { text: 'VITE_SYNC_URL', to: ['.env', 'VITE_SYNC_URL='] },
    ],
  },
  'src/lib/storage.js': {
    language: 'js', label: 'JavaScript',
    lines: [
      'const KEY = "lantern.notes";',
      '',
      'export function loadNotes() {',
      '  const saved = localStorage.getItem(KEY);',
      '  return saved ? JSON.parse(saved) : [];',
      '}',
      '',
      'export function saveNotes(notes) {',
      '  localStorage.setItem(KEY, JSON.stringify(notes));',
      '}',
    ],
    links: [
      { text: 'KEY', to: ['src/lib/storage.js', 'const KEY'] },
    ],
  },
  'src/lib/sync.js': {
    language: 'js', label: 'JavaScript',
    lines: [
      'import { saveNotes } from "./storage.js";',
      '',
      'export function startSync(url) {',
      '  if (!url) return;',
      '  const socket = new WebSocket(url);',
      '  socket.onmessage = (event) => saveNotes(JSON.parse(event.data));',
      '}',
    ],
    links: [
      { text: '"./storage.js"', to: ['src/lib/storage.js', 'const KEY'] },
      { text: 'saveNotes', to: ['src/lib/storage.js', 'function saveNotes'] },
    ],
  },
  'src/components/NoteEditor.vue': {
    language: 'js', label: 'Vue',
    lines: [
      '<script setup>',
      'import { computed } from "vue";',
      'import { wordCount } from "../lib/words.js";',
      '',
      'const props = defineProps(["note"]);',
      'const words = computed(() => wordCount(props.note.body));',
      '</script>',
    ],
    links: [
      { text: '"../lib/words.js"', to: ['src/lib/words.js', 'function wordCount'] },
      { text: 'wordCount', to: ['src/lib/words.js', 'function wordCount'] },
    ],
  },
  'src/lib/words.js': {
    language: 'js', label: 'JavaScript',
    lines: [
      'export function wordCount(text) {',
      '  const trimmed = text.trim();',
      '  return trimmed ? trimmed.split(/\\s+/).length : 0;',
      '}',
    ],
    links: [],
  },
  '.env': {
    language: 'env', label: '.env',
    lines: [
      '# Where notes sync to; leave it empty to keep them on this device',
      'VITE_SYNC_URL=wss://sync.example.com/notes',
      'VITE_APP_NAME="Lantern"',
    ],
    // In a .env file, a variable's name goes to where the app reads it.
    links: [
      { text: 'VITE_SYNC_URL', to: ['src/App.vue', 'VITE_SYNC_URL'] },
    ],
  },
};

const lineOf = (path, containing) => Math.max(0, FILES[path].lines.findIndex((line) => line.includes(containing)));
const nameOf = (path) => path.split('/').pop();

/** A line split into plain text and links, each link the first match at its place. */
function segments(path, lineIndex) {
  const line = FILES[path].lines[lineIndex];
  const found = [];
  for (const link of FILES[path].links) {
    let at = line.indexOf(link.text);
    while (at !== -1) {
      const before = line[at - 1];
      const after = line[at + link.text.length];
      const whole = !/[\w$]/.test(before || '') && !/[\w$]/.test(after || '');
      const target = { path: link.to[0], line: lineOf(link.to[0], link.to[1]) };
      // A definition doesn't link to itself.
      const self = target.path === path && target.line === lineIndex;
      if (whole && !self) found.push({ at, text: link.text, target });
      at = line.indexOf(link.text, at + 1);
    }
  }
  found.sort((a, b) => a.at - b.at);
  const parts = [];
  let last = 0;
  for (const link of found) {
    if (link.at < last) continue; // Overlaps one already taken.
    if (link.at > last) parts.push({ text: line.slice(last, link.at) });
    parts.push(link);
    last = link.at + link.text.length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts;
}

export function initEditor(root) {
  const $ = (selector) => root.querySelector(selector);
  const column = root.closest('.demo-column');
  const tabsRow = $('[data-editor-tabs]');
  const code = $('[data-editor-code]');
  const status = $('[data-editor-status]');
  const back = $('[data-back]');
  const forward = $('[data-forward]');
  const hold = $('[data-hold]');
  const modKey = isMac ? '⌘' : 'Ctrl';
  document.querySelectorAll('[data-mod-key]').forEach((key) => { key.textContent = modKey; });

  let open;
  let current;
  let past;
  let ahead;
  let holding; // The modifier, held: names that go somewhere are underlined and clicking one goes there.
  let opened = null; // A file just opened, whose tab fades in; the others are drawn again as they were.

  function setHolding(on) {
    holding = on;
    hold.setAttribute('aria-pressed', String(on));
    root.classList.toggle('is-holding', on);
  }

  function go(target, { record = true, flash = true } = {}) {
    if (record) { past.push(current); ahead = []; }
    if (!open.includes(target.path)) {
      open.splice(open.indexOf(current.path) + 1, 0, target.path);
      opened = target.path;
    }
    current = { ...target };
    render(flash);
  }

  function goBack() {
    if (!past.length) return;
    ahead.push(current);
    go(past.pop(), { record: false });
  }

  function goForward() {
    if (!ahead.length) return;
    past.push(current);
    go(ahead.pop(), { record: false });
  }

  // ----- The script -----

  function reset() {
    open = ['src/App.vue'];
    current = { path: 'src/App.vue', line: 11 };
    past = [];
    ahead = [];
    setHolding(false);
    render(false);
  }

  async function script(play) {
    const link = (text) => [...code.querySelectorAll('.code-link')].find((button) => button.textContent === text);
    play.say(`Hold <kbd>${modKey}</kbd>, and the names that go somewhere are underlined.`);
    await play.wait(1200);
    await play.click(hold);
    await play.wait(1000);
    play.say(`<kbd>${modKey}</kbd>-click a name to go to its definition, in a tab of its own.`);
    await play.click(link('loadNotes'));
    await play.wait(1800);
    play.say('Back retraces your steps.');
    await play.click(back);
    await play.wait(1300);
    play.say('An environment variable goes to where <code>.env</code> sets it…');
    await play.click(link('VITE_SYNC_URL'));
    await play.wait(1800);
    play.say('…and from <code>.env</code>, back to where the app reads it.');
    await play.click(link('VITE_SYNC_URL'));
    await play.wait(1600);
    play.say('Imports go to their files, and on to what they use.');
    await play.click(link('"./lib/sync.js"'));
    await play.wait(1400);
    await play.click(link('saveNotes'));
    await play.wait(1200);
    await play.click(hold);
    play.hidePointer();
    await play.wait(2200);
  }

  // ----- Drawing -----

  function render(flash) {
    tabsRow.replaceChildren(...open.map((path) => h('div', { class: `editor-tab${path === current.path ? ' is-current' : ''}${path === opened ? ' is-new' : ''}` },
      h('button', { class: 'editor-tab-select', type: 'button', text: nameOf(path), title: path, 'aria-current': path === current.path ? 'true' : null }),
      open.length > 1 ? h('span', { class: 'editor-tab-close', 'aria-hidden': 'true', text: '×' }) : null)));

    opened = null;

    const file = FILES[current.path];
    code.replaceChildren(...file.lines.map((_, index) => h('div', { class: `code-line${index === current.line ? ' is-cursor' : ''}${flash && index === current.line ? ' is-flash' : ''}` },
      h('span', { class: 'number', text: index + 1 }),
      h('code', {}, ...segments(current.path, index).map((part) => (part.target
        ? h('button', {
          class: 'code-link', type: 'button', html: highlight(part.text, file.language),
          onclick: () => { if (holding) go(part.target); },
        })
        : h('span', { html: highlight(part.text, file.language) })))))));
    const cursorLine = code.children[current.line];
    if (cursorLine) scrollWithin(code, cursorLine);

    back.disabled = !past.length;
    forward.disabled = !ahead.length;
    status.replaceChildren(
      h('span', { text: `Ln ${current.line + 1}, Col 1` }),
      h('span', { text: '2 Spaces' }),
      h('span', { text: 'UTF-8' }),
      h('span', { text: file.label }),
    );
  }

  back.addEventListener('click', goBack);
  forward.addEventListener('click', goForward);
  hold.addEventListener('click', () => setHolding(!holding));

  autoplay(root, {
    reset,
    script,
    caption: column.querySelector('[data-caption]'),
    pauseButton: column.querySelector('[data-pause]'),
  });
}
