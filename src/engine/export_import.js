// F4 — Download my data and Restore from file.
// The backup is a plain local JSON file: nothing leaves the device.
// Every imported file is checked first, so a foreign or damaged file never
// overwrites data that is already saved.

import { normalizeMealPrefs, activeSlots } from './meal_prefs.js';
import { withoutSecondSnack } from '../store.js';

export const EXPORT_VERSION = 1;
export const EXPORT_APP_NAME = 'NutriPlanner';
export const EXPORT_FILE_NAME = 'nutriplanner-data.json';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A list where every entry is an object (targets, log entries, kept meals, lab notes). */
function isEntryList(value) {
  return Array.isArray(value) && value.every(isPlainObject);
}

/** A month plan: null when there is none, otherwise { month, days }. */
function isPlan(value) {
  return value === null || (isPlainObject(value) && typeof value.month === 'string' && isPlainObject(value.days));
}

function reject(message) {
  return { ok: false, message };
}

/**
 * The JSON written by "Download my data". Only the fields the app saves are
 * included; transient screen state (an open proposal) is left out.
 */
export function buildExportPayload(state) {
  const s = state || {};
  return {
    version: EXPORT_VERSION,
    app: EXPORT_APP_NAME,
    exportedAt: new Date().toISOString(),
    profileId: s.profileId ?? null,
    targets: Array.isArray(s.targets) ? s.targets : [],
    mealPrefs: normalizeMealPrefs(s.mealPrefs),
    plan: s.plan ?? null,
    planBase: s.planBase ?? null,
    log: Array.isArray(s.log) ? s.log : [],
    bought: Array.isArray(s.bought) ? s.bought : [],
    keptForBought: Array.isArray(s.keptForBought) ? s.keptForBought : [],
    shopEvery: s.shopEvery ?? 7,
    shopStart: s.shopStart ?? null,
    // Accept/reject decisions per log day; the shown plan is recomputed from these.
    updateDecisions: Array.isArray(s.updateDecisions)
      ? s.updateDecisions
        .filter((d) => d && typeof d.triggerDate === 'string')
        .map((d) => ({ triggerDate: d.triggerDate, accepted: d.accepted === true }))
      : [],
    // Kept as an empty list in the schema for forward compatibility.
    labNotes: [],
  };
}

/**
 * Check a parsed JSON file before it is applied.
 * Returns { ok: true, summary } with counts for the confirmation panel, or
 * { ok: false, message } in plain English.
 */
export function validateImportPayload(data) {
  if (!isPlainObject(data)) {
    return reject('This file is not a valid NutriPlanner backup. Choose a file downloaded from NutriPlanner.');
  }
  if (data.app !== EXPORT_APP_NAME) {
    return reject('This file was not exported by NutriPlanner, so it cannot be restored. Choose a NutriPlanner data file.');
  }
  if (!Number.isInteger(data.version)) {
    return reject('This backup has no valid version and cannot be restored.');
  }
  if (data.version !== EXPORT_VERSION) {
    return reject('This backup was made with version ' + data.version + ', but this app reads version ' + EXPORT_VERSION + '. Download a fresh copy and try again.');
  }

  const targets = data.targets ?? [];
  const log = data.log ?? [];
  const bought = data.bought ?? [];
  const keptForBought = data.keptForBought ?? [];
  const labNotes = data.labNotes ?? [];
  const plan = data.plan ?? null;
  const planBase = data.planBase ?? null;
  const mealPrefs = data.mealPrefs ?? {};

  if (!isEntryList(targets)) return reject('This backup has an unexpected format for targets.');
  if (!isEntryList(log)) return reject('This backup has an unexpected format for meal logs.');
  if (!Array.isArray(bought)) return reject('This backup has an unexpected format for shopping ticks.');
  if (!isEntryList(keptForBought)) return reject('This backup has an unexpected format for kept meals.');
  if (!isEntryList(labNotes)) return reject('This backup has an unexpected format for lab notes.');
  if (!isPlan(plan)) return reject('This backup has an unexpected format for the month plan.');
  if (!(planBase === null || isPlainObject(planBase))) {
    return reject('This backup has an unexpected format for the earlier plan.');
  }
  if (!isPlainObject(mealPrefs)) return reject('This backup has an unexpected format for meal choices.');
  if (data.profileId !== undefined && data.profileId !== null && typeof data.profileId !== 'string') {
    return reject('This backup has an unexpected format for the profile.');
  }
  if (data.shopEvery !== undefined && data.shopEvery !== null && typeof data.shopEvery !== 'number') {
    return reject('This backup has an unexpected format for shopping frequency.');
  }
  if (data.shopStart !== undefined && data.shopStart !== null && typeof data.shopStart !== 'string') {
    return reject('This backup has an unexpected format for the shopping start date.');
  }
  if (data.updateDecisions !== undefined && data.updateDecisions !== null) {
    if (!Array.isArray(data.updateDecisions)) {
      return reject('This backup has an unexpected format for plan update decisions.');
    }
    for (const d of data.updateDecisions) {
      if (!isPlainObject(d) || typeof d.triggerDate !== 'string' || typeof d.accepted !== 'boolean') {
        return reject('This backup has an unexpected format for plan update decisions.');
      }
    }
  }

  return {
    ok: true,
    summary: {
      profileId: data.profileId ?? null,
      targets: targets.length,
      meals: activeSlots(mealPrefs).length,
      planDays: plan ? Object.keys(plan.days || {}).length : 0,
      logs: log.length,
      bought: bought.length,
      labNotes: labNotes.length,
    },
  };
}

/**
 * Build the state to save from a valid payload, starting from the defaults of an
 * empty state so a file can never leave a field undefined. An invalid payload
 * returns the current state untouched.
 */
export function applyImportPayload(currentState, data) {
  const check = validateImportPayload(data);
  if (!check.ok) return currentState;

  const restored = {
    profileId: typeof data.profileId === 'string' ? data.profileId : null,
    targets: (data.targets ?? []).map((t) => ({ ...t })),
    mealPrefs: normalizeMealPrefs(data.mealPrefs),
    plan: data.plan ?? null,
    planBase: data.planBase ?? null,
    log: (data.log ?? []).map((entry) => ({ ...entry })),
    bought: [...(data.bought ?? [])],
    keptForBought: (data.keptForBought ?? []).map((entry) => ({ ...entry })),
    shopEvery: [2, 3, 5, 7].includes(data.shopEvery) ? data.shopEvery : 7,
    shopStart: typeof data.shopStart === 'string' ? data.shopStart : null,
    pendingProposal: null,
    updateDecisions: Array.isArray(data.updateDecisions)
      ? data.updateDecisions
        .filter((d) => d && typeof d.triggerDate === 'string')
        .map((d) => ({ triggerDate: d.triggerDate, accepted: d.accepted === true }))
      : [],
    // The field is accepted for older files but the restored state keeps it empty.
    labNotes: [],
  };
  // An older backup may hold a second snack: the restored plan shows one snack only.
  return withoutSecondSnack(restored);
}
