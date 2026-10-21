// Doctor summary arithmetic. Averages come from the plan when nothing is
// logged, and from the logged meals once there are some. Missing values stay
// null (shown as "n/a"), never zero.

import { NUTRIENT_KEYS, foodNutrients, recipeNutrients } from './nutrients.js';

export const SUMMARY_STATUS = {
  within: 'Within target',
  above: 'Above target',
  below: 'Below target',
  incomplete: 'Incomplete data',
};

/**
 * Comparison of one average with its target. No other judgement is added.
 * When a nutrient has missing values the average is only a partial sum, so the status is
 * always "Incomplete data" (the partial value is still shown, with a leading "≥").
 */
export function targetStatus(kind, average, daily, incomplete = false) {
  // A partial sum (some nutrient value is missing) never gets a certain status.
  if (incomplete || average === null || average === undefined) return SUMMARY_STATUS.incomplete;
  if (kind === 'max') return average > daily ? SUMMARY_STATUS.above : SUMMARY_STATUS.within;
  return average < daily ? SUMMARY_STATUS.below : SUMMARY_STATUS.within;
}

function emptyAccumulator() {
  return {
    totals: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])),
    known: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])),
    missing: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])),
  };
}

function addNutrients(acc, nutrients) {
  for (const key of NUTRIENT_KEYS) {
    const v = nutrients[key];
    if (v === null || v === undefined) acc.missing[key] += 1;
    else {
      acc.totals[key] += v;
      acc.known[key] += 1;
    }
  }
}

function averagesFrom(acc, days) {
  const averages = {};
  const incomplete = {};
  for (const key of NUTRIENT_KEYS) {
    averages[key] = acc.known[key] === 0 ? null : acc.totals[key] / days;
    incomplete[key] = acc.missing[key] > 0;
  }
  return { averages, incomplete };
}

/** Totals and per-day averages of the logged meals, one day = one distinct date. */
export function loggedAverages(log, foodsById) {
  const entries = Array.isArray(log) ? log : [];
  const dates = new Set(entries.map((e) => e.date));
  const acc = emptyAccumulator();
  for (const entry of entries) {
    for (const item of entry.items || []) {
      const food = foodsById.get(item.foodId);
      if (!food) continue;
      addNutrients(acc, foodNutrients(food, item.grams));
    }
  }
  const measured = dates.size === 0 ? { averages: null, incomplete: {} } : averagesFrom(acc, dates.size);
  return {
    days: dates.size,
    totals: acc.totals,
    averages: measured.averages,
    incomplete: measured.incomplete,
  };
}

/** Totals and per-day averages of the planned month. */
export function planAverages(plan, recipesById, foodsById) {
  const dates = Object.keys(plan?.days || {}).sort();
  const acc = emptyAccumulator();
  for (const date of dates) {
    const meals = plan.days[date];
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) {
      const recipe = recipesById.get(meals[slot]);
      if (!recipe) continue;
      // Keep what the recipe knows AND remember what it does not: a recipe with a missing nutrient
      // makes the whole average for that nutrient a partial sum.
      const r = recipeNutrients(recipe, foodsById);
      for (const key of NUTRIENT_KEYS) {
        if (!r.unknown[key]) {
          acc.totals[key] += r.totals[key];
          acc.known[key] += 1;
        }
        if (r.unknown[key] || r.incomplete[key]) acc.missing[key] += 1;
      }
    }
  }
  const measured = dates.length === 0 ? { averages: null, incomplete: {} } : averagesFrom(acc, dates.length);
  return {
    days: dates.length,
    totals: acc.totals,
    averages: measured.averages,
    incomplete: measured.incomplete,
  };
}

function mealRows(log, foodsById) {
  return (Array.isArray(log) ? log : [])
    .slice()
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`))
    .map((entry) => ({
      date: entry.date,
      time: entry.time || '',
      items: (entry.items || []).map((item) => ({
        name: foodsById.get(item.foodId)?.name || item.foodId,
        grams: item.grams,
      })),
    }));
}

/**
 * Everything the doctor summary screen shows.
 * With a plan, only log entries inside the plan period count, so the period,
 * the averages and the meal list always refer to the same interval.
 * Without a plan, the period runs from the first to the last logged date.
 * source is "log" when at least one counted meal is logged, otherwise "plan".
 */
export function buildSummary({
  targets = [], plan = null, log = [], recipesById, foodsById,
}) {
  const entries = Array.isArray(log) ? log : [];
  const planDates = Object.keys(plan?.days || {}).sort();
  const logDates = entries.map((e) => e.date).filter(Boolean).sort();

  let period;
  let counted;
  if (planDates.length > 0) {
    period = { from: planDates[0], to: planDates[planDates.length - 1] };
    counted = entries.filter((e) => e.date && e.date >= period.from && e.date <= period.to);
  } else {
    period = logDates.length > 0
      ? { from: logDates[0], to: logDates[logDates.length - 1] }
      : { from: null, to: null };
    counted = entries.filter((e) => Boolean(e.date));
  }

  const source = counted.length > 0 ? 'log' : 'plan';
  const measured = source === 'log'
    ? loggedAverages(counted, foodsById)
    : planAverages(plan, recipesById, foodsById);
  const averages = measured.averages || Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, null]));
  const incomplete = measured.incomplete || {};

  const rows = targets.map((t) => {
    const average = averages[t.nutrient] ?? null;
    const isIncomplete = Boolean(incomplete[t.nutrient]);
    return {
      nutrient: t.nutrient,
      kind: t.kind,
      daily: t.daily,
      average,
      incomplete: isIncomplete,
      status: targetStatus(t.kind, average, t.daily, isIncomplete),
    };
  });

  return {
    source,
    days: measured.days,
    loggedDays: new Set(counted.map((e) => e.date)).size,
    period,
    averages,
    incomplete,
    rows,
    meals: source === 'log' ? mealRows(counted, foodsById) : [],
  };
}
