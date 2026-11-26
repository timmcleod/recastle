// The page's lighter touches: sections that fade in, words that light up as they scroll
// past, cards lit where the pointer is, and a terminal that prints itself.

import { calm, wait, whenSeen } from './util.js';

/** Elements marked .reveal fade in the first time they scroll into view. */
export function initReveals() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((node) => observer.observe(node));
}

/** Paragraphs marked data-scrub light up word by word as they move up the screen. */
export function initScrub() {
  const paragraphs = [...document.querySelectorAll('[data-scrub]')];
  if (!paragraphs.length) return;
  const words = paragraphs.map((p) => {
    const parts = p.textContent.split(/(\s+)/);
    p.textContent = '';
    return parts.map((part) => {
      if (/^\s+$/.test(part)) { p.append(part); return null; }
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = part;
      p.append(span);
      return span;
    }).filter(Boolean);
  });
  if (calm) { words.flat().forEach((w) => w.classList.add('is-lit')); return; }

  let queued = false;
  function update() {
    queued = false;
    const view = window.innerHeight;
    paragraphs.forEach((p, i) => {
      const box = p.getBoundingClientRect();
      // Starts lighting as the paragraph's top passes 85% of the way down the screen,
      // and is fully lit once its bottom passes 45%.
      const progress = Math.min(1, Math.max(0, (view * 0.85 - box.top) / (box.height + view * 0.4)));
      const lit = Math.round(progress * words[i].length);
      words[i].forEach((w, n) => w.classList.toggle('is-lit', n < lit));
    });
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
}

/** Cards marked .spotlight follow the pointer with a soft light. */
export function initSpotlights() {
  document.querySelectorAll('.spotlight').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const box = card.getBoundingClientRect();
      card.style.setProperty('--x', `${event.clientX - box.left}px`);
      card.style.setProperty('--y', `${event.clientY - box.top}px`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.removeProperty('--x');
      card.style.removeProperty('--y');
    });
  });
}

/** A <pre data-typeout> prints its lines one after another when it scrolls into view. */
export function initTypeouts() {
  document.querySelectorAll('[data-typeout]').forEach((pre) => {
    if (calm) return;
    // Each line becomes a span of its own; the lines' markup never crosses a line break.
    const lines = pre.innerHTML.split('\n');
    pre.innerHTML = lines.map((line) => `<span class="type-line is-waiting">${line}</span>`).join('\n');
    const spans = [...pre.querySelectorAll('.type-line')];
    whenSeen(pre, async () => {
      for (const span of spans) {
        // Commands take a moment to type; their output follows quickly.
        await wait(span.textContent.startsWith('$') ? 650 : span.textContent ? 260 : 120);
        span.classList.remove('is-waiting');
      }
    }, 0.5);
  });
}
