/**
 * D12: making up a skipped meal must never push a maximum-target nutrient over its
 * goal. Every changed day keeps every maximum at or below the goal it was already
 * within, or at least not higher than the day it replaces when it was already above.
 * The reason and the Effect rows still quote the same numbers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, dayTotals, effectChange } from '../src/engine/planner.js';
import { PROFILES } from '../src/engine/profiles.js';
import { recipeNutrients } from '../src/engine/nutrients.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

const MONTH = { year: 2026, month: 10 };
const DAY_ONE = '2026-10-01';
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Each slot skipped alone on day 1, plus two meals skipped together. */
const SKIP_CHOICES = [
  ['breakfast'],
  ['lunch'],
  ['dinner'],
  ['snack'],
  ['breakfast', 'dinner'],
  ['lunch', 'snack'],
];

const EPS = 1e-9;

function skipLog(plan, slots) {
  const planned = plan.days[DAY_ONE];
  const ids = slots.map((s) => planned[s]);
  return [{
    date: DAY_ONE,
    time: '09:00',
    skipped: ids,
    skippedSlots: slots.map((s) => ({ recipeId: planned[s], slot: s })),
  }];
}

function decimalsFor(key) {
  return key === 'kcal' || key === 'sodium' ? 0 : 1;
}

function displayed(key, value) {
  return Number(Number(value || 0).toFixed(decimalsFor(key)));
}

/** Every changed day: maxima hold, and no made-up minimum falls back. */
function assertChangedDaysHold(result, beforePlan, targets, label) {
  const changedDates = [...new Set(result.changed.map((c) => c.date))].sort();
  for (const date of changedDates) {
    const before = dayTotals(beforePlan.days[date], recipesById, foodsById).totals;
    const after = dayTotals(result.plan.days[date], recipesById, foodsById).totals;
    for (const t of targets) {
      if (t.kind !== 'max' || !t.daily || t.daily <= 0) continue;
      if (before[t.nutrient] <= t.daily + EPS) {
        assert.ok(after[t.nutrient] <= t.daily + EPS,
          `${label} ${date}: ${t.nutrient} ${before[t.nutrient].toFixed(2)} -> ${after[t.nutrient].toFixed(2)} must stay within its max ${t.daily}`);
      } else {
        assert.ok(after[t.nutrient] <= before[t.nutrient] + EPS,
          `${label} ${date}: ${t.nutrient} was already over (${before[t.nutrient].toFixed(2)}) and rose to ${after[t.nutrient].toFixed(2)}`);
      }
    }
    for (const nutrient of Object.keys(result.shortfall || {})) {
      assert.ok(after[nutrient] >= before[nutrient] - EPS,
        `${label} ${date}: made-up minimum ${nutrient} fell from ${before[nutrient].toFixed(2)} to ${after[nutrient].toFixed(2)}`);
    }
  }
  return changedDates;
}

/** The Effect row for a maximum never shows a move above its goal because of a make-up. */
function assertEffectRowsRespectMaxima(result, targets, label) {
  for (const t of targets) {
    if (t.kind !== 'max' || !t.daily || t.daily <= 0) continue;
    const effect = result.effects.find((e) => e.nutrient === t.nutrient);
    if (!effect) continue;
    const shownAfter = displayed(t.nutrient, effect.after);
    if (displayed(t.nutrient, effect.before) <= t.daily + EPS) {
      assert.ok(shownAfter <= t.daily + EPS,
        `${label}: Effect row shows ${t.nutrient} ${displayed(t.nutrient, effect.before)} -> ${shownAfter}, above its max ${t.daily}`);
    } else {
      assert.ok(shownAfter <= displayed(t.nutrient, effect.before) + EPS,
        `${label}: Effect row shows ${t.nutrient} already over (${displayed(t.nutrient, effect.before)}) moving up to ${shownAfter}`);
    }
  }
}

/** The nutrient whose shortfall the reason names, chosen exactly like the replan does. */
function primaryShortfall(result, targets) {
  let pick = null;
  let best = -Infinity;
  for (const t of targets) {
    if (t.kind !== 'min') continue;
    const missed = result.shortfall?.[t.nutrient] || 0;
    if (missed <= 0) continue;
    const score = missed / t.daily + (t.nutrient === 'kcal' ? 2 : 0);
    if (score > best) {
      best = score;
      pick = t;
    }
  }
  return pick;
}

/** Reason and Effect rows must keep quoting the same per-day change. */
function assertReasonAgreesWithEffects(result, targets, label) {
  const primary = primaryShortfall(result, targets);
  if (!primary) return;
  const effect = result.effects.find((e) => e.nutrient === primary.nutrient);
  assert.ok(effect, `${label}: missing Effect row for ${primary.nutrient}`);
  const change = effectChange(primary.nutrient, effect);
  const quoted = result.reason.match(/about ([\d.]+) (?:g|kcal|mg) more per day on average/);
  if (quoted) {
    assert.ok(change > 0, `${label}: reason claims more ${primary.nutrient} but the Effect row does not rise`);
    // Both sides are rounded the way the screen prints them, so a float tail cannot differ.
    assert.equal(Number(quoted[1]), displayed(primary.nutrient, Math.abs(change)),
      `${label}: reason quotes ${quoted[1]} but the Effect row shows ${change}`);
  } else {
    assert.ok(change <= 0, `${label}: Effect row rises by ${change} but the reason never says so`);
  }
}

