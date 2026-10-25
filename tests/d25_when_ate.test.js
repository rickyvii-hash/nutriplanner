/**
 * D25 (P1): when the person adds food outside the menu they can say WHEN they
 * ate it: just now, or a past date and time. The saved entry carries that date
 * and time, so the day screen, the progress bars and the doctor summary use the
 * entry's date and not the moment the Save button was tapped. The plan effect
 * is a pure function of the base plan and the log: an extra dated in the past
 * counts on that day, the days already over stay frozen, and the make-up window
 * starts from today.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import { buildPlan, effectChange } from '../src/engine/planner.js';
import { recomputePlanAfterSave } from '../src/engine/plan_from_log.js';
import { buildSummary } from '../src/engine/summary.js';
import {
  newLogDraft,
  draftSavePayload,
  logEntriesForSave,
  validateEatenWhen,
  whenForSave,
  eatenWhenBounds,
  logEntriesForDate,
  pastExtraStatus,
  EATEN_WHEN_ERROR,
} from '../src/ui/log.js';
import { dayProgressTotals } from '../src/ui/plan.js';
import {
  applyLogCorrection,
  removeLogEntry,
  updateLogEntryItems,
} from '../src/log_corrections.js';
import { buildExportPayload, applyImportPayload } from '../src/engine/export_import.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const logSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'log.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const planSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'plan.js'), 'utf8');
const stylesSrc = fs.readFileSync(path.join(root, 'styles', 'app.css'), 'utf8');

const MONTH = { year: 2026, month: 10 };
const TODAY = '2026-10-24';
const NOW_TIME = '18:52';
const PAST = '2026-10-22';
const pizza = foods.find((f) => /pizza/i.test(f.name));
const banana = foods.find((f) => /^Banana, raw$/i.test(f.name));

// --- 1) Validation helper --------------------------------------------------

test('D25 validation: a date after today is refused with plain words', () => {
  const check = validateEatenWhen({
    date: '2026-10-25', time: '09:00', today: TODAY, nowTime: NOW_TIME,
    firstDate: '2026-10-01', lastDate: '2026-10-31',
  });
  assert.equal(check.ok, false);
  assert.equal(check.message, EATEN_WHEN_ERROR);
  assert.match(check.message, /has already passed/);
});

test('D25 validation: a time later than now on today is refused', () => {
  const check = validateEatenWhen({
    date: TODAY, time: '19:00', today: TODAY, nowTime: NOW_TIME,
    firstDate: '2026-10-01', lastDate: '2026-10-31',
  });
  assert.equal(check.ok, false);
  assert.equal(check.message, EATEN_WHEN_ERROR);
});

test('D25 validation: a date before the plan month or after it is refused', () => {
  for (const date of ['2026-09-30', '2026-11-01']) {
    const check = validateEatenWhen({
      date, time: '12:00', today: TODAY, nowTime: NOW_TIME,
      firstDate: '2026-10-01', lastDate: '2026-10-31',
    });
    assert.equal(check.ok, false, date);
    assert.equal(check.message, EATEN_WHEN_ERROR);
  }
});

test('D25 validation: a past date, an earlier time today and the exact now are accepted', () => {
  for (const [date, time] of [[PAST, '13:05'], [TODAY, '08:00'], [TODAY, NOW_TIME]]) {
    const check = validateEatenWhen({
      date, time, today: TODAY, nowTime: NOW_TIME,
      firstDate: '2026-10-01', lastDate: '2026-10-31',
    });
    assert.equal(check.ok, true, `${date} ${time}`);
    assert.equal(check.message, null);
  }
  // A missing date or time is never accepted.
  assert.equal(validateEatenWhen({ date: '', time: '', today: TODAY, nowTime: NOW_TIME }).ok, false);
});

test('D25: the plan month bounds and the default "just now" save time', () => {
  const plan = buildPlan(profileById('cholesterol').targets, recipes, MONTH, foodsById);
  const bounds = eatenWhenBounds(plan);
  assert.equal(bounds.firstDate, '2026-10-01');
  assert.equal(bounds.lastDate, '2026-10-31');

  const now = new Date(2026, 9, 24, 18, 52, 0);
  assert.deepEqual(whenForSave({ earlier: false, now }), { date: TODAY, time: NOW_TIME });
  assert.deepEqual(whenForSave({ earlier: true, date: PAST, time: '13:05', now }), { date: PAST, time: '13:05' });
});

// --- 2) The saved entry carries the chosen date and time -------------------

test('D25: an extra saved through logEntriesForSave stores the chosen date and time', () => {
  assert.ok(pizza && banana, 'the data needs the test foods');
  const draft = newLogDraft();
  draft.items.push({ foodId: pizza.id, grams: 250 });
  const when = { date: PAST, time: '13:05' };
  const entries = logEntriesForSave(draftSavePayload(draft), when);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, PAST);
  assert.equal(entries[0].time, '13:05');
  assert.equal(entries[0].extra, true);
  assert.deepEqual(entries[0].items, [{ foodId: pizza.id, grams: 250 }]);
});

test('D25: the day screen lists that date with the time and sorts by date and time', () => {
  const log = [
    { date: PAST, time: '20:10', extra: true, items: [{ foodId: pizza.id, grams: 100 }] },
    { date: PAST, time: '09:05', extra: true, items: [{ foodId: banana.id, grams: 100 }] },
    { date: TODAY, time: '12:00', extra: true, items: [{ foodId: banana.id, grams: 100 }] },
  ];
  const rows = logEntriesForDate(log, PAST);
  assert.deepEqual(rows.map((row) => row.entry.time), ['09:05', '20:10']);
  assert.equal(rows[0].entry.items[0].foodId, banana.id);
  assert.match(planSrc, /<h3>Logged meals<\/h3>/);
  assert.match(planSrc, /entry\.date, entry\.time/);
});

test('D25: screens carry the past moment chips and the validation message', () => {
  assert.match(logSrc, /When did you eat it\?/);
  assert.match(logSrc, />Just now</);
  assert.match(logSrc, />Earlier</);
  assert.match(logSrc, /data-when-date/);
  assert.match(logSrc, /data-when-time/);
  assert.match(logSrc, /type="date"/);
  assert.match(logSrc, /type="time"/);
  assert.match(logSrc, /validateEatenWhen/);
  assert.match(logSrc, /data-when-error/);
  // D26 adds the third chip for a meal that will be eaten later; it is not eaten food.
  assert.match(logSrc, />Planned<\/button>/);
  assert.match(logSrc, /data-when-planned/);
  assert.match(stylesSrc, /\.when-chips/);
});

// --- 3) Plan effect --------------------------------------------------------

function extra(date, time, foodId = pizza.id, grams = 350) {
  return { date, time, extra: true, items: [{ foodId, grams }] };
}

/**
 * A whole log saved in one step, replayed against the base plan. This is the
 * reference: the plan is a pure function of the base plan and the log.
 */
