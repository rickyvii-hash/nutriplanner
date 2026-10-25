/**
 * D26 (P1, second part of D25): a person who already knows they will eat
 * something outside the menu later can enter it in advance. The planned food is
 * NOT eaten food: it lives in its own list, never counts as logged, and the plan
 * treats it as expected intake for that day only. The pure plan function stays
 * pure: planned extras are an input like the log, so adding, correcting, eating
 * or removing one always recomputes everything from the base plan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import {
  buildPlan, replan, dayTotals, effectChange,
} from '../src/engine/planner.js';
import { recomputeShownPlan } from '../src/engine/plan_from_log.js';
import { loggedNutrients } from '../src/engine/nutrients.js';
import { buildSummary } from '../src/engine/summary.js';
import {
  emptyAppState, startOverState, saveState, loadState, clearState,
} from '../src/store.js';
import { buildExportPayload, applyImportPayload } from '../src/engine/export_import.js';
import {
  makePlannedExtra, plannedExtraToLogEntry, plannedExtraFoodNames,
  plannedExtraLabel, plannedExtrasForDate, normalizePlannedExtras,
  PLANNED_DEFAULT_TIME, PLANNED_EXTRA_LABEL, PLANNED_EXTRA_NOT_LOGGED,
} from '../src/engine/planned_extras.js';
import {
  validatePlannedWhen, plannedWhenBounds, PLANNED_WHEN_ERROR, savedSlotOutcomes,
} from '../src/ui/log.js';
import { dayProgressTotals, dayMealProgress } from '../src/ui/plan.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const logSrc = read('src/ui/log.js');
const planSrc = read('src/ui/plan.js');
const appSrc = read('src/app.js');
const storeSrc = read('src/store.js');
const exportSrc = read('src/engine/export_import.js');

const MONTH = { year: 2026, month: 10 };
const TODAY = '2026-10-24';
const TOMORROW = '2026-10-25';
const LAST_DAY = '2026-10-31';
const PAST = '2026-10-22';
const PIZZA = 'pizza-cheese';
const ICE_CREAM = 'ice-cream-vanilla';
const COLA = 'beverages-carbonated-cola-regular';

const targetsFor = (id) => profileById(id).targets;
const basePlanFor = (id) => buildPlan(targetsFor(id), recipes, MONTH, foodsById);

/** A restaurant dinner entered in advance. */
function dinner(date = TOMORROW, id = 'planned-' + date) {
  return makePlannedExtra({
    id,
    date,
    time: PLANNED_DEFAULT_TIME,
    items: [
      { foodId: PIZZA, grams: 300 },
      { foodId: ICE_CREAM, grams: 100 },
      { foodId: COLA, grams: 500 },
    ],
  });
}

function extraTotals(extra) {
  return loggedNutrients(extra.items, foodsById).totals;
}

// --- 1) The "When did you eat it?" control ---------------------------------

test('D26 when control: a third chip "Planned" with its own date and time fields', () => {
  assert.equal(PLANNED_DEFAULT_TIME, '20:00');
  assert.match(logSrc, /data-when-planned/);
  assert.match(logSrc, />Planned<\/button>/);
  assert.match(logSrc, /data-planned-date/);
  assert.match(logSrc, /data-planned-time/);
  assert.match(logSrc, /PLANNED_DEFAULT_TIME/);
  assert.match(logSrc, /PLANNED_WHEN_ERROR/);
  assert.match(logSrc, />Save and update plan<\/button>/);
  assert.match(logSrc, /savePlannedExtra/);
});

