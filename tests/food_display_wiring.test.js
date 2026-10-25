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
