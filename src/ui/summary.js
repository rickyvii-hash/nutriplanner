import { buildSummary } from '../engine/summary.js';
import { PROFILES } from '../engine/profiles.js';
import { el, escapeHtml, nutrientLabel, nutrientUnit, formatKind } from './dom.js';

function decimalsFor(key) {
  return key === 'kcal' || key === 'sodium' ? 0 : 1;
}

function averageText(row) {
  if (row.average === null || row.average === undefined) return 'n/a';
  const text = `${row.average.toFixed(decimalsFor(row.nutrient))} ${nutrientUnit(row.nutrient)}`;
  return row.incomplete ? `≥${text}` : text;
}

export function renderSummary(ctx) {
  const { state, recipesById, foodsById } = ctx;
  const root = el(`<div class="screen screen-summary"></div>`);

  root.appendChild(el(`<header class="brand brand-compact">
    <button type="button" class="btn-text back" data-back>← Plan</button>
    <div><h1>Summary for your doctor</h1><p>Targets and what was logged.</p></div>
  </header>`));

  const summary = buildSummary({
    targets: state.targets || [],
    plan: state.plan,
    log: state.log || [],
    recipesById,
    foodsById,
  });
  const profile = PROFILES.find((p) => p.id === state.profileId);

  const periodText = summary.period.from
    ? `${summary.period.from} to ${summary.period.to}`
    : 'No plan yet';

  root.appendChild(el(`<section class="card summary-meta">
    <h2>Profile and period</h2>
    <p><span class="muted">Profile:</span> ${escapeHtml(profile?.name || 'None selected')}</p>
    <p><span class="muted">Period:</span> ${escapeHtml(periodText)}</p>
    <p><span class="muted">Days with logged meals:</span> ${summary.loggedDays}</p>
  </section>`));

  const sourceNote = summary.source === 'log'
    ? `Averages per day over ${summary.days} recorded day${summary.days === 1 ? '' : 's'}. Only meals entered in the app are counted, so a day with just some meals logged looks low on minimum targets.`
    : 'No meals have been logged. The averages below come from your planned month, not from meals you logged.';

  const table = el(`<section class="card">
    <h2>Targets</h2>
    <p class="muted tiny" data-source>${escapeHtml(sourceNote)}</p>
    <table class="summary-table">
      <thead><tr><th>Objective</th><th>Average per day</th><th>Status</th></tr></thead>
      <tbody></tbody>
    </table>
  </section>`);
  const tbody = table.querySelector('tbody');
  for (const row of summary.rows) {
    const objective = `${nutrientLabel(row.nutrient)} (${formatKind(row.kind).toLowerCase()} ${row.daily} ${nutrientUnit(row.nutrient)})`;
    tbody.appendChild(el(`<tr>
      <td>${escapeHtml(objective)}</td>
      <td>${averageText(row)}</td>
      <td class="summary-status">${escapeHtml(row.status)}</td>
    </tr>`));
  }
  root.appendChild(table);

  const mealsCard = el(`<section class="card">
    <h2>Logged meals</h2>
    <div data-meals></div>
  </section>`);
  const mealsEl = mealsCard.querySelector('[data-meals]');
  if (summary.meals.length === 0) {
    mealsEl.appendChild(el(`<p class="muted">No meals logged yet.</p>`));
  } else {
    const list = el(`<ul class="summary-meals"></ul>`);
    for (const meal of summary.meals) {
      const when = meal.time ? `${meal.date} · ${meal.time}` : meal.date;
      const items = meal.items
        .map((item) => `<li>${escapeHtml(item.name)} <span class="muted">${item.grams} g</span></li>`)
        .join('');
      list.appendChild(el(`<li class="summary-meal">
        <div class="summary-meal-date">${escapeHtml(when)}</div>
        <ul class="summary-meal-items">${items}</ul>
      </li>`));
    }
    mealsEl.appendChild(list);
  }
  root.appendChild(mealsCard);

  root.appendChild(el(`<section class="card note-card">
    <p class="muted">This summary lists only what you entered and is not medical advice.</p>
  </section>`));

  const actions = el(`<div class="stack-actions no-print">
    <button type="button" class="btn-primary" data-action="print">Print or save as PDF</button>
  </div>`);
  root.appendChild(actions);
  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  actions.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
  root.querySelector('[data-back]').addEventListener('click', () => ctx.navigate('plan'));

  return root;
}
