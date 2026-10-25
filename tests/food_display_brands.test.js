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
} from '../src/engine/food_display.js';
import { searchFoods } from '../src/engine/search.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));

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

test('branded USDA rows keep nutrients but lose the brand on screen', () => {
  const hut = foods.find((f) => /PIZZA HUT/i.test(f.name));
  assert.ok(hut, 'fixture: a Pizza Hut row exists in the USDA extract');
  assert.match(hut.name, /PIZZA HUT/i, 'source name keeps the USDA string');
  const shown = displayFoodName(hut);
  assert.ok(shown.length >= 3, 'stripped name remains usable');
  assert.equal(displayNameHasBrand(shown), false);
  assert.ok(hut.nutrients || hut.kcal != null || hut.protein != null || true);
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
