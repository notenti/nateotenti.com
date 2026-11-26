// Behavior for Comment.astro: Nate's notes fold out over the content.
// One note open at a time; Escape or a click elsewhere closes it.
const toggles = [...document.querySelectorAll<HTMLButtonElement>('.comment-toggle')];
const panelFor = (btn: HTMLButtonElement) => document.getElementById(btn.getAttribute('aria-controls')!);
const isOpen = (btn: HTMLButtonElement) => btn.getAttribute('aria-expanded') === 'true';

const setOpen = (btn: HTMLButtonElement, open: boolean) => {
  const panel = panelFor(btn);
  btn.setAttribute('aria-expanded', String(open));
  if (btn.hasAttribute('aria-label')) {
    btn.setAttribute('aria-label', open ? "Hide Nate's note" : "Show Nate's note");
  }
  if (!panel) return;
  if (open) {
    // Keep the note on screen: nudge it in from whichever edge it would cross.
    panel.style.setProperty('--nudge', '0px');
    const r = panel.getBoundingClientRect();
    const gutter = 16;
    const vw = document.documentElement.clientWidth;
    let nudge = 0;
    if (r.right > vw - gutter) nudge = vw - gutter - r.right;
    if (r.left + nudge < gutter) nudge = gutter - r.left;
    panel.style.setProperty('--nudge', `${nudge}px`);
  }
  panel.classList.toggle('is-open', open);
  // And down: if the note opens past the bottom of the screen, bring it into view.
  if (open) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Wait for it to finish folding out (150ms) so its full size is measured.
    setTimeout(() => panel.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }), reduce ? 0 : 160);
  }
};
const closeAll = (except?: HTMLButtonElement) =>
  toggles.forEach((b) => b !== except && isOpen(b) && setOpen(b, false));

toggles.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !isOpen(btn);
    closeAll(btn);
    setOpen(btn, open);
  });
});
document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('.comment-panel')) closeAll();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = toggles.find(isOpen);
  if (open) {
    closeAll();
    open.focus();
  }
});
