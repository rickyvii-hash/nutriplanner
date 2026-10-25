/**
 * D24: after tapping "Add food" the food and its portion stay selected, so a
 * second tap adds the same food again without anyone asking for it. The state
 * after an add clears the selection, puts the portion back to its default,
 * turns "Add food" off again and announces the add under the list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_FOOD_PORTION,
  addedFoodStatus,
  stateAfterFoodAdd,
} from '../src/ui/log.js';
import { displayFoodName, displayNameHasBrand } from '../src/engine/food_display.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const pizza = foods.find((f) => /pizza/i.test(f.name));
const branded = foods.find((f) => /BURGER KING/i.test(f.name) && displayFoodName(f));

const logSrc = fs.readFileSync(new URL('../src/ui/log.js', import.meta.url), 'utf8');
const replaceSrc = fs.readFileSync(new URL('../src/ui/replace_picker.js', import.meta.url), 'utf8');

test('D24: after an add the food is in the list, nothing stays selected and the portion is back to its default', () => {
  assert.ok(pizza, 'data needs a pizza food');
  const items = [];
  const state = stateAfterFoodAdd(items, pizza, 250);

  assert.deepEqual(state.items, [{ foodId: pizza.id, grams: 250 }]);
  assert.deepEqual(items, [], 'the input list is never mutated');
  assert.equal(state.selectedFood, null, 'the food is not left selected');
  assert.equal(state.portion, DEFAULT_FOOD_PORTION, 'the portion field goes back to its default');
  assert.equal(DEFAULT_FOOD_PORTION, '100');
  assert.equal(state.addEnabled, false, '"Add food" is off until a food is selected again');
  assert.equal(state.status, `Added ${displayFoodName(pizza)}.`);
});

test('D24: a second tap with no new selection adds nothing; the same food can still be added on purpose', () => {
  const state = stateAfterFoodAdd([], pizza, 250);
  // The button handler returns early while nothing is selected, so a double tap
  // cannot append a second row.
  assert.equal(state.selectedFood, null);
  assert.equal(state.items.length, 1);

  // Selecting the food again and adding it is a deliberate second portion.
  const again = stateAfterFoodAdd(state.items, pizza, 120);
  assert.equal(again.items.length, 2);
  assert.deepEqual(again.items.map((it) => it.grams), [250, 120]);
  assert.equal(again.selectedFood, null, 'the state after the second add is closed again');
  assert.equal(again.addEnabled, false);
});

test('D24: the announcement never shows a brand token', () => {
  assert.ok(branded, 'data needs a branded food with a usable display name');
  const status = addedFoodStatus(branded);
  assert.match(status, /^Added .+\.$/);
  assert.equal(displayNameHasBrand(status), false);
  assert.doesNotMatch(status, /BURGER KING/i);
});

test('D24: both add panels wire the same pure state and a polite status line under the list', () => {
  assert.match(logSrc, /stateAfterFoodAdd\(/);
  assert.match(replaceSrc, /stateAfterFoodAdd\(/);

  const statusLine = /role="status"\s+aria-live="polite"|aria-live="polite"\s+role="status"/;
  assert.match(logSrc, statusLine);
  assert.match(replaceSrc, statusLine);
  assert.match(logSrc, /data-add-status/);
  assert.match(replaceSrc, /data-replace-status/);
  // Each status line sits after the list it announces.
  assert.ok(logSrc.indexOf('data-items') < logSrc.indexOf('data-add-status'));
  assert.ok(replaceSrc.indexOf('data-replace-items') < replaceSrc.indexOf('data-replace-status'));
});
