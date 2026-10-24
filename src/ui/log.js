import { todayIso, SLOTS } from '../engine/planner.js';
import { el, escapeHtml, appendHtml } from './dom.js';
import { openRecipeDetail } from './recipe_detail.js';

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

/** An empty draft: free-search foods, grouped planned meals, skipped meals. */
export function newLogDraft() {
  return { items: [], groups: [], skipped: [] };
}

/** Make sure a draft has every list, so older saved drafts keep working. */
export function ensureDraft(draft) {
  const d = draft && typeof draft === 'object' ? draft : newLogDraft();
  if (!Array.isArray(d.items)) d.items = [];
  if (!Array.isArray(d.groups)) d.groups = [];
  if (!Array.isArray(d.skipped)) d.skipped = [];
  return d;
}

/** The eaten block for a planned recipe, or null when it was not added. */
export function draftGroupForRecipe(draft, recipeId) {
  if (!recipeId || !Array.isArray(draft?.groups)) return null;
  return draft.groups.find((g) => g.recipeId === recipeId) || null;
}

/** True while the planned recipe is shown as "In this meal". */
export function isRecipeInDraft(draft, recipeId) {
  return Boolean(draftGroupForRecipe(draft, recipeId));
}

/**
 * Add a planned meal as one block. Its ingredients stay together so the block can be
 * removed in one tap; adding the same recipe twice never duplicates it.
 */
export function addRecipeGroup(draft, recipe) {
  if (!recipe) return null;
  const d = ensureDraft(draft);
  const existing = draftGroupForRecipe(d, recipe.id);
  if (existing) return existing;
  const group = {
    id: `eaten-${recipe.slot}-${recipe.id}`,
    kind: 'eaten',
    slot: recipe.slot,
    recipeId: recipe.id,
    recipeName: recipe.name,
    items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
  };
  d.groups.push(group);
  return group;
}

/** Remove a whole block (all its ingredients at once) and clear its in-draft state. */
export function removeDraftGroup(draft, groupId) {
  if (!draft || !Array.isArray(draft.groups)) return draft;
  draft.groups = draft.groups.filter((g) => g.id !== groupId);
  return draft;
}

/** Remove one ingredient of a block; a block that loses its last ingredient disappears. */
export function removeGroupItem(draft, groupId, index) {
  const group = (draft?.groups || []).find((g) => g.id === groupId);
  if (!group) return draft;
  if (index < 0 || index >= group.items.length) return draft;
  group.items.splice(index, 1);
  if (group.items.length === 0) removeDraftGroup(draft, groupId);
  return draft;
}

/**
 * The flat food list that gets logged: every ingredient of every block, then the
 * foods added through free search. Totals match the old flat add exactly.
 */
