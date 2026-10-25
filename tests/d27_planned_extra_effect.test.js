/**
 * D27 (P1, honesty): the Plan updated screen for a planned outside-the-menu
 * meal must compare whole day totals. The "after" side is the changed planned
 * meals PLUS the planned extra, so the day never looks lighter than it will be.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import { buildPlan, replan, dayTotals, effectChange } from '../src/engine/planner.js';
import { recomputeShownPlan } from '../src/engine/plan_from_log.js';
import { loggedNutrients } from '../src/engine/nutrients.js';
import { makePlannedExtra } from '../src/engine/planned_extras.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

const MONTH = { year: 2026, month: 10 };
const TODAY = '2026-10-24';
const PLANNED_DAY = '2026-10-28';
const PIZZA = 'pizza-cheese';
const ICE_CREAM = 'ice-cream-vanilla';

const targetsFor = (id) => profileById(id).targets;
const basePlanFor = (id) => buildPlan(targetsFor(id), recipes, MONTH, foodsById);

function plannedFood(date, items, id, time = '20:00') {
  return makePlannedExtra({ id, date, time, items });
}

function plannedDinner(date = PLANNED_DAY, grams = 350, id = 'planned-' + date) {
  return plannedFood(date, [{ foodId: PIZZA, grams }], id);
}

function baseRun(profileId, plannedExtras, log = []) {
  return replan({
    targets: targetsFor(profileId),
    recipes,
    plan: basePlanFor(profileId),
    log,
    bought: [],
    foodsById,
    fromDate: TODAY,
    plannedExtras,
  });
}

function effectOf(result, nutrient) {
  return result.effects.find((e) => e.nutrient === nutrient);
}

function decimalsFor(nutrient) {
  return nutrient === 'kcal' || nutrient === 'sodium' ? 0 : 1;
}

/** The number the Effect row prints for an average. */
function shown(nutrient, value) {
  return Number(Number(value || 0).toFixed(decimalsFor(nutrient)));
}

function unitFor(nutrient) {
  if (nutrient === 'kcal') return 'kcal';
  if (nutrient === 'sodium') return 'mg';
  return 'g';
}

function extrasTotals(extras) {
  const totals = {};
  for (const extra of extras) {
    const r = loggedNutrients(extra.items, foodsById).totals;
    for (const [k, v] of Object.entries(r)) totals[k] = (totals[k] || 0) + v;
  }
  return totals;
}

// --- 1) The example: after = changed planned meals + the planned pizza ------

test('D27 example: the effect rows count the planned pizza in the day total', () => {
  const id = 'cholesterol';
  const plan = basePlanFor(id);
  const extra = plannedDinner();
  const extraTotals = loggedNutrients(extra.items, foodsById).totals;
  const result = baseRun(id, [extra]);

  assert.ok(result.changed.length > 0, result.reason);
  for (const change of result.changed) {
    assert.equal(change.date, PLANNED_DAY, 'only the planned day may change');
  }

  const before = dayTotals(plan.days[PLANNED_DAY], recipesById, foodsById).totals;
  const afterMeals = dayTotals(result.plan.days[PLANNED_DAY], recipesById, foodsById).totals;
  for (const t of targetsFor(id)) {
    const effect = effectOf(result, t.nutrient);
    assert.equal(shown(t.nutrient, effect.before), shown(t.nutrient, before[t.nutrient]),
      'before is the planned meals of the day: ' + t.nutrient);
    // The "after" side is the changed planned meals PLUS what was planned outside the menu.
    assert.equal(shown(t.nutrient, effect.after),
      shown(t.nutrient, (afterMeals[t.nutrient] || 0) + (extraTotals[t.nutrient] || 0)),
      'after includes the planned extra: ' + t.nutrient);
  }

  const satFat = effectOf(result, 'satFat');
  console.log('D27 EXAMPLE REASON:', result.reason);
  console.log('D27 EXAMPLE EFFECTS:', JSON.stringify(result.effects.map((e) => ({
    n: e.nutrient, before: e.before, after: e.after, status: e.status,
  }))));
  assert.ok(satFat.after > shown('satFat', afterMeals.satFat) + 1,
    'the pizza saturated fat is in the after value, not only in the reason');
  assert.ok(Math.abs(satFat.after - (afterMeals.satFat + extraTotals.satFat)) < 1e-6);
  assert.match(result.reason, /^You planned /);
  assert.ok(result.reason.includes(PLANNED_DAY), result.reason);
  assert.ok(result.reason.includes('to leave room'), result.reason);
});

// --- 2) A planned extra the day cannot make room for -----------------------

test('D27 no room: the reason says the day still goes over, by the real amount', () => {
  const id = 'cholesterol';
  const extra = plannedDinner(PLANNED_DAY, 900, 'planned-huge');
  const result = baseRun(id, [extra]);

  const satFat = effectOf(result, 'satFat');
  const goal = satFat.daily;
  assert.ok(satFat.after > goal, 'this case really goes over the maximum');

  assert.match(result.reason, /still goes over your goal by about [\d.]+ g/);
  assert.ok(!/stays within your goal/.test(result.reason), result.reason);

  const quoted = result.reason.match(/still goes over your goal by about ([\d.]+) (kcal|mg|g)/);
  assert.ok(quoted, result.reason);
  assert.equal(quoted[2], 'g');
  // The number is exactly the difference between the two values the Effect row prints.
  assert.equal(Number(quoted[1]),
    Number((shown('satFat', satFat.after) - shown('satFat', goal)).toFixed(1)));
  assert.equal(satFat.status, 'Higher over the next days');

  // The day total after is still the whole day, extra included.
  const afterMeals = dayTotals(result.plan.days[PLANNED_DAY], recipesById, foodsById).totals;
  assert.ok(satFat.after > afterMeals.satFat + 1);
});

