/**
 * P1: day progress must come from the log, never from uneaten planned meals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, dayTotals } from '../src/engine/planner.js';
import { profileById, PROFILES } from '../src/engine/profiles.js';
import { dayProgressTotals } from '../src/ui/plan.js';
import { foodNutrients, sumNutrients } from '../src/engine/nutrients.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

const DAY = '2026-10-15';

function planFor(profileId) {
  const targets = profileById(profileId).targets;
  return buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);
}

test('P1 progress: empty log → zeros for all four profiles (planned meals not counted)', () => {
  for (const p of PROFILES) {
    const plan = planFor(p.id);
    const meals = plan.days[DAY];
    const planned = dayTotals(meals, recipesById, foodsById);
    assert.ok(planned.totals.kcal > 0, `${p.id}: plan has energy`);

    const { result, note } = dayProgressTotals(meals, [], recipesById, foodsById);
    for (const [k, v] of Object.entries(result.totals)) {
      assert.equal(v, 0, `${p.id}: ${k} must be 0 with an empty log`);
    }
    assert.match(String(note), /log|logged|nothing|not counted|planned/i);
    assert.doesNotMatch(String(note), /Based on planned meals \(nothing logged yet\)/i);
  }
});

test('P1 progress: one eaten meal counts only that food', () => {
  for (const p of PROFILES) {
    const plan = planFor(p.id);
    const meals = plan.days[DAY];
    const lunchId = meals.lunch;
    const lunch = recipesById.get(lunchId);
    const log = [{
      date: DAY,
      time: '13:00',
      items: lunch.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
      eaten: [{ recipeId: lunchId, slot: 'lunch' }],
    }];
    const { result } = dayProgressTotals(meals, log, recipesById, foodsById);
    const expected = sumNutrients(
      lunch.ingredients.map((i) => foodNutrients(foodsById.get(i.foodId), i.grams)),
    );
    assert.ok(Math.abs(result.totals.kcal - expected.totals.kcal) < 1e-6, `${p.id}: kcal`);
    const full = dayTotals(meals, recipesById, foodsById).totals.kcal;
    assert.ok(result.totals.kcal < full - 1, `${p.id}: must not equal the full planned day`);
  }
});

test('P1 progress: skipped-only log → zeros (skip is not eaten)', () => {
  for (const p of PROFILES) {
    const plan = planFor(p.id);
    const meals = plan.days[DAY];
    const log = [{
      date: DAY,
      time: '13:00',
      skipped: [meals.lunch],
      skippedSlots: [{ recipeId: meals.lunch, slot: 'lunch' }],
      items: [],
    }];
    const { result } = dayProgressTotals(meals, log, recipesById, foodsById);
    assert.equal(result.totals.kcal, 0, `${p.id}: skip-only day has no eaten energy`);
  }
});

test('P1 progress: extra-only log counts the extra food', () => {
  for (const p of PROFILES) {
    const plan = planFor(p.id);
    const meals = plan.days[DAY];
    const log = [{
      date: DAY,
      time: '16:00',
      items: [{ foodId: 'pizza-cheese', grams: 100 }],
      extra: true,
    }];
    const { result } = dayProgressTotals(meals, log, recipesById, foodsById);
    const expected = foodNutrients(foodsById.get('pizza-cheese'), 100);
    assert.ok(Math.abs(result.totals.kcal - expected.kcal) < 1e-6, `${p.id}: extra kcal`);
  }
});
