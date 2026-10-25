/**
 * D22 (P1): food added outside the menu on the same day must reduce the minimum
 * make-up the replan asks for. Skipping a meal and then eating pizza must not ask
 * the next days to replace energy the person already ate.
 *
 * Rules checked here:
 *  - the minimum shortfall of a date is reduced by the same nutrient eaten as extras
 *    on that same date, never below zero (unknown extras count as zero);
 *  - the reason says it, with the exact "after the food you added outside the menu"
 *    wording when part remains, and the "already covers what you skipped" sentence
 *    when the extras cover it all;
 *  - the quoted per-day change still equals the Effect row change;
 *  - maximum-target logic is left alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { profileById, PROFILES } from '../src/engine/profiles.js';
import { buildPlan, replan, effectChange } from '../src/engine/planner.js';
import { recipeNutrients, loggedNutrients } from '../src/engine/nutrients.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

const MONTH = { year: 2026, month: 10 };
const FROM = '2026-10-21';

const COVERED_SENTENCE = 'The food you added outside the menu already covers what you skipped.';
const EXTRA_FOOD = {
  kcal: 'pizza-cheese',
  protein: 'chicken-breast-roasted',
  fibre: 'wheat-bran',
  fat: 'olive-oil',
};

function build(profileId) {
  return buildPlan(profileById(profileId).targets, recipes, MONTH, foodsById);
}

function run(profileId, plan, log, options = {}) {
  return replan({
    targets: profileById(profileId).targets,
    recipes,
    plan,
    log,
    bought: [],
    foodsById,
    fromDate: FROM,
    ...options,
  });
}

function skipEntry(date, recipeIds) {
  return { date, time: '09:00', skipped: recipeIds, items: [] };
}

function extraEntry(date, items) {
  return { date, time: '20:00', extra: true, items };
}

function replacementEntry(date, slot, plannedId, recipe) {
  return {
    date,
    time: '13:00',
    items: recipe.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
    replaced: [{ slot, recipeId: recipe.id, fromRecipeId: plannedId }],
  };
}

const totalsOfRecipe = (id) => recipeNutrients(recipesById.get(id), foodsById).totals;

/** Same choice the replan makes for the shortfall it names first. */
function pickPrimary(result, targets) {
  let pick = null;
  let best = -Infinity;
  for (const t of targets) {
    if (t.kind !== 'min') continue;
    const missed = result.shortfall?.[t.nutrient] || 0;
    if (missed <= 0) continue;
    const score = missed / t.daily + (t.nutrient === 'kcal' ? 2 : 0);
    if (score > best) {
      best = score;
      pick = { target: t, missed };
    }
  }
  return pick;
}

/** The "(about X of Y, after the food you added outside the menu)" phrase. */
function offsetPhrase(reason) {
  const m = reason.match(
    /\(about ([\d.]+) (kcal|g|mg) of ([\d.]+) (kcal|g|mg), after the food you added outside the menu\)/,
  );
  return m ? { left: Number(m[1]), unit: m[2], total: Number(m[3]) } : null;
}

function decimalsFor(nutrient) {
  return nutrient === 'kcal' || nutrient === 'sodium' ? 0 : 1;
}

/** Number exactly as formatAmount prints it. */
function shown(nutrient, value) {
  return Number(Number(value || 0).toFixed(decimalsFor(nutrient)));
}

function gramsFor(foodId, nutrient, amount) {
  const per100 = foodsById.get(foodId).per100g[nutrient];
  assert.ok(per100 > 0, `${foodId} needs a known ${nutrient}`);
  return (amount * 100) / per100;
}

// --- D22 headline cases -----------------------------------------------------

