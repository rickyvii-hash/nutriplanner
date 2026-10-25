import { todayIso } from '../engine/planner.js';
import { activeSlots, slotLabel, slotRecipeKind } from '../engine/meal_prefs.js';
import { searchFoods } from '../engine/search.js';
import { el, escapeHtml, appendHtml } from './dom.js';
import { openRecipeDetail } from './recipe_detail.js';
import { findPlannedRecipeForEntry } from '../log_corrections.js';

// Saved meals can be corrected later from the Plan screen.
export {
  removeLogEntry,
  updateLogEntryItems,
  convertLogEntryToSkipped,
  convertSkippedEntryToEaten,
  findPlannedRecipeForEntry,
  applyLogCorrection,
} from '../log_corrections.js';

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

/** Remove a planned recipe from the skipped list. */
export function unskipRecipe(draft, recipeId) {
  if (!draft || !Array.isArray(draft.skipped)) return draft;
  draft.skipped = draft.skipped.filter((id) => id !== recipeId);
  return draft;
}

/**
 * Add a planned meal as one block. Its ingredients stay together so the block can be
 * removed in one tap; adding the same recipe twice never duplicates it.
 * A recipe cannot be eaten and skipped at the same time, so its skip is cleared.
 */
export function addRecipeGroup(draft, recipe) {
  if (!recipe) return null;
  const d = ensureDraft(draft);
  unskipRecipe(d, recipe.id);
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

/**
 * Mark a planned recipe as skipped. Eaten and skipped are mutually exclusive, so any
 * eaten block of the same recipe is removed.
 */
export function skipRecipeGroup(draft, recipeId) {
  if (!recipeId) return draft;
  const d = ensureDraft(draft);
  const group = draftGroupForRecipe(d, recipeId);
  if (group) removeDraftGroup(d, group.id);
  if (!d.skipped.includes(recipeId)) d.skipped.push(recipeId);
  return d;
}

/**
 * The skipped recipe ids to save: a recipe already eaten as a block is never also
 * skipped, so the log cannot count it as both.
 */
export function draftSkippedIds(draft) {
  const eaten = new Set((draft?.groups || []).map((g) => g.recipeId).filter(Boolean));
  return (Array.isArray(draft?.skipped) ? draft.skipped : []).filter((id) => id && !eaten.has(id));
}

/**
 * True when "This meal" already holds something: planned meals added as eaten,
 * free-search foods, or skipped meals.
 */
export function draftHasPending(draft) {
  const d = ensureDraft(draft);
  return d.items.length > 0 || d.groups.length > 0 || d.skipped.length > 0;
}

/**
 * Replace saves its own meal and nothing else, so it may only run on an empty
 * draft; otherwise the foods already in "This meal" would be dropped silently.
 */
export function canReplaceMeal(draft) {
  return !draftHasPending(draft);
}

export const REPLACE_BLOCKED_MESSAGE = 'Clear This meal first, or save it, before replacing another meal.';

/**
 * The save payload for the current draft. Free-search foods are extras: they are
 * logged with `extra: true` and never replace or skip a planned slot.
 */
export function draftSavePayload(draft) {
  const d = ensureDraft(draft);
  // Each planned meal keeps its own ingredients, so saving two meals can store
  // one log entry per slot instead of one flattened entry.
  const groups = d.groups.map((g) => ({
    recipeId: g.recipeId,
    slot: g.slot,
    items: g.items.map((it) => ({ foodId: it.foodId, grams: it.grams })),
  }));
  // Free-search foods are the extras: they are not tied to a planned slot.
  const extras = d.items.map((it) => ({ foodId: it.foodId, grams: it.grams }));
  return {
    items: flatDraftItems(d),
    groups,
    extras,
    skipped: draftSkippedIds(d),
    eaten: d.groups.map((g) => ({ recipeId: g.recipeId, slot: g.slot })),
    extra: d.items.length > 0,
  };
}

/**
 * The log entries a save appends. Every planned meal eaten gets its own entry,
 * so a correction on one slot never rewrites a sibling slot saved at the same
 * time. Skipped planned meals also get one entry each. Free-search foods are
 * extras: they are marked `extra: true` and never replace or skip a planned
 * slot; they join a single planned entry, or keep their own entry when several
 * planned meals are saved together. When the food came from a replacement, the
 * entry names the slot it stands for instead.
 */
export function logEntriesForSave(payload, when) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const skipped = Array.isArray(payload?.skipped) ? payload.skipped : [];
  const replaced = Array.isArray(payload?.replaced) ? payload.replaced : [];
  const eaten = Array.isArray(payload?.eaten) ? payload.eaten : [];
  const planned = (Array.isArray(payload?.groups) ? payload.groups : [])
    .filter((g) => g && Array.isArray(g.items))
    .map((g) => ({
      recipeId: g.recipeId || null,
      slot: g.slot || null,
      items: g.items.map((it) => ({ foodId: it.foodId, grams: it.grams })),
    }));
  const cleanItems = items.map((it) => ({ foodId: it.foodId, grams: it.grams }));
  // Extras are the free-search foods. Older payloads without `extras` keep the
  // old meaning: the flat items are extras only when no planned meal is eaten.
  const extras = Array.isArray(payload?.extras)
    ? payload.extras.map((it) => ({ foodId: it.foodId, grams: it.grams }))
    : (planned.length === 0 && eaten.length === 0 ? cleanItems : []);
  const extra = Boolean(payload?.extra) && replaced.length === 0;
  const entries = [];

  if (planned.length > 0) {
    // One entry per planned eaten slot, carrying only that slot's food.
    planned.forEach((group) => {
      // A single planned meal may share its entry with the extras, as before.
      const groupExtras = planned.length === 1 ? extras : [];
      entries.push({
        ...when,
        items: [...group.items, ...groupExtras],
        eaten: [{ recipeId: group.recipeId, slot: group.slot }],
        ...(extra && groupExtras.length > 0 ? { extra: true } : {}),
      });
    });
    if (planned.length > 1 && extras.length > 0) {
      entries.push({
        ...when,
        items: extras,
        ...(extra ? { extra: true } : {}),
      });
    }
  } else if (eaten.length > 0) {
    // Older payloads carry a flat food list with the eaten metadata. The foods
    // cannot be split by slot, so they stay with the first entry and are never
    // counted twice; every other eaten slot still gets its own entry.
    eaten.forEach((slotInfo, index) => {
      entries.push({
        ...when,
        items: index === 0 ? cleanItems : [],
        eaten: [{ recipeId: slotInfo?.recipeId || null, slot: slotInfo?.slot || null }],
        ...(index === 0 && extra ? { extra: true } : {}),
        ...(index === 0 && replaced.length ? { replaced: [...replaced] } : {}),
      });
    });
  } else if (items.length > 0) {
    entries.push({
      ...when,
      items: cleanItems,
      ...(extra ? { extra: true } : {}),
      ...(replaced.length ? { replaced: [...replaced] } : {}),
    });
  }

  // One skip entry per skipped planned meal: a later correction touches only that slot.
  for (const recipeId of new Set(skipped.filter(Boolean))) {
    entries.push({ ...when, skipped: [recipeId], items: [] });
  }
  return entries;
}

