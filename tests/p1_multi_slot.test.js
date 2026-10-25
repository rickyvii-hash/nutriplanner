/**
 * P1-B: converting one planned slot Eaten↔Skipped must not erase sibling slots
 * stored in the same log entry (or the same save).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan } from '../src/engine/planner.js';
import { recipeNutrients } from '../src/engine/nutrients.js';
import { profileById } from '../src/engine/profiles.js';
import {
  convertLogEntryToSkipped,
  convertSkippedEntryToEaten,
  logEntryAt,
} from '../src/log_corrections.js';
import { logEntriesForSave } from '../src/ui/log.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);
const day = '2026-10-24';
const dayMeals = plan.days[day];
assert.ok(dayMeals?.breakfast && dayMeals?.lunch, 'need two planned slots');

const breakfast = recipesById.get(dayMeals.breakfast);
const lunch = recipesById.get(dayMeals.lunch);

test('P1-B: logEntriesForSave keeps one entry per planned eaten slot', () => {
  const when = { date: day, time: '12:00' };
  const entries = logEntriesForSave({
    items: [
      ...breakfast.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
      ...lunch.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
    ],
    eaten: [
      { recipeId: breakfast.id, slot: 'breakfast' },
      { recipeId: lunch.id, slot: 'lunch' },
    ],
    skipped: [],
    replaced: [],
    extra: false,
  }, when);

  assert.ok(entries.length >= 2, 'each planned eaten slot must be its own entry');
  const eatenSlots = entries.flatMap((e) => (e.eaten || []).map((x) => x.slot));
  assert.ok(eatenSlots.includes('breakfast'));
  assert.ok(eatenSlots.includes('lunch'));
  assert.equal(new Set(eatenSlots).size, eatenSlots.length, 'no duplicate slots');
});

test('P1-B: converting one eaten slot to skipped leaves the other slot intact', () => {
  // Simulate the broken flattened shape that still may exist in saved data,
  // and the preferred one-entry-per-slot shape after save.
  const flat = {
    date: day,
    time: '12:00',
    items: [
      ...breakfast.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
      ...lunch.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
    ],
    eaten: [
      { recipeId: breakfast.id, slot: 'breakfast' },
      { recipeId: lunch.id, slot: 'lunch' },
    ],
  };
  const state = {
    profileId: 'cholesterol',
    targets,
    plan,
    log: [flat],
    bought: [],
  };

  const next = convertLogEntryToSkipped(state, 0, breakfast.id);
  const entry = logEntryAt(next, 0);
  assert.ok(entry, 'entry remains');

  // Breakfast is skipped.
  const skipped = entry.skipped || [];
  assert.ok(skipped.includes(breakfast.id), 'breakfast becomes skipped');

  // Lunch must still be present as eaten (same entry split, or a sibling entry).
  const all = next.log;
  const lunchStillEaten = all.some((e) =>
    (e.eaten || []).some((x) => x.recipeId === lunch.id || x.slot === 'lunch')
    || ((e.items || []).length > 0
      && (e.eaten || []).some((x) => x.slot === 'lunch')));
  const lunchEntry = all.find((e) =>
    (e.eaten || []).some((x) => x.recipeId === lunch.id || x.slot === 'lunch'));
  assert.ok(
    lunchStillEaten || lunchEntry,
    'lunch must not disappear when breakfast is converted to skipped',
  );
  if (lunchEntry) {
    assert.ok((lunchEntry.items || []).length > 0, 'lunch keeps its food items');
  }
});

test('P1-B: converting one skipped slot to eaten leaves a sibling skip intact', () => {
  const state = {
    profileId: 'cholesterol',
    targets,
    plan,
    log: [{
      date: day,
      time: '12:00',
      skipped: [breakfast.id, lunch.id],
      items: [],
    }],
    bought: [],
  };
  const next = convertSkippedEntryToEaten(state, 0, breakfast);
  const stillSkipLunch = next.log.some((e) =>
    Array.isArray(e.skipped) && e.skipped.includes(lunch.id));
  const breakfastEaten = next.log.some((e) =>
    (e.items || []).length > 0
    && ((e.eaten || []).some((x) => x.recipeId === breakfast.id)
      || !(e.skipped || []).includes(breakfast.id)));
  assert.ok(breakfastEaten, 'breakfast becomes eaten');
  assert.ok(stillSkipLunch, 'lunch skip must remain');
});

// --- P1: a skip is keyed by its planned slot, not just by recipe id ---------

const SNACK_DAY = '2026-10-24';
const twoSnackPrefs = { breakfast: true, lunch: true, dinner: true, snacks: 2 };

/** A two-snack plan whose logged day holds the same snack recipe in both snack slots. */
function planWithTwoSameSnacks() {
  const twoSnackPlan = buildPlan(
    targets,
    recipes,
    { year: 2026, month: 10 },
    foodsById,
    [],
    { mealPrefs: twoSnackPrefs },
  );
  const snack = recipes.find((r) => r.slot === 'snack');
  twoSnackPlan.days[SNACK_DAY] = {
    ...twoSnackPlan.days[SNACK_DAY],
    snack: snack.id,
    snack2: snack.id,
  };
  return { plan: twoSnackPlan, snack };
}

