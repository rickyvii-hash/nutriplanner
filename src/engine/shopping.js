// Shopping list from the remaining plan. Ticked items move to "Already at home"
// and leave the to-buy list (no duplicates across sections).

import { todayIso } from './planner.js';

const CATEGORY_ORDER = ['Produce', 'Protein', 'Dairy', 'Pantry', 'Frozen', 'Other'];

/**
 * Build a shopping list for meals on/after fromDate.
 * Returns { toBuy: [{ foodId, name, category, grams }], atHome: same }.
 * Each foodId appears in at most one section.
 */
export function buildShoppingList({ plan, recipes, foodsById, bought = [], fromDate = todayIso() }) {
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const boughtSet = new Set(bought);
  const gramsByFood = new Map();

  for (const [date, meals] of Object.entries(plan?.days || {})) {
    if (date < fromDate) continue;
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
      const recipe = recipesById.get(meals[slot]);
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        gramsByFood.set(ing.foodId, (gramsByFood.get(ing.foodId) || 0) + ing.grams);
      }
    }
  }

  const toBuy = [];
  const atHome = [];

  for (const [foodId, grams] of gramsByFood) {
    const food = foodsById.get(foodId);
    const item = {
      foodId,
      name: food?.name || foodId,
      category: food?.category || 'Other',
      grams: Math.round(grams),
    };
    if (boughtSet.has(foodId)) atHome.push(item);
    else toBuy.push(item);
  }

  const byCategory = (list) => {
    const groups = new Map();
    for (const item of list) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    }
    for (const items of groups.values()) {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    const ordered = [];
    for (const cat of CATEGORY_ORDER) {
      if (groups.has(cat)) ordered.push({ category: cat, items: groups.get(cat) });
    }
    for (const [cat, items] of groups) {
      if (!CATEGORY_ORDER.includes(cat)) ordered.push({ category: cat, items });
    }
    return ordered;
  };

  return {
    toBuy,
    atHome,
    toBuyGrouped: byCategory(toBuy),
    atHomeGrouped: byCategory(atHome),
  };
}

export { CATEGORY_ORDER };
