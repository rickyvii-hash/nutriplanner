import { searchFoods, words } from '../engine/search.js';
import { DRINK_PRESETS, mlToGrams, listDrinkFoods } from '../engine/drinks.js';
import { displayFoodName } from '../engine/food_display.js';
import { el, escapeHtml } from './dom.js';
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

/** The note shown under a drink portion, because drink data is per 100 g. */
export const DRINK_ML_NOTE = 'ml converted at about 1 g per ml';

/** How many drinks the Drinks shortcut lists before the search field takes over. */
const DRINK_LIST_LIMIT = 12;

/** Everyday drink words, shown first so the short list covers the usual choices. */
const DRINK_FIRST = ['water', 'coffee', 'tea', 'milk', 'juice', 'cola', 'soda', 'beer', 'wine'];

/** A short drink list: one everyday drink per word first, then the remaining drinks by name. */
function drinkPreview(foods, limit) {
  const all = listDrinkFoods(foods).filter((f) => displayFoodName(f));
  const picked = [];
  const seen = new Set();
  for (const word of DRINK_FIRST) {
    // Pick on the same brand-free label the button shows, so a trademark in the
    // USDA source string cannot bias the choice.
    const match = all.find((f) => !seen.has(f.id)
      && displayFoodName(f).toLowerCase().startsWith(word))
      || all.find((f) => !seen.has(f.id) && words(displayFoodName(f)).includes(word));
    if (!match) continue;
    picked.push(match);
    seen.add(match.id);
  }
  for (const food of all) {
    if (picked.length >= limit) break;
    if (seen.has(food.id)) continue;
    picked.push(food);
    seen.add(food.id);
  }
  return picked.slice(0, limit);
}

/** True when the food already carries a drink measure, so no conversion note is needed. */
function hasOwnMeasure(food) {
  return Boolean(food && (food.measureMl || food.servingMl || food.portionMl));
}

/**
 * The Drinks shortcut of a free search: a short list of drinks, the millilitre
 * presets and a free ml field. Choosing a drink reports the food and its grams,
 * so the caller fills the same fields a searched food would fill.
 */
