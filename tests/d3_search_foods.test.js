import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { searchFoods, normalizeText } from '../src/engine/search.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const logSrc = fs.readFileSync(path.join(root, 'src/ui/log.js'), 'utf8');

const names = (hits) => hits.map((food) => food.name);

test('free search is wired through searchFoods, not a bare substring filter', () => {
  assert.match(logSrc, /searchFoods/);
  assert.doesNotMatch(logSrc, /\.includes\(q\)/);
});

test('cola does not match "chocolate" and prefers the cola / soft-drink foods', () => {
  const hits = searchFoods(foods, 'cola');
  assert.ok(hits.length >= 3, `cola hits=${hits.length}`);
  assert.ok(!names(hits).includes('Chocolate chip cookies'), 'cola matched chocolate chip cookies');
  assert.match(names(hits)[0], /cola/i, `first cola hit is "${names(hits)[0]}"`);
  assert.ok(
    names(hits).some((name) => /cola|soft drink|soda/i.test(name)),
    `no soft drink among: ${names(hits).join('; ')}`,
  );
});

test('the six common off-plan queries each return at least three foods', () => {
  for (const query of ['pizza', 'ice cream', 'cola', 'burger', 'pasta', 'beer']) {
    const hits = searchFoods(foods, query);
    assert.ok(hits.length >= 3, `${query}: ${hits.length} hits`);
  }
});

test('food data is broad enough for free search (at least 350 foods)', () => {
  assert.ok(foods.length >= 350, `only ${foods.length} foods`);
  // Off-plan staples are present (search synonyms may map burger → hamburger).
  assert.ok(foods.filter((f) => /pizza/i.test(f.name)).length >= 2, 'need several pizza foods');
  assert.ok(foods.filter((f) => /hamburger|cheeseburger/i.test(f.name)).length >= 2, 'need hamburger foods');
  assert.ok(foods.filter((f) => /carbonated,\s*cola|cola,/i.test(f.name)).length >= 2, 'need cola soft drinks');
  assert.ok(foods.filter((f) => /beer/i.test(f.name)).length >= 2, 'need beer foods');
  assert.ok(foods.filter((f) => /ice cream/i.test(f.name)).length >= 2, 'need ice cream foods');
  assert.ok(foods.filter((f) => /french fries/i.test(f.name)).length >= 2, 'need fries foods');
  assert.ok(foods.filter((f) => /pasta|spaghetti/i.test(f.name)).length >= 2, 'need pasta foods');
});

test('a nutrient value is never invented: non-null values need a USDA fdcId', () => {
  for (const food of foods) {
    const known = Object.values(food.per100g || {}).filter((value) => value !== null && value !== undefined);
    if (known.length > 0) {
      assert.ok(Number.isInteger(food.fdcId) && food.fdcId > 0, `${food.name} has nutrients but no fdcId`);
    }
  }
});

test('accents are ignored and plurals still find the food', () => {
  const fixture = [{ id: 'creme-fraiche', name: 'Crème fraîche' }, { id: 'apple-raw', name: 'Apple, raw' }];
  assert.equal(normalizeText('Crème fraîche'), 'creme fraiche');
  assert.deepEqual(names(searchFoods(fixture, 'creme')), ['Crème fraîche']);
  assert.deepEqual(names(searchFoods(fixture, 'APPLES')), ['Apple, raw']);
  assert.ok(searchFoods(foods, 'pizzas').length >= 3, 'plural "pizzas" finds the pizza foods');
  assert.ok(searchFoods(foods, 'cookies').length >= 3, 'plural "cookies" finds the cookies');
});

test('every query word must match a word or word prefix, not a bare substring', () => {
  const iceCream = names(searchFoods(foods, 'ice cream'));
  assert.ok(iceCream.length >= 3);
  assert.ok(!iceCream.includes('Cream cheese'), 'ice cream must not match cream cheese');
  const pizza = names(searchFoods(foods, 'pizza'));
  assert.ok(!pizza.some((name) => /pizzazz/i.test(name)));
});

test('ranking: exact name, then starts-with, then all words, then a synonym', () => {
  const fixture = [
    { id: 'hamburger-plain', name: 'Hamburger, plain' },
    { id: 'beef-burger', name: 'Beef burger with cheese' },
    { id: 'pizza-cheese', name: 'Pizza, cheese' },
    { id: 'pizza', name: 'Pizza' },
  ];
  assert.deepEqual(names(searchFoods(fixture, 'pizza', { limit: 2 })), ['Pizza', 'Pizza, cheese']);
  const burgers = names(searchFoods(fixture, 'burger'));
  assert.equal(burgers[0], 'Beef burger with cheese');
  assert.ok(burgers.indexOf('Beef burger with cheese') < burgers.indexOf('Hamburger, plain'));
});

test('empty queries return nothing and the result limit is honoured', () => {
  assert.deepEqual(searchFoods(foods, ''), []);
  assert.deepEqual(searchFoods(foods, '   '), []);
  assert.deepEqual(searchFoods(null, 'pizza'), []);
  assert.equal(searchFoods(foods, 'pizza', { limit: 3 }).length, 3);
  assert.ok(searchFoods(foods, 'pizza').length <= 12);
  assert.equal(searchFoods(foods, 'pizza', { limit: 0 }).length, 0);
});

test('synonyms find the usual names (fries, burger, coke)', () => {
  assert.ok(names(searchFoods(foods, 'fries')).some((name) => /french fries/i.test(name)));
  assert.ok(names(searchFoods(foods, 'burger')).some((name) => /hamburger/i.test(name)));
  assert.ok(names(searchFoods(foods, 'coke')).some((name) => /cola/i.test(name)));
  assert.ok(names(searchFoods(foods, 'wine')).some((name) => /wine/i.test(name)));
});
