import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso } from '../src/engine/planner.js';
import { foodNutrients, sumNutrients, recipeNutrients } from '../src/engine/nutrients.js';
import { profileById } from '../src/engine/profiles.js';
import {
  applyLogCorrection,
  updateLogEntryItems,
  removeLogEntry,
} from '../src/log_corrections.js';
import {
  acceptUpdatedPlan, saveState, loadState, clearState,
} from '../src/store.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);

const D2 = '2026-10-22';
const D1 = '2026-10-23';

const totalsOfItems = (items) => sumNutrients(
  items.map((it) => foodNutrients(foodsById.get(it.foodId), it.grams)),
).totals;

function baseState(log) {
  return {
    profileId: 'cholesterol',
    targets,
    plan,
    log,
    bought: [],
    keptForBought: [],
    pendingProposal: null,
  };
}

/**
 * Freeze the clock on a fixed October day so "today" and the past days are the
 * same every time the suite runs.
 */
function freezeToday(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
}

test('correcting a past log touches only today forward and keeps later logs in the totals', (t) => {
  freezeToday(t);
  const today = todayIso();
  assert.equal(today, '2026-10-24');

  const state = baseState([
    {
      date: D2,
      time: '20:00',
      items: [
        { foodId: 'pizza-cheese', grams: 350 },
        { foodId: 'ice-cream-vanilla', grams: 100 },
      ],
    },
    {
      date: D1,
      time: '20:00',
      items: [{ foodId: 'pizza-cheese', grams: 500 }],
    },
  ]);
  const ctx = {
    state,
    recipes,
    recipesById,
    foodsById,
    screen: 'plan',
    navigate(name) { this.screen = name; },
  };

  // Correct the entry on the earlier day (D-2): same foods, bigger portions.
  const corrected = updateLogEntryItems(state, 0, [
    { foodId: 'pizza-cheese', grams: 700 },
    { foodId: 'ice-cream-vanilla', grams: 200 },
  ]);
  const applied = applyLogCorrection(ctx, corrected, { fromDate: D2 });
  const result = applied.result;

  assert.equal(applied.planChanged, true, 'the correction still recalculates the future days');
  assert.equal(ctx.screen, 'updated');

  // No day that is already over may be proposed again.
  const changedDays = [...new Set(result.changed.map((c) => c.date))].sort();
  assert.ok(changedDays.length > 0);
  for (const date of changedDays) {
    assert.ok(date > today, `${date} was already over and must not change`);
  }
  for (const [date, meals] of Object.entries(plan.days)) {
    if (date >= today) continue;
    assert.deepEqual(result.plan.days[date], meals, `${date} is a past day and must stay as it was`);
  }

  // The full corrected log feeds the replan: the later entry (D-1) counts too.
  const d2Totals = totalsOfItems(corrected.log[0].items);
  const d1Totals = totalsOfItems(corrected.log[1].items);
  assert.ok(d1Totals.satFat > 0, 'the later entry carries saturated fat');
  assert.ok(Math.abs(result.recentTotals.satFat - (d2Totals.satFat + d1Totals.satFat)) < 1e-9);
  assert.ok(result.recentTotals.satFat > d2Totals.satFat, 'ignoring the later log would lose food that was eaten');

  // Replanning from today without the earlier days would use less food, so the
  // later log really is part of the numbers behind the proposal.
  const withoutLater = replan({
    targets,
    recipes,
    plan,
    log: corrected.log,
    bought: [],
    foodsById,
    fromDate: today,
    logFromDate: today,
  });
  assert.ok(result.recentTotals.satFat > withoutLater.recentTotals.satFat);

  // The reason says the days logged drove the change, not a single "today".
  assert.match(result.reason, /across the days you logged/i);
  assert.doesNotMatch(result.reason, /\btoday\b/i);
});

test('removing a past log still recalculates from today using the entries that remain', (t) => {
  freezeToday(t);
  const today = todayIso();

  const state = baseState([
    { date: D2, time: '20:00', items: [{ foodId: 'ice-cream-vanilla', grams: 150 }] },
    { date: D1, time: '20:00', items: [{ foodId: 'pizza-cheese', grams: 500 }] },
  ]);
  const ctx = { state, recipes, recipesById, foodsById, screen: 'plan', navigate(name) { this.screen = name; } };

  const corrected = removeLogEntry(state, 0);
  const applied = applyLogCorrection(ctx, corrected, { fromDate: D2 });
  const result = applied.result;

  assert.equal(applied.planChanged, true, 'the remaining later log still needs a recalculation');
  assert.equal(ctx.screen, 'updated');

  for (const date of new Set(result.changed.map((c) => c.date))) {
    assert.ok(date > today, `${date} was already over and must not change`);
  }
  for (const [date, meals] of Object.entries(plan.days)) {
    if (date >= today) continue;
    assert.deepEqual(result.plan.days[date], meals, `${date} is a past day and must stay as it was`);
  }

  // Only the entry that is still there counts.
  const remaining = totalsOfItems(corrected.log[0].items);
  assert.ok(Math.abs(result.recentTotals.satFat - remaining.satFat) < 1e-9);
});

