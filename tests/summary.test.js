import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, dayTotals } from '../src/engine/planner.js';
import { foodNutrients, sumNutrients } from '../src/engine/nutrients.js';
import { buildSummary, targetStatus } from '../src/engine/summary.js';
import { profileById } from '../src/engine/profiles.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const month = { year: 2026, month: 10 };

test('summary statuses are only within, above or below target', () => {
  assert.equal(targetStatus('max', 2000, 2000), 'Within target');
  assert.equal(targetStatus('max', 2001, 2000), 'Above target');
  assert.equal(targetStatus('min', 100, 100), 'Within target');
  assert.equal(targetStatus('min', 99, 100), 'Below target');
  assert.equal(targetStatus('min', null, 100), 'n/a');
});

test('with nothing logged the summary uses plan averages and says so', () => {
  const profile = profileById('cholesterol');
  const plan = buildPlan(profile.targets, recipes, month, foodsById);
  const summary = buildSummary({
    targets: profile.targets,
    plan,
    log: [],
    recipesById,
    foodsById,
  });

  assert.equal(summary.source, 'plan');
  assert.equal(summary.days, 31);
  assert.deepEqual(summary.period, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(summary.meals.length, 0);

  for (const target of profile.targets) {
    let sum = 0;
    for (const date of Object.keys(plan.days)) {
      sum += dayTotals(plan.days[date], recipesById, foodsById).totals[target.nutrient];
    }
    const expected = sum / Object.keys(plan.days).length;
    const row = summary.rows.find((r) => r.nutrient === target.nutrient);
    assert.ok(Math.abs(row.average - expected) < 1e-9, `${target.nutrient} average`);
    assert.equal(row.status, targetStatus(target.kind, expected, target.daily));
  }
});

test('after pizza and ice cream the summary shows logged averages, foods and grams', () => {
  const profile = profileById('cholesterol');
  const plan = buildPlan(profile.targets, recipes, month, foodsById);
  const log = [{
    date: '2026-10-21',
    time: '20:00',
    items: [
      { foodId: 'pizza-cheese', grams: 350 },
      { foodId: 'ice-cream-vanilla', grams: 100 },
    ],
  }];
  const summary = buildSummary({
    targets: profile.targets,
    plan,
    log,
    recipesById,
    foodsById,
  });

  assert.equal(summary.source, 'log');
  assert.equal(summary.days, 1);

  const combined = sumNutrients([
    foodNutrients(foodsById.get('pizza-cheese'), 350),
    foodNutrients(foodsById.get('ice-cream-vanilla'), 100),
  ]);
  const logged = combined.totals;
  for (const target of profile.targets) {
    const row = summary.rows.find((r) => r.nutrient === target.nutrient);
    assert.ok(Math.abs(row.average - logged[target.nutrient]) < 1e-9, `${target.nutrient} logged average`);
    assert.equal(row.status, targetStatus(target.kind, logged[target.nutrient], target.daily));
  }
  assert.equal(summary.rows.find((r) => r.nutrient === 'satFat').status, 'Above target');
  assert.equal(summary.rows.find((r) => r.nutrient === 'fibre').status, 'Below target');

  const items = summary.meals[0].items;
  assert.ok(items.some((i) => i.name === 'Pizza, cheese' && i.grams === 350), 'pizza with grams');
  assert.ok(items.some((i) => i.name === 'Ice cream, vanilla' && i.grams === 100), 'ice cream with grams');
});