/**
 * The planned slot a recipe belongs to: the plan day first, then the recipe's own slot.
 * Returns null when the recipe cannot be placed in a slot.
 */
export function slotForRecipeId(recipeId, planDay, recipesById) {
  if (!recipeId) return null;
  if (planDay && typeof planDay === 'object') {
    for (const slot of Object.keys(planDay)) {
      if (planDay[slot] === recipeId) return slot;
    }
  }
  return recipesById?.get?.(recipeId)?.slot || null;
}

/**
 * The planned slots a saved log entry settles. Free-search extras settle no slot,
 * so they never block or overwrite a planned meal.
 */
export function entrySlots(entry, planDay, recipesById) {
  const slots = new Set();
  if (!entry || typeof entry !== 'object') return slots;
  for (const eaten of Array.isArray(entry.eaten) ? entry.eaten : []) {
    const slot = eaten?.slot || slotForRecipeId(eaten?.recipeId, planDay, recipesById);
    if (slot) slots.add(slot);
  }
  for (const replaced of Array.isArray(entry.replaced) ? entry.replaced : []) {
    if (replaced?.slot) slots.add(replaced.slot);
  }
  for (const recipeId of Array.isArray(entry.skipped) ? entry.skipped : []) {
    const slot = slotForRecipeId(recipeId, planDay, recipesById);
    if (slot) slots.add(slot);
  }
  if (slots.size === 0 && !entry.extra) {
    // Entries saved before the log recorded the slot are matched by their ingredients.
    const recipe = findPlannedRecipeForEntry(entry, planDay, recipesById);
    if (recipe?.slot) slots.add(recipe.slot);
  }
  return slots;
}

