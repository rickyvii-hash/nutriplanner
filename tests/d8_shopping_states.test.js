/**
 * D8 (P2): the shopping list keeps a ticked ingredient visible as "In cart"
 * (struck-through, with Undo) and adds a "Not found" state whose rows lead to
 * swapping a planned meal that uses the ingredient.
 *
 * The three states live in the shopping engine, the shopping settings live in
 * the store, and the swap hand-off is a one-shot ctx.openReplace consumed by
 * the day screen (Plan), which opens that meal's Replace picker.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan } from '../src/engine/planner.js';
import {
  addDays,
  buildShoppingList,
  cartProgress,
  mealsUsingFood,
  markItemInCart,
  markItemNotFound,
  shoppingItemState,
  shoppingNowState,
  shoppingWindow,
  undoItemState,
} from '../src/engine/shopping.js';
import { profileById } from '../src/engine/profiles.js';
import {
  emptyAppState,
  startOverState,
  saveState,
  loadState,
  clearState,
} from '../src/store.js';
import {
  buildExportPayload,
  validateImportPayload,
  applyImportPayload,
} from '../src/engine/export_import.js';
import { replaceForwardSlot } from '../src/ui/plan.js';
import { renderShopping } from '../src/ui/shopping.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (rel) => fs.readFileSync(root + rel, 'utf8');

const foods = JSON.parse(fs.readFileSync(root + 'data/foods.json', 'utf8'));
const recipes = JSON.parse(fs.readFileSync(root + 'data/recipes.json', 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const plan = buildPlan(profileById('cholesterol').targets, recipes, { year: 2026, month: 10 }, foodsById);

const FROM = '2026-10-21';
const TO = '2026-10-27';
const WINDOW = shoppingWindow(FROM, 7);

function windowList(extra = {}) {
  return buildShoppingList({
    plan, recipes, foodsById, fromDate: WINDOW.from, toDate: WINDOW.to, ...extra,
  });
}

function memoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// --- Three states ----------------------------------------------------------

test('D8: an item is To buy, In cart or Not found, with Not found winning a clash', () => {
  const id = windowList().toBuy[0].foodId;
  assert.equal(shoppingItemState(id, { bought: [], notFound: [] }), 'toBuy');
  assert.equal(shoppingItemState(id, { bought: [id], notFound: [] }), 'inCart');
  assert.equal(shoppingItemState(id, { bought: [], notFound: [id] }), 'notFound');
  // A not-found item is never also counted as bought for the planner.
  assert.equal(shoppingItemState(id, { bought: [id], notFound: [id] }), 'notFound');
});

test('D8: a ticked item moves to In cart and stays in the list; a missing item moves to Not found', () => {
  const full = windowList();
  const ticked = full.toBuy[0].foodId;
  const missing = full.toBuy[1].foodId;

  const inCart = windowList({ bought: [ticked] });
  assert.ok(!inCart.toBuy.some((i) => i.foodId === ticked), 'ticked item left To buy');
  assert.ok(inCart.inCart.some((i) => i.foodId === ticked), 'ticked item must stay visible In cart');
  assert.equal(inCart.notFound.length, 0);

  const picked = windowList({ notFound: [missing] });
  assert.ok(!picked.toBuy.some((i) => i.foodId === missing), 'missing item left To buy');
  assert.ok(picked.notFound.some((i) => i.foodId === missing), 'missing item belongs to Not found');
  assert.ok(!picked.inCart.some((i) => i.foodId === missing), 'a missing item is not in the cart');

  // Both lists win over bought: the planner never sees a not-found item as bought.
  const both = windowList({ bought: [missing], notFound: [missing] });
  assert.ok(both.notFound.some((i) => i.foodId === missing));
  assert.ok(!both.inCart.some((i) => i.foodId === missing));

  // No item can appear in two sections.
  const ids = [...both.toBuy, ...both.inCart, ...both.notFound].map((i) => i.foodId);
  assert.equal(new Set(ids).size, ids.length, 'a food is listed in two sections');
});

test('D8: atHome keeps its old meaning as the in-cart list, for the existing screens and tests', () => {
  const id = windowList().toBuy[0].foodId;
  const list = windowList({ bought: [id] });
  assert.deepEqual(list.atHome, list.inCart);
  assert.deepEqual(list.atHomeGrouped, list.inCartGrouped);
});

test('D8: the progress line counts the cart over every listed item', () => {
  const base = windowList();
  const bought = base.toBuy.slice(0, 3).map((i) => i.foodId);
  const notFound = [base.toBuy[3].foodId];
  const list = windowList({ bought, notFound });

  const progress = cartProgress(list);
  assert.equal(progress.inCart, 3);
  assert.equal(progress.total, list.toBuy.length + list.inCart.length + list.notFound.length);
  assert.equal(progress.text, '3 of ' + progress.total + ' in cart');
});

// --- Meals that use an ingredient -----------------------------------------

test('D8: meals using an ingredient are only the ones inside the shopping window', () => {
  const id = windowList().toBuy[0].foodId;
  const meals = mealsUsingFood({
    plan, recipes, recipesById, foodId: id, fromDate: WINDOW.from, toDate: WINDOW.to,
  });

  assert.ok(meals.length > 0, 'the ingredient is used by planned meals');
  for (const meal of meals) {
    assert.match(meal.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(meal.date >= WINDOW.from && meal.date <= WINDOW.to, meal.date + ' outside the window');
    assert.ok(recipesById.get(meal.recipeId).ingredients.some((ing) => ing.foodId === id));
    assert.equal(meal.recipeName, recipesById.get(meal.recipeId).name);
    assert.ok(meal.slot, 'each meal carries its slot');
  }

  // A two-day window only reports the meals in those two days.
  const short = shoppingWindow(FROM, 2);
  const early = mealsUsingFood({
    plan, recipes, recipesById, foodId: id, fromDate: short.from, toDate: short.to,
  });
  for (const meal of early) {
    assert.ok(meal.date >= short.from && meal.date <= short.to);
  }
});

test('D8: an ingredient that no meal inside the window uses has no swap rows', () => {
  const inWindow = new Set(windowList().toBuy.map((i) => i.foodId));
  const month = buildShoppingList({
    plan, recipes, foodsById, fromDate: '2026-10-01', toDate: '2026-10-31',
  });
  const outside = month.toBuy.find((i) => !inWindow.has(i.foodId));
  if (!outside) return; // every food of the month is used in this window
  assert.deepEqual(mealsUsingFood({
    plan, recipes, recipesById, foodId: outside.foodId,
    fromDate: WINDOW.from, toDate: WINDOW.to,
  }), []);
});

// --- State transitions -----------------------------------------------------

test('D8: marking Not found takes the item out of the cart; Undo clears both states', () => {
  const base = { ...emptyAppState(), bought: ['spinach-raw'], notFound: [] };

  const missing = markItemNotFound(base, 'spinach-raw');
  assert.deepEqual(missing.notFound, ['spinach-raw']);
  assert.deepEqual(missing.bought, [], 'a missing item must not count as bought for the planner');

  const cart = markItemInCart(missing, 'apple-raw');
  assert.deepEqual(cart.bought, ['apple-raw']);
  assert.deepEqual(cart.notFound, ['spinach-raw']);

  const undone = undoItemState(cart, 'apple-raw');
  assert.deepEqual(undone.bought, []);
  assert.deepEqual(undone.notFound, ['spinach-raw']);

  // The original state is never mutated.
  assert.deepEqual(base.bought, ['spinach-raw']);
  assert.deepEqual(base.notFound, []);
});

test('D8: I am shopping now starts a new window and clears Not found, keeping bought items', () => {
  const state = {
    ...emptyAppState(),
    bought: ['spinach-raw'],
    notFound: ['apple-raw'],
    shopEvery: 3,
    shopStart: '2026-10-01',
  };
  const next = shoppingNowState(state, '2026-10-25');
  assert.equal(next.shopStart, '2026-10-25');
  assert.equal(next.shopEvery, 3);
  assert.deepEqual(next.notFound, []);
  assert.deepEqual(next.bought, ['spinach-raw'], 'bought keeps its existing meaning');
  assert.equal(addDays(next.shopStart, 3 - 1), '2026-10-27');
  assert.deepEqual(state.notFound, ['apple-raw'], 'the old state is untouched');
});

// --- Backup, storage and Start over ---------------------------------------

test('D8: a backup with Not found exports, validates and restores it', () => {
  const state = {
    ...emptyAppState(),
    profileId: 'cholesterol',
    bought: ['pizza-cheese'],
    notFound: ['spinach-raw', 'apple-raw'],
  };
  const payload = buildExportPayload(state);
  assert.deepEqual(payload.notFound, state.notFound);
  assert.equal(validateImportPayload(payload).ok, true);

  const restored = applyImportPayload(emptyAppState(), payload);
  assert.deepEqual(restored.notFound, state.notFound);
  assert.deepEqual(restored.bought, state.bought);
});

test('D8: an older backup without Not found is accepted and restores an empty list', () => {
  const payload = buildExportPayload({
    ...emptyAppState(), profileId: 'cholesterol', notFound: ['spinach-raw'],
  });
  const older = { ...payload };
  delete older.notFound;
  assert.equal(validateImportPayload(older).ok, true);
  assert.deepEqual(applyImportPayload(emptyAppState(), older).notFound, []);
});

test('D8: save and load bring the Not found list back; Start over clears it', () => {
  memoryStorage();
  clearState();
  saveState({
    ...emptyAppState(), profileId: 'cholesterol', bought: ['pizza-cheese'], notFound: ['apple-raw'],
  });
  const loaded = loadState();
  assert.deepEqual(loaded.notFound, ['apple-raw']);
  assert.deepEqual(loaded.bought, ['pizza-cheese']);

  assert.deepEqual(startOverState().notFound, [], 'Start over removes the Not found list');
  assert.deepEqual(startOverState(), emptyAppState());
});

// --- The day screen's one-shot Replace hand-off ---------------------------

const FORWARD_DATE = '2026-10-24';
const FORWARD_SLOT = Object.keys(plan.days[FORWARD_DATE]).find((slot) => plan.days[FORWARD_DATE][slot]);
const FORWARD_RECIPE = recipesById.get(plan.days[FORWARD_DATE][FORWARD_SLOT]);

function forward(openReplace, extra = {}) {
  return replaceForwardSlot({
    openReplace,
    plan,
    log: [],
    date: FORWARD_DATE,
    recipesById,
    today: FORWARD_DATE,
    ...extra,
  });
}

test('D8: Swap meal hands the day and slot to the day screen, which opens the picker', () => {
  assert.deepEqual(
    forward({ date: FORWARD_DATE, slot: FORWARD_SLOT }),
    { date: FORWARD_DATE, slot: FORWARD_SLOT },
  );
  // A hand-off never opens on another day, or for a slot the day does not hold.
  assert.equal(forward({ date: '2026-10-28', slot: FORWARD_SLOT }), null);
  assert.equal(forward({ date: FORWARD_DATE, slot: 'brunch' }), null);
  assert.equal(forward(null), null);
  // A day already over shows no picker, exactly as it shows no action buttons.
  assert.equal(
    forward({ date: FORWARD_DATE, slot: FORWARD_SLOT }, { today: '2026-10-25' }),
    null,
  );
});

test('D8: a meal already logged is not swapped again, so the picker stays closed', () => {
  const logged = [
    { date: FORWARD_DATE, items: [], eaten: [{ recipeId: FORWARD_RECIPE.id, slot: FORWARD_SLOT }] },
    {
      date: FORWARD_DATE, items: [], skipped: [FORWARD_RECIPE.id],
      skippedSlots: [{ recipeId: FORWARD_RECIPE.id, slot: FORWARD_SLOT }],
    },
    {
      date: FORWARD_DATE, items: [],
      replaced: [{ slot: FORWARD_SLOT, recipeId: null, fromRecipeId: FORWARD_RECIPE.id }],
    },
  ];
  for (const entry of logged) {
    assert.equal(
      forward({ date: FORWARD_DATE, slot: FORWARD_SLOT }, { log: [entry] }),
      null,
      'a logged outcome closes the picker',
    );
  }
});

test('D8: a meal removed from the plan is not swapped and no error is shown', () => {
  const withoutSlot = {
    month: plan.month,
    days: {
      ...plan.days,
      [FORWARD_DATE]: Object.fromEntries(
        Object.entries(plan.days[FORWARD_DATE]).filter(([slot]) => slot !== FORWARD_SLOT),
      ),
    },
  };
  assert.equal(
    forward({ date: FORWARD_DATE, slot: FORWARD_SLOT }, { plan: withoutSlot }),
    null,
  );
  assert.equal(forward({ date: FORWARD_DATE, slot: FORWARD_SLOT }, { plan: null }), null);
});

test('D8: only in-window meals that use the ingredient offer Swap meal', () => {
  const list = windowList();
  const item = list.toBuy[0];
  const offered = mealsUsingFood({
    plan, recipes, recipesById, foodId: item.foodId,
    fromDate: WINDOW.from, toDate: WINDOW.to,
  });
  const month = mealsUsingFood({
    plan, recipes, recipesById, foodId: item.foodId,
    fromDate: '2026-10-01', toDate: '2026-10-31',
  });

  // The list is exactly the month's meals inside the shopping window.
  assert.deepEqual(
    offered,
    month.filter((meal) => meal.date >= WINDOW.from && meal.date <= WINDOW.to),
  );
  for (const meal of offered) {
    assert.ok(meal.date >= WINDOW.from && meal.date <= WINDOW.to, 'Swap row inside the window');
    assert.ok(recipesById.get(meal.recipeId).ingredients.some((ing) => ing.foodId === item.foodId));
  }
  // Every hand-off row points at a planned, in-window meal.
  for (const meal of offered) {
    assert.deepEqual(
      forward({ date: meal.date, slot: meal.slot }, { date: meal.date, today: '2026-10-21' }),
      { date: meal.date, slot: meal.slot },
    );
  }
});

// --- Screen wiring (this project has no DOM harness, as in D6/D7) ----------

test('D8: the shopping screen renders the three sections and the swap line', () => {
  assert.equal(typeof renderShopping, 'function', 'the shopping screen module loads');
  const src = read('src/ui/shopping.js');
  assert.match(src, /data-cart-progress/);
  assert.match(src, /cartProgress\(/);
  // The in-cart section sits directly under To buy, before Not found.
  assert.ok(src.indexOf('data-buy>') < src.indexOf('data-cart>'), 'In cart must follow To buy');
  assert.match(src, /In cart \/ at home/);
  assert.match(src, /class="badge-in-cart">In cart</);
  assert.match(src, />Undo<\/button>/);
  assert.match(src, /data-not-found=/);
  assert.match(src, />Not found<\/button>/);
  assert.match(src, /Not in the shop\? Swap one of the meals that use it\./);
  assert.match(src, /data-swap-meal/);
  assert.match(src, />Swap meal<\/button>/);
  assert.match(src, /mealsUsingFood\(/);
  assert.match(src, /Support tool, not medical advice\./);
});

test('D8: the shopping screen uses the store helpers and hands the swap to the day screen', () => {
  const src = read('src/ui/shopping.js');
  assert.match(src, /markItemInCart\(state, /);
  assert.match(src, /markItemNotFound\(state, /);
  assert.match(src, /undoItemState\(state, /);
  assert.match(src, /shoppingNowState\(/);
  assert.match(src, /ctx\.selectedDate = /);
  assert.match(src, /ctx\.openReplace = \{ date, slot \}/);
  assert.match(src, /ctx\.navigate\('plan'\)/);
  assert.doesNotMatch(src, /ctx\.navigate\('log'\)/, 'Swap meal opens the day screen');
  assert.doesNotMatch(src, /\breplan\(/, 'no second planner on the shopping screen');
});

test('D8: the day screen consumes the Replace hand-off once and opens the picker', () => {
  const src = read('src/ui/plan.js');
  assert.match(src, /replaceForwardSlot\(/);
  assert.match(src, /const openReplace = ctx\.openReplace/);
  assert.match(src, /ctx\.openReplace = null/);
  assert.match(src, /openReplacement\(/);
  assert.match(src, /createReplacePicker\(/);
  // The shopping rows show the hint and an Undo for a missing item.
  const shopping = read('src/ui/shopping.js');
  assert.match(shopping, /class="shop-item is-not-found"[\s\S]*?data-undo-food=/);
  assert.match(read('src/app.js'), /openReplace: null/);
  // The hand-off survives the move to Plan, or its renderer could never read it.
  assert.match(read('src/app.js'), /name !== 'plan'/);
});

// --- Phone layout ----------------------------------------------------------

function ruleFor(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(escaped + '\\s*\\{[^}]*\\}'))?.[0] || '';
}

test('D8: shopping and My meals tick controls are at least 44 by 44 px', () => {
  const css = read('styles/app.css');
  const shopTick = ruleFor(css, '.shop-item input[type="checkbox"]');
  assert.ok(shopTick, 'a dedicated rule sizes the shopping tick');
  assert.ok(/width:\s*(4[4-9]|[5-9]\d|\d{3,})px/.test(shopTick), 'shopping tick width at least 44 px');
  assert.ok(/height:\s*(4[4-9]|[5-9]\d|\d{3,})px/.test(shopTick), 'shopping tick height at least 44 px');

  const mealsTick = ruleFor(css, '.my-meals input[type="checkbox"]');
  assert.ok(mealsTick, 'a dedicated rule sizes the My meals tick');
  assert.ok(/width:\s*(4[4-9]|[5-9]\d|\d{3,})px/.test(mealsTick), 'My meals tick width at least 44 px');
  assert.ok(/height:\s*(4[4-9]|[5-9]\d|\d{3,})px/.test(mealsTick), 'My meals tick height at least 44 px');

  // Every x button (target rows included) reaches 44 by 44.
  const iconRules = css.match(/\.btn-icon[^{]*\{[^}]*\}/g) || [];
  assert.ok(
    iconRules.some((r) => /min-width:\s*44px/.test(r) && /min-height:\s*44px/.test(r)),
    'the x buttons must be at least 44 by 44 px',
  );
});

test('D8: shopping rows wrap on a phone and their buttons stay 44 px high', () => {
  const css = read('styles/app.css');
  assert.match(ruleFor(css, '.shop-item'), /flex-wrap:\s*wrap/);
  assert.match(ruleFor(css, '.shop-item-actions'), /flex-wrap:\s*wrap/);
  assert.match(css, /\.shop-item-actions \.btn-small[^{]*\{[^}]*min-height:\s*44px/);
});
