// Confirmation panels for Start over and Change profile.
// Nothing is erased until the person confirms; Cancel closes the panel and changes nothing.

import { el, escapeHtml } from './dom.js';
import { startOverConfirmCopy, changeProfileCopy } from '../store.js';

/** Remove any panel already open, so only one dialog is on screen. */
function clearPanels(mount) {
  mount.querySelectorAll('[data-reset-panel]').forEach((node) => node.remove());
}

/**
 * Open a modal panel inside the app. `buildBody(overlay)` fills the body and returns
 * the value handed to `onConfirm` (so a checkbox can be read at confirm time).
 */
function openPanel({ title, confirmLabel, cancelLabel = 'Cancel', buildBody, onConfirm }) {
  if (typeof document === 'undefined') return null;
  const mount = document.getElementById('app');
  if (!mount) return null;
  clearPanels(mount);

  const overlay = el(`<div class="confirm-overlay" data-reset-panel>
    <section class="confirm-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <h2>${escapeHtml(title)}</h2>
      <div class="confirm-body"></div>
      <div class="confirm-actions">
        <button type="button" class="btn-secondary" data-action="cancel">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="btn-primary" data-action="confirm">${escapeHtml(confirmLabel)}</button>
      </div>
    </section>
  </div>`);

  const readValue = buildBody(overlay.querySelector('.confirm-body')) || (() => undefined);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
  overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
    const value = readValue();
    close();
    onConfirm(value);
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  mount.appendChild(overlay);
  overlay.querySelector('[data-action="confirm"]')?.focus();
  return overlay;
}

/** "Start over": list what will be erased, then erase on confirm. */
export function openStartOverPanel(ctx) {
  const copy = startOverConfirmCopy();
  return openPanel({
    title: copy.title,
    confirmLabel: copy.confirmLabel,
    cancelLabel: copy.cancelLabel,
    buildBody: (body) => {
      body.appendChild(el(`<div>
        <p>${escapeHtml(copy.intro)}</p>
        <ul class="confirm-list">${copy.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <p class="muted tiny">${escapeHtml(copy.note)}</p>
      </div>`));
      return () => undefined;
    },
    onConfirm: () => ctx.confirmStartOver?.(),
  });
}

/** "Change profile": clear the plan, keep the log unless the person clears it too. */
export function openChangeProfilePanel(ctx) {  const copy = changeProfileCopy();
  return openPanel({
    title: copy.title,
    confirmLabel: copy.confirmLabel,
    cancelLabel: copy.cancelLabel,
    buildBody: (body) => {
      const content = el(`<div>
        <p>${escapeHtml(copy.intro)}</p>
        <label class="confirm-check">
          <input type="checkbox" data-action="clear-log">
          <span>${escapeHtml(copy.clearLabel)}</span>
        </label>
        <p class="muted tiny">${escapeHtml(copy.keepNote)}</p>
      </div>`);
      body.appendChild(content);
      const checkbox = content.querySelector('[data-action="clear-log"]');
      return () => ({ keepLog: !checkbox.checked });
    },
    onConfirm: (choice) => ctx.confirmChangeProfile?.({ keepLog: choice?.keepLog !== false }),
  });
}

/** One line per part of the saved data a restore replaces. */
function restoreLines(summary) {
  const s = summary || {};
  const count = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
  const planLine = count(s.planDays) > 0
    ? `Your month plan (${count(s.planDays)} days)`
    : 'Your month plan (none in this file)';
  return [
    `Your targets (${count(s.targets)})`,
    `Your meal choices (${count(s.meals)} meals a day)`,
    planLine,
    `Your meal logs (${count(s.logs)} entries)`,
    `Your lab notes (${count(s.labNotes)} notes)`,
  ];
}

/** "Restore from file": show what the file will replace, then apply it on confirm. */
export function openRestorePanel(ctx, data, summary) {
  return openPanel({
    title: 'Restore from file?',
    confirmLabel: 'Restore my data',
    cancelLabel: 'Cancel',
    buildBody: (body) => {
      body.appendChild(el(`<div>
        <p>This replaces what is saved on this device:</p>
        <ul class="confirm-list">${restoreLines(summary).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        <p class="muted tiny">Nothing changes until you confirm.</p>
      </div>`));
      return () => undefined;
    },
    onConfirm: () => ctx.confirmRestore?.(data),
  });
}
