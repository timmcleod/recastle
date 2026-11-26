// The theme button: it switches between the light and dark themes and remembers the
// choice. Until a visitor picks one, the page follows the system's. The head script in
// index.html applies a remembered choice before the page draws.

const root = document.documentElement;
const system = window.matchMedia('(prefers-color-scheme: dark)');

function picked() {
  const theme = root.getAttribute('data-theme');
  return theme === 'light' || theme === 'dark' ? theme : null;
}

function show() {
  const scheme = picked() || (system.matches ? 'dark' : 'light');
  root.setAttribute('data-scheme', scheme);
  const next = scheme === 'dark' ? 'light' : 'dark';
  document.querySelectorAll('[data-theme-toggle].icon-button').forEach((button) => {
    button.setAttribute('aria-label', `Use the ${next} theme`);
  });
}

export function initTheme() {
  show();
  system.addEventListener('change', show);
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const theme = root.getAttribute('data-scheme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      try { localStorage.setItem('recastle-theme', theme); } catch { /* private window: not remembered */ }
      show();
    });
  });
}
