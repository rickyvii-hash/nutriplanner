/**
 * P1-1: with two snacks, the planned slot `snack2` stays `snack2` in eaten and
 * skipped outcomes. A second snack may use the same snack recipe as the first,
 * so the recipe id alone must never merge the two meals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';
import {
  newLogDraft,
  addRecipeGroup,
  skipRecipeGroup,
  unskipRecipe,
  isRecipeInDraft,
  isRecipeSkipped,
  draftSavePayload,
  draftSkippedIds,
  draftGroupForRecipe,
  logEntriesForSave,
  mergeLogEntries,
  savedSlotOutcomes,
  entrySlots,
} from '../src/ui/log.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

const DAY = '2026-10-24';
const SNACK = 'snack';
const SNACK2 = 'snack2';
const twoSnacks = buildPlan(
  profileById('cholesterol').targets,
  recipes,
  { year: 2026, month: 10 },
  foodsById,
  [],
  { mealPrefs: { breakfast: true, lunch: true, dinner: true, snacks: 2 } },
);
const snackRecipe = recipes.find((r) => r.slot === SNACK);
// Worst case: both snack slots hold the same snack recipe.
const planDay = { ...twoSnacks.days[DAY], snack: snackRecipe.id, snack2: snackRecipe.id };
const when = { date: DAY, time: '16:00' };

function saveEntries(payload) {
  return logEntriesForSave(payload, when);
}

test('P1-1: a second snack keeps the planned slot snack2 when added as eaten', () => {
  const draft = newLogDraft();
  const group = addRecipeGroup(draft, snackRecipe, SNACK2);

  assert.equal(group.slot, SNACK2, 'the planned slot is stored, not the recipe slot');
  assert.ok(isRecipeInDraft(draft, snackRecipe.id, SNACK2));
  assert.equal(isRecipeInDraft(draft, snackRecipe.id, SNACK), false, 'the first snack stays free');

  const entries = saveEntries(draftSavePayload(draft));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].eaten.length, 1);
  assert.equal(entries[0].eaten[0].recipeId, snackRecipe.id);
  assert.equal(entries[0].eaten[0].slot, SNACK2);

  const log = mergeLogEntries([], entries, { date: DAY, planDay, recipesById });
  const outcomes = savedSlotOutcomes(log, DAY, planDay, recipesById);
  assert.equal(outcomes.get(SNACK2)?.kind, 'eaten', 'snack2 is the eaten slot');
  assert.equal(outcomes.has(SNACK), false, 'snack is still open');
});

test('P1-1: skipping snack2 records snack2 and leaves the first snack independent', () => {
  const draft = newLogDraft();
  addRecipeGroup(draft, snackRecipe, SNACK);
  skipRecipeGroup(draft, snackRecipe.id, SNACK2);

  assert.ok(isRecipeInDraft(draft, snackRecipe.id, SNACK), 'the eaten first snack stays');
  assert.equal(draft.groups.length, 1, 'skipping snack2 drops no other meal');
  assert.ok(isRecipeSkipped(draft, snackRecipe.id, SNACK2));
  assert.equal(isRecipeSkipped(draft, snackRecipe.id, SNACK), false);
  assert.deepEqual(draftSkippedIds(draft), [snackRecipe.id], 'snack2 is the skipped meal');

  const entries = saveEntries(draftSavePayload(draft));
  const skipEntry = entries.find((entry) => Array.isArray(entry.skipped));
  assert.ok(skipEntry, 'the skip has its own entry');
  assert.deepEqual(skipEntry.skipped, [snackRecipe.id]);
  assert.equal(skipEntry.skippedSlots.length, 1);
  assert.equal(skipEntry.skippedSlots[0].recipeId, snackRecipe.id);
  assert.equal(skipEntry.skippedSlots[0].slot, SNACK2);
  assert.deepEqual([...entrySlots(skipEntry, planDay, recipesById)], [SNACK2]);
  assert.equal(
    entries.some((entry) => (entry.eaten || []).some((info) => info.slot === SNACK)),
    true,
    'the eaten first snack keeps its own entry',
  );

  const log = mergeLogEntries([], entries, { date: DAY, planDay, recipesById });
  const outcomes = savedSlotOutcomes(log, DAY, planDay, recipesById);
  assert.equal(outcomes.get(SNACK)?.kind, 'eaten');
  assert.equal(outcomes.get(SNACK2)?.kind, 'skipped');
  assert.equal(outcomes.get(SNACK2)?.slot, SNACK2);
});

test('P1-1: a later save for snack never overwrites the saved snack2 outcome', () => {
  const firstDraft = newLogDraft();
  skipRecipeGroup(firstDraft, snackRecipe.id, SNACK2);
  const log = mergeLogEntries([], saveEntries(draftSavePayload(firstDraft)), {
    date: DAY, planDay, recipesById,
  });

  // A second visit: the first snack is eaten, nothing is said about snack2.
  const secondDraft = newLogDraft();
  addRecipeGroup(secondDraft, snackRecipe, SNACK);
  const next = mergeLogEntries(log, saveEntries(draftSavePayload(secondDraft)), {
    date: DAY, planDay, recipesById,
  });

  const outcomes = savedSlotOutcomes(next, DAY, planDay, recipesById);
  assert.equal(outcomes.get(SNACK)?.kind, 'eaten');
  assert.equal(outcomes.get(SNACK2)?.kind, 'skipped', 'the saved snack2 skip is kept');
});

test('P1-1: removing one snack skip keeps the other, and eating it clears only its own', () => {
  const draft = newLogDraft();
  skipRecipeGroup(draft, snackRecipe.id, SNACK);
  skipRecipeGroup(draft, snackRecipe.id, SNACK2);
  assert.equal(draft.skipped.length, 2, 'each snack keeps its own skip');

  unskipRecipe(draft, snackRecipe.id, SNACK2);
  assert.ok(isRecipeSkipped(draft, snackRecipe.id, SNACK), 'the first snack stays skipped');
  assert.equal(isRecipeSkipped(draft, snackRecipe.id, SNACK2), false);

  addRecipeGroup(draft, snackRecipe, SNACK2);
  assert.ok(isRecipeInDraft(draft, snackRecipe.id, SNACK2));
  assert.ok(isRecipeSkipped(draft, snackRecipe.id, SNACK), 'eating snack2 leaves the snack skip');
  assert.equal(draftGroupForRecipe(draft, snackRecipe.id, SNACK), null);
});
