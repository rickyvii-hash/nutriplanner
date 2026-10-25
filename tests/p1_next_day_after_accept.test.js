/**
 * P1: after an accepted update, the next day's first log must not wipe
 * make-up already accepted for past days. Same-day second log still uses
 * planBase (covered in p1_same_day_second_log.test.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';
import { acceptUpdatedPlan } from '../src/store.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);

const DAY_A = '2026-10-22';
const DAY_B = '2026-10-24';
const BIG = [
  { foodId: 'pizza-cheese', grams: 700 },
  { foodId: 'ice-cream-vanilla', grams: 200 },
];

test('P1: next-day log after accept keeps past make-up days', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
  assert.equal(todayIso(), DAY_B);

  const logA = [{ date: DAY_A, time: '20:00', items: BIG.map((x) => ({ ...x })) }];
  const resultA = replan({
    targets, recipes, plan, log: logA, bought: [], foodsById, fromDate: DAY_A,
  });
  assert.ok(resultA.changed.length > 0, 'day A overshoot must change upcoming days');
  const afterA = acceptUpdatedPlan({
    profileId: 'cholesterol',
    targets,
    plan,
    planBase: null,
    log: logA,
    bought: [],
    pendingProposal: null,
  }, resultA);
  assert.deepEqual(afterA.planBase, plan);

  const pastMakeUp = [...new Set(resultA.changed.map((c) => c.date))].filter((d) => d < DAY_B);
  assert.ok(pastMakeUp.length > 0, 'need a past make-up day from A');
  const snapshot = {};
  for (const d of pastMakeUp) {
    snapshot[d] = structuredClone(afterA.plan.days[d]);
    assert.notDeepEqual(afterA.plan.days[d], plan.days[d], `${d} differs from original`);
  }

  // Source contract: saveLogAndReplan must not always replan from planBase alone.
  // First log on a later day (no prior same-day entry) must keep current plan days.
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const fn = app.match(/saveLogAndReplan:[\s\S]*?navigate\('updated'\);/);
  assert.ok(fn, 'saveLogAndReplan must exist');
  // Must choose the current plan when this is the first log of the day after an accept.
  assert.match(
    fn[0],
    /planBase[\s\S]{0,200}(prior|sameDay|same-day|hadPrior|alreadyLogged)|((prior|sameDay|hadPrior|alreadyLogged)[\s\S]{0,200}planBase)|plan:\s*ctx\.state\.plan\b/,
    'saveLogAndReplan must choose current plan for a later-day first log (not always planBase)',
  );

  // Behaviour: first log on DAY_B from the current (accepted) plan keeps past make-up.
  const logAB = [
    ...logA,
    { date: DAY_B, time: '20:00', items: BIG.map((x) => ({ ...x })) },
  ];
  const fromCurrent = replan({
    targets, recipes, plan: afterA.plan, log: logAB, bought: [], foodsById, fromDate: DAY_B,
  });
  const fromBaseOnly = replan({
    targets, recipes, plan: afterA.planBase, log: logAB, bought: [], foodsById, fromDate: DAY_B,
  });
  for (const d of pastMakeUp) {
    assert.deepEqual(
      fromCurrent.plan.days[d],
      snapshot[d],
      `${d}: replanning from the current plan keeps make-up`,
    );
    assert.deepEqual(
      fromBaseOnly.plan.days[d],
      plan.days[d],
      `${d}: replanning from planBase alone would wipe make-up (the bug)`,
    );
  }
});