test('D26 validation: a day after today is accepted, anything else is refused', () => {
  assert.equal(PLANNED_WHEN_ERROR, 'Pick a day after today.');
  const bounds = { lastDate: LAST_DAY };
  const ok = validatePlannedWhen({
    date: TOMORROW, time: '20:00', today: TODAY, ...bounds,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.message, null);

  for (const [date, time] of [
    [TODAY, '20:00'],
    [PAST, '20:00'],
    ['2026-11-01', '20:00'],
    [TOMORROW, ''],
    ['', '20:00'],
  ]) {
    const check = validatePlannedWhen({ date, time, today: TODAY, ...bounds });
    assert.equal(check.ok, false, date + ' ' + time);
    assert.equal(check.message, PLANNED_WHEN_ERROR);
  }
  assert.match(PLANNED_WHEN_ERROR, /Pick a day after today\./);
});

test('D26 bounds: the planned date starts tomorrow and ends on the last plan day', () => {
  const plan = basePlanFor('cholesterol');
  assert.deepEqual(plannedWhenBounds(plan, TODAY), { minDate: TOMORROW, lastDate: LAST_DAY });
});

// --- 2) Stored apart, saved, restored and cleared --------------------------

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

function stateWith(id, plannedExtras = [], log = []) {
  return {
    ...emptyAppState(),
    profileId: id,
    targets: targetsFor(id),
    plan: basePlanFor(id),
    log,
    plannedExtras,
  };
}

test('D26 state: planned extras live in their own list and are not the log', () => {
  const empty = emptyAppState();
  assert.deepEqual(empty.plannedExtras, []);
  assert.deepEqual(startOverState().plannedExtras, []);
  assert.match(storeSrc, /plannedExtras/);

  installMemoryStorage();
  const extra = dinner();
  saveState(stateWith('cholesterol', [extra]));
  const loaded = loadState();
  assert.deepEqual(loaded.log, []);
  assert.equal(loaded.plannedExtras.length, 1);
  assert.equal(loaded.plannedExtras[0].id, extra.id);
  assert.equal(loaded.plannedExtras[0].date, TOMORROW);
  assert.equal(loaded.plannedExtras[0].time, '20:00');
  assert.deepEqual(loaded.plannedExtras[0].items, extra.items);
  clearState();
});

test('D26 export and restore keep planned extras; older backups still restore', () => {
  const extra = dinner();
  const state = stateWith('cholesterol', [extra]);
  const payload = buildExportPayload(state);
  assert.deepEqual(payload.log, [], 'a planned meal is never written to the log');
  assert.equal(payload.plannedExtras.length, 1);
  assert.equal(payload.plannedExtras[0].date, TOMORROW);

  const restored = applyImportPayload(stateWith('cholesterol'), payload);
  assert.equal(restored.plannedExtras.length, 1);
  assert.equal(restored.plannedExtras[0].id, extra.id);

  // A backup from before D26 has no field at all and still restores.
  const older = { ...payload };
  delete older.plannedExtras;
  const fromOlder = applyImportPayload(stateWith('cholesterol'), older);
  assert.deepEqual(fromOlder.plannedExtras, []);
  assert.match(exportSrc, /plannedExtras/);
});

test('D26 counting: planned extras are not progress, not logged and not in the summary', () => {
  const id = 'cholesterol';
  const plan = basePlanFor(id);
  const extra = dinner();
  const state = stateWith(id, [extra]);
  const totals = extraTotals(extra);
  assert.ok(totals.kcal > 0, 'the fixture has real nutrients');

  const dayLog = state.log.filter((entry) => entry.date === TOMORROW);
  const progress = dayProgressTotals(plan.days[TOMORROW], dayLog, recipesById, foodsById);
  assert.equal(progress.result.totals.kcal, 0, 'planned food never counts as eaten');

  const outcomes = savedSlotOutcomes(state.log, TOMORROW, plan.days[TOMORROW], recipesById);
  const counters = dayMealProgress({
    planDay: plan.days[TOMORROW],
    slots: Object.keys(plan.days[TOMORROW]),
    outcomes,
  });
  assert.equal(counters.logged, 0);
  assert.match(counters.text, /^0 of \d+ meals logged$/);

  const summary = buildSummary({
    targets: state.targets,
    plan,
    log: state.log,
    recipesById,
    foodsById,
  });
  assert.equal(summary.loggedDays, 0);
  assert.equal(summary.meals.length, 0);
  assert.equal(summary.source, 'plan');
});

test('D26 day labels: today and later show the time, a passed day says not logged', () => {
  const extra = dinner();
  assert.equal(plannedExtraLabel(extra, { today: TODAY }), PLANNED_EXTRA_LABEL + ' · 20:00');
  const past = dinner(PAST);
  assert.equal(plannedExtraLabel(past, { today: TODAY }), PLANNED_EXTRA_NOT_LOGGED);
  assert.equal(PLANNED_EXTRA_LABEL, 'Planned outside the menu');

  const list = [dinner(TOMORROW, 'b'), dinner(TOMORROW, 'a'), dinner('2026-10-27', 'c')];
  assert.deepEqual(
    plannedExtrasForDate(list, TOMORROW).map((x) => x.id).sort(),
    ['a', 'b'],
  );
  // The normaliser drops entries with no date or no food, never invents data.
  const cleaned = normalizePlannedExtras([{ date: 'nope', items: [] }, extra]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].id, extra.id);
});