test('D22: a lighter swap plus food outside the menu makes up only the remaining energy', () => {
  const profileId = 'recovery';
  const plan = build(profileId);

  // Find any planned meal a lighter recipe of the same slot can replace.
  let scene = null;
  for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
    const plannedId = plan.days[FROM][slot];
    const plannedKcal = totalsOfRecipe(plannedId).kcal;
    const lighter = recipes
      .filter((r) => r.slot === slot && r.id !== plannedId)
      .filter((r) => totalsOfRecipe(r.id).kcal < plannedKcal - 1)
      .sort((a, b) => totalsOfRecipe(b.id).kcal - totalsOfRecipe(a.id).kcal)[0];
    if (lighter) {
      scene = { slot, plannedId, lighter, plannedKcal };
      break;
    }
  }
  assert.ok(scene, 'the fixture needs one lighter recipe in a planned slot');

  const replacement = replacementEntry(FROM, scene.slot, scene.plannedId, scene.lighter);
  const base = run(profileId, plan, [replacement]);
  assert.ok(base.shortfall.kcal > 0, 'the lighter swap leaves energy to make up');

  // About 1000 kcal of pizza and cola, more than the swap removed.
  const extras = [
    { foodId: 'pizza-cheese', grams: 300 },
    { foodId: 'beverages-carbonated-cola-regular', grams: 500 },
  ];
  const extraKcal = loggedNutrients(extras, foodsById).totals.kcal;
  assert.ok(extraKcal > base.shortfall.kcal, 'the extra must be larger than the swap shortfall');

  const result = run(profileId, plan, [replacement, extraEntry(FROM, extras)]);
  assert.ok(!result.shortfall.kcal || result.shortfall.kcal <= 1e-9,
    `energy must not be made up again, left ${result.shortfall.kcal}`);
  assert.match(result.reason, /food you added outside the menu/i);
  assert.doesNotMatch(result.reason, /higher in calories/i,
    `the plan must not ask for calories it already got: ${result.reason}`);
});

test('D22: a skipped lunch followed by pizza and cola is not made up twice', () => {
  const profileId = 'recovery';
  const plan = build(profileId);
  plan.days[FROM].lunch = 'chicken-rice-bowl';
  const lunchKcal = totalsOfRecipe('chicken-rice-bowl').kcal;
  const skip = skipEntry(FROM, ['chicken-rice-bowl']);

  const base = run(profileId, plan, [skip]);
  assert.ok(base.shortfall.kcal > 0, 'the skip leaves energy to make up');
  assert.match(base.reason, /higher in calories/i);

  // Pizza and cola cover the whole lunch and every other minimum of that day.
  const extras = [
    { foodId: 'pizza-cheese', grams: 500 },
    { foodId: 'beverages-carbonated-cola-regular', grams: 500 },
  ];
  const result = run(profileId, plan, [skip, extraEntry(FROM, extras)]);
  assert.equal(Object.keys(result.shortfall).length, 0,
    `nothing should be left to make up: ${JSON.stringify(result.shortfall)}`);
  assert.equal(result.nothingToChange, true);
  assert.equal(result.changed.length, 0);
  assert.match(result.reason, /No changes needed/i);
  assert.match(result.reason, new RegExp(COVERED_SENTENCE.replace('.', '\\.')));
});

test('D22: an extra smaller than the shortfall leaves exactly the difference to make up', () => {
  const profileId = 'recovery';
  const plan = build(profileId);
  plan.days[FROM].lunch = 'chicken-rice-bowl';
  const skip = skipEntry(FROM, ['chicken-rice-bowl']);
  const base = run(profileId, plan, [skip]);
  const primary = pickPrimary(base, profileById(profileId).targets);
  assert.ok(primary, 'the skip leaves at least one minimum short');
  const nutrient = primary.target.nutrient;

  const food = EXTRA_FOOD[nutrient];
  const grams = gramsFor(food, nutrient, primary.missed * 0.25);
  const extra = extraEntry(FROM, [{ foodId: food, grams }]);
  const extraNutrient = loggedNutrients(extra.items, foodsById).totals[nutrient];
  assert.ok(extraNutrient > 0 && extraNutrient < primary.missed);

  const result = run(profileId, plan, [skip, extra]);
  const expected = primary.missed - extraNutrient;
  assert.ok(Math.abs((result.shortfall[nutrient] || 0) - expected) < 1e-6,
    `${nutrient}: expected ${expected}, got ${result.shortfall[nutrient]}`);

  const phrase = offsetPhrase(result.reason);
  assert.ok(phrase, `the reason must say what the extra covered: ${result.reason}`);
  assert.equal(phrase.left, shown(nutrient, expected), result.reason);
  assert.equal(phrase.total, shown(nutrient, primary.missed), result.reason);

  // The quoted per-day change is still exactly the Effect row change.
  const effect = result.effects.find((e) => e.nutrient === nutrient);
  const change = effectChange(nutrient, effect);
  const quoted = result.reason.match(/about ([\d.]+) (?:kcal|g|mg) more per day on average/);
  if (quoted) {
    assert.equal(Number(quoted[1]), Math.abs(shown(nutrient, change)), result.reason);
  }
});

// --- Unknown values, other dates, maximum targets ---------------------------

