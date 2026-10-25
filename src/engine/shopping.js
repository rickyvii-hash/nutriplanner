// Shopping list from the remaining plan. Every ingredient is in one of three
// states: To buy, In cart or Not found. A ticked item stays visible in the cart
// list with an Undo, and a missing item leaves the cart so the planner never
// counts it as bought.

import { todayIso } from './planner.js';
import { displayFoodName } from './food_display.js';
import { REMOVED_CUSTOM_LABEL } from './custom_foods.js';

const CATEGORY_ORDER = ['Produce', 'Protein', 'Dairy', 'Pantry', 'Frozen', 'Other'];

// The order meal slots appear inside a day, for the "meals that use it" list.
const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack', 'snack2'];

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
 * The state of one ingredient on the shopping list. Not found wins over a
 * tick, so an item can never be both missing and bought for the planner.
 */
export function shoppingItemState(foodId, { bought = [], notFound = [] } = {}) {
  if ((notFound || []).includes(foodId)) return 'notFound';
  if ((bought || []).includes(foodId)) return 'inCart';
  return 'toBuy';
}

/** "3 of 12 in cart": cart items over every item the list holds. */
export function cartProgress({ toBuy = [], inCart = [], notFound = [] } = {}) {
  const total = toBuy.length + inCart.length + notFound.length;
  return {
    inCart: inCart.length,
    total,
    text: `${inCart.length} of ${total} in cart`,
  };
}

/**
 * The planned meals inside the shopping window that use one ingredient, as
 * { date, slot, recipeId, recipeName }, oldest day first and in slot order.
 */
export function mealsUsingFood({
  plan, recipes = [], recipesById = null, foodId, fromDate, toDate = null,
}) {
  const byId = recipesById || new Map(recipes.map((r) => [r.id, r]));
  const out = [];
  if (!foodId) return out;
  for (const [date, meals] of Object.entries(plan?.days || {})) {
    if (date < fromDate) continue;
    if (toDate && date > toDate) continue;
    for (const slot of Object.keys(meals || {})) {
      const recipe = byId.get(meals[slot]);
      if (!recipe) continue;
      if (!(recipe.ingredients || []).some((ing) => ing.foodId === foodId)) continue;
      out.push({ date, slot, recipeId: recipe.id, recipeName: recipe.name });
    }
  }
  const slotRank = (slot) => {
    const index = SLOT_ORDER.indexOf(slot);
    return index === -1 ? SLOT_ORDER.length : index;
  };
  out.sort((a, b) => (a.date === b.date ? slotRank(a.slot) - slotRank(b.slot) : a.date.localeCompare(b.date)));
  return out;
}

/** Move an item into the cart: state.bought keeps its old meaning for the planner. */
export function markItemInCart(state, foodId) {
  if (!state || !foodId) return state;
  const bought = new Set(state.bought || []);
  bought.add(foodId);
  return {
    ...state,
    bought: [...bought],
    notFound: (state.notFound || []).filter((id) => id !== foodId),
  };
}

/** Mark an item as not found: it leaves the cart, so it never counts as bought. */
export function markItemNotFound(state, foodId) {
  if (!state || !foodId) return state;
  const notFound = new Set(state.notFound || []);
  notFound.add(foodId);
  return {
    ...state,
    notFound: [...notFound],
    bought: (state.bought || []).filter((id) => id !== foodId),
  };
}

/** Send an item back to To buy from either the cart or the not-found list. */
export function undoItemState(state, foodId) {
  if (!state || !foodId) return state;
  return {
    ...state,
    bought: (state.bought || []).filter((id) => id !== foodId),
    notFound: (state.notFound || []).filter((id) => id !== foodId),
  };
}

/**
 * "I'm shopping now": start a new window today and clear the not-found list.
 * Items already in the cart keep their existing meaning and stay as they are.
 */
export function shoppingNowState(state, today) {
  if (!state) return state;
  return { ...state, shopStart: today, notFound: [] };
}

/**
 * Build a shopping list for meals inside [fromDate, toDate] (both inclusive).
 * Returns { toBuy, inCart, notFound }, each a list of
 * { foodId, name, category, grams }, plus the same lists grouped by category.
 * `atHome` is kept as an alias of `inCart` for the existing screens and tests.
 * Each foodId appears in at most one section.
 */
export function buildShoppingList({
  plan, recipes, foodsById, bought = [], notFound = [], fromDate = todayIso(), toDate = null,
}) {
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const boughtSet = new Set(bought);
  const notFoundSet = new Set(notFound);
  const gramsByFood = new Map();

  for (const [date, meals] of Object.entries(plan?.days || {})) {
    if (date < fromDate) continue;
    if (toDate && date > toDate) continue;
    // Every meal slot the day holds, including a second snack; switched-off slots are absent.
    for (const slot of Object.keys(meals || {})) {
      const recipe = recipesById.get(meals[slot]);
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        gramsByFood.set(ing.foodId, (gramsByFood.get(ing.foodId) || 0) + ing.grams);
      }
    }
  }

  const toBuy = [];
  const inCart = [];
  const missing = [];

  for (const [foodId, grams] of gramsByFood) {
    const food = foodsById.get(foodId) || null;
    const item = {
      foodId,
      // A missing definition still gets a readable label instead of a raw id.
      name: displayFoodName(food) || (food ? foodId : REMOVED_CUSTOM_LABEL),
      category: food?.category || 'Other',
      grams: Math.round(grams),
    };
    if (notFoundSet.has(foodId)) missing.push(item);
    else if (boughtSet.has(foodId)) inCart.push(item);
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
    inCart,
    notFound: missing,
    atHome: inCart,
    toBuyGrouped: byCategory(toBuy),
    inCartGrouped: byCategory(inCart),
    notFoundGrouped: byCategory(missing),
    atHomeGrouped: byCategory(inCart),
  };
}

export { CATEGORY_ORDER };