test('D12: skipped meals never push a maximum target over its goal (all profiles, every slot)', () => {
  for (const profile of PROFILES) {
    const plan = buildPlan(profile.targets, recipes, MONTH, foodsById);
    for (const slots of SKIP_CHOICES) {
      const label = `${profile.id} skip ${slots.join('+')}`;
      const result = replan({
        targets: profile.targets,
        recipes,
        plan,
        log: skipLog(plan, slots),
        bought: [],
        foodsById,
        fromDate: DAY_ONE,
      });
      const changedDates = assertChangedDaysHold(result, plan, profile.targets, label);
      assertEffectRowsRespectMaxima(result, profile.targets, label);
      assertReasonAgreesWithEffects(result, profile.targets, label);
      // Days outside the changed set are left exactly as they were.
      for (const [date, meals] of Object.entries(plan.days)) {
        if (changedDates.includes(date)) continue;
        assert.deepEqual(result.plan.days[date], meals, `${label} ${date} must not change`);
      }
      // A make-up that is possible at all still happens: at least one following day changed.
      assert.ok(changedDates.length > 0, `${label}: nothing changed, the make-up never happened`);
    }
  }
});

test('D12: Cholesterol, day-1 breakfast skip: saturated fat stays within its maximum while fibre rises', () => {
  const profile = PROFILES.find((p) => p.id === 'cholesterol');
  const plan = buildPlan(profile.targets, recipes, MONTH, foodsById);
  const result = replan({
    targets: profile.targets,
    recipes,
    plan,
    log: skipLog(plan, ['breakfast']),
    bought: [],
    foodsById,
    fromDate: DAY_ONE,
  });

  // The defect: the fibre make-up used to lift the saturated-fat average above 13 g.
  const satFat = result.effects.find((e) => e.nutrient === 'satFat');
  assert.ok(displayed('satFat', satFat.after) <= satFat.daily,
    `saturated fat shown at ${displayed('satFat', satFat.after)} g/day, above its ${satFat.daily} g maximum`);
  for (const date of new Set(result.changed.map((c) => c.date))) {
    const after = dayTotals(result.plan.days[date], recipesById, foodsById).totals.satFat;
    const before = dayTotals(plan.days[date], recipesById, foodsById).totals.satFat;
    assert.ok(after <= Math.max(before, satFat.daily) + EPS,
      `${date}: saturated fat ${before.toFixed(2)} -> ${after.toFixed(2)}`);
  }
  // The make-up itself still works: the fibre average rises as the reason says.
  const fibre = result.effects.find((e) => e.nutrient === 'fibre');
  assert.ok(fibre.after > fibre.before, `fibre must still rise, ${fibre.before} -> ${fibre.after}`);
  assert.match(result.reason, /higher in fibre/i);
});

test('D12: a day already over a maximum is not made worse by the make-up', () => {
  const profile = PROFILES.find((p) => p.id === 'cholesterol');
  const plan = buildPlan(profile.targets, recipes, MONTH, foodsById);
  // Put the four window days on the richest saturated-fat combination available:
  // every one of them starts above the 13 g maximum.
  const richest = {};
  for (const slot of SLOTS) {
    let best = null;
    for (const recipe of recipes.filter((r) => r.slot === slot)) {
      const value = recipeNutrients(recipe, foodsById).totals.satFat;
      if (!best || value > best.value) best = { id: recipe.id, value };
    }
    richest[slot] = best.id;
  }
  const windowDates = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  for (const date of windowDates) plan.days[date] = { ...richest };

  const satMax = profile.targets.find((t) => t.nutrient === 'satFat').daily;
  for (const date of windowDates) {
    const before = dayTotals(plan.days[date], recipesById, foodsById).totals.satFat;
    assert.ok(before > satMax, `fixture: ${date} should start above the maximum, got ${before.toFixed(1)}`);
  }

  const result = replan({
    targets: profile.targets,
    recipes,
    plan,
    log: skipLog(plan, ['breakfast']),
    bought: [],
    foodsById,
    fromDate: DAY_ONE,
  });
  assert.ok(result.changed.length > 0, 'the fibre make-up must still change the window days');
  for (const date of new Set(result.changed.map((c) => c.date))) {
    const before = dayTotals(plan.days[date], recipesById, foodsById).totals.satFat;
    const after = dayTotals(result.plan.days[date], recipesById, foodsById).totals.satFat;
    assert.ok(after <= before + EPS,
      `${date}: saturated fat was already over (${before.toFixed(2)}) and the make-up raised it to ${after.toFixed(2)}`);
  }
  assertEffectRowsRespectMaxima(result, profile.targets, 'already over');
  assertReasonAgreesWithEffects(result, profile.targets, 'already over');
});
