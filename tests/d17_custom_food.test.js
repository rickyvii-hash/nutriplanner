/**
 * D17 (P1): the user cannot enter a dish of their own.
 *
 * Searching "lasagna", "kebab" or "tiramisu" returns nothing, because a food
 * database cannot hold every dish. Wherever the food search appears (Outside
 * the menu and the Replace "I ate something else" panel) the user can add a
 * food of their own, stored on the device. Its values are the ones typed for
 * one portion, missing nutrients stay null (never zero) and every screen keeps
 * the usual "n/a" / "more than" partial-sum treatment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import { buildPlan, replan, consumedFromLog } from '../src/engine/planner.js';
import {
  foodNutrients, loggedNutrients, formatNutrient,
} from '../src/engine/nutrients.js';
import { searchFoods } from '../src/engine/search.js';
import {
  CUSTOM_NAME_MAX, CUSTOM_KCAL_MAX, DEFAULT_PORTION_LABEL,
  CUSTOM_FORM_NOTE, REMOVED_CUSTOM_LABEL, MAX_PORTIONS,
  validateCustomFood, buildCustomFood, normalizeCustomFoods, nextCustomFoodId,
  customEntryLabel, shownFoodName, gramsForPortions, portionsFromGrams, parsePortions,
  allFoodsWithCustomFoods, foodIndexWithCustomFoods, removeCustomFoodFromList,
  customFoodUsedInLog, customFoodRemovalNote,
} from '../src/engine/custom_foods.js';
import { buildSummary } from '../src/engine/summary.js';
import {
  buildExportPayload, validateImportPayload, applyImportPayload,
} from '../src/engine/export_import.js';
import {
  emptyAppState, startOverState, startOverConfirmCopy, saveState, loadState, clearState,
} from '../src/store.js';
import {
  newLogDraft, draftSavePayload, logEntriesForSave, parsePortion,
} from '../src/ui/log.js';
import { dayProgressTotals } from '../src/ui/plan.js';
import { amountGrams, isUserFood } from '../src/ui/custom_food.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const logSrc = read('src/ui/log.js');
const replaceSrc = read('src/ui/replace_picker.js');
const planSrc = read('src/ui/plan.js');
const formSrc = read('src/ui/custom_food.js');

const recipesById = new Map(recipes.map((r) => [r.id, r]));
const targets = profileById('cholesterol').targets;
const month = { year: 2026, month: 10 };
const plan = buildPlan(targets, recipes, month, new Map(foods.map((f) => [f.id, f])));
const FROM = '2026-10-21';
const when = { date: FROM, time: '13:00' };
/** The mark the app puts in front of a partial sum. */
const PARTIAL_MARK = '≥';

const foodWithFibre = foods.find((f) => f.per100g?.fibre !== null && f.per100g?.fibre !== undefined);

function lasagna(extra = {}) {
  return buildCustomFood({
    name: 'Lasagna', portionLabel: '1 plate', kcal: '450', satFat: '8', protein: '25', ...extra,
  }, []);
}

function memoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

// --- 1) Where the search appears, the form is offered ---------------------

