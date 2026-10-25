/**
 * P1: an earlier log whose 4-day make-up window has already ended must not
 * be re-applied to days after today when a later log is deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso, WINDOW_DAYS } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';
import { applyLogCorrection, removeLogEntry } from '../src/log_corrections.js';
import { acceptUpdatedPlan } from '../src/store.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);

// A's window ends before today: A=18 → window 19..22; today=24.
const DAY_A = '2026-10-18';
const DAY_B = '2026-10-24';
const BIG = [
  { foodId: 'pizza-cheese', grams: 700 },
  { foodId: 'ice-cream-vanilla', grams: 200 },
];

test('P1: deleting a later log does not re-apply an expired earlier window', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
  assert.equal(todayIso(), DAY_B);

  const logA = [{ date: DAY_A, time: '20:00', items: BIG.map((x) => ({ ...x })), extra: true }];
  const resultA = replan({
    targets, recipes, plan, log: logA, bought: [], foodsById, fromDate: DAY_A, logFromDate: DAY_A,
  });
  assert.ok(resultA.changed.length > 0, 'A must change its window');
  const aWindow = [...new Set(resultA.changed.map((c) => c.date))];
  assert.ok(aWindow.every((d) => d <= '2026-10-22'), `A window must end before today: ${aWindow}`);
  assert.equal(aWindow.length <= WINDOW_DAYS, true);

  let state = acceptUpdatedPlan({
    profileId: 'cholesterol', targets, plan, planBase: null, log: logA, bought: [],
    updateDecisions: [{ triggerDate: DAY_A, accepted: true }],
  }, resultA);

  const logAB = [
    ...logA,
    { date: DAY_B, time: '20:00', items: BIG.map((x) => ({ ...x })), extra: true },
  ];
  const resultB = replan({
    targets, recipes, plan: state.plan, log: logAB, bought: [], foodsById,
    fromDate: DAY_B, logFromDate: DAY_B,
  });
  assert.ok(resultB.changed.length > 0, 'B must change upcoming days');
  state = acceptUpdatedPlan({ ...state, log: logAB }, resultB);

  const futureAfterToday = Object.keys(plan.days).filter((d) => d > DAY_B).sort();
  const snapshotFuture = Object.fromEntries(
    futureAfterToday.slice(0, WINDOW_DAYS).map((d) => [d, structuredClone(state.plan.days[d])]),
  );

  // Pure baseline: only A remains, A's window already over — future days = planBase.
  const onlyA = replan({
    targets, recipes, plan: state.planBase || plan, log: logA, bought: [], foodsById,
    fromDate: DAY_B, logFromDate: DAY_A,
  });
  // Document the bug: naive earliest-logFromDate would still change the future.
  assert.ok(
    onlyA.changed.some((c) => c.date > DAY_B),
    'naive replan from A still wants to change days after today (expired window)',
  );

  const ctx = {
    state,
    recipes,
    recipesById,
    foodsById,
    screen: 'plan',
    navigate(name) { this.screen = name; },
  };
  const bIndex = state.log.findIndex((e) => e.date === DAY_B);
  applyLogCorrection(ctx, removeLogEntry(state, bIndex), { fromDate: DAY_B });

  // After deleting B, days after today must match the original base (A's window is over).
  const shown = ctx.proposal?.plan || ctx.state.plan;
  for (const d of Object.keys(snapshotFuture)) {
    assert.deepEqual(
      shown.days[d],
      plan.days[d],
      `${d}: expired window of A must not rewrite days after today`,
    );
  }
});