test('the same recipe skipped on two past days counts twice in the make-up', (t) => {
  freezeToday(t);
  const today = todayIso();

  // The corrected log records the same planned lunch as skipped on two different past days.
  const lunchId = plan.days[D2].lunch;
  const lunch = recipesById.get(lunchId);
  const perSkip = recipeNutrients(lunch, foodsById);
  const log = [
    { date: D2, time: '13:00', skipped: [lunchId], items: [] },
    { date: D1, time: '13:00', skipped: [lunchId], items: [] },
  ];

  const base = { targets, recipes, plan, bought: [], foodsById, fromDate: today, logFromDate: D2 };
  const both = replan({ ...base, log });
  const one = replan({ ...base, log: [log[0]] });

  // Both skips are real missed meals: the shortfall is twice one skip, not one.
  assert.deepEqual(both.skippedNames, [lunch.name], 'the name is listed once even if it was skipped twice');
  assert.ok(
    Math.abs(both.shortfall.fibre - perSkip.totals.fibre * 2) < 1e-9,
    'two skips of the same recipe leave twice the fibre to make up',
  );
  assert.ok(Math.abs(one.shortfall.fibre - perSkip.totals.fibre) < 1e-9);
  assert.ok(both.shortfall.fibre > one.shortfall.fibre, 'the earlier skip is never dropped');

  // The reason quotes the real total of both skips.
  assert.match(both.reason, new RegExp(`about ${(perSkip.totals.fibre * 2).toFixed(1)} g of your`));
  assert.match(both.reason, /on a past day/i);
  assert.doesNotMatch(both.reason, /\btoday\b/i);

  // Past days stay frozen and only the future is proposed.
  assert.deepEqual(both.plan.days[D2], plan.days[D2]);
  assert.deepEqual(both.plan.days[D1], plan.days[D1]);
  for (const date of new Set(both.changed.map((c) => c.date))) {
    assert.ok(date > today, `${date} was already over and must not change`);
  }
});

// --- Correcting the log after an accepted update -----------------------------
// Accepting an update bakes its make-up days into the plan. Correcting the meal
// that drove it must replan from the plan before that acceptance, otherwise the
// make-up would stay for a meal that is no longer in the log.

const TODAY = '2026-10-24';
const BIG_MEAL = [
  { foodId: 'pizza-cheese', grams: 700 },
  { foodId: 'ice-cream-vanilla', grams: 200 },
];
const MEDIUM_MEAL = [
  { foodId: 'pizza-cheese', grams: 500 },
  { foodId: 'ice-cream-vanilla', grams: 100 },
];
const SMALL_MEAL = [
  { foodId: 'pizza-cheese', grams: 100 },
  { foodId: 'ice-cream-vanilla', grams: 100 },
];

function overshootLog(items) {
  return [{ date: TODAY, time: '20:00', items: items.map((it) => ({ ...it })) }];
}

function correctionCtx(state) {
  return {
    state,
    recipes,
    recipesById,
    foodsById,
    screen: 'plan',
    navigate(name) { this.screen = name; },
  };
}

/** Log the big off-plan meal and accept the update it proposes. */
function acceptOvershoot() {
  const log = overshootLog(BIG_MEAL);
  const result = replan({
    targets, recipes, plan, log, bought: [], foodsById, fromDate: TODAY,
  });
  assert.ok(result.changed.length > 0, 'the overshoot must make up on the next days');
  const accepted = acceptUpdatedPlan(baseState(log), result);
  return { result, accepted };
}

test('accepted update: removing the triggering meal removes its make-up days', (t) => {
  freezeToday(t);
  const { result, accepted } = acceptOvershoot();

  assert.deepEqual(accepted.plan, result.plan, 'Use updated plan applies the proposal');
  assert.deepEqual(accepted.planBase, plan, 'the plan before the update is remembered');
  assert.equal(accepted.pendingProposal, null);

  const makeUpDates = [...new Set(result.changed.map((c) => c.date))];
  assert.ok(makeUpDates.length > 0);

  const ctx = correctionCtx(accepted);
  const applied = applyLogCorrection(ctx, removeLogEntry(accepted, 0), { fromDate: TODAY });

  assert.equal(applied.planChanged, false, 'nothing was eaten, so nothing is left to make up');
  assert.equal(ctx.screen, 'plan');
  assert.equal(ctx.state.pendingProposal, null);
  assert.equal(ctx.state.planBase, null, 'the baseline is back in place, so no history is left over');
  assert.deepEqual(ctx.state.plan, plan, 'the accepted make-up must not survive the removed meal');
  for (const date of makeUpDates) {
    assert.deepEqual(ctx.state.plan.days[date], plan.days[date], `${date} must go back to the base plan`);
  }

  // The numbers behind the result count no food at all.
  assert.equal(applied.result.recentTotals.satFat, 0);
  assert.equal(applied.result.nothingToChange, true);
  assert.doesNotMatch(applied.result.reason, /You logged/i);
});

