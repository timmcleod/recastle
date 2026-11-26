// Small helpers the page's scripts share.

/** Whether the visitor asked for less motion: the demos then skip their typing and pauses. */
export const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A pause, or none for visitors who asked for less motion. */
export const wait = (ms) => new Promise((done) => setTimeout(done, calm ? 0 : ms));

/** Whether the visitor's computer is a Mac, whose shortcuts use ⌘ rather than Ctrl. */
export const isMac = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');

/**
 * An element, with its attributes and children: h('button', { class: 'x', onclick }, 'Go').
 * `text` sets its text; `html` sets its markup, for markup the page made itself and never
 * for anything a visitor typed. Children that are null or false are left out.
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

/** Runs `start` once, the first time `node` scrolls into view. */
export function whenSeen(node, start, threshold = 0.3) {
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    start();
  }, { threshold });
  observer.observe(node);
}

/** Scrolls `child` into view within `box` alone, never moving the page itself. */
export function scrollWithin(box, child, at = 0.3) {
  const top = child.offsetTop - box.clientHeight * at;
  box.scrollTo({ top: Math.max(0, top), behavior: calm ? 'auto' : 'smooth' });
}
