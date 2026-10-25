// Correcting a meal that was already saved. Every helper returns a new state and
// never mutates the state passed in. A correction rebuilds the log array and
// drops any pending proposal, so the plan is recalculated from the corrected log.

import { replan, todayIso } from './engine/planner.js';
import { proposalToStore, saveState } from './store.js';

/** Valid grams for a corrected portion: a real number greater than 0. */
function validItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((it) => ({ foodId: it?.foodId, grams: Number(it?.grams) }))
    .filter((it) => it.foodId && Number.isFinite(it.grams) && it.grams > 0);
}

/** The saved entry at `index`, or null when the index is out of range. */
export function logEntryAt(state, index) {
  if (!state || !Array.isArray(state.log)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= state.log.length) return null;
  return state.log[index];
}

/** Remove a saved log entry entirely. The rest of the log is untouched. */
export function removeLogEntry(state, index) {
  if (!logEntryAt(state, index)) return state;
  const log = state.log.filter((_, i) => i !== index);
  return { ...state, log, pendingProposal: null };
}

/**
 * Replace the food items (and portions) of a saved eaten, extra or replaced entry.
 * An entry left without any valid food item is removed instead of saved empty.
 */
export function updateLogEntryItems(state, index, items) {
  const entry = logEntryAt(state, index);
  if (!entry) return state;
  const clean = validItems(items);
  if (clean.length === 0) return removeLogEntry(state, index);
  const nextEntry = { ...entry, items: clean };
  delete nextEntry.skipped;
  const log = state.log.slice();
  log[index] = nextEntry;
  return { ...state, log, pendingProposal: null };
}

/**
 * Change a saved Eaten entry into Skipped for the same planned meal.
 * When the entry holds more than one eaten slot, only that meal becomes
 * skipped: the other slots move into their own entries and keep their food.
 * `slot` names the planned slot (a second snack is `snack2`); without it the
 * recipe id decides, as before.
 */
export function convertLogEntryToSkipped(state, index, recipeId, slot = null) {
  const entry = logEntryAt(state, index);
  if (!entry || !recipeId) return state;
  const eaten = Array.isArray(entry.eaten) ? entry.eaten.filter(Boolean) : [];
  const isTarget = (slotInfo) => slotInfo.recipeId === recipeId && (!slot || slotInfo.slot === slot);
  const targetInEntry = eaten.some(isTarget);
  const siblings = eaten.filter((slotInfo) => !isTarget(slotInfo));
  const log = state.log.slice();
  const skippedEntry = {
    date: entry.date,
    time: entry.time,
    skipped: [recipeId],
    items: [],
    ...(slot ? { skippedSlots: [{ recipeId, slot }] } : {}),
  };
  log[index] = skippedEntry;
  if (!targetInEntry || siblings.length === 0) {
    // A single eaten slot (or an older entry with no slot metadata) becomes skipped whole.
    return { ...state, log, pendingProposal: null };
  }
  // The entry held several eaten slots: split the siblings out. Older flattened
  // entries hold a single food list, so their food stays with the first sibling
  // and is counted once; per-slot saves keep their own food.
  const siblingEntries = siblings.map((slotInfo, i) => ({
    date: entry.date,
    time: entry.time,
    items: i === 0
      ? (entry.items || []).map((it) => ({ foodId: it.foodId, grams: it.grams }))
      : [],
    eaten: [{ recipeId: slotInfo.recipeId || null, slot: slotInfo.slot || null }],
  }));
  log.splice(index + 1, 0, ...siblingEntries);
  return { ...state, log, pendingProposal: null };
}

/**
 * Change a saved Skipped entry into Eaten: the planned meal's ingredients are
 * logged again with the recipe's own portions. When the entry skipped several
 * planned meals, only this one turns eaten; the others stay skipped.
 * `slot` keeps a second snack apart from the first when both share a recipe.
 */
export function convertSkippedEntryToEaten(state, index, recipe, slot = null) {
  const entry = logEntryAt(state, index);
  if (!entry || !recipe || !Array.isArray(recipe.ingredients)) return state;
  const recorded = (Array.isArray(entry.skippedSlots) ? entry.skippedSlots : [])
    .filter((info) => info && info.recipeId);
  const targetSlot = slot || recorded.find((info) => info.recipeId === recipe.id)?.slot || null;
  const targetInfo = targetSlot
    ? recorded.find((info) => info.recipeId === recipe.id && info.slot === targetSlot)
    : null;
  const remainingSlots = recorded.filter((info) => info !== targetInfo);
  let removed = false;
  const remaining = (Array.isArray(entry.skipped) ? entry.skipped : [])
    .filter((id) => {
      if (!id || id !== recipe.id) return Boolean(id);
      // Without a recorded slot the old rule applies: every entry for that recipe goes.
      if (!targetSlot) return false;
      // With a slot, only that one skip turns eaten: the sibling snack stays skipped.
      if (removed) return true;
      removed = true;
      return false;
    });
  const eatenEntry = {
    date: entry.date,
    time: entry.time,
    items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
    eaten: [{ recipeId: recipe.id, slot: targetSlot || recipe.slot || null }],
  };
  const log = state.log.slice();
  const keptSkip = {
    date: entry.date,
    time: entry.time,
    skipped: remaining,
    items: [],
    ...(remainingSlots.length > 0 ? { skippedSlots: remainingSlots } : {}),
  };
  if (remaining.length === 0) {
    log[index] = eatenEntry;
    return { ...state, log, pendingProposal: null };
  }
  // The entry skipped several meals: it keeps the other skips, the eaten meal
  // gets its own entry.
  log[index] = keptSkip;
  log.splice(index + 1, 0, eatenEntry);
  return { ...state, log, pendingProposal: null };
}

