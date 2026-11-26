// The download for the visitor's computer, where it can be told: macOS gets the .dmg,
// Linux the .deb, with the AppImage beside it, as the distribution can't be told. Others,
// and phones, are shown the downloads; on Windows, with a word that there's nothing for
// it yet. iPads say they're Macs; a touch screen gives them away. Without this, each
// button reads "Download" and goes to the downloads.
//
// The release workflow rewrites the version in index.html's download links, so the links
// are only ever read from the page, never written here.

function detect() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/Android|iPhone|iPad|iPod/.test(ua) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)) return 'mobile';
  if (/Mac/i.test(platform)) return 'mac';
  if (/Win/i.test(platform)) return 'windows';
  if (/Linux|X11/i.test(platform) && !/CrOS/.test(ua)) return 'linux';
  return 'other';
}

export function initDownloads() {
  const os = detect();
  const files = {};
  document.querySelectorAll('#download [data-asset]').forEach((a) => { files[a.dataset.asset] = a.href; });
  const main = os === 'mac' ? { label: 'Download for macOS', asset: 'dmg' }
    : os === 'linux' ? { label: 'Download .deb', asset: 'deb' }
    : { label: 'See downloads' };

  document.querySelectorAll('[data-cta]').forEach((cta) => {
    const link = cta.querySelector('[data-cta-main]');
    cta.querySelector('[data-cta-label]').textContent = main.label;
    if (main.asset) {
      link.href = files[main.asset];
      link.dataset.asset = main.asset;
    }
    if (os === 'linux') cta.querySelector('[data-cta-alt]').hidden = false;
  });

  if (os === 'windows') document.querySelectorAll('[data-windows-note]').forEach((note) => { note.hidden = false; });

  // On Linux, its cards first; otherwise as written, macOS first.
  if (os === 'linux') {
    const order = { deb: 0, appimage: 1, mac: 2 };
    document.querySelectorAll('[data-cards] > [data-os]').forEach((card) => { card.style.order = order[card.dataset.os]; });
  }
}

// The star count, once there are enough stars to be worth showing; until then, or if
// GitHub can't be reached, the link just says the source is there.
export function initStars() {
  fetch('https://api.github.com/repos/timmcleod/recastle')
    .then((response) => (response.ok ? response.json() : null))
    .then((repo) => {
      if (!repo || !(repo.stargazers_count >= 10)) return;
      document.querySelectorAll('[data-stars-link]').forEach((link) => {
        link.textContent = `★ ${repo.stargazers_count.toLocaleString('en-US')} on GitHub`;
      });
    })
    .catch(() => {});
}
