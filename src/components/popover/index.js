/** Reusable popover: position relative to its trigger, close on outside click/Escape, and reposition on scroll/resize. */
export function mountPopover({ trigger, panel, align = 'start', onOpen = () => {} }) {
  const doc = trigger.ownerDocument;
  const win = doc.defaultView;
  panel.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', panel.id);
  trigger.setAttribute('aria-haspopup', 'dialog');
  const resizeObserver = new win.ResizeObserver(() => {
    if (!panel.hidden) position();
  });
  function position() {
    const anchor = trigger.getBoundingClientRect();
    panel.style.maxHeight = `${win.innerHeight - 24}px`;
    const bounds = panel.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(
      Math.max(margin, align === 'end' ? anchor.right - bounds.width : anchor.left),
      Math.max(margin, win.innerWidth - bounds.width - margin),
    );
    const below = anchor.bottom + 10;
    const above = anchor.top - bounds.height - 10;
    const preferredTop =
      below + bounds.height <= win.innerHeight - margin ? below : above >= margin ? above : margin;
    const top = Math.min(Math.max(margin, preferredTop), win.innerHeight - bounds.height - margin);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${win.innerHeight - top - margin}px`;
  }
  function close({ restoreFocus = false } = {}) {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('keydown', keydown);
    resizeObserver.disconnect();
    win.removeEventListener('resize', position);
    win.removeEventListener('scroll', position, true);
    if (restoreFocus) trigger.focus();
  }
  function outside(event) {
    const path = event.composedPath();
    if (!path.includes(panel) && !path.includes(trigger)) close();
  }
  function keydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close({ restoreFocus: true });
  }
  function open() {
    if (!panel.hidden) return;
    onOpen();
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    position();
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', keydown);
    resizeObserver.observe(panel);
    win.addEventListener('resize', position);
    win.addEventListener('scroll', position, true);
  }
  function toggle() {
    panel.hidden ? open() : close();
  }
  trigger.addEventListener('click', toggle);
  return {
    open,
    close,
    reposition: position,
    destroy() {
      close();
      trigger.removeEventListener('click', toggle);
    },
  };
}
