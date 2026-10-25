/**
 * D23: the month plan must say so when it does not reach the daily targets.
 * The check describes the planned average from today on, never a single day, and
 * keeps the summary's partial-data rule: an unknown nutrient is "can't tell",
 * never a certain result and never zero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlan, rebuildPlanMeals } from '../src/engine/planner.js';
import { PROFILES } from '../src/engine/profiles.js';
import { planReachGaps, PLAN_REACH_TITLE, PLAN_REACH_HINT } from '../src/engine/plan_check.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const MONTH = { year: 2026, month: 10 };
const TODAY = '2026-10-25';

/** One known food and one recipe of 100 g of it: 100 kcal, small values elsewhere. */
function tinyKitchen(kcal = 100) {
  const food = {
    id: 'f1',
    name: 'Test food',
    per100g: {
      kcal, protein: 10, fat: 10, satFat: 1, carbs: 10, fibre: 2, sugars: 1, sodium: 10,
    },
  };
  const recipe = { id: 'r1', name: 'Test recipe', ingredients: [{ foodId: 'f1', grams: 100 }] };
  return {
    foodsById: new Map([['f1', food]]),
    recipesById: new Map([['r1', recipe]]),
  };
}

test('helper: a minimum the plan stays under is reported with the planned average', () => {
  const kitchen = tinyKitchen(100);
  const plan = { days: { '2026-10-25': { dinner: 'r1' }, '2026-10-26': { dinner: 'r1' } } };
  const check = planReachGaps({
    plan,
    targets: [{ nutrient: 'kcal', kind: 'min', daily: 500 }],
    today: TODAY,
    ...kitchen,
  });
  assert.equal(check.days, 2);
  assert.equal(check.gaps.length, 1);
  assert.equal(check.gaps[0].nutrient, 'kcal');
  assert.equal(check.gaps[0].kind, 'min');
  assert.equal(check.gaps[0].average, 100);
  assert.equal(check.gaps[0].text, 'Calories: about 100 kcal a day against a minimum of 500.');
});

test('helper: a maximum the plan goes over is reported too', () => {
  const kitchen = tinyKitchen(3000);
  const plan = { days: { '2026-10-25': { dinner: 'r1' } } };
  const check = planReachGaps({
    plan,
    targets: [{ nutrient: 'kcal', kind: 'max', daily: 2000 }],
    today: TODAY,
    ...kitchen,
  });
  assert.equal(check.gaps.length, 1);
  assert.equal(check.gaps[0].kind, 'max');
  assert.equal(check.gaps[0].text, 'Calories: about 3000 kcal a day against a maximum of 2000.');
});

test('helper: a reached target is not reported; only planned days from today on count', () => {
  const kitchen = tinyKitchen(1000);
  const plan = {
    days: {
      '2026-10-01': { dinner: 'r1' }, // past: never counted
      '2026-10-25': { dinner: 'r1' },
      '2026-10-26': { dinner: 'r1' },
    },
  };
  const check = planReachGaps({
    plan,
    targets: [{ nutrient: 'kcal', kind: 'min', daily: 900 }],
    today: TODAY,
    ...kitchen,
  });
  assert.equal(check.days, 2);
  assert.deepEqual(check.gaps, []);
  assert.equal(check.reached, true);
});

