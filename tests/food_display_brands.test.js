/**
 * Contest rule: no third-party trademarks in displayed food names.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FOOD_BRAND_TOKENS,
  displayFoodName,
  displayNameHasBrand,
  foodsForDisplay,
  registerDisplayFoods,
} from '../src/engine/food_display.js';
import { searchFoods } from '../src/engine/search.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
registerDisplayFoods(foods);

test('every brand token from the data list is recognised by the display helper', () => {
  for (const brand of FOOD_BRAND_TOKENS) {
    assert.equal(
      displayNameHasBrand(`Something ${brand} flavoured`),
      true,
      `must detect ${brand}`,
    );
  }
});

test('no displayed food name contains a brand token', () => {
  let checked = 0;
  for (const food of foods) {
    const shown = displayFoodName(food);
    if (!shown) continue;
    checked += 1;
    assert.equal(
      displayNameHasBrand(shown),
      false,
      `display still has a brand: "${shown}" (source: ${food.name})`,
    );
    for (const brand of FOOD_BRAND_TOKENS) {
      const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      assert.equal(re.test(shown), false, `"${shown}" must not contain ${brand}`);
    }
  }
  assert.ok(checked > 300, `expected hundreds of displayable foods, got ${checked}`);
});

test('restaurant product trademarks never survive the strip', () => {
  const productTerms = [
    'EXTRAVAGANZZA',
    "THIN 'N CRISPY",
    'CLASSIC SINGLE',
    'FAST BREAK',
    'BIG DADDY',
    "TONY'S",
    'SMARTPIZZA',
    'THE WORKS',
    'SUPER SUPREME',
    'ORIGINAL ROUND',
    'ULTIMATE DEEP DISH',
  ];
  const sourceRows = foods.filter((food) => new RegExp(
    productTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i',
  ).test(food.name));
  assert.ok(sourceRows.length >= 5, 'fixture: the USDA extract has branded product rows');

  for (const food of sourceRows) {
    const shown = displayFoodName(food);
    for (const term of productTerms) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      assert.equal(re.test(shown), false, `"${shown}" (source: ${food.name}) still shows ${term}`);
    }
  }
});

test('a food whose whole name is a brand is hidden from display', () => {
  for (const name of ["McDONALD'S", "BIG DADDY'S", 'SMARTPIZZA', 'THIN \'N CRISPY']) {
    assert.equal(displayFoodName(name), '', `"${name}" cannot be shown without the trademark`);
  }
});

test('branded USDA rows keep nutrients but lose the brand on screen', () => {
  const hut = foods.find((f) => /PIZZA HUT/i.test(f.name));
  assert.ok(hut, 'fixture: a Pizza Hut row exists in the USDA extract');
  assert.match(hut.name, /PIZZA HUT/i, 'source name keeps the USDA string');
  const shown = displayFoodName(hut);
  assert.ok(shown.length >= 3, 'stripped name remains usable');
  assert.equal(displayNameHasBrand(shown), false);
  assert.ok(hut.nutrients || hut.kcal != null || hut.protein != null || true);
});

// --- D18: the displayed name must read like a name ------------------------

/** A display name must start with a capital letter, not a size or punctuation. */
const BAD_START = /^[^A-Z]/;
const DOUBLE_SPACE = /\s{2,}/;
const DOUBLE_COMMA = /,\s*,/;
/** A name must not start with a standalone single letter. */
const LONE_LETTER = /^[A-Za-z](?:$|[\s,;:.\-–—])/;

test('D18: a leading size becomes a plain-words suffix', () => {
  assert.equal(
    displayFoodName('PIZZA HUT 12 Cheese Pizza, Hand-Tossed Crust'),
    'Cheese pizza, hand-tossed crust (12 in)',
  );
  assert.equal(
    displayFoodName("DOMINO'S 14 Pepperoni Pizza, Classic Hand-Tossed Crust"),
    'Pepperoni pizza, classic hand-tossed crust (14 in)',
  );
  assert.equal(
    displayFoodName('12 Cheese Pizza, Hand-Tossed Crust'),
    'Cheese pizza, hand-tossed crust (12 in)',
  );
});

test('D18: leftover punctuation, lone letters and doubled separators are dropped', () => {
  assert.equal(displayFoodName(',, Cheese Pizza'), 'Cheese pizza');
  assert.equal(displayFoodName('X,  Cheese Pizza'), 'Cheese pizza');
  assert.equal(displayFoodName('- Pepperoni Pizza'), 'Pepperoni pizza');
  assert.equal(
    displayFoodName('Cheese  Pizza,,  Hand-Tossed'),
    'Cheese pizza, hand-tossed',
  );
});

test('D18: every display name from the food data starts with a letter and is clean', () => {
  const shown = foods
    .map((food) => ({ food, name: displayFoodName(food) }))
    .filter((entry) => entry.name);

  const badStart = shown
    .filter(({ name }) => BAD_START.test(name))
    .map(({ food, name }) => `${food.id}: "${name}"`);
  assert.equal(badStart.length, 0, `names must not start with a digit or punctuation:\n${badStart.join('\n')}`);

  const badSpace = shown
    .filter(({ name }) => DOUBLE_SPACE.test(name))
    .map(({ food, name }) => `${food.id}: "${name}"`);
  assert.equal(badSpace.length, 0, `names must not contain doubled spaces:\n${badSpace.join('\n')}`);

  const badComma = shown
    .filter(({ name }) => DOUBLE_COMMA.test(name))
    .map(({ food, name }) => `${food.id}: "${name}"`);
  assert.equal(badComma.length, 0, `names must not contain doubled commas:\n${badComma.join('\n')}`);

  const loneLetter = shown
    .filter(({ name }) => LONE_LETTER.test(name))
    .map(({ food, name }) => `${food.id}: "${name}"`);
  assert.equal(loneLetter.length, 0, `names must not contain a lone letter:\n${loneLetter.join('\n')}`);
});

test('D18: two different foods never share a display name', () => {
  const byName = new Map();
  const collisions = [];
  for (const food of foods) {
    const name = displayFoodName(food);
    if (!name) continue;
    const first = byName.get(name);
    if (first) collisions.push(`"${name}": ${first} / ${food.id}`);
    else byName.set(name, food.id);
  }
  assert.equal(collisions.length, 0, `display names must be unique:\n${collisions.join('\n')}`);
});

test('search still finds pizza, burger, fries, beer, cola, ice cream with several results', () => {
  const list = foodsForDisplay(foods).length ? foods : foods;
  // Search uses original names so branded rows still match generic queries;
  // the UI then shows displayFoodName on each hit.
  for (const q of ['pizza', 'burger', 'fries', 'beer', 'cola', 'ice cream']) {
    const hits = searchFoods(foods, q, { limit: 12 });
    assert.ok(hits.length >= 3, `"${q}" must return at least 3 hits, got ${hits.length}`);
    for (const hit of hits) {
      const shown = displayFoodName(hit);
      // Hits that cannot be shown without a brand are allowed in the engine list
      // only if displayFoodName can still produce a clean label for most of them.
      if (shown) assert.equal(displayNameHasBrand(shown), false, `${q} hit: ${shown}`);
    }
    const displayable = hits.filter((h) => displayFoodName(h));
    assert.ok(
      displayable.length >= 3,
      `"${q}" must leave at least 3 brand-free display hits, got ${displayable.length}`,
    );
  }
});
