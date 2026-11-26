// The History section's demo, played by itself (see autoplay.js): a branch graph where
// word-count is dragged onto main (HEAD) to merge it, then, after Undo, dragged again
// with Rebase picked, to rebase main onto it.
//
// The graph is drawn from LAYOUTS: rows of [commit, lane], top to bottom. Rows are
// positioned with transforms, so a commit that moves between layouts glides there.

import { h } from '../util.js';
import { autoplay } from '../autoplay.js';

const ROW = 50;
const LANE = 22;
const LEFT = 18;

const COMMITS = {
  A: { message: 'Sort notes by last edited', who: 'LN', hash: '624766a', parents: [] },
  B: { message: 'Show relative times in the note list', who: 'SR', hash: '4add611', parents: ['A'] },
  M1: { message: 'Fix typo in pin tooltip', who: 'MC', hash: 'e0c6127', parents: ['B'] },
  W1: { message: 'Add a word counter', who: 'CL', hash: '9b2f0d4', parents: ['B'] },
  W2: { message: 'Show reading time beside it', who: 'CL', hash: '31c8a7e', parents: ['W1'] },
  MERGE: { message: "Merge branch 'word-count'", who: 'YOU', hash: '7f41b9c', parents: ['M1', 'W2'] },
  // M1, replayed onto word-count by the rebase: the same change, a new commit.
  M1R: { message: 'Fix typo in pin tooltip', who: 'MC', hash: 'c58e203', parents: ['W2'] },
};

const LAYOUTS = {
  start: { rows: [['M1', 0], ['W2', 1], ['W1', 1], ['B', 0], ['A', 0]], heads: { main: 'M1', 'word-count': 'W2' } },
  merge: { rows: [['MERGE', 0], ['M1', 0], ['W2', 1], ['W1', 1], ['B', 0], ['A', 0]], heads: { main: 'MERGE', 'word-count': 'W2' } },
  rebase: { rows: [['M1R', 0], ['W2', 0], ['W1', 0], ['B', 0], ['A', 0]], heads: { main: 'M1R', 'word-count': 'W2' } },
};

// What the status line under the graph says in each layout.
const SAY = {
  start: 'main and word-count have each moved on since they split.',
  merge: 'Merged: a merge commit brings word-count’s two commits into main.',
  rebase: 'Rebased: main’s commit is replayed on top of word-count, in one straight line.',
};

