// The plan the screens show is a pure function of what is already saved:
//   base month plan + logged entries with dates + accept/reject decisions.
// A correction never reverses the edits of an earlier accepted update. It drops
// the decisions whose log entry is gone and replays the accepted ones from the
// base plan in date order, so an expired make-up window cannot be re-applied.

import { replan, todayIso } from './planner.js';
import { normalizePlannedExtras } from './planned_extras.js';

/** Shown when a correction invalidated one or more earlier decisions. */
export const STALE_DECISIONS_NOTICE = 'Some earlier updates were recomputed after your change';

/**
 * Keep only the decisions whose trigger day still has a log entry (and belongs
 * to this plan month). The last decision for a day wins. Sorted by trigger date.
 */
export function normalizeUpdateDecisions(decisions, log, plan, plannedExtras = []) {
  const loggedDates = new Set(
    (Array.isArray(log) ? log : []).map((entry) => entry?.date).filter(Boolean),
  );
  // A planned meal is a trigger like a log entry: its accepted update stays valid
  // while that planned meal is still on its date.
  const plannedDates = new Set(normalizePlannedExtras(plannedExtras).map((extra) => extra.date));
  const byDate = new Map();
  let dropped = false;
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    const triggerDate = decision?.triggerDate;
    if (typeof triggerDate !== 'string' || !triggerDate) continue;
    const inPlan = !plan?.days || Boolean(plan.days[triggerDate]);
    if ((!loggedDates.has(triggerDate) && !plannedDates.has(triggerDate)) || !inPlan) {
      dropped = true;
      continue;
    }
    byDate.set(triggerDate, decision.accepted === true);
  }
  const kept = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([triggerDate, accepted]) => ({ triggerDate, accepted }));
  return { decisions: kept, dropped };
}

/**
 * The shown plan after a log save that carries a chosen date and time (D25).
 *
 * For a save dated today or later this is the same recompute the outside-the-menu
 * path has always used: a replan from that day, with the days already over kept
 * as they are. For a save dated before today the entry is treated exactly as if
 * it had been in the log all along: the plan is recomputed from the base plan and
 * the whole log (a pure function of the two), the days before today stay frozen
 * and the make-up window starts from today, never from the past date.
 *
 * Returns the same shape as recomputeShownPlan.
 */
export function recomputePlanAfterSave(options = {}) {
  const {
    when = null,
    fromDate = null,
    today = todayIso(),
    plan = null,
    ...rest
  } = options;
  const date = fromDate || when?.date || today;
  return recomputeShownPlan({ ...rest, plan, today, fromDate: date });
}

/** A shallow day copy, so callers can never mutate a saved plan. */
function copyDays(plan) {
  const days = {};
  for (const [date, meals] of Object.entries(plan?.days || {})) {
    days[date] = { ...meals };
  }
  return days;
}

/**
 * Recompute the shown plan from the saved base plan, the log and the decisions.
 *
 * Replay: every accepted trigger day is replanned against `planBase` with the
 * log through that day; only the days after the trigger are merged, in date
 * order. Days strictly before `today` stay frozen as they were in the plan
 * before the correction; today itself is recalculated.
 *
 * Returns { plan, decisions, notice, proposal, result }.
 * `proposal` is null when nothing from today on changes.
 */
export function recomputeShownPlan({
  planBase,
  plan,
  log = [],
  decisions = [],
  today = todayIso(),
  targets = [],
  recipes = [],
  foodsById = new Map(),
  bought = [],
  mealPrefs,
  plannedExtras = [],
  fromDate = null,
} = {}) {
  const base = planBase || plan;
  if (!base || !base.days) return { plan: base, decisions: [], notice: null, proposal: null, result: null };

  const logList = Array.isArray(log) ? log : [];
  const plannedList = normalizePlannedExtras(plannedExtras);
  const plannedDates = new Set(plannedList.map((extra) => extra.date));
  const hadDecisions = Array.isArray(decisions) && decisions.length > 0;
  const { decisions: kept, dropped } = normalizeUpdateDecisions(decisions, logList, base, plannedList);
  const days = copyDays(base);

  let source = null;
  for (const decision of kept) {
    if (!decision.accepted) continue;
    const triggerDate = decision.triggerDate;
    const logThroughTrigger = logList.filter((entry) => entry?.date && entry.date <= triggerDate);
    const result = replan({
      targets,
      recipes,
      plan: base,
      log: logThroughTrigger,
      bought,
      foodsById,
      fromDate: triggerDate,
      logFromDate: triggerDate,
      mealPrefs,
      plannedExtras: plannedList,
    });
    for (const [date, meals] of Object.entries(result.plan?.days || {})) {
      // A planned meal changes its own day, so that day is copied as well; a log
      // trigger leaves its day as planned and only the days after it may change.
      if (date > triggerDate || (date === triggerDate && plannedDates.has(date))) {
        days[date] = { ...meals };
      }
    }
    source = result;
  }

  if (!source) {
    // No accepted update is left to replay. A state saved before decisions
    // existed (or a fresh correction) still gets the single-replan behaviour;
    // when the decisions say the log was rejected, the base plan is kept.
    const earliest = logList.reduce(
      (acc, entry) => (entry?.date && (!acc || entry.date < acc) ? entry.date : acc),
      null,
    );
    const anchor = fromDate || earliest || today;
    const replanFrom = anchor > today ? anchor : today;
    const logFromDate = earliest && earliest < replanFrom ? earliest : replanFrom;
    source = replan({
      targets,
      recipes,
      plan: base,
      log: logList,
      bought,
      foodsById,
      fromDate: replanFrom,
      logFromDate,
      mealPrefs,
      plannedExtras: plannedList,
    });
    if (!hadDecisions) {
      for (const [date, meals] of Object.entries(source.plan?.days || {})) {
        days[date] = { ...meals };
      }
    }
  }

  // Only the days that are already over are frozen; today is recalculated.
  for (const [date, meals] of Object.entries(plan?.days || {})) {
    if (date < today) days[date] = { ...meals };
  }

  const shownPlan = { ...base, days };

  // The changes on screen: from today on, compared with the plan the update was
  // scored against (the base), so every "before" is the real starting meal.
  const recipesById = new Map((Array.isArray(recipes) ? recipes : []).map((recipe) => [recipe.id, recipe]));
  const changed = [];
  const allDates = new Set([...Object.keys(base.days || {}), ...Object.keys(days)]);
  for (const date of [...allDates].sort()) {
    if (date < today) continue;
    const beforeDay = base.days?.[date] || {};
    const afterDay = days[date] || {};
    const slots = new Set([...Object.keys(beforeDay), ...Object.keys(afterDay)]);
    for (const slot of slots) {
      const before = beforeDay[slot];
      const after = afterDay[slot];
      if (before === after) continue;
      changed.push({
        date,
        slot,
        before,
        after,
        beforeName: recipesById.get(before)?.name || before,
        afterName: recipesById.get(after)?.name || after,
        beforeIcon: recipesById.get(before)?.icon || '',
        afterIcon: recipesById.get(after)?.icon || '',
      });
    }
  }

  const nothingToChange = changed.length === 0;
  const result = { ...source, plan: shownPlan, changed, nothingToChange };
  const proposal = nothingToChange ? null : result;
  const notice = dropped ? STALE_DECISIONS_NOTICE : null;
  return { plan: shownPlan, decisions: kept, notice, proposal, result };
}