test('D22: extras with no known value for the nutrient offset nothing', () => {
  const profileId = 'recovery';
  const plan = build(profileId);
  plan.days[FROM].lunch = 'chicken-rice-bowl';
  const skip = skipEntry(FROM, ['chicken-rice-bowl']);
  const base = run(profileId, plan, [skip]);

  const unknown = {
    id: 'd22-unknown-value-food',
    name: 'Unknown value food',
    category: 'Test',
    per100g: {
      protein: null, fat: null, carbs: null, kcal: null,
      fibre: null, sodium: null, satFat: null, sugars: null,
    },
  };
  const withUnknown = new Map(foodsById);
  withUnknown.set(unknown.id, unknown);
  const result = replan({
    targets: profileById(profileId).targets,
    recipes,
    plan,
    log: [skip, extraEntry(FROM, [{ foodId: unknown.id, grams: 250 }])],
    bought: [],
    foodsById: withUnknown,
    fromDate: FROM,
  });

  for (const key of Object.keys(base.shortfall)) {
    assert.ok(Math.abs((result.shortfall[key] || 0) - base.shortfall[key]) < 1e-9,
      `${key}: an unknown value must not reduce the shortfall`);
  }
  assert.doesNotMatch(result.reason, /after the food you added outside the menu/);
});

test('D22: an extra on another date does not cover a skip', () => {
  const profileId = 'recovery';
  const plan = build(profileId);
  plan.days['2026-10-21'].lunch = 'chicken-rice-bowl';
  const gross = totalsOfRecipe('chicken-rice-bowl');
  const skip = skipEntry('2026-10-21', ['chicken-rice-bowl']);
  const extra = extraEntry('2026-10-22', [{ foodId: 'pizza-cheese', grams: 400 }]);

  const result = replan({
    targets: profileById(profileId).targets,
    recipes,
    plan,
    log: [skip, extra],
    bought: [],
    foodsById,
    fromDate: '2026-10-22',
    logFromDate: '2026-10-21',
  });

  for (const t of profileById(profileId).targets) {
    if (t.kind !== 'min') continue;
    const expected = gross[t.nutrient] || 0;
    if (expected <= 0) continue;
    assert.ok(Math.abs(result.shortfall[t.nutrient] - expected) < 1e-6,
      `${t.nutrient}: an extra on 2026-10-22 must not offset a skip on 2026-10-21`);
  }
  assert.doesNotMatch(result.reason, /after the food you added outside the menu/);
});

test('D22: with only a maximum target the extras still drive the overshoot, unchanged', () => {
  const targets = [{ nutrient: 'satFat', kind: 'max', daily: 13 }];
  const plan = buildPlan(targets, recipes, MONTH, foodsById);
  const extra = extraEntry(FROM, [{ foodId: 'pizza-cheese', grams: 500 }]);
  const result = replan({
    targets,
    recipes,
    plan,
    log: [extra],
    bought: [],
    foodsById,
    fromDate: FROM,
  });

  // The offset works only on minimum shortfalls: with none, nothing is netted off.
  assert.deepEqual(Object.keys(result.shortfall), []);
  assert.ok(result.changed.length > 0, 'the extra is still an overshoot under the maximum rules');
  assert.match(result.reason, /saturated fat/i);
  for (const date of result.windowDates) {
    const before = recipeNutrients(recipesById.get(plan.days[date].dinner), foodsById);
    assert.ok(before, `window day ${date} exists`);
  }
  for (const c of result.changed) {
    const before = recipeNutrients(recipesById.get(c.before), foodsById).totals.satFat;
    const after = recipeNutrients(recipesById.get(c.after), foodsById).totals.satFat;
    assert.ok(after <= before + 1e-9, `${c.date} ${c.slot}: saturated fat must not rise`);
  }
});

// --- Property checks across all four profiles -------------------------------

test('D22 property: skip plus an extra that covers the primary shortfall leaves no make-up for it', () => {
  for (const profile of PROFILES) {
    const plan = build(profile.id);
    const skip = skipEntry(FROM, [plan.days[FROM].breakfast]);
    const base = run(profile.id, plan, [skip]);
    const primary = pickPrimary(base, profile.targets);
    assert.ok(primary, `${profile.id}: the skip must leave a minimum short`);
    const food = EXTRA_FOOD[primary.target.nutrient];
    assert.ok(food, `${profile.id}: no extra food for ${primary.target.nutrient}`);
    const grams = gramsFor(food, primary.target.nutrient, primary.missed * 1.25);
    const result = run(profile.id, plan, [skip, extraEntry(FROM, [{ foodId: food, grams }])]);

    assert.ok((result.shortfall[primary.target.nutrient] || 0) <= 1e-6,
      `${profile.id}: ${primary.target.nutrient} should be covered, left ${result.shortfall[primary.target.nutrient]}`);
    assert.match(result.reason, /food you added outside the menu/i,
      `${profile.id}: reason must mention the extra: ${result.reason}`);
  }
});

