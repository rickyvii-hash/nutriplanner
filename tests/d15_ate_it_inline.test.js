/**
 * D15 (P1 UX): "Ate it" on the day screen saves the meal and stays on the day
 * screen. Nothing changes: a short status line under the meal list (announced,
 * it disappears on its own). The plan would change: an inline banner with
 * Review the update / Not now, and the proposal stays pending across a reload.
 * Skipped and Replace still open the Plan updated screen because they need a
 * decision. Undo stays on the day screen too and the row reads Planned again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, replan, todayIso } from '../src/engine/planner.js';
import { profileById } from '../src/engine/profiles.js';
import { mergeLogEntries } from '../src/ui/log.js';
import { removeLogEntry, applyLogCorrection } from '../src/log_corrections.js';
import {
  dayMealSavePayload,
  mealRowModel,
  daySaveDecision,
  dayStatusText,
  runDaySave,
  applyDaySaveDecision,
} from '../src/ui/plan.js';
import {
  proposalToStore, pendingProposalForPlan, saveState, loadState, clearState,
} from '../src/store.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(root + 'data/foods.json', 'utf8'));
const recipes = JSON.parse(fs.readFileSync(root + 'data/recipes.json', 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const planSrc = fs.readFileSync(root + 'src/ui/plan.js', 'utf8');
const appSrc = fs.readFileSync(root + 'src/app.js', 'utf8');

const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);
const TODAY = '2026-10-24';
const planDay = plan.days[TODAY];
const SLOT = Object.keys(planDay).find((slot) => planDay[slot]);
const SLOT_LABEL = SLOT.charAt(0).toUpperCase() + SLOT.slice(1);
const recipe = recipesById.get(planDay[SLOT]);

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

function freezeToday(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
}

function eatenEntry() {
  return {
    date: TODAY,
    time: '13:00',
    items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
    eaten: [{ recipeId: recipe.id, slot: SLOT }],
  };
}

function fakeCtx(saveResult) {
  return {
    state: {},
    screen: 'plan',
    saves: [],
    navigations: [],
    refreshes: 0,
    saveLogAndReplan(payload, options) {
      this.saves.push({ payload, options });
      return saveResult;
    },
    navigate(name) { this.navigations.push(name); },
    refresh() { this.refreshes += 1; },
  };
}

// --- The helper decision ----------------------------------------------------

test('D15 decision: a save that leaves the plan alone stays inline with a status line', () => {
  for (const proposal of [null, { nothingToChange: true }]) {
    const decision = daySaveDecision({ action: 'eat', slot: 'breakfast', proposal });
    assert.equal(decision.mode, 'inline');
    assert.equal(decision.stays, true);
    assert.equal(decision.statusText, 'Breakfast logged. Plan unchanged.');
    assert.equal(decision.bannerText, null);
    assert.equal(decision.reviewLabel, null);
  }
});

test('D15 decision: a save that would change the plan shows the inline banner', () => {
  const proposal = { nothingToChange: false, changed: [{ date: '2026-10-25', slot: 'lunch' }] };
  const decision = daySaveDecision({ action: 'eat', slot: 'breakfast', proposal });
  assert.equal(decision.mode, 'banner');
  assert.equal(decision.stays, true);
  assert.equal(decision.statusText, null);
  assert.equal(decision.bannerText, 'Your next days can change because of this meal.');
  assert.equal(decision.reviewLabel, 'Review the update');
  assert.equal(decision.notNowLabel, 'Not now');
  assert.equal(decision.proposal, proposal);
});

test('D15 decision: Skipped and Replace still end on the Plan updated screen', () => {
  for (const action of ['skip', 'replace']) {
    for (const proposal of [null, { nothingToChange: false, changed: [{}] }]) {
      const decision = daySaveDecision({ action, slot: 'lunch', proposal });
      assert.equal(decision.mode, 'navigate', action + ': needs a decision');
      assert.equal(decision.stays, false);
    }
  }
});

test('D15 decision: Undo has its own short status line and also stays', () => {
  const decision = daySaveDecision({ action: 'undo', slot: 'dinner', proposal: null });
  assert.equal(decision.mode, 'inline');
  assert.equal(decision.statusText, 'Dinner is planned again. Plan unchanged.');
  assert.equal(dayStatusText('undo', SLOT), SLOT_LABEL + ' is planned again. Plan unchanged.');
  assert.equal(dayStatusText('eat', 'breakfast'), 'Breakfast logged. Plan unchanged.');
});

// --- No navigation for Ate it ----------------------------------------------

test('D15: Ate it saves with stay and never calls navigate', () => {
  const ctx = fakeCtx({ nothingToChange: true, changed: [] });
  const payload = dayMealSavePayload(recipe, SLOT, 'eat');
  const decision = runDaySave(ctx, { action: 'eat', slot: SLOT, payload, date: TODAY });

  assert.equal(decision.mode, 'inline');
  assert.equal(ctx.navigations.length, 0, 'Ate it must not open another screen');
  assert.equal(ctx.saves.length, 1);
  assert.equal(ctx.saves[0].options.date, TODAY, 'the save keeps the day on screen');
  assert.equal(ctx.saves[0].options.stay, true, 'the save must not navigate on its own');
  assert.equal(ctx.dayStatus, SLOT_LABEL + ' logged. Plan unchanged.');
  assert.equal(ctx.refreshes, 1, 'the day screen redraws in place');
  assert.equal(ctx.screen, 'plan');
});

test('D15: Ate it with a proposal shows the banner inline and still never navigates', () => {
  const proposal = { nothingToChange: false, changed: [{ date: '2026-10-25', slot: 'lunch' }] };
  const ctx = fakeCtx(proposal);
  const decision = runDaySave(ctx, {
    action: 'eat', slot: SLOT, payload: dayMealSavePayload(recipe, SLOT, 'eat'), date: TODAY,
  });
  assert.equal(decision.mode, 'banner');
  assert.equal(ctx.navigations.length, 0);
  assert.equal(ctx.dayStatus, null);
  assert.equal(ctx.refreshes, 1);
});

test('D15: Skipped and Replace still open the Plan updated screen', () => {
  for (const action of ['skip', 'replace']) {
    const ctx = fakeCtx({ nothingToChange: false, changed: [{}] });
    const payload = action === 'skip'
      ? dayMealSavePayload(recipe, SLOT, 'skip')
      : dayMealSavePayload(recipe, SLOT, 'eat');
    const decision = runDaySave(ctx, { action, slot: SLOT, payload, date: TODAY });
    assert.equal(decision.mode, 'navigate');
    assert.deepEqual(ctx.navigations, ['updated'], action + ' needs a decision');
    assert.ok(!ctx.dayStatus, 'a decision that navigates leaves no status line');
  }
});

test('D15: the day screen status line is announced and the banner offers both buttons', () => {
  assert.match(planSrc, /role="status"/);
  assert.match(planSrc, /aria-live="polite"/);
  assert.match(planSrc, /dayStatusText\(/);
  assert.match(planSrc, /daySaveDecision\(/);
  assert.match(planSrc, /runDaySave\(/);
  assert.match(planSrc, /Your next days can change because of this meal\./);
  assert.match(planSrc, />Review the update<\/button>/);
  assert.match(planSrc, />Not now<\/button>/);
  // The save itself stays put: the stay guard comes before the updated screen.
  const fn = appSrc.match(/saveLogAndReplan:[\s\S]*?navigate\('updated'\);/);
  assert.ok(fn, 'saveLogAndReplan must exist');
  assert.match(fn[0], /if\s*\(options\.stay\)\s*return result;/, 'a stay save must return before navigating');
});

// --- The proposal survives a reload ----------------------------------------

test('D15: a pending proposal from a day save is still there after a reload', () => {
  installMemoryStorage();
  const log = [{
    date: TODAY,
    time: '20:00',
    items: [{ foodId: 'pizza-cheese', grams: 700 }, { foodId: 'ice-cream-vanilla', grams: 200 }],
    extra: true,
  }];
  const result = replan({
    targets, recipes, plan, log, bought: [], foodsById, fromDate: TODAY,
  });
  assert.ok(result.changed.length > 0, 'the scenario must propose a change');
  assert.equal(result.nothingToChange, false);

  const state = {
    profileId: 'cholesterol', targets, plan, planBase: null, log, bought: [],
    keptForBought: [], updateDecisions: [],
    pendingProposal: proposalToStore(result),
  };
  saveState(state);
  const loaded = loadState();
  const pending = pendingProposalForPlan(loaded);
  assert.ok(pending, 'the pending proposal must survive a reload');
  assert.equal(pending.nothingToChange, false);
  assert.equal(pending.reason, result.reason);
  assert.deepEqual(pending.plan.days, result.plan.days);
  assert.deepEqual(loaded.plan.days, plan.days, 'the plan on screen is not replaced automatically');
  clearState();
});

// --- Undo stays and the row returns to Planned ------------------------------

test('D15: Undo stays on the day screen and the row reads Planned again', (t) => {
  freezeToday(t);
  assert.equal(todayIso(), TODAY);
  installMemoryStorage();

  const log = mergeLogEntries([], [eatenEntry()], { date: TODAY, planDay, recipesById });
  const state = {
    profileId: 'cholesterol', targets, plan, planBase: null, log, bought: [],
    keptForBought: [], updateDecisions: [], pendingProposal: null,
  };
  const ctx = {
    state, recipes, recipesById, foodsById, screen: 'plan',
    navigations: [],
    refreshes: 0,
    navigate(name) { this.navigations.push(name); this.screen = name; },
    refresh() { this.refreshes += 1; },
  };

  const row = mealRowModel({ date: TODAY, today: TODAY, slot: SLOT, recipe, log, recipesById });
  assert.equal(row.status, 'eaten');

  const corrected = applyLogCorrection(ctx, removeLogEntry(state, row.entryIndex), {
    fromDate: TODAY, stay: true,
  });
  assert.equal(corrected.planChanged, false);
  assert.deepEqual(ctx.navigations, [], 'Undo must not open another screen');
  assert.equal(ctx.screen, 'plan');
  assert.equal(ctx.state.log.length, 0);

  const after = mealRowModel({
    date: TODAY, today: TODAY, slot: SLOT, recipe, log: ctx.state.log, recipesById,
  });
  assert.equal(after.status, 'planned', 'Undo returns the row to Planned');
  assert.equal(after.canEat, true);

  const decision = applyDaySaveDecision(ctx, daySaveDecision({
    action: 'undo', slot: SLOT, proposal: corrected.proposal,
  }));
  assert.equal(decision.mode, 'inline');
  assert.equal(ctx.dayStatus, SLOT_LABEL + ' is planned again. Plan unchanged.');
  assert.equal(ctx.refreshes, 1);
  clearState();
});