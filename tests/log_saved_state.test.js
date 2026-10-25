import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import { buildPlan } from '../src/engine/planner.js';
import {
  newLogDraft,
  addRecipeGroup,
  skipRecipeGroup,
  draftSavePayload,
  logEntriesForSave,
  savedSlotOutcomes,
  mergeLogEntries,
  entrySlots,
  slotForRecipeId,
} from '../src/ui/log.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const planSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'plan.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

const plan = buildPlan(profileById('cholesterol').targets, recipes, { year: 2026, month: 10 }, foodsById);
const DATE = '2026-10-21';
const planDay = plan.days[DATE];
const lunch = recipesById.get(planDay.lunch);
const breakfast = recipesById.get(planDay.breakfast);
const when = { date: DATE, time: '13:00' };

function saveEaten(recipe) {
  const draft = newLogDraft();
  addRecipeGroup(draft, recipe);
  return logEntriesForSave(draftSavePayload(draft), when);
}

function saveSkipped(recipe) {
  const draft = newLogDraft();
  skipRecipeGroup(draft, recipe.id);
  return logEntriesForSave(draftSavePayload(draft), when);
}

function apply(log, entries) {
  return mergeLogEntries(log, entries, { date: DATE, planDay, recipesById });
}

test('reopening Log after an eaten meal shows that slot as already logged', () => {
  const entries = saveEaten(lunch);
  const log = apply([], entries);

  const outcomes = savedSlotOutcomes(log, DATE, planDay, recipesById);
  const saved = outcomes.get(lunch.slot);
  assert.ok(saved, 'the logged lunch must be known as saved');
  assert.equal(saved.kind, 'eaten');
  assert.equal(saved.recipeId, lunch.id);

  // Other slots stay free to log.
  assert.equal(outcomes.has('dinner'), false);
  assert.equal(outcomes.has('snack'), false);
});

test('a saved skip is shown as skipped when Log is opened again', () => {
  const log = apply([], saveSkipped(lunch));
  const outcomes = savedSlotOutcomes(log, DATE, planDay, recipesById);
  assert.equal(outcomes.get(lunch.slot)?.kind, 'skipped');
  assert.equal(outcomes.get(lunch.slot)?.recipeId, lunch.id);
});

test('saving the same eaten meal again does not create a second entry', () => {
  const first = apply([], saveEaten(lunch));
  assert.equal(first.length, 1);
  const again = apply(first, saveEaten(lunch));

  assert.equal(again.length, 1, 'one slot keeps one saved outcome');
  const outcomes = savedSlotOutcomes(again, DATE, planDay, recipesById);
  assert.equal(outcomes.size, 1);
  assert.equal(outcomes.get(lunch.slot)?.kind, 'eaten');
});

test('changing a slot from eaten to skipped replaces the saved entry, never adds a contradiction', () => {
  const eaten = apply([], saveEaten(lunch));
  const changed = apply(eaten, saveSkipped(lunch));

  assert.equal(changed.length, 1, 'the earlier eaten entry is replaced');
  assert.deepEqual(changed[0].skipped, [lunch.id]);
  assert.equal('eaten' in changed[0], false);
  assert.equal((changed[0].items || []).length, 0);

  const outcomes = savedSlotOutcomes(changed, DATE, planDay, recipesById);
  assert.equal(outcomes.size, 1);
  assert.equal(outcomes.get(lunch.slot)?.kind, 'skipped');
});

test('two different slots can be saved on the same day and together keep both outcomes', () => {
  let log = apply([], saveEaten(lunch));
  log = apply(log, saveSkipped(breakfast));

  assert.equal(log.length, 2, 'one entry per logged slot');
  const outcomes = savedSlotOutcomes(log, DATE, planDay, recipesById);
  assert.equal(outcomes.get(lunch.slot)?.kind, 'eaten');
  assert.equal(outcomes.get(breakfast.slot)?.kind, 'skipped');
});

test('extras are kept and never settle a planned slot', () => {
  const extra = { date: DATE, time: '16:00', extra: true, items: [{ foodId: 'apple-raw', grams: 120 }] };
  let log = apply([], [extra]);
  assert.equal(log.length, 1);

  log = apply(log, saveEaten(lunch));
  assert.equal(log.length, 2, 'the extra stays alongside the planned meal');
  const outcomes = savedSlotOutcomes(log, DATE, planDay, recipesById);
  assert.equal(outcomes.size, 1, 'the extra is not tied to a slot');
  assert.equal(outcomes.get(lunch.slot)?.kind, 'eaten');

  // A second extra never replaces the first one.
  log = apply(log, [{ date: DATE, time: '18:00', extra: true, items: [{ foodId: 'apple-raw', grams: 100 }] }]);
  assert.equal(log.length, 3);
});

test('a saved replacement marks its slot as replaced and is not duplicated', () => {
  const other = recipes.find((r) => r.slot === lunch.slot && r.id !== lunch.id);
  const entry = {
    date: DATE,
    time: '13:00',
    items: other.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
    replaced: [{ slot: lunch.slot, recipeId: other.id, fromRecipeId: lunch.id }],
  };
  let log = apply([], [entry]);
  log = apply(log, [entry]);

  assert.equal(log.length, 1);
  const outcomes = savedSlotOutcomes(log, DATE, planDay, recipesById);
  assert.equal(outcomes.get(lunch.slot)?.kind, 'replaced');
  assert.equal(outcomes.get(lunch.slot)?.recipeId, other.id);
});

test('old entries without slot metadata are still matched by their ingredients', () => {
  const legacy = {
    date: DATE,
    time: '13:00',
    items: lunch.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
  };
  const outcomes = savedSlotOutcomes([legacy], DATE, planDay, recipesById);
  assert.equal(outcomes.get(lunch.slot)?.kind, 'eaten');

  // Saving that slot again replaces the legacy entry instead of adding a second one.
  const log = apply([legacy], saveEaten(lunch));
  assert.equal(log.length, 1);
});

test('entries for other days are never touched by a save for today', () => {
  const yesterday = {
    date: '2026-10-20',
    time: '20:00',
    items: lunch.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
    eaten: [{ recipeId: lunch.id, slot: lunch.slot }],
  };
  const log = apply([yesterday], saveEaten(breakfast));
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], yesterday);
});

test('helpers place recipes and entries in their planned slot', () => {
  assert.equal(slotForRecipeId(lunch.id, planDay, recipesById), lunch.slot);
  assert.equal(slotForRecipeId(lunch.id, null, recipesById), lunch.slot);
  assert.equal(slotForRecipeId('missing', planDay, recipesById), null);
  assert.deepEqual([...entrySlots({ extra: true, items: [] }, planDay, recipesById)], []);
  assert.ok(entrySlots(saveSkipped(lunch)[0], planDay, recipesById).has(lunch.slot));
});

test('the day screen reads the saved log and the app merges instead of appending', () => {
  // Planned meals are logged and corrected on the day screen since D16.
  assert.match(planSrc, /savedSlotOutcomes\(state\.log, selected/);
  assert.match(appSrc, /mergeLogEntries/);
});