function replanSkips(currentPlan, log) {
  return replan({
    targets,
    recipes,
    plan: currentPlan,
    log,
    bought: [],
    foodsById,
    fromDate: SNACK_DAY,
    logFromDate: SNACK_DAY,
    mealPrefs: twoSnackPrefs,
  });
}

test('P1: skipping the same snack recipe on snack and snack2 counts two meals', () => {
  const { plan: currentPlan, snack } = planWithTwoSameSnacks();
  const entries = logEntriesForSave({
    items: [],
    groups: [],
    extras: [],
    skipped: [snack.id],
    skippedSlots: [
      { recipeId: snack.id, slot: 'snack' },
      { recipeId: snack.id, slot: 'snack2' },
    ],
    eaten: [],
    extra: false,
  }, { date: SNACK_DAY, time: '16:00' });
  assert.equal(entries.length, 2, 'each skipped planned slot is its own entry');
  assert.deepEqual(entries.map((e) => e.skippedSlots[0].slot), ['snack', 'snack2']);

  const both = replanSkips(currentPlan, entries);
  const one = replanSkips(currentPlan, [entries[0]]);

  const perSkip = recipeNutrients(snack, foodsById);
  const minNutrients = targets
    .filter((t) => t.kind === 'min' && !perSkip.unknown[t.nutrient] && perSkip.totals[t.nutrient] > 0)
    .map((t) => t.nutrient);
  assert.ok(minNutrients.length > 0, 'the snack recipe must have a known minimum nutrient');

  assert.deepEqual(both.skippedNames, [snack.name], 'the recipe name is listed once');
  for (const nutrient of minNutrients) {
    assert.ok(
      Math.abs(both.shortfall[nutrient] - perSkip.totals[nutrient] * 2) < 1e-9,
      nutrient + ': two skipped planned slots leave twice the shortfall of one',
    );
    assert.ok(
      Math.abs(one.shortfall[nutrient] - perSkip.totals[nutrient]) < 1e-9,
      nutrient + ': one skipped planned slot leaves one meal of shortfall',
    );
    assert.ok(both.shortfall[nutrient] > one.shortfall[nutrient]);
  }
  assert.match(both.reason, /You skipped/i);
});

test('P1: older skip entries without a saved slot still use the planned slot of that day', () => {
  const { plan: currentPlan, snack } = planWithTwoSameSnacks();
  // The same two meals, saved without skippedSlots: the plan day still tells
  // snack from snack2, so the second skipped meal counts too.
  const legacy = [
    { date: SNACK_DAY, time: '16:00', skipped: [snack.id], items: [] },
    { date: SNACK_DAY, time: '16:00', skipped: [snack.id], items: [] },
  ];
  const both = replanSkips(currentPlan, legacy);
  const perSkip = recipeNutrients(snack, foodsById);
  const minNutrients = targets
    .filter((t) => t.kind === 'min' && !perSkip.unknown[t.nutrient] && perSkip.totals[t.nutrient] > 0)
    .map((t) => t.nutrient);
  assert.ok(minNutrients.length > 0);
  for (const nutrient of minNutrients) {
    assert.ok(
      Math.abs(both.shortfall[nutrient] - perSkip.totals[nutrient] * 2) < 1e-9,
      nutrient + ': the two planned snack slots still count separately',
    );
  }
});

test('P1: a duplicate skip of the same day and slot still counts once', () => {
  const { plan: currentPlan, snack } = planWithTwoSameSnacks();
  const entries = logEntriesForSave({
    items: [],
    groups: [],
    extras: [],
    skipped: [snack.id],
    skippedSlots: [
      { recipeId: snack.id, slot: 'snack' },
      { recipeId: snack.id, slot: 'snack' },
    ],
    eaten: [],
    extra: false,
  }, { date: SNACK_DAY, time: '16:00' });
  const result = replanSkips(currentPlan, entries);
  const perSkip = recipeNutrients(snack, foodsById);
  const minNutrients = targets
    .filter((t) => t.kind === 'min' && !perSkip.unknown[t.nutrient] && perSkip.totals[t.nutrient] > 0)
    .map((t) => t.nutrient);
  assert.ok(minNutrients.length > 0);
  for (const nutrient of minNutrients) {
    assert.ok(
      Math.abs(result.shortfall[nutrient] - perSkip.totals[nutrient]) < 1e-9,
      nutrient + ': the same planned slot is never counted twice',
    );
  }
});
