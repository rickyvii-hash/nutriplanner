/**
 * D19 (P2 UX, follow-up of D15): "Skipped" and "Replace" only open the Plan
 * updated screen when the save changes the plan. Otherwise they stay on the day
 * screen exactly like "Ate it": the row shows its new chip, the "N of M logged"
 * counter updates, and a short status line says what happened. An extra saved
 * from Outside the menu with no plan change also comes back to the day screen
 * with "Added. Plan unchanged." A save that would change the plan keeps the
 * existing destination (Plan updated for Skipped/Replace/extra, inline banner
 * for Ate it), so the pending proposal behaviour is unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, todayIso } from '../src/engine/planner.js';
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
import { clearState } from '../src/store.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(root + 'data/foods.json', 'utf8'));
const recipes = JSON.parse(fs.readFileSync(root + 'data/recipes.json', 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const planSrc = fs.readFileSync(root + 'src/ui/plan.js', 'utf8');
const appSrc = fs.readFileSync(root + 'src/app.js', 'utf8');
const logSrc = fs.readFileSync(root + 'src/ui/log.js', 'utf8');

const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);
const TODAY = '2026-10-24';
const planDay = plan.days[TODAY];
const SLOT = Object.keys(planDay).find((slot) => planDay[slot]);
const SLOT_LABEL = SLOT.charAt(0).toUpperCase() + SLOT.slice(1);
const recipe = recipesById.get(planDay[SLOT]);

const CHANGED = { nothingToChange: false, changed: [{ date: '2026-10-25', slot: 'lunch' }] };
const NO_CHANGE = { nothingToChange: true, changed: [] };

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

function fakeCtx(saveResult) {
  return {
    state: {},
    screen: 'plan',
    saves: [],
    navigations: [],
    refreshes: 0,
    dayStatus: null,
    proposal: null,
    saveLogAndReplan(payload, options) {
      this.saves.push({ payload, options });
      // The real save keeps the proposal in memory for the Plan updated screen.
      this.proposal = saveResult;
      return saveResult;
    },
    navigate(name) { this.navigations.push(name); this.screen = name; },
    refresh() { this.refreshes += 1; },
  };
}

// --- The helper decision, action by action ---------------------------------

test('D19 helper: Ate it with no change stays inline with its status line', () => {
  const decision = daySaveDecision({ action: 'eat', slot: 'breakfast', proposal: NO_CHANGE });
  assert.equal(decision.mode, 'inline');
  assert.equal(decision.stays, true);
  assert.equal(decision.statusText, 'Breakfast logged. Plan unchanged.');
  assert.equal(decision.bannerText, null);
});

test('D19 helper: Skipped with no change stays inline, it does not open a screen', () => {
  for (const proposal of [null, NO_CHANGE]) {
    const decision = daySaveDecision({ action: 'skip', slot: 'lunch', proposal });
    assert.equal(decision.mode, 'inline');
    assert.equal(decision.stays, true);
    assert.equal(decision.statusText, 'Lunch skipped. Plan unchanged.');
    assert.equal(decision.bannerText, null);
    assert.equal(decision.proposal, null);
  }
});

test('D19 helper: Replace (another recipe) with no change stays inline', () => {
  for (const proposal of [null, NO_CHANGE]) {
    const decision = daySaveDecision({ action: 'replace', slot: 'lunch', proposal });
    assert.equal(decision.mode, 'inline');
    assert.equal(decision.stays, true);
    assert.equal(decision.statusText, 'Lunch replaced. Plan unchanged.');
  }
});

test('D19 helper: Replace (I ate something else / custom food) with no change stays inline', () => {
  // Both Replace paths (another recipe and free-search/custom food) call the same
  // day-screen action `replace`, so they share the same inline decision.
  const decision = daySaveDecision({ action: 'replace', slot: 'breakfast', proposal: NO_CHANGE });
  assert.equal(decision.mode, 'inline');
  assert.equal(decision.statusText, 'Breakfast replaced. Plan unchanged.');
});

test('D19 helper: an extra with no change is inline and returns to the day screen', () => {
  const decision = daySaveDecision({ action: 'extra', proposal: NO_CHANGE });
  assert.equal(decision.mode, 'inline');
  assert.equal(decision.stays, false);
  assert.equal(decision.target, 'plan');
  assert.equal(decision.statusText, 'Added. Plan unchanged.');
});

test('D19 helper: a real proposal keeps every action on its existing destination', () => {
  // Ate it keeps the inline banner (D15).
  const eat = daySaveDecision({ action: 'eat', slot: 'breakfast', proposal: CHANGED });
  assert.equal(eat.mode, 'banner');
  assert.equal(eat.stays, true);
  assert.equal(eat.proposal, CHANGED);

  // Skipped and Replace open Plan updated because the person must choose.
  for (const action of ['skip', 'replace']) {
    const decision = daySaveDecision({ action, slot: 'lunch', proposal: CHANGED });
    assert.equal(decision.mode, 'navigate', action + ' needs a decision');
    assert.equal(decision.stays, false);
    assert.equal(decision.target, 'updated');
    assert.equal(decision.statusText, null);
  }

  // An extra with a real change still opens Plan updated, as before.
  const extra = daySaveDecision({ action: 'extra', proposal: CHANGED });
  assert.equal(extra.mode, 'navigate');
  assert.equal(extra.target, 'updated');
});

test('D19 helper: Undo keeps its own inline status line', () => {
  const decision = daySaveDecision({ action: 'undo', slot: 'dinner', proposal: null });
  assert.equal(decision.mode, 'inline');
  assert.equal(decision.statusText, 'Dinner is planned again. Plan unchanged.');
  assert.equal(dayStatusText('skip', 'lunch'), 'Lunch skipped. Plan unchanged.');
  assert.equal(dayStatusText('replace', 'breakfast'), 'Breakfast replaced. Plan unchanged.');
  assert.equal(dayStatusText('extra'), 'Added. Plan unchanged.');
});

// --- Day-screen saves -------------------------------------------------------

test('D19: Skipped with no change never navigates and shows its status inline', () => {
  const ctx = fakeCtx(NO_CHANGE);
  const payload = dayMealSavePayload(recipe, SLOT, 'skip');
  const decision = runDaySave(ctx, { action: 'skip', slot: SLOT, payload, date: TODAY });

  assert.equal(decision.mode, 'inline');
  assert.deepEqual(ctx.navigations, [], 'Skipped must not open another screen');
  assert.equal(ctx.saves.length, 1);
  assert.equal(ctx.saves[0].options.stay, true);
  assert.equal(ctx.dayStatus, SLOT_LABEL + ' skipped. Plan unchanged.');
  assert.equal(ctx.refreshes, 1, 'the day screen redraws in place');
  assert.equal(ctx.screen, 'plan');
});

test('D19: Replace with no change never navigates and shows its status inline', () => {
  const ctx = fakeCtx({ nothingToChange: true, changed: [] });
  // A replacement payload stands for both "another recipe" and "I ate something
  // else"; the outcome is what the day screen reacts to.
  const payload = {
    items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
    skipped: [],
    replaced: [{ slot: SLOT, recipeId: recipe.id, fromRecipeId: recipe.id }],
  };
  const decision = runDaySave(ctx, { action: 'replace', slot: SLOT, payload, date: TODAY });

  assert.equal(decision.mode, 'inline');
  assert.deepEqual(ctx.navigations, []);
  assert.equal(ctx.dayStatus, SLOT_LABEL + ' replaced. Plan unchanged.');
  assert.equal(ctx.refreshes, 1);
});

test('D19: Skipped and Replace with a real proposal still open Plan updated', () => {
  for (const action of ['skip', 'replace']) {
    const ctx = fakeCtx(CHANGED);
    const payload = action === 'skip'
      ? dayMealSavePayload(recipe, SLOT, 'skip')
      : dayMealSavePayload(recipe, SLOT, 'eat');
    const decision = runDaySave(ctx, { action, slot: SLOT, payload, date: TODAY });
    assert.equal(decision.mode, 'navigate', action + ' needs a decision');
    assert.deepEqual(ctx.navigations, ['updated'], action + ' opens Plan updated');
    assert.equal(ctx.dayStatus, null, 'a screen that asks must not leave a status line');
    assert.equal(ctx.proposal, CHANGED, 'the pending proposal is kept for that screen');
  }
});

test('D19: Undo after an inline skip returns the row to Planned', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
  assert.equal(todayIso(), TODAY);
  installMemoryStorage();

  const skippedEntry = {
    date: TODAY,
    time: '13:00',
    skipped: [recipe.id],
    items: [],
    skippedSlots: [{ recipeId: recipe.id, slot: SLOT }],
  };
  const log = mergeLogEntries([], [skippedEntry], { date: TODAY, planDay, recipesById });
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
  assert.equal(row.status, 'skipped');
  assert.equal(row.canUndo, true);
  assert.equal(row.canChange, true, 'a skipped meal can be changed to eaten');

  const corrected = applyLogCorrection(ctx, removeLogEntry(state, row.entryIndex), {
    fromDate: TODAY, stay: true,
  });
  assert.equal(corrected.planChanged, false);
  assert.deepEqual(ctx.navigations, [], 'Undo must not open another screen');
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

// --- Outside the menu: an extra with no change comes back to the day --------

test('D19: an extra with no change returns to the day screen with "Added. Plan unchanged."', () => {
  const ctx = fakeCtx(NO_CHANGE);
  const decision = applyDaySaveDecision(ctx, daySaveDecision({
    action: 'extra', proposal: NO_CHANGE,
  }));
  assert.equal(decision.mode, 'inline');
  assert.deepEqual(ctx.navigations, ['plan'], 'the day screen, not the Plan checked screen');
  assert.equal(ctx.dayStatus, 'Added. Plan unchanged.');
  assert.equal(ctx.refreshes, 0, 'the day screen is painted by navigation');
});

test('D19: the outside-the-menu save uses the extra decision and keeps Plan updated on a change', () => {
  // The save itself still stays so app.js can decide, and the changed branch
  // still opens Plan updated.
  assert.match(appSrc, /daySaveDecision\(\{\s*action:\s*options\.action \|\| 'extra'/);
  assert.match(appSrc, /ctx\.dayStatus = decision\.statusText/);
  assert.match(appSrc, /ctx\.navigate\('plan'\)/);
  assert.match(appSrc, /ctx\.navigate\('updated'\);/);
  // The outside-the-menu screen still saves through the same log path.
  assert.match(logSrc, /saveLogAndReplan\(draftSavePayload\(draft\)\)/);
  // The day screen's inline status stays announced as a status message.
  assert.match(planSrc, /data-day-status role="status" aria-live="polite"/);
});