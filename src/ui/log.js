import { todayIso, SLOTS } from '../engine/planner.js';
import { el, escapeHtml, appendHtml } from './dom.js';

export const MAX_PORTION_GRAMS = 5000;

/**
 * A portion is a real number of grams greater than 0 and at most 5000.
 * Returns the number, or null when the field is empty, not a number, zero, negative or too large.
 */
export function parsePortion(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const grams = Number(raw);
  if (!Number.isFinite(grams) || grams <= 0 || grams > MAX_PORTION_GRAMS) return null;
  return grams;
}

export function renderLog(ctx) {
  const { state, recipesById, foods } = ctx;
  const root = el(`<div class="screen screen-log"></div>`);
  const today = todayIso();

  root.appendChild(el(`<header class="brand brand-compact">
    <button type="button" class="btn-text back" data-back>← Plan</button>
    <div><h1>Log a meal</h1><p>From the plan or a free search.</p></div>
  </header>`));

  if (!state.plan) {
    root.appendChild(el(`<section class="card empty-state">
      <p class="muted">Build a month plan first, then come back to log a meal.</p>
      <button type="button" class="btn-primary" data-go="targets">Go to Targets</button>
    </section>`));
    root.querySelector('[data-go="targets"]').addEventListener('click', () => ctx.navigate('targets'));
    root.querySelector('[data-back]')?.addEventListener('click', () => ctx.navigate('plan'));
    root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));
    return root;
  }

  const draft = ctx.logDraft || { items: [] };
  ctx.logDraft = draft;

  const mode = el(`<section class="card">
    <div class="mode-tabs">
      <button type="button" class="mode-tab is-active" data-mode="plan">From plan</button>
      <button type="button" class="mode-tab" data-mode="search">Free search</button>
    </div>
    <div class="mode-body" data-body="plan"></div>
    <div class="mode-body hidden" data-body="search"></div>
  </section>`);

  const planBody = mode.querySelector('[data-body="plan"]');
  // This mode always lists today, not the day selected on the Plan screen: say which date it is.
  const planDate = state.plan.days[today] ? today : Object.keys(state.plan.days).sort()[0];
  const todayMeals = state.plan.days[planDate];
  planBody.appendChild(el(`<p class="field-label" data-plan-date>Today's planned meals (${planDate})</p>`));
  for (const slot of SLOTS) {
    const recipe = recipesById.get(todayMeals[slot]);
    const row = el(`<div class="plan-meal-row">
      <div>
        <div class="meal-slot">${slot}</div>
        <div>${recipe?.icon || ''} ${escapeHtml(recipe?.name || '')}</div>
      </div>
      <button type="button" class="btn-secondary btn-small" data-add-recipe="${recipe?.id}">Add as eaten</button>
    </div>`);
    planBody.appendChild(row);
  }

  const searchBody = mode.querySelector('[data-body="search"]');
  appendHtml(searchBody, `<label class="field">
    <span>Search a food</span>
    <input type="search" placeholder="e.g. pizza, ice cream" data-search>
  </label>
  <div class="search-results" data-results></div>
  <label class="field">
    <span>Portion (grams)</span>
    <input type="number" min="1" max="5000" step="1" placeholder="e.g. 150" value="100" data-portion>
  </label>
  <p class="field-error" data-portion-error hidden>Enter a portion between 1 and 5000 g</p>
  <button type="button" class="btn-secondary" data-add-search disabled>Add food</button>`);

  root.appendChild(mode);

  const loggedCard = el(`<section class="card">
    <h3>This meal</h3>
    <ul class="logged-items" data-items></ul>
    <p class="muted tiny empty-hint" data-empty>Nothing added yet.</p>
    <button type="button" class="btn-primary" data-save disabled>Save and update plan</button>
  </section>`);
  root.appendChild(loggedCard);
  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  let selectedFoodId = null;

  const paintItems = () => {
    const ul = root.querySelector('[data-items]');
    const empty = root.querySelector('[data-empty]');
    const saveBtn = root.querySelector('[data-save]');
    ul.innerHTML = '';
    draft.items.forEach((it, index) => {
      const food = foods.find((f) => f.id === it.foodId);
      const li = el(`<li class="logged-item">
        <span>${escapeHtml(food?.name || it.foodId)}</span>
        <input type="number" min="1" value="${it.grams}" data-edit="${index}">
        <span class="muted">g</span>
        <button type="button" class="btn-icon" data-del="${index}" aria-label="Remove">×</button>
      </li>`);
      ul.appendChild(li);
    });
    empty.style.display = draft.items.length ? 'none' : 'block';
    saveBtn.disabled = draft.items.length === 0;
    ul.querySelectorAll('[data-edit]').forEach((input) => {
      input.addEventListener('change', () => {
        const index = Number(input.dataset.edit);
        const grams = parsePortion(input.value);
        if (grams === null) {
          input.value = draft.items[index].grams;
          return;
        }
        draft.items[index].grams = grams;
        paintItems();
      });
    });
    ul.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.items.splice(Number(btn.dataset.del), 1);
        paintItems();
      });
    });
  };

  const addFood = (foodId, grams) => {
    draft.items.push({ foodId, grams });
    paintItems();
  };

  mode.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      mode.querySelectorAll('.mode-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const which = tab.dataset.mode;
      mode.querySelectorAll('.mode-body').forEach((b) => {
        b.classList.toggle('hidden', b.dataset.body !== which);
      });
    });
  });

  root.querySelectorAll('[data-add-recipe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const recipe = recipesById.get(btn.dataset.addRecipe);
      if (!recipe) return;
      for (const ing of recipe.ingredients) addFood(ing.foodId, ing.grams);
    });
  });

  const resultsEl = root.querySelector('[data-results]');
  const searchInput = root.querySelector('[data-search]');
  const addSearchBtn = root.querySelector('[data-add-search]');

  const runSearch = () => {
    const q = (searchInput.value || '').trim().toLowerCase();
    resultsEl.innerHTML = '';
    selectedFoodId = null;
    addSearchBtn.disabled = true;
    if (q.length < 2) return;
    const hits = foods.filter((f) => f.name.toLowerCase().includes(q) || f.id.includes(q)).slice(0, 8);
    for (const f of hits) {
      const b = el(`<button type="button" class="search-hit">${escapeHtml(f.name)}</button>`);
      b.addEventListener('click', () => {
        selectedFoodId = f.id;
        resultsEl.querySelectorAll('.search-hit').forEach((x) => x.classList.remove('is-selected'));
        b.classList.add('is-selected');
        addSearchBtn.disabled = false;
      });
      resultsEl.appendChild(b);
    }
  };
  searchInput.addEventListener('input', runSearch);

  const portionInput = root.querySelector('[data-portion]');
  const portionError = root.querySelector('[data-portion-error]');
  portionInput.addEventListener('input', () => {
    portionError.hidden = true;
  });
  addSearchBtn.addEventListener('click', () => {
    if (!selectedFoodId) return;
    const grams = parsePortion(portionInput.value);
    if (grams === null) {
      portionError.hidden = false;
      portionInput.focus();
      return;
    }
    portionError.hidden = true;
    addFood(selectedFoodId, grams);
  });

  root.querySelector('[data-save]').addEventListener('click', () => {
    ctx.saveLogAndReplan([...draft.items]);
  });
  root.querySelector('[data-back]').addEventListener('click', () => ctx.navigate('plan'));

  paintItems();
  return root;
}
