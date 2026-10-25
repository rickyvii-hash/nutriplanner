/**
 * F4 — Download my data / Restore from file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EXPORT_VERSION,
  buildExportPayload,
  validateImportPayload,
  applyImportPayload,
} from '../src/engine/export_import.js';
import { emptyAppState, saveState, loadState, clearState } from '../src/store.js';

function memoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('export version is a positive integer', () => {
  assert.equal(typeof EXPORT_VERSION, 'number');
  assert.ok(EXPORT_VERSION >= 1);
});

test('round trip: export then restore restores plan, logs, targets and meals', () => {
  memoryStorage();
  clearState();
  const state = {
    ...emptyAppState(),
    profileId: 'cholesterol',
    targets: [{ nutrient: 'satFat', kind: 'max', daily: 13 }],
    mealPrefs: { breakfast: true, lunch: true, dinner: true, snacks: 0 },
    plan: { month: '2026-10', days: { '2026-10-01': { lunch: 'x' } } },
    log: [{ date: '2026-10-01', time: '12:00', items: [{ foodId: 'pizza-cheese', grams: 100 }] }],
    labNotes: [{ id: '1', name: 'LDL', value: 120, unit: 'mg/dL', date: '2026-09-01', note: '' }],
    bought: ['food-a'],
  };
  saveState(state);
  const payload = buildExportPayload(state);
  assert.equal(payload.version, EXPORT_VERSION);
  assert.equal(payload.app, 'NutriPlanner');
  // The file carries NutriPlanner fields only: nothing from another app can leak in.
  const allowedFields = new Set([
    'version', 'app', 'exportedAt', 'profileId', 'targets', 'mealPrefs', 'plan',
    'planBase', 'log', 'bought', 'keptForBought', 'shopEvery', 'shopStart',
    'updateDecisions', 'labNotes',
  ]);
  for (const key of Object.keys(payload)) {
    assert.ok(allowedFields.has(key), `unexpected field in the backup: ${key}`);
  }
  // The schema keeps the field, always as an empty list: no screen records lab notes.
  assert.deepEqual(payload.labNotes, []);

  clearState();
  saveState(emptyAppState());
  const check = validateImportPayload(payload);
  assert.equal(check.ok, true);
  const next = applyImportPayload(emptyAppState(), payload);
  assert.equal(next.profileId, 'cholesterol');
  assert.deepEqual(next.targets, state.targets);
  assert.deepEqual(next.mealPrefs, state.mealPrefs);
  assert.deepEqual(next.plan, state.plan);
  assert.deepEqual(next.log, state.log);
  assert.deepEqual(next.labNotes, []);
  assert.deepEqual(next.bought, state.bought);
});

test('bad file is rejected and leaves current data untouched', () => {
  const current = {
    ...emptyAppState(),
    profileId: 'athlete',
    targets: [{ nutrient: 'kcal', kind: 'min', daily: 2500 }],
  };
  const bad = validateImportPayload({ not: 'ours' });
  assert.equal(bad.ok, false);
  assert.match(String(bad.message), /valid|recognise|recognize|NutriPlanner|format/i);
  const untouched = applyImportPayload(current, { not: 'ours' });
  assert.deepEqual(untouched, current);
});

test('wrong version is rejected', () => {
  const payload = buildExportPayload({
    ...emptyAppState(),
    profileId: 'recovery',
  });
  payload.version = EXPORT_VERSION + 99;
  const check = validateImportPayload(payload);
  assert.equal(check.ok, false);
  assert.match(String(check.message), /version/i);
});

test('UI source: Download my data and Restore from file', () => {
  const targets = fs.readFileSync(new URL('../src/ui/targets.js', import.meta.url), 'utf8');
  assert.match(targets, /Download my data/);
  assert.match(targets, /Restore from file/);
});
