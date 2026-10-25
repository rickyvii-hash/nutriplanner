/**
 * D7 (P1): a planned meal already chosen in the draft ("In this meal" or skipped)
 * must be clearable from its own row, "This meal" needs a Clear all button, and
 * the Replace blocked notice must say how to unblock it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  newLogDraft,
  addRecipeGroup,
  skipRecipeGroup,
  clearDraftChoice,
  clearDraft,
  isRecipeInDraft,
  isRecipeSkipped,
  draftHasPending,
  canReplaceMeal,
  flatDraftItems,
  REPLACE_BLOCKED_MESSAGE,
} from '../src/ui/log.js';

const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const logSrc = fs.readFileSync(new URL('../src/ui/log.js', import.meta.url), 'utf8');

const lunch = recipes.find((r) => r.slot === 'lunch');
const breakfast = recipes.find((r) => r.slot === 'breakfast');
const snackRecipe = recipes.find((r) => r.slot === 'snack');
const SNACK = 'snack';
const SNACK2 = 'snack2';

test('D7: Clear removes only the chosen meal eaten block', () => {
  const draft = newLogDraft();
  addRecipeGroup(draft, lunch, 'lunch');
  addRecipeGroup(draft, breakfast, 'breakfast');

  clearDraftChoice(draft, lunch.id, 'lunch');

  assert.equal(isRecipeInDraft(draft, lunch.id, 'lunch'), false, 'the cleared meal leaves "In this meal"');
  assert.equal(draft.groups.length, 1, 'only one block was removed');
  assert.ok(isRecipeInDraft(draft, breakfast.id, 'breakfast'), 'other meals stay chosen');
});

test('D7: Clear removes only the chosen meal skip', () => {
  const draft = newLogDraft();
  skipRecipeGroup(draft, lunch.id, 'lunch');
  skipRecipeGroup(draft, breakfast.id, 'breakfast');

  clearDraftChoice(draft, lunch.id, 'lunch');

  assert.equal(isRecipeSkipped(draft, lunch.id, 'lunch'), false, 'the cleared meal is no longer skipped');
  assert.ok(isRecipeSkipped(draft, breakfast.id, 'breakfast'), 'other skips are untouched');
  assert.equal(draft.skipped.length, 1);
});

test('D7: Clear is slot-aware when two snacks share one recipe', () => {
  // snack is eaten, snack2 is skipped: clearing snack must keep the snack2 skip.
  const draft = newLogDraft();
  addRecipeGroup(draft, snackRecipe, SNACK);
  skipRecipeGroup(draft, snackRecipe.id, SNACK2);

  clearDraftChoice(draft, snackRecipe.id, SNACK);

  assert.equal(isRecipeInDraft(draft, snackRecipe.id, SNACK), false);
  assert.ok(isRecipeSkipped(draft, snackRecipe.id, SNACK2), 'the other snack keeps its skip');

  // Both snacks eaten as separate blocks: clearing one keeps the other.
  const both = newLogDraft();
  addRecipeGroup(both, snackRecipe, SNACK);
  addRecipeGroup(both, snackRecipe, SNACK2);

  clearDraftChoice(both, snackRecipe.id, SNACK2);

  assert.equal(isRecipeInDraft(both, snackRecipe.id, SNACK2), false);
  assert.ok(isRecipeInDraft(both, snackRecipe.id, SNACK), 'the first snack stays eaten');
  assert.equal(both.groups.length, 1);
});

test('D7: Clear all empties items, groups and skipped meals', () => {
  const draft = newLogDraft();
  addRecipeGroup(draft, lunch, 'lunch');
  skipRecipeGroup(draft, breakfast.id, 'breakfast');
  draft.items.push({ foodId: 'apple-raw', grams: 120 });
  assert.equal(draftHasPending(draft), true);

  clearDraft(draft);

  assert.deepEqual(draft.items, []);
  assert.deepEqual(draft.groups, []);
  assert.deepEqual(draft.skipped, []);
  assert.equal(draftHasPending(draft), false);
  assert.equal(flatDraftItems(draft).length, 0);
});

test('D7: Replace is allowed again once Clear empties the draft', () => {
  const draft = newLogDraft();
  addRecipeGroup(draft, lunch, 'lunch');
  assert.equal(canReplaceMeal(draft), false);

  clearDraftChoice(draft, lunch.id, 'lunch');
  assert.equal(canReplaceMeal(draft), true);

  skipRecipeGroup(draft, breakfast.id, 'breakfast');
  assert.equal(canReplaceMeal(draft), false);

  clearDraftChoice(draft, breakfast.id, 'breakfast');
  assert.equal(canReplaceMeal(draft), true);
});

test('D7: the blocked notice names the new wording', () => {
  assert.equal(
    REPLACE_BLOCKED_MESSAGE,
    'You have choices waiting in “This meal”. Tap Save, or Clear on the highlighted meal (or Clear all), then try Replace again.',
  );
  assert.doesNotMatch(REPLACE_BLOCKED_MESSAGE, /Clear This meal first/);
});

// The planned-meal rows were removed from the Log screen (D16); the helpers stay.
test('D7: the To add card has a Clear all control that uses the helper', () => {
  assert.match(logSrc, /data-clear-all/);
  assert.match(logSrc, />Clear all<\/button>/);
  assert.match(logSrc, /clearDraft\(draft\)/);
});