// --- 3) A planned extra the day can make room for --------------------------

test('D27 within goal: the reason says the day stays within the goal', () => {
  const id = 'cholesterol';
  const extra = plannedDinner(PLANNED_DAY, 150, 'planned-small');
  const result = baseRun(id, [extra]);

  const satFat = effectOf(result, 'satFat');
  assert.ok(satFat.after <= satFat.daily, 'the made room day stays under the maximum: ' + satFat.after);
  assert.match(result.reason, /stays within your goal/);
  assert.ok(!/still goes over/.test(result.reason), result.reason);
  assert.equal(satFat.status, 'Within target');
  assert.ok(result.reason.includes('lighter in saturated fat'), result.reason);
});

// --- 4) Two planned extras on the same day ---------------------------------

test('D27 two planned extras on one day are both counted', () => {
  const id = 'cholesterol';
  const plan = basePlanFor(id);
  const first = plannedFood(PLANNED_DAY, [{ foodId: PIZZA, grams: 120 }], 'planned-a', '19:00');
  const second = plannedFood(PLANNED_DAY, [{ foodId: ICE_CREAM, grams: 120 }], 'planned-b', '21:00');
  const result = baseRun(id, [first, second]);

  assert.ok(result.changed.length > 0, result.reason);
  const before = dayTotals(plan.days[PLANNED_DAY], recipesById, foodsById).totals;
  const afterMeals = dayTotals(result.plan.days[PLANNED_DAY], recipesById, foodsById).totals;
  const extraTotals = extrasTotals([first, second]);
  assert.ok(extraTotals.kcal > 0);

  const kcal = effectOf(result, 'kcal');
  assert.equal(shown('kcal', kcal.before), shown('kcal', before.kcal));
  assert.equal(shown('kcal', kcal.after), shown('kcal', afterMeals.kcal + extraTotals.kcal),
    'both planned extras are in the after day total');

  // The reason names both planned foods.
  assert.ok(result.reason.includes('Pizza, cheese'), result.reason);
  assert.ok(result.reason.includes('Ice cream, vanilla'), result.reason);
  assert.equal(result.reason.split(PLANNED_DAY).length - 1, 1, 'the shared date is named once');
});

// --- 5) The reason numbers are the Effect row numbers ----------------------

test('D27 reason and effect agree: lighter meals plus the extra equal the effect change', () => {
  const id = 'cholesterol';
  const plan = basePlanFor(id);
  const extra = plannedDinner(PLANNED_DAY, 150, 'planned-agree');
  const result = baseRun(id, [extra]);

  const before = dayTotals(plan.days[PLANNED_DAY], recipesById, foodsById).totals;
  const afterMeals = dayTotals(result.plan.days[PLANNED_DAY], recipesById, foodsById).totals;
  const extraTotals = loggedNutrients(extra.items, foodsById).totals;
  const satFat = effectOf(result, 'satFat');

  // "lighter ... (about X less)": exactly the other meals' drop, rounded like the screen.
  const quoted = result.reason.match(/lighter in saturated fat \(about ([\d.]+) g less\)/);
  assert.ok(quoted, result.reason);
  const lighter = Number(quoted[1]);
  const mealsDrop = Number((shown('satFat', before.satFat) - shown('satFat', afterMeals.satFat)).toFixed(1));
  assert.equal(lighter, mealsDrop);

  // The other meals' drop plus the way the whole day moved is the planned extra
  // (each number rounded like the screen, so a tenth is the most they can drift).
  const change = effectChange('satFat', satFat);
  assert.ok(Math.abs((lighter + change) - extraTotals.satFat) <= 0.1001,
    'other meals drop ' + lighter + ' + day change ' + change + ' vs extra ' + extraTotals.satFat);
  // The quoted "lighter" number is never invented: the day total after includes the pizza.
  assert.equal(shown('satFat', satFat.after), shown('satFat', afterMeals.satFat + extraTotals.satFat));
});

// --- 6) The pure plan function invariants from D26 still hold --------------

for (const profileId of ['cholesterol', 'recovery']) {
  test('D27 purity (' + profileId + '): add then remove equals never adding', () => {
    const plan = basePlanFor(profileId);
    const extra = plannedDinner();
    const baseArgs = {
      planBase: plan,
      log: [],
      decisions: [],
      today: TODAY,
      targets: targetsFor(profileId),
      recipes,
      foodsById,
      bought: [],
      fromDate: TODAY,
    };

    const added = recomputeShownPlan({ ...baseArgs, plan, plannedExtras: [extra] });
    assert.ok(added.result, profileId + ': the planned meal must produce a result');
    if (profileId === 'cholesterol') {
      // A profile with maxima has room to make: the plan changes for the planned day.
      assert.match(added.result.reason, /^You planned /);
    }

    const removed = recomputeShownPlan({ ...baseArgs, plan: added.plan, plannedExtras: [] });
    assert.equal(removed.proposal, null, profileId + ': removing it leaves nothing to decide');
    assert.equal(removed.result.nothingToChange, true);
    assert.deepEqual(removed.plan.days, plan.days, profileId + ': the plan equals never adding it');
  });
}
