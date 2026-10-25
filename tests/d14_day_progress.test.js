/**
 * D14: the day screen says how many planned meals already have a saved outcome.
 * Eaten and replaced count as logged; skipped is counted apart, never as eaten.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';
import { savedSlotOutcomes } from '../src/ui/log.js';
import { dayMealProgress } from '../src/ui/plan.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

const DAY = '2026-10-15';
const plan = buildPlan(profileById('athlete').targets, recipes, { year: 2026, month: 10 }, foodsById);
const meals = plan.days[DAY];
const slots = Object.keys(meals).filter((slot) => meals[slot]);

function progressFor(log) {
  const outcomes = savedSlotOutcomes(log, DAY, meals, recipesById);
  return dayMealProgress({ planDay: meals, slots, outcomes });
}

function eatenEntry(slot, time = '13:00') {
  const recipeId = meals[slot];
  const recipe = recipesById.get(recipeId);
  return {
    date: DAY,
    time,
    items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
    eaten: [{ recipeId, slot }],
  };
}

function skippedEntry(slot) {
  const recipeId = meals[slot];
  return {
    date: DAY,
    time: '13:00',
    skipped: [recipeId],
    skippedSlots: [{ recipeId, slot }],
    items: [],
  };
}

function replacedEntry(slot) {
  return {
    date: DAY,
    time: '20:00',
    items: [{ foodId: 'pizza-cheese', grams: 150 }],
    replaced: [{ slot, recipeId: null, fromRecipeId: meals[slot], name: 'Pizza' }],
  };
}

test('D14: an empty log says none of the planned meals is logged', () => {
  const progress = progressFor([]);
  assert.equal(progress.total, slots.length);
  assert.equal(progress.logged, 0);
  assert.equal(progress.skipped, 0);
  assert.equal(progress.text, `0 of ${slots.length} meals logged`);
});

test('D14: an eaten meal counts as logged', () => {
  const progress = progressFor([eatenEntry(slots[0])]);
  assert.equal(progress.logged, 1);
  assert.equal(progress.skipped, 0);
  assert.equal(progress.text, `1 of ${slots.length} meals logged`);
});

test('D14: a replaced meal counts as logged', () => {
  const progress = progressFor([replacedEntry(slots[0])]);
  assert.equal(progress.logged, 1);
  assert.equal(progress.skipped, 0);
});

test('D14: skipped meals are counted apart, in the short form', () => {
  const log = [eatenEntry(slots[0]), skippedEntry(slots[1])];
  const progress = progressFor(log);
  assert.equal(progress.logged, 1);
  assert.equal(progress.skipped, 1);
  assert.equal(progress.text, `1 of ${slots.length} logged, 1 skipped`);
  assert.doesNotMatch(progress.text, /meals logged/);
});

test('D14: eaten and replaced together both count, skipping never does', () => {
  const log = [eatenEntry(slots[0]), replacedEntry(slots[1]), skippedEntry(slots[2])];
  const progress = progressFor(log);
  assert.equal(progress.total, slots.length);
  assert.equal(progress.logged, 2);
  assert.equal(progress.skipped, 1);
  assert.equal(progress.text, `2 of ${slots.length} logged, 1 skipped`);
});

test('D14: only the slots the day actually plans are counted', () => {
  const outcomes = new Map([
    ['not-a-slot', { kind: 'eaten' }],
  ]);
  const progress = dayMealProgress({ planDay: meals, slots: [...slots, 'not-a-slot'], outcomes });
  assert.equal(progress.total, slots.length);
  assert.equal(progress.logged, 0);
});

test('D14: no plan day gives a zero line, never an error', () => {
  const progress = dayMealProgress({ planDay: null, slots: ['breakfast'], outcomes: null });
  assert.deepEqual(progress, { total: 0, logged: 0, skipped: 0, text: '0 of 0 meals logged' });
});
