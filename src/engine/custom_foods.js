/**
 * Foods the person adds themselves.
 *
 * A food database cannot hold every dish someone eats, so the search screens
 * offer "Add my own food". The values typed for one portion are stored as a
 * nominal 100 g reference: one portion therefore holds exactly what was typed,
 * and the existing per-100 g nutrient maths works unchanged. A nutrient the
 * person did not enter stays null (never zero), so every screen keeps showing
 * "n/a" or the partial-sum mark exactly as it does for the database foods.
 */

import { displayFoodName } from './food_display.js';
import { NUTRIENT_KEYS } from './nutrients.js';

export const CUSTOM_FOOD_PREFIX = 'custom-';
export const CUSTOM_NAME_MAX = 60;
export const CUSTOM_KCAL_MAX = 5000;
/** One portion of a food the person added is stored as this nominal amount. */
export const CUSTOM_PORTION_GRAMS = 100;
/** A portion count that still makes sense for one log line. */
export const MAX_PORTIONS = 50;
export const CUSTOM_ENTRY_LABEL = '(your entry)';
export const CUSTOM_FORM_NOTE = 'Values are your own estimate.';
export const DEFAULT_PORTION_LABEL = '1 portion';
export const REMOVED_CUSTOM_LABEL = 'Removed custom food';
/**
 * A food the person removed from the list but that something already uses keeps
 * its definition with this mark: hidden from search and pickers, still resolving
 * by id for the log and the planned meals.
 */
export const REMOVED_FROM_LIST_FLAG = 'removedFromList';

/** The optional nutrient fields of the form: label, unit and where the value goes. */
export const CUSTOM_OPTIONAL_NUTRIENTS = [
  { key: 'satFat', label: 'Saturated fat', unit: 'g' },
  { key: 'fat', label: 'Total fat', unit: 'g' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'fibre', label: 'Fibre', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
  { key: 'sugars', label: 'Sugar', unit: 'g' },
];

/** True for an id this app gives to a food the person added. */
export function isCustomFoodId(id) {
  return typeof id === 'string' && id.startsWith(CUSTOM_FOOD_PREFIX);
}

/** The label a food the person added carries on every screen. */
export function customEntryLabel(name) {
  return `${name} ${CUSTOM_ENTRY_LABEL}`;
}

/**
 * The name to show for a food (or for a log item whose food is unknown).
 * A food the person added always carries "(your entry)"; a food whose
 * definition is gone shows the name stored with the log line, or a plain
 * "Removed custom food". Database foods keep the brand-free display name.
 */
export function shownFoodName(food, fallback = '') {
  const saved = String(fallback || '').trim();
  if (!food) return saved || REMOVED_CUSTOM_LABEL;
  if (food.custom) {
    if (food.missingCustom) return saved || food.name || REMOVED_CUSTOM_LABEL;
    return food.name ? customEntryLabel(food.name) : REMOVED_CUSTOM_LABEL;
  }
  return displayFoodName(food) || saved || food.id || REMOVED_CUSTOM_LABEL;
}

/** The label search matches and displays for a food (brand-free for database foods). */
export function foodSearchLabel(food) {
  if (!food) return '';
  if (food.custom) return food.name || '';
  return displayFoodName(food);
}

/** A typed field: missing, not a number, or a number. */
function readNumber(raw) {
  if (raw === null || raw === undefined) return { state: 'empty' };
  const text = String(raw).trim();
  if (text === '') return { state: 'empty' };
  const value = Number(text);
  if (!Number.isFinite(value)) return { state: 'invalid' };
  return { state: 'value', value };
}

/**
 * Check the form of a food the person adds.
 * Returns { ok, errors, value }: errors maps a field to a plain-English
 * message (no field is ever dropped silently), value holds the cleaned name,
 * portion label and the nutrient values for one portion (null when not given).
 */
export function validateCustomFood(input = {}) {
  const errors = {};
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Enter a name for the food.';
  else if (name.length > CUSTOM_NAME_MAX) {
    errors.name = `Use ${CUSTOM_NAME_MAX} characters or fewer for the name.`;
  }

  const portionLabel = String(input.portionLabel ?? '').trim() || DEFAULT_PORTION_LABEL;

  const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null]));
  const kcal = readNumber(input.kcal);
  if (kcal.state === 'empty') errors.kcal = 'Enter the calories for one portion.';
  else if (kcal.state === 'invalid') errors.kcal = 'Calories must be a number.';
  else if (kcal.value <= 0) errors.kcal = 'Calories must be more than 0.';
  else if (kcal.value > CUSTOM_KCAL_MAX) errors.kcal = `Calories must be ${CUSTOM_KCAL_MAX} or less.`;
  else nutrients.kcal = kcal.value;

  for (const field of CUSTOM_OPTIONAL_NUTRIENTS) {
    const parsed = readNumber(input[field.key]);
    if (parsed.state === 'empty') continue;
    if (parsed.state === 'invalid') {
      errors[field.key] = `${field.label} must be a number.`;
      continue;
    }
    if (parsed.value < 0) {
      errors[field.key] = `${field.label} cannot be negative.`;
      continue;
    }
    nutrients[field.key] = parsed.value;
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok ? { name, portionLabel, nutrients } : null,
  };
}

