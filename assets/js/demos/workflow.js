// The hero's demo of the whole loop, played by itself (see autoplay.js). An agent works
// in the terminal, and the files it changes appear in the Working Copy. Then the review:
// the chunk the agent shouldn't have left is discarded, the rest staged, committed and
// pushed.
//
// Everything shown is drawn from the state below by render(); the buttons' handlers only
// change the state and call it, and the script clicks the buttons.

import { h, wait } from '../util.js';
import { autoplay } from '../autoplay.js';
import { highlight } from '../highlight.js';

const TASK = 'add a word count and reading time to the note editor';

// The agent's changes. Each chunk's lines start with '+' (added) or ' ' (unchanged);
// `at` is where the chunk starts, in the old file and the new one.
const CHANGES = [
  {
    id: 'words', dir: 'src/lib/', name: 'words.js', status: 'A', language: 'js',
    chunks: [{
      at: [0, 1], context: '',
      lines: [
        '+export function wordCount(text) {',
        '+  const trimmed = text.trim();',
        '+  return trimmed ? trimmed.split(/\\s+/).length : 0;',
        '+}',
        '+',
        '+export function readingTime(text) {',
        '+  return Math.max(1, Math.ceil(wordCount(text) / 200));',
        '+}',
      ],
    }],
  },
  {
    id: 'editor', dir: 'src/components/', name: 'NoteEditor.vue', status: 'M', language: 'js',
    chunks: [
      {
        at: [2, 2], context: '<script setup>',
        lines: [
          ' import { computed, ref } from "vue";',
          '+import { wordCount, readingTime } from "../lib/words.js";',
          ' ',
        ],
      },
      {
        at: [8, 9], context: 'const props = defineProps(["note"]);',
        lines: [
          ' const body = ref(null);',
          '+const words = computed(() => wordCount(props.note.body));',
          '+const reading = computed(() => readingTime(props.note.body));',
        ],
      },
      {
        // The one to discard: a line the agent left in while it worked.
        at: [21, 24], context: 'function update(field, value) {', stray: true,
        lines: [
          '   emit("change", { ...props.note, [field]: value });',
          '+  console.log("words", words.value);',
          ' }',
        ],
      },
      {
        at: [35, 39], context: '<template>',
        lines: [
          '     <footer>',
          '+      <span class="stats">{{ words }} words · {{ reading }} min read</span>',
          '       <button @click="emit(\'delete\')">Delete</button>',
        ],
      },
    ],
  },
  {
    id: 'readme', dir: '', name: 'README.md', status: 'M', language: 'md',
    chunks: [{
      at: [5, 5], context: '## Features',
      lines: [
        ' - Pin notes to the top of the list',
        ' - Sort notes by when you last edited them',
        '+- See a word count and reading time as you type',
      ],
    }],
  },
];

// What the agent prints, a line at a time; a line with `file` brings that file into the
// Working Copy as it's printed.
const SCRIPT = [
  { text: '● Read src/components/NoteEditor.vue', kind: 'tool', pause: 700 },
  { text: '  ⎿  Read 64 lines', kind: 'dim', pause: 500 },
  { text: '● Write src/lib/words.js', kind: 'tool', file: 'words', pause: 900 },
  { text: '● Update src/components/NoteEditor.vue', kind: 'tool', file: 'editor', pause: 1000 },
  { text: '  ⎿  Added 5 lines', kind: 'dim', pause: 450 },
  { text: '● Update README.md', kind: 'tool', file: 'readme', pause: 800 },
  { text: "✻ Done. The editor's footer shows the word count and reading time.", kind: 'done', pause: 600 },
];

const HISTORY = [
  { message: 'Show relative times in the note list', who: 'Sofia Reyes', when: 'Oct 20', hash: '4add611', refs: ['main', 'origin/main'] },
  { message: 'Sort notes by last edited', who: 'Liam Novak', when: 'Oct 14', hash: '624766a', refs: [] },
];


