// The page's scripts, started once the page has loaded (modules wait for it). Each part
// starts only if its markup is on the page, and one that fails leaves the rest working.

import { initTheme } from './theme.js';
import { initDownloads, initStars } from './downloads.js';
import { initReveals, initScrub, initTypeouts } from './effects.js';
import { initGallery, initGitHubShots } from './gallery.js';
import { initWorkflow } from './demos/workflow.js';
import { initAgents } from './demos/agents.js';
import { initEditor } from './demos/editor.js';
import { initHistory } from './demos/history.js';

const DEMOS = { workflow: initWorkflow, agents: initAgents, editor: initEditor, history: initHistory };

function safely(name, start) {
  try { start(); } catch (error) { console.error(`Recastle's page: ${name} didn't start`, error); }
}

safely('theme', initTheme);
safely('downloads', initDownloads);
safely('stars', initStars);
safely('reveals', initReveals);
safely('scrub', initScrub);
safely('typeouts', initTypeouts);
safely('gallery', initGallery);
safely('GitHub screenshots', initGitHubShots);
document.querySelectorAll('[data-demo]').forEach((root) => {
  const start = DEMOS[root.dataset.demo];
  if (start) safely(`the ${root.dataset.demo} demo`, () => start(root));
});