test('D17: both food searches offer "Add my own food" with the small form', () => {
  for (const [name, src] of [['log.js', logSrc], ['replace_picker.js', replaceSrc]]) {
    assert.match(src, />Add my own food<\/button>/, name + ' must offer the link');
    assert.match(src, /createCustomFoodForm\(/, name + ' must mount the shared form');
    assert.match(src, /searchResultRow\(/, name + ' must render results through the shared row');
    assert.match(src, /amountGrams\(/, name + ' must log a custom food by portions');
  }
  // The form itself asks exactly for what the defect lists.
  assert.match(formSrc, /<span>Name<\/span>/);
  assert.match(formSrc, /maxlength="60"/);
  assert.match(formSrc, /Portion description/);
  assert.match(formSrc, /Calories for that portion/);
  for (const label of ['Saturated fat', 'Total fat', 'Protein', 'Fibre', 'Sodium', 'Sugar']) {
    assert.ok(formSrc.includes(label), 'the form must offer ' + label);
  }
  assert.ok(formSrc.includes(CUSTOM_FORM_NOTE), 'the form must carry the estimate note');
  // A custom result can be removed from the list.
  assert.match(formSrc, />Remove<\/button>/);
  assert.match(formSrc, /data-remove-custom/);
});

test('D17: the search explains an empty result instead of failing silently', () => {
  assert.match(logSrc, /data-no-results/);
  assert.match(replaceSrc, /data-no-results/);
  assert.match(formSrc, /No match in the food list/);
});

// --- 2) Validation in plain words ----------------------------------------

test('D17: the name is required and capped at 60 characters', () => {
  const empty = validateCustomFood({ name: '   ', kcal: '400' });
  assert.equal(empty.ok, false);
  assert.match(empty.errors.name, /name/i);

  const tooLong = validateCustomFood({ name: 'x'.repeat(CUSTOM_NAME_MAX + 1), kcal: '400' });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.errors.name, /60/);

  const ok = validateCustomFood({ name: 'Lasagna', kcal: '400' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.portionLabel, DEFAULT_PORTION_LABEL, 'portion description is optional');
});

test('D17: calories are required, a number, above 0 and at most 5000', () => {
  for (const [kcal, pattern] of [
    ['', /calories/i],
    ['abc', /number/i],
    ['0', /more than 0/i],
    ['-20', /more than 0/i],
    [String(CUSTOM_KCAL_MAX + 1), /5000/],
  ]) {
    const check = validateCustomFood({ name: 'Kebab', kcal });
    assert.equal(check.ok, false, 'kcal "' + kcal + '" must be rejected');
    assert.match(check.errors.kcal, pattern);
  }
  assert.equal(validateCustomFood({ name: 'Kebab', kcal: String(CUSTOM_KCAL_MAX) }).ok, true);
});

test('D17: an optional nutrient that is not a number is reported, not ignored', () => {
  const check = validateCustomFood({ name: 'Tiramisu', kcal: '380', satFat: 'lots', sodium: '-3' });
  assert.equal(check.ok, false);
  assert.match(check.errors.satFat, /Saturated fat/);
  assert.match(check.errors.sodium, /Sodium/);
  // Nothing is invented: an empty optional field stays null.
  const clean = validateCustomFood({ name: 'Tiramisu', kcal: '380', satFat: '' });
  assert.equal(clean.ok, true);
  for (const key of ['satFat', 'fat', 'protein', 'fibre', 'sodium', 'sugars', 'carbs']) {
    assert.equal(clean.value.nutrients[key], null, key + ' must stay null');
  }
  assert.equal(clean.value.nutrients.kcal, 380);
});

test('D17: invalid input is never saved silently', () => {
  assert.throws(() => buildCustomFood({ name: '', kcal: '100' }, []), /not valid/i);
  assert.equal(buildCustomFood({ name: 'Kebab', kcal: '600' }, []).id, 'custom-1');
});

// --- 3) Saving, searching and reusing ------------------------------------

test('D17: saving creates custom-<n> with the typed values and null for the rest', () => {
  const first = lasagna();
  assert.equal(first.id, 'custom-1');
  assert.equal(first.custom, true);
  assert.equal(first.name, 'Lasagna');
  assert.equal(first.portionLabel, '1 plate');
  assert.equal(first.per100g.kcal, 450);
  assert.equal(first.per100g.satFat, 8);
  assert.equal(first.per100g.protein, 25);
  for (const key of ['fat', 'carbs', 'fibre', 'sugars', 'sodium']) {
    assert.equal(first.per100g[key], null, key + ' must stay null');
  }

  const second = buildCustomFood({ name: 'Kebab', kcal: '600' }, [first]);
  assert.equal(second.id, 'custom-2');
  assert.equal(nextCustomFoodId([first, second]), 'custom-3');
  // A damaged id is never reused as a made-up number.
  assert.equal(nextCustomFoodId([{ id: 'x' }]), 'custom-1');
});

test('D17: one portion equals exactly what the user typed', () => {
  const food = lasagna();
  const exactly = foodNutrients(food, gramsForPortions(1));
  assert.equal(exactly.kcal, 450);
  assert.equal(exactly.protein, 25);
  assert.equal(exactly.satFat, 8);
  assert.equal(exactly.fibre, null);
  assert.equal(gramsForPortions(1), 100, 'one portion is the nominal 100 g reference');
});

test('D17: the stored food is searchable afterwards and labelled as the user entry', () => {
  const food = lasagna();
  // The defect: nothing in the database matches a dish of your own.
  assert.equal(searchFoods(foods, 'lasagna').length, 0);
  const list = allFoodsWithCustomFoods(foods, [food]);
  const hits = searchFoods(list, 'lasagna');
  assert.ok(hits.some((hit) => hit.id === food.id), 'the saved food must be found');
  assert.equal(shownFoodName(food), 'Lasagna (your entry)');
  assert.equal(customEntryLabel('Lasagna'), 'Lasagna (your entry)');
  assert.ok(food.portionLabel.length > 0, 'the result carries its portion label');
  assert.equal(isUserFood(food), true);
  assert.equal(isUserFood(foods[0]), false);
});

// --- 4) Nutrient maths: one and two portions ------------------------------

test('D17: one and two portions give one and two times the typed values', () => {
  const food = lasagna();
  const map = foodIndexWithCustomFoods(foods, [food]);
  const one = loggedNutrients([{ foodId: food.id, grams: gramsForPortions(1) }], map);
  assert.equal(one.totals.kcal, 450);
  assert.equal(one.totals.protein, 25);
  assert.equal(one.unknown.fibre, true, 'a nutrient never entered stays unknown');

  const two = loggedNutrients([{ foodId: food.id, grams: gramsForPortions(2) }], map);
  assert.equal(two.totals.kcal, 900);
  assert.equal(two.totals.satFat, 16);
  assert.equal(portionsFromGrams(200), 2);
  assert.equal(amountGrams(food, '2', parsePortion), 200);
  assert.equal(amountGrams(food, '0', parsePortion), null);
  assert.equal(amountGrams(foods[0], '150', parsePortion), 150);
  assert.equal(parsePortions('1'), 1);
  assert.equal(parsePortions('0.5'), 0.5);
  assert.equal(parsePortions(''), null);
  assert.equal(parsePortions(String(MAX_PORTIONS + 1)), null);
});

test('D17: a custom food counts in the day totals, with gaps kept partial', () => {
  assert.ok(foodWithFibre, 'data needs a food with a known fibre value');
  const food = lasagna();
  const map = foodIndexWithCustomFoods(foods, [food]);
  const dayLog = [{
    date: FROM,
    time: '13:00',
    extra: true,
    items: [{ foodId: food.id, grams: gramsForPortions(1) }, { foodId: foodWithFibre.id, grams: 100 }],
  }];

  const { result } = dayProgressTotals(plan.days[FROM], dayLog, recipesById, map);
  // Known values add up; a nutrient the user did not enter is a partial sum.
  const expectedKcal = 450 + foodWithFibre.per100g.kcal;
  assert.equal(Number(formatNutrient(result, 'kcal', 0).replace(PARTIAL_MARK, '')), Number(expectedKcal.toFixed(0)));
  assert.ok(formatNutrient(result, 'fibre', 1).startsWith(PARTIAL_MARK), 'fibre is a partial sum');
  // A nutrient missing from every part reads "n/a", never 0.
  const onlyCustom = dayProgressTotals(plan.days[FROM], [dayLog[0]], recipesById, map).result;
  assert.equal(formatNutrient(onlyCustom, 'carbs', 1), 'n/a');
  assert.equal(formatNutrient(onlyCustom, 'kcal', 0), '450');

  // The plan maths sees the same numbers.
  const consumed = consumedFromLog(dayLog, map);
  assert.equal(consumed.kcal, expectedKcal);
});

test('D17: a logged custom food carries its name into the saved entry', () => {
  const food = lasagna();
  const draft = newLogDraft();
  draft.items.push({ foodId: food.id, grams: gramsForPortions(1), name: food.name });
  const payload = draftSavePayload(draft);
  assert.deepEqual(payload.extras, [{ foodId: food.id, grams: 100, name: 'Lasagna' }]);
  const entries = logEntriesForSave(payload, when);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].items, [{ foodId: food.id, grams: 100, name: 'Lasagna' }]);
  assert.equal(entries[0].extra, true);

  const map = foodIndexWithCustomFoods(foods, [food]);
  const result = replan({
    targets,
    recipes,
    plan: buildPlan(targets, recipes, month, new Map(foods.map((f) => [f.id, f]))),
    log: entries,
    bought: [],
    foodsById: map,
    fromDate: FROM,
  });
  assert.ok(result && result.plan, 'the plan is recalculated with the custom food');
});

// --- 5) The doctor summary and the day log list -------------------------

test('D17: the summary labels a custom food "(your entry)"', () => {
  const food = lasagna();
  const map = foodIndexWithCustomFoods(foods, [food]);
  const log = [{
    date: FROM, time: '13:00', extra: true,
    items: [{ foodId: food.id, grams: gramsForPortions(1), name: 'Lasagna' }],
  }];
  const summary = buildSummary({ targets, plan, log, recipesById, foodsById: map });
  const names = summary.meals.flatMap((meal) => meal.items.map((item) => item.name));
  assert.ok(names.includes('Lasagna (your entry)'), 'summary names: ' + names.join(' | '));
  assert.ok(summary.averages.kcal > 0, 'the custom food feeds the averages');
  const kcalRow = summary.rows.find((row) => row.nutrient === 'kcal');
  assert.ok(kcalRow.status.length > 0);
  // The screen prints the engine label as it is.
  assert.match(read('src/ui/summary.js'), /item\.custom/);
});

test('D17: the day log list shows the custom food with its portions', () => {
  assert.match(planSrc, /shownFoodName\(/);
  assert.match(planSrc, /portionsFromGrams\(/);
  assert.match(planSrc, /data-correct-portions/);
});

// --- 6) Backup, Start over, removed definitions --------------------------

test('D17: export and restore carry custom foods; older backups still restore', () => {
  memoryStorage();
  clearState();
  const food = lasagna();
  const state = { ...emptyAppState(), profileId: 'cholesterol', customFoods: [food] };
  saveState(state);
  const loaded = loadState();
  assert.equal(loaded.customFoods.length, 1);
  assert.equal(loaded.customFoods[0].name, 'Lasagna');
  assert.equal(loaded.customFoods[0].per100g.kcal, 450);

  const payload = buildExportPayload(loaded);
  assert.equal(payload.customFoods.length, 1);
  assert.equal(validateImportPayload(payload).ok, true);
  const restored = applyImportPayload(emptyAppState(), payload);
  assert.equal(restored.customFoods.length, 1);
  assert.equal(restored.customFoods[0].id, 'custom-1');
  assert.equal(restored.customFoods[0].per100g.satFat, 8);
  assert.equal(restored.customFoods[0].per100g.fibre, null);

  // An older backup has no customFoods: it still restores, with none.
  const older = { ...payload };
  delete older.customFoods;
  assert.equal(validateImportPayload(older).ok, true);
  assert.deepEqual(applyImportPayload(emptyAppState(), older).customFoods, []);

  // A damaged customFoods field is refused in plain words, not half-applied.
  const broken = { ...payload, customFoods: 'nope' };
  const check = validateImportPayload(broken);
  assert.equal(check.ok, false);
  assert.match(check.message, /foods you added/i);
  clearState();
});

test('D17: Start over clears the foods the user added', () => {
  const fresh = startOverState();
  assert.deepEqual(fresh.customFoods, []);
  const copy = startOverConfirmCopy();
  assert.match(copy.items.join(' '), /yourself/i);
});

test('D17: a log entry whose custom food is gone never crashes', () => {
  const log = [{
    date: FROM, time: '13:00', extra: true,
    items: [{ foodId: 'custom-9', grams: 100, name: 'Tiramisu' }],
  }];
  // No definition saved: the index still resolves the id, with every value unknown.
  const map = foodIndexWithCustomFoods(foods, [], log);
  assert.ok(map.get('custom-9'));
  let nutrients;
  assert.doesNotThrow(() => { nutrients = loggedNutrients(log[0].items, map); });
  assert.equal(formatNutrient(nutrients, 'kcal'), 'n/a');
  assert.doesNotThrow(() => dayProgressTotals(plan.days[FROM], log, recipesById, map));
  assert.doesNotThrow(() => consumedFromLog(log, map));
  const summary = buildSummary({ targets, plan, log, recipesById, foodsById: map });
  const names = summary.meals.flatMap((meal) => meal.items.map((item) => item.name));
  assert.ok(names.some((name) => /Tiramisu/.test(name)), 'the stored name is shown');

  // Without a stored name the entry reads "Removed custom food".
  const noName = foodIndexWithCustomFoods(foods, [], [{
    date: FROM, items: [{ foodId: 'custom-10', grams: 100 }],
  }]);
  assert.equal(noName.get('custom-10').name, REMOVED_CUSTOM_LABEL);
  assert.equal(shownFoodName(noName.get('custom-10')), REMOVED_CUSTOM_LABEL);
});

test('D17: removing a custom food keeps the past logs and says so', () => {
  const food = lasagna();
  const log = [{ date: FROM, time: '13:00', items: [{ foodId: food.id, grams: 100, name: 'Lasagna' }] }];
  assert.equal(customFoodUsedInLog(log, food.id), true);
  assert.equal(customFoodUsedInLog([], food.id), false);
  assert.deepEqual(removeCustomFoodFromList([food], food.id), []);
  assert.equal(log.length, 1, 'the past log entry stays');
  assert.match(customFoodRemovalNote('Lasagna', true), /past logs/i);
  assert.doesNotMatch(customFoodRemovalNote('Lasagna', false), /past logs/i);
});

test('D17: damaged saved custom foods are cleaned, never invented', () => {
  const cleaned = normalizeCustomFoods([
    null,
    { name: '', per100g: {} },
    { id: 'custom-1', name: 'Kebab', portionLabel: '', per100g: { kcal: 'x', protein: 30 } },
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].portionLabel, DEFAULT_PORTION_LABEL);
  assert.equal(cleaned[0].nutrients.protein, 30);
  assert.equal(cleaned[0].nutrients.kcal, null);
  assert.equal(cleaned[0].nutrients.sodium, null);
  assert.deepEqual(normalizeCustomFoods(undefined), []);
});
