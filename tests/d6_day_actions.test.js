/**
 * D6 (P1): the day screen must allow eaten / skipped / replace / undo directly on
 * a meal row, without opening "Log a meal".
 *
 * The row model is a pure helper (status + the actions the existing rules allow),
 * the "Ate it" save reuses the Log screen payload, and Undo reuses the correction
 * path and the same pure plan function.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';
import { slotRecipeKind } from '../src/engine/meal_prefs.js';
import {
  newLogDraft,
  addRecipeGroup,
  draftSavePayload,
  logEntriesForSave,
  mergeLogEntries,
  savedSlotOutcomes,
} from '../src/ui/log.js';
import {
  removeLogEntry,
  convertLogEntryToSkipped,
  applyLogCorrection,
} from '../src/log_corrections.js';
import {
  mealRowModel,
  dayMealSavePayload,
  MEAL_STATUS_LABELS,
} from '../src/ui/plan.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(root + 'data/foods.json', 'utf8'));
const recipes = JSON.parse(fs.readFileSync(root + 'data/recipes.json', 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const planSrc = fs.readFileSync(root + 'src/ui/plan.js', 'utf8');
const cssSrc = fs.readFileSync(root + 'styles/app.css', 'utf8');

const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);

const TODAY = '2026-10-24';
const PAST = '2026-10-20';
const FUTURE = '2026-10-28';
const planDay = plan.days[TODAY];
const SLOT = Object.keys(planDay).find((slot) => planDay[slot]);
const recipe = recipesById.get(planDay[SLOT]);
const otherRecipe = recipes.find((r) => r.slot === slotRecipeKind(SLOT) && r.id !== recipe.id);

function freezeToday(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
}

const WHEN = { date: TODAY, time: '13:00' };

function eatenEntry() {
  return {
    date: TODAY,
    time: '13:00',
    items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
    eaten: [{ recipeId: recipe.id, slot: SLOT }],
  };
}

function skippedEntry() {
  return {
    date: TODAY,
    time: '13:00',
    skipped: [recipe.id],
    items: [],
    skippedSlots: [{ recipeId: recipe.id, slot: SLOT }],
  };
}

function replacedEntry() {
  return {
    date: TODAY,
    time: '13:00',
    items: otherRecipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
    replaced: [{ slot: SLOT, recipeId: otherRecipe.id, fromRecipeId: recipe.id }],
  };
}

function rowsFor(log, date = TODAY) {
  return savedSlotOutcomes(log, date, plan.days[date], recipesById);
}

function rowFor(log, date = TODAY, today = TODAY) {
  return mealRowModel({
    date,
    today,
    slot: SLOT,
    recipe,
    outcomes: rowsFor(log, date === TODAY ? TODAY : date),
    recipesById,
  });
}

function baseState(log) {
  return {
    profileId: 'cholesterol',
    targets,
    plan,
    planBase: null,
    log,
    bought: [],
    keptForBought: [],
    updateDecisions: [],
    pendingProposal: null,
  };
}

function correctionCtx(state) {
  return {
    state,
    recipes,
    recipesById,
    foodsById,
    screen: 'plan',
    navigate(name) { this.screen = name; },
  };
}

// --- Row model: status and allowed actions ---------------------------------

test('D6 row model: a planned meal offers Ate it, Skipped and Replace today and ahead', () => {
  assert.deepEqual(MEAL_STATUS_LABELS, {
    planned: 'Planned', eaten: 'Eaten', skipped: 'Skipped', replaced: 'Replaced',
  });

  for (const date of [TODAY, FUTURE]) {
    const row = rowFor([], date);
    assert.equal(row.status, 'planned');
    assert.equal(row.statusLabel, 'Planned');
    assert.equal(row.entryIndex, null);
    assert.equal(row.canEat, true, `${date}: a planned meal can be eaten on the day screen`);
    assert.equal(row.canSkip, true, `${date}: a planned meal can be skipped on the day screen`);
    assert.equal(row.canReplace, true, `${date}: a planned meal can be replaced on the day screen`);
    assert.equal(row.canUndo, false);
    assert.equal(row.canChange, false);
  }
});

test('D6 row model: a planned meal on a past day shows no new-action buttons', () => {
  const row = rowFor([], PAST, TODAY);
  assert.equal(row.status, 'planned');
  assert.equal(row.past, true);
  assert.equal(row.canEat, false, 'a day already over cannot be logged as eaten now');
  assert.equal(row.canSkip, false);
  assert.equal(row.canReplace, false);
  assert.equal(row.canUndo, false);
  assert.equal(row.canChange, false);
});

test('D6 row model: Eaten shows Undo and Change to Skipped on any day', () => {
  for (const date of [TODAY, PAST, FUTURE]) {
    const entry = { ...eatenEntry(), date };
    const log = mergeLogEntries([], [entry], { date, planDay: plan.days[date], recipesById });
    const row = rowFor(log, date, TODAY);
    assert.equal(row.status, 'eaten', date);
    assert.equal(row.statusLabel, 'Eaten');
    assert.equal(row.entryIndex, 0);
    assert.equal(row.canUndo, true, `${date}: the correction path removes a saved outcome`);
    assert.equal(row.canChange, true);
    assert.equal(row.changeTo, 'skipped');
    assert.equal(row.canEat, false);
    assert.equal(row.canSkip, false);
    assert.equal(row.canReplace, false);
  }
});

test('D6 row model: Skipped shows Undo and Change to Eaten', () => {
  for (const date of [TODAY, PAST, FUTURE]) {
    const entry = { ...skippedEntry(), date };
    const log = mergeLogEntries([], [entry], { date, planDay: plan.days[date], recipesById });
    const row = rowFor(log, date, TODAY);
    assert.equal(row.status, 'skipped');
    assert.equal(row.statusLabel, 'Skipped');
    assert.equal(row.canUndo, true);
    assert.equal(row.canChange, true, 'the existing convert helper turns a skip back into eaten');
    assert.equal(row.changeTo, 'eaten');
    assert.equal(row.canEat, false);
  }
});

test('D6 row model: Replaced shows Undo but no Change, as the correction rules already decide', () => {
  for (const date of [TODAY, PAST, FUTURE]) {
    const entry = { ...replacedEntry(), date };
    const log = mergeLogEntries([], [entry], { date, planDay: plan.days[date], recipesById });
    const row = rowFor(log, date, TODAY);
    assert.equal(row.status, 'replaced');
    assert.equal(row.statusLabel, 'Replaced');
    assert.equal(row.canUndo, true);
    assert.equal(row.canChange, false, 'a replacement is undone and redone, never flipped to a skip');
    assert.equal(row.changeTo, null);
    assert.equal(row.canEat, false);
  }
});

// --- Same save path as the Log screen --------------------------------------

test('D6: Ate it saves exactly the same log entry as the Log screen for that meal', () => {
  const payload = dayMealSavePayload(recipe, SLOT, 'eat');
  const draft = newLogDraft();
  addRecipeGroup(draft, recipe, SLOT);
  assert.deepEqual(payload, draftSavePayload(draft), 'one meal, same payload shape');

  const fromDayScreen = logEntriesForSave(payload, WHEN);
  const fromLogScreen = logEntriesForSave(draftSavePayload(draft), WHEN);
  assert.deepEqual(fromDayScreen, fromLogScreen);
  assert.equal(fromDayScreen.length, 1);

  const log = mergeLogEntries([], fromDayScreen, { date: TODAY, planDay, recipesById });
  const row = rowFor(log);
  assert.equal(row.status, 'eaten');
  assert.equal(row.entryIndex, 0);
});

test('D6: Skipped saves exactly the same log entry as the Log screen for that meal', () => {
  const payload = dayMealSavePayload(recipe, SLOT, 'skip');
  const draft = newLogDraft();
  addRecipeGroup(draft, recipe, SLOT);
  // The Log screen saves a skipped meal through its own draft helpers.
  const logDraft = newLogDraft();
  logDraft.skipped.push({ recipeId: recipe.id, slot: SLOT });
  assert.deepEqual(payload, draftSavePayload(logDraft));

  const log = mergeLogEntries([], logEntriesForSave(payload, WHEN), { date: TODAY, planDay, recipesById });
  assert.equal(rowFor(log).status, 'skipped');
});

// --- Undo and Change reuse the correction path -----------------------------

test('D6: Undo removes the outcome through the correction path and restores the plan', (t) => {
  freezeToday(t);
  assert.equal(todayIso(), TODAY);

  const skipPayload = dayMealSavePayload(recipe, SLOT, 'skip');
  const entries = logEntriesForSave(skipPayload, WHEN);
  const log = mergeLogEntries([], entries, { date: TODAY, planDay, recipesById });

  // The skipped meal really would have reshaped the following days.
  const proposal = replan({
    targets, recipes, plan, log, bought: [], foodsById, fromDate: TODAY,
  });
  assert.ok(proposal.changed.length > 0, 'skipping a planned meal changes the plan');

  const row = rowFor(log);
  assert.equal(row.canUndo, true);

  const state = baseState(log);
  const ctx = correctionCtx(state);
  const undone = applyLogCorrection(ctx, removeLogEntry(state, row.entryIndex), { fromDate: TODAY });

  assert.equal(undone.planChanged, false, 'with nothing logged there is nothing to make up');
  assert.equal(ctx.screen, 'plan');
  assert.deepEqual(ctx.state.plan.days, plan.days, 'every day is back to the plan before the action');
  assert.equal(ctx.state.log.length, 0);

  // The same row reads as Planned again after Undo.
  assert.equal(rowFor(ctx.state.log).status, 'planned');
});

test('D6: Change switches an eaten meal to Skipped with the existing convert helper', (t) => {
  freezeToday(t);
  const log = mergeLogEntries([], [eatenEntry()], { date: TODAY, planDay, recipesById });
  const row = rowFor(log);
  assert.equal(row.changeTo, 'skipped');

  const state = baseState(log);
  const ctx = correctionCtx(state);
  const corrected = convertLogEntryToSkipped(state, row.entryIndex, row.recipeId, SLOT);
  applyLogCorrection(ctx, corrected, { fromDate: TODAY });

  const outcomes = savedSlotOutcomes(ctx.state.log, TODAY, plan.days[TODAY], recipesById);
  assert.equal(outcomes.get(SLOT)?.kind, 'skipped', 'the row is Skipped after Change');
  assert.equal(rowFor(ctx.state.log).status, 'skipped');
});

// --- Screen wiring and phone layout ---------------------------------------

test('D6: every meal row carries a status chip and the day-screen action buttons', () => {
  assert.match(planSrc, /savedSlotOutcomes\(state\.log, selected/);
  assert.match(planSrc, /meal-status/);
  assert.match(planSrc, /row\.statusLabel/);
  assert.match(planSrc, /data-meal-eat/);
  assert.match(planSrc, />Ate it<\/button>/);
  assert.match(planSrc, /data-meal-skip/);
  assert.match(planSrc, />Skipped<\/button>/);
  assert.match(planSrc, /data-meal-replace/);
  assert.match(planSrc, />Replace<\/button>/);
  assert.match(planSrc, /data-meal-undo/);
  assert.match(planSrc, />Undo<\/button>/);
  assert.match(planSrc, /data-meal-change/);
  assert.match(planSrc, />Change<\/button>/);
  // Buttons are real buttons, so the keyboard reaches them.
  assert.match(planSrc, /<button type="button"[^>]*data-meal-eat/);
  assert.match(planSrc, /<button type="button"[^>]*data-meal-undo/);
});

test('D6: the day actions reuse the Log and correction helpers, not a second planner', () => {
  assert.match(planSrc, /draftSavePayload\(/);
  assert.match(planSrc, /saveLogAndReplan\(/);
  assert.match(planSrc, /removeLogEntry\(/);
  assert.match(planSrc, /applyLogCorrection\(/);
  assert.match(planSrc, /convertLogEntryToSkipped\(/);
  assert.match(planSrc, /convertSkippedEntryToEaten\(/);
  assert.doesNotMatch(planSrc, /\breplan\(/, 'the day screen must not run a second planner');
  assert.doesNotMatch(planSrc, /\blogEntriesForSave\(/, 'the save stays in the one app path');
});

test('D6: the day screen explains the outside-the-menu shortcut and keeps the disclaimer', () => {
  assert.match(planSrc, /Food outside your meals\? Use Add food outside the menu\./);
  assert.match(planSrc, /data-action="log"/);
  assert.match(planSrc, /Support tool, not medical advice\./);
});

test('D6: on a phone the row actions wrap and every button is at least 40 px high', () => {
  assert.match(cssSrc, /\.meal-row-actions[^}]*flex-wrap:\s*wrap/);
  const rule = cssSrc.match(/\.meal-row-actions[^{]*\{[^}]*\}/g) || [];
  const height = rule.map((r) => r.match(/min-height:\s*(\d+)px/)).filter(Boolean).map((m) => Number(m[1]));
  assert.ok(height.some((h) => h >= 40), 'row action buttons must be at least 40 px high');
});
