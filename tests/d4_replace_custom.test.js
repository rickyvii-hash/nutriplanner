import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import {
  buildPlan, replan, effectChange,
} from '../src/engine/planner.js';
import { recipeNutrients, loggedNutrients } from '../src/engine/nutrients.js';
import {
  proposalToStore, pendingProposalForPlan, withoutPendingProposal, saveState, loadState, clearState,
} from '../src/store.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const replacePickerSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'replace_picker.js'), 'utf8');
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const month = { year: 2026, month: 10 };
const FROM = '2026-10-21';

const known = (food, key) => food.per100g?.[key] !== null && food.per100g?.[key] !== undefined;
const highSatFatFood = foods.filter((f) => known(f, 'satFat')).sort((a, b) => b.per100g.satFat - a.per100g.satFat)[0];
const lightFoods = foods
  .filter((f) => known(f, 'kcal') && f.per100g.kcal > 0)
  .sort((a, b) => a.per100g.kcal - b.per100g.kcal)
  .slice(0, 2);

/** Log free-search foods the way the "I ate something else" path does. */
function runCustomReplacement(profileId, items, name) {
  const targets = profileById(profileId).targets;
  const plan = buildPlan(targets, recipes, month, foodsById);
  const plannedId = plan.days[FROM].lunch;
  const entry = {
    date: FROM,
    time: '13:00',
    items,
    replaced: [{ slot: 'lunch', fromRecipeId: plannedId, recipeId: null, name }],
  };
  const result = replan({
    targets, recipes, plan, log: [entry], bought: [], foodsById, fromDate: FROM,
  });
  return { targets, plan, plannedId, entry, result };
}

const effectOf = (result, key) => result.effects.find((e) => e.nutrient === key);

test('the day-screen Replace picker offers "I ate something else" with the free-search path', () => {
  assert.match(replacePickerSrc, /I ate something else/);
  assert.match(replacePickerSrc, /data-ate-elsewhere/);
  assert.match(replacePickerSrc, /searchFoods\(/);
  assert.match(replacePickerSrc, /replaced: \[\{ slot, fromRecipeId: currentRecipe\?\.id \|\| null, recipeId: null, name \}\]/);
});

test('Cholesterol: replacing lunch with a high-satFat free food quotes the Effect row delta', () => {
  assert.ok(highSatFatFood, 'need a food with a known saturated fat value');
  const items = [{ foodId: highSatFatFood.id, grams: 100 }];
  const scenario = runCustomReplacement('cholesterol', items, highSatFatFood.name);
  const { result, plannedId } = scenario;

  // The replacement is logged as food, never as a skipped planned meal.
  assert.equal(result.skippedNames.length, 0);
  assert.equal(result.replacements.length, 1);
  assert.equal(result.replacements[0].custom, true);
  assert.equal(result.replacements[0].recipeId, null);
  assert.equal(result.replacements[0].plannedId, plannedId);
  assert.equal(result.replacements[0].slot, 'lunch');

  const after = loggedNutrients(items, foodsById).totals.satFat;
  const before = recipeNutrients(recipesById.get(plannedId), foodsById).totals.satFat;
  assert.ok(after > before, 'the free food must be richer in saturated fat than the plan');
  assert.ok(result.replacementOver.satFat > 0, 'the swap must feed the window rules');

  const primary = result.replacementPrimary;
  assert.ok(primary, 'the replacement must name the nutrient its reason quotes');
  assert.equal(primary.nutrient, 'satFat');
  assert.equal(primary.kind, 'max');
  const change = effectChange('satFat', effectOf(result, 'satFat'));
  assert.ok(change < 0, 'the following days are lower in saturated fat');

  const quoted = result.reason.match(/about ([\d.]+) g less per day on average/);
  assert.ok(quoted, 'the reason must quote the per-day change: ' + result.reason);
  assert.equal(Number(quoted[1]), Number(Math.abs(change).toFixed(1)), result.reason);
  assert.match(result.reason, /swapped lunch for/i);
  assert.match(result.reason, /lower in saturated fat/i);

  const changedDays = [...new Set(result.changed.map((c) => c.date))].sort();
  assert.ok(changedDays.length >= 1 && changedDays.length <= 5, 'changed days: ' + changedDays.length);
  for (const date of changedDays) assert.ok(date > FROM, date + ' must be after the log date');
});

test('Recovery: replacing lunch with a lighter custom set raises calories and the effect agrees', () => {
  assert.equal(lightFoods.length, 2, 'need two light foods');
  const items = lightFoods.map((f) => ({ foodId: f.id, grams: 150 }));
  const scenario = runCustomReplacement('recovery', items, lightFoods[0].name);
  const { result, plannedId } = scenario;

  assert.equal(result.skippedNames.length, 0);
  assert.equal(result.replacements.length, 1);
  assert.equal(result.replacements[0].custom, true);

  const after = loggedNutrients(items, foodsById).totals.kcal;
  const before = recipeNutrients(recipesById.get(plannedId), foodsById).totals.kcal;
  assert.ok(after < before, 'the custom meal must be lighter than the planned lunch');
  assert.ok(result.replacementUnder.kcal > 0, 'the lighter swap must feed the window rules');

  const primary = result.replacementPrimary;
  assert.ok(primary);
  assert.equal(primary.nutrient, 'kcal');
  assert.equal(primary.kind, 'min');
  const change = effectChange('kcal', effectOf(result, 'kcal'));
  assert.ok(change > 0, 'the following days are higher in calories');

  const quoted = result.reason.match(/about ([\d.]+) kcal more per day on average/);
  assert.ok(quoted, 'the reason must quote the per-day change: ' + result.reason);
  assert.equal(Number(quoted[1]), Number(Math.abs(change).toFixed(0)), result.reason);
  assert.match(result.reason, /swapped lunch for/i);
  assert.match(result.reason, /higher in calories/i);
});

test('Keep original leaves the plan identical; Use updated persists via proposalToStore', () => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };

  const items = [{ foodId: highSatFatFood.id, grams: 100 }];
  const scenario = runCustomReplacement('cholesterol', items, highSatFatFood.name);
  const before = structuredClone(scenario.plan);
  const used = scenario.result.plan;

  // replan never mutates the plan it was given.
  assert.deepEqual(scenario.plan, before, 'replan changed the original plan');
  assert.notDeepEqual(used.days, before.days, 'the proposal must differ');

  // Keep original: drop the stored proposal and leave state.plan as it was.
  const state = {
    profileId: 'cholesterol',
    targets: scenario.targets,
    plan: scenario.plan,
    log: [],
    bought: [],
    keptForBought: [],
    shopEvery: 7,
    shopStart: FROM,
    pendingProposal: proposalToStore(scenario.result),
  };
  const kept = withoutPendingProposal(state);
  assert.equal(kept.pendingProposal, null);
  assert.deepEqual(kept.plan, before, 'keeping the original keeps every day');

  // Use updated: the stored proposal round-trips through the browser storage.
  const stored = { ...state, pendingProposal: proposalToStore(scenario.result) };
  saveState(stored);
  const loaded = loadState();
  const pending = pendingProposalForPlan(loaded);
  assert.ok(pending, 'the proposal must still be there after a reload');
  assert.equal(pending.reason, scenario.result.reason);
  assert.deepEqual(pending.plan.days, used.days);
  assert.deepEqual(pendingProposalForPlan({ plan: used, pendingProposal: pending }).plan.days, used.days);
  clearState();
});
