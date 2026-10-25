/**
 * P1: when the second log of the day replans from planBase, days before
 * today that already hold accepted make-up must stay as in the current plan.
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
const BIG_B = [{ foodId: 'pizza-cheese', grams: 400 }];

test('P1: same-day second log keeps past accepted make-up days', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
  assert.equal(todayIso(), DAY_B);

  const logA = [{ date: DAY_A, time: '20:00', items: BIG.map((x) => ({ ...x })) }];
  const resultA = replan({
    targets, recipes, plan, log: logA, bought: [], foodsById, fromDate: DAY_A,
  });
  assert.ok(resultA.changed.length > 0);
  const afterA = acceptUpdatedPlan({
    profileId: 'cholesterol', targets, plan, planBase: null, log: logA, bought: [],
  }, resultA);

  const pastMakeUp = [...new Set(resultA.changed.map((c) => c.date))].filter((d) => d < DAY_B);
  assert.ok(pastMakeUp.length > 0);
  const snapshot = Object.fromEntries(pastMakeUp.map((d) => [d, structuredClone(afterA.plan.days[d])]));

  // First log today (from current plan), then second log must keep past days.
  const logB1 = [
    ...logA,
    { date: DAY_B, time: '13:00', items: BIG.map((x) => ({ ...x })), extra: true },
  ];
  const firstToday = replan({
    targets, recipes, plan: afterA.plan, log: logB1, bought: [], foodsById, fromDate: DAY_B,
  });
  const afterB1 = acceptUpdatedPlan({ ...afterA, log: logB1 }, firstToday);
  assert.deepEqual(afterB1.planBase, plan);

  // Source: after replan from planBase, past days must be copied from current plan.
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const fn = app.match(/saveLogAndReplan:[\s\S]*?navigate\('updated'\);/);
  assert.ok(fn, 'saveLogAndReplan must exist');
  assert.match(
    fn[0],
    /keptPast|pastDays|date\s*<\s*when|for\s*\(.*plan\.days/,
    'saveLogAndReplan must preserve days before when.date from the current plan',
  );

  const logB2 = [
    ...logB1,
    { date: DAY_B, time: '20:00', items: BIG_B.map((x) => ({ ...x })), extra: true },
  ];
  // Simulate the fixed path: replan from planBase, then overlay past days.
  const raw = replan({
    targets, recipes, plan: afterB1.planBase, log: logB2, bought: [], foodsById, fromDate: DAY_B,
  });
  const fixedDays = { ...raw.plan.days };
  for (const [date, meals] of Object.entries(afterB1.plan.days || {})) {
    if (date < DAY_B) fixedDays[date] = { ...meals };
  }
  for (const d of pastMakeUp) {
    assert.deepEqual(fixedDays[d], snapshot[d], `${d}: past make-up must survive second same-day log`);
    assert.deepEqual(raw.plan.days[d], plan.days[d], `${d}: raw planBase replan would wipe it`);
  }
});