export function createDrinkPicker(foods, onChoose) {
  const panel = el(`<div class="drink-picker hidden" data-drink-picker>
    <p class="field-label">Drinks</p>
    <div class="drink-options" data-drink-options></div>
    <p class="field-label">Portion</p>
    <div class="drink-presets">
      <button type="button" class="btn-secondary btn-small" data-drink-preset="${DRINK_PRESETS.glass}">Glass 200 ml</button>
      <button type="button" class="btn-secondary btn-small" data-drink-preset="${DRINK_PRESETS.cup}">Cup 240 ml</button>
      <button type="button" class="btn-secondary btn-small" data-drink-preset="${DRINK_PRESETS.can}">Can 330 ml</button>
      <button type="button" class="btn-secondary btn-small" data-drink-preset="${DRINK_PRESETS.smallBottle}">Small bottle 500 ml</button>
    </div>
    <label class="field">
      <span>Amount (ml)</span>
      <input type="number" min="1" max="5000" step="1" placeholder="e.g. 330" data-drink-ml>
    </label>
    <p class="muted tiny" data-drink-note hidden>${DRINK_ML_NOTE}</p>
  </div>`);

  const options = panel.querySelector('[data-drink-options]');
  const mlInput = panel.querySelector('[data-drink-ml]');
  const note = panel.querySelector('[data-drink-note]');
  const drinks = drinkPreview(foods, DRINK_LIST_LIMIT);
  let selected = null;
  let ml = DRINK_PRESETS.glass;

  if (drinks.length === 0) {
    options.appendChild(el('<p class="muted tiny">No drinks in the food list.</p>'));
  }
  // The note appears on a pick, unless that food already states its own measure.
  const syncNote = () => {
    note.hidden = !selected || hasOwnMeasure(selected);
  };
  const choose = (food) => {
    selected = food;
    mlInput.value = ml;
    syncNote();
    onChoose(food, mlToGrams(ml));
  };

  for (const food of drinks) {
    const btn = el(`<button type="button" class="search-hit" data-drink="${escapeHtml(food.id)}">${escapeHtml(displayFoodName(food))}</button>`);
    btn.addEventListener('click', () => {
      options.querySelectorAll('.search-hit').forEach((x) => x.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      choose(food);
    });
    options.appendChild(btn);
  }
  for (const btn of panel.querySelectorAll('[data-drink-preset]')) {
    btn.addEventListener('click', () => {
      ml = Number(btn.dataset.drinkPreset);
      mlInput.value = ml;
      if (selected) choose(selected);
    });
  }
  mlInput.addEventListener('input', () => {
    const value = Number(mlInput.value);
    if (!Number.isFinite(value) || value <= 0) return;
    ml = value;
    if (selected) choose(selected);
  });

  return {
    element: panel,
    toggle() {
      panel.classList.toggle('hidden');
    },
  };
}

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

/**
 * The planned slot and recipe together are the identity of a meal: with two snacks
 * the same snack recipe can fill both `snack` and `snack2`, so the recipe id alone
 * is not enough to keep them apart.
 */
function slotKey(slot, recipeId) {
  return `${slot || ''}|${recipeId || ''}`;
}

/** The recipe id of one entry of `draft.skipped` (a plain id or { recipeId, slot }). */
export function skippedEntryRecipeId(entry) {
  if (typeof entry === 'string') return entry || null;
  return (entry && typeof entry === 'object' && entry.recipeId) || null;
}

/** The planned slot of one entry of `draft.skipped`, or null when it is not known. */
export function skippedEntrySlot(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return entry.slot || null;
}

/** True when the recipe is already in `draft.skipped`; with a slot, only for that slot. */
export function isRecipeSkipped(draft, recipeId, slot = null) {
  if (!recipeId) return false;
  return (Array.isArray(draft?.skipped) ? draft.skipped : []).some((entry) => (
    skippedEntryRecipeId(entry) === recipeId
    && (!slot || skippedEntrySlot(entry) === slot)
  ));
}

/** The eaten block for a planned recipe, or null when it was not added. */
export function draftGroupForRecipe(draft, recipeId, slot = null) {
  if (!recipeId || !Array.isArray(draft?.groups)) return null;
  return draft.groups.find((g) => g.recipeId === recipeId && (!slot || g.slot === slot)) || null;
}

/** True while the planned recipe is already added as an eaten block in the draft. */
export function isRecipeInDraft(draft, recipeId, slot = null) {
  return Boolean(draftGroupForRecipe(draft, recipeId, slot));
}

/** Remove a planned recipe from the skipped list; with a slot, only that slot's skip. */
export function unskipRecipe(draft, recipeId, slot = null) {
  if (!draft || !Array.isArray(draft.skipped)) return draft;
  draft.skipped = draft.skipped.filter((entry) => {
    if (skippedEntryRecipeId(entry) !== recipeId) return true;
    return slot ? skippedEntrySlot(entry) !== slot : false;
  });
  return draft;
}

/**
 * Add a planned meal as one block. Its ingredients stay together so the block can be
 * removed in one tap; adding the same meal twice never duplicates it.
 * `slot` is the planned slot (a second snack is `snack2`); without it the recipe's
 * own slot is used. A meal cannot be eaten and skipped at the same time, so its
 * skip is cleared — only for that slot.
 */
export function addRecipeGroup(draft, recipe, slot = null) {
  if (!recipe) return null;
  const d = ensureDraft(draft);
  const plannedSlot = slot || recipe.slot || null;
  unskipRecipe(d, recipe.id, slot ? plannedSlot : null);
  const existing = draftGroupForRecipe(d, recipe.id, slot ? plannedSlot : null);
  if (existing) return existing;
  const group = {
    id: `eaten-${plannedSlot}-${recipe.id}`,
    kind: 'eaten',
    slot: plannedSlot,
    recipeId: recipe.id,
    recipeName: recipe.name,
    items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
  };
  d.groups.push(group);
  return group;
}

/**
 * Mark a planned meal as skipped. Eaten and skipped are mutually exclusive, so any
 * eaten block of the same meal is removed. With a slot, only that slot is touched:
 * two snacks sharing one recipe stay independent.
 */
export function skipRecipeGroup(draft, recipeId, slot = null) {
  if (!recipeId) return draft;
  const d = ensureDraft(draft);
  const group = draftGroupForRecipe(d, recipeId, slot);
  if (group) removeDraftGroup(d, group.id);
  if (!isRecipeSkipped(d, recipeId, slot)) d.skipped.push(slot ? { recipeId, slot } : recipeId);
  return d;
}

/**
 * The meals to save as skipped, as { recipeId, slot }: a meal already eaten as a
 * block is never also skipped, so the log cannot count it as both.
 */
export function draftSkipRecords(draft) {
  const groups = Array.isArray(draft?.groups) ? draft.groups : [];
  const records = [];
  const seen = new Set();
  for (const entry of Array.isArray(draft?.skipped) ? draft.skipped : []) {
    const recipeId = skippedEntryRecipeId(entry);
    if (!recipeId) continue;
    const slot = skippedEntrySlot(entry);
    // The same meal, in the same slot, cannot be eaten and skipped at once.
    const eaten = groups.some((g) => g.recipeId === recipeId && (!slot || g.slot === slot));
    if (eaten) continue;
    const key = slotKey(slot, recipeId);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ recipeId, slot });
  }
  return records;
}

