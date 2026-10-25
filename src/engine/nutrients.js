// Nutrient arithmetic. A nutrient value of null means "USDA has no value":
// it is never treated as zero. Totals add up the known values and report
// which nutrients are incomplete.

export const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', icon: '🔥' },
  { key: 'protein', label: 'Protein', unit: 'g', icon: '💪' },
  { key: 'fat', label: 'Total fat', unit: 'g', icon: '🫒' },
  { key: 'satFat', label: 'Saturated fat', unit: 'g', icon: '💧' },
  { key: 'carbs', label: 'Carbohydrate', unit: 'g', icon: '🌾' },
  { key: 'fibre', label: 'Fibre', unit: 'g', icon: '🌿' },
  { key: 'sugars', label: 'Sugars', unit: 'g', icon: '🍬' },
  { key: 'sodium', label: 'Sodium', unit: 'mg', icon: '🧂' },
];

export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);

/** Nutrients in `grams` of a food. Unknown values stay null. */
export function foodNutrients(food, grams) {
  const out = {};
  const per100g = food && typeof food === 'object' ? food.per100g : null;
  for (const key of NUTRIENT_KEYS) {
    const per100 = per100g ? per100g[key] : null;
    out[key] = per100 === null || per100 === undefined ? null : (per100 * grams) / 100;
  }
  return out;
}

/**
 * Adds up a list of nutrient objects (each value a number or null).
 * Returns { totals, incomplete }: totals holds the sum of the known values,
 * incomplete[key] is true when at least one part had no value for it,
 * unknown[key] is true when no part had a value at all.
 */
export function sumNutrients(parts) {
  const totals = {};
  const incomplete = {};
  const unknown = {};
  for (const key of NUTRIENT_KEYS) {
    let sum = 0;
    let known = 0;
    for (const p of parts) {
      if (p[key] === null || p[key] === undefined) incomplete[key] = true;
      else {
        sum += p[key];
        known += 1;
      }
    }
    totals[key] = sum;
    incomplete[key] = Boolean(incomplete[key]);
    unknown[key] = parts.length > 0 && known === 0;
  }
  return { totals, incomplete, unknown };
}

/**
 * The food a lookup holds, or null. A missing definition (a removed food, an
 * id from an older backup) is unknown, not a crash: the calls below turn it
 * into null nutrients.
 */
function lookupFood(foodsById, foodId) {
  return foodsById?.get?.(foodId) || null;
}

/** Nutrients of one serving of a recipe (ingredient grams are per serving). */
export function recipeNutrients(recipe, foodsById) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const parts = ingredients.map((ing) => (
    foodNutrients(lookupFood(foodsById, ing?.foodId), ing?.grams)
  ));
  return sumNutrients(parts);
}

/** Nutrients of a logged meal: [{ foodId, grams }]. An unknown food is unknown, never zero. */
export function loggedNutrients(items, foodsById) {
  const list = Array.isArray(items) ? items : [];
  const parts = list.map((it) => (
    foodNutrients(lookupFood(foodsById, it?.foodId), it?.grams)
  ));
  return sumNutrients(parts);
}

/** Text for a nutrient value on screen: "n/a" when nothing is known, "≥" when incomplete. */
export function formatNutrient(result, key, decimals = 0) {
  if (result.unknown[key]) return 'n/a';
  const text = result.totals[key].toFixed(decimals);
  return result.incomplete[key] ? `≥${text}` : text;
}