test("helper: unknown nutrient values are \"can't tell\", never a certain result", () => {
  const kitchen = tinyKitchen(null);
  const plan = { days: { '2026-10-25': { dinner: 'r1' } } };
  const check = planReachGaps({
    plan,
    targets: [{ nutrient: 'kcal', kind: 'min', daily: 2200 }],
    today: TODAY,
    ...kitchen,
  });
  assert.equal(check.gaps.length, 1);
  assert.equal(check.gaps[0].average, null);
  assert.equal(check.gaps[0].unknown, true);
  assert.match(check.gaps[0].text, /^Calories: can't tell/);
  assert.doesNotMatch(check.gaps[0].text, /about 0/);
});

test('a plan with no day from today on reports nothing', () => {
  const kitchen = tinyKitchen(100);
  const check = planReachGaps({
    plan: { days: { '2026-10-01': { dinner: 'r1' } } },
    targets: [{ nutrient: 'kcal', kind: 'min', daily: 2200 }],
    today: TODAY,
    ...kitchen,
  });
  assert.equal(check.days, 0);
  assert.deepEqual(check.gaps, []);
  assert.equal(check.reached, true);
});

test('Recovery with lunch and dinner only: the plan misses calories and says so', () => {
  const recovery = PROFILES.find((p) => p.id === 'recovery');
  const plan = buildPlan(recovery.targets, recipes, MONTH, foodsById, [], {
    mealPrefs: { breakfast: false, lunch: true, dinner: true, snacks: 0 },
  });
  const check = planReachGaps({
    plan, targets: recovery.targets, recipesById, foodsById, today: TODAY,
  });
  const kcal = check.gaps.find((g) => g.nutrient === 'kcal');
  assert.ok(kcal, 'calories must be reported as not reached');
  assert.equal(kcal.kind, 'min');
  assert.equal(kcal.daily, 2200);
  // The average is over the planned days from today on, so it comes from real numbers.
  assert.equal(kcal.text, 'Calories: about 1728 kcal a day against a minimum of 2200.');
  assert.equal(PLAN_REACH_TITLE, 'This plan does not reach every target.');
  assert.match(PLAN_REACH_HINT, /snack in My meals/);
});

test('the default four-meal plans reach every target', () => {
  for (const id of ['recovery', 'cholesterol', 'weight-loss', 'athlete']) {
    const profile = PROFILES.find((p) => p.id === id);
    const plan = buildPlan(profile.targets, recipes, MONTH, foodsById);
    const check = planReachGaps({
      plan, targets: profile.targets, recipesById, foodsById, today: TODAY,
    });
    assert.equal(check.reached, true, `${id}: no gap`);
    assert.deepEqual(check.gaps, [], `${id}: no note`);
  }
});

test('turning breakfast back on and rebuilding clears the note', () => {
  const recovery = PROFILES.find((p) => p.id === 'recovery');
  const twoMeals = buildPlan(recovery.targets, recipes, MONTH, foodsById, [], {
    mealPrefs: { breakfast: false, lunch: true, dinner: true, snacks: 0 },
  });
  assert.equal(planReachGaps({
    plan: twoMeals, targets: recovery.targets, recipesById, foodsById, today: TODAY,
  }).reached, false);

  const rebuilt = rebuildPlanMeals(twoMeals, recovery.targets, recipes, foodsById, {
    breakfast: true, lunch: true, dinner: true, snacks: 1,
  }, TODAY);
  const check = planReachGaps({
    plan: rebuilt, targets: recovery.targets, recipesById, foodsById, today: TODAY,
  });
  console.log('REBUILD', JSON.stringify(check.gaps));
  assert.equal(check.reached, true);
});

const read = (file) => fs.readFileSync(path.join(root, 'src', 'ui', file), 'utf8');

test('the day screen shows the calm note card under the header and links to Targets', () => {
  const src = read('plan.js');
  assert.match(src, /from '\.\.\/engine\/plan_check\.js'/, 'plan.js must import the plan check');
  assert.match(src, /planReachCard\(/, 'plan.js must build the note card');
  assert.match(src, /PLAN_REACH_TITLE/, 'plan.js must show the shared title');
  assert.match(src, /Open Targets/);
  // The card is appended before the day strip.
  assert.ok(src.indexOf('planReachCard(') < src.indexOf('day-strip-wrap'));
});

test('the Targets screen shows the same compact note next to My meals', () => {
  const src = read('targets.js');
  assert.match(src, /from '\.\/plan\.js'/, 'targets.js must reuse the note card');
  assert.match(src, /planReachCard\(/, 'targets.js must build the compact note');
  assert.ok(src.indexOf('planReachCard(') > src.indexOf('mealsCard'), 'note sits after My meals');
  assert.ok(src.indexOf('planReachCard(') < src.indexOf('root.appendChild(list)'), 'note sits above the target rows');
});