/**
 * The skipped recipe ids to save: a recipe already eaten as a block is never also
 * skipped, so the log cannot count it as both.
 */
export function draftSkippedIds(draft) {
  return [...new Set(draftSkipRecords(draft).map((record) => record.recipeId))];
}

/**
 * True when the draft already holds something: planned meals added as eaten,
 * free-search foods, or skipped meals. The day screen builds drafts this way;
 * the outside-the-menu screen only adds free-search foods.
 */
export function draftHasPending(draft) {
  const d = ensureDraft(draft);
  return d.items.length > 0 || d.groups.length > 0 || d.skipped.length > 0;
}

/**
 * A Replace saves its own meal and nothing else, so it may only run on an empty
 * draft; otherwise the foods already added would be dropped silently.
 */
export function canReplaceMeal(draft) {
  return !draftHasPending(draft);
}

export const REPLACE_BLOCKED_MESSAGE = 'You have choices waiting in “This meal”. Tap Save, or Clear on the highlighted meal (or Clear all), then try Replace again.';

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
  // The slot is saved with each skip, so a skipped `snack2` is not read back as `snack`.
  const skipRecords = draftSkipRecords(d);
  return {
    items: flatDraftItems(d),
    groups,
    extras,
    skipped: skipRecords.map((record) => record.recipeId),
    skippedSlots: skipRecords,
    eaten: d.groups.map((g) => ({ recipeId: g.recipeId, slot: g.slot })),
    extra: d.items.length > 0,
  };
}

