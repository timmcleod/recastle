// Plays a demo by itself, over and over: a pointer moves over the demo's window and
// clicks, types and drags, as a person would, while a caption says what's happening.
//
// A demo gives autoplay() a `reset` that puts it back to its start and a `script` that
// plays it through. Both get a context, `play`, whose helpers belong to that one run:
// once the next run starts, a helper called from the old one throws STOP, so anything
// the old run left going (an agent still working, say) quietly ends.
//
// It plays only while it's on screen and the tab is showing, and the visitor can pause
// it. For visitors who asked for less motion it doesn't move: it plays through once,
// without pauses, and stays on the last step.
//
// The window is inert, so the visitor's clicks and keys can't tangle with the script's;
// the script's own clicks still reach it.

import { calm, scrollWithin } from './util.js';

const STOP = Symbol('stopped');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function autoplay(root, { reset, script, caption, pauseButton, rest = 2600 }) {
  let run = 0;
  let paused = false;
  let onScreen = false;
  const playing = () => onScreen && !paused && !document.hidden;

  root.inert = true;
  const pointer = document.createElement('div');
  pointer.className = 'demo-pointer';
  pointer.setAttribute('aria-hidden', 'true');
  pointer.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6.5 1.5L9 19z"/></svg>';
  root.append(pointer);

  /** The helpers for one run. */
  function context(id) {
    const check = () => { if (id !== run) throw STOP; };

    // A pause that stops the clock while the demo is off screen or paused.
    async function wait(ms) {
      check();
      if (calm) return;
      let left = ms;
      while (left > 0) {
        await sleep(50);
        check();
        if (playing()) left -= 50;
      }
    }

    // Where an element's middle is, in the demo window's coordinates.
    function spot(element, at = 0.5) {
      const box = element.getBoundingClientRect();
      const frame = root.getBoundingClientRect();
      return { x: box.left - frame.left + Math.min(box.width * at, 60), y: box.top - frame.top + box.height / 2 };
    }

    async function point(element, at) {
      check();
      // An element out of view in a pane that scrolls is scrolled to first.
      const pane = scrollingParent(element);
      if (pane) {
        const box = element.getBoundingClientRect();
        const view = pane.getBoundingClientRect();
        if (box.top < view.top || box.bottom > view.bottom) { scrollWithin(pane, element, 0.3); await wait(450); }
      }
      if (calm) return;
      const { x, y } = spot(element, at);
      pointer.classList.add('is-shown');
      pointer.style.transform = `translate(${x}px, ${y}px)`;
      await wait(650);
    }

    async function press() {
      pointer.classList.add('is-pressing');
      await wait(160);
      pointer.classList.remove('is-pressing');
    }

    return {
      wait,
      point,
      say(text) { check(); if (caption) caption.innerHTML = text; },
      async click(element, at) {
        await point(element, at);
        await press();
        check();
        element.click();
        await wait(250);
      },
      async type(input, text) {
        await point(input, 0.1);
        await press();
        for (const letter of text) {
          check();
          input.value += letter;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(letter === ' ' ? 70 : 40);
        }
      },
      // Drags a label from one element to another: the pointer carries it over.
      async drag(from, to, label) {
        await point(from);
        pointer.classList.add('is-pressing');
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost is-in-demo';
        ghost.textContent = label;
        const start = spot(from);
        ghost.style.transform = `translate(${start.x + 12}px, ${start.y + 8}px)`;
        root.append(ghost);
        await wait(200);
        const end = spot(to);
        to.classList.add('is-drop-over');
        ghost.style.transform = `translate(${end.x + 12}px, ${end.y + 8}px)`;
        pointer.style.transform = `translate(${end.x}px, ${end.y}px)`;
        try {
          await wait(1100);
        } finally {
          ghost.remove();
          to.classList.remove('is-drop-over');
          pointer.classList.remove('is-pressing');
        }
      },
      hidePointer() { pointer.classList.remove('is-shown'); },
    };
  }

  function scrollingParent(element) {
    for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    }
    return null;
  }

  async function loop() {
    for (;;) {
      const id = ++run;
      const play = context(id);
      pointer.classList.remove('is-shown');
      try {
        reset(play);
        await script(play);
        if (calm) return; // Stays on its last step.
        await play.wait(rest);
      } catch (error) {
        if (error !== STOP) { console.error(error); return; }
      }
    }
  }

  // ----- When it plays -----

  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }, { threshold: 0.2 }).observe(root);

  if (pauseButton) {
    if (calm) pauseButton.hidden = true;
    pauseButton.addEventListener('click', () => {
      paused = !paused;
      pauseButton.setAttribute('aria-pressed', String(paused));
      pauseButton.setAttribute('aria-label', paused ? 'Play the demo' : 'Pause the demo');
      pauseButton.querySelector('[data-pause-label]')?.replaceChildren(paused ? 'Play' : 'Pause');
    });
  }

  loop();
}

/** Whether an error is just a run being stopped, for background work that catches it. */
export const isStop = (error) => error === STOP;
