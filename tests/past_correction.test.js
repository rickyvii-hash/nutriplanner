import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso } from '../src/engine/planner.js';
import { foodNutrients, sumNutrients } from '../src/engine/nutrients.js';
import { profileById } from '../src/engine/profiles.js';
import {
  applyLogCorrection,
  updateLogEntryItems,
  removeLogEntry,
} from '../src/log_corrections.js';

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
