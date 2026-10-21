import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan } from '../src/engine/planner.js';
import {
  addDays,
  buildShoppingList,
  currentShopStart,
  savedShopStart,
  shoppingWindow,
  windowCoverage,
} from '../src/engine/shopping.js';
import { profileById } from '../src/engine/profiles.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

const month = { year: 2026, month: 10 };
const start = '2026-10-21';

function plan() {
  return buildPlan(profileById('cholesterol').targets, recipes, month, foodsById);
}

function expectedGrams(thePlan, from, to) {
  const grams = new Map();
  for (const [date, meals] of Object.entries(thePlan.days)) {
    if (date < from || date > to) continue;
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
      const recipe = recipesById.get(meals[slot]);
      for (const ing of recipe.ingredients) {
        grams.set(ing.foodId, (grams.get(ing.foodId) || 0) + ing.grams);
      }
    }
  }
  return grams;
}

test('shopping window: seven days ends the day before the next shop', () => {
  assert.equal(addDays('2026-10-21', 6), '2026-10-27');
  assert.deepEqual(shoppingWindow('2026-10-21', 7), { from: '2026-10-21', to: '2026-10-27', shopEvery: 7 });
  assert.deepEqual(shoppingWindow('2026-10-31', 2), { from: '2026-10-31', to: '2026-11-01', shopEvery: 2 });
});

test('three-day list covers three days of meals and is smaller than seven days', () => {
  const built = plan();
  const three = shoppingWindow(start, 3);
  const seven = shoppingWindow(start, 7);
  const shortList = buildShoppingList({
    plan: built, recipes, foodsById, fromDate: three.from, toDate: three.to,
  });
  const longList = buildShoppingList({
    plan: built, recipes, foodsById, fromDate: seven.from, toDate: seven.to,
  });

  const shortExpected = expectedGrams(built, '2026-10-21', '2026-10-23');
  const longExpected = expectedGrams(built, '2026-10-21', '2026-10-27');

  // The list contains exactly the foods of the meals inside the window.
  assert.deepEqual(
    new Set(shortList.toBuy.map((i) => i.foodId)),
    new Set(shortExpected.keys()),
  );
  assert.deepEqual(
    new Set(longList.toBuy.map((i) => i.foodId)),
    new Set(longExpected.keys()),
  );

  const total = (list) => list.toBuy.reduce((sum, item) => sum + item.grams, 0);
  assert.ok(total(shortList) < total(longList), 'three days should need less food than seven days');

  const shortGrams = new Map(shortList.toBuy.map((i) => [i.foodId, i.grams]));
  for (const [foodId, grams] of shortExpected) {
    assert.ok(Math.abs(shortGrams.get(foodId) - grams) <= 1, `${foodId} grams for three days`);
  }
});

test('already-at-home foods never appear in the to-buy list, at any frequency', () => {
  const built = plan();
  const shortest = shoppingWindow(start, 2);
  const base = buildShoppingList({
    plan: built, recipes, foodsById, fromDate: shortest.from, toDate: shortest.to,
  });
  const sample = base.toBuy[0].foodId;
  for (const every of [2, 3, 5, 7]) {
    const window = shoppingWindow(start, every);
    const list = buildShoppingList({
      plan: built,
      recipes,
      foodsById,
      bought: [sample],
      fromDate: window.from,
      toDate: window.to,
    });
    assert.ok(!list.toBuy.some((i) => i.foodId === sample), `bought food appears at ${every} days`);
    if (list.atHome.some((i) => i.foodId === sample)) {
      assert.ok(!list.toBuy.some((i) => i.foodId === sample));
    }
  }
});

test('a shopping window that has ended rolls forward to the one that contains today', () => {
  assert.equal(currentShopStart('2026-10-21', 7, '2026-10-21'), '2026-10-21');
  assert.equal(currentShopStart('2026-10-21', 7, '2026-10-27'), '2026-10-21');
  assert.equal(currentShopStart('2026-10-21', 7, '2026-10-28'), '2026-10-28');
  assert.equal(currentShopStart('2026-10-21', 3, '2026-11-02'), '2026-11-02');
  assert.equal(currentShopStart('2026-10-21', 3, '2026-11-01'), '2026-10-30');
});

test('window coverage: a window crossing the month end is truncated', () => {
  const coverage = windowCoverage(plan(), shoppingWindow('2026-10-30', 3));
  assert.deepEqual(coverage, {
    lastPlanDate: '2026-10-31',
    coveredDays: 2,
    requestedDays: 3,
    truncated: true,
  });
});

test('window coverage: a window inside the month is not truncated', () => {
  const coverage = windowCoverage(plan(), shoppingWindow('2026-10-21', 7));
  assert.deepEqual(coverage, {
    lastPlanDate: '2026-10-31',
    coveredDays: 7,
    requestedDays: 7,
    truncated: false,
  });
});

test('changing the frequency keeps the saved start, not the rolled-forward one', () => {
  assert.equal(savedShopStart('2026-10-21', '2026-11-05'), '2026-10-21');
  assert.equal(savedShopStart(null, '2026-11-05'), '2026-11-05');
  // The rolled-forward start is only for the current list; it is not saved back.
  assert.equal(currentShopStart('2026-10-21', 7, '2026-11-05'), '2026-11-04');
});

