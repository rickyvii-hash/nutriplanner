import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DETAIL_NOTE,
  fullRecipeUrl,
  findNearbyUrl,
  orderDeliveryUrl,
  searchTerm,
  detailLinks,
  recipeDetailModel,
  openRecipeDetail,
} from '../src/ui/recipe_detail.js';
import { formatNutrient, recipeNutrients } from '../src/engine/nutrients.js';
import { profileById } from '../src/engine/profiles.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));

const dish = 'Oats with banana & peanut butter';
const encoded = encodeURIComponent(dish);

test('link builders encode spaces and special characters', () => {
  assert.equal(fullRecipeUrl(dish), `https://www.google.com/search?q=${encoded}+recipe`);
  assert.equal(findNearbyUrl(dish), `https://www.google.com/maps/search/?api=1&query=${encoded}+near+me`);
  assert.equal(orderDeliveryUrl(dish), `https://www.google.com/search?q=${encoded}+delivery+near+me`);

  for (const url of [fullRecipeUrl(dish), findNearbyUrl(dish), orderDeliveryUrl(dish)]) {
    assert.ok(!/\s/.test(url), `a URL still has a raw space: ${url}`);
    assert.match(url, /%20/, 'spaces are encoded');
    assert.match(url, /%26/, 'ampersands are encoded');
    assert.ok(!url.includes('&') || url.startsWith('https://www.google.com/maps/search/?api=1'), 'no raw query ampersand');
  }

  // Accents and other special characters are encoded, not dropped.
  const accented = 'Crème brûlée & crêpes';
  const accentedUrl = fullRecipeUrl(accented);
  assert.equal(accentedUrl, `https://www.google.com/search?q=${encodeURIComponent(accented)}+recipe`);
  assert.match(accentedUrl, /%C3%A8/);
  assert.match(accentedUrl, /%C3%BB/);
  assert.match(accentedUrl, /%26/);
});

test('each link ends or contains the expected search words', () => {
  assert.ok(fullRecipeUrl('Lentil salad').endsWith('+recipe'));
  assert.ok(findNearbyUrl('Lentil salad').endsWith('+near+me'));
  assert.ok(orderDeliveryUrl('Lentil salad').endsWith('+delivery+near+me'));
  assert.ok(orderDeliveryUrl('Lentil salad').startsWith('https://www.google.com/search?q='));
  assert.ok(findNearbyUrl('Lentil salad').startsWith('https://www.google.com/maps/search/?api=1&query='));
});

test('an empty or whitespace name still gives a working search link', () => {
  assert.equal(searchTerm(''), 'meal');
  assert.equal(searchTerm('   '), 'meal');
  assert.equal(searchTerm(null), 'meal');
  for (const bad of ['', '   ', null, undefined]) {
    assert.equal(fullRecipeUrl(bad), 'https://www.google.com/search?q=meal+recipe');
    assert.ok(!fullRecipeUrl(bad).includes('undefined'));
    assert.ok(!findNearbyUrl(bad).includes('undefined'));
    assert.ok(!orderDeliveryUrl(bad).includes('undefined'));
  }
});

test('a name is trimmed before it goes into a link', () => {
  assert.equal(fullRecipeUrl('  Pizza  '), fullRecipeUrl('Pizza'));
});

test('detail links are the three named links in order', () => {
  const links = detailLinks(dish);
  assert.deepEqual(links.map((l) => l.label), ['Full recipe', 'Find nearby', 'Order delivery']);
  assert.deepEqual(links.map((l) => l.href), [fullRecipeUrl(dish), findNearbyUrl(dish), orderDeliveryUrl(dish)]);
  assert.deepEqual(links.map((l) => l.id), ['full-recipe', 'find-nearby', 'order-delivery']);
});

test('detail panel content: name, icon, ingredient grams and target nutrients', () => {
  const recipe = recipes.find((r) => r.id === 'oats-banana-peanut-butter');
  assert.ok(recipe, 'expected the oats and banana recipe');
  const targets = profileById('cholesterol').targets;
  const model = recipeDetailModel(recipe, { targets, foodsById });

  assert.equal(model.name, recipe.name);
  assert.equal(model.icon, recipe.icon);
  assert.deepEqual(model.ingredients.map((i) => i.grams), recipe.ingredients.map((i) => i.grams));
  assert.equal(model.ingredients.find((i) => i.name === 'Banana, raw')?.grams, 100);
  assert.deepEqual(model.nutrients.map((n) => n.key), targets.map((t) => t.nutrient));

  const totals = recipeNutrients(recipe, foodsById);
  for (const row of model.nutrients) {
    const decimals = row.key === 'kcal' || row.key === 'sodium' ? 0 : 1;
    const value = formatNutrient(totals, row.key, decimals);
    assert.equal(row.value, value);
    assert.equal(row.text, value === 'n/a' ? 'n/a' : `${value} ${row.unit}`);
  }

  assert.deepEqual(model.links, detailLinks(recipe.name));
  assert.equal(model.note, DETAIL_NOTE);
  assert.equal(model.note, 'Opens a web search. NutriPlanner does not take orders.');
});

test('a missing nutrient value reads n/a and never zero', () => {
  // Apple has no saturated fat value in the data: the panel must not print 0.
  const fakeFoods = new Map([['apple-raw', foodsById.get('apple-raw')]]);
  const recipe = { id: 'apple-slices', name: 'Apple slices', icon: '🍎', slot: 'snack', ingredients: [{ foodId: 'apple-raw', grams: 150 }] };
  const model = recipeDetailModel(recipe, {
    targets: [
      { nutrient: 'satFat', kind: 'max', daily: 13 },
      { nutrient: 'kcal', kind: 'max', daily: 2000 },
    ],
    foodsById: fakeFoods,
  });
  assert.equal(model.nutrients[0].text, 'n/a');
  assert.equal(model.nutrients[0].value, 'n/a');
  assert.match(model.nutrients[1].text, /^[\d.]+ kcal$/);
});

test('the panel cannot be opened without a browser', () => {
  const recipe = recipes[0];
  assert.equal(openRecipeDetail({ state: { targets: [] } }, recipe, null), null);
  assert.equal(recipeDetailModel(null), null);
});