export function initHistory(root) {
  const $ = (selector) => root.querySelector(selector);
  const column = root.closest('.demo-column');
  const graph = $('[data-graph]');
  const status = $('[data-graph-status]');
  const undo = $('[data-undo]');
  const chip = $('[data-drag-branch]');
  const mainChip = $('[data-drop-head]'); // main, the branch at HEAD, just above word-count
  const modeButtons = root.querySelectorAll('[data-mode]');

  let layout = 'start';
  const rows = new Map(); // commit → its row element, kept so rows glide between layouts

  const x = (lane) => LEFT + lane * LANE;
  const y = (index) => index * ROW + ROW / 2;

  function render() {
    const { rows: order, heads } = LAYOUTS[layout];
    const index = new Map(order.map(([id, lane], i) => [id, { i, lane }]));

    // The lines between each commit and its parents.
    const paths = [];
    order.forEach(([id, lane], i) => {
      for (const parent of COMMITS[id].parents) {
        const p = index.get(parent);
        const x1 = x(lane);
        const y1 = y(i);
        // A parent that's scrolled off the bottom: the line runs on down, out of view.
        const x2 = p ? x(p.lane) : x1;
        const y2 = p ? y(p.i) : y(order.length) + ROW;
        const d = x1 === x2 ? `M${x1} ${y1}V${y2}`
          // Out of a branch into its parent's lane: down its own lane, then across.
          : lane > (p?.lane ?? lane) ? `M${x1} ${y1}V${y2 - ROW * 0.6}C${x1} ${y2 - ROW * 0.2} ${x2} ${y2 - ROW * 0.4} ${x2} ${y2}`
          // A merge reaching into another lane: across first, then down it.
          : `M${x1} ${y1}C${x1} ${y1 + ROW * 0.4} ${x2} ${y1 + ROW * 0.2} ${x2} ${y1 + ROW * 0.6}V${y2}`;
        paths.push(`<path d="${d}" stroke="${lane === 1 || p?.lane === 1 ? '#f59e0b' : 'var(--accent)'}" stroke-width="2.5" fill="none"/>`);
      }
    });
    const dots = order.map(([, lane], i) => `<circle cx="${x(lane)}" cy="${y(i)}" r="5.5" fill="var(--win)" stroke="${lane === 1 ? '#f59e0b' : 'var(--accent)'}" stroke-width="2.5"/>`);
    const svg = `<svg width="${LEFT * 2 + LANE * 2}" height="${order.length * ROW}" aria-hidden="true">${paths.join('')}${dots.join('')}</svg>`;

    graph.querySelector('svg')?.remove();
    graph.insertAdjacentHTML('afterbegin', svg);
    const drawn = graph.querySelector('svg');
    drawn.style.opacity = '0';
    requestAnimationFrame(() => { drawn.style.opacity = '1'; });

    // Rows: kept, moved, added and removed.
    for (const [id, row] of rows) {
      if (!index.has(id)) { row.remove(); rows.delete(id); }
    }
    order.forEach(([id], i) => {
      const commit = COMMITS[id];
      const refs = Object.entries(heads).filter(([, at]) => at === id).map(([name]) => name);
      let row = rows.get(id);
      const isNew = !row;
      if (isNew) {
        row = h('div', { class: 'graph-row is-entering' });
        rows.set(id, row);
        graph.append(row);
      }
      row.classList.toggle('is-head-row', refs.includes('main'));
      row.style.paddingLeft = `${LEFT * 2 + LANE * 2}px`;
      row.style.transform = `translateY(${i * ROW}px)`;
      row.replaceChildren(
        h('span', { class: 'avatar', 'data-who': commit.who, text: commit.who === 'YOU' ? 'You' : commit.who }),
        h('span', { class: 'graph-row-text' }, h('b', { text: commit.message }), h('small', { text: commit.hash })),
        h('span', { class: 'graph-refs' },
          refs.includes('main') ? h('span', { class: 'ref-badge ref-head', text: 'HEAD' }) : null,
          ...refs.map((ref) => h('span', { class: 'ref-badge', text: ref }))),
      );
      if (isNew) requestAnimationFrame(() => requestAnimationFrame(() => row.classList.remove('is-entering')));
    });

    undo.hidden = layout === 'start';
    undo.textContent = layout === 'merge' ? 'Undo Merge' : 'Undo Rebase';
    status.textContent = SAY[layout];
  }

  function setMode(to) {
    modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === to)));
  }

  // ----- The script -----

  function reset() {
    layout = 'start';
    setMode('merge');
    render();
  }

  async function script(play) {
    play.say('<b>word-count</b> and <b>main</b> have each moved on since they split.');
    await play.wait(2200);
    play.say('Drag a branch onto HEAD to merge it.');
    await play.drag(chip, mainChip, 'word-count');
    layout = 'merge';
    render();
    await play.wait(2600);
    play.say('Changed your mind? Undo puts it back as it was.');
    await play.click(undo);
    layout = 'start';
    render();
    await play.wait(1600);
    play.say('Pick Rebase, or hold <kbd>Alt</kbd>, and the same drag rebases instead.');
    await play.click(modeButtons[1]);
    setMode('rebase');
    await play.drag(chip, mainChip, 'word-count');
    layout = 'rebase';
    render();
    play.hidePointer();
    await play.wait(3000);
  }

  autoplay(root, {
    reset,
    script,
    caption: column.querySelector('[data-caption]'),
    pauseButton: column.querySelector('[data-pause]'),
  });
}