test('D22 property: a replacement plus an extra that covers its shortfall leaves no make-up for it', () => {
  for (const profile of PROFILES) {
    const plan = build(profile.id);
    const plannedId = plan.days[FROM].lunch;
    // A replacement of the planned lunch that brings no nutrients ("I ate something
    // else"), so every profile really has a minimum to make up. Water is used instead
    // of the earlier apple because an apple adds fibre: for the Cholesterol profile
    // (fibre is its only minimum) it raised the day instead of lowering it, so no
    // make-up was due and the property had nothing to check.
    const entry = {
      date: FROM,
      time: '13:00',
      items: [{ foodId: 'water', grams: 100 }],
      replaced: [{ slot: 'lunch', recipeId: 'custom', name: 'water', fromRecipeId: plannedId }],
    };

    const base = run(profile.id, plan, [entry]);
    const primary = pickPrimary(base, profile.targets);
    assert.ok(primary, `${profile.id}: the replacement must leave a minimum short: ${base.reason}`);
    const nutrient = primary.target.nutrient;
    const food = EXTRA_FOOD[nutrient];
    assert.ok(food, `${profile.id}: no extra food for ${nutrient}`);
    const grams = gramsFor(food, nutrient, primary.missed * 1.25);

    const result = run(profile.id, plan, [entry, extraEntry(FROM, [{ foodId: food, grams }])]);
    assert.ok((result.shortfall[nutrient] || 0) <= 1e-6,
      `${profile.id}: ${nutrient} should be covered, left ${result.shortfall[nutrient]}`);
    assert.match(result.reason, /food you added outside the menu/i,
      `${profile.id}: reason must mention the extra: ${result.reason}`);
  }
});

test('D22 property: an extra smaller than the shortfall reduces the make-up by its value', () => {
  for (const profile of PROFILES) {
    const plan = build(profile.id);
    const skip = skipEntry(FROM, [plan.days[FROM].breakfast]);
    const base = run(profile.id, plan, [skip]);
    const primary = pickPrimary(base, profile.targets);
    assert.ok(primary, `${profile.id}: the skip must leave a minimum short`);
    const nutrient = primary.target.nutrient;
    const food = EXTRA_FOOD[nutrient];
    const grams = gramsFor(food, nutrient, primary.missed * 0.25);
    const extraNutrient = loggedNutrients([{ foodId: food, grams }], foodsById).totals[nutrient];
    assert.ok(extraNutrient < primary.missed);

    const result = run(profile.id, plan, [skip, extraEntry(FROM, [{ foodId: food, grams }])]);
    const expected = primary.missed - extraNutrient;
    assert.ok(Math.abs((result.shortfall[nutrient] || 0) - expected) <= 1e-6,
      `${profile.id}: ${nutrient} expected ${expected}, got ${result.shortfall[nutrient]}`);

    const phrase = offsetPhrase(result.reason);
    assert.ok(phrase, `${profile.id}: the reason must mention the offset: ${result.reason}`);
    assert.equal(phrase.left, shown(nutrient, expected), result.reason);
    assert.equal(phrase.total, shown(nutrient, primary.missed), result.reason);
  }
});

test('D22 property: the same extra saved once or in two steps gives the same plan', () => {
  const profileId = 'recovery';
  const plan = build(profileId);
  plan.days[FROM].lunch = 'chicken-rice-bowl';
  const skip = skipEntry(FROM, ['chicken-rice-bowl']);
  const a = { foodId: 'pizza-cheese', grams: 150 };
  const b = { foodId: 'beverages-carbonated-cola-regular', grams: 400 };

  const together = run(profileId, plan, [skip, extraEntry(FROM, [a, b])]);
  const inSteps = run(profileId, plan, [skip, extraEntry(FROM, [a]), extraEntry(FROM, [b])]);

  assert.deepEqual(inSteps.plan.days, together.plan.days, 'the pure plan rule must still hold');
  for (const key of ['kcal', 'protein', 'fat', 'fibre']) {
    assert.ok(Math.abs((inSteps.shortfall[key] || 0) - (together.shortfall[key] || 0)) <= 1e-9,
      `${key}: two saves must equal one save`);
  }
});
