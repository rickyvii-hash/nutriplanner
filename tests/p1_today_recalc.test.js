/**
 * P1: today must be recalculated from the corrected log. Only days strictly
 * before today stay frozen. If the log that changed today is removed while
 * another past log remains, today must not keep the removed log's make-up.
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

const DAY_A = '2026-10-21'; // window includes today (24)
const DAY_MID = '2026-10-23';
const DAY_TODAY = '2026-10-24';
const BIG = [
  { foodId: 'pizza-cheese', grams: 700 },
  { foodId: 'ice-cream-vanilla', grams: 200 },
];
// Small extra that still creates a proposal but is not the pizza blast.
const SMALL = [{ foodId: 'apple-raw', grams: 150 }];

test('P1: removing the log that changed today recalculates today', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
  assert.equal(todayIso(), DAY_TODAY);

  const logA = [{ date: DAY_A, time: '20:00', items: BIG.map((x) => ({ ...x })), extra: true }];
  const resultA = replan({
    targets, recipes, plan, log: logA, bought: [], foodsById, fromDate: DAY_A, logFromDate: DAY_A,
  });
  assert.ok(resultA.changed.some((c) => c.date === DAY_TODAY), 'A must change today');
  let state = acceptUpdatedPlan({
    profileId: 'cholesterol', targets, plan, planBase: null, log: logA, bought: [],
    updateDecisions: [{ triggerDate: DAY_A, accepted: true }],
  }, resultA);
  const todayAfterA = structuredClone(state.plan.days[DAY_TODAY]);
  assert.notDeepEqual(todayAfterA, plan.days[DAY_TODAY], 'today differs from base after A');

  // A mild mid log that is accepted; its own window may or may not touch today.
  const logAM = [
    ...logA,
    { date: DAY_MID, time: '12:00', items: SMALL.map((x) => ({ ...x })), extra: true },
  ];
  const resultM = replan({
    targets, recipes, plan: state.plan, log: logAM, bought: [], foodsById,
    fromDate: DAY_MID, logFromDate: DAY_MID,
  });
  state = acceptUpdatedPlan({
    ...state,
    log: logAM,
    updateDecisions: [
      { triggerDate: DAY_A, accepted: true },
      { triggerDate: DAY_MID, accepted: true },
    ],
  }, resultM.changed.length ? resultM : {
    ...resultM,
    plan: state.plan,
    changed: [],
    keptForBought: state.keptForBought || [],
  });

  const ctx = {
    state,
    recipes,
    recipesById,
    foodsById,
    screen: 'plan',
    navigate(name) { this.screen = name; },
  };
  const aIndex = state.log.findIndex((e) => e.date === DAY_A);
  applyLogCorrection(ctx, removeLogEntry(state, aIndex), { fromDate: DAY_A });

  const shown = ctx.proposal?.plan || ctx.state.plan;
  // Today must not still equal the make-up that only A produced.
  assert.notDeepEqual(
    shown.days[DAY_TODAY],
    todayAfterA,
    'today must be recalculated after removing the log that changed it',
  );
  // Days strictly before today stay as they were in the pre-correction plan.
  for (const d of Object.keys(state.plan.days).filter((d) => d < DAY_TODAY)) {
    assert.deepEqual(
      (ctx.state.plan.days[d] || shown.days[d]),
      state.plan.days[d],
      `${d}: past days stay frozen`,
    );
  }
});
