// The computation behind "Save and update plan" on Outside the menu, written
// once so the real save and the dry-run card ("If you save this") can never
// drift apart. It is pure: it reads a saved state and a payload and returns the
// merged log and the plan result. It stores nothing, navigates nowhere and
// changes neither the state nor the payload.

import { replan, todayIso } from './planner.js';
import { recomputePlanAfterSave } from './plan_from_log.js';
import { logEntriesForSave, mergeLogEntries } from '../ui/log.js';
import { proposalToStore } from '../store.js';

/**
 * The entries, merged log and plan result a save of `payload` would produce.
 * Returns null when there is nothing to save or no plan to recompute.
 *
 * `when` is the chosen moment ({ date, time }); `today` keeps the "already
 * over" boundary explicit, so the dry run uses the same day as the save.
 */
export function computeExtraSave({
  state = null,
  recipes = [],
  recipesById = new Map(),
  foodsById = new Map(),
  payload = null,
  when = null,
  today = todayIso(),
} = {}) {
  if (!state?.plan) return null;
  const items = Array.isArray(payload) ? payload : (payload?.items || []);
  const skipped = Array.isArray(payload) ? [] : (payload?.skipped || []);
  if (!items.length && !skipped.length) return null;
  const moment = {
    date: when?.date || today,
    time: when?.time || '',
  };
  const entries = logEntriesForSave(
    Array.isArray(payload) ? { items } : payload,
    moment,
  );
  if (entries.length === 0) return null;
  const log = mergeLogEntries(state.log, entries, {
    date: moment.date,
    planDay: state.plan.days?.[moment.date],
    recipesById,
  });

  if (moment.date < today) {
    // An entry dated before today counts on that day exactly as if it had
    // been in the log all along: the plan is recomputed from the base plan and
    // the whole log, with the days already over frozen.
    const recomputed = recomputePlanAfterSave({
      planBase: state.planBase || state.plan,
      plan: state.plan,
      log,
      decisions: state.updateDecisions || [],
      today,
      targets: state.targets,
      recipes,
      foodsById,
      bought: state.bought || [],
      mealPrefs: state.mealPrefs,
      plannedExtras: state.plannedExtras || [],
      fromDate: moment.date,
    });
    return {
      entries,
      log,
      past: true,
      result: recomputed.result,
      proposal: recomputed.proposal,
      decisions: recomputed.decisions,
    };
  }

  // A second log on the same day replans from the month plan as it was before
  // any accepted update; the first log of a later day starts from the current
  // plan, so an accepted make-up for past days is kept.
  const hadPriorToday = (state.log || []).some((entry) => entry?.date === moment.date);
  const basePlan = hadPriorToday
    ? (state.planBase || state.plan)
    : state.plan;
  const result = replan({
    targets: state.targets,
    recipes,
    plan: basePlan,
    log,
    bought: state.bought || [],
    foodsById,
    fromDate: moment.date,
    mealPrefs: state.mealPrefs,
    plannedExtras: state.plannedExtras || [],
  });
  // Days that are already over keep the meals of the plan in force right now.
  const keptPastDays = {};
  for (const [date, meals] of Object.entries(state.plan?.days || {})) {
    if (date < moment.date) keptPastDays[date] = { ...meals };
  }
  result.plan = {
    ...result.plan,
    days: { ...result.plan.days, ...keptPastDays },
  };
  return {
    entries,
    log,
    past: false,
    result,
    proposal: result,
    decisions: null,
  };
}

/**
 * The saved state a real save would write: the merged log, the replay
 * decisions for a past entry, and the proposal the Plan updated screen reads.
 * Pure: the state passed in is not changed.
 */
export function extraSaveNextState(state, computed) {
  if (!computed) return state;
  return {
    ...state,
    log: computed.log,
    ...(computed.past ? { updateDecisions: computed.decisions } : {}),
    pendingProposal: proposalToStore(computed.result),
  };
}
