// Doctor summary arithmetic. Averages come from the plan when nothing is
// logged, and from the logged meals once there are some. Missing values stay
// null (shown as "n/a"), never zero.

import { NUTRIENT_KEYS, foodNutrients, recipeNutrients } from './nutrients.js';

export const SUMMARY_STATUS = {
  within: 'Within target',
  above: 'Above target',
  below: 'Below target',
};

/** Comparison of one average with its target. No other judgement is added. */
export function targetStatus(kind, average, daily) {
  if (average === null || average === undefined) return 'n/a';
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
  const out = {};
  for (const key of NUTRIENT_KEYS) {
    out[key] = acc.known[key] === 0 ? null : acc.totals[key] / days;
  }
  return out;
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
  return {
    days: dates.size,
    totals: acc.totals,
    averages: dates.size === 0 ? null : averagesFrom(acc, dates.size),
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
      addNutrients(acc, recipeNutrients(recipe, foodsById).totals);
    }
  }
  return {
    days: dates.length,
    totals: acc.totals,
    averages: dates.length === 0 ? null : averagesFrom(acc, dates.length),
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
 * source is "log" when at least one meal is logged, otherwise "plan".
 */
export function buildSummary({
  targets = [], plan = null, log = [], recipesById, foodsById,
}) {
  const entries = Array.isArray(log) ? log : [];
  const source = entries.length > 0 ? 'log' : 'plan';
  const planDates = Object.keys(plan?.days || {}).sort();
  const logDates = entries.map((e) => e.date).filter(Boolean).sort();
  const periodDates = planDates.length > 0 ? planDates : logDates;
  const period = periodDates.length > 0
    ? { from: periodDates[0], to: periodDates[periodDates.length - 1] }
    : { from: null, to: null };

  const measured = source === 'log'
    ? loggedAverages(entries, foodsById)
    : planAverages(plan, recipesById, foodsById);
  const averages = measured.averages || Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, null]));

  const rows = targets.map((t) => {
    const average = averages[t.nutrient] ?? null;
    return {
      nutrient: t.nutrient,
      kind: t.kind,
      daily: t.daily,
      average,
      status: targetStatus(t.kind, average, t.daily),
    };
  });

  return {
    source,
    days: measured.days,
    period,
    averages,
    rows,
    meals: source === 'log' ? mealRows(entries, foodsById) : [],
  };
}
