// Month plan builder and replanner. Scoring is plain arithmetic so the
// "reason" text on Plan updated comes from real numbers, not invented copy.

import { recipeNutrients, loggedNutrients, NUTRIENT_KEYS } from './nutrients.js';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** All YYYY-MM-DD dates in a calendar month (month is 1–12). */
export function daysInMonth(year, month) {
  const out = [];
  const last = new Date(year, month, 0).getDate();
  for (let d = 1; d <= last; d += 1) {
    out.push(`${year}-${pad(month)}-${pad(d)}`);
  }
  return out;
}

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local wall-clock time as HH:MM (never UTC, so the logged time matches the phone clock). */
export function localTime(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function emptyTotals() {
  const t = {};
  for (const k of NUTRIENT_KEYS) t[k] = 0;
  return t;
}

function addTotals(a, b) {
  const out = emptyTotals();
  for (const k of NUTRIENT_KEYS) out[k] = (a[k] || 0) + (b[k] || 0);
  return out;
}

/**
 * Day nutrient totals from recipe ids. Skips missing recipes; null nutrients count as 0 for scoring only.
 * Returns { totals, incomplete, unknown }: incomplete[key] marks a partial sum (some meal had no value),
 * unknown[key] marks a nutrient no meal of the day knows at all (the screen shows "n/a").
 */
export function dayTotals(dayMeals, recipesById, foodsById) {
  const totals = emptyTotals();
  const incomplete = {};
  const known = {};
  let hasMeal = false;
  for (const slot of SLOTS) {
    const id = dayMeals?.[slot];
    if (!id) continue;
    const recipe = recipesById.get(id);
    if (!recipe) continue;
    hasMeal = true;
    const r = recipeNutrients(recipe, foodsById);
    for (const k of NUTRIENT_KEYS) {
      if (r.unknown[k] || r.incomplete[k]) incomplete[k] = true;
      if (!r.unknown[k]) {
        totals[k] += r.totals[k];
        known[k] = true;
      }
    }
  }
  const unknown = {};
  for (const k of NUTRIENT_KEYS) unknown[k] = hasMeal && !known[k];
  return { totals, incomplete, unknown };
}

/**
 * Lower is better. Penalises missing a min or exceeding a max.
 * Soft preference to use (not waste) a max budget or not overshoot a min.
 */
export function scoreAgainstTargets(totals, targets) {
  let score = 0;
  let unmet = 0;
  for (const t of targets) {
    const v = totals[t.nutrient];
    if (v === null || v === undefined) continue;
    const daily = t.daily;
    if (!daily || daily <= 0) continue;
    if (t.kind === 'max') {
      if (v > daily) {
        score += ((v - daily) / daily) * 3;
        unmet += 1;
      } else {
        score += ((daily - v) / daily) * 0.15;
      }
    } else {
      if (v < daily) {
        score += ((daily - v) / daily) * 3;
        unmet += 1;
      } else {
        score += ((v - daily) / daily) * 0.15;
      }
    }
  }
  return { score, unmet };
}

function recipesForSlot(recipes, slot) {
  return recipes.filter((r) => r.slot === slot);
}

/**
 * Small preference for recipes whose ingredients are already bought. It is the share of
 * ingredients at home (0..1) times a small weight, so it breaks ties between similar
 * recipes but can never outweigh missing a target, even when everything is ticked.
 */
function boughtShare(recipe, boughtSet) {
  if (!boughtSet || boughtSet.size === 0 || recipe.ingredients.length === 0) return 0;
  return recipe.ingredients.filter((ing) => boughtSet.has(ing.foodId)).length / recipe.ingredients.length;
}

function boughtBonus(recipe, boughtSet) {
  return -boughtShare(recipe, boughtSet) * 0.4;
}

/** Days a recipe must rest before it can fill the same slot again (variety). */
function cooldownDays(recipes, slot) {
  const n = recipesForSlot(recipes, slot).length;
  return Math.max(0, Math.min(3, n - 1));
}

/**
 * Best combination of one recipe per slot for a day, judged on the whole day at once
 * (a few thousand combinations, plain arithmetic).
 * avoidBySlot: { slot: Set(recipeId) } recipes still "resting", skipped for variety.
 */
function fillDay(recipes, targets, foodsById, boughtSet, avoidBySlot = {}, capBySlot = {}) {
  const options = SLOTS.map((slot) => {
    const all = recipesForSlot(recipes, slot);
    if (all.length === 0) throw new Error(`No recipes for slot ${slot}`);
    // capBySlot: { slot: { nutrient: value } } a meal may only be swapped for one that
    // does not have more of that nutrient than the meal it replaces.
    const cap = capBySlot[slot];
    const totalsOf = new Map(all.map((r) => [r.id, recipeNutrients(r, foodsById).totals]));
    const allowed = cap
      ? all.filter((r) => Object.entries(cap).every(([n, v]) => totalsOf.get(r.id)[n] <= v + 1e-9))
      : all;
    const pool = allowed.length > 0 ? allowed : all;
    const avoid = avoidBySlot[slot];
    const rested = avoid && avoid.size > 0 ? pool.filter((r) => !avoid.has(r.id)) : pool;
    return (rested.length > 0 ? rested : pool).map((recipe) => ({
      id: recipe.id,
      totals: totalsOf.get(recipe.id),
      bonus: boughtBonus(recipe, boughtSet),
    }));
  });
  let best = null;
  let bestScore = Infinity;
  const picks = [];
  const walk = (i, soFar, bonus) => {
    if (i === options.length) {
      const score = scoreAgainstTargets(soFar, targets).score + bonus;
      if (score < bestScore) {
        bestScore = score;
        best = picks.slice();
      }
      return;
    }
    for (const o of options[i]) {
      picks[i] = o.id;
      walk(i + 1, addTotals(soFar, o.totals), bonus + o.bonus);
    }
  };
  walk(0, emptyTotals(), 0);
  return Object.fromEntries(SLOTS.map((slot, i) => [slot, best[i]]));
}

/**
 * Build a full month plan. `month` is { year, month } (month 1–12).
 * Returns { month: "YYYY-MM", days: { "YYYY-MM-DD": { breakfast, lunch, dinner, snack } } }.
 */
export function buildPlan(targets, recipes, month, foodsById, bought = []) {
  const boughtSet = new Set(bought);
  const days = {};
  const recent = {};
  for (const slot of SLOTS) recent[slot] = [];
  for (const date of daysInMonth(month.year, month.month)) {
    const avoid = {};
    for (const slot of SLOTS) {
      avoid[slot] = new Set(recent[slot].slice(-cooldownDays(recipes, slot)));
    }
    days[date] = fillDay(recipes, targets, foodsById, boughtSet, avoid);
    for (const slot of SLOTS) recent[slot].push(days[date][slot]);
  }
  return {
    month: `${month.year}-${pad(month.month)}`,
    days,
  };
}

/** Nutrients already logged on or before `throughDate` (inclusive). */
export function consumedFromLog(log, foodsById, throughDate = null) {
  let totals = emptyTotals();
  for (const entry of log || []) {
    if (throughDate && entry.date > throughDate) continue;
    const r = loggedNutrients(entry.items, foodsById);
    totals = addTotals(totals, r.totals);
  }
  return totals;
}

function effectOnTargets(oldDayAvg, newDayAvg, targets) {
  return targets.map((t) => {
    const before = oldDayAvg.totals[t.nutrient] ?? 0;
    const after = newDayAvg.totals[t.nutrient] ?? 0;
    const delta = after - before;
    let status = 'Closer to target';
    const goal = t.originalDaily ?? t.daily;
    const beforeDist = t.kind === 'max'
      ? Math.max(0, before - goal) + Math.max(0, goal - before) * 0.1
      : Math.max(0, goal - before) + Math.max(0, before - goal) * 0.1;
    const afterDist = t.kind === 'max'
      ? Math.max(0, after - goal) + Math.max(0, goal - after) * 0.1
      : Math.max(0, goal - after) + Math.max(0, after - goal) * 0.1;
    if (Math.abs(delta) < 0.5) status = 'Unchanged';
    else if (afterDist < beforeDist - 0.01) status = 'Closer to target';
    else if (t.kind === 'max' && after < before) status = 'Lower over the next days';
    else if (t.kind === 'min' && after > before) status = 'Higher over the next days';
    else status = 'Adjusted';
    const within = t.kind === 'max' ? after <= goal : after >= goal;
    if (within && afterDist <= beforeDist) status = 'Within target';
    return {
      nutrient: t.nutrient,
      kind: t.kind,
      daily: goal,
      before,
      after,
      delta,
      status,
      // A partial average is marked so the screen never prints it as certain.
      beforeIncomplete: Boolean(oldDayAvg.incomplete?.[t.nutrient]),
      beforeUnknown: Boolean(oldDayAvg.unknown?.[t.nutrient]),
      afterIncomplete: Boolean(newDayAvg.incomplete?.[t.nutrient]),
      afterUnknown: Boolean(newDayAvg.unknown?.[t.nutrient]),
    };
  });
}

function averageDailyTotals(plan, recipesById, foodsById, dates) {
  if (dates.length === 0) return { totals: emptyTotals(), incomplete: {}, unknown: {} };
  let sum = emptyTotals();
  const incomplete = {};
  const unknownCount = {};
  for (const date of dates) {
    const day = dayTotals(plan.days[date], recipesById, foodsById);
    sum = addTotals(sum, day.totals);
    for (const k of NUTRIENT_KEYS) {
      if (day.unknown[k]) unknownCount[k] = (unknownCount[k] || 0) + 1;
      if (day.unknown[k] || day.incomplete[k]) incomplete[k] = true;
    }
  }
  const totals = emptyTotals();
  const unknown = {};
  for (const k of NUTRIENT_KEYS) {
    totals[k] = sum[k] / dates.length;
    unknown[k] = (unknownCount[k] || 0) === dates.length;
  }
  return { totals, incomplete, unknown };
}

function nutrientWords(key) {
  if (key === 'satFat') return 'saturated fat';
  if (key === 'kcal') return 'calories';
  if (key === 'sodium') return 'sodium';
  if (key === 'protein') return 'protein';
  if (key === 'fibre') return 'fibre';
  if (key === 'fat') return 'total fat';
  if (key === 'carbs') return 'carbohydrate';
  if (key === 'sugars') return 'sugars';
  return key;
}

function formatDelta(key, absDelta) {
  if (key === 'kcal' || key === 'sodium') return `${absDelta.toFixed(0)}`;
  return `${absDelta.toFixed(1)} g`;
}

function buildReason({
  effects, changed, keptForBought, unreachable, nothingToChange, targets, recentTotals,
}) {
  if (nothingToChange) {
    return 'No changes needed — the rest of the month still meets your targets.';
  }
  const daysTouched = new Set(changed.map((c) => c.date)).size;
  const keptNote = keptForBought.length > 0 ? ' Meals that use food already bought were kept.' : '';
  const closestNote = unreachable
    ? 'Not every target can be met with the available recipes; this is the closest plan. '
    : '';

  // The maximum that today's log went furthest over (relative to its daily limit).
  let over = null;
  for (const t of targets) {
    if (t.kind !== 'max') continue;
    const recent = recentTotals ? (recentTotals[t.nutrient] || 0) : 0;
    if (recent <= t.daily) continue;
    const ratio = (recent - t.daily) / t.daily;
    if (!over || ratio > over.ratio) over = { t, recent, ratio };
  }
  if (over) {
    const e = effects.find((x) => x.nutrient === over.t.nutrient);
    const less = e && e.delta < -0.05 ? ` (about ${formatAmount(over.t.nutrient, Math.abs(e.delta))} less per day on average)` : '';
    return `${closestNote}You logged ${formatAmount(over.t.nutrient, over.recent)} of ${nutrientWords(over.t.nutrient)} today `
      + `(goal: max ${formatAmount(over.t.nutrient, over.t.daily)}), so the next ${daysTouched} days are lower in `
      + `${nutrientWords(over.t.nutrient)}${less}.${keptNote}`;
  }

  // No maximum was exceeded: the change comes from food already bought.
  const parts = [];
  if (changed.length > 0) {
    parts.push(`updated ${changed.length} meal${changed.length === 1 ? '' : 's'} to stay closer to your targets`);
  }
  if (keptForBought.length > 0) parts.push('kept meals that use food already bought');
  if (parts.length === 0) return `${closestNote}Small adjustments to stay closer to your targets.`.trim();
  const text = closestNote + parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

/** Days after the log date that can change: a short, visible compensation window. */
export const WINDOW_DAYS = 4;

/**
 * Shown when the log lands on the last planned day and went over a maximum:
 * there are no days left to adjust, and the next month starts fresh.
 */
export const LAST_DAY_REASON = 'This is the last planned day of the month, so there is nothing left to adjust. '
  + 'Your plan for the next month will start fresh.';

function formatAmount(key, v) {
  if (key === 'kcal') return `${Math.round(v)} kcal`;
  if (key === 'sodium') return `${Math.round(v)} mg`;
  return `${v.toFixed(1)} g`;
}

/**
 * Replan the days right after a log.
 * An off-plan meal that goes over a daily maximum is made up over the next
 * WINDOW_DAYS days (not spread thinly over the whole month); every other day
 * of the month stays exactly as it was.
 * state: { targets, recipes, plan, log, bought, foodsById, fromDate? }
 */
export function replan(state) {
  const {
    targets,
    recipes,
    plan,
    log,
    bought = [],
    foodsById,
    fromDate = todayIso(),
  } = state;

  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const boughtSet = new Set(bought);
  const allDates = Object.keys(plan.days || {}).sort();
  const remainingDates = allDates.filter((d) => d >= fromDate);
  const elapsedDates = allDates.filter((d) => d < fromDate);

  // Nutrients eaten this month: the real log where there is one, otherwise the plan.
  const loggedDates = new Set((log || []).map((e) => e.date));
  let consumedMonth = emptyTotals();
  for (const date of elapsedDates) {
    if (loggedDates.has(date)) {
      for (const entry of (log || []).filter((e) => e.date === date)) {
        consumedMonth = addTotals(consumedMonth, loggedNutrients(entry.items, foodsById).totals);
      }
    } else {
      consumedMonth = addTotals(consumedMonth, dayTotals(plan.days[date], recipesById, foodsById).totals);
    }
  }
  // What was logged on the log date (the meal that triggered this replan).
  let recentTotals = emptyTotals();
  for (const entry of log || []) {
    if (entry.date === fromDate) {
      const r = loggedNutrients(entry.items, foodsById);
      recentTotals = addTotals(recentTotals, r.totals);
      consumedMonth = addTotals(consumedMonth, r.totals);
    }
  }

  const windowDates = allDates.filter((d) => d > fromDate).slice(0, WINDOW_DAYS);
  const windowSet = new Set(windowDates);

  // Over a maximum today: make it up over the window by lowering each window day
  // below what it had planned, by overshoot / window length.
  const overshoot = {};
  for (const t of targets) {
    const recent = recentTotals[t.nutrient] || 0;
    if (t.kind === 'max' && recent > t.daily) overshoot[t.nutrient] = recent - t.daily;
  }
  // Logged on the last planned day and over a maximum: no window is left to adjust.
  const lastDayOverMax = windowDates.length === 0 && Object.keys(overshoot).length > 0;
  const adjusted = windowDates.length > 0 && Object.keys(overshoot).length > 0;
  const targetsForDay = (date) => targets.map((t) => {
    const out = { ...t, originalDaily: t.daily };
    if (adjusted && overshoot[t.nutrient]) {
      const planned = dayTotals(plan.days[date], recipesById, foodsById).totals[t.nutrient];
      out.daily = Math.max(t.daily * 0.4, Math.min(t.daily, planned) - overshoot[t.nutrient] / windowDates.length);
    }
    return out;
  });

  const newPlan = {
    month: plan.month,
    days: Object.fromEntries(Object.entries(plan.days).map(([d, m]) => [d, { ...m }])),
  };
  const keptForBought = [];

  if (windowDates.length > 0 && (adjusted || boughtSet.size > 0)) {
    for (const date of windowDates) {
      const idx = allDates.indexOf(date);
      const avoid = {};
      for (const slot of SLOTS) {
        const k = cooldownDays(recipes, slot);
        const before = allDates.slice(Math.max(0, idx - k), idx).map((d) => newPlan.days[d][slot]);
        const after = allDates.slice(idx + 1, idx + 1 + k).filter((d) => !windowSet.has(d)).map((d) => newPlan.days[d][slot]);
        avoid[slot] = new Set([...before, ...after]);
      }
      const dayTargets = targetsForDay(date);
      // Only swap towards less of the nutrient that went over (never more than the old meal had).
      const caps = {};
      if (adjusted) {
        for (const slot of SLOTS) {
          const old = recipesById.get(plan.days[date]?.[slot]);
          if (!old) continue;
          const totals = recipeNutrients(old, foodsById).totals;
          caps[slot] = Object.fromEntries(Object.keys(overshoot).map((n) => [n, totals[n]]));
        }
      }
      const day = fillDay(recipes, dayTargets, foodsById, boughtSet, avoid, caps);
      const prev = plan.days[date];
      const merged = { ...day };
      for (const slot of SLOTS) {
        const prevRecipe = recipesById.get(prev?.[slot]);
        if (!prevRecipe || avoid[slot].has(prevRecipe.id)) continue;
        // Keep the old meal only when it has a bigger share of food already at home than its replacement;
        // if everything is at home there is no pantry reason to keep it.
        if (boughtShare(prevRecipe, boughtSet) <= boughtShare(recipesById.get(day[slot]), boughtSet)) continue;
        // Keep the old meal when it uses bought food and does not worsen the score much.
        let soFar = emptyTotals();
        for (const s of SLOTS) {
          if (s === slot) break;
          const rec = recipesById.get(merged[s]);
          if (rec) soFar = addTotals(soFar, recipeNutrients(rec, foodsById).totals);
        }
        const keepScore = scoreAgainstTargets(addTotals(soFar, recipeNutrients(prevRecipe, foodsById).totals), dayTargets).score;
        const pickScore = scoreAgainstTargets(addTotals(soFar, recipeNutrients(recipesById.get(day[slot]), foodsById).totals), dayTargets).score;
        if (keepScore <= pickScore + 0.15) {
          merged[slot] = prevRecipe.id;
          keptForBought.push({ date, slot, recipeId: prevRecipe.id });
        }
      }
      newPlan.days[date] = merged;
    }
  }

  const changed = [];
  for (const date of windowDates) {
    for (const slot of SLOTS) {
      const before = plan.days[date]?.[slot];
      const after = newPlan.days[date]?.[slot];
      if (before !== after) {
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
  }

  // Averages over the days that can change (fall back to the rest of the month on the last day).
  const compareDates = windowDates.length > 0 ? windowDates : remainingDates;
  const oldAvg = averageDailyTotals(plan, recipesById, foodsById, compareDates);
  const newAvg = averageDailyTotals(newPlan, recipesById, foodsById, compareDates);
  const effects = effectOnTargets(oldAvg, newAvg, targets.map((t) => ({ ...t, originalDaily: t.daily })));

  // Unreachable: a target is still badly missed on the new average.
  let unreachable = false;
  for (const t of targets) {
    const v = newAvg.totals[t.nutrient] ?? 0;
    if (t.kind === 'max' && v > t.daily * 1.15) unreachable = true;
    if (t.kind === 'min' && v < t.daily * 0.85) unreachable = true;
  }
  const sampleDay = fillDay(recipes, targets, foodsById, boughtSet);
  const sample = dayTotals(sampleDay, recipesById, foodsById);
  if (scoreAgainstTargets(sample.totals, targets).unmet >= targets.length) unreachable = true;

  const nothingToChange = changed.length === 0;

  const reason = lastDayOverMax
    ? LAST_DAY_REASON
    : buildReason({
      effects,
      changed,
      keptForBought,
      unreachable,
      nothingToChange,
      targets,
      recentTotals,
    });

  return {
    plan: newPlan,
    changed,
    effects,
    reason,
    unreachable,
    nothingToChange,
    keptForBought,
    adjustedTargets: windowDates.length > 0 ? targetsForDay(windowDates[0]) : targets,
    consumedMonth,
    recentTotals,
    windowDates,
  };
}

export { SLOTS };
