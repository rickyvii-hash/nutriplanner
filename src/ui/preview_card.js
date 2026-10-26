// D29: the small "If you save this" card on Outside the menu. It only renders
// what previewExtra computed; it never plans, stores or navigates.

import { el, escapeHtml } from './dom.js';
import { effectRowModel } from './updated.js';
import {
  PREVIEW_HEADLINE, PREVIEW_NO_CHANGE, PREVIEW_UNREACHABLE_NOTE,
} from '../engine/preview_extra.js';

export { PREVIEW_HEADLINE, PREVIEW_NO_CHANGE, PREVIEW_UNREACHABLE_NOTE };

/**
 * The card text as plain data, or null when no card should be shown. The rows
 * are the exact Effect rows of Plan updated, taken from the same model.
 */
export function previewCardModel(preview) {
  if (!preview?.shown) return null;
  return {
    headline: PREVIEW_HEADLINE,
    reason: preview.reason || PREVIEW_NO_CHANGE,
    note: preview.note || null,
    nothingToChange: Boolean(preview.nothingToChange),
    rows: (preview.rows || preview.effects || []).map(effectRowModel),
  };
}

/** The card element for the model, or null when there is nothing to show. */
export function renderPreviewCard(preview) {
  const model = previewCardModel(preview);
  if (!model) return null;
  const card = el(`<section class="card preview-card" data-preview-card>
    <h3>${escapeHtml(model.headline)}</h3>
    <p class="preview-reason">${escapeHtml(model.reason)}</p>
    ${model.note ? `<p class="muted tiny preview-note">${escapeHtml(model.note)}</p>` : ''}
    <ul class="effect-list preview-effects"></ul>
  </section>`);
  const ul = card.querySelector('.preview-effects');
  for (const row of model.rows) {
    ul.appendChild(el(`<li class="effect-item">
      <div class="row preview-effect">
        <strong>${escapeHtml(row.label)}</strong>
        <span class="pill">${escapeHtml(row.status)}</span>
      </div>
      <div class="muted tiny">${escapeHtml(row.detail)}</div>
    </li>`));
  }
  return card;
}