export function flatDraftItems(draft) {
  const groups = Array.isArray(draft?.groups) ? draft.groups : [];
  const items = Array.isArray(draft?.items) ? draft.items : [];
  return [
    ...groups.flatMap((g) => g.items.map((it) => ({ foodId: it.foodId, grams: it.grams }))),
    ...items.map((it) => ({ foodId: it.foodId, grams: it.grams })),
  ];
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

  const draft = ensureDraft(ctx.logDraft);
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
    const alreadySkipped = draft.skipped.includes(recipe?.id);
    const inDraft = isRecipeInDraft(draft, recipe?.id);
    const row = el(`<div class="plan-meal-row${alreadySkipped ? ' is-skipped' : ''}${inDraft ? ' is-in-draft' : ''}">
      <div>
        <div class="meal-slot">${slot}</div>
        <div class="meal-name-line">
          <button type="button" class="meal-open" data-open-recipe="${escapeHtml(recipe?.id || '')}" aria-haspopup="dialog">${recipe?.icon || ''} ${escapeHtml(recipe?.name || '')}</button>
          ${inDraft ? '<span class="badge-in-draft">In this meal</span>' : ''}
        </div>
        ${alreadySkipped ? '<div class="muted tiny">Marked as skipped</div>' : ''}
      </div>
      <div class="meal-actions">
        <button type="button" class="btn-secondary btn-small" data-add-recipe="${recipe?.id}" ${alreadySkipped || inDraft ? 'disabled' : ''}>Add as eaten</button>
        <button type="button" class="btn-secondary btn-small" data-replace-recipe="${recipe?.id}" ${alreadySkipped || inDraft ? 'disabled' : ''}>Replace</button>
        <button type="button" class="btn-secondary btn-small" data-skip-recipe="${recipe?.id}" ${alreadySkipped ? 'disabled' : ''}>Skipped</button>
      </div>
    </div>`);
    planBody.appendChild(row);
  }

  // The meal name opens its detail panel without leaving the Log screen.
  planBody.querySelectorAll('[data-open-recipe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const recipe = recipesById.get(btn.dataset.openRecipe);
      if (recipe) openRecipeDetail(ctx, recipe, root);
    });
  });

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

  const foodName = (foodId) => {
    const food = foods.find((f) => f.id === foodId);
    return food?.name || foodId;
  };

  const paintItems = () => {
    const ul = root.querySelector('[data-items]');
    const empty = root.querySelector('[data-empty]');
    const saveBtn = root.querySelector('[data-save]');
    ul.innerHTML = '';

    // Planned meals added as eaten stay together as one block with one remove control.
    for (const group of draft.groups) {
      const li = el(`<li class="logged-group" data-group="${escapeHtml(group.id)}">
        <div class="logged-group-header">
          <button type="button" class="meal-open logged-group-title" data-open-group-recipe="${escapeHtml(group.recipeId || '')}" aria-haspopup="dialog">
            Eaten · <span class="group-slot">${escapeHtml(group.slot)}</span> · ${escapeHtml(group.recipeName)}
          </button>
          <button type="button" class="btn-icon" data-remove-group="${escapeHtml(group.id)}" aria-label="Remove this whole meal">×</button>
        </div>
        <ul class="logged-group-items"></ul>
      </li>`);
      const groupList = li.querySelector('.logged-group-items');
      group.items.forEach((it, index) => {
        const name = foodName(it.foodId);
        const item = el(`<li class="logged-item logged-group-item">
          <span>${escapeHtml(name)}</span>
          <input type="number" min="1" max="5000" step="1" value="${it.grams}"
            data-group-edit="${escapeHtml(group.id)}" data-group-index="${index}"
            aria-label="${escapeHtml(name)} grams">
          <span class="muted">g</span>
          <button type="button" class="btn-icon" data-group-del="${escapeHtml(group.id)}" data-group-index="${index}"
            aria-label="Remove ${escapeHtml(name)}">×</button>
        </li>`);
        groupList.appendChild(item);
      });
      ul.appendChild(li);
    }

    // Foods from free search stay as flat rows.
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

    draft.skipped.forEach((recipeId) => {
      const recipe = recipesById.get(recipeId);
      const li = el(`<li class="logged-item is-skipped">
        <span>Skipped · ${escapeHtml(recipe?.name || recipeId)}</span>
        <button type="button" class="btn-icon" data-unskip="${escapeHtml(recipeId)}" aria-label="Remove skip">×</button>
      </li>`);
      ul.appendChild(li);
    });

    const hasAnything = draft.items.length > 0 || draft.groups.length > 0 || draft.skipped.length > 0;
    empty.style.display = hasAnything ? 'none' : 'block';
    saveBtn.disabled = !hasAnything;

    // The "Eaten · …" header opens the detail panel of that group's recipe.
    ul.querySelectorAll('[data-open-group-recipe]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const recipe = recipesById.get(btn.dataset.openGroupRecipe);
        if (recipe) openRecipeDetail(ctx, recipe, root);
      });
    });

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
    ul.querySelectorAll('[data-group-edit]').forEach((input) => {
      input.addEventListener('change', () => {
        const group = draft.groups.find((g) => g.id === input.dataset.groupEdit);
        const index = Number(input.dataset.groupIndex);
        if (!group || !group.items[index]) return;
        const grams = parsePortion(input.value);
        if (grams === null) {
          input.value = group.items[index].grams;
          return;
        }
        group.items[index].grams = grams;
        paintItems();
      });
    });
    ul.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.items.splice(Number(btn.dataset.del), 1);
        paintItems();
      });
    });
    ul.querySelectorAll('[data-group-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const groupId = btn.dataset.groupDel;
        removeGroupItem(draft, groupId, Number(btn.dataset.groupIndex));
        // A block that lost its last ingredient is gone: clear the plan row state too.
        if (draft.groups.some((g) => g.id === groupId)) paintItems();
        else ctx.refresh();
      });
    });
    ul.querySelectorAll('[data-remove-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        removeDraftGroup(draft, btn.dataset.removeGroup);
        ctx.refresh();
      });
    });
    ul.querySelectorAll('[data-unskip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.skipped = draft.skipped.filter((id) => id !== btn.dataset.unskip);
        ctx.refresh();
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
      addRecipeGroup(draft, recipe);
      // The plan row must show "In this meal" right away.
      ctx.refresh();
    });
  });

  root.querySelectorAll('[data-skip-recipe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.skipRecipe;
      if (!id || draft.skipped.includes(id)) return;
      draft.skipped.push(id);
      ctx.refresh();
    });
  });

  // Replace a planned meal with another recipe for the same slot: log it right away
  // and open the updated plan preview. The replaced meal is eaten, never skipped.
  const closeReplacePickers = () => {
    planBody.querySelectorAll('[data-replace-picker]').forEach((p) => p.remove());
  };
  const replaceMeal = (slot, fromRecipeId, recipe) => {
    ctx.saveLogAndReplan({
      items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
      skipped: [...draft.skipped],
      replaced: [{ slot, recipeId: recipe.id, fromRecipeId }],
    });
  };
  const openReplacePicker = (row, slot, currentId) => {
    if (row.nextElementSibling?.hasAttribute('data-replace-picker')) {
      row.nextElementSibling.remove();
      return;
    }
    closeReplacePickers();
    const others = ctx.recipes.filter((r) => r.slot === slot && r.id !== currentId);
    const picker = el(`<div class="replace-picker" data-replace-picker>
      <p class="field-label">Replace ${slot} with another ${slot} recipe</p>
      <div class="replace-options"></div>
      <button type="button" class="btn-text" data-close-picker>Cancel</button>
    </div>`);
    const options = picker.querySelector('.replace-options');
    if (others.length === 0) {
      options.appendChild(el(`<p class="muted tiny">No other ${slot} recipes available.</p>`));
    }
    for (const other of others) {
      const b = el(`<button type="button" class="search-hit">${other.icon || ''} ${escapeHtml(other.name)}</button>`);
      b.addEventListener('click', () => replaceMeal(slot, currentId, other));
      options.appendChild(b);
    }
    picker.querySelector('[data-close-picker]').addEventListener('click', () => picker.remove());
    row.after(picker);
  };
  root.querySelectorAll('[data-replace-recipe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.plan-meal-row');
      if (!row) return;
      const slot = row.querySelector('.meal-slot')?.textContent?.trim().toLowerCase();
      if (!slot) return;
      openReplacePicker(row, slot, btn.dataset.replaceRecipe);
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
    ctx.saveLogAndReplan({
      items: flatDraftItems(draft),
      skipped: [...draft.skipped],
    });
  });
  root.querySelector('[data-back]').addEventListener('click', () => ctx.navigate('plan'));

  paintItems();
  return root;
}
