// The Agents section's demo, played by itself (see autoplay.js): a window with a tab for
// each agent's worktree. One agent is working, one is done, and one waits on a question,
// which is answered. Then New Agent Task opens another tab with its own agent, and when
// it finishes while another tab is showing, Recastle says so.

import { h } from '../util.js';
import { autoplay, isStop } from '../autoplay.js';

const IGNORED_WORDS = new Set(['a', 'an', 'the', 'to', 'as', 'of', 'for', 'and', 'in', 'on', 'with', 'regardless', 'when', 'it']);
const NEW_TASK = 'Export notes as Markdown';

function startingTabs() {
  return [
    {
      id: 'pinned', name: 'lantern', branch: 'feature/pinned-notes', state: 'done', changed: 5,
      log: [
        { kind: 'prompt', text: 'pin notes to the top of the list' },
        { kind: 'tool', text: '● Update src/components/NoteList.vue' },
        { kind: 'tool', text: '● Update src/lib/storage.js' },
        { kind: 'done', text: '✻ Done. Pinned notes stay at the top, newest first.' },
      ],
    },
    {
      id: 'count', name: 'lantern-word-count', branch: 'word-count', state: 'working', changed: 1,
      log: [
        { kind: 'prompt', text: 'show a word count as you type' },
        { kind: 'tool', text: '● Write src/lib/words.js' },
      ],
      plan: [
        { kind: 'tool', text: '● Update src/components/NoteEditor.vue', changes: true },
        { kind: 'tool', text: '● Bash npm test' },
        { kind: 'dim', text: '  ⎿  23 passed' },
        { kind: 'done', text: '✻ Done. The footer counts words as you type.' },
      ],
    },
    {
      id: 'sync', name: 'lantern-sync', branch: 'sync', state: 'waiting', changed: 1,
      log: [
        { kind: 'prompt', text: 'sync notes between devices' },
        { kind: 'tool', text: '● Write src/lib/sync.js' },
        { kind: 'ask', text: 'Run npm install ws, to add a WebSocket client?' },
      ],
    },
  ];
}

/** A branch name for a task: its first few words that mean something, joined by hyphens. */
function branchFor(task) {
  const words = task.toLowerCase().normalize('NFD').replace(/[^a-z0-9\s]/g, '').split(/\s+/)
    .filter((word) => word && !IGNORED_WORDS.has(word));
  return words.slice(0, 3).join('-') || 'task';
}