/**
 * The log entries a save appends. Every planned meal eaten gets its own entry,
 * so a correction on one slot never rewrites a sibling slot saved at the same
 * time. Skipped planned meals also get one entry each. Free-search foods are
 * extras: they are marked `extra: true` and never replace or skip a planned
 * slot, so they always get their own entry. Keeping them apart means a planned
 * meal stays labeled by its slot ("Eaten · breakfast") even when the same save
 * also holds food eaten outside the plan. When the food came from a replacement,
 * the entry names the slot it stands for instead.
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
      entries.push({
        ...when,
        items: group.items,
        eaten: [{ recipeId: group.recipeId, slot: group.slot }],
      });
    });
    // Food eaten outside the plan is its own entry: merging it into a planned
    // entry would drop the slot name the user needs to read on the Plan screen.
    if (extras.length > 0) {
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
  // The slot is recorded when the payload names it (a second snack is `snack2`),
  // because the recipe id alone cannot tell two snacks of the same recipe apart.
  const skipRecords = (Array.isArray(payload?.skippedSlots) ? payload.skippedSlots : [])
    .filter((record) => record && record.recipeId)
    .map((record) => ({ recipeId: record.recipeId, slot: record.slot || null }));
  for (const recipeId of new Set(skipped.filter(Boolean))) {
    if (skipRecords.some((record) => record.recipeId === recipeId)) continue;
    skipRecords.push({ recipeId, slot: null });
  }
  for (const record of skipRecords) {
    entries.push({
      ...when,
      skipped: [record.recipeId],
      items: [],
      ...(record.slot ? { skippedSlots: [{ recipeId: record.recipeId, slot: record.slot }] } : {}),
    });
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
 * The { recipeId, slot } pairs a saved skip entry names. Newer entries carry
 * `skippedSlots` because a recipe id alone cannot tell `snack` from `snack2`
 * when both snacks use the same snack recipe.
 */
