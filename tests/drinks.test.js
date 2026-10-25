/**
 * F3 — Drinks shortcut, portion presets, drink synonyms, logging paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { searchFoods } from '../src/engine/search.js';
import {
  DRINK_PRESETS,
  mlToGrams,
  listDrinkFoods,
  isDrinkFood,
} from '../src/engine/drinks.js';
import { buildPlan, replan } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));

test('drink presets: glass 200, cup 240, can 330, small bottle 500', () => {
  assert.equal(DRINK_PRESETS.glass, 200);
  assert.equal(DRINK_PRESETS.cup, 240);
  assert.equal(DRINK_PRESETS.can, 330);
  assert.equal(DRINK_PRESETS.smallBottle, 500);
});

test('ml converts at 1 ml = 1 g with the documented note', () => {
  assert.equal(mlToGrams(330), 330);
  assert.equal(mlToGrams(200), 200);
  const src = fs.readFileSync(new URL('../src/engine/drinks.js', import.meta.url), 'utf8');
  assert.match(src, /1 g per ml|1 ml = 1 g/i);
});

test('listDrinkFoods includes water, coffee, tea, milk, juices, cola, soda, beer, wine', () => {
  const drinks = listDrinkFoods(foods);
  assert.ok(drinks.length >= 8, `expected several drinks, got ${drinks.length}`);
  const blob = drinks.map((f) => f.name.toLowerCase()).join(' | ');
  for (const word of ['water', 'coffee', 'tea', 'milk', 'juice', 'cola', 'beer', 'wine']) {
    assert.ok(blob.includes(word), `drinks list should include something with "${word}"`);
  }
  assert.ok(drinks.every(isDrinkFood));
});

test('search synonyms find drinks: coke, soda, espresso, juice, milk, tea, beer, wine, water', () => {
  const queries = ['coke', 'soda', 'espresso', 'juice', 'milk', 'tea', 'beer', 'wine', 'water'];
  for (const q of queries) {
    const hits = searchFoods(foods, q, { limit: 12 });
    assert.ok(hits.length >= 1, `"${q}" must return at least one food`);
  }
});

test('drinks as Extra trigger replan like other off-plan food', () => {
  const targets = profileById('cholesterol').targets;
  const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);
  const cola = listDrinkFoods(foods).find((f) => /cola/i.test(f.name));
  assert.ok(cola, 'need a cola food');
  const grams = mlToGrams(DRINK_PRESETS.can);
  const log = [{
    date: '2026-10-24',
    time: '15:00',
    items: [{ foodId: cola.id, grams }],
    extra: true,
  }];
  const result = replan({
    targets, recipes, plan, log, bought: [], foodsById, fromDate: '2026-10-24',
  });
  assert.ok(result);
  assert.ok(result.recentTotals);
});

test('UI source: Log has Drinks shortcut and ml conversion note', () => {
  const src = fs.readFileSync(new URL('../src/ui/log.js', import.meta.url), 'utf8');
  assert.match(src, /Drinks/);
  assert.match(src, /ml converted at about 1 g per ml/i);
});

test('no judgment wording around alcohol in drinks module or log UI', () => {
  const drinksSrc = fs.readFileSync(new URL('../src/engine/drinks.js', import.meta.url), 'utf8');
  const logSrc = fs.readFileSync(new URL('../src/ui/log.js', import.meta.url), 'utf8');
  for (const src of [drinksSrc, logSrc]) {
    assert.doesNotMatch(src, /limit alcohol|drink responsibly|unhealthy|binge/i);
  }
});
