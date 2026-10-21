// Shopping list from the remaining plan. Ticked items move to "Already at home"
// and leave the to-buy list (no duplicates across sections).

import { todayIso } from './planner.js';

const CATEGORY_ORDER = ['Produce', 'Protein', 'Dairy', 'Pantry', 'Frozen', 'Other'];

export const SHOP_EVERY_OPTIONS = [2, 3, 5, 7];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Add days to a YYYY-MM-DD date without time-zone drift. */
export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Whole days from isoA to isoB (YYYY-MM-DD), without time-zone drift. */
function dayDiff(isoA, isoB) {
  const [ya, ma, da] = isoA.split('-').map(Number);
  const [yb, mb, db] = isoB.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/**
 * Start of the shopping window that contains `today`. Trips repeat every `shopEvery` days from the
 * saved start, so a window that has ended rolls forward instead of showing past meals.
 */
export function currentShopStart(shopStart, shopEvery, today) {
  const every = Math.max(1, Number(shopEvery) || 7);
  const gone = dayDiff(shopStart, today);
  if (gone < every) return shopStart;
  return addDays(shopStart, Math.floor(gone / every) * every);
}

/**
 * Meals covered by one shopping trip: from the start date up to the day before
 * the next trip. Seven days starting 2026-10-21 ends on 2026-10-27.
 */
export function shoppingWindow(fromDate, shopEvery = 7) {
  const every = Math.max(1, Number(shopEvery) || 7);
  return { from: fromDate, to: addDays(fromDate, every - 1), shopEvery: every };
}

/**
 * How much of a shopping window the month plan can cover. The plan is not
 * extended beyond its own month, so a window that crosses the month end is
 * truncated: 2026-10-30..2026-11-01 has only the last two October days.
 */
export function windowCoverage(plan, window) {
  const planDates = Object.keys(plan?.days || {}).sort();
  const lastPlanDate = planDates.length > 0 ? planDates[planDates.length - 1] : null;
  const requestedDays = window?.from && window?.to ? dayDiff(window.from, window.to) + 1 : 0;
  const coveredDays = planDates.filter((date) => date >= window.from && date <= window.to).length;
  return {
    lastPlanDate,
    coveredDays,
    requestedDays,
    truncated: coveredDays < requestedDays,
  };
}

/**
 * Start to keep when the frequency changes: the saved start (or today when
 * none was saved), never the rolled-forward one, so future trips keep the
 * cadence the user chose.
 */
export function savedShopStart(shopStart, today) {
  return shopStart || today;
}

/**
 * Build a shopping list for meals inside [fromDate, toDate] (both inclusive).
 * Returns { toBuy: [{ foodId, name, category, grams }], atHome: same }.
 * Each foodId appears in at most one section.
 */
export function buildShoppingList({
  plan, recipes, foodsById, bought = [], fromDate = todayIso(), toDate = null,
}) {
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const boughtSet = new Set(bought);
  const gramsByFood = new Map();

  for (const [date, meals] of Object.entries(plan?.days || {})) {
    if (date < fromDate) continue;
    if (toDate && date > toDate) continue;
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
