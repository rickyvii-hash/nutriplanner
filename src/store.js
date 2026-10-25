// Device-local persistence. No accounts, no cloud.

import {
  defaultMealPrefs, normalizeMealPrefs, activeSlots, MAX_SNACKS,
} from './engine/meal_prefs.js';
import { normalizeCustomFoods } from './engine/custom_foods.js';
import { normalizePlannedExtras } from './engine/planned_extras.js';

const KEY = 'nutriplanner-v1';

/** A fresh, empty device state (the shape every screen expects). */
export function emptyAppState() {
  return {
    profileId: null,
    // The first-run guide closes for good once dismissed; "How it works" still opens it.
    guideDismissed: false,
    targets: [],
    // Which daily meals are on (breakfast, lunch, dinner and 0–1 snack).
    mealPrefs: defaultMealPrefs(),
    plan: null,
    // The month plan as it was before an accepted update: a correction replans
    // from here, so a make-up for a meal that is later removed cannot survive.
    planBase: null,
    log: [],
    // Meals the person already knows they will eat outside the menu: expected
    // intake for their own date, never eaten food and never a log entry.
    plannedExtras: [],
    // Foods the person added themselves ("Add my own food"), saved on this device.
    customFoods: [],
    bought: [],
    // Ingredients that were not in the shop, so they are never counted as bought.
    notFound: [],
    keptForBought: [],
    // One entry per trigger day whose Plan updated was accepted or rejected:
    // { triggerDate, accepted }. The shown plan is recomputed from these.
    updateDecisions: [],
    shopEvery: 7,
    shopStart: null,
    pendingProposal: null,
    // Reserved as an empty list in the backup schema for forward compatibility;
    // no screen records these in this version.
    labNotes: [],
  };
}

const EMPTY = emptyAppState();

/**
 * State after "Start over": everything this device saved is erased and the profile
 * choice resets to none, so the app opens on the choose-profile start screen.
 */
export function startOverState() {
  return emptyAppState();
}

/** The things a Start over erases, written for the confirmation panel. */
export const START_OVER_ITEMS = [
  'Your month plan',
  'Your meal logs',
  'Meals you planned outside the menu',
  'Foods you added yourself',
  'Shopping ticks (items you marked bought)',
  'Shopping items marked not found',
  'A pending plan update proposal',
  'Notes about meals kept because you bought the ingredients',
  'Lab notes you recorded',
];

/** Title, list and footnote shown before a Start over is confirmed. */
export function startOverConfirmCopy() {
  return {
    title: 'Start over?',
    intro: 'This erases everything this device saved:',
    items: [...START_OVER_ITEMS],
    note: 'Your profile choice resets to none. This cannot be undone.',
    confirmLabel: 'Yes, start over',
    cancelLabel: 'Cancel',
  };
}

/** Copy for "Change profile": the log is kept unless the person asks to clear it. */
export function changeProfileCopy() {
  return {
    title: 'Change profile?',
    intro: 'Pick a new profile next. This clears your current month plan and loads the new profile\'s targets.',
    clearLabel: 'Also clear my meal log and shopping list',
    keepNote: 'Leave this unchecked to keep your meal logs and shopping ticks.',
    confirmLabel: 'Change profile',
    cancelLabel: 'Cancel',
  };
}

/**
 * State after confirming a profile change: the plan is cleared and the profile choice
 * resets to none. `keepLog` defaults to true, so the meal log and shopping ticks stay
 * unless the person explicitly clears them.
 */
export function changeProfileState(state, { keepLog = true } = {}) {
  const current = state || emptyAppState();
  const next = {
    ...current,
    profileId: null,
    targets: [],
    plan: null,
    planBase: null,
    pendingProposal: null,
    keptForBought: [],
    updateDecisions: [],
    // Planned meals belong to the plan that is being cleared.
    plannedExtras: [],
  };
  if (keepLog) {
    return {
      ...next,
      log: Array.isArray(current.log) ? [...current.log] : [],
      bought: Array.isArray(current.bought) ? [...current.bought] : [],
      notFound: Array.isArray(current.notFound) ? [...current.notFound] : [],
    };
  }
  return { ...next, log: [], bought: [], notFound: [] };
}

