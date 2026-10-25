// Does the month plan reach the daily targets? Planned food is an intention,
// not eaten food, but a plan that quietly misses its own targets would be
// dishonest. This module compares the planned average from today on with every
// target, using the summary's partial-data rule: an unknown value is reported
// as "can't tell", never as certain and never as zero. It only describes the
// plan average; a single day is never judged here.

import { NUTRIENT_KEYS, NUTRIENTS } from './nutrients.js';
import { planAverages } from './summary.js';
import { todayIso } from './planner.js';

export const PLAN_REACH_TITLE = 'This plan does not reach every target.';
export const PLAN_REACH_HINT = 'Try adding a snack in My meals, or adjust the target on the Targets screen.';
export const PLAN_REACH_UNKNOWN = "can't tell";

function nutrientInfo(key) {
  return NUTRIENTS.find((n) => n.key === key) || { key, label: key, unit: 'g' };
}

/** "Calories: about 1693 kcal a day against a minimum of 2200." */
function gapText(key, kind, daily, average, uncertain) {
  const { label, unit } = nutrientInfo(key);
  const against = kind === 'max' ? 'a maximum' : 'a minimum';
  if (uncertain) return `${label}: ${PLAN_REACH_UNKNOWN} against ${against} of ${daily}.`;
  const value = Math.round(average);
  return `${label}: about ${value} ${unit} a day against ${against} of ${daily}.`;
}

/**
 * The targets the plan does not reach on average, over the planned days from
 * today on (today included; a past day is history, not a plan).
 * Returns { days, gaps, reached }. Each gap carries the number behind it:
 * { nutrient, kind, daily, average, unknown, incomplete, text }.
 */
export function planReachGaps({
  plan = null, targets = [], recipesById = new Map(), foodsById = new Map(),
  today = todayIso(),
} = {}) {
  const allDates = Object.keys(plan?.days || {}).sort();
  const dates = allDates.filter((date) => date >= today);
  if (dates.length === 0) return { days: 0, gaps: [], reached: true };

  const planned = { days: Object.fromEntries(dates.map((date) => [date, plan.days[date]])) };
  const measured = planAverages(planned, recipesById, foodsById);
  const averages = measured.averages || {};
  const incomplete = measured.incomplete || {};

  const gaps = [];
  for (const target of targets || []) {
    const key = target?.nutrient;
    const daily = target?.daily;
    if (!NUTRIENT_KEYS.includes(key) || typeof daily !== 'number' || daily <= 0) continue;
    const average = averages[key] ?? null;
    // Nothing known at all: the line says "can't tell", never zero.
    const unknown = average === null;
    const partial = Boolean(incomplete[key]);
    const kind = target.kind === 'max' ? 'max' : 'min';
    let missed;
    let uncertain;
    if (unknown) {
      missed = true;
      uncertain = true;
    } else if (kind === 'max') {
      // Missing values can only add to a partial sum, so a partial average already
      // above the maximum certainly misses it. At or below, the plan is not known
      // to miss: the summary shows that case as incomplete, not as above.
      missed = average > daily;
      uncertain = false;
    } else {
      // Missing values can only add, so a partial average already at or above the
      // minimum already reaches it; below it the total may still reach, so the
      // line says "can't tell".
      missed = average < daily;
      uncertain = partial;
    }
    if (missed) {
      gaps.push({
        nutrient: key,
        kind,
        daily,
        average,
        unknown,
        incomplete: partial,
        text: gapText(key, kind, daily, average, uncertain),
      });
    }
  }
  return { days: dates.length, gaps, reached: gaps.length === 0 };
}
