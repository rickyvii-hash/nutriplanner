/**
 * P1: a second log on the same day must replan from planBase + the full log,
 * matching a single replan of both entries against the original plan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso, effectChange } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';
import { acceptUpdatedPlan } from '../src/store.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));

const BIG_A = [
  { foodId: 'pizza-cheese', grams: 700 },
  { foodId: 'ice-cream-vanilla', grams: 200 },
];
const BIG_B = [{ foodId: 'pizza-cheese', grams: 400 }];

function freezeToday(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
}

function entry(date, items, time) {
  return { date, time, items: items.map((x) => ({ ...x })), extra: true };
}

/**
 * What saveLogAndReplan must do on a second save: replan from planBase (or the
 * original plan) with the full merged log — never from the already-compensated plan.
 */
function secondSaveReplan(state, recipesList, foodsMap) {
  const base = state.planBase || state.plan;
  return replan({
    targets: state.targets,
    recipes: recipesList,
    plan: base,
    log: state.log,
    bought: state.bought || [],
    foodsById: foodsMap,
    fromDate: todayIso(),
    mealPrefs: state.mealPrefs,
  });
}

/** The buggy path: replan from state.plan after an accepted update. */
function buggySecondSaveReplan(state, recipesList, foodsMap) {
  return replan({
    targets: state.targets,
    recipes: recipesList,
    plan: state.plan,
    log: state.log,
    bought: state.bought || [],
    foodsById: foodsMap,
    fromDate: todayIso(),
    mealPrefs: state.mealPrefs,
  });
}

for (const profileId of ['cholesterol', 'weight-loss']) {
  test(`P1 same-day: ${profileId} A-then-B equals A+B from the original plan`, (t) => {
    freezeToday(t);
    const targets = profileById(profileId).targets;
    const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);
    const day = todayIso();

    const logA = [entry(day, BIG_A, '12:00')];
    const resultA = replan({
      targets, recipes, plan, log: logA, bought: [], foodsById, fromDate: day,
    });
    assert.ok(resultA.changed.length > 0, `${profileId}: first log must change the plan`);
    let state = acceptUpdatedPlan({
      profileId, targets, plan, planBase: null, log: logA, bought: [], mealPrefs: null,
    }, resultA);
    assert.deepEqual(state.planBase, plan);

    const logAB = [...logA, entry(day, BIG_B, '18:00')];
    state = { ...state, log: logAB };

    const together = replan({
      targets, recipes, plan, log: logAB, bought: [], foodsById, fromDate: day,
    });
    const fixed = secondSaveReplan(state, recipes, foodsById);
    const buggy = buggySecondSaveReplan(state, recipes, foodsById);

    assert.deepEqual(
      fixed.plan.days,
      together.plan.days,
      `${profileId}: second save from planBase must match logging both at once`,
    );

    // Source contract: saveLogAndReplan must pass planBase (or equivalent), not only plan.
    const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const fn = app.match(/saveLogAndReplan:[\s\S]*?navigate\('updated'\);/);
    assert.ok(fn, 'saveLogAndReplan must exist');
    assert.match(fn[0], /planBase/, `${profileId}: saveLogAndReplan must replan from planBase`);

    // On some profiles the compensated-plan path happens to land on the same
    // recipes; on others it diverges. The product requirement is the planBase path.
    if (profileId === 'weight-loss') {
      assert.notDeepEqual(
        buggy.plan.days,
        together.plan.days,
        `${profileId}: compensated-plan replan still diverges (why planBase matters)`,
      );
    }

    // Reason quotes at least one non-zero Effect number (any nutrient).
    const quoted = (fixed.effects || []).some((e) => {
      const c = effectChange(e.nutrient, e);
      if (c === 0) return false;
      return fixed.reason.includes(Math.abs(c).toFixed(1));
    });
    assert.ok(quoted, `${profileId}: reason quotes an effect number: ${fixed.reason}`);
  });
}