/**
 * The one saved outcome for each planned slot of `date`: eaten, skipped or replaced.
 * Reopening Log reads this, so a slot already saved is never logged a second time.
 * A later entry for the same slot wins over an earlier contradictory one.
 */
export function savedSlotOutcomes(log, date, planDay, recipesById) {
  const outcomes = new Map();
  const entries = Array.isArray(log) ? log : [];
  entries.forEach((entry, index) => {
    if (!entry || entry.date !== date) return;
    for (const recipeId of Array.isArray(entry.skipped) ? entry.skipped : []) {
      const slot = slotForRecipeId(recipeId, planDay, recipesById);
      if (slot) outcomes.set(slot, { kind: 'skipped', slot, recipeId, index, entry });
    }
    for (const eaten of Array.isArray(entry.eaten) ? entry.eaten : []) {
      const slot = eaten?.slot || slotForRecipeId(eaten?.recipeId, planDay, recipesById);
      if (slot) outcomes.set(slot, { kind: 'eaten', slot, recipeId: eaten?.recipeId || null, index, entry });
    }
    for (const replaced of Array.isArray(entry.replaced) ? entry.replaced : []) {
      if (!replaced?.slot) continue;
      outcomes.set(replaced.slot, {
        kind: 'replaced',
        slot: replaced.slot,
        recipeId: replaced.recipeId || null,
        fromRecipeId: replaced.fromRecipeId || null,
        index,
        entry,
      });
    }
    const settlesNothing = !Array.isArray(entry.eaten)
      && !Array.isArray(entry.replaced)
      && (!Array.isArray(entry.skipped) || entry.skipped.length === 0);
    if (settlesNothing && !entry.extra) {
      const recipe = findPlannedRecipeForEntry(entry, planDay, recipesById);
      if (recipe?.slot) {
        outcomes.set(recipe.slot, { kind: 'eaten', slot: recipe.slot, recipeId: recipe.id, index, entry });
      }
    }
  });
  return outcomes;
}

/** "eaten" → "Eaten", for the saved-state badge on a plan row. */
export function savedOutcomeLabel(kind) {
  if (kind === 'skipped') return 'Skipped';
  if (kind === 'replaced') return 'Replaced';
  if (kind === 'eaten') return 'Eaten';
  return '';
}

/**
 * Merge a save into the log so each date/slot keeps exactly one outcome: an earlier
 * entry that settles a slot the new save also settles is replaced, not duplicated.
 * Entries for other days and free-search extras are kept as they are.
 */
