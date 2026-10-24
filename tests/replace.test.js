import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { profileById } from '../src/engine/profiles.js';
import {
  buildPlan, replan, effectChange,
} from '../src/engine/planner.js';
import { recipeNutrients } from '../src/engine/nutrients.js';
import {
  proposalToStore, pendingProposalForPlan, withoutPendingProposal, saveState, loadState, clearState,
} from '../src/store.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const month = { year: 2026, month: 10 };
const FROM = '2026-10-21';

const totalsOf = (id) => recipeNutrients(recipesById.get(id), foodsById).totals;
const byNutrient = (key) => (a, b) => totalsOf(b.id)[key] - totalsOf(a.id)[key];

/** Log a meal the way the Replace button does: its ingredients plus the swapped slot. */
function runReplacement(profileId, pick) {
  const targets = profileById(profileId).targets;
  const plan = buildPlan(targets, recipes, month, foodsById);
  const plannedId = plan.days[FROM].lunch;
  const options = recipes.filter((r) => r.slot === 'lunch' && r.id !== plannedId);
  const replacement = pick(options);
  const entry = {
    date: FROM,
    time: '13:00',
    items: replacement.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
    replaced: [{ slot: 'lunch', recipeId: replacement.id, fromRecipeId: plannedId }],
  };
  return {
    targets,
    plan,
    plannedId,
    replacement,
    log: [entry],
    result: replan({ targets, recipes, plan, log: [entry], bought: [], foodsById, fromDate: FROM }),
  };
}

/** The first "about X unit more/less per day on average" phrase in the reason. */
function quotedPerDay(reason) {
  const match = reason.match(/about ([\d.]+) (kcal|g|mg) (more|less) per day on average/);
  if (!match) return null;
  return { amount: Number(match[1]), unit: match[2], direction: match[3] };
}

function assertReasonQuotesPrimary({ result }) {
  const primary = result.replacementPrimary;
  assert.ok(primary, 'a replacement must name the nutrient its reason quotes');
  const effect = result.effects.find((e) => e.nutrient === primary.nutrient);
  assert.ok(effect, `no effect row for ${primary.nutrient}`);
  const change = effectChange(primary.nutrient, effect);
  assert.notEqual(change, 0, 'the chosen swap must move the primary target');
  const quoted = quotedPerDay(result.reason);
  assert.ok(quoted, `the reason must quote a per-day change: ${result.reason}`);
  assert.equal(quoted.amount, Number(Math.abs(change).toFixed(1)), result.reason);
  assert.equal(quoted.direction, change < 0 ? 'less' : 'more', result.reason);
  assert.ok(result.reason.includes(
    `about ${quoted.amount} ${quoted.unit} ${quoted.direction} per day on average`,
  ), result.reason);
  return { primary, effect, change };
}

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

function stateWith(result) {
  return {
    profileId: 'cholesterol',
    targets: profileById('cholesterol').targets,
    plan: result.plan,
    log: [],
    bought: [],
    keptForBought: [],
    shopEvery: 7,
    shopStart: FROM,
    pendingProposal: null,
  };
}

test('Cholesterol: replacing lunch with a satFat-richer recipe quotes the Effect row delta', () => {
  const scenario = runReplacement('cholesterol', (options) => options.sort(byNutrient('satFat'))[0]);
  const { result } = scenario;
  assert.ok(totalsOf(scenario.replacement.id).satFat > totalsOf(scenario.plannedId).satFat);

  assert.equal(result.nothingToChange, false);
  const changedDays = [...new Set(result.changed.map((c) => c.date))].sort();
  assert.ok(changedDays.length >= 1 && changedDays.length <= 5, `changed days: ${changedDays.length}`);
  for (const d of changedDays) assert.ok(d > FROM, `${d} must be after the log date`);

  const { primary, effect, change } = assertReasonQuotesPrimary({ result });
  assert.equal(primary.nutrient, 'satFat');
  assert.equal(primary.kind, 'max');
  assert.ok(change < 0, 'the following days are lower in saturated fat');
  assert.match(result.reason, /swapped lunch for/i);
  assert.match(result.reason, /lower in saturated fat/i);

  // The replaced meal is eaten, never marked skipped.
  assert.deepEqual(result.skippedNames, []);
  assert.equal(result.replacements.length, 1);
  assert.equal(result.replacements[0].recipeId, scenario.replacement.id);
  assert.equal(result.replacements[0].plannedId, scenario.plannedId);
});

