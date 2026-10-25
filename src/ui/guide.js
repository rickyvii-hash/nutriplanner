// F6 — Guide overlay: the three steps, shown on a fresh device or from "How it works".
// The first-run version saves the dismissal; reopening it later never clears that flag.

import { GUIDE_STEPS } from '../engine/guide.js';
import { el, escapeHtml } from './dom.js';

export const GUIDE_TITLE = 'How it works';

/**
 * Open the guide over the current screen. `firstRun` marks the automatic opening:
 * closing it then saves the dismissal, so it does not come back on the next visit.
 */
export function openGuide(ctx, { firstRun = false } = {}) {
  if (typeof document === 'undefined') return null;
  const mount = document.getElementById('app');
  if (!mount) return null;
  mount.querySelectorAll('[data-guide-panel]').forEach((node) => node.remove());

  const overlay = el(`<div class="guide-overlay" data-guide-panel>
    <section class="guide-panel" role="dialog" aria-modal="true" aria-label="${GUIDE_TITLE}">
      <h2>${GUIDE_TITLE}</h2>
      <ol class="guide-steps">
        ${GUIDE_STEPS.map((step, index) => `<li class="guide-step">
          <span class="guide-step-num" aria-hidden="true">${index + 1}</span>
          <span class="guide-step-text">
            <span class="guide-step-title">${escapeHtml(step.title)}</span>
            <span class="guide-step-body">${escapeHtml(step.body)}</span>
          </span>
        </li>`).join('')}
      </ol>
      <div class="guide-actions">
        <button type="button" class="btn-primary" data-action="close-guide">${firstRun ? 'Got it' : 'Dismiss'}</button>
      </div>
      <p class="footer-note">Support tool, not medical advice.</p>
    </section>
  </div>`);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    // Only the automatic first-run opening records the dismissal.
    if (firstRun) ctx.dismissGuide?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  overlay.querySelector('[data-action="close-guide"]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  mount.appendChild(overlay);
  overlay.querySelector('[data-action="close-guide"]')?.focus();
  return overlay;
}
