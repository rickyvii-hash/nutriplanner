/**
 * D21: search must never show "(USDA <id>)" to a person.
 *
 * Several USDA restaurant rows (six chains' "French fries", two chains'
 * "Cheeseburger", pizza crusts) become the same words once the brand is
 * removed. Only one of them is offered, named with the plain restaurant
 * suffix; the rest stay in the data for older log entries. Collisions that are
 * not about a brand keep a plain distinguishing detail in parentheses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  displayFoodName,
  displayNameHasBrand,
  foodsForDisplay,
  isFoodDisplayVisible,
  registerDisplayFoods,
} from '../src/engine/food_display.js';
import { searchFoods } from '../src/engine/search.js';
import { listDrinkFoods } from '../src/engine/drinks.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
registerDisplayFoods(foods);

const byFdc = (id) => {
  const food = foods.find((entry) => entry.fdcId === id);
  assert.ok(food, `fixture: USDA row ${id} exists`);
  return food;
};

test('D21: no displayed name shows a USDA record number or a raw id', () => {
  const bad = [];
  for (const food of foods) {
    const shown = displayFoodName(food);
    if (!shown) continue;
    if (/USDA/i.test(shown) || /\d{5,}/.test(shown)) bad.push(`${food.fdcId}: "${shown}"`);
  }
  assert.equal(bad.length, 0, `names must not carry a record number:\n${bad.join('\n')}`);
  for (const name of ['Food', 'Cheese pizza', 'French fries, restaurant']) {
    assert.equal(/\d{5,}/.test(displayFoodName(name)), false, `a plain name stays plain: ${name}`);
  }
});

test('D21: restaurant rows from different chains collapse to one visible entry', () => {
  // The same dish at six chains; a seventh generic row is not part of the group.
  const fries = [169009, 170327, 167672, 170721, 169833, 170726].map(byFdc);
  assert.equal(fries.length, 6, 'fixture: six chains have french fries');
  for (const food of fries) {
    assert.equal(displayFoodName(food), 'French fries, restaurant', `label for ${food.fdcId}`);
  }
  const shownFries = fries.filter(isFoodDisplayVisible);
  assert.equal(shownFries.length, 1, 'only one "French fries" entry is offered');
  assert.equal(shownFries[0].fdcId, 167672, 'the visible one has the lowest USDA id');

  const cheeseburgers = [byFdc(170329), byFdc(170320)];
  for (const food of cheeseburgers) {
    assert.equal(displayFoodName(food), 'Cheeseburger, restaurant');
  }
  assert.deepEqual(
    cheeseburgers.filter(isFoodDisplayVisible).map((food) => food.fdcId),
    [170320],
    'only the lowest-id cheeseburger is offered',
  );

  const doubles = [byFdc(170374), byFdc(172065)];
  for (const food of doubles) {
    assert.equal(displayFoodName(food), 'Double cheeseburger, restaurant');
  }
  assert.deepEqual(
    doubles.filter(isFoodDisplayVisible).map((food) => food.fdcId),
    [170374],
  );

  const hamburgers = [byFdc(170328), byFdc(170717)];
  for (const food of hamburgers) {
    assert.equal(displayFoodName(food), 'Hamburger, restaurant');
  }
  assert.deepEqual(
    hamburgers.filter(isFoodDisplayVisible).map((food) => food.fdcId),
    [170328],
  );
});

test('D21: the higher-id twin keeps a name for older log entries', () => {
  const hidden = byFdc(170329); // BURGER KING cheeseburger, hidden from search
  assert.equal(isFoodDisplayVisible(hidden), false);
  assert.equal(displayFoodName(hidden), 'Cheeseburger, restaurant');
  assert.ok(hidden.nutrients || hidden.per100g, 'the hidden row keeps its nutrients');
});

test('D21: a size or crust detail stays in plain words, never a record number', () => {
  const pizza = byFdc(172051); // Pizza Hut 14 cheese, thin 'n crispy
  const shown = displayFoodName(pizza);
  assert.match(shown, /\(14 in\)/, `size stays as plain words: ${shown}`);
  assert.match(shown, /restaurant$/);
  assert.equal(displayNameHasBrand(shown), false);
});

test('D21: collisions that are not about a brand keep a real detail', () => {
  const salted = byFdc(170248);
  const unsalted = byFdc(170648);
  const a = displayFoodName(salted);
  const b = displayFoodName(unsalted);
  assert.notEqual(a, b, 'the two chip rows stay distinguishable');
  assert.match(a, /\(.*salted\)/i);
  assert.match(b, /\(.*unsalted\)/i);
  assert.equal(isFoodDisplayVisible(salted), true);
  assert.equal(isFoodDisplayVisible(unsalted), true);
  assert.equal(/USDA|\d{5,}/i.test(a + b), false);

  const apple = byFdc(167800);
  assert.match(displayFoodName(apple), /calcium/i, 'the apple detail is the real difference');
  assert.equal(isFoodDisplayVisible(apple), true);
});

test('D21: every visible display name is unique', () => {
  const shown = foodsForDisplay(foods);
  assert.ok(shown.length > 450, `expected nearly all foods visible, got ${shown.length}`);
  const seen = new Map();
  const collisions = [];
  for (const food of shown) {
    const name = displayFoodName(food);
    if (seen.has(name)) collisions.push(`"${name}": ${seen.get(name)} / ${food.fdcId}`);
    else seen.set(name, food.fdcId);
  }
  assert.equal(collisions.length, 0, `visible names must be unique:\n${collisions.join('\n')}`);
});

test('D21: search hides duplicate restaurant rows and finds the usual words', () => {
  for (const query of ['burger', 'fries', 'pizza', 'sandwich', 'ice cream', 'beer', 'cola']) {
    // Six chain fries rows are one restaurant dish, so the data leaves two
    // distinct fries foods; every other word still has several foods.
    const minHits = query === 'fries' ? 2 : 3;
    const hits = searchFoods(foods, query, { limit: 50 });
    assert.ok(hits.length >= minHits, `"${query}" must still return ${minHits} or more foods, got ${hits.length}`);
    assert.ok(hits.every(isFoodDisplayVisible), `"${query}" must not return a hidden duplicate`);
    const labels = hits.map((food) => displayFoodName(food));
    assert.equal(new Set(labels).size, labels.length, `"${query}" hits must have unique labels`);
    for (const label of labels) {
      assert.equal(/USDA|\d{5,}/i.test(label), false, `"${query}" hit shows an id: ${label}`);
    }
  }

  const burgerHits = searchFoods(foods, 'burger', { limit: 50 });
  assert.equal(
    burgerHits.filter((food) => displayFoodName(food) === 'Cheeseburger, restaurant').length,
    1,
    'one cheeseburger in the results, not two chains',
  );
  const friesHits = searchFoods(foods, 'fries', { limit: 50 });
  assert.equal(
    friesHits.filter((food) => displayFoodName(food) === 'French fries, restaurant').length,
    1,
    'one french fries in the results, not six chains',
  );
});

test('D21: the Drinks list shows one row per drink name', () => {
  const drinks = listDrinkFoods(foods);
  assert.ok(drinks.length >= 8);
  assert.ok(drinks.every(isFoodDisplayVisible), 'hidden duplicates stay out of the Drinks list');
  const labels = drinks.map((food) => displayFoodName(food));
  assert.equal(new Set(labels).size, labels.length, 'the Drinks list has no duplicate names');
  assert.equal(
    labels.filter((label) => label === 'Alcoholic beverage, beer, light').length,
    1,
    'the beer brand twins collapse to one drink name',
  );
});