export function mergeLogEntries(log, entries, { date, planDay, recipesById } = {}) {
  const current = Array.isArray(log) ? log : [];
  const added = (Array.isArray(entries) ? entries : []).filter(Boolean);
  if (added.length === 0) return current;

  const settledByDate = new Map();
  for (const entry of added) {
    const day = entry.date || date;
    if (!day) continue;
    const slots = entrySlots(entry, planDay, recipesById);
    if (slots.size === 0) continue;
    if (!settledByDate.has(day)) settledByDate.set(day, new Set());
    for (const slot of slots) settledByDate.get(day).add(slot);
  }

  const kept = current.filter((entry) => {
    const settled = settledByDate.get(entry?.date);
    if (!settled) return true;
    for (const slot of entrySlots(entry, planDay, recipesById)) {
      if (settled.has(slot)) return false;
    }
    return true;
  });
  return [...kept, ...added];
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
      <button type="button" class="mode-tab" data-mode="search">Extra / outside meals</button>
    </div>
    <div class="mode-body" data-body="plan"></div>
    <div class="mode-body hidden" data-body="search"></div>
  </section>`);

  const planBody = mode.querySelector('[data-body="plan"]');
  // This mode always lists today, not the day selected on the Plan screen: say which date it is.
  const planDate = state.plan.days[today] ? today : Object.keys(state.plan.days).sort()[0];
  const todayMeals = state.plan.days[planDate];
  // A slot already saved keeps that one outcome: opening Log again shows it instead
  // of offering to log the same meal a second time.
  const savedOutcomes = savedSlotOutcomes(state.log, planDate, todayMeals, recipesById);
  planBody.appendChild(el(`<p class="field-label" data-plan-date>Today's planned meals (${planDate})</p>`));
  // Only the meals that are on are offered; a slot that is switched off has no row.
  for (const slot of activeSlots(state.mealPrefs)) {
    const recipe = recipesById.get(todayMeals?.[slot]);
    if (!recipe) continue;
    const saved = savedOutcomes.get(slot) || null;
    const savedKind = saved?.kind || null;
    const alreadySkipped = savedKind
      ? savedKind === 'skipped'
      : draft.skipped.includes(recipe?.id);
    const inDraft = isRecipeInDraft(draft, recipe?.id);
    // A saved slot is locked: changes go through the correction path on Plan.
    const locked = Boolean(savedKind) || alreadySkipped || inDraft;
    const row = el(`<div class="plan-meal-row${alreadySkipped ? ' is-skipped' : ''}${inDraft ? ' is-in-draft' : ''}${savedKind ? ' is-logged' : ''}" data-slot="${escapeHtml(slot)}">
      <div>
        <div class="meal-slot">${escapeHtml(slotLabel(slot))}</div>
        <div class="meal-name-line">
          <button type="button" class="meal-open" data-open-recipe="${escapeHtml(recipe?.id || '')}" aria-haspopup="dialog">${recipe?.icon || ''} ${escapeHtml(recipe?.name || '')}</button>
          ${inDraft ? '<span class="badge-in-draft">In this meal</span>' : ''}
          ${savedKind ? `<span class="badge-logged">Logged · ${escapeHtml(savedOutcomeLabel(savedKind))}</span>` : ''}
        </div>
        ${savedKind ? `<div class="muted tiny" data-saved-slot="${escapeHtml(slot)}">Already logged as ${escapeHtml(savedOutcomeLabel(savedKind).toLowerCase())}. Use Change it to correct this meal.</div>` : ''}
        ${!savedKind && alreadySkipped ? '<div class="muted tiny">Marked as skipped</div>' : ''}
      </div>
      <div class="meal-actions">
        <button type="button" class="btn-secondary btn-small" data-add-recipe="${recipe?.id}" ${locked ? 'disabled' : ''}>Add as eaten</button>
        <button type="button" class="btn-secondary btn-small" data-replace-recipe="${recipe?.id}" ${locked ? 'disabled' : ''}>Replace</button>
        <button type="button" class="btn-secondary btn-small" data-skip-recipe="${recipe?.id}" ${locked ? 'disabled' : ''}>Skipped</button>
        ${savedKind ? `<button type="button" class="btn-text btn-small" data-change-saved="${escapeHtml(slot)}">Change it</button>` : ''}
      </div>
    </div>`);
    planBody.appendChild(row);
  }

  // Correcting a saved slot happens on Plan, where its Logged meals card edits the entry.
  planBody.querySelectorAll('[data-change-saved]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.selectedDate = planDate;
      ctx.navigate('plan');
    });
  });

  // The meal name opens its detail panel without leaving the Log screen.
  planBody.querySelectorAll('[data-open-recipe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const recipe = recipesById.get(btn.dataset.openRecipe);
      if (recipe) openRecipeDetail(ctx, recipe, root);
    });
  });

  const searchBody = mode.querySelector('[data-body="search"]');
  appendHtml(searchBody, `<p class="muted tiny" data-extra-help>
    Snack, drink or a restaurant meal — not tied to a planned slot.
  </p>
  <label class="field">
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
        unskipRecipe(draft, btn.dataset.unskip);
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
      if (!id) return;
      // Skipping drops any eaten block of the same recipe: the two choices are exclusive.
      skipRecipeGroup(draft, id);
      ctx.refresh();
    });
  });

  // Replace a planned meal with another recipe for the same slot: log it right away
  // and open the updated plan preview. The replaced meal is eaten, never skipped.
  const closeReplacePickers = () => {
    planBody.querySelectorAll('[data-replace-picker]').forEach((p) => p.remove());
    planBody.querySelectorAll('[data-replace-blocked]').forEach((p) => p.remove());
  };
  // Replace must never throw away what is already in "This meal": say so under the row.
  const showReplaceBlocked = (row) => {
    closeReplacePickers();
    row.after(el(`<p class="field-error replace-blocked" data-replace-blocked>${REPLACE_BLOCKED_MESSAGE}</p>`));
  };
  const replaceMeal = (slot, fromRecipeId, recipe) => {
    if (draftHasPending(draft)) {
      const row = planBody.querySelector(`[data-replace-recipe="${fromRecipeId}"]`)?.closest('.plan-meal-row');
      if (row) showReplaceBlocked(row);
      return;
    }
    ctx.saveLogAndReplan({
      items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
      skipped: draftSkippedIds(draft),
      replaced: [{ slot, recipeId: recipe.id, fromRecipeId }],
    });
  };
  const openReplacePicker = (row, slot, currentId) => {
    if (row.nextElementSibling?.hasAttribute('data-replace-picker')) {
      row.nextElementSibling.remove();
      return;
    }
    closeReplacePickers();
    const slotText = escapeHtml(slotLabel(slot));
    const others = ctx.recipes.filter((r) => r.slot === slotRecipeKind(slot) && r.id !== currentId);
    const picker = el(`<div class="replace-picker" data-replace-picker>
      <p class="field-label">Replace ${slotText} with another ${slotText} recipe</p>
      <div class="replace-options"></div>
      <button type="button" class="btn-secondary" data-ate-elsewhere>I ate something else</button>
      <div class="replace-custom hidden" data-replace-custom>
        <p class="field-label">Search the food you ate instead</p>
        <label class="field">
          <span>Search a food</span>
          <input type="search" placeholder="e.g. pizza, ice cream" data-replace-search>
        </label>
        <div class="search-results" data-replace-results></div>
        <label class="field">
          <span>Portion (grams)</span>
          <input type="number" min="1" max="5000" step="1" placeholder="e.g. 150" value="100" data-replace-portion>
        </label>
        <p class="field-error" data-replace-portion-error hidden>Enter a portion between 1 and 5000 g</p>
        <button type="button" class="btn-secondary" data-replace-add disabled>Add food</button>
        <ul class="logged-items" data-replace-items></ul>
        <p class="muted tiny" data-replace-empty>Nothing added yet.</p>
        <p class="field-error" data-replace-blocked-custom hidden>${REPLACE_BLOCKED_MESSAGE}</p>
        <button type="button" class="btn-primary" data-replace-save disabled>Replace with these foods</button>
      </div>
      <button type="button" class="btn-text" data-close-picker>Cancel</button>
    </div>`);
    const options = picker.querySelector('.replace-options');
    if (others.length === 0) {
      options.appendChild(el(`<p class="muted tiny">No other ${slotText} recipes available.</p>`));
    }
    for (const other of others) {
      const b = el(`<button type="button" class="search-hit">${other.icon || ''} ${escapeHtml(other.name)}</button>`);
      b.addEventListener('click', () => replaceMeal(slot, currentId, other));
      options.appendChild(b);
    }

    // Second Replace path: the person ate free-search foods instead of the planned meal.
    // They build the meal here, then it is logged as a replacement of this slot.
    const customBox = picker.querySelector('[data-replace-custom]');
    picker.querySelector('[data-ate-elsewhere]').addEventListener('click', () => {
      customBox.classList.toggle('hidden');
    });
    const customItems = [];
    let customSelectedId = null;
    const customSearch = picker.querySelector('[data-replace-search]');
    const customResults = picker.querySelector('[data-replace-results]');
    const customPortion = picker.querySelector('[data-replace-portion]');
    const customPortionError = picker.querySelector('[data-replace-portion-error]');
    const customAdd = picker.querySelector('[data-replace-add]');
    const customList = picker.querySelector('[data-replace-items]');
    const customEmpty = picker.querySelector('[data-replace-empty]');
    const customBlocked = picker.querySelector('[data-replace-blocked-custom]');
    const customSave = picker.querySelector('[data-replace-save]');

    const paintCustom = () => {
      customList.innerHTML = '';
      customItems.forEach((it, index) => {
        const name = foodName(it.foodId);
        const li = el(`<li class="logged-item">
          <span>${escapeHtml(name)}</span>
          <input type="number" min="1" max="5000" step="1" value="${it.grams}"
            data-custom-edit="${index}" aria-label="${escapeHtml(name)} grams">
          <span class="muted">g</span>
          <button type="button" class="btn-icon" data-custom-del="${index}"
            aria-label="Remove ${escapeHtml(name)}">×</button>
        </li>`);
        customList.appendChild(li);
      });
      customEmpty.classList.toggle('hidden', customItems.length > 0);
      customSave.disabled = customItems.length === 0;
      customList.querySelectorAll('[data-custom-edit]').forEach((input) => {
        input.addEventListener('change', () => {
          const index = Number(input.dataset.customEdit);
          const grams = parsePortion(input.value);
          if (grams === null) {
            input.value = customItems[index].grams;
            return;
          }
          customItems[index].grams = grams;
          customBlocked.classList.add('hidden');
        });
      });
      customList.querySelectorAll('[data-custom-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          customItems.splice(Number(btn.dataset.customDel), 1);
          paintCustom();
        });
      });
    };

    const runCustomSearch = () => {
      const q = customSearch.value || '';
      customResults.innerHTML = '';
      customSelectedId = null;
      customAdd.disabled = true;
      if (!q.trim()) return;
      for (const f of searchFoods(foods, q, { limit: 12 })) {
        const b = el(`<button type="button" class="search-hit">${escapeHtml(f.name)}</button>`);
        b.addEventListener('click', () => {
          customSelectedId = f.id;
          customResults.querySelectorAll('.search-hit').forEach((x) => x.classList.remove('is-selected'));
          b.classList.add('is-selected');
          customAdd.disabled = false;
        });
        customResults.appendChild(b);
      }
    };
    customSearch.addEventListener('input', runCustomSearch);
    customPortion.addEventListener('input', () => customPortionError.classList.add('hidden'));
    customAdd.addEventListener('click', () => {
      if (!customSelectedId) return;
      const grams = parsePortion(customPortion.value);
      if (grams === null) {
        customPortionError.classList.remove('hidden');
        customPortion.focus();
        return;
      }
      customPortionError.classList.add('hidden');
      customItems.push({ foodId: customSelectedId, grams });
      paintCustom();
    });
    customSave.addEventListener('click', () => {
      if (customItems.length === 0) return;
      // Same rule as a recipe Replace: never drop what is already in "This meal".
      if (draftHasPending(draft)) {
        customBlocked.classList.remove('hidden');
        return;
      }
      const names = customItems.map((it) => foodName(it.foodId));
      const name = names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
      ctx.saveLogAndReplan({
        items: customItems.map((it) => ({ foodId: it.foodId, grams: it.grams })),
        skipped: draftSkippedIds(draft),
        replaced: [{ slot, fromRecipeId: currentId, recipeId: null, name }],
      });
    });
    paintCustom();

    picker.querySelector('[data-close-picker]').addEventListener('click', () => picker.remove());
    row.after(picker);
  };
  root.querySelectorAll('[data-replace-recipe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.plan-meal-row');
      if (!row) return;
      // The slot is the stored key (a second snack is "snack2"), not the shown label.
      const slot = row.dataset.slot
        || row.querySelector('.meal-slot')?.textContent?.trim().toLowerCase();
      if (!slot) return;
      // Nothing is replaced while "This meal" holds something: no picker, just the notice.
      if (draftHasPending(draft)) {
        showReplaceBlocked(row);
        return;
      }
      openReplacePicker(row, slot, btn.dataset.replaceRecipe);
    });
  });

  const resultsEl = root.querySelector('[data-results]');
  const searchInput = root.querySelector('[data-search]');
  const addSearchBtn = root.querySelector('[data-add-search]');

  const runSearch = () => {
    const q = searchInput.value || '';
    resultsEl.innerHTML = '';
    selectedFoodId = null;
    addSearchBtn.disabled = true;
    if (!q.trim()) return;
    const hits = searchFoods(foods, q, { limit: 12 });
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
    // Free-search foods are saved as extras; planned meals added as eaten stay
    // recorded too, and skipped meals go in their own entry.
    ctx.saveLogAndReplan(draftSavePayload(draft));
  });
  root.querySelector('[data-back]').addEventListener('click', () => ctx.navigate('plan'));

  paintItems();
  return root;
}
