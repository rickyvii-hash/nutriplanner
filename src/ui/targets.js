import { PROFILES } from '../engine/profiles.js';
import { NUTRIENTS } from '../engine/nutrients.js';
import { el, escapeHtml, nutrientLabel, nutrientUnit, formatKind } from './dom.js';

/** Sensible starting value for a custom target, never 0. */
export const CUSTOM_TARGET_DEFAULTS = {
  kcal: 2000,
  protein: 70,
  fat: 70,
  satFat: 20,
  carbs: 250,
  fibre: 25,
  sugars: 50,
  sodium: 2300,
};

export function defaultTargetDaily(nutrient) {
  return CUSTOM_TARGET_DEFAULTS[nutrient] ?? null;
}

/**
 * Next target to add: the first nutrient not used yet, with its default value.
 * Returns null when all nutrients already have a target (no duplicates).
 */
export function nextCustomTarget(targets) {
  const used = new Set((targets || []).map((t) => t.nutrient));
  const nutrient = NUTRIENTS.find((n) => !used.has(n.key));
  if (!nutrient) return null;
  return { nutrient: nutrient.key, kind: 'min', daily: defaultTargetDaily(nutrient.key) };
}

/** A target value must be a number greater than 0. Returns the number, or null when invalid. */
export function parseTargetDaily(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

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

  if (ctx.monthBanner) {
    root.appendChild(el(`<section class="card note-card month-banner" data-month-banner>
      <p>${escapeHtml(ctx.monthBanner)}</p>
    </section>`));
  }

  root.appendChild(el(`<section class="card">
    <div class="row">
      <div>
        <h2>Your targets</h2>
        <p class="muted">Profile: ${escapeHtml(profile?.name || state.profileId)}. Edit any value, or add a custom target.</p>
      </div>
      <button type="button" class="btn-text" data-action="change-profile">Change profile</button>
    </div>
    <p class="muted tiny">Changing profile asks for confirmation and keeps your meal log unless you choose to clear it.</p>
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
      <input id="val-${index}" type="number" min="1" step="1" data-i="${index}" data-field="daily" value="${t.daily}">
      <span class="unit">${nutrientUnit(t.nutrient)}</span>
      <button type="button" class="btn-icon" data-remove="${index}" aria-label="Remove target">×</button>
      <p class="field-error" data-error hidden>Enter a number greater than 0</p>
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

  if (state.plan) {
    // Reachable from Targets too: begin again from the profile choice.
    root.appendChild(el(`<section class="card plan-settings">
      <h3>Plan settings</h3>
      <p class="muted tiny">Start over asks for confirmation, then erases the month plan, meal logs and shopping ticks.</p>
      <button type="button" class="btn-secondary" data-action="start-over">Start over</button>
    </section>`));
  }

  const actions = el(`<div class="stack-actions">
    <button type="button" class="btn-secondary" data-action="add-target">Add custom target</button>
    <button type="button" class="btn-primary" data-action="build">Build my month plan</button>
  </div>`);
  root.appendChild(actions);
  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  const syncField = (i, field, value) => {
    const next = state.targets.map((t, idx) => {
      if (idx !== i) return { ...t };
      return { ...t, [field]: value };
    });
    onChange({ ...state, targets: next });
  };

  root.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('change', () => {
      const i = Number(input.dataset.i);
      const field = input.dataset.field;
      if (field === 'daily') {
        const error = input.closest('.target-row')?.querySelector('[data-error]');
        const daily = parseTargetDaily(input.value);
        if (daily === null) {
          // Keep the previous value and explain, instead of storing 0.
          input.value = state.targets[i]?.daily ?? '';
          if (error) error.hidden = false;
          return;
        }
        if (error) error.hidden = true;
        syncField(i, field, daily);
        return;
      }
      syncField(i, field, input.value);
    });
  });

  root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.remove);
      onChange({ ...state, targets: state.targets.filter((_, idx) => idx !== i) });
    });
  });

  // Changing profile always confirms first: the log is kept unless the person clears it.
  root.querySelector('[data-action="change-profile"]')?.addEventListener('click', () => {
    ctx.changeProfile?.();
  });

  root.querySelector('[data-action="start-over"]')?.addEventListener('click', () => {
    ctx.startOver?.();
  });

  const addTargetBtn = root.querySelector('[data-action="add-target"]');
  if (addTargetBtn) {
    if (!nextCustomTarget(state.targets)) {
      addTargetBtn.disabled = true;
      addTargetBtn.textContent = 'All nutrients already have a target';
    }
    addTargetBtn.addEventListener('click', () => {
      const target = nextCustomTarget(state.targets);
      if (!target) return;
      onChange({ ...state, targets: [...state.targets, target] });
    });
  }

  root.querySelector('[data-action="build"]')?.addEventListener('click', () => {
    ctx.buildPlan();
  });

  return root;
}

export { formatKind, nutrientLabel };