/** True when two item lists hold the same foods, whatever their order or portions. */
function sameFoods(items, ingredients) {
  if (!Array.isArray(items) || !Array.isArray(ingredients)) return false;
  if (items.length !== ingredients.length) return false;
  const wanted = ingredients.map((i) => i.foodId).sort();
  const got = items.map((i) => i.foodId).sort();
  return wanted.every((id, i) => id === got[i]);
}

/**
 * The planned recipe a saved entry stands for, or null when it cannot be known.
 * It reads the recipe recorded when a planned meal was added as eaten, then a
 * replacement, then falls back to matching the ingredients of that day's plan.
 */
export function findPlannedRecipeForEntry(entry, planDay, recipesById) {
  if (!entry || !recipesById) return null;
  if (Array.isArray(entry.eaten) && entry.eaten.length > 0) {
    const recipe = recipesById.get(entry.eaten[0].recipeId);
    if (recipe) return recipe;
  }
  if (Array.isArray(entry.replaced) && entry.replaced.length > 0) {
    const recipe = recipesById.get(entry.replaced[0].recipeId);
    if (recipe) return recipe;
  }
  const items = entry.items || [];
  if (!planDay || items.length === 0) return null;
  for (const slot of Object.keys(planDay)) {
    const recipe = recipesById.get(planDay[slot]);
    if (recipe && sameFoods(items, recipe.ingredients)) return recipe;
  }
  return null;
}

/** The date a correction should replan from: the entry's date, or today. */
export function correctionFromDate(state, entry) {
  if (entry?.date) return entry.date;
  const dates = (state?.log || []).map((e) => e.date).filter(Boolean).sort();
  return dates.length > 0 ? dates[dates.length - 1] : todayIso();
}

/**
 * Save a corrected state and recalculate the plan from the corrected log.
 * Opens Plan updated when the plan would change; otherwise keeps the corrected
 * log and goes back to the Plan with a calm note. `ctx` provides recipes,
 * foodsById, navigate and the in-memory state.
 *
 * A correction on a past day never rewrites days that are already over: the
 * replan starts today. The corrected day is still passed as the first logged
 * day, so every later entry counts in the totals the replan uses.
 */
export function applyLogCorrection(ctx, correctedState, { fromDate } = {}) {
  const state = correctedState || ctx?.state;
  if (!ctx || !state || !state.plan) return { state, result: null, planChanged: false };

  const recipes = Array.isArray(ctx.recipes) && ctx.recipes.length > 0
    ? ctx.recipes
    : (ctx.recipesById ? [...ctx.recipesById.values()] : []);
  const logDate = fromDate || correctionFromDate(state);
  const today = todayIso();
  const replanFrom = logDate > today ? logDate : today;
  // When an earlier update was accepted, the current plan already contains its
  // make-up days. Replan from the plan before that acceptance with the corrected
  // log, so removing or reducing the meal that drove the update also removes (or
  // shrinks) the make-up instead of keeping it.
  const basePlan = state.planBase || state.plan;
  const result = replan({
    targets: state.targets || [],
    recipes,
    plan: basePlan,
    log: state.log || [],
    bought: state.bought || [],
    foodsById: ctx.foodsById || new Map(),
    fromDate: replanFrom,
    logFromDate: logDate,
    mealPrefs: state.mealPrefs,
  });
  // Days that are already over keep the meals of the plan in force now: make-up
  // accepted for an earlier log must not be reverted when a later log is
  // corrected. Only the days from `replanFrom` forward are recalculated.
  const keptPastDays = {};
  for (const [date, meals] of Object.entries(state.plan?.days || {})) {
    if (date < today) keptPastDays[date] = { ...meals };
  }
  const proposal = {
    ...result,
    plan: { ...result.plan, days: { ...result.plan.days, ...keptPastDays } },
  };
  // Until the refreshed proposal is accepted the plan goes back to the baseline
  // from today on, so no stale compensation survives; days already over keep
  // what was accepted for them.
  const nextDays = {};
  for (const [date, meals] of Object.entries(basePlan.days || {})) {
    nextDays[date] = keptPastDays[date] || { ...meals };
  }
  for (const [date, meals] of Object.entries(keptPastDays)) {
    if (!nextDays[date]) nextDays[date] = meals;
  }
  const planChanged = result.changed.length > 0;
  const next = {
    ...state,
    plan: { ...basePlan, days: nextDays },
    planBase: null,
    pendingProposal: planChanged ? proposalToStore(proposal) : null,
  };
  ctx.state = next;
  saveState(next);
  ctx.proposal = planChanged ? proposal : null;
  ctx.logDraft = null;
  ctx.logNotice = planChanged
    ? 'Log corrected. The plan was updated.'
    : 'Log corrected. The rest of the month did not need to change.';
  if (typeof ctx.navigate === 'function') ctx.navigate(planChanged ? 'updated' : 'plan');
  return { state: next, result: proposal, planChanged };
}
