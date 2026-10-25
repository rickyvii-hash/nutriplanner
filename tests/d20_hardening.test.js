/**
 * D20 (P2 hardening): small defects found by a full code review.
 * Transient screen state is reset in one place, a replaced meal is labelled as
 * replaced, target rows cannot reuse a nutrient, overlays clean up their key
 * listener, the Outside-the-menu back link asks before discarding, meal-pref
 * changes drop decisions that belong to the old base plan, and the guide flag
 * survives a backup round trip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TRANSIENT_SCREEN_KEYS,
  TRANSIENT_SCREEN_DEFAULTS,
  resetTransientScreenState,
} from '../src/screen_state.js';
import { availableTargetNutrients, applyMealPrefsState } from '../src/ui/targets.js';
import { NUTRIENTS } from '../src/engine/nutrients.js';
import { logEntryKind } from '../src/ui/plan.js';
import { backDecision, draftHasFoods, DISCARD_DRAFT_COPY } from '../src/ui/log.js';
import { buildPlan, replan } from '../src/engine/planner.js';
import { rebuildPlanMeals, defaultMealPrefs } from '../src/engine/meal_prefs.js';
import { recomputeShownPlan } from '../src/engine/plan_from_log.js';
import { profileById } from '../src/engine/profiles.js';
import {
  buildExportPayload, validateImportPayload, applyImportPayload,
} from '../src/engine/export_import.js';
import { emptyAppState } from '../src/store.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (rel) => fs.readFileSync(root + rel, 'utf8');
const appSrc = read('src/app.js');
const logSrc = read('src/ui/log.js');
const planSrc = read('src/ui/plan.js');
const targetsSrc = read('src/ui/targets.js');
const guideSrc = read('src/ui/guide.js');
const detailSrc = read('src/ui/recipe_detail.js');

const foods = JSON.parse(fs.readFileSync(root + 'data/foods.json', 'utf8'));
const recipes = JSON.parse(fs.readFileSync(root + 'data/recipes.json', 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

// --- 1) One reset of the transient screen state -----------------------------

test('D20 reset helper clears every transient screen value in place', () => {
  const saved = { plan: { month: '2026-10', days: {} }, log: [{ date: '2026-10-24' }] };
  const ctx = {
    state: saved,
    openReplace: { date: '2026-10-24', slot: 'lunch' },
    dayStatus: 'Lunch skipped. Plan unchanged.',
    dayBannerMinimized: true,
    logNotice: 'Log corrected.',
    suppressStripScroll: true,
  };
  const returned = resetTransientScreenState(ctx);
  assert.equal(returned, ctx, 'the same context is returned');
  assert.equal(ctx.openReplace, TRANSIENT_SCREEN_DEFAULTS.openReplace);
  assert.equal(ctx.dayStatus, TRANSIENT_SCREEN_DEFAULTS.dayStatus);
  assert.equal(ctx.dayBannerMinimized, TRANSIENT_SCREEN_DEFAULTS.dayBannerMinimized);
  assert.equal(ctx.logNotice, TRANSIENT_SCREEN_DEFAULTS.logNotice);
  assert.equal(ctx.suppressStripScroll, TRANSIENT_SCREEN_DEFAULTS.suppressStripScroll);
  assert.equal(ctx.suppressStripScroll, false);
  assert.equal(ctx.dayBannerMinimized, false);
  assert.deepEqual(ctx.state, saved, 'the saved state is untouched');
});

test('D20 reset helper lists exactly the five transient keys', () => {
  assert.deepEqual([...TRANSIENT_SCREEN_KEYS].sort(), [
    'dayBannerMinimized', 'dayStatus', 'logNotice', 'openReplace', 'suppressStripScroll',
  ]);
  // A missing context is a no-op, not a crash.
  assert.equal(resetTransientScreenState(null), null);
});

test('D20 the three confirmations reset through the one helper', () => {
  for (const name of ['confirmStartOver', 'confirmRestore', 'confirmChangeProfile']) {
    const body = appSrc.match(new RegExp(`${name}:[\\s\\S]*?\\n  \\},`));
    assert.ok(body, `${name} must exist`);
    assert.match(body[0], /resetTransientScreenState\(ctx\)/, `${name} must use the helper`);
  }
  assert.match(appSrc, /from '\.\/screen_state\.js'/);
});

test('D20 rendering Outside the menu clears the one-shot scroll guard', () => {
  const body = logSrc.match(/export function renderLog\(ctx\) \{[\s\S]*?\n\}/);
  assert.ok(body);
  assert.match(body[0], /ctx\.suppressStripScroll = false;/);
});

// --- 2) A replaced meal is not an eaten meal --------------------------------

test('D20 a replaced entry reads "Replaced", never as an eaten planned meal', () => {
  const replaced = {
    date: '2026-10-24',
    time: '13:00',
    items: [{ foodId: foods[0].id, grams: 100 }],
    replaced: [{ slot: 'breakfast', recipeId: 'other', fromRecipeId: 'planned' }],
  };
  assert.equal(logEntryKind(replaced, recipesById.get('planned') || null), 'Replaced · breakfast');

  const noSlot = { ...replaced, replaced: [{ recipeId: 'other', fromRecipeId: 'planned' }] };
  assert.equal(logEntryKind(noSlot, null), 'Replaced');
  assert.doesNotMatch(planSrc, /Eaten · replaced/);
});

// --- 3) Targets cannot reuse a nutrient ------------------------------------

test('D20 availableTargetNutrients hides nutrients used by another row', () => {
  const targets = [
    { nutrient: 'kcal', kind: 'min', daily: 2000 },
    { nutrient: 'protein', kind: 'min', daily: 70 },
  ];
  const first = availableTargetNutrients(targets, 0);
  const second = availableTargetNutrients(targets, 1);
  assert.ok(first.includes('kcal'), 'the row keeps its own nutrient');
  assert.ok(!first.includes('protein'), 'another row already uses protein');
  assert.ok(second.includes('protein'));
  assert.ok(!second.includes('kcal'));
  assert.equal(first.length, NUTRIENTS.length - 1);
  assert.equal(new Set([...first, 'protein']).size, NUTRIENTS.length);

  // Duplicates already saved are not offered: the shared key stays hidden.
  const duplicate = [
    { nutrient: 'kcal', kind: 'min', daily: 2000 },
    { nutrient: 'kcal', kind: 'min', daily: 2100 },
  ];
  assert.ok(!availableTargetNutrients(duplicate, 0).includes('kcal'));
  assert.ok(!availableTargetNutrients(duplicate, 1).includes('kcal'));
});

test('D20 the nutrient select disables used options and Build reports no targets', () => {
  assert.match(targetsSrc, /opt\.disabled = !available\.has\(n\.key\)/);
  assert.match(targetsSrc, /data-build-hint hidden>Add at least one target first/);
  assert.match(targetsSrc, /buildBtn\.disabled = true/);
});

// --- 4) One overlay listener per overlay -----------------------------------

test('D20 guide and recipe overlays drop the old listener when replaced', () => {
  for (const src of [guideSrc, detailSrc]) {
    assert.match(src, /active(?:Guide|Detail)Cleanup/);
    assert.match(src, /document\.removeEventListener\('keydown', onKey\)/);
  }
  assert.match(guideSrc, /if \(activeGuideCleanup\) activeGuideCleanup\(\);/);
  assert.match(detailSrc, /if \(activeDetailCleanup\) activeDetailCleanup\(\);/);
});

// --- 5) Back from Outside the menu asks before discarding ------------------

test('D20 the back decision matches the "To add" list', () => {
  assert.equal(draftHasFoods({ items: [] }), false);
  assert.equal(draftHasFoods(null), false);
  assert.equal(draftHasFoods({ items: [{ foodId: 'x', grams: 10 }] }), true);

  assert.deepEqual(backDecision({ items: [] }), { confirm: false, target: 'plan' });
  assert.deepEqual(backDecision(null), { confirm: false, target: 'plan' });

  const decision = backDecision({ items: [{ foodId: 'x', grams: 10 }] });
  assert.equal(decision.confirm, true);
  assert.equal(decision.title, 'Discard what you entered?');
  assert.equal(decision.body, DISCARD_DRAFT_COPY.body);
  assert.equal(decision.discardLabel, 'Discard');
  assert.equal(decision.keepLabel, 'Keep editing');
  assert.match(DISCARD_DRAFT_COPY.title, /Discard what you entered\?/);
});

// --- 6) Meal-pref changes drop decisions of the old base plan --------------

const TARGETS = profileById('cholesterol').targets;
const TRIGGER = '2026-10-24';
const PREFS = defaultMealPrefs();

function staleScenario() {
  const plan0 = buildPlan(TARGETS, recipes, { year: 2026, month: 10 }, foodsById, [], {
    mealPrefs: PREFS,
  });
  const pizza = foods.find((f) => /pizza/i.test(f.name));
  const log = [{
    date: TRIGGER, time: '13:00', extra: true,
    items: [{ foodId: pizza.id, grams: 400 }],
  }];
  // The first update is accepted against the original plan.
  const accepted = replan({
    targets: TARGETS, recipes, plan: plan0, log, bought: [],
    foodsById, fromDate: TRIGGER, logFromDate: TRIGGER, mealPrefs: PREFS,
  });
  assert.equal(accepted.nothingToChange, false, 'the off-plan food must move later days');
  const state = {
    ...emptyAppState(),
    profileId: 'cholesterol',
    targets: TARGETS,
    mealPrefs: PREFS,
    plan: accepted.plan,
    planBase: plan0,
    log,
    updateDecisions: [{ triggerDate: TRIGGER, accepted: true }],
    pendingProposal: null,
  };
  return { state, plan0 };
}

test('D20 stale decisions can be replayed against a rebuilt base plan', () => {
  const { state } = staleScenario();
  const nextPrefs = { breakfast: false, lunch: true, dinner: true, snacks: 1 };
  const rebuilt = rebuildPlanMeals(state.plan, state.targets, recipes, foodsById, nextPrefs, TRIGGER);
  const replayed = recomputeShownPlan({
    planBase: rebuilt,
    plan: rebuilt,
    log: state.log,
    decisions: state.updateDecisions,
    today: TRIGGER,
    targets: state.targets,
    recipes,
    foodsById,
    bought: [],
    mealPrefs: nextPrefs,
  });
  assert.ok(replayed.proposal, 'the old decision still changes the rebuilt plan');
  assert.ok(replayed.result.changed.length > 0);
});

test('D20 applyMealPrefsState clears decisions, proposal and base; the log stays', () => {
  const { state, plan0 } = staleScenario();
  const logBefore = structuredClone(state.log);
  const nextPrefs = { breakfast: false, lunch: true, dinner: true, snacks: 1 };
  const next = applyMealPrefsState(state, {
    prefs: nextPrefs, recipes, foodsById, today: TRIGGER,
  });

  assert.deepEqual(next.mealPrefs, nextPrefs);
  assert.deepEqual(next.updateDecisions, [], 'decisions of the old base plan are dropped');
  assert.equal(next.planBase, null);
  assert.equal(next.pendingProposal, null);
  assert.deepEqual(next.keptForBought, []);
  assert.deepEqual(next.log, logBefore, 'the logged meals stay exactly as they were');
  assert.notEqual(next.plan, plan0, 'the plan is the rebuilt one');
  assert.ok(next.plan.days[TRIGGER].lunch);
});

// --- 7) guideDismissed survives a backup round trip ------------------------

test('D20 guideDismissed is exported, restored and optional in older files', () => {
  const state = { ...emptyAppState(), profileId: 'cholesterol', guideDismissed: true };
  const payload = buildExportPayload(state);
  assert.equal(payload.guideDismissed, true);

  const check = validateImportPayload(payload);
  assert.equal(check.ok, true);
  assert.equal(applyImportPayload(emptyAppState(), payload).guideDismissed, true);

  // An older backup has no flag: it still restores, and the guide is shown again.
  const older = buildExportPayload({ ...emptyAppState(), profileId: 'cholesterol' });
  delete older.guideDismissed;
  const olderCheck = validateImportPayload(older);
  assert.equal(olderCheck.ok, true, 'older backups still restore');
  assert.equal(applyImportPayload(emptyAppState(), older).guideDismissed, false);
});
