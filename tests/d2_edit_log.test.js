import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { profileById } from '../src/engine/profiles.js';
import {
  buildPlan, replan, effectChange,
} from '../src/engine/planner.js';
import { foodNutrients, sumNutrients } from '../src/engine/nutrients.js';
import {
  removeLogEntry,
  updateLogEntryItems,
  convertLogEntryToSkipped,
  convertSkippedEntryToEaten,
  findPlannedRecipeForEntry,
  applyLogCorrection,
} from '../src/log_corrections.js';
import {
  saveState, loadState, clearState, proposalToStore,
} from '../src/store.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const month = { year: 2026, month: 10 };
const FROM = '2026-10-21';

const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, month, foodsById);

const PIZZA = { foodId: 'pizza-cheese', grams: 350 };
const ICE = { foodId: 'ice-cream-vanilla', grams: 100 };

function baseState(log) {
  return {
    profileId: 'cholesterol',
    targets,
    plan,
    log,
    bought: [],
    keptForBought: [],
    shopEvery: 7,
    shopStart: FROM,
    pendingProposal: null,
  };
}

function eatenEntry(items, time = '20:00') {
  return { date: FROM, time, items: items.map((it) => ({ ...it })) };
}

function replanWith(state, fromDate = FROM) {
  return replan({
    targets: state.targets,
    recipes,
    plan: state.plan,
    log: state.log,
    bought: state.bought,
    foodsById,
    fromDate,
  });
}

const totalsOfItems = (items) => sumNutrients(items.map((it) => foodNutrients(foodsById.get(it.foodId), it.grams))).totals;

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

test('remove an eaten log entry: the log gets shorter and the plan needs no change', () => {
  const state = baseState([eatenEntry([PIZZA, ICE])]);
  const before = replanWith(state);
  assert.ok(before.changed.length > 0, 'the off-plan meal must change the next days first');

  const corrected = removeLogEntry(state, 0);
  assert.equal(corrected.log.length, 0);
  assert.equal(state.log.length, 1, 'the original state is not mutated');
  assert.notEqual(corrected, state);
  assert.equal(corrected.pendingProposal, null, 'a correction drops any pending proposal');

  // Replanning from the corrected log is coherent: nothing is eaten, nothing changes.
  const after = replanWith(corrected);
  assert.equal(after.changed.length, 0);
  assert.equal(after.nothingToChange, true);
  for (const effect of after.effects) {
    assert.equal(effectChange(effect.nutrient, effect), 0, `${effect.nutrient} must not move`);
  }
  assert.ok(after.reason.length > 0);
});

test('change a saved portion: the logged totals change and every other entry is kept', () => {
  const state = baseState([eatenEntry([PIZZA, ICE])]);
  const beforeSatFat = totalsOfItems(state.log[0].items).satFat;

  const items = [
    { foodId: 'pizza-cheese', grams: 700 },
    { foodId: 'ice-cream-vanilla', grams: 200 },
  ];
  const corrected = updateLogEntryItems(state, 0, items);

  assert.equal(corrected.log.length, 1);
  assert.deepEqual(corrected.log[0].items, items);
  assert.equal(state.log[0].items[0].grams, 350, 'the original log is not mutated');
  assert.equal(corrected.pendingProposal, null);

  const afterSatFat = totalsOfItems(corrected.log[0].items).satFat;
  assert.ok(afterSatFat > beforeSatFat, `satFat should rise: ${afterSatFat} vs ${beforeSatFat}`);

  // The recalculated plan sees the corrected portion, not the old one.
  const result = replanWith(corrected);
  assert.ok(Math.abs(result.recentTotals.satFat - afterSatFat) < 1e-9);
  assert.ok(result.changed.length > 0);
  assert.ok(result.reason.length > 0);
});

