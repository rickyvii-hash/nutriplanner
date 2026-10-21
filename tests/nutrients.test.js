import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { foodNutrients, sumNutrients, recipeNutrients, formatNutrient } from '../src/engine/nutrients.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));

test('food data: enough foods, unique ids, nulls preserved', () => {
  assert.ok(foods.length >= 200, `only ${foods.length} foods`);
  assert.equal(new Set(foods.map((f) => f.id)).size, foods.length);
  // USDA has no saturated-fat value for raw apple: it must stay null, not 0.
  assert.equal(foodsById.get('apple-raw').per100g.satFat, null);
});

test('foodNutrients scales per 100 g and keeps unknown as null', () => {
  const chicken = foodsById.get('chicken-breast-roasted');
  const n = foodNutrients(chicken, 200);
  assert.ok(Math.abs(n.kcal - 330) < 0.01);
  assert.ok(Math.abs(n.protein - 62.04) < 0.01);
  const apple = foodNutrients(foodsById.get('apple-raw'), 150);
  assert.equal(apple.satFat, null);
});

test('sumNutrients flags incomplete and unknown values, never counts null as zero', () => {
  const r = sumNutrients([
    { kcal: 100, satFat: null },
    { kcal: 50, satFat: 2 },
  ]);
  assert.equal(r.totals.kcal, 150);
  assert.equal(r.incomplete.satFat, true);
  assert.equal(r.unknown.satFat, false);
  assert.equal(r.incomplete.kcal, false);
  const allUnknown = sumNutrients([{ satFat: null }, { satFat: null }]);
  assert.equal(allUnknown.unknown.satFat, true);
  assert.equal(formatNutrient(allUnknown, 'satFat'), 'n/a');
  assert.equal(formatNutrient(r, 'satFat', 1), '≥2.0');
});

test('every recipe ingredient resolves to a food and gives a sensible serving', () => {
  assert.ok(recipes.length >= 20, `only ${recipes.length} recipes`);
  for (const recipe of recipes) {
    const r = recipeNutrients(recipe, foodsById);
    assert.ok(r.totals.kcal > 50 && r.totals.kcal < 1200, `${recipe.id}: ${r.totals.kcal} kcal`);
  }
});

test('recipe total equals the sum of its ingredients (worked example)', () => {
  const recipe = recipes.find((r) => r.id === 'apple-almonds');
  const r = recipeNutrients(recipe, foodsById);
  const apple = foodNutrients(foodsById.get('apple-raw'), 150);
  const almonds = foodNutrients(foodsById.get('almonds'), 20);
  assert.ok(Math.abs(r.totals.kcal - (apple.kcal + almonds.kcal)) < 1e-9);
});

test('recipes cover every meal slot', () => {
  for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
    assert.ok(recipes.filter((r) => r.slot === slot).length >= 5, `few ${slot} recipes`);
  }
});