function shownFromBase(basePlan, log, targets, today = TODAY) {
  return recomputePlanAfterSave({
    planBase: basePlan,
    plan: basePlan,
    log,
    today,
    targets,
    recipes,
    foodsById,
    bought: [],
  });
}

for (const profileId of ['cholesterol', 'weight-loss']) {
  test(`D25 plan (${profileId}): a past extra equals the same entry logged in one step`, () => {
    const targets = profileById(profileId).targets;
    const basePlan = buildPlan(targets, recipes, MONTH, foodsById);
    const nowEntry = extra(TODAY, '10:00', banana.id, 150);
    const pastEntry = extra(PAST, '13:05');

    // Saved now, so the current plan already carries the effect of today's extra.
    const afterToday = shownFromBase(basePlan, [nowEntry], targets);
    // Then the person adds the same food again but says they ate it earlier.
    const afterPast = recomputePlanAfterSave({
      planBase: basePlan,
      plan: afterToday.plan,
      log: [nowEntry, pastEntry],
      today: TODAY,
      targets,
      recipes,
      foodsById,
      bought: [],
      fromDate: PAST,
    });
    // The one-step reference: both entries were in the log from the start, in
    // the other order, replayed directly against the base plan.
    const oneStep = shownFromBase(basePlan, [pastEntry, nowEntry], targets);

    // From today on the shown plan is the same whatever order or moment the
    // entries were typed in.
    for (const [date, meals] of Object.entries(oneStep.plan.days)) {
      if (date < TODAY) continue;
      assert.deepEqual(afterPast.plan.days[date], meals, `${profileId} ${date}`);
    }
    // Days already over stay frozen exactly as they were.
    for (const [date, meals] of Object.entries(basePlan.days)) {
      if (date >= TODAY) continue;
      assert.deepEqual(afterPast.plan.days[date], meals, `${profileId} frozen ${date}`);
    }
    // The make-up window starts from today and stays inside the next four days.
    const proposal = afterPast.proposal;
    if (proposal) {
      for (const change of proposal.changed) assert.ok(change.date >= TODAY);
    }
  });
}

