/**
 * P1 — a plan saved when two snacks were allowed must lose `snack2` on load.
 * The screens offer one snack, so the day values and the shopping list have to
 * count exactly the meals that are shown.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState, clearState, withoutSecondSnack, pendingProposalForPlan } from '../src/store.js';
import {
  applyImportPayload, EXPORT_APP_NAME, EXPORT_VERSION,
} from '../src/engine/export_import.js';

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

const legacyDay = {
  breakfast: 'oat-breakfast',
  lunch: 'chicken-bowl',
  dinner: 'lentil-stew',
  snack: 'apple-snack',
  snack2: 'yogurt-snack',
};

const legacyPlan = {
  month: '2026-10',
  days: { '2026-10-22': { ...legacyDay }, '2026-10-23': { ...legacyDay } },
};

function legacySavedData(extra = {}) {
  return {
    profileId: 'cholesterol',
    targets: [{ nutrient: 'satFat', kind: 'max', daily: 13 }],
    mealPrefs: { breakfast: true, lunch: true, dinner: true, snacks: 2 },
    plan: legacyPlan,
    log: [],
    bought: [],
    keptForBought: [],
    shopEvery: 7,
    shopStart: '2026-10-22',
    pendingProposal: null,
    labNotes: [],
    ...extra,
  };
}

test('load: a saved snacks: 2 plan keeps one snack and loses snack2 in every day', () => {
  installMemoryStorage();
  clearState();
  localStorage.setItem('nutriplanner-v1', JSON.stringify(legacySavedData()));

  const state = loadState();
  assert.equal(Number(state.mealPrefs.snacks), 1, 'snacks are clamped to one');
  for (const [date, day] of Object.entries(state.plan.days)) {
    assert.equal(day.snack2, undefined, `${date} has no snack2`);
    assert.equal(day.snack, legacyDay.snack, `${date} keeps the first snack`);
    assert.equal(day.breakfast, legacyDay.breakfast);
    assert.equal(day.lunch, legacyDay.lunch);
  }
  assert.equal(state.plan.month, '2026-10', 'the month is unchanged');
});

test('load: planBase and a pending proposal lose snack2 too', () => {
  installMemoryStorage();
  clearState();
  localStorage.setItem('nutriplanner-v1', JSON.stringify(legacySavedData({
    planBase: legacyPlan,
    pendingProposal: {
      plan: legacyPlan,
      changed: [],
      effects: [],
      reason: 'Saved before the update was accepted.',
    },
  })));

  const state = loadState();
  for (const date of Object.keys(legacyPlan.days)) {
    assert.equal(state.planBase.days[date].snack2, undefined, `planBase ${date}`);
    assert.equal(state.pendingProposal.plan.days[date].snack2, undefined, `proposal ${date}`);
  }
  // The proposal still belongs to the plan month, so the screen can still show it.
  assert.ok(pendingProposalForPlan(state));
});

test('a plan without snack2 is returned untouched, and the input is never mutated', () => {
  const prefs = { breakfast: true, lunch: true, dinner: true, snacks: 1 };
  const clean = { month: '2026-10', days: { '2026-10-22': { lunch: 'x', snack: 'y' } } };
  const same = { mealPrefs: prefs, plan: clean, planBase: null, pendingProposal: null };
  assert.equal(withoutSecondSnack(same), same);

  const state = {
    mealPrefs: prefs,
    plan: { month: '2026-10', days: { '2026-10-22': { ...legacyDay } } },
    planBase: null,
    pendingProposal: null,
  };
  const next = withoutSecondSnack(state);
  assert.equal(next.plan.days['2026-10-22'].snack2, undefined);
  assert.equal(state.plan.days['2026-10-22'].snack2, 'yogurt-snack', 'the saved object is not edited in place');
  assert.equal(next.plan.month, '2026-10');
});

test('restoring an older backup also drops a second snack', () => {
  const payload = {
    version: EXPORT_VERSION,
    app: EXPORT_APP_NAME,
    ...legacySavedData(),
  };
  const restored = applyImportPayload({ targets: [], plan: null }, payload);
  assert.equal(Number(restored.mealPrefs.snacks), 1);
  for (const day of Object.values(restored.plan.days)) {
    assert.equal(day.snack2, undefined);
    assert.equal(day.snack, legacyDay.snack);
  }
});

test('the stripped state is what gets saved again', () => {
  installMemoryStorage();
  clearState();
  localStorage.setItem('nutriplanner-v1', JSON.stringify(legacySavedData()));
  saveState(loadState());
  assert.equal(loadState().plan.days['2026-10-22'].snack2, undefined);
});
