// Device-local persistence. No accounts, no cloud.

import { defaultMealPrefs, normalizeMealPrefs } from './engine/meal_prefs.js';

const KEY = 'nutriplanner-v1';

/** A fresh, empty device state (the shape every screen expects). */
export function emptyAppState() {
  return {
    profileId: null,
    // The first-run guide closes for good once dismissed; "How it works" still opens it.
    guideDismissed: false,
    targets: [],
    // Which daily meals are on (breakfast, lunch, dinner and 0–2 snacks).
    mealPrefs: defaultMealPrefs(),
    plan: null,
    // The month plan as it was before an accepted update: a correction replans
    // from here, so a make-up for a meal that is later removed cannot survive.
    planBase: null,
    log: [],
    bought: [],
    keptForBought: [],
    shopEvery: 7,
    shopStart: null,
    pendingProposal: null,
    // Notes from blood tests the person chooses to record. Kept in a backup
    // even before the lab notes screen exists.
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
  'Shopping ticks (items you marked bought)',
  'A pending plan update proposal',
  'Notes about meals kept because you bought the ingredients',
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
  };
  if (keepLog) {
    return {
      ...next,
      log: Array.isArray(current.log) ? [...current.log] : [],
      bought: Array.isArray(current.bought) ? [...current.bought] : [],
    };
  }
  return { ...next, log: [], bought: [] };
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
 * Apply an accepted update proposal. The plan before the update is remembered in
 * `planBase` (the first time only), so a later log correction can replan from the
 * plan that existed before any make-up was accepted instead of from the already
 * compensated days.
 */
export function acceptUpdatedPlan(state, proposal) {
  if (!state || !proposal) return state;
  return withoutPendingProposal({
    ...state,
    plan: proposal.plan,
    keptForBought: proposal.keptForBought || [],
    planBase: state.planBase || state.plan || null,
  });
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
    }),
    banner,
    screenHint: 'targets',
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
    if (!raw) return { ...EMPTY, mealPrefs: defaultMealPrefs(), bought: [], log: [], targets: [], keptForBought: [] };
    const data = JSON.parse(raw);
    return {
      profileId: data.profileId ?? null,
      guideDismissed: data.guideDismissed === true,
      targets: Array.isArray(data.targets) ? data.targets : [],
      mealPrefs: normalizeMealPrefs(data.mealPrefs),
      plan: data.plan ?? null,
      planBase: data.planBase && typeof data.planBase === 'object' ? data.planBase : null,
      log: Array.isArray(data.log) ? data.log : [],
      bought: Array.isArray(data.bought) ? data.bought : [],
      keptForBought: Array.isArray(data.keptForBought) ? data.keptForBought : [],
      shopEvery: [2, 3, 5, 7].includes(data.shopEvery) ? data.shopEvery : 7,
      shopStart: typeof data.shopStart === 'string' ? data.shopStart : null,
      pendingProposal: data.pendingProposal && typeof data.pendingProposal === 'object'
        ? data.pendingProposal
        : null,
      labNotes: Array.isArray(data.labNotes) ? data.labNotes : [],
    };
  } catch {
    storageNotice = 'Saved data could not be read; starting fresh for this session.';
    return { ...EMPTY, mealPrefs: defaultMealPrefs(), bought: [], log: [], targets: [], keptForBought: [] };
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
        bought: state.bought,
        keptForBought: state.keptForBought || [],
        shopEvery: state.shopEvery || 7,
        shopStart: state.shopStart || null,
        pendingProposal: state.pendingProposal || null,
        labNotes: Array.isArray(state.labNotes) ? state.labNotes : [],
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
