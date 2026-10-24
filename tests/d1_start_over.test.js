import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  emptyAppState,
  startOverState,
  startOverConfirmCopy,
  changeProfileCopy,
  changeProfileState,
  startScreenFor,
  saveState,
  loadState,
  clearState,
} from '../src/store.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

const storedPlanState = () => ({
  profileId: 'cholesterol',
  targets: [{ nutrient: 'satFat', kind: 'max', daily: 13 }],
  plan: { month: '2026-10', days: { '2026-10-21': { breakfast: 'a', lunch: 'b', dinner: 'c', snack: 'd' } } },
  log: [{ date: '2026-10-21', time: '20:00', items: [{ foodId: 'pizza-cheese', grams: 350 }] }],
  bought: ['spinach-raw'],
  keptForBought: [{ date: '2026-10-22', slot: 'dinner', recipeId: 'c' }],
  shopEvery: 3,
  shopStart: '2026-10-21',
  pendingProposal: { plan: { month: '2026-10', days: {} }, changed: [], effects: [], reason: 'x' },
});

test('empty storage opens on the choose-profile start screen', () => {
  installMemoryStorage();
  const empty = loadState();
  assert.equal(empty.profileId, null);
  assert.equal(startScreenFor(empty), 'choose-profile');
  assert.equal(startScreenFor(undefined), 'choose-profile');
});

test('start screen helper: profile without a plan goes to Targets, a plan goes to Plan', () => {
  assert.equal(startScreenFor({ profileId: 'cholesterol', targets: [{ nutrient: 'kcal', kind: 'min', daily: 2000 }] }), 'targets');
  assert.equal(startScreenFor({ profileId: 'cholesterol', plan: { month: '2026-10', days: {} } }), 'plan');
});

test('startOverState is a fresh empty state', () => {
  const a = startOverState();
  const b = emptyAppState();
  assert.deepEqual(a, b);
  assert.equal(a.profileId, null);
  assert.equal(a.plan, null);
  assert.deepEqual(a.log, []);
  assert.deepEqual(a.bought, []);
  assert.deepEqual(a.keptForBought, []);
  assert.equal(a.pendingProposal, null);
  // Each call returns its own object, so erasing one state never touches another.
  assert.notEqual(startOverState(), a);
  a.log.push({ date: '2026-10-21' });
  assert.deepEqual(startOverState().log, []);
});

test('Start over confirmation copy lists the plan, the logs and the shopping ticks', () => {
  const copy = startOverConfirmCopy();
  const text = [copy.title, copy.intro, ...copy.items, copy.note].join('\n');
  assert.match(text, /month plan/i);
  assert.match(text, /meal logs/i);
  assert.match(text, /shopping ticks/i);
  assert.match(text, /pending plan update/i);
  assert.match(text, /kept because you bought/i);
  assert.match(copy.intro, /erases/i);
  assert.match(copy.note, /profile choice resets to none/i);
  assert.match(copy.confirmLabel, /start over/i);
});

test('change profile keeps the meal log and shopping ticks by default', () => {
  const state = storedPlanState();
  const next = changeProfileState(state);
  assert.equal(next.profileId, null);
  assert.deepEqual(next.targets, []);
  assert.equal(next.plan, null);
  assert.equal(next.pendingProposal, null);
  assert.deepEqual(next.keptForBought, []);
  // The log and the shopping ticks survive unless the person asks to clear them.
  assert.equal(next.log.length, 1);
  assert.deepEqual(next.bought, ['spinach-raw']);
  assert.equal(next.shopEvery, 3);
  // The original state is not mutated.
  assert.equal(state.plan.month, '2026-10');
  assert.equal(state.log.length, 1);
});

test('change profile clears the log and shopping list only when asked', () => {
  const next = changeProfileState(storedPlanState(), { keepLog: false });
  assert.equal(next.plan, null);
  assert.deepEqual(next.log, []);
  assert.deepEqual(next.bought, []);
  assert.deepEqual(next.keptForBought, []);
  assert.equal(next.pendingProposal, null);
});

test('change profile copy explains that clearing the log is a choice', () => {
  const copy = changeProfileCopy();
  assert.match(copy.clearLabel, /clear my meal log and shopping list/i);
  assert.match(copy.keepNote, /keep your meal logs/i);
  assert.match(copy.intro, /clears your current month plan/i);
});

test('the UI source offers Start over and Change profile', () => {
  const ui = `${read('src/ui/plan.js')}\n${read('src/ui/targets.js')}`;
  assert.match(ui, /Start over/i);
  assert.match(ui, /change-profile/i);
  assert.match(read('src/ui/reset.js'), /startOverConfirmCopy/);
});

test('a stored plan returns to the start screen after Start over (mocked localStorage)', () => {
  installMemoryStorage();
  saveState(storedPlanState());
  const loaded = loadState();
  assert.equal(loaded.plan.month, '2026-10');
  assert.equal(startScreenFor(loaded), 'plan');

  // Start over: the stored data goes away and so does the in-memory state.
  clearState();
  const after = startOverState();
  assert.equal(startScreenFor(after), 'choose-profile');
  assert.deepEqual(loadState(), emptyAppState());
});