export function entrySkipSlots(entry) {
  return (Array.isArray(entry?.skippedSlots) ? entry.skippedSlots : [])
    .filter((info) => info && info.recipeId && info.slot)
    .map((info) => ({ recipeId: info.recipeId, slot: info.slot }));
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
  // A skip saves the planned slot it stands for, so two snacks of the same recipe
  // never settle each other's slot; older entries name only the recipe.
  const skipSlots = entrySkipSlots(entry);
  for (const info of skipSlots) slots.add(info.slot);
  for (const recipeId of Array.isArray(entry.skipped) ? entry.skipped : []) {
    if (skipSlots.some((info) => info.recipeId === recipeId)) continue;
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
    // The recorded slot wins: the same snack recipe can fill both snack slots.
    const skipSlots = entrySkipSlots(entry);
    for (const info of skipSlots) {
      outcomes.set(info.slot, { kind: 'skipped', slot: info.slot, recipeId: info.recipeId, index, entry });
    }
    for (const recipeId of Array.isArray(entry.skipped) ? entry.skipped : []) {
      if (skipSlots.some((info) => info.recipeId === recipeId)) continue;
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

/**
 * Clear one planned meal's choice from the row it was made on: its eaten block, or
 * its skip, for that slot only. Every other meal in the draft is left as it is, so
 * two snacks that share a recipe stay independent.
 */
export function clearDraftChoice(draft, recipeId, slot = null) {
  if (!draft || !recipeId) return draft;
  const group = draftGroupForRecipe(draft, recipeId, slot);
  if (group) removeDraftGroup(draft, group.id);
  unskipRecipe(draft, recipeId, slot);
  return draft;
}

/** Empty the draft (planned meals, free-search foods and skips) without saving. */
export function clearDraft(draft) {
  const d = ensureDraft(draft);
  d.items = [];
  d.groups = [];
  d.skipped = [];
  return d;
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
  const { state, foods } = ctx;
  const root = el(`<div class="screen screen-log"></div>`);

  root.appendChild(el(`<header class="brand brand-compact">
    <button type="button" class="btn-text back" data-back>← Plan</button>
    <div><h1>Outside the menu</h1><p>Anything you ate or drank that was not one of your planned meals.</p></div>
  </header>`));

  if (!state.plan) {
    root.appendChild(el(`<section class="card empty-state">
      <p class="muted">Build a month plan first, then come back to add food outside the menu.</p>
      <button type="button" class="btn-primary" data-go="targets">Go to Targets</button>
    </section>`));
    root.querySelector('[data-go="targets"]').addEventListener('click', () => ctx.navigate('targets'));
    root.querySelector('[data-back]')?.addEventListener('click', () => ctx.navigate('plan'));
    root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));
    return root;
  }

  const draft = ensureDraft(ctx.logDraft);
  ctx.logDraft = draft;

  // The former Extra flow, shown directly: no tabs and no planned-meal rows here.
  const searchCard = el(`<section class="card">
    <p class="muted tiny" data-extra-help>
      Snack, drink or a restaurant meal — not tied to a planned slot.
    </p>
    <label class="field">
      <span>Search a food</span>
      <input type="search" placeholder="e.g. pizza, ice cream" data-search>
    </label>
    <button type="button" class="btn-secondary btn-small" data-drinks>Drinks</button>
    <div class="search-results" data-results></div>
    <label class="field">
      <span>Portion (grams)</span>
      <input type="number" min="1" max="5000" step="1" placeholder="e.g. 150" value="100" data-portion>
    </label>
    <p class="field-error" data-portion-error hidden>Enter a portion between 1 and 5000 g</p>
    <button type="button" class="btn-secondary" data-add-search disabled>Add food</button>
  </section>`);

  root.appendChild(searchCard);

  const loggedCard = el(`<section class="card">
    <div class="logged-card-header">
      <h3>To add</h3>
      <button type="button" class="btn-text btn-small" data-clear-all hidden>Clear all</button>
    </div>
    <ul class="logged-items" data-items></ul>
    <p class="muted tiny empty-hint" data-empty>Nothing added yet.</p>
    <button type="button" class="btn-primary" data-save disabled>Save and update plan</button>
  </section>`);
  root.appendChild(loggedCard);
  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  let selectedFoodId = null;

  const foodName = (foodId) => {
    const food = foods.find((f) => f.id === foodId);
    return displayFoodName(food) || food?.id || foodId;
  };

  const paintItems = () => {
    const ul = root.querySelector('[data-items]');
    const empty = root.querySelector('[data-empty]');
    const saveBtn = root.querySelector('[data-save]');
    ul.innerHTML = '';

    // Foods from free search stay as flat rows, each one removable on its own.
    draft.items.forEach((it, index) => {
      const li = el(`<li class="logged-item">
        <span>${escapeHtml(foodName(it.foodId))}</span>
        <input type="number" min="1" value="${it.grams}" data-edit="${index}">
        <span class="muted">g</span>
        <button type="button" class="btn-icon" data-del="${index}" aria-label="Remove">×</button>
      </li>`);
      ul.appendChild(li);
    });

    const hasAnything = draft.items.length > 0;
    empty.style.display = hasAnything ? 'none' : 'block';
    saveBtn.disabled = !hasAnything;
    // Clear all only exists while the draft holds something to clear.
    root.querySelector('[data-clear-all]').hidden = !hasAnything;

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

  // Clear all empties the draft straight away: it is only a draft, so nothing to confirm.
  root.querySelector('[data-clear-all]').addEventListener('click', () => {
    clearDraft(draft);
    ctx.refresh();
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
      const shown = displayFoodName(f);
      if (!shown) continue;
      const b = el(`<button type="button" class="search-hit">${escapeHtml(shown)}</button>`);
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

  // The Drinks shortcut fills the same selection and portion fields as a search hit.
  const drinkPicker = createDrinkPicker(foods, (food, grams) => {
    resultsEl.querySelectorAll('.search-hit').forEach((x) => x.classList.remove('is-selected'));
    selectedFoodId = food.id;
    portionInput.value = grams;
    portionError.hidden = true;
    addSearchBtn.disabled = false;
  });
  const drinksButton = searchCard.querySelector('[data-drinks]');
  drinksButton.after(drinkPicker.element);
  drinksButton.addEventListener('click', () => drinkPicker.toggle());

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
    // Free-search foods are saved as extras: they never replace or skip a planned meal.
    ctx.saveLogAndReplan(draftSavePayload(draft));
  });
  root.querySelector('[data-back]').addEventListener('click', () => ctx.navigate('plan'));

  paintItems();
  return root;
}