test('accepted update: reducing the meal below the maximum removes the make-up', (t) => {
  freezeToday(t);
  const { accepted } = acceptOvershoot();
  const oldTotals = totalsOfItems(BIG_MEAL);

  const ctx = correctionCtx(accepted);
  const corrected = updateLogEntryItems(accepted, 0, SMALL_MEAL);
  const applied = applyLogCorrection(ctx, corrected, { fromDate: TODAY });

  const smallTotals = totalsOfItems(SMALL_MEAL);
  assert.ok(smallTotals.satFat < 13, 'the reduced meal is under the daily maximum');
  assert.ok(smallTotals.satFat < oldTotals.satFat);
  assert.equal(applied.planChanged, false);
  assert.deepEqual(ctx.state.plan, plan, 'the make-up from the old overshoot must not remain');
  assert.equal(ctx.state.planBase, null);

  // The corrected log, not the old one, is behind the numbers.
  assert.ok(Math.abs(applied.result.recentTotals.satFat - smallTotals.satFat) < 1e-9);
  assert.ok(applied.result.recentTotals.satFat < oldTotals.satFat);
});

test('accepted update: a smaller overshoot replans from the base plan and quotes the new log', (t) => {
  freezeToday(t);
  const { accepted } = acceptOvershoot();
  const oldTotals = totalsOfItems(BIG_MEAL);

  const ctx = correctionCtx(accepted);
  const corrected = updateLogEntryItems(accepted, 0, MEDIUM_MEAL);
  const applied = applyLogCorrection(ctx, corrected, { fromDate: TODAY });
  assert.equal(applied.planChanged, true, 'the meal is still over the maximum, so a smaller make-up is proposed');

  const mediumTotals = totalsOfItems(MEDIUM_MEAL);
  assert.ok(mediumTotals.satFat > 13 && mediumTotals.satFat < oldTotals.satFat);

  // The accepted make-up is undone before the refreshed proposal is shown.
  assert.deepEqual(ctx.state.plan, plan);
  assert.ok(ctx.state.pendingProposal?.plan, 'the refreshed proposal is stored');

  // Every "before" comes from the base plan, so the update never replans from
  // the already compensated days.
  for (const change of applied.result.changed) {
    assert.equal(
      change.before,
      plan.days[change.date][change.slot],
      `${change.date} ${change.slot} must start from the base plan`,
    );
  }
  assert.ok(
    applied.result.changed.some((c) => accepted.plan.days[c.date][c.slot] !== plan.days[c.date][c.slot]),
    'the accepted update really changed the same window, so this is a real regression check',
  );

  // The reason and the totals use the corrected meal, not the old one.
  assert.ok(Math.abs(applied.result.recentTotals.satFat - mediumTotals.satFat) < 1e-9);
  assert.ok(applied.result.reason.includes(mediumTotals.satFat.toFixed(1)));
  assert.ok(!applied.result.reason.includes(oldTotals.satFat.toFixed(1)));

  // Accepting the refreshed proposal remembers the base plan again for the next correction.
  const reaccepted = acceptUpdatedPlan(ctx.state, applied.result);
  assert.deepEqual(reaccepted.plan, applied.result.plan);
  assert.deepEqual(reaccepted.planBase, plan);
});

test('accepted update: Use updated plan records the plan from before the update', () => {
  const source = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const handler = source.match(/useUpdatedPlan:[\s\S]{0,400}/);
  assert.ok(handler, 'the Use updated plan action must be in app.js');
  assert.match(handler[0], /acceptUpdatedPlan/, 'it must keep the plan from before the accepted update');
});

test('the baseline plan from before an accepted update survives a reload', () => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  const { accepted } = acceptOvershoot();
  saveState(accepted);
  const loaded = loadState();
  assert.deepEqual(loaded.plan, accepted.plan);
  assert.deepEqual(loaded.planBase, plan, 'a reload must keep the plan from before the accepted update');
  clearState();
  assert.equal(loadState().planBase, null);
});
