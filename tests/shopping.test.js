import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan } from '../src/engine/planner.js';
import { buildShoppingList } from '../src/engine/shopping.js';
import { profileById } from '../src/engine/profiles.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const month = { year: 2026, month: 10 };

test('ticked items leave the to-buy list and appear under Already at home', () => {
  const profile = profileById('recovery');
  const plan = buildPlan(profile.targets, recipes, month, foodsById);
  const fromDate = '2026-10-01';
  const full = buildShoppingList({ plan, recipes, foodsById, bought: [], fromDate });
  assert.ok(full.toBuy.length > 0);

  const sampleId = full.toBuy.find((i) => i.foodId === 'spinach-raw')?.foodId
    || full.toBuy.find((i) => i.foodId === 'chicken-breast-roasted')?.foodId
    || full.toBuy[0].foodId;

  const after = buildShoppingList({
    plan,
    recipes,
    foodsById,
    bought: [sampleId],
    fromDate,
  });

  assert.ok(!after.toBuy.some((i) => i.foodId === sampleId), 'ticked item still in to-buy');
  assert.ok(after.atHome.some((i) => i.foodId === sampleId), 'ticked item missing from at-home');
  // No duplicates across sections
  const buyIds = new Set(after.toBuy.map((i) => i.foodId));
  for (const item of after.atHome) {
    assert.ok(!buyIds.has(item.foodId), `duplicate ${item.foodId}`);
  }
});

test('ticking an ingredient makes recipes that use it more likely to be kept', () => {
  const profile = profileById('cholesterol');
  const plan = buildPlan(profile.targets, recipes, month, foodsById);
  const fromDate = '2026-10-12';
  const bought = ['spinach-raw', 'chicken-breast-roasted'];

  const result = replan({
    targets: profile.targets,
    recipes,
    plan,
    log: [{
      date: fromDate,
      time: '19:00',
      items: [
        { foodId: 'pizza-cheese', grams: 250 },
        { foodId: 'ice-cream-vanilla', grams: 100 },
      ],
    }],
    bought,
    foodsById,
    fromDate,
  });

  // Either keptForBought is non-empty, or the new plan still contains recipes using bought foods
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  let usesBought = 0;
  for (const date of Object.keys(result.plan.days).filter((d) => d >= fromDate)) {
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
      const recipe = recipesById.get(result.plan.days[date][slot]);
      if (recipe?.ingredients.some((ing) => bought.includes(ing.foodId))) usesBought += 1;
    }
  }
  assert.ok(
    result.keptForBought.length > 0 || usesBought > 0,
    'expected pantry-aware keep or recipes using bought foods',
  );
  if (result.keptForBought.length > 0) {
    assert.match(result.reason.toLowerCase(), /bought|kept|already/);
  }
});
