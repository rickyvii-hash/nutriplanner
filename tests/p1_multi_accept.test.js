/**
 * P1-A: after two accepted updates, correcting the later log must not wipe
 * make-up that is still valid for the earlier log.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';
import { applyLogCorrection, removeLogEntry } from '../src/log_corrections.js';
import { acceptUpdatedPlan } from '../src/store.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);

const DAY_A = '2026-10-22';
const DAY_B = '2026-10-24'; // today in frozen clock
const BIG = [
  { foodId: 'pizza-cheese', grams: 700 },
  { foodId: 'ice-cream-vanilla', grams: 200 },
];

function freezeToday(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
}

function baseState(log, currentPlan = plan) {
  return {
    profileId: 'cholesterol',
    targets,
    plan: currentPlan,
    planBase: null,
    log,
    bought: [],
    keptForBought: [],
    pendingProposal: null,
  };
}

test('P1-A: correcting a later accepted log keeps earlier make-up on days already past', (t) => {
  freezeToday(t);
  assert.equal(todayIso(), DAY_B);

  // First overshoot on DAY_A → accept.
  const logA = [{ date: DAY_A, time: '20:00', items: BIG.map((x) => ({ ...x })) }];
  const resultA = replan({
    targets, recipes, plan, log: logA, bought: [], foodsById, fromDate: DAY_A,
  });
  assert.ok(resultA.changed.length > 0, 'first overshoot must change upcoming days');
  const afterA = acceptUpdatedPlan(baseState(logA), resultA);
  assert.deepEqual(afterA.planBase, plan);

  // Dates that were made up for A and are already past by DAY_B (today).
  const pastMakeUpFromA = [...new Set(resultA.changed.map((c) => c.date))]
    .filter((d) => d < DAY_B);
  assert.ok(
    pastMakeUpFromA.length > 0,
    'need at least one make-up day from A that is past by today',
  );
  const snapshotPast = {};
  for (const d of pastMakeUpFromA) {
    snapshotPast[d] = structuredClone(afterA.plan.days[d]);
    assert.notDeepEqual(
      afterA.plan.days[d],
      plan.days[d],
      `${d} must differ from the original plan after accepting A`,
    );
  }

  // Second overshoot on DAY_B (today) → accept.
  const logAB = [
    ...logA,
    { date: DAY_B, time: '20:00', items: BIG.map((x) => ({ ...x })) },
  ];
  const resultB = replan({
    targets,
    recipes,
    plan: afterA.plan,
    log: logAB,
    bought: [],
    foodsById,
    fromDate: DAY_B,
  });
  assert.ok(resultB.changed.length > 0, 'second overshoot must change upcoming days');
  const afterB = acceptUpdatedPlan({ ...afterA, log: logAB }, resultB);
  assert.deepEqual(afterB.planBase, plan, 'planBase stays the original month plan');

  // Remove only the DAY_B log entry (index 1).
  const ctx = {
    state: afterB,
    recipes,
    recipesById,
    foodsById,
    screen: 'plan',
    navigate(name) { this.screen = name; },
  };
  const applied = applyLogCorrection(ctx, removeLogEntry(afterB, 1), { fromDate: DAY_B });

  // Past make-up days from A must still match what was accepted after A
  // (they must not silently revert to the original month plan).
  for (const d of pastMakeUpFromA) {
    assert.deepEqual(
      ctx.state.plan.days[d],
      snapshotPast[d],
      `${d}: correcting B must not wipe A's accepted past make-up`,
    );
  }
  // DAY_A log is still present.
  assert.equal(ctx.state.log.length, 1);
  assert.equal(ctx.state.log[0].date, DAY_A);
  assert.ok(applied, 'correction must complete');
});