// --- 3) The plan leaves room on that day only -----------------------------

for (const profileId of ['cholesterol', 'weight-loss']) {
  test('D26 plan (' + profileId + "): a planned extra lowers that day's other meals, and the reason quotes it", () => {
    const plan = basePlanFor(profileId);
    const targets = targetsFor(profileId);
    const extra = dinner();
    const totals = extraTotals(extra);

    const result = replan({
      targets,
      recipes,
      plan,
      log: [],
      bought: [],
      foodsById,
      fromDate: TOMORROW,
      plannedExtras: [extra],
    });

    assert.ok(result.changed.length > 0, 'the day could not leave room: ' + result.reason);
    for (const change of result.changed) {
      assert.equal(change.date, TOMORROW, 'only the planned day may change');
    }

    const before = dayTotals(plan.days[TOMORROW], recipesById, foodsById).totals;
    const after = dayTotals(result.plan.days[TOMORROW], recipesById, foodsById).totals;
    for (const t of targets) {
      if (t.kind !== 'max' || !(totals[t.nutrient] > 0)) continue;
      assert.ok(after[t.nutrient] <= before[t.nutrient] + 1e-9,
        profileId + ': ' + t.nutrient + ' must leave room: ' + after[t.nutrient] + ' vs ' + before[t.nutrient]);
    }

    const names = plannedExtraFoodNames(extra, foodsById);
    assert.match(result.reason, /^You planned /);
    assert.ok(result.reason.includes(' on ' + TOMORROW + ", so that day's other meals"), result.reason);
    for (const name of names) {
      assert.ok(result.reason.includes(name), 'reason names ' + name + ': ' + result.reason);
    }

    // Any per-day number the reason quotes is a number the Effect rows show.
    const quoted = result.reason.match(/about ([\d.]+) (kcal|mg|g) (lower|higher) in /);
    assert.ok(quoted, result.reason);
    const amount = Number(quoted[1]);
    const unit = quoted[2];
    const agrees = result.effects.some((effect) => {
      const effectUnit = effect.nutrient === 'kcal' ? 'kcal' : effect.nutrient === 'sodium' ? 'mg' : 'g';
      const change = Math.abs(effectChange(effect.nutrient, effect));
      return effectUnit === unit && change === amount;
    });
    assert.ok(agrees, 'the reason quotes ' + amount + ' ' + unit + ' but no Effect row agrees: ' + result.reason);
    assert.equal(result.nothingToChange, false);
  });
}

test('D26 plan (recovery): a planned extra reduces only its own day shortfall, like an eaten extra', () => {
  const profileId = 'recovery';
  const plan = basePlanFor(profileId);
  plan.days['2026-10-21'].lunch = 'chicken-rice-bowl';
  const skip = { date: '2026-10-21', time: '09:00', skipped: ['chicken-rice-bowl'], items: [] };

  const run = (plannedExtras, log = [skip]) => replan({
    targets: targetsFor(profileId),
    recipes,
    plan,
    log,
    bought: [],
    foodsById,
    fromDate: '2026-10-21',
    plannedExtras,
  });

  const base = run([]);
  assert.ok(base.shortfall.kcal > 0, 'the skip leaves energy to make up');
  const extra = dinner('2026-10-21');
  const extraKcal = extraTotals(extra).kcal;

  const withPlanned = run([extra]);
  const expected = Math.max(0, base.shortfall.kcal - extraKcal);
  assert.ok(Math.abs((withPlanned.shortfall.kcal || 0) - expected) < 1e-6,
    'expected ' + expected + ', got ' + withPlanned.shortfall.kcal);

  // The same foods written as an eaten extra on that date follow the offset rule too.
  const eaten = plannedExtraToLogEntry(extra);
  const asEaten = run([], [skip, eaten]);
  assert.ok(Math.abs((asEaten.shortfall.kcal || 0) - (withPlanned.shortfall.kcal || 0)) < 1e-6,
    'the same offset rule applies to planned and eaten extras');

  // An extra planned on another day must not cover this day's skip.
  const elsewhere = run([dinner('2026-10-22')]);
  assert.ok(Math.abs((elsewhere.shortfall.kcal || 0) - base.shortfall.kcal) < 1e-6);
});

