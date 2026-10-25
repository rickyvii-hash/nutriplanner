import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildPlan, replan, dayTotals, LAST_DAY_REASON,
} from '../src/engine/planner.js';
import {
  NUTRIENT_KEYS, foodNutrients, sumNutrients, formatNutrient,
} from '../src/engine/nutrients.js';
import { profileById } from '../src/engine/profiles.js';
import { dayValueText, dayProgressTotals } from '../src/ui/plan.js';
import { parsePortion } from '../src/ui/log.js';
import {
  CUSTOM_TARGET_DEFAULTS, defaultTargetDaily, nextCustomTarget, parseTargetDaily,
} from '../src/ui/targets.js';
import { shouldShowNav } from '../src/ui/nav.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const month = { year: 2026, month: 10 };

test('plan daily progress: a day with raw apple never shows saturated fat as certain', () => {
  const appleRecipe = recipes.find((r) => r.ingredients.some((i) => i.foodId === 'apple-raw'));
  assert.ok(appleRecipe, 'expected a recipe that uses apple-raw');
  const day = { [appleRecipe.slot]: appleRecipe.id };
  const totals = dayTotals(day, recipesById, foodsById);

  // Apple has no satFat value, so the day total is only a partial sum.
  assert.equal(totals.incomplete.satFat, true);
  assert.equal(totals.unknown.satFat, false);
  const text = dayValueText(totals, 'satFat');
  assert.match(text, /^≥/, `expected a partial-sum marker, got "${text}"`);
  assert.equal(text, formatNutrient(totals, 'satFat', 1));

  // When the only food has no value at all, the screen says "n/a", never a number.
  const appleOnly = sumNutrients([foodNutrients(foodsById.get('apple-raw'), 150)]);
  assert.equal(dayValueText(appleOnly, 'satFat'), 'n/a');
});

test('a target can be shown next to that apple day without claiming a certain value', () => {
  const appleRecipe = recipes.find((r) => r.ingredients.some((i) => i.foodId === 'apple-raw'));
  const totals = dayTotals({ [appleRecipe.slot]: appleRecipe.id }, recipesById, foodsById);
  const satFatTarget = { nutrient: 'satFat', kind: 'max', daily: 13 };
  const text = dayValueText(totals, satFatTarget.nutrient);
  assert.ok(text.startsWith('≥'), `must not print "${text}" as an exact value for a max of ${satFatTarget.daily} g`);
});

test('last planned day: an exceeded maximum says there is nothing left to adjust', () => {
  const targets = profileById('cholesterol').targets;
  const plan = buildPlan(targets, recipes, month, foodsById);
  const lastDate = Object.keys(plan.days).sort().at(-1);
  assert.equal(lastDate, '2026-10-31');

  const result = replan({
    targets,
    recipes,
    plan,
    log: [{
      date: lastDate,
      time: '20:00',
      items: [{ foodId: 'pizza-cheese', grams: 2000 }],
    }],
    bought: [],
    foodsById,
    fromDate: lastDate,
  });

  assert.equal(result.nothingToChange, true);
  assert.equal(result.changed.length, 0);
  assert.equal(result.reason, LAST_DAY_REASON);
  assert.match(result.reason, /last planned day of the month/);
  assert.doesNotMatch(result.reason, /still meets your targets/);
});

test('portion: only a number above 0 and at most 5000 g is accepted', () => {
  for (const bad of ['-50', '0', '', '   ', 'abc', '5001', 'Infinity', null, undefined, -1, 0, 5001]) {
    assert.equal(parsePortion(bad), null, `"${bad}" must be rejected`);
  }
  assert.equal(parsePortion('1'), 1);
  assert.equal(parsePortion('50'), 50);
  assert.equal(parsePortion('5000'), 5000);
  assert.equal(parsePortion(150), 150);
});

test('custom target defaults: every nutrient gets a sensible value above 0', () => {
  const expected = {
    kcal: 2000,
    protein: 70,
    fat: 70,
    satFat: 20,
    carbs: 250,
    fibre: 25,
    sugars: 50,
    sodium: 2300,
  };
  for (const key of NUTRIENT_KEYS) {
    assert.equal(defaultTargetDaily(key), expected[key], key);
    assert.ok(defaultTargetDaily(key) > 0, `${key} default must be above 0`);
  }
  assert.deepEqual(CUSTOM_TARGET_DEFAULTS, expected);
});

test('add custom target: uses the default and never duplicates the eighth nutrient', () => {
  const seven = NUTRIENT_KEYS.slice(0, 7).map((nutrient) => ({ nutrient, kind: 'min', daily: 10 }));
  const next = nextCustomTarget(seven);
  assert.ok(next);
  assert.equal(next.nutrient, NUTRIENT_KEYS[7]);
  assert.equal(next.daily, CUSTOM_TARGET_DEFAULTS[NUTRIENT_KEYS[7]]);
  assert.ok(next.daily > 0);

  const all = NUTRIENT_KEYS.map((nutrient) => ({ nutrient, kind: 'min', daily: 10 }));
  assert.equal(nextCustomTarget(all), null, 'all eight nutrients are used, so no target is added');
});

test('target value: only a number greater than 0 is stored', () => {
  for (const bad of ['', '   ', '0', '-5', 'abc', null, undefined, 0, -1]) {
    assert.equal(parseTargetDaily(bad), null, `"${bad}" must be rejected`);
  }
  assert.equal(parseTargetDaily('25'), 25);
  assert.equal(parseTargetDaily(25), 25);
  assert.equal(parseTargetDaily('2.5'), 2.5);
});

test('bottom navigation: hidden on first use, shown once a plan exists', () => {
  assert.equal(shouldShowNav({ profileId: null, targets: [], plan: null }), false);
  assert.equal(shouldShowNav({ profileId: 'cholesterol', targets: [{ nutrient: 'kcal', kind: 'max', daily: 2000 }], plan: null }), false);
  assert.equal(shouldShowNav(undefined), false);
  assert.equal(shouldShowNav({ plan: { month: '2026-10', days: {} } }), true);
});

test('plan progress: a skipped planned meal is left out of the day values', () => {
  const targets = profileById('cholesterol').targets;
  const plan = buildPlan(targets, recipes, month, foodsById);
  const date = Object.keys(plan.days).sort()[5];
  const day = plan.days[date];
  const full = dayTotals(day, recipesById, foodsById);
  const lunch = recipesById.get(day.lunch);
  assert.ok(lunch, 'the chosen day has a planned lunch');

  const log = [{ date, time: '13:00', skipped: [lunch.id], items: [] }];
  const { result, note } = dayProgressTotals(day, log, recipesById, foodsById);

  // Progress comes from the log only: other planned meals are a plan, not food eaten.
  for (const key of ['kcal', 'protein', 'carbs']) {
    assert.equal(result.totals[key], 0, `${key} must not count uneaten planned meals`);
  }
  assert.ok(full.totals.kcal > 0, 'the plan itself still holds the day');
  assert.match(note, /skipped|logged/i, 'the screen explains that skipped meals are not counted');
});

test('plan progress: a logged meal still wins over the planned values', () => {
  const targets = profileById('cholesterol').targets;
  const plan = buildPlan(targets, recipes, month, foodsById);
  const date = Object.keys(plan.days).sort()[5];
  const log = [{
    date,
    time: '20:00',
    items: [{ foodId: 'pizza-cheese', grams: 200 }],
    skipped: [],
  }];
  const { result, note } = dayProgressTotals(plan.days[date], log, recipesById, foodsById);
  assert.ok(result.totals.kcal > 0);
  assert.match(note, /logged/i);
});
