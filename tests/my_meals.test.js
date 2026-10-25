/**
 * F2 — My meals: which daily slots are on, and 0–2 snacks.
 * Contract tests; fail until the feature ships.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso } from '../src/engine/planner.js';
import { profileById, PROFILES } from '../src/engine/profiles.js';
import {
  defaultMealPrefs,
  activeSlots,
  normalizeMealPrefs,
  perSlotCapFactor,
  rebuildPlanMeals,
} from '../src/engine/meal_prefs.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(new URL('../data/recipes.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));

test('default meal prefs: all four slots on, one snack', () => {
  const prefs = defaultMealPrefs();
  assert.equal(prefs.breakfast, true);
  assert.equal(prefs.lunch, true);
  assert.equal(prefs.dinner, true);
  assert.equal(prefs.snacks, 1);
  assert.deepEqual(activeSlots(prefs), ['breakfast', 'lunch', 'dinner', 'snack']);
});

test('activeSlots: no breakfast; no breakfast and no snack; two snacks; one meal only', () => {
  assert.deepEqual(
    activeSlots({ breakfast: false, lunch: true, dinner: true, snacks: 1 }),
    ['lunch', 'dinner', 'snack'],
  );
  assert.deepEqual(
    activeSlots({ breakfast: false, lunch: true, dinner: true, snacks: 0 }),
    ['lunch', 'dinner'],
  );
  assert.deepEqual(
    activeSlots({ breakfast: true, lunch: true, dinner: true, snacks: 2 }),
    ['breakfast', 'lunch', 'dinner', 'snack', 'snack2'],
  );
  assert.deepEqual(
    activeSlots({ breakfast: false, lunch: false, dinner: true, snacks: 0 }),
    ['dinner'],
  );
});

test('normalizeMealPrefs: snacks clamped to 0–2; at least one meal required', () => {
  assert.equal(normalizeMealPrefs({ breakfast: true, lunch: true, dinner: true, snacks: 9 }).snacks, 2);
  assert.equal(normalizeMealPrefs({ breakfast: true, lunch: true, dinner: true, snacks: -1 }).snacks, 0);
  const none = normalizeMealPrefs({
    breakfast: false, lunch: false, dinner: false, snacks: 0,
  });
  assert.ok(activeSlots(none).length >= 1, 'must keep at least one meal slot');
});

test('per-slot cap rule: soft cap uses daily/N * 1.75', () => {
  // Documented product rule: a single meal may take at most (daily / N) * 1.75
  // of a maximum target when another combination exists.
  assert.ok(Math.abs(perSlotCapFactor(4) - 1.75 / 4) < 1e-9);
  assert.ok(Math.abs(perSlotCapFactor(1) - 1.75) < 1e-9);
  assert.ok(Math.abs(perSlotCapFactor(2) - 1.75 / 2) < 1e-9);
});

test('buildPlan uses only chosen slots for all four profiles', () => {
  for (const p of PROFILES) {
    const prefs = { breakfast: false, lunch: true, dinner: true, snacks: 0 };
    const plan = buildPlan(p.targets, recipes, { year: 2026, month: 10 }, foodsById, [], { mealPrefs: prefs });
    const day = plan.days['2026-10-15'];
    assert.ok(day.lunch && day.dinner, `${p.id}: lunch and dinner filled`);
    assert.equal(day.breakfast, undefined, `${p.id}: no breakfast`);
    assert.equal(day.snack, undefined, `${p.id}: no snack`);
    assert.equal(day.snack2, undefined, `${p.id}: no snack2`);
  }
});

test('two snacks fill snack and snack2 from snack recipes', () => {
  const targets = profileById('cholesterol').targets;
  const prefs = { breakfast: true, lunch: true, dinner: true, snacks: 2 };
  const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById, [], { mealPrefs: prefs });
  const day = plan.days['2026-10-15'];
  assert.ok(day.snack && day.snack2);
  assert.equal(recipes.find((r) => r.id === day.snack).slot, 'snack');
  assert.equal(recipes.find((r) => r.id === day.snack2).slot, 'snack');
});

test('one meal only: no crash; honest closest/unreachable when athlete minima cannot be met', () => {
  const targets = profileById('athlete').targets;
  const prefs = { breakfast: false, lunch: false, dinner: true, snacks: 0 };
  const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById, [], { mealPrefs: prefs });
  assert.ok(plan?.days);
  const day = plan.days['2026-10-15'];
  assert.ok(day.dinner);
  assert.equal(Object.keys(day).filter((k) => day[k]).length, 1);

  const result = replan({
    targets, recipes, plan, log: [], bought: [], foodsById,
    fromDate: '2026-10-15', mealPrefs: prefs,
  });
  assert.ok(result);
  assert.equal(typeof result.unreachable, 'boolean');
  if (result.unreachable) {
    assert.match(String(result.reason || ''), /closest|short|cannot|could not|not reach/i);
  }
});

test('changing meal prefs rebuilds only today and future; past days stay', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
  const targets = profileById('cholesterol').targets;
  const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById, [], {
    mealPrefs: defaultMealPrefs(),
  });
  const past = '2026-10-20';
  const today = todayIso();
  const pastSnap = structuredClone(plan.days[past]);
  assert.ok(pastSnap.breakfast);

  const next = rebuildPlanMeals(
    plan, targets, recipes, foodsById,
    { breakfast: false, lunch: true, dinner: true, snacks: 1 },
    today,
  );
  assert.deepEqual(next.days[past], pastSnap, 'past day unchanged');
  assert.equal(next.days[today].breakfast, undefined);
  assert.ok(next.days[today].lunch);
});

test('UI source: Targets has My meals controls', () => {
  const src = fs.readFileSync(new URL('../src/ui/targets.js', import.meta.url), 'utf8');
  assert.match(src, /My meals/);
});