/** The next free id: custom-1, custom-2, ... */
export function nextCustomFoodId(existing = []) {
  let highest = 0;
  for (const food of Array.isArray(existing) ? existing : []) {
    const match = /^custom-(\d+)$/.exec(String(food?.id || ''));
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${CUSTOM_FOOD_PREFIX}${highest + 1}`;
}

/**
 * A saved food ready for the food list and the nutrient maths.
 * `nutrients` holds what the person typed for one portion; `per100g` holds the
 * same numbers because one portion is the nominal 100 g reference.
 */
export function buildCustomFood(input, existingCustomFoods = []) {
  // The form hands over the already validated value ({ name, portionLabel, nutrients });
  // raw form input is accepted too, so both paths build the same food.
  const raw = input && typeof input.nutrients === 'object' && input.nutrients !== null
    ? { name: input.name, portionLabel: input.portionLabel, ...input.nutrients }
    : input;
  const check = validateCustomFood(raw);
  if (!check.ok) {
    const error = new Error('Custom food is not valid: ' + Object.values(check.errors).join(' '));
    error.errors = check.errors;
    throw error;
  }
  const { name, portionLabel, nutrients } = check.value;
  const per100g = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, nutrients[key] ?? null]));
  return {
    id: nextCustomFoodId(existingCustomFoods),
    name,
    portionLabel,
    custom: true,
    nutrients: { ...nutrients },
    per100g,
  };
}

/**
 * Saved or imported custom foods, kept only when they still make sense:
 * an entry without a name is dropped, a value that is not a number becomes
 * null, and nothing is invented.
 */
export function normalizeCustomFoods(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name ?? '').trim();
    if (!name) continue;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : nextCustomFoodId(out);
    if (seen.has(id)) continue;
    seen.add(id);
    const source = raw.per100g && typeof raw.per100g === 'object'
      ? raw.per100g
      : (raw.nutrients && typeof raw.nutrients === 'object' ? raw.nutrients : {});
    const per100g = Object.fromEntries(NUTRIENT_KEYS.map((key) => {
      const value = source[key];
      return [key, typeof value === 'number' && Number.isFinite(value) ? value : null];
    }));
    const food = {
      id,
      name,
      portionLabel: String(raw.portionLabel ?? '').trim() || DEFAULT_PORTION_LABEL,
      custom: true,
      nutrients: { ...per100g },
      per100g,
    };
    // A hidden definition still belongs to what already uses it, through a reload
    // and through a backup: the mark travels with the food.
    if (raw[REMOVED_FROM_LIST_FLAG] === true) food[REMOVED_FROM_LIST_FLAG] = true;
    out.push(food);
  }
  return out;
}

/**
 * A food-shaped placeholder for an id whose definition is gone. Every nutrient
 * is unknown (never zero), so a calculation stays a partial sum or "n/a".
 */
function missingFood(id, name) {
  const per100g = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null]));
  return {
    id,
    name: String(name ?? '').trim() || REMOVED_CUSTOM_LABEL,
    portionLabel: DEFAULT_PORTION_LABEL,
    custom: isCustomFoodId(id),
    missingCustom: true,
    per100g,
    nutrients: { ...per100g },
  };
}

/**
 * Database foods plus the foods the person added, in search order.
 * A definition kept only for what already uses it is not offered again.
 */
export function allFoodsWithCustomFoods(foods, customFoods = []) {
  return [
    ...(Array.isArray(foods) ? foods : []),
    ...(Array.isArray(customFoods) ? customFoods : []).filter(
      (food) => food && food[REMOVED_FROM_LIST_FLAG] !== true,
    ),
  ];
}

/** Every food id an entry list (the log or the planned meals) refers to. */
function referencedItems(entries) {
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const item of entry?.items || []) out.push(item);
  }
  return out;
}

/**
 * The food lookup every screen uses. It also resolves an id whose definition is
 * gone (a restored log, a database food missing from an older backup, or a food
 * removed after it was logged or planned) to a placeholder with every nutrient
 * unknown, so no calculation crashes and no value is made up.
 */
export function foodIndexWithCustomFoods(foods, customFoods = [], log = [], plannedExtras = []) {
  const index = new Map((Array.isArray(foods) ? foods : []).map((food) => [food.id, food]));
  for (const food of Array.isArray(customFoods) ? customFoods : []) {
    if (food?.id) index.set(food.id, food);
  }
  // The log and the planned meals both keep their own food ids: whatever they
  // still point to must resolve, or the next replan would throw.
  for (const item of [...referencedItems(log), ...referencedItems(plannedExtras)]) {
    if (!item?.foodId || index.has(item.foodId)) continue;
    index.set(item.foodId, missingFood(item.foodId, item.name));
  }
  return index;
}

/** Portions to the grams the log stores (one portion is the nominal reference). */
export function gramsForPortions(portions) {
  const count = Number(portions);
  if (!Number.isFinite(count) || count <= 0) return CUSTOM_PORTION_GRAMS;
  return count * CUSTOM_PORTION_GRAMS;
}

/** A stored amount back to portions of a food the person added. */
export function portionsFromGrams(grams) {
  const value = Number(grams);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value / CUSTOM_PORTION_GRAMS;
}

/** A portion count greater than 0 and at most MAX_PORTIONS; null otherwise. */
export function parsePortions(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const count = Number(raw);
  if (!Number.isFinite(count) || count <= 0 || count > MAX_PORTIONS) return null;
  return count;
}

/** True when the log already holds a line with this food. */
export function customFoodUsedInLog(log, id) {
  if (!id) return false;
  return (Array.isArray(log) ? log : []).some((entry) => (
    (entry?.items || []).some((item) => item?.foodId === id)
  ));
}

/** True when a planned outside-the-menu meal already holds this food. */
export function customFoodUsedInPlannedExtras(plannedExtras, id) {
  if (!id) return false;
  return (Array.isArray(plannedExtras) ? plannedExtras : []).some((extra) => (
    (extra?.items || []).some((item) => item?.foodId === id)
  ));
}

/** True when the log or a planned meal already uses this food. */
export function customFoodInUse(id, { log = [], plannedExtras = [] } = {}) {
  return customFoodUsedInLog(log, id) || customFoodUsedInPlannedExtras(plannedExtras, id);
}

/**
 * Remove one food the person added from the searchable list.
 * A food the log or a planned meal already uses keeps its definition, hidden
 * from search and pickers but still resolving by id, so nothing breaks; a food
 * nothing uses is really removed. Past log lines are untouched either way.
 */
export function removeCustomFoodFromList(
  customFoods, id, { log = [], plannedExtras = [] } = {},
) {
  const list = Array.isArray(customFoods) ? customFoods : [];
  if (!customFoodInUse(id, { log, plannedExtras })) {
    return list.filter((food) => food?.id !== id);
  }
  return list.map((food) => (
    food?.id === id ? { ...food, [REMOVED_FROM_LIST_FLAG]: true } : food
  ));
}

/** What the screen says after a food the person added was removed from the list. */
export function customFoodRemovalNote(name, used) {
  const label = String(name || 'Your food');
  return used
    ? `${label} was removed from the food list. It stays in your log and planned meals. The meals you already logged stay in your past logs.`
    : `${label} was removed from the food list.`;
}