export function initAgents(root) {
  const $ = (selector) => root.querySelector(selector);
  const column = root.closest('.demo-column');
  const tabsRow = $('[data-tabs]');
  const terminal = $('[data-agent-terminal]');
  const form = $('[data-task-form]');
  const input = $('[data-task-input]');
  const toasts = $('[data-toasts]');

  let tabs;
  let current;
  let play; // The run playing, whose wait the agents work to.

  const find = (id) => tabs.find((tab) => tab.id === id);

  /** Runs a tab's agent through the rest of its plan, a line every second or so. */
  async function work(tab) {
    const run = play;
    tab.state = 'working';
    render();
    try {
      while (tab.plan?.length) {
        await run.wait(1000 + Math.random() * 600);
        const line = tab.plan.shift();
        tab.log.push(line);
        if (line.changes) tab.changed += 1;
        render();
      }
    } catch (error) {
      if (isStop(error)) return; // The demo started over.
      throw error;
    }
    tab.state = current === tab.id ? 'done' : 'unseen';
    render();
    if (current !== tab.id) toast(tab);
  }

  function answer(tab) {
    tab.log.pop(); // The question.
    tab.log.push({ kind: 'dim', text: '  ⎿  Allowed' });
    tab.plan = [
      { kind: 'tool', text: '● Bash npm install ws' },
      { kind: 'tool', text: '● Update src/App.vue', changes: true },
      { kind: 'done', text: '✻ Done. Notes sync between devices as you edit them.' },
    ];
    work(tab);
  }

  function start(task) {
    const branch = branchFor(task);
    const lower = task.charAt(0).toLowerCase() + task.slice(1);
    const tab = {
      id: 'task', name: `lantern-${branch}`, branch, state: 'working', changed: 0,
      log: [
        { kind: 'dim', text: `Worktree ../lantern-${branch} on a new branch, ${branch}` },
        { kind: 'prompt', text: lower },
      ],
      plan: [
        { kind: 'tool', text: '● Read src/lib/storage.js' },
        { kind: 'tool', text: '● Write src/lib/export.js', changes: true },
        { kind: 'tool', text: '● Update src/components/NoteList.vue', changes: true },
        { kind: 'tool', text: '● Bash npm test' },
        { kind: 'dim', text: '  ⎿  24 passed' },
        { kind: 'done', text: `✻ Done: ${lower}.` },
      ],
    };
    // A new tab opens just right of the one showing.
    tabs.splice(tabs.findIndex((t) => t.id === current) + 1, 0, tab);
    current = tab.id;
    input.value = '';
    work(tab);
  }

  function show(id) {
    current = id;
    const tab = find(id);
    if (tab.state === 'unseen') tab.state = 'done';
    render();
  }

  function toast(tab) {
    const note = h('button', { class: 'toast', type: 'button', 'data-toast': tab.id, onclick: () => { show(tab.id); note.remove(); } },
      h('span', { class: 'agent-state', 'data-agent-state': 'done', 'aria-hidden': 'true' }),
      h('span', { text: `${tab.name}: your agent is done` }));
    toasts.append(note);
    setTimeout(() => note.remove(), 6000);
  }

  // ----- The script -----

  function reset(run) {
    play = run;
    tabs = startingTabs();
    current = 'count';
    input.value = '';
    toasts.replaceChildren();
    render();
    work(find('count'));
  }

  async function script(run) {
    run.say('Three agents at once, each in a worktree of its own, each in a tab that shows how it’s doing.');
    await run.wait(3200);
    run.say('This one’s waiting on you. Answer, and it carries on.');
    await run.click(tabButton('sync'));
    await run.wait(1200);
    await run.click(terminal.querySelector('.term-ask-buttons button'));
    await run.wait(1800);
    run.say('<b>New Agent Task:</b> describe it, and it gets a branch, a worktree and a tab, with your agent already on it.');
    await run.type(input, NEW_TASK);
    await run.click(form.querySelector('[type="submit"]'));
    start(NEW_TASK);
    await run.wait(2600);
    run.say('Look at another tab meanwhile, and Recastle tells you when the agent is done.');
    await run.click(tabButton('pinned'));
    for (let i = 0; i < 100 && find('task').state !== 'unseen'; i++) await run.wait(200);
    const note = toasts.querySelector('[data-toast="task"]');
    await run.wait(1000);
    if (note) await run.click(note);
    run.hidePointer();
    await run.wait(2600);
  }

  const tabButton = (id) => tabsRow.querySelector(`[data-tab="${id}"] .agent-tab-select`);

  // ----- Drawing -----
  //
  // Agents print a line every second or so, so drawing updates what's already shown
  // rather than building it again: a tab or terminal line built again would replay its
  // fade-in, and the window would blink. Only what's new fades in.

  const tabNodes = new Map(); // tab id → its element in the row

  function render() {
    renderTabs();
    renderTerminal(find(current));
  }

  function renderTabs() {
    for (const [id, node] of tabNodes) {
      if (!find(id)) { node.remove(); tabNodes.delete(id); }
    }
    tabs.forEach((tab, index) => {
      let node = tabNodes.get(tab.id);
      if (!node) {
        node = h('div', { class: 'agent-tab is-new', 'data-tab': tab.id },
          h('button', { class: 'agent-tab-select', type: 'button', onclick: () => show(tab.id) },
            h('span', { class: 'agent-state', 'aria-hidden': 'true' }),
            h('span', { class: 'window-tab-text' }, h('b'), h('small'))));
        node.addEventListener('animationend', () => node.classList.remove('is-new'), { once: true });
        tabNodes.set(tab.id, node);
      }
      if (tabsRow.children[index] !== node) tabsRow.insertBefore(node, tabsRow.children[index] || null);
      const isCurrent = tab.id === current;
      node.classList.toggle('is-current', isCurrent);
      node.querySelector('.agent-tab-select').toggleAttribute('aria-current', isCurrent);
      node.querySelector('.agent-state').dataset.agentState = tab.state;
      node.querySelector('b').textContent = tab.name;
      node.querySelector('small').replaceChildren(`${tab.branch} · ${stateLabel(tab)}`,
        tab.changed ? h('span', { class: 'changed-count', text: ` · ${tab.changed} changed` }) : '');
    });
  }

  function stateLabel(tab) {
    return { working: 'agent working', waiting: 'waiting on you', done: 'agent done', unseen: 'agent done' }[tab.state];
  }

  // The lines the terminal shows, so new ones can be added to them.
  let shown = { tab: null, lines: [] };
  const working = h('div', { class: 'term-line term-dim', text: '· Working…' });

  function renderTerminal(tab) {
    // Lines are only ever added, except when a question is answered or another tab
    // shows: then the terminal is drawn again, at once, without fading.
    const adding = shown.tab === tab.id && shown.lines.every((line, i) => tab.log[i] === line);
    if (!adding) {
      terminal.replaceChildren(working);
      shown = { tab: tab.id, lines: [] };
    }
    for (const line of tab.log.slice(shown.lines.length)) {
      terminal.insertBefore(lineView(tab, line, adding), working);
      shown.lines.push(line);
    }
    working.hidden = tab.state !== 'working';
    terminal.scrollTop = terminal.scrollHeight;
  }

  function lineView(tab, line, fade) {
    if (line.kind === 'ask') {
      return h('div', { class: 'term-ask' },
        h('div', { text: line.text }),
        h('div', { class: 'term-ask-buttons' },
          h('button', { type: 'button', text: '1 Yes', onclick: () => answer(tab) }),
          h('button', { type: 'button', text: '2 No' })));
    }
    return h('div', { class: `term-line term-${line.kind}${fade ? ' is-new' : ''}`, text: line.text });
  }

  form.addEventListener('submit', (event) => event.preventDefault());

  autoplay(root, {
    reset,
    script,
    caption: column.querySelector('[data-caption]'),
    pauseButton: column.querySelector('[data-pause]'),
  });
}
