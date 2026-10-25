/**
 * Source contract: the screens that show a food name must go through
 * `displayFoodName`, so no trademark from the USDA source string reaches the UI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const IMPORT_LINE = "from '../engine/food_display.js'";

test('log.js, shopping.js and plan.js import and call displayFoodName', () => {
  for (const file of ['log.js', 'shopping.js', 'plan.js']) {
    const src = fs.readFileSync(path.join(root, 'src', 'ui', file), 'utf8');
    const importLine = src.split('\n').find((line) => line.includes(IMPORT_LINE));
    assert.ok(importLine, file + ' must import from the food display engine');
    assert.ok(importLine.includes('displayFoodName'), file + ' must import displayFoodName');
    assert.ok(src.includes('displayFoodName('), file + ' must call displayFoodName');
  }
});

test('the drink shortcut picks and labels drinks by the same brand-free name', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'ui', 'log.js'), 'utf8');
  const body = src.slice(src.indexOf('function drinkPreview'), src.indexOf('function hasOwnMeasure'));
  assert.ok(body.includes('displayFoodName('), 'drinkPreview must pick on the display name');
  assert.doesNotMatch(body, /f\.name/, 'drinkPreview must not match the raw USDA name');
});

test('the app registers the loaded food list so display names stay unique', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  assert.match(src, /registerDisplayFoods/, 'app.js must import the display registration');
  assert.match(src, /registerDisplayFoods\(foods\)/, 'the loaded foods must be registered before a screen shows a name');
});
