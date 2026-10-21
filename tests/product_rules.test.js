import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROFILES } from '../src/engine/profiles.js';
import { buildPlan } from '../src/engine/planner.js';
import { buildShoppingList } from '../src/engine/shopping.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data/foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data/recipes.json'), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
// Byte-order mark and zero-width space, built from char codes so the file stays plain text.
const INVISIBLE = new RegExp('[' + String.fromCharCode(0xfeff, 0x200b) + ']');

function productFiles() {
  const out = [path.join(root, 'index.html'), path.join(root, 'README.md'), path.join(root, 'package.json')];
  for (const dir of ['src', 'styles', 'data', 'scripts']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(p);
      }
    };
    walk(path.join(root, dir));
  }
  return out.filter((p) => fs.existsSync(p));
}

test('shopping list: each food appears once, quantities are summed, ticked foods move sections', () => {
  const profile = PROFILES[0];
  const plan = buildPlan(profile.targets, recipes, { year: 2026, month: 10 }, foodsById);
  const fromDate = '2026-10-01';
  const bought = ['spinach-raw', 'chicken-breast-roasted'];
  const list = buildShoppingList({ plan, recipes, foodsById, bought, fromDate });

  const ids = [...list.toBuy, ...list.atHome].map((i) => i.foodId);
  assert.equal(new Set(ids).size, ids.length, 'a food is listed twice');
  for (const id of bought) {
    if (ids.includes(id)) assert.ok(list.atHome.some((i) => i.foodId === id), `${id} should be at home`);
    assert.ok(!list.toBuy.some((i) => i.foodId === id), `${id} must not be in the to-buy list`);
  }

  // Total grams of one food equal the sum over every planned recipe.
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const expected = new Map();
  for (const meals of Object.values(plan.days)) {
    for (const id of Object.values(meals)) {
      for (const ing of recipesById.get(id).ingredients) expected.set(ing.foodId, (expected.get(ing.foodId) || 0) + ing.grams);
    }
  }
  for (const item of [...list.toBuy, ...list.atHome]) {
    assert.ok(Math.abs(item.grams - expected.get(item.foodId)) <= 1, `${item.foodId} grams`);
  }
});

test('public files: no absolute local paths', () => {
  const absolutePath = new RegExp('[A-Za-z]:' + String.fromCharCode(92, 92) + '(Users|ai)' + String.fromCharCode(92, 92));
  for (const file of productFiles()) {
    if (/\.(webp|png|jpg)$/i.test(file)) continue;
    const m = absolutePath.exec(fs.readFileSync(file, 'utf8'));
    assert.equal(m, null, `${path.relative(root, file)} contains the local path "${m && m[0]}"`);
  }
});

test('copy: no health promises, no food photographs, disclaimer on every screen file', () => {
  const claims = /\b(improves?|heals?|cures?|lowers your cholesterol|reduces? (your )?risk|supports? (your )?heart|healthy range)\b/i;
  const screens = fs.readdirSync(path.join(root, 'src/ui')).filter((f) => ['targets.js', 'plan.js', 'log.js', 'updated.js', 'shopping.js'].includes(f));
  assert.equal(screens.length, 5);
  for (const file of [path.join(root, 'index.html'), ...fs.readdirSync(path.join(root, 'src/ui')).map((f) => path.join(root, 'src/ui', f)), path.join(root, 'src/app.js')]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(claims.exec(text), null, `${path.relative(root, file)} makes a health claim`);
    assert.ok(!/<img\b/i.test(text), `${path.relative(root, file)} has an <img>`);
  }
  for (const f of screens) {
    assert.match(fs.readFileSync(path.join(root, 'src/ui', f), 'utf8'), /Support tool, not medical advice\./, `${f} lacks the disclaimer`);
  }
});

test('data files have no invisible characters (BOM) in names', () => {
  for (const f of foods) assert.ok(!INVISIBLE.test(f.name), `food "${f.id}" has an invisible character`);
  for (const r of recipes) assert.ok(!INVISIBLE.test(r.name), `recipe "${r.id}" has an invisible character`);
});