test('D25 plan: the past extra changes nothing before today and the reason quotes the effect', () => {
  const targets = profileById('cholesterol').targets;
  const basePlan = buildPlan(targets, recipes, MONTH, foodsById);
  const pastEntry = extra(PAST, '13:05');
  const saved = recomputePlanAfterSave({
    planBase: basePlan,
    plan: basePlan,
    log: [pastEntry],
    today: TODAY,
    targets,
    recipes,
    foodsById,
    bought: [],
    fromDate: PAST,
  });

  for (const date of Object.keys(basePlan.days)) {
    if (date >= TODAY) continue;
    assert.deepEqual(saved.plan.days[date], basePlan.days[date], `frozen ${date}`);
  }

  const result = saved.result;
  assert.ok(result.reason.length > 0, 'the replan explains itself');
  for (const effect of result.effects) {
    const change = effectChange(effect.nutrient, effect);
    const decimals = effect.nutrient === 'kcal' || effect.nutrient === 'sodium' ? 0 : 1;
    assert.equal(change, Number(effect.after.toFixed(decimals)) - Number(effect.before.toFixed(decimals)));
  }
  // Any per-day number the reason quotes is one of the numbers the Effect rows show.
  const quoted = result.reason.match(/about ([\d.]+) (g|kcal|mg) more per day on average/);
  if (quoted) {
    const unit = quoted[2];
    const matches = result.effects.some((effect) => {
      const change = Math.abs(effectChange(effect.nutrient, effect));
      const effectUnit = effect.nutrient === 'kcal' ? 'kcal' : effect.nutrient === 'sodium' ? 'mg' : 'g';
      const decimals = effect.nutrient === 'kcal' || effect.nutrient === 'sodium' ? 0 : 1;
      return effectUnit === unit && Number(quoted[1]) === Number(change.toFixed(decimals));
    });
    assert.ok(matches, `reason quotes ${quoted[1]} ${unit} but no Effect row agrees: ${result.reason}`);
  }
});

// --- 4) Progress and summary use the entry's date --------------------------

test('D25: the progress bars count the past day and not today', () => {
  const targets = profileById('cholesterol').targets;
  const basePlan = buildPlan(targets, recipes, MONTH, foodsById);
  const log = [extra(PAST, '13:05')];
  const pastDay = log.filter((entry) => entry.date === PAST);
  const todayDay = log.filter((entry) => entry.date === TODAY);
  const past = dayProgressTotals(basePlan.days[PAST], pastDay, recipesById, foodsById);
  const today = dayProgressTotals(basePlan.days[TODAY], todayDay, recipesById, foodsById);
  assert.ok(past.result.totals.kcal > 0, 'the past date counts the extra');
  assert.equal(today.result.totals.kcal, 0, 'today must not count an entry dated in the past');
});

test('D25: the doctor summary uses the entry date, not the save moment', () => {
  const targets = profileById('cholesterol').targets;
  const basePlan = buildPlan(targets, recipes, MONTH, foodsById);
  const summary = buildSummary({
    targets,
    plan: basePlan,
    log: [extra(PAST, '13:05')],
    recipesById,
    foodsById,
  });
  assert.equal(summary.loggedDays, 1);
  assert.deepEqual(summary.period, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(summary.meals.length, 1);
  assert.equal(summary.meals[0].date, PAST);
  assert.equal(summary.meals[0].time, '13:05');
  assert.ok(summary.averages.kcal > 0);
});

// --- 5) Corrections, export and restore ------------------------------------

function baseState(log) {
  const targets = profileById('cholesterol').targets;
  return {
    profileId: 'cholesterol',
    targets,
    plan: buildPlan(targets, recipes, MONTH, foodsById),
    log,
    bought: [],
    keptForBought: [],
    pendingProposal: null,
  };
}

test('D25: edit and remove keep the same correction path and the entry date/time', () => {
  const entry = extra(PAST, '13:05');
  const state = baseState([entry]);
  const edited = updateLogEntryItems(state, 0, [{ foodId: banana.id, grams: 120 }]);
  assert.equal(edited.log[0].date, PAST);
  assert.equal(edited.log[0].time, '13:05');

  const removed = removeLogEntry(edited, 0);
  assert.equal(removed.log.length, 0);

  // The same correction path replans from the entry's own date.
  const ctx = {
    state: baseState([entry]),
    recipes,
    recipesById,
    foodsById,
    navigate(name) { this.screen = name; },
  };
  const corrected = applyLogCorrection(ctx, removeLogEntry(ctx.state, 0), { fromDate: PAST });
  assert.equal(corrected.planChanged, false);
  assert.equal(corrected.state.log.length, 0);
});

test('D25: export and restore keep the date and the time of an earlier entry', () => {
  const state = baseState([extra(PAST, '13:05')]);
  const payload = buildExportPayload(state);
  assert.equal(payload.log[0].date, PAST);
  assert.equal(payload.log[0].time, '13:05');
  const restored = applyImportPayload(baseState([]), payload);
  assert.equal(restored.log[0].date, PAST);
  assert.equal(restored.log[0].time, '13:05');
});

// --- 6) Where the save goes -------------------------------------------------

test('D25: a past save opens the day screen on that date and stays inline when nothing changes', () => {
  assert.match(appSrc, /when\.date < today/);
  assert.match(appSrc, /ctx\.selectedDate = when\.date/);
  assert.match(appSrc, /Added for \$\{when\.date\}\. Plan unchanged\./);
  assert.equal(pastExtraStatus(PAST), 'Added for 2026-10-22. Plan unchanged.');
  // The existing merge and the single plan function are reused, never a second planner.
  assert.match(appSrc, /recomputePlanAfterSave/);
  assert.match(appSrc, /mergeLogEntries/);
});