/**
 * Which start screen a stored state opens: the choose-profile start screen when no
 * profile is chosen, the plan when one exists, otherwise the Targets screen.
 */
export function startScreenFor(state) {
  if (!state || !state.profileId) return 'choose-profile';
  if (state.plan) return 'plan';
  return 'targets';
}

let storageNotice = null;

export function getStorageNotice() {
  return storageNotice;
}

/** Fields of a replan result that the Plan updated screen needs after a reload. */
export function proposalToStore(proposal) {
  if (!proposal) return null;
  return {
    plan: proposal.plan,
    changed: proposal.changed || [],
    effects: proposal.effects || [],
    reason: proposal.reason || '',
    unreachable: Boolean(proposal.unreachable),
    nothingToChange: Boolean(proposal.nothingToChange),
    keptForBought: proposal.keptForBought || [],
    skipNoMin: Boolean(proposal.skipNoMin),
  };
}

/**
 * A stored proposal belongs to the current plan when its month matches.
 * Returns the proposal, or null when it is missing or for another month.
 */
export function pendingProposalForPlan(state) {
  const pending = state?.pendingProposal;
  if (!pending || !state?.plan) return null;
  const pendingMonth = pending.plan?.month;
  if (pendingMonth && pendingMonth !== state.plan.month) return null;
  return pending;
}

/** Drop a stored proposal (after Use / Keep, or when the plan month is no longer current). */
export function withoutPendingProposal(state) {
  if (!state) return state;
  if (state.pendingProposal == null) return state;
  return { ...state, pendingProposal: null };
}

/**
 * State after the daily targets were edited (a value changed, a target added or
 * removed). A pending proposal was worked out against the old targets, so it is
 * dropped: "Use updated" can never apply numbers that no longer match the targets.
 */
export function withTargetsEdited(state, targets) {
  if (!state) return state;
  return {
    ...state,
    targets: Array.isArray(targets) ? targets : [],
    pendingProposal: null,
  };
}

/** A copy of a month plan without the legacy second snack, or the plan itself when it has none. */
function withoutSecondSnackDays(plan) {
  if (!plan || !plan.days || typeof plan.days !== 'object') return plan;
  let changed = false;
  const days = {};
  for (const [date, day] of Object.entries(plan.days)) {
    if (day && Object.prototype.hasOwnProperty.call(day, 'snack2')) {
      const { snack2, ...rest } = day;
      days[date] = rest;
      changed = true;
    } else {
      days[date] = day;
    }
  }
  return changed ? { ...plan, days } : plan;
}

/**
 * Saved data from an older version could hold a second snack. This version plans one
 * snack at most, so `snack2` is removed from the plan, the plan kept for corrections
 * and a pending proposal on load: the day values and the shopping list then match the
 * meals the screens show.
 */
export function withoutSecondSnack(state) {
  if (!state) return state;
  const prefs = normalizeMealPrefs(state.mealPrefs);
  if (activeSlots(prefs).includes('snack2')) return state;
  // A saved snack count above the current maximum is the legacy two-snack
  // version. The plan is trimmed AND any proposal worked out for those days is
  // dropped entirely, so an update from before the cut can never be applied.
  const legacySnacks = Number(state.mealPrefs?.snacks) > MAX_SNACKS;
  const plan = withoutSecondSnackDays(state.plan);
  const planBase = withoutSecondSnackDays(state.planBase);
  const pending = legacySnacks ? null : state.pendingProposal;
  const pendingPlan = pending?.plan ? withoutSecondSnackDays(pending.plan) : null;
  const pendingProposal = pendingPlan && pendingPlan !== pending.plan
    ? { ...pending, plan: pendingPlan }
    : pending;
  if (plan === state.plan && planBase === state.planBase && pendingProposal === state.pendingProposal) {
    return state;
  }
  return { ...state, plan, planBase, pendingProposal };
}