test('Recovery: replacing lunch with a lighter recipe raises calories and quotes the Effect row delta', () => {
  const scenario = runReplacement('recovery', (options) => options.sort(byNutrient('kcal')).at(-1));
  const { result } = scenario;
  assert.ok(totalsOf(scenario.replacement.id).kcal < totalsOf(scenario.plannedId).kcal);

  assert.equal(result.nothingToChange, false);
  const changedDays = [...new Set(result.changed.map((c) => c.date))].sort();
  assert.ok(changedDays.length >= 1 && changedDays.length <= 5, `changed days: ${changedDays.length}`);
  for (const d of changedDays) assert.ok(d > FROM);

  const { primary, effect, change } = assertReasonQuotesPrimary({ result });
  assert.equal(primary.nutrient, 'kcal');
  assert.equal(primary.kind, 'min');
  assert.ok(change > 0, 'the following days are higher in calories');
  assert.match(result.reason, /higher in calories/i);
  assert.match(result.reason, /swapped lunch/i);
  assert.deepEqual(result.skippedNames, []);
});

test('Keep original: discarding the proposal leaves the plan days identical', () => {
  for (const profileId of ['cholesterol', 'recovery']) {
    const scenario = profileId === 'cholesterol'
      ? runReplacement(profileId, (options) => options.sort(byNutrient('satFat'))[0])
      : runReplacement(profileId, (options) => options.sort(byNutrient('kcal')).at(-1));
    const before = structuredClone(scenario.plan);

    // replan never mutates the plan it was given.
    assert.deepEqual(scenario.plan, before, `${profileId}: replan changed the original plan`);
    assert.notDeepEqual(scenario.result.plan.days, before.days, `${profileId}: the proposal must differ`);

    // Keep original = drop the stored proposal and leave state.plan as it was.
    const state = { ...stateWith(scenario.result), plan: scenario.plan, pendingProposal: proposalToStore(scenario.result) };
    const kept = withoutPendingProposal(state);
    assert.equal(kept.pendingProposal, null);
    assert.deepEqual(kept.plan, before, `${profileId}: keeping the original keeps every day`);
  }
});

test('Use updated: the plan changes and the stored proposal round-trips', () => {
  installMemoryStorage();
  for (const profileId of ['cholesterol', 'recovery']) {
    const scenario = profileId === 'cholesterol'
      ? runReplacement(profileId, (options) => options.sort(byNutrient('satFat'))[0])
      : runReplacement(profileId, (options) => options.sort(byNutrient('kcal')).at(-1));
    const before = structuredClone(scenario.plan);
    const used = scenario.result.plan;

    // The changed meals are in the window and the plan really changes.
    assert.ok(scenario.result.changed.length > 0, `${profileId}: nothing changed`);
    for (const c of scenario.result.changed) assert.notEqual(used.days[c.date][c.slot], before.days[c.date][c.slot]);
    assert.notDeepEqual(used.days, before.days, `${profileId}: using the update must change the plan`);

    const state = { ...stateWith(scenario.result), pendingProposal: proposalToStore(scenario.result) };
    saveState(state);
    const loaded = loadState();
    const pending = pendingProposalForPlan(loaded);
    assert.ok(pending, `${profileId}: the proposal must still be there after a reload`);
    assert.equal(pending.reason, scenario.result.reason);
    assert.equal(pending.effects.length, scenario.result.effects.length);
    assert.deepEqual(pending.plan.days, used.days);
    assert.equal(pending.replacementPrimary, undefined, 'only the fields the screen needs are stored');

    // Applying the proposal is exactly "Use updated plan".
    assert.deepEqual(pendingProposalForPlan({ plan: used, pendingProposal: pending }).plan.days, used.days);
    clearState();
  }
});
