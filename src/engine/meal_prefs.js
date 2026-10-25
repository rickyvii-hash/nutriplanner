// F2 — My meals: which daily meal slots are on, and 0–1 snack.
// Fewer meals still use the same daily targets, so each meal carries more.

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
export const MAX_SNACKS = 1;

/** The starting choice: breakfast, lunch, dinner and one snack. */
export function defaultMealPrefs() {
  return { breakfast: true, lunch: true, dinner: true, snacks: 1 };
}

/**
 * A safe copy of saved preferences: snacks clamped to 0–1 (an older saved 2
 * comes down to 1), and at least one meal
 * stays on (dinner) so a plan can never be empty.
 */
export function normalizeMealPrefs(prefs) {
  const raw = prefs && typeof prefs === 'object' ? prefs : {};
  const out = {
    breakfast: raw.breakfast === undefined ? true : Boolean(raw.breakfast),
    lunch: raw.lunch === undefined ? true : Boolean(raw.lunch),
    dinner: raw.dinner === undefined ? true : Boolean(raw.dinner),
    snacks: 1,
  };
  const n = Number(raw.snacks);
  if (Number.isFinite(n)) out.snacks = Math.max(0, Math.min(MAX_SNACKS, Math.round(n)));
  if (!out.breakfast && !out.lunch && !out.dinner) out.dinner = true;
  return out;
}

/**
 * The slots that are on, in meal order. Snacks 0 → none, 1 → snack.
 * New plans never hold a second snack; `snack2` is only still understood when
 * reading an older saved plan or log.
 */
export function activeSlots(prefs) {
  const p = normalizeMealPrefs(prefs);
  const slots = [];
  if (p.breakfast) slots.push('breakfast');
  if (p.lunch) slots.push('lunch');
  if (p.dinner) slots.push('dinner');
  if (p.snacks >= 1) slots.push('snack');
  return slots;
}

/** The recipe kind a slot draws from: both snack slots use snack recipes. */
export function slotRecipeKind(slot) {
  return slot === 'snack2' ? 'snack' : slot;
}

/** "snack2" is shown as a second snack, not as a different kind of meal. */
export function slotLabel(slot) {
  return slotRecipeKind(slot);
}

/**
 * Per-slot soft cap: for each max daily target a single meal may contribute at most
 * (daily / N) * 1.75, where N is the number of active slots; when no other combination
 * fits, the builder falls through to the closest plan exactly as before.
 */
export function perSlotCapFactor(nActive) {
  const n = Number(nActive);
  return 1.75 / (Number.isFinite(n) && n >= 1 ? n : 1);
}

// Rebuilding a plan when the chosen meals change lives in the planner, next to the
// builder it reuses; it is re-exported here so this module is the one entry point.
export { rebuildPlanMeals } from './planner.js';
