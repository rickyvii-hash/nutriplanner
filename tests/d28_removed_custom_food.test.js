/**
 * D28 (P0): removing a food the person added must never break the plan.
 *
 * A custom food can be used by a past log entry or by a planned outside-the-menu
 * meal. Removing it from the search results keeps its definition for whatever
 * already uses it (hidden from search and pickers, still resolving by id), so a
 * replan after a skip, a meal or an extra never throws. As a second line of
 * defence, any unknown food id (a removed custom food with no definition left,
 * or a database food missing from an older backup) resolves to unknown nutrients,
 * shown as "n/a" or a partial sum, never as zero and never as a crash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import { buildPlan, replan } from '../src/engine/planner.js';
import { loggedNutrients, formatNutrient } from '../src/engine/nutrients.js';
import { searchFoods } from '../src/engine/search.js';
import {
  REMOVED_CUSTOM_LABEL, buildCustomFood, shownFoodName,
  allFoodsWithCustomFoods, foodIndexWithCustomFoods, removeCustomFoodFromList,
  customFoodUsedInPlannedExtras, customFoodRemovalNote,
} from '../src/engine/custom_foods.js';
import { buildSummary } from '../src/engine/summary.js';
import { buildShoppingList } from '../src/engine/shopping.js';
import { makePlannedExtra } from '../src/engine/planned_extras.js';
import { dayProgressTotals } from '../src/ui/plan.js';
import {
  buildExportPayload, validateImportPayload, applyImportPayload,
} from '../src/engine/export_import.js';
import { emptyAppState } from '../src/store.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const targets = profileById('cholesterol').targets;
const MONTH = { year: 2026, month: 10 };
const FROM = '2026-10-24';
const PLANNED_DATE = '2026-10-26';
const PIZZA = 'pizza-cheese';

function tiramisu(extra = {}) {
  return buildCustomFood({
    name: 'Tiramisu', portionLabel: '1 slice', kcal: '380', satFat: '18', protein: '6', ...extra,
  }, []);
}

function plannedDinner(foodId, { id = 'planned-1', name = 'Tiramisu' } = {}) {
  return makePlannedExtra({
    id,
    date: PLANNED_DATE,
    time: '20:00',
    items: [{ foodId, grams: 100, name }],
  });
}

function basePlan() {
  return buildPlan(targets, recipes, MONTH, foodsById);
}

function planWith(state) {
  return replan({
    targets,
    recipes,
    plan: basePlan(),
    log: [],
    bought: [],
    fromDate: FROM,
    logFromDate: FROM,
    ...state,
  });
}

// --- 1) Removing a used custom food keeps what already uses it ------------

test('D28: a custom food used by a planned meal is hidden, not deleted', () => {
  const food = tiramisu();
  const plannedExtras = [plannedDinner(food.id)];
  assert.equal(customFoodUsedInPlannedExtras(plannedExtras, food.id), true);
  assert.equal(customFoodUsedInPlannedExtras([], food.id), false);

  const kept = removeCustomFoodFromList([food], food.id, { log: [], plannedExtras });
  assert.equal(kept.length, 1, 'the definition stays for what already uses it');
  assert.equal(kept[0].id, food.id);
  assert.equal(kept[0].removedFromList, true, 'it is marked as removed from the list');

  // Hidden from search and from the list the pickers read.
  const searchable = allFoodsWithCustomFoods(foods, kept);
  assert.ok(!searchable.some((item) => item.id === food.id), 'a removed food is not offered again');
  assert.equal(searchFoods(searchable, 'Tiramisu').length, 0);

  // Still resolving by id, with the values the person typed.
  const map = foodIndexWithCustomFoods(foods, kept, [], plannedExtras);
  assert.equal(map.get(food.id).per100g.kcal, 380);
  assert.equal(shownFoodName(map.get(food.id)), 'Tiramisu (your entry)');
});

test('D28: the removal note says the food stays in the log and planned meals', () => {
  assert.match(customFoodRemovalNote('Tiramisu', true), /It stays in your log and planned meals\./);
  assert.doesNotMatch(customFoodRemovalNote('Tiramisu', false), /It stays in your log and planned meals\./);
  // The existing promise about past logs is still kept.
  assert.match(customFoodRemovalNote('Tiramisu', true), /past logs/i);
});

test('D28: a removed food nothing uses really disappears', () => {
  const food = buildCustomFood({ name: 'Kebab', kcal: '600' }, []);
  const gone = removeCustomFoodFromList([food], food.id, { log: [], plannedExtras: [] });
  assert.deepEqual(gone, []);
  assert.ok(!allFoodsWithCustomFoods(foods, gone).some((item) => item.id === food.id));
  assert.equal(foodIndexWithCustomFoods(foods, gone, [], []).has(food.id), false);
});

// --- 2) The replan after removing it never throws and still recomputes ----

test('D28: replan after removing a planned custom food: skip, eat, extra', () => {
  const food = tiramisu();
  const plannedExtras = [plannedDinner(food.id)];
  const kept = removeCustomFoodFromList([food], food.id, { log: [], plannedExtras });
  const map = foodIndexWithCustomFoods(foods, kept, [], plannedExtras);
  const day = basePlan().days[FROM];

  const scenarios = {
    'skip a meal': [{
      date: FROM,
      time: '12:00',
      skipped: [day.lunch],
      skippedSlots: [{ recipeId: day.lunch, slot: 'lunch' }],
    }],
    'eat a meal': [{
      date: FROM,
      time: '13:00',
      extra: true,
      items: [{ foodId: PIZZA, grams: 300 }],
    }],
    'log an extra': [{
      date: FROM,
      time: '16:00',
      extra: true,
      items: [{ foodId: food.id, grams: 100, name: 'Tiramisu' }],
    }],
  };

  for (const [name, log] of Object.entries(scenarios)) {
    let result;
    assert.doesNotThrow(() => {
      result = planWith({ log, plannedExtras, foodsById: map });
    }, name + ' must not throw');
    assert.ok(result && result.plan && result.plan.days, name + ' still recomputes');
    assert.equal(Object.keys(result.plan.days).length, Object.keys(basePlan().days).length);
    assert.ok(Array.isArray(result.effects), name + ' still reports the effect');
  }
});

// --- 3) Defence in depth: a truly missing definition ----------------------

test('D28: a planned meal pointing to a gone custom food is unknown, not a crash', () => {
  const plannedExtras = [plannedDinner('custom-99', { name: '' })];
  const map = foodIndexWithCustomFoods(foods, [], [], plannedExtras);
  assert.ok(map.get('custom-99'), 'the planned id still resolves to a placeholder');
  assert.equal(shownFoodName(map.get('custom-99')), REMOVED_CUSTOM_LABEL);

  const nutrients = loggedNutrients(plannedExtras[0].items, map);
  assert.equal(formatNutrient(nutrients, 'kcal'), 'n/a');
  assert.equal(formatNutrient(nutrients, 'protein'), 'n/a');

  let result;
  assert.doesNotThrow(() => { result = planWith({ log: [], plannedExtras, foodsById: map }); });
  assert.ok(result.plan, 'the plan is still produced');
});

test('D28: an unknown database food id does not throw and counts as unknown', () => {
  const log = [{
    date: FROM, time: '13:00', extra: true, items: [{ foodId: 'old-db-food', grams: 100 }],
  }];
  const map = foodIndexWithCustomFoods(foods, [], log, []);
  assert.ok(map.get('old-db-food'), 'an unknown database id resolves to a placeholder');
  assert.equal(shownFoodName(map.get('old-db-food')), REMOVED_CUSTOM_LABEL);

  const nutrients = loggedNutrients(log[0].items, map);
  assert.equal(formatNutrient(nutrients, 'kcal'), 'n/a');

  assert.doesNotThrow(() => planWith({ log, plannedExtras: [], foodsById: map }));
  assert.doesNotThrow(() => buildSummary({
    targets, plan: basePlan(), log, recipesById, foodsById: map,
  }));
  assert.doesNotThrow(() => buildShoppingList({
    plan: basePlan(), recipes, foodsById: map, fromDate: FROM,
  }));
});

// --- 4) Summary and day screen labels -------------------------------------

test('D28: the summary shows the kept name, and "Removed custom food" only when truly gone', () => {
  const food = tiramisu();
  const log = [{
    date: FROM, time: '13:00', extra: true,
    items: [{ foodId: food.id, grams: 100, name: 'Tiramisu' }],
  }];

  // Definition kept: the real name is shown and its values feed the averages.
  const plannedExtras = [plannedDinner(food.id)];
  const kept = removeCustomFoodFromList([food], food.id, { log, plannedExtras });
  const keptMap = foodIndexWithCustomFoods(foods, kept, log, plannedExtras);
  const keptSummary = buildSummary({ targets, plan: basePlan(), log, recipesById, foodsById: keptMap });
  const keptNames = keptSummary.meals.flatMap((meal) => meal.items.map((item) => item.name));
  assert.ok(keptNames.includes('Tiramisu (your entry)'), 'names: ' + keptNames.join(' | '));
  assert.ok(!keptNames.includes(REMOVED_CUSTOM_LABEL));
  assert.equal(keptSummary.averages.kcal, 380);

  // Definition truly gone: a log line with no stored name reads "Removed custom food".
  const goneLog = [{ date: FROM, time: '13:00', extra: true, items: [{ foodId: 'custom-77', grams: 100 }] }];
  const goneMap = foodIndexWithCustomFoods(foods, [], goneLog, []);
  const goneSummary = buildSummary({ targets, plan: basePlan(), log: goneLog, recipesById, foodsById: goneMap });
  const goneNames = goneSummary.meals.flatMap((meal) => meal.items.map((item) => item.name));
  assert.ok(goneNames.includes(REMOVED_CUSTOM_LABEL), 'names: ' + goneNames.join(' | '));
  assert.equal(goneSummary.averages.kcal, null, 'an unknown food never becomes a zero average');
});

test('D28: the day screen progress shows n/a, never zero, for an unknown food', () => {
  const goneLog = [{ date: FROM, time: '13:00', extra: true, items: [{ foodId: 'custom-77', grams: 100 }] }];
  const map = foodIndexWithCustomFoods(foods, [], goneLog, []);
  const { result } = dayProgressTotals(basePlan().days[FROM], goneLog, recipesById, map);
  assert.equal(formatNutrient(result, 'kcal'), 'n/a');
  assert.equal(formatNutrient(result, 'protein'), 'n/a');
});

// --- 5) Backup whose planned extra refers to a missing food ---------------

test('D28: export and restore of a backup with a missing planned food does not throw', () => {
  const state = {
    ...emptyAppState(),
    profileId: 'cholesterol',
    customFoods: [],
    plannedExtras: [plannedDinner('custom-1', { name: '' })],
  };
  const payload = buildExportPayload(state);
  assert.equal(validateImportPayload(payload).ok, true, 'the backup is still valid');
  const restored = applyImportPayload(emptyAppState(), payload);
  assert.equal(restored.plannedExtras.length, 1);

  const map = foodIndexWithCustomFoods(
    foods, restored.customFoods, restored.log, restored.plannedExtras,
  );
  assert.ok(map.get('custom-1'));
  assert.equal(shownFoodName(map.get('custom-1')), REMOVED_CUSTOM_LABEL);
  assert.doesNotThrow(() => planWith({
    log: restored.log, plannedExtras: restored.plannedExtras, foodsById: map,
  }));
});

test('D28: a kept (hidden) definition survives save, export and restore', () => {
  const food = tiramisu();
  const kept = removeCustomFoodFromList([food], food.id, {
    log: [], plannedExtras: [plannedDinner(food.id)],
  });
  const payload = buildExportPayload({ ...emptyAppState(), customFoods: kept });
  assert.equal(payload.customFoods.length, 1);
  assert.equal(payload.customFoods[0].removedFromList, true, 'the hidden flag travels with the backup');
  const restored = applyImportPayload(emptyAppState(), payload);
  assert.equal(restored.customFoods.length, 1);
  assert.equal(restored.customFoods[0].removedFromList, true);
  assert.ok(!allFoodsWithCustomFoods(foods, restored.customFoods).some((item) => item.id === food.id));
  assert.equal(foodIndexWithCustomFoods(foods, restored.customFoods, [], []).get(food.id).per100g.kcal, 380);
});