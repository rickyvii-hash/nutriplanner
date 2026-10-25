import { el, escapeHtml, nutrientLabel, nutrientUnit } from './dom.js';

/** Per-day average text: "n/a" when nothing is known, "≥12.2" when the average is a partial sum. */
function averageText(value, incomplete, unknown, decimals) {
  if (unknown) return 'n/a';
  const text = value.toFixed(decimals);
  return incomplete ? `≥${text}` : text;
}

export function renderUpdated(ctx) {
  const { proposal } = ctx;
  const root = el(`<div class="screen screen-updated"></div>`);

  // With nothing to accept, the screen is a check, not an update: the title says so.
  const nothingToChange = Boolean(proposal?.nothingToChange);
  const title = nothingToChange ? 'Plan checked' : 'Plan updated';
  root.appendChild(el(`<header class="brand brand-compact">
    <span class="logo" aria-hidden="true">🌿</span>
    <div><h1>${title}</h1><p>Adaptive meal planning that flexes with real life.</p></div>
  </header>`));

  if (!proposal) {
    root.appendChild(el(`<section class="card empty-state">
      <p class="muted">Log a meal to see an updated plan here.</p>
      <button type="button" class="btn-primary" data-go="plan">Back to Plan</button>
    </section>`));
    root.querySelector('[data-go="plan"]').addEventListener('click', () => ctx.navigate('plan'));
    root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));
    return root;
  }

  if (nothingToChange) {
    root.appendChild(el(`<section class="card success-banner soft">
      <h2>No changes needed</h2>
      <p>${escapeHtml(proposal.reason)}</p>
    </section>`));
  } else {
    const changedDays = new Set((proposal.changed || []).map((c) => c.date)).size;
    const adjusted = changedDays === 1
      ? 'The next 1 day was adjusted'
      : `The next ${changedDays} days were adjusted`;
    root.appendChild(el(`<section class="card success-banner">
      <h2>${proposal.unreachable ? 'Closest plan ready' : 'Plan updated'}</h2>
      <p class="muted">${proposal.unreachable ? 'Not every target can be met with the available recipes. Here is the closest option.' : `${adjusted} from your targets and what you logged. The rest of the month is unchanged.`}</p>
    </section>`));
  }

  if (proposal.changed?.length) {
    const changes = el(`<section class="card"><h3>What changed</h3><ul class="change-list"></ul></section>`);
    const ul = changes.querySelector('.change-list');
    for (const c of proposal.changed) {
      ul.appendChild(el(`<li class="change-item">
        <div class="change-date">${c.date} · ${c.slot}</div>
        <div class="change-before"><span class="muted">Before</span> ${c.beforeIcon} ${escapeHtml(c.beforeName)}</div>
        <div class="change-after"><span class="muted">After</span> ${c.afterIcon} ${escapeHtml(c.afterName)}</div>
      </li>`));
    }
    root.appendChild(changes);
  }

  root.appendChild(el(`<section class="card">
    <h3>Reason</h3>
    <p class="reason-text">${escapeHtml(proposal.reason)}</p>
  </section>`));

  if (proposal.effects?.length) {
    const fx = el(`<section class="card"><h3>Effect on targets</h3><ul class="effect-list"></ul></section>`);
    const ul = fx.querySelector('.effect-list');
    for (const e of proposal.effects) {
      const decimals = e.nutrient === 'kcal' || e.nutrient === 'sodium' ? 0 : 1;
      const before = averageText(e.before, e.beforeIncomplete, e.beforeUnknown, decimals);
      const after = averageText(e.after, e.afterIncomplete, e.afterUnknown, decimals);
      ul.appendChild(el(`<li class="effect-item">
        <div class="row">
          <strong>${nutrientLabel(e.nutrient)}</strong>
          <span class="pill">${escapeHtml(e.status)}</span>
        </div>
        <div class="muted tiny">${before} → ${after} ${nutrientUnit(e.nutrient)}/day avg (goal ${e.kind} ${e.daily})</div>
      </li>`));
    }
    root.appendChild(fx);
  }

  if (proposal.keptForBought?.length) {
    const note = el(`<section class="card note-card">
      <h3>Already bought</h3>
      <p class="muted">Some meals were kept because their ingredients are already at home.</p>
      <ul class="kept-list"></ul>
    </section>`);
    const ul = note.querySelector('.kept-list');
    const seen = new Set();
    for (const k of proposal.keptForBought.slice(0, 6)) {
      const key = `${k.date}-${k.slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ul.appendChild(el(`<li>${k.date} · ${k.slot}</li>`));
    }
    root.appendChild(note);
  }

  if (nothingToChange) {
    // Nothing was accepted or rejected, so there is one clear primary: go back.
    const actions = el(`<div class="stack-actions">
      <button type="button" class="btn-primary" data-back-to-plan>Back to Plan</button>
    </div>`);
    root.appendChild(actions);
    actions.querySelector('[data-back-to-plan]').addEventListener('click', () => {
      if (typeof ctx.dismissUpdatedPlan === 'function') ctx.dismissUpdatedPlan();
      else ctx.navigate('plan');
    });
    root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));
    return root;
  }

  const actions = el(`<div class="stack-actions dual">
    <button type="button" class="btn-secondary" data-keep>Keep my original plan</button>
    <button type="button" class="btn-primary" data-use>Use updated plan</button>
  </div>`);
  root.appendChild(actions);

  actions.querySelector('[data-keep]').addEventListener('click', () => ctx.keepOriginalPlan());
  actions.querySelector('[data-use]').addEventListener('click', () => ctx.useUpdatedPlan());
  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  return root;
}
