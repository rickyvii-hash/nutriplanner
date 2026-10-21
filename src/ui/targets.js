import { PROFILES } from '../engine/profiles.js';
import { NUTRIENTS } from '../engine/nutrients.js';
import { el, escapeHtml, nutrientLabel, nutrientUnit, formatKind } from './dom.js';

export function renderTargets(ctx) {
  const { state, onChange } = ctx;
  const root = el(`<div class="screen screen-targets"></div>`);

  root.appendChild(el(`<header class="brand">
    <span class="logo" aria-hidden="true">🌿</span>
    <div>
      <h1>NutriPlanner</h1>
      <p>Adaptive meal planning that flexes with real life.</p>
    </div>
  </header>`));

  if (!state.profileId) {
    const choose = el(`<section class="card">
      <h2>Choose a profile</h2>
      <p class="muted">Pick a starting point. You can edit every target afterwards.</p>
      <div class="profile-grid"></div>
    </section>`);
    const grid = choose.querySelector('.profile-grid');
    for (const p of PROFILES) {
      const card = el(`<button type="button" class="profile-card">
        <span class="profile-icon" aria-hidden="true">${p.icon}</span>
        <span class="profile-name">${escapeHtml(p.name)}</span>
        <span class="profile-blurb">${escapeHtml(p.blurb)}</span>
      </button>`);
      card.addEventListener('click', () => {
        onChange({
          ...state,
          profileId: p.id,
          targets: p.targets.map((t) => ({ ...t })),
        });
      });
      grid.appendChild(card);
    }
    root.appendChild(choose);
    root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));
    return root;
  }

  const profile = PROFILES.find((p) => p.id === state.profileId);
  root.appendChild(el(`<section class="card">
    <div class="row">
      <div>
        <h2>Your targets</h2>
        <p class="muted">Profile: ${escapeHtml(profile?.name || state.profileId)}. Edit any value, or add a custom target.</p>
      </div>
      <button type="button" class="btn-text" data-action="change-profile">Change profile</button>
    </div>
  </section>`));

  const list = el(`<section class="card target-list"><h3>Daily targets</h3><div class="targets"></div></section>`);
  const targetsEl = list.querySelector('.targets');

  state.targets.forEach((t, index) => {
    const row = el(`<div class="target-row">
      <label class="sr-only" for="nut-${index}">Nutrient</label>
      <select id="nut-${index}" data-i="${index}" data-field="nutrient"></select>
      <label class="sr-only" for="kind-${index}">Min or max</label>
      <select id="kind-${index}" data-i="${index}" data-field="kind">
        <option value="min">Min</option>
        <option value="max">Max</option>
      </select>
      <label class="sr-only" for="val-${index}">Daily value</label>
      <input id="val-${index}" type="number" min="0" step="1" data-i="${index}" data-field="daily" value="${t.daily}">
      <span class="unit">${nutrientUnit(t.nutrient)}</span>
      <button type="button" class="btn-icon" data-remove="${index}" aria-label="Remove target">×</button>
    </div>`);
    const nutSel = row.querySelector('[data-field="nutrient"]');
    for (const n of NUTRIENTS) {
      const opt = document.createElement('option');
      opt.value = n.key;
      opt.textContent = n.label;
      if (n.key === t.nutrient) opt.selected = true;
      nutSel.appendChild(opt);
    }
    row.querySelector('[data-field="kind"]').value = t.kind;
    targetsEl.appendChild(row);
  });

  root.appendChild(list);

  const actions = el(`<div class="stack-actions">
    <button type="button" class="btn-secondary" data-action="add-target">Add custom target</button>
    <button type="button" class="btn-primary" data-action="build">Build my month plan</button>
  </div>`);
  root.appendChild(actions);
  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  const syncField = (i, field, value) => {
    const next = state.targets.map((t, idx) => {
      if (idx !== i) return { ...t };
      if (field === 'daily') return { ...t, daily: Number(value) || 0 };
      return { ...t, [field]: value };
    });
    onChange({ ...state, targets: next });
  };

  root.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('change', () => {
      syncField(Number(input.dataset.i), input.dataset.field, input.value);
    });
  });

  root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.remove);
      onChange({ ...state, targets: state.targets.filter((_, idx) => idx !== i) });
    });
  });

  root.querySelector('[data-action="change-profile"]')?.addEventListener('click', () => {
    onChange({ ...state, profileId: null, targets: [], plan: null });
  });

  root.querySelector('[data-action="add-target"]')?.addEventListener('click', () => {
    const used = new Set(state.targets.map((t) => t.nutrient));
    const nextNut = NUTRIENTS.find((n) => !used.has(n.key)) || NUTRIENTS[0];
    onChange({
      ...state,
      targets: [...state.targets, { nutrient: nextNut.key, kind: 'min', daily: 0 }],
    });
  });

  root.querySelector('[data-action="build"]')?.addEventListener('click', () => {
    ctx.buildPlan();
  });

  return root;
}

export { formatKind, nutrientLabel };