export function initWorkflow(root) {
  const $ = (selector) => root.querySelector(selector);
  const stage = root.closest('.demo-stage');
  const ui = {
    files: $('[data-files]'),
    detail: $('[data-detail]'),
    terminal: $('[data-terminal]'),
    message: $('[data-message]'),
    commit: $('[data-commit]'),
    push: $('[data-push]'),
    pushCount: $('[data-push-count]'),
    agentState: $('[data-agent-state]'),
    tabSub: $('[data-tab-sub]'),
    changesCount: $('[data-changes-count]'),
    changesLabel: $('[data-changes-label]'),
    steps: stage.querySelectorAll('[data-step]'),
  };

  let state;

  // ----- The state, read -----

  const live = (file) => file.chunks.filter((chunk) => chunk.state !== 'discarded');
  const stagedIn = (file) => live(file).filter((chunk) => chunk.state === 'staged');
  const fileState = (file) => {
    const staged = stagedIn(file).length;
    return staged === 0 ? 'false' : staged === live(file).length ? 'true' : 'mixed';
  };
  const filesToCommit = () => state.files.filter((file) => stagedIn(file).length > 0);

  // ----- Changing it: what the buttons do -----

  function setChunk(chunk, to) {
    chunk.state = to;
    render();
  }

  function stageFile(file) {
    const to = fileState(file) === 'true' ? 'unstaged' : 'staged';
    live(file).forEach((chunk) => { chunk.state = to; });
    render();
  }

  async function discard(chunk, node) {
    node.classList.add('is-leaving');
    await wait(220);
    chunk.state = 'discarded';
    dropEmptyFiles();
    render();
  }

  function dropEmptyFiles() {
    state.files = state.files.filter((file) => live(file).length > 0);
    if (!state.files.some((file) => file.id === state.selected)) state.selected = state.files[0]?.id ?? null;
  }

  function select(id) {
    state.selected = id;
    state.view = 'changes';
    render();
  }

  function commit() {
    const committing = filesToCommit();
    if (!committing.length || !ui.message.value.trim()) return;
    const hash = Math.random().toString(16).slice(2, 9).padEnd(7, '0');
    state.commits.unshift({ message: ui.message.value.trim(), who: 'You, with Claude', when: 'just now', hash });
    state.fresh.add(hash);
    committing.forEach((file) => live(file).forEach((chunk) => {
      if (chunk.state === 'staged') chunk.state = 'committed';
    }));
    state.files.forEach((file) => { file.chunks = file.chunks.filter((chunk) => chunk.state !== 'committed'); });
    dropEmptyFiles();
    state.unpushed += 1;
    state.phase = 'ship';
    state.view = 'history';
    render();
  }

  function push() {
    if (!state.unpushed) return;
    state.unpushed = 0;
    state.phase = 'shipped';
    render();
  }

  // ----- The script -----

  function reset() {
    state = {
      phase: 'run',     // run → review → ship → shipped
      files: [],        // the changes the agent has made so far, with each chunk's state
      selected: null,   // the file whose diff shows
      view: 'changes',  // or 'history'
      commits: [],      // commits made in the demo, newest first
      unpushed: 0,
      fresh: new Set(), // files and commits to play their arrival for, once
    };
    ui.terminal.replaceChildren();
    ui.message.value = '';
    ui.detail.scrollTop = 0;
    render();
  }

  async function script(play) {
    // Run: the agent types its task and works, and its changes arrive.
    play.say(`<b>Run.</b> Claude Code works on “${TASK}”, and its changes arrive as it makes them.`);
    await play.wait(700);
    const prompt = h('div', { class: 'term-line term-prompt is-new' });
    const cursor = h('span', { class: 'cursor' });
    prompt.append(cursor);
    ui.terminal.append(prompt);
    for (const letter of TASK) {
      await play.wait(letter === ' ' ? 45 : 22);
      cursor.before(letter);
    }
    await play.wait(450);
    cursor.remove();
    ui.terminal.append(h('div', { class: 'term-line', text: ' ' }));
    for (const line of SCRIPT) {
      await play.wait(line.pause);
      ui.terminal.append(h('div', { class: `term-line term-${line.kind} is-new`, text: line.text }));
      ui.terminal.scrollTop = ui.terminal.scrollHeight;
      if (line.file) {
        const change = CHANGES.find((c) => c.id === line.file);
        state.files.push({ ...change, chunks: change.chunks.map((chunk) => ({ ...chunk, state: 'unstaged' })) });
        state.fresh.add(change.id);
        state.selected ??= change.id;
        render();
      }
    }
    ui.terminal.append(h('div', { class: 'term-line term-prompt is-new' }, h('span', { class: 'cursor' })));
    ui.terminal.scrollTop = ui.terminal.scrollHeight;
    state.phase = 'review';
    render();
    await play.wait(900);

    // Review: open the file with something to catch, and discard the stray line.
    play.say('<b>Review.</b> Every change, a chunk at a time. This one left a <code>console.log</code> behind…');
    await play.click(fileButton('editor'));
    await play.wait(500);
    const stray = root.querySelector('.chunk.is-suspect');
    await play.point(stray.querySelector('.hunk'));
    await play.wait(900);
    play.say('<b>Review.</b> …so it’s discarded. The rest is right, so it’s staged.');
    await play.click(stray.querySelector('.is-danger'));
    await play.wait(700);
    await play.click(root.querySelector('.chunk .is-primary'));
    for (const id of ['editor', 'words', 'readme']) {
      const check = fileCheck(id);
      if (check.getAttribute('aria-checked') !== 'true') await play.click(check);
    }
    await play.wait(500);

    // Ship: a message, a commit, a push.
    play.say('<b>Ship.</b> Write the message and commit.');
    await play.type(ui.message, 'Count words as you type');
    await play.click(ui.commit);
    await play.wait(1200);
    play.say('<b>Ship.</b> Committed, and pushed.');
    await play.click(ui.push);
    play.hidePointer();
    play.say('<b>Shipped.</b> That’s the loop: your agent writes, you review, Recastle ships it.');
    await play.wait(2600);
  }

  const fileRow = (id) => [...ui.files.querySelectorAll('.file')].find((row) => row.dataset.file === id);
  const fileButton = (id) => fileRow(id).querySelector('.file-name');
  const fileCheck = (id) => fileRow(id).querySelector('.check');

  // ----- Drawing it -----

  function render() {
    renderSteps();
    renderFiles();
    renderDetail();
    renderToolbar();
    state.fresh.clear();
  }

  function renderSteps() {
    const order = ['run', 'review', 'ship'];
    const now = state.phase === 'shipped' ? 3 : order.indexOf(state.phase);
    ui.steps.forEach((step) => {
      const index = order.indexOf(step.dataset.step);
      step.classList.toggle('is-now', index === now);
      step.classList.toggle('is-done', index < now);
    });
  }

  function renderFiles() {
    const count = state.files.length;
    ui.changesCount.textContent = count || '';
    ui.changesLabel.textContent = count ? `${count} changed file${count === 1 ? '' : 's'}` : '';
    root.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('is-current', item.dataset.view === state.view));
    if (!count) {
      ui.files.replaceChildren(h('li', { class: 'empty-note', text: state.phase === 'run' ? 'Waiting for your agent…' : 'Nothing to commit. Your working copy is clean.' }));
      return;
    }
    ui.files.replaceChildren(...state.files.map((file) => h('li', {
      class: ['file', file.id === state.selected && state.view === 'changes' && 'is-selected', state.fresh.has(file.id) && 'is-new'].filter(Boolean).join(' '),
      'data-file': file.id,
    },
    h('button', {
      class: 'check', type: 'button', role: 'checkbox',
      'aria-checked': fileState(file),
      'aria-label': `Stage ${file.dir}${file.name}`,
      onclick: () => stageFile(file),
    }),
    h('button', { class: 'file-name', type: 'button', onclick: () => select(file.id) },
      h('span', { class: 'status-badge', 'data-status': file.status, text: file.status, title: file.status === 'A' ? 'Added' : 'Modified' }),
      h('span', { class: 'file-path' }, file.dir ? h('span', { class: 'dim', text: file.dir }) : null, file.name)))));
  }

  function renderDetail() {
    if (state.view === 'history') { ui.detail.replaceChildren(historyView()); return; }
    const file = state.files.find((f) => f.id === state.selected);
    if (!file) {
      ui.detail.replaceChildren(h('p', { class: 'empty-note', text: state.phase === 'run' ? 'Your agent’s changes show up here as it makes them.' : 'Nothing to review.' }));
      return;
    }
    const allStaged = fileState(file) === 'true';
    ui.detail.replaceChildren(
      h('div', { class: 'diff-head' },
        h('span', { class: 'diff-path' }, file.dir ? h('span', { class: 'dim', text: file.dir }) : null, file.name),
        state.phase !== 'run' ? h('button', { class: 'link-button', type: 'button', onclick: () => stageFile(file), text: allStaged ? 'Unstage File' : 'Stage File' }) : null),
      ...live(file).map((chunk) => chunkView(file, chunk)),
    );
  }

  function chunkView(file, chunk) {
    let oldLine = chunk.at[0];
    let newLine = chunk.at[1];
    const staged = chunk.state === 'staged';
    const ready = state.phase !== 'run';
    const node = h('div', { class: ['chunk', staged && 'is-staged', chunk.stray && !staged && ready && 'is-suspect'].filter(Boolean).join(' ') });
    const buttons = !ready ? []
      : staged ? [h('button', { class: 'chunk-button', type: 'button', text: 'Unstage Chunk', onclick: () => setChunk(chunk, 'unstaged') })]
      : [
        h('button', { class: 'chunk-button is-danger', type: 'button', text: 'Discard Chunk', onclick: () => discard(chunk, node) }),
        h('button', { class: 'chunk-button is-primary', type: 'button', text: 'Stage Chunk', onclick: () => setChunk(chunk, 'staged') }),
      ];
    node.append(
      h('div', { class: 'chunk-head' },
        h('code', { class: 'hunk', text: `@@ -${chunk.at[0]} +${chunk.at[1]} @@ ${chunk.context}` }),
        staged ? h('span', { class: 'tag', text: 'Staged' }) : null,
        chunk.stray && !staged && ready ? h('span', { class: 'tag tag-warn', text: 'Debug line?' }) : null,
        ...buttons),
      ...chunk.lines.map((line) => {
        const added = line[0] === '+';
        return h('div', { class: `diff-line${added ? ' is-added' : ''}` },
          h('span', { class: 'number', text: added ? '' : oldLine++ }),
          h('span', { class: 'number', text: newLine++ }),
          h('span', { class: 'sign', text: added ? '+' : '' }),
          h('code', { html: highlight(line.slice(1), file.language) }));
      }),
    );
    return node;
  }

  function historyView() {
    const pushed = state.unpushed === 0;
    const rows = [
      ...state.commits.map((c, index) => ({
        ...c,
        refs: index === 0 ? ['HEAD', 'word-count', ...(pushed ? ['origin/word-count'] : [])] : [],
      })),
      ...HISTORY.map((c, index) => ({ ...c, refs: index === 0 && !state.commits.length ? ['HEAD', 'word-count', ...c.refs] : c.refs })),
    ];
    return h('div', { class: 'history-view' },
      h('div', { class: 'diff-head' }, h('span', { text: 'word-count' }), h('span', { class: 'pane-meta', text: state.unpushed ? `${state.unpushed} to push` : 'Up to date with origin' })),
      ...rows.map((c) => h('div', { class: `history-row${state.fresh.has(c.hash) ? ' is-new' : ''}` },
        h('span', { class: 'history-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'history-text' }, h('b', { text: c.message }), h('small', { text: `${c.who} · ${c.when} · ${c.hash}` })),
        h('span', { class: 'history-refs' }, ...c.refs.map((ref) => h('span', {
          class: `ref-badge${ref === 'HEAD' ? ' ref-head' : ref.startsWith('origin/') ? ' ref-remote' : ''}`, text: ref,
        }))))));
  }

  function renderToolbar() {
    const committing = filesToCommit().length;
    ui.commit.disabled = !committing || state.phase === 'run';
    ui.commit.textContent = committing ? `Commit ${committing} file${committing === 1 ? '' : 's'}` : 'Commit';
    ui.push.disabled = !state.unpushed;
    ui.push.classList.toggle('is-calling', state.unpushed > 0);
    ui.pushCount.hidden = !state.unpushed;
    ui.pushCount.textContent = state.unpushed;
    ui.agentState.dataset.agentState = state.phase === 'run' ? 'working' : 'done';
    ui.tabSub.textContent = state.phase === 'run' ? 'word-count · agent working' : `word-count · ${state.files.length} changed`;
  }

  // ----- Wiring -----

  ui.commit.addEventListener('click', commit);
  ui.push.addEventListener('click', push);
  root.querySelectorAll('[data-view]').forEach((item) => item.addEventListener('click', () => {
    state.view = item.dataset.view;
    render();
  }));

  autoplay(root, {
    reset,
    script,
    caption: stage.querySelector('[data-coach]'),
    pauseButton: stage.querySelector('[data-pause]'),
    rest: 1500,
  });
}
