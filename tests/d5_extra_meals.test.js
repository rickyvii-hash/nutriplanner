import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import { buildPlan, replan } from '../src/engine/planner.js';
import { loggedNutrients } from '../src/engine/nutrients.js';
import { loggedAverages } from '../src/engine/summary.js';
import {
  newLogDraft,
  addRecipeGroup,
  skipRecipeGroup,
  draftSavePayload,
  logEntriesForSave,
} from '../src/ui/log.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const logSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'log.js'), 'utf8');
const planSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'plan.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const month = { year: 2026, month: 10 };
const FROM = '2026-10-21';
const when = { date: FROM, time: '15:00' };

const pizza = foods.find((f) => /pizza/i.test(f.name));
const iceCream = foods.find((f) => /ice cream/i.test(f.name));

function scenario(profileId = 'cholesterol') {
  const targets = profileById(profileId).targets;
  const plan = buildPlan(targets, recipes, month, foodsById);
  return { targets, plan };
}

function run(state, log) {
  return replan({
    targets: state.targets,
    recipes,
    plan: state.plan,
    log,
    bought: [],
    foodsById,
    fromDate: FROM,
  });
}

test('extra-only save: the entry is marked extra, has no skipped/replaced, and replan adapts', () => {
  assert.ok(pizza, 'data needs a pizza food');
  assert.ok(iceCream, 'data needs an ice cream food');
  const state = scenario();
  const draft = newLogDraft();
  draft.items.push({ foodId: pizza.id, grams: 350 }, { foodId: iceCream.id, grams: 100 });

  const payload = draftSavePayload(draft);
  assert.equal(payload.extra, true, 'free-search foods are extras');
  assert.deepEqual(payload.skipped, []);
  assert.deepEqual(payload.eaten, []);

  const entries = logEntriesForSave(payload, when);
  assert.equal(entries.length, 1, 'an extra-only log is one entry');
  const entry = entries[0];
  assert.equal(entry.extra, true);
  assert.equal('skipped' in entry, false, 'extras are never saved as skipped');
  assert.equal('replaced' in entry, false, 'extras never replace a planned slot');
  assert.deepEqual(entry.items, [
    { foodId: pizza.id, grams: 350 },
    { foodId: iceCream.id, grams: 100 },
  ]);

  // The extra counts in the day totals even though no slot changed.
  const averages = loggedAverages(entries, foodsById);
  assert.equal(averages.days, 1);
  const expected = loggedNutrients(entry.items, foodsById).totals;
  assert.equal(averages.totals.kcal, expected.kcal);

  const result = run(state, entries);
  assert.ok(result, 'replan must run for an extra-only log');
  assert.equal(result.replacements.length, 0);
  assert.deepEqual(result.skippedNames, []);
  assert.ok(result.reason.length > 0, 'the replan explains itself');
  assert.notEqual(result.reason, 'No changes needed — the rest of the month still meets your targets.');
  assert.ok(result.changed.length > 0, 'the off-plan extra changes the next days');
  for (const date of [...new Set(result.changed.map((c) => c.date))]) {
    assert.ok(date > FROM, date + ' must be after the log date');
  }
});

test('extra and an eaten planned meal can be saved together without replacing a slot', () => {
  assert.ok(pizza, 'data needs a pizza food');
  const state = scenario();
  const lunchId = state.plan.days[FROM].lunch;
  const lunch = recipesById.get(lunchId);

  const draft = newLogDraft();
  addRecipeGroup(draft, lunch);
  draft.items.push({ foodId: pizza.id, grams: 200 });

  const payload = draftSavePayload(draft);
  assert.equal(payload.extra, true, 'the save still holds free-search extras');
  assert.deepEqual(payload.eaten, [{ recipeId: lunch.id, slot: lunch.slot }]);

  const entries = logEntriesForSave(payload, when);
  assert.equal(entries.length, 1, 'eaten food and extras share one entry');
  const entry = entries[0];
  assert.equal(entry.extra, true);
  assert.equal(entry.eaten.length, 1);
  assert.equal(entry.items.length, lunch.ingredients.length + 1, 'planned meal plus the extra');
  assert.equal('replaced' in entry, false);
  assert.equal('skipped' in entry, false);
  assert.deepEqual(entry.items.at(-1), { foodId: pizza.id, grams: 200 });

  const result = run(state, entries);
  assert.equal(result.replacements.length, 0, 'the extra does not replace the lunch');
  assert.deepEqual(result.skippedNames, [], 'the extra does not skip the lunch');
  assert.ok(result.reason.length > 0);
  for (const date of [...new Set(result.changed.map((c) => c.date))]) {
    assert.ok(date > FROM, date + ' must be after the log date');
  }
});

test('after a skipped meal, extras are added the same day as a separate extra entry', () => {
  assert.ok(pizza, 'data needs a pizza food');
  const state = scenario();
  const lunchId = state.plan.days[FROM].lunch;
  const lunch = recipesById.get(lunchId);

  // First save: only the planned lunch is skipped.
  const skipDraft = newLogDraft();
  skipRecipeGroup(skipDraft, lunch.id);
  const skipPayload = draftSavePayload(skipDraft);
  assert.equal(skipPayload.extra, false, 'a skip alone is not an extra');
  const skipEntries = logEntriesForSave(skipPayload, { date: FROM, time: '12:00' });
  assert.equal(skipEntries.length, 1);
  assert.deepEqual(skipEntries[0].skipped, [lunch.id]);
  assert.equal('extra' in skipEntries[0], false);

  // Second save: only free-search food, as its own extra entry.
  const extraDraft = newLogDraft();
  extraDraft.items.push({ foodId: pizza.id, grams: 200 });
  const extraEntries = logEntriesForSave(draftSavePayload(extraDraft), { date: FROM, time: '18:00' });
  assert.equal(extraEntries.length, 1);
  assert.equal(extraEntries[0].extra, true);
  assert.equal('skipped' in extraEntries[0], false);

  const log = [...skipEntries, ...extraEntries];
  assert.equal(log.length, 2, 'skip entry and extra entry live on the same day');
  assert.equal(log[0].skipped[0], lunch.id);
  assert.equal(log[1].extra, true);

  const result = run(state, log);
  assert.deepEqual(result.skippedNames, [lunch.name], 'the skip is still recorded');
  assert.equal(result.replacements.length, 0, 'the extra is not a replacement');

  // A single save can also carry skipped meals and extras: the skip keeps its own entry.
  const mixedDraft = newLogDraft();
  mixedDraft.items.push({ foodId: pizza.id, grams: 100 });
  skipRecipeGroup(mixedDraft, lunch.id);
  const mixedEntries = logEntriesForSave(draftSavePayload(mixedDraft), when);
  assert.equal(mixedEntries.length, 2);
  const extraEntry = mixedEntries.find((e) => e.extra);
  const skipEntry = mixedEntries.find((e) => Array.isArray(e.skipped));
  assert.ok(extraEntry && skipEntry, 'one extra entry and one skip entry');
  assert.equal('skipped' in extraEntry, false);
  assert.equal('extra' in skipEntry, false, 'a skip-only entry is not an extra');
});

test('the log UI names the free-search path "Extra / outside meals" and the app tags extras', () => {
  assert.match(logSrc, /Extra \/ outside meals/);
  assert.match(logSrc, /Snack, drink or a restaurant meal/);
  assert.match(logSrc, /not tied to a planned slot/);
  assert.match(logSrc, /extra: d\.items\.length > 0/);
  assert.match(appSrc, /logEntriesForSave/);
  assert.match(planSrc, /Extra \/ outside meals/);
});