test('convert an eaten planned meal into Skipped and back again', () => {
  const lunchId = plan.days[FROM].lunch;
  const lunch = recipesById.get(lunchId);
  const entry = eatenEntry(lunch.ingredients);
  const state = baseState([entry]);

  // The saved entry still points at a planned recipe for this day.
  assert.equal(findPlannedRecipeForEntry(entry, plan.days[FROM], recipesById)?.id, lunchId);

  const skipped = convertLogEntryToSkipped(state, 0, lunchId);
  assert.equal(skipped.log.length, 1);
  assert.deepEqual(skipped.log[0].skipped, [lunchId]);
  assert.deepEqual(skipped.log[0].items, []);
  assert.equal(skipped.log[0].date, FROM);
  assert.equal(state.log[0].skipped, undefined, 'the original entry is not mutated');

  const skippedResult = replanWith(skipped);
  assert.deepEqual(skippedResult.skippedNames, [lunch.name]);
  assert.equal(skippedResult.replacements.length, 0);

  // Back to Eaten: the recipe's own ingredients are logged again.
  const eaten = convertSkippedEntryToEaten(skipped, 0, lunch);
  assert.equal(eaten.log.length, 1);
  assert.deepEqual(eaten.log[0].items, lunch.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })));
  assert.equal(eaten.log[0].skipped, undefined);

  // An eaten planned meal recorded with its recipe id can be corrected even when
  // the portions were changed before saving.
  const withMeta = baseState([{
    ...eatenEntry([{ ...lunch.ingredients[0], grams: 5 }]),
    eaten: [{ recipeId: lunchId, slot: lunch.slot }],
  }]);
  const fromMeta = findPlannedRecipeForEntry(withMeta.log[0], plan.days[FROM], recipesById);
  assert.equal(fromMeta?.id, lunchId);
  assert.deepEqual(convertLogEntryToSkipped(withMeta, 0, lunchId).log[0].skipped, [lunchId]);
});

test('a correction survives saveState and loadState', () => {
  installMemoryStorage();
  const state = baseState([
    eatenEntry([PIZZA, ICE]),
    { date: FROM, time: '13:00', skipped: [plan.days[FROM].lunch], items: [] },
  ]);
  // A stale proposal from the earlier meal must not come back with the correction.
  state.pendingProposal = proposalToStore(replanWith(state));

  let corrected = updateLogEntryItems(state, 0, [{ foodId: 'pizza-cheese', grams: 500 }]);
  corrected = removeLogEntry(corrected, 1);
  saveState(corrected);

  const loaded = loadState();
  assert.equal(loaded.log.length, 1);
  assert.deepEqual(loaded.log[0].items, [{ foodId: 'pizza-cheese', grams: 500 }]);
  assert.equal(loaded.pendingProposal, null);
  clearState();
  assert.equal(loadState().log.length, 0);
});

test('a correction that triggers a window keeps the reason and the Effect row in agreement', () => {
  const state = baseState([eatenEntry([PIZZA, ICE])]);
  const corrected = updateLogEntryItems(state, 0, [
    { foodId: 'pizza-cheese', grams: 700 },
    { foodId: 'ice-cream-vanilla', grams: 200 },
  ]);
  const result = replanWith(corrected);

  assert.equal(result.nothingToChange, false);
  const changedDays = [...new Set(result.changed.map((c) => c.date))].sort();
  assert.ok(changedDays.length >= 1 && changedDays.length <= 5, `changed days: ${changedDays.length}`);
  for (const date of changedDays) assert.ok(date > FROM);

  const satFat = result.effects.find((e) => e.nutrient === 'satFat');
  const change = effectChange('satFat', satFat);
  assert.ok(change < 0, 'the following days are lower in saturated fat');

  const quoted = result.reason.match(/about ([\d.]+) g less per day on average/);
  assert.ok(quoted, `the reason must quote the real change: ${result.reason}`);
  assert.equal(Number(quoted[1]), Number(Math.abs(change).toFixed(1)), result.reason);
  assert.match(result.reason, /You logged .* saturated fat today/i);
});

test('applyLogCorrection saves the correction and opens Plan updated only when the plan changes', () => {
  installMemoryStorage();
  const state = baseState([eatenEntry([PIZZA, ICE])]);
  const ctx = {
    state,
    recipes,
    recipesById,
    foodsById,
    screen: 'plan',
    navigate(name) { this.screen = name; },
  };

  const bigger = updateLogEntryItems(state, 0, [
    { foodId: 'pizza-cheese', grams: 700 },
    { foodId: 'ice-cream-vanilla', grams: 200 },
  ]);
  const changed = applyLogCorrection(ctx, bigger, { fromDate: FROM });
  assert.equal(changed.planChanged, true);
  assert.equal(ctx.screen, 'updated');
  assert.ok(ctx.state.pendingProposal, 'the preview needs the refreshed proposal');
  assert.equal(loadState().log[0].items[0].grams, 700, 'the correction is saved');

  // Removing the only entry leaves nothing to change: the log is saved and the
  // user goes back to the Plan, not to an empty preview.
  const removed = removeLogEntry(ctx.state, 0);
  const unchanged = applyLogCorrection(ctx, removed, { fromDate: FROM });
  assert.equal(unchanged.planChanged, false);
  assert.equal(ctx.screen, 'plan');
  assert.equal(loadState().log.length, 0, 'the corrected log is still persisted');
  assert.equal(loadState().pendingProposal, null);
  clearState();
});