/**
 * Record what the person decided about the update for one log day. A later
 * decision for the same day replaces the earlier one. The recompute drops a
 * decision whose log entry is gone, so it never outlives its meal.
 */
export function recordUpdateDecision(state, triggerDate, accepted) {
  if (!state) return state;
  if (typeof triggerDate !== 'string' || !triggerDate) return state;
  const kept = (Array.isArray(state.updateDecisions) ? state.updateDecisions : [])
    .filter((decision) => decision?.triggerDate !== triggerDate);
  return {
    ...state,
    updateDecisions: [...kept, { triggerDate, accepted: accepted === true }],
  };
}

/**
 * The trigger day a proposal belongs to: the day whose log drove the update.
 * `replan` returns it as `triggerDate`; a proposal without one records nothing.
 */
function proposalTriggerDate(proposal) {
  if (typeof proposal?.triggerDate === 'string') return proposal.triggerDate;
  return null;
}

/**
 * Apply an accepted update proposal. The plan before the update is remembered in
 * `planBase` (the first time only), so a later log correction can replan from the
 * plan that existed before any make-up was accepted instead of from the already
 * compensated days. The decision for the trigger day is saved with the plan.
 */
export function acceptUpdatedPlan(state, proposal) {
  if (!state || !proposal) return state;
  const withDecision = recordUpdateDecision(state, proposalTriggerDate(proposal), true);
  return withoutPendingProposal({
    ...withDecision,
    plan: proposal.plan,
    keptForBought: proposal.keptForBought || [],
    planBase: state.planBase || state.plan || null,
  });
}

/**
 * Keep the original plan after an update proposal. The decision is remembered
 * (accepted: false) so a later correction never re-applies the refused update.
 */
export function rejectUpdatedPlan(state, proposal) {
  if (!state) return state;
  const withDecision = proposal ? recordUpdateDecision(state, proposalTriggerDate(proposal), false) : state;
  return withoutPendingProposal(withDecision);
}

/** Calendar month as YYYY-MM in local time. */
export function currentMonthKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** "2026-10" → "October 2026" (English month name). */
export function formatMonthYear(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return String(monthKey || '');
  const [y, m] = monthKey.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });
  return `${name} ${y}`;
}

/**
 * Calm banner when a saved plan is for another month, or null when the plan is current / missing.
 */
export function stalePlanBanner(planMonth, now = new Date()) {
  if (!planMonth) return null;
  const current = currentMonthKey(now);
  if (planMonth === current) return null;
  return `Your saved plan is for ${formatMonthYear(planMonth)}. Build the plan for ${formatMonthYear(current)}.`;
}

/**
 * On start: if the saved plan is for another month, clear it (keep targets, log and shopping
 * settings), drop any pending proposal, and return a Targets banner.
 */
export function applyStaleMonthOnStart(state, now = new Date()) {
  const planMonth = state?.plan?.month || null;
  const banner = stalePlanBanner(planMonth, now);
  if (!banner) {
    return { state, banner: null, screenHint: state?.plan ? 'plan' : 'targets' };
  }
  return {
    state: withoutPendingProposal({
      ...state,
      plan: null,
      planBase: null,
      keptForBought: [],
      // The plan those updates belonged to is gone with the old month.
      updateDecisions: [],
      plannedExtras: [],
    }),
    banner,
    screenHint: 'targets',
  };
}

/**
 * The state and start screen after a confirmed restore. A restored plan for another
 * calendar month follows the same path as a reload: it is cleared with the Targets
 * banner, so the old month's first day is never treated as Today.
 */
export function restoredStateAndScreen(imported, now = new Date()) {
  const stale = applyStaleMonthOnStart(imported, now);
  return {
    state: stale.state,
    banner: stale.banner,
    screen: stale.banner ? 'targets' : startScreenFor(stale.state),
  };
}

