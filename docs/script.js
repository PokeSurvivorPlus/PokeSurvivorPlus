// PokeSurvivor Plus website: mobile menu, browser tabs in the install steps, screenshot lightbox.
(() => {
  // Mobile menu
  const btn = document.querySelector('.menu-btn');
  const links = document.getElementById('nav-links');
  if (btn && links) {
    btn.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    links.addEventListener('click', (e) => {
      if (e.target.closest('a')) { links.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }

  // Install step 1: what to click in each browser
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  const note = document.querySelector('.browser-note');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    if (note) note.textContent = t.dataset.note;
  }));

  // Lightbox
  const dlg = document.querySelector('.lightbox');
  const items = [...document.querySelectorAll('.grid button[data-full]')];
  if (!dlg || !items.length || typeof dlg.showModal !== 'function') {
    items.forEach((b) => b.addEventListener('click', () => window.open(b.dataset.full, '_blank', 'noopener')));
    return;
  }
  const img = dlg.querySelector('img');
  const cap = dlg.querySelector('figcaption');
  let at = 0;
  const show = (i) => {
    at = (i + items.length) % items.length;
    const b = items[at];
    img.src = b.dataset.full;
    img.alt = b.querySelector('img').alt;
    cap.textContent = b.dataset.cap || '';
  };
  items.forEach((b, i) => b.addEventListener('click', () => { show(i); dlg.showModal(); }));
  dlg.querySelector('.lb-close').addEventListener('click', () => dlg.close());
  dlg.querySelector('.lb-prev').addEventListener('click', () => show(at - 1));
  dlg.querySelector('.lb-next').addEventListener('click', () => show(at + 1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'ArrowRight') show(at + 1);
  });
  dlg.addEventListener('close', () => { items[at].focus(); });
})();
