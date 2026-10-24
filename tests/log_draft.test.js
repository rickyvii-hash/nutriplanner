import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  newLogDraft,
  ensureDraft,
  addRecipeGroup,
  removeDraftGroup,
  removeGroupItem,
  flatDraftItems,
  isRecipeInDraft,
  draftGroupForRecipe,
} from '../src/ui/log.js';
import { recipeNutrients, foodNutrients, sumNutrients } from '../src/engine/nutrients.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));

const lunch = recipes.find((r) => r.slot === 'lunch');
const breakfast = recipes.find((r) => r.slot === 'breakfast');

function draftTotals(draft) {
  return sumNutrients(flatDraftItems(draft).map((it) => foodNutrients(foodsById.get(it.foodId), it.grams)));
}

test('add as eaten stores one grouped block, not flat foods', () => {
  const draft = newLogDraft();
  addRecipeGroup(draft, lunch);

  assert.equal(draft.items.length, 0, 'free-search foods stay empty');
  assert.equal(draft.groups.length, 1);
  const group = draft.groups[0];
  assert.equal(group.kind, 'eaten');
  assert.equal(group.slot, lunch.slot);
  assert.equal(group.recipeId, lunch.id);
  assert.equal(group.recipeName, lunch.name);
  assert.ok(group.id, 'the block needs an id');
  assert.deepEqual(group.items, lunch.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })));
  assert.ok(isRecipeInDraft(draft, lunch.id), 'the plan row must show "In this meal"');
});

test('adding the same planned meal twice does not duplicate its block', () => {
  const draft = newLogDraft();
  addRecipeGroup(draft, lunch);
  addRecipeGroup(draft, lunch);
  assert.equal(draft.groups.length, 1);
  assert.equal(flatDraftItems(draft).length, lunch.ingredients.length);
});

test('removing the block clears the group and the in-draft state', () => {
  const draft = newLogDraft();
  const group = addRecipeGroup(draft, lunch);
  addRecipeGroup(draft, breakfast);
  assert.ok(isRecipeInDraft(draft, lunch.id));

  removeDraftGroup(draft, group.id);
  assert.equal(draft.groups.length, 1);
  assert.equal(draftGroupForRecipe(draft, lunch.id), null);
  assert.equal(isRecipeInDraft(draft, lunch.id), false, 'the plan row must leave "In this meal"');
  assert.ok(isRecipeInDraft(draft, breakfast.id), 'other blocks are untouched');
});

test('removing every ingredient removes the empty block and clears in-draft', () => {
  const draft = newLogDraft();
  const group = addRecipeGroup(draft, lunch);
  const count = group.items.length;
  for (let i = 0; i < count; i += 1) removeGroupItem(draft, group.id, 0);

  assert.equal(draft.groups.length, 0);
  assert.equal(isRecipeInDraft(draft, lunch.id), false);
});

test('removing one ingredient keeps the rest of the block', () => {
  const draft = newLogDraft();
  const group = addRecipeGroup(draft, lunch);
  const first = group.items[0];
  removeGroupItem(draft, group.id, 0);

  assert.equal(draft.groups.length, 1);
  assert.equal(draft.groups[0].items.length, lunch.ingredients.length - 1);
  assert.ok(!draft.groups[0].items.some((it) => it.foodId === first.foodId && it.grams === first.grams));
});

test('saved foods and totals equal the recipe ingredients (same as the old flat add)', () => {
  const draft = newLogDraft();
  addRecipeGroup(draft, lunch);
  addRecipeGroup(draft, breakfast);

  const flat = flatDraftItems(draft);
  const expected = [...lunch.ingredients, ...breakfast.ingredients];
  assert.deepEqual(flat.map((i) => i.foodId).sort(), expected.map((i) => i.foodId).sort());
  assert.equal(flat.length, expected.length);

  // The old behaviour added the same ingredient rows straight to a flat list.
  const oldFlat = expected.map((i) => ({ ...i }));
  const oldTotals = sumNutrients(oldFlat.map((it) => foodNutrients(foodsById.get(it.foodId), it.grams))).totals;
  const newTotals = draftTotals(draft).totals;
  for (const key of Object.keys(oldTotals)) {
    assert.ok(Math.abs(newTotals[key] - oldTotals[key]) < 1e-9, `${key}: ${newTotals[key]} vs ${oldTotals[key]}`);
  }
  assert.ok(
    Math.abs(newTotals.satFat - (recipeNutrients(lunch, foodsById).totals.satFat + recipeNutrients(breakfast, foodsById).totals.satFat)) < 1e-9,
    'grouped ingredients add up to the recipes themselves',
  );
});

test('free-search foods stay flat rows and are logged after the grouped ingredients', () => {
  const draft = newLogDraft();
  addRecipeGroup(draft, lunch);
  draft.items.push({ foodId: 'apple-raw', grams: 120 });

  const flat = flatDraftItems(draft);
  assert.equal(flat.length, lunch.ingredients.length + 1);
  assert.deepEqual(flat.at(-1), { foodId: 'apple-raw', grams: 120 });
});

test('an older draft without groups is upgraded instead of crashing', () => {
  const draft = ensureDraft({ items: [{ foodId: 'apple-raw', grams: 100 }], skipped: [] });
  assert.deepEqual(draft.groups, []);
  assert.equal(flatDraftItems(draft).length, 1);
  addRecipeGroup(draft, lunch);
  assert.equal(draft.groups.length, 1);
});
