import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan } from '../src/engine/planner.js';
import { foodNutrients, sumNutrients } from '../src/engine/nutrients.js';
import { buildSummary, targetStatus } from '../src/engine/summary.js';
import { profileById } from '../src/engine/profiles.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const month = { year: 2026, month: 10 };

const CERTAIN = ['Within target', 'Above target', 'Below target'];

test('D11: with zero logged days no row claims a target status and the header says planned', () => {
  const profile = profileById('cholesterol');
  const plan = buildPlan(profile.targets, recipes, month, foodsById);
  const summary = buildSummary({
    targets: profile.targets,
    plan,
    log: [],
    recipesById,
    foodsById,
  });

  assert.equal(summary.loggedDays, 0);
  assert.equal(summary.source, 'plan');
  // The document must never present planned food as eaten.
  assert.equal(summary.averageLabel, 'Planned average per day (not eaten)');
  assert.equal(summary.averagesNote, null, 'there are no logged days to count');
  assert.equal(summary.rows.length, profile.targets.length);
  for (const row of summary.rows) {
    assert.equal(row.status, 'Not logged yet', row.nutrient + ' must not claim a target status');
    assert.ok(!CERTAIN.includes(row.status), row.nutrient + ' shows "' + row.status + '" with nothing logged');
    assert.equal(typeof row.average, 'number', row.nutrient + ' planned average is still shown');
  }
});

test('D11: one logged day uses only logged meals, never the planned days as zero intake', () => {
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
  assert.equal(summary.loggedDays, 1);
  assert.equal(summary.days, 1, 'days with nothing logged must not count as zero intake');
  assert.equal(summary.averageLabel, 'Average per day');
  assert.equal(summary.averagesNote, 'Averages are over the 1 day with logged meals.');

  const combined = sumNutrients([
    foodNutrients(foodsById.get('pizza-cheese'), 350),
    foodNutrients(foodsById.get('ice-cream-vanilla'), 100),
  ]);
  for (const target of profile.targets) {
    const row = summary.rows.find((r) => r.nutrient === target.nutrient);
    assert.ok(Math.abs(row.average - combined.totals[target.nutrient]) < 1e-9, target.nutrient + ' logged average');
    assert.equal(row.status, targetStatus(target.kind, combined.totals[target.nutrient], target.daily, row.incomplete));
  }
  assert.equal(summary.rows.find((r) => r.nutrient === 'satFat').status, 'Above target');
  assert.equal(summary.rows.find((r) => r.nutrient === 'fibre').status, 'Below target');
});

test('D11: the count line says day(s) and the average uses only the logged dates', () => {
  const summary = buildSummary({
    targets: [{ nutrient: 'protein', kind: 'min', daily: 50 }],
    plan: null,
    log: [
      { date: '2026-10-21', time: '12:00', items: [{ foodId: 'apple-raw', grams: 150 }] },
      { date: '2026-10-22', time: '12:00', items: [{ foodId: 'apple-raw', grams: 150 }] },
    ],
    recipesById,
    foodsById,
  });

  assert.equal(summary.days, 2);
  assert.equal(summary.loggedDays, 2);
  assert.equal(summary.averagesNote, 'Averages are over the 2 days with logged meals.');
});

test('D11: a partially logged day keeps the Incomplete data wording for missing nutrients', () => {
  const summary = buildSummary({
    targets: [
      { nutrient: 'satFat', kind: 'max', daily: 13 },
      { nutrient: 'fibre', kind: 'min', daily: 3 },
    ],
    plan: null,
    log: [{ date: '2026-10-21', time: '08:00', items: [{ foodId: 'apple-raw', grams: 150 }] }],
    recipesById,
    foodsById,
  });

  const satFat = summary.rows.find((r) => r.nutrient === 'satFat');
  assert.equal(satFat.incomplete, true, 'apple has no saturated-fat value');
  assert.equal(satFat.status, 'Incomplete data');

  const fibre = summary.rows.find((r) => r.nutrient === 'fibre');
  assert.equal(fibre.incomplete, false);
  assert.equal(fibre.status, 'Within target');
  assert.equal(summary.averagesNote, 'Averages are over the 1 day with logged meals.');
});

test('D11: a day with nothing logged never counts as zero intake even inside the plan period', () => {
  const profile = profileById('cholesterol');
  const plan = buildPlan(profile.targets, recipes, month, foodsById);
  const summary = buildSummary({
    targets: [{ nutrient: 'protein', kind: 'min', daily: 50 }],
    plan,
    log: [{ date: '2026-10-21', time: '12:00', items: [{ foodId: 'apple-raw', grams: 150 }] }],
    recipesById,
    foodsById,
  });

  assert.equal(summary.days, 1);
  assert.equal(summary.loggedDays, 1);
  const protein = summary.rows.find((r) => r.nutrient === 'protein');
  const appleProtein = foodNutrients(foodsById.get('apple-raw'), 150).protein;
  assert.ok(Math.abs(protein.average - appleProtein) < 1e-9, 'unlogged planned days must not lower the average');
});
