// The screenshots: the GitHub section's Issues / Pull requests switch, and the gallery,
// whose pictures open larger in a dialog.

export function initGitHubShots() {
  const img = document.getElementById('github-shot');
  const buttons = document.querySelectorAll('[data-github]');
  if (!img) return;
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.github;
      img.src = `assets/${name}.webp`;
      img.alt = img.getAttribute(`data-alt-${name}`);
      buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    });
  });
  // The other picture, fetched once the page has loaded, so switching shows it at once.
  window.addEventListener('load', () => { new Image().src = 'assets/pull-requests.webp'; });
}

export function initGallery() {
  const gallery = document.querySelector('[data-gallery]');
  const dialog = document.querySelector('[data-lightbox]');
  if (!gallery || !dialog) return;
  const items = [...gallery.querySelectorAll('.gallery-item')];
  const image = dialog.querySelector('[data-lightbox-image]');
  const caption = dialog.querySelector('[data-lightbox-caption]');
  let open = 0;

  // The picture an item shows: of an item with one for each theme, the one showing.
  const pictureOf = (item) => [...item.querySelectorAll('img')].find((img) => img.offsetParent !== null) || item.querySelector('img');

  function show(index) {
    open = (index + items.length) % items.length;
    const picture = pictureOf(items[open]);
    image.src = picture.currentSrc || picture.src;
    image.alt = picture.alt;
    caption.textContent = items[open].querySelector('.gallery-caption').textContent;
  }

  items.forEach((item, index) => item.addEventListener('click', () => { show(index); dialog.showModal(); }));
  dialog.querySelector('[data-lightbox-close]').addEventListener('click', () => dialog.close());
  // A click on the backdrop, outside the dialog's box, closes it.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') show(open + 1);
    if (event.key === 'ArrowLeft') show(open - 1);
  });

  const step = () => items[0].getBoundingClientRect().width + 24;
  document.querySelector('[data-gallery-prev]')?.addEventListener('click', () => gallery.scrollBy({ left: -step(), behavior: 'smooth' }));
  document.querySelector('[data-gallery-next]')?.addEventListener('click', () => gallery.scrollBy({ left: step(), behavior: 'smooth' }));
}