// --- 4) Purity: add, remove and "Ate it" all replay from the base ----------

for (const profileId of ['cholesterol', 'weight-loss']) {
  test('D26 purity (' + profileId + '): add then remove equals never adding; "Ate it" equals one-step logging', () => {
    const plan = basePlanFor(profileId);
    const targets = targetsFor(profileId);
    const extra = dinner();
    const baseArgs = {
      planBase: plan,
      log: [],
      decisions: [],
      today: TODAY,
      targets,
      recipes,
      foodsById,
      bought: [],
      fromDate: TOMORROW,
    };

    const added = recomputeShownPlan({ ...baseArgs, plan, plannedExtras: [extra] });
    assert.ok(added.proposal, profileId + ': adding a big planned meal must change the plan');
    assert.match(added.result.reason, /^You planned /);

    // A reload of an accepted update replays it from the base, planned day included.
    const replayed = recomputeShownPlan({
      ...baseArgs,
      plan: added.plan,
      decisions: [{ triggerDate: TOMORROW, accepted: true }],
      plannedExtras: [extra],
    });
    assert.deepEqual(replayed.plan.days[TOMORROW], added.plan.days[TOMORROW],
      profileId + ': the accepted planned update survives a replay');

    const removed = recomputeShownPlan({
      ...baseArgs,
      plan: added.plan,
      plannedExtras: [],
    });
    assert.equal(removed.proposal, null, 'removing it leaves nothing to decide');
    assert.equal(removed.result.nothingToChange, true);
    assert.deepEqual(removed.plan.days, plan.days, 'the plan is identical to never adding it');

    // "Ate it": the same foods move into the log, on the same date and time.
    const entry = plannedExtraToLogEntry(extra);
    assert.equal(entry.date, TOMORROW);
    assert.equal(entry.time, '20:00');
    assert.equal(entry.extra, true);
    assert.deepEqual(entry.items, extra.items);

    const ate = recomputeShownPlan({
      ...baseArgs,
      plan: added.plan,
      log: [entry],
      plannedExtras: [],
    });
    // The one-step reference: those foods were logged as an extra from the start.
    const oneStep = recomputeShownPlan({
      ...baseArgs,
      plan,
      log: [entry],
      plannedExtras: [],
    });
    for (const [date, meals] of Object.entries(oneStep.plan.days)) {
      if (date < TODAY) continue;
      assert.deepEqual(ate.plan.days[date], meals, profileId + ': ate-it ' + date);
    }
  });
}

// --- 5) Screens are wired to the same helpers ------------------------------

test('D26 day screen: the planned row shows its time and food with Ate it and Remove', () => {
  assert.match(planSrc, /state\.plannedExtras/);
  assert.match(planSrc, /plannedExtrasForDate/);
  assert.match(planSrc, /plannedExtraLabel/);
  assert.match(planSrc, /data-planned-ate/);
  assert.match(planSrc, /data-planned-remove/);
  assert.match(planSrc, />Ate it<\/button>/);
  assert.match(planSrc, />Remove<\/button>/);
  assert.match(planSrc, /ctx\.atePlannedExtra/);
  assert.match(planSrc, /ctx\.removePlannedExtra/);

  assert.match(appSrc, /savePlannedExtra/);
  assert.match(appSrc, /atePlannedExtra/);
  assert.match(appSrc, /removePlannedExtra/);
  assert.match(appSrc, /plannedExtras/);
  // The replan and the pure plan module are reused, never a second planner.
  assert.match(appSrc, /recomputeShownPlan|recomputePlanAfterSave/);
});
