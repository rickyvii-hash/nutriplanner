// D29: "See the effect before you save".
//
// A dry run of the real save for the draft on Outside the menu. It calls the
// very same computation (computeExtraSave: log entries, merged log, then the
// pure replan) and returns what the Plan updated screen would say, without
// changing the state, the storage, the proposals or the draft.

import { todayIso, localTime, effectChange } from './planner.js';
import { computeExtraSave } from './extra_save.js';
import { validateEatenWhen } from '../ui/log.js';

// The save computation is the same one this preview runs: callers can compare
// a dry run with what the real save would store without another import.
export { computeExtraSave, extraSaveNextState } from './extra_save.js';

export const PREVIEW_HEADLINE = 'If you save this';
export const PREVIEW_NO_CHANGE = 'Your plan would stay as it is.';
export const PREVIEW_UNREACHABLE_NOTE = 'Not every target can be met with the available recipes. Here is the closest option.';
/** At most this many Effect rows fit in the small card. */
export const PREVIEW_EFFECT_LIMIT = 2;

const HIDDEN = Object.freeze({
  shown: false,
  reason: null,
  note: null,
  effects: [],
  rows: [],
  nothingToChange: true,
  proposal: null,
  result: null,
});

function foodFor(foodsById, id) {
  if (!id) return null;
  if (typeof foodsById?.get === 'function') return foodsById.get(id) || null;
  return foodsById?.[id] || null;
}

function payloadItems(payload) {
  if (Array.isArray(payload)) return payload;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  return [...items, ...groups.flatMap((g) => (Array.isArray(g?.items) ? g.items : []))];
}

/**
 * The effect rows that moved most, largest change relative to the daily target
 * first. Rows whose numbers did not move are left out.
 */
export function topEffectRows(effects, limit = PREVIEW_EFFECT_LIMIT) {
  const scored = (Array.isArray(effects) ? effects : [])
    .map((effect) => {
      const change = effectChange(effect.nutrient, effect);
      const daily = Number(effect.daily) > 0 ? Number(effect.daily) : 1;
      return { effect, change, score: Math.abs(change) / daily };
    })
    .filter((entry) => Math.abs(entry.change) >= 0.5)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.effect);
}

/** The plan month as the Earlier control may use it. */
function planBounds(plan) {
  const dates = Object.keys(plan?.days || {}).filter(Boolean).sort();
  if (dates.length === 0) return { firstDate: null, lastDate: null };
  return { firstDate: dates[0], lastDate: dates[dates.length - 1] };
}

/**
 * What saving the current draft would do, for the card under "To add".
 *
 * Returns { shown, reason, note, effects, rows, nothingToChange, proposal,
 * result }. `shown` is false when there is nothing to preview: an empty list,
 * a planned meal, an invalid Earlier moment, an unknown food or a computation
 * that cannot run. Reading it never changes anything.
 */
export function previewExtra(ctx, payload, when = {}, options = {}) {
  try {
    const state = ctx?.state;
    if (!state?.plan) return { ...HIDDEN };
    if (when?.planned) return { ...HIDDEN };
    const items = payloadItems(payload);
    if (items.length === 0) return { ...HIDDEN };
    // A food that no longer exists cannot be previewed honestly: hide the card
    // instead of showing an error or made-up numbers.
    if (items.some((item) => !foodFor(ctx?.foodsById, item?.foodId))) return { ...HIDDEN };

    const today = options.today || todayIso();
    const nowTime = options.nowTime || localTime();
    const { firstDate, lastDate } = planBounds(state.plan);
    const check = validateEatenWhen({
      date: when?.date,
      time: when?.time,
      today,
      nowTime,
      firstDate,
      lastDate,
    });
    if (!check.ok) return { ...HIDDEN };

    const computed = computeExtraSave({
      state,
      recipes: ctx?.recipes || [],
      recipesById: ctx?.recipesById || new Map(),
      foodsById: ctx?.foodsById || new Map(),
      payload,
      when,
      today,
    });
    if (!computed?.result) return { ...HIDDEN };

    const result = computed.result;
    const nothingToChange = result.nothingToChange === true;
    const effects = nothingToChange ? [] : topEffectRows(result.effects);
    return {
      shown: true,
      reason: nothingToChange ? PREVIEW_NO_CHANGE : (result.reason || PREVIEW_NO_CHANGE),
      note: !nothingToChange && result.unreachable ? PREVIEW_UNREACHABLE_NOTE : null,
      effects,
      rows: effects,
      nothingToChange,
      proposal: nothingToChange ? null : result,
      result,
    };
  } catch {
    // A dry run must never break the screen: an unexpected draft simply gets
    // no card.
    return { ...HIDDEN };
  }
}
