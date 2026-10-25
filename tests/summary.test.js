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

test('summary statuses are within, above, below or incomplete', () => {
  assert.equal(targetStatus('max', 2000, 2000), 'Within target');
  assert.equal(targetStatus('max', 2001, 2000), 'Above target');
  assert.equal(targetStatus('min', 100, 100), 'Within target');
  assert.equal(targetStatus('min', 99, 100), 'Below target');
  assert.equal(targetStatus('min', null, 100), 'Incomplete data');
  // Partial averages (a nutrient value is missing) never get a certain status.
  assert.equal(targetStatus('max', 2000, 2000, true), 'Incomplete data');
  assert.equal(targetStatus('max', 2001, 2000, true), 'Incomplete data');
  assert.equal(targetStatus('min', 100, 100, true), 'Incomplete data');
  assert.equal(targetStatus('min', 99, 100, true), 'Incomplete data');
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
    // Planned food is not eaten food: with nothing logged no target status is claimed.
    assert.equal(row.status, 'Not logged yet', `${target.nutrient} status`);
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

test('a log entry outside the plan month is ignored by averages and by the meal list', () => {
  const profile = profileById('cholesterol');
  const plan = buildPlan(profile.targets, recipes, month, foodsById);
  const log = [
    {
      date: '2026-10-21',
      time: '20:00',
      items: [
        { foodId: 'pizza-cheese', grams: 350 },
        { foodId: 'ice-cream-vanilla', grams: 100 },
      ],
    },
    {
      date: '2026-11-05',
      time: '12:00',
      items: [{ foodId: 'apple-raw', grams: 200 }],
    },
  ];
  const summary = buildSummary({
    targets: profile.targets,
    plan,
    log,
    recipesById,
    foodsById,
  });

  assert.equal(summary.source, 'log');
  assert.deepEqual(summary.period, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(summary.days, 1);
  assert.equal(summary.loggedDays, 1);
  assert.equal(summary.meals.length, 1);
  assert.ok(!summary.meals[0].items.some((i) => i.name === 'Apple, raw'), 'outside meal listed');

  const combined = sumNutrients([
    foodNutrients(foodsById.get('pizza-cheese'), 350),
    foodNutrients(foodsById.get('ice-cream-vanilla'), 100),
  ]);
  for (const target of profile.targets) {
    const row = summary.rows.find((r) => r.nutrient === target.nutrient);
    assert.ok(Math.abs(row.average - combined.totals[target.nutrient]) < 1e-9, `${target.nutrient} average`);
  }
  assert.equal(summary.incomplete.satFat, false, 'the outside apple must not make satFat incomplete');
});

test('incomplete averages are never shown as certain target statuses', () => {
  const allMissing = buildSummary({
    targets: [{ nutrient: 'satFat', kind: 'max', daily: 13 }],
    plan: null,
    log: [{ date: '2026-10-21', time: '09:00', items: [{ foodId: 'apple-raw', grams: 150 }] }],
    recipesById,
    foodsById,
  }).rows[0];
  assert.equal(allMissing.average, null);
  assert.equal(allMissing.status, 'Incomplete data');

  // Apple has satFat null, coconut milk has a known value: partial average 18.915 g.
  const maxAbove = buildSummary({
    targets: [{ nutrient: 'satFat', kind: 'max', daily: 13 }],
    plan: null,
    log: [{
      date: '2026-10-21',
      time: '09:00',
      items: [
        { foodId: 'apple-raw', grams: 150 },
        { foodId: 'coconut-milk-canned', grams: 100 },
      ],
    }],
    recipesById,
    foodsById,
  }).rows[0];
  assert.equal(maxAbove.incomplete, true);
  // Even when the partial value already passes the maximum, a missing value means no certain status.
  assert.equal(maxAbove.status, 'Incomplete data');

  const maxUncertain = buildSummary({
    targets: [{ nutrient: 'satFat', kind: 'max', daily: 13 }],
    plan: null,
    log: [{
      date: '2026-10-21',
      time: '09:00',
      items: [
        { foodId: 'apple-raw', grams: 150 },
        { foodId: 'coconut-milk-canned', grams: 50 },
      ],
    }],
    recipesById,
    foodsById,
  }).rows[0];
  assert.equal(maxUncertain.status, 'Incomplete data');

  // Apple has fibre 3.6 g; balsamic vinegar has fibre null.
  const minWithin = buildSummary({
    targets: [{ nutrient: 'fibre', kind: 'min', daily: 3 }],
    plan: null,
    log: [{
      date: '2026-10-21',
      time: '09:00',
      items: [
        { foodId: 'apple-raw', grams: 150 },
        { foodId: 'balsamic-vinegar', grams: 10 },
      ],
    }],
    recipesById,
    foodsById,
  }).rows[0];
  assert.equal(minWithin.incomplete, true);
  assert.equal(minWithin.status, 'Incomplete data');

  const minUncertain = buildSummary({
    targets: [{ nutrient: 'fibre', kind: 'min', daily: 30 }],
    plan: null,
    log: [{
      date: '2026-10-21',
      time: '09:00',
      items: [
        { foodId: 'apple-raw', grams: 150 },
        { foodId: 'balsamic-vinegar', grams: 10 },
      ],
    }],
    recipesById,
    foodsById,
  }).rows[0];
  assert.equal(minUncertain.status, 'Incomplete data');
});

test('with no plan the period runs from the first to the last logged date', () => {
  const summary = buildSummary({
    targets: [{ nutrient: 'protein', kind: 'min', daily: 50 }],
    plan: null,
    log: [
      { date: '2026-10-25', time: '12:00', items: [{ foodId: 'apple-raw', grams: 150 }] },
      { date: '2026-10-21', time: '12:00', items: [{ foodId: 'apple-raw', grams: 150 }] },
    ],
    recipesById,
    foodsById,
  });

  assert.deepEqual(summary.period, { from: '2026-10-21', to: '2026-10-25' });
  assert.equal(summary.days, 2);
  assert.equal(summary.loggedDays, 2);
});

test('skipped meals appear as Skipped and do not change summary averages', () => {
  const profile = profileById('recovery');
  const plan = buildPlan(profile.targets, recipes, month, foodsById);
  const lunchId = plan.days['2026-10-21'].lunch;
  const pizzaLog = {
    date: '2026-10-21',
    time: '20:00',
    items: [
      { foodId: 'pizza-cheese', grams: 350 },
      { foodId: 'ice-cream-vanilla', grams: 100 },
    ],
  };
  const skipLog = {
    date: '2026-10-21',
    time: '13:00',
    skipped: [lunchId],
  };
  const withSkip = buildSummary({
    targets: profile.targets,
    plan,
    log: [pizzaLog, skipLog],
    recipesById,
    foodsById,
  });
  const pizzaOnly = buildSummary({
    targets: profile.targets,
    plan,
    log: [pizzaLog],
    recipesById,
    foodsById,
  });

  assert.equal(withSkip.source, 'log');
  assert.equal(withSkip.days, pizzaOnly.days);
  for (const row of withSkip.rows) {
    const other = pizzaOnly.rows.find((r) => r.nutrient === row.nutrient);
    assert.equal(row.average, other.average, `${row.nutrient} average must ignore the skip`);
  }
  const skippedMeal = withSkip.meals.find((m) => m.skipped);
  assert.ok(skippedMeal, 'skipped entry must appear in the meal list');
  assert.ok(skippedMeal.items.every((i) => i.skipped));
  assert.ok(skippedMeal.items.some((i) => i.name === recipesById.get(lunchId).name));
});

test('plan averages with a recipe that has a missing nutrient are marked incomplete, not certain', () => {
  // "Nut and dried fruit mix" has no saturated-fat value in the USDA data for one of its foods.
  const days = {};
  for (let d = 1; d <= 3; d += 1) {
    days[`2026-10-0${d}`] = {
      breakfast: 'greek-yogurt-bowl',
      lunch: 'lentil-salad-feta',
      dinner: 'salmon-quinoa-greens',
      snack: 'nut-and-fruit-mix',
    };
  }
  const targets = [{ nutrient: 'satFat', kind: 'max', daily: 13 }];
  const summary = buildSummary({ targets, plan: { month: '2026-10', days }, log: [], recipesById, foodsById });
  const row = summary.rows.find((r) => r.nutrient === 'satFat');
  assert.equal(row.incomplete, true, 'the missing value must be flagged');
  assert.equal(row.status, 'Not logged yet', 'planned averages never claim a target status');
});
