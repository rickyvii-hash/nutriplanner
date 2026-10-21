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
  for (const key of NUTRIENT_KEYS) {
    const per100 = food.per100g[key];
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

/** Nutrients of one serving of a recipe (ingredient grams are per serving). */
export function recipeNutrients(recipe, foodsById) {
  const parts = recipe.ingredients.map((ing) => {
    const food = foodsById.get(ing.foodId);
    if (!food) throw new Error(`Recipe "${recipe.id}" uses unknown food "${ing.foodId}"`);
    return foodNutrients(food, ing.grams);
  });
  return sumNutrients(parts);
}

/** Nutrients of a logged meal: [{ foodId, grams }]. */
export function loggedNutrients(items, foodsById) {
  const parts = items.map((it) => {
    const food = foodsById.get(it.foodId);
    if (!food) throw new Error(`Unknown food "${it.foodId}"`);
    return foodNutrients(food, it.grams);
  });
  return sumNutrients(parts);
}

/** Text for a nutrient value on screen: "n/a" when nothing is known, "≥" when incomplete. */
export function formatNutrient(result, key, decimals = 0) {
  if (result.unknown[key]) return 'n/a';
  const text = result.totals[key].toFixed(decimals);
  return result.incomplete[key] ? `≥${text}` : text;
}