export function loadState() {
  storageNotice = null;
  try {
    if (typeof localStorage === 'undefined') {
      storageNotice = 'This browser cannot keep data between visits.';
      return { ...EMPTY };
    }
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY, mealPrefs: defaultMealPrefs(), bought: [], log: [], targets: [], keptForBought: [], customFoods: [] };
    const data = JSON.parse(raw);
    const loaded = {
      profileId: data.profileId ?? null,
      guideDismissed: data.guideDismissed === true,
      targets: Array.isArray(data.targets) ? data.targets : [],
      // Kept raw until after the snack migration check, so an older saved
      // snacks: 2 can still be recognised and its proposal dropped.
      mealPrefs: data.mealPrefs ?? {},
      plan: data.plan ?? null,
      planBase: data.planBase && typeof data.planBase === 'object' ? data.planBase : null,
      log: Array.isArray(data.log) ? data.log : [],
      // Older saved data has no planned meals: the list starts empty.
      plannedExtras: normalizePlannedExtras(data.plannedExtras),
      // Older saved data has no foods the person added: the list starts empty.
      customFoods: normalizeCustomFoods(data.customFoods),
      bought: Array.isArray(data.bought) ? data.bought : [],
      // Older saved data has no not-found list: it starts empty.
      notFound: Array.isArray(data.notFound)
        ? data.notFound.filter((id) => typeof id === 'string')
        : [],
      keptForBought: Array.isArray(data.keptForBought) ? data.keptForBought : [],
      updateDecisions: (Array.isArray(data.updateDecisions) ? data.updateDecisions : [])
        .filter((decision) => decision && typeof decision.triggerDate === 'string')
        .map((decision) => ({ triggerDate: decision.triggerDate, accepted: decision.accepted === true })),
      shopEvery: [2, 3, 5, 7].includes(data.shopEvery) ? data.shopEvery : 7,
      shopStart: typeof data.shopStart === 'string' ? data.shopStart : null,
      pendingProposal: data.pendingProposal && typeof data.pendingProposal === 'object'
        ? data.pendingProposal
        : null,
      // The field stays in the schema but is always empty: no screen records these.
      labNotes: [],
    };
    // An older saved plan may still hold a second snack; the screens offer one.
    return {
      ...withoutSecondSnack(loaded),
      mealPrefs: normalizeMealPrefs(data.mealPrefs),
    };
  } catch {
    storageNotice = 'Saved data could not be read; starting fresh for this session.';
    return { ...EMPTY, mealPrefs: defaultMealPrefs(), bought: [], log: [], targets: [], keptForBought: [], customFoods: [] };
  }
}

export function saveState(state) {
  storageNotice = null;
  try {
    if (typeof localStorage === 'undefined') {
      storageNotice = 'This browser cannot keep data between visits.';
      return false;
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({
        profileId: state.profileId,
        guideDismissed: Boolean(state.guideDismissed),
        targets: state.targets,
        mealPrefs: normalizeMealPrefs(state.mealPrefs),
        plan: state.plan,
        planBase: state.planBase || null,
        log: state.log,
        plannedExtras: normalizePlannedExtras(state.plannedExtras),
        customFoods: normalizeCustomFoods(state.customFoods),
        bought: state.bought,
        notFound: Array.isArray(state.notFound) ? state.notFound : [],
        keptForBought: state.keptForBought || [],
        updateDecisions: Array.isArray(state.updateDecisions) ? state.updateDecisions : [],
        shopEvery: state.shopEvery || 7,
        shopStart: state.shopStart || null,
        pendingProposal: state.pendingProposal || null,
        // Always empty: kept in the schema for forward compatibility only.
        labNotes: [],
      }),
    );
    return true;
  } catch {
    storageNotice = 'Data will not be kept after you close this page.';
    return false;
  }
}

export function clearState() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
