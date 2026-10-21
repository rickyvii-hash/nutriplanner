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

/** Day nutrient totals from recipe ids. Skips missing recipes; null nutrients count as 0 for scoring only. */
export function dayTotals(dayMeals, recipesById, foodsById) {
  let totals = emptyTotals();
  const incomplete = {};
  for (const slot of SLOTS) {
    const id = dayMeals?.[slot];
    if (!id) continue;
    const recipe = recipesById.get(id);
    if (!recipe) continue;
    const r = recipeNutrients(recipe, foodsById);
    for (const k of NUTRIENT_KEYS) {
      if (r.unknown[k] || r.incomplete[k]) incomplete[k] = true;
      if (!r.unknown[k]) totals[k] += r.totals[k];
    }
  }
  return { totals, incomplete };
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

function boughtBonus(recipe, boughtSet) {
  if (!boughtSet || boughtSet.size === 0) return 0;
  let hits = 0;
  for (const ing of recipe.ingredients) {
    if (boughtSet.has(ing.foodId)) hits += 1;
  }
  // Prefer recipes that use what is already bought (lower score is better).
  return -hits * 0.35;
}

function pickRecipe(candidates, daySoFar, targets, foodsById, boughtSet) {
  let best = null;
  let bestScore = Infinity;
  for (const recipe of candidates) {
    const r = recipeNutrients(recipe, foodsById);
    const trial = addTotals(daySoFar, r.totals);
    const { score } = scoreAgainstTargets(trial, targets);
    const total = score + boughtBonus(recipe, boughtSet);
    if (total < bestScore) {
      bestScore = total;
      best = recipe;
    }
  }
  return best;
}

function fillDay(recipes, targets, foodsById, boughtSet) {
  const day = {};
  let soFar = emptyTotals();
  const recipesBySlot = {};
  for (const slot of SLOTS) recipesBySlot[slot] = recipesForSlot(recipes, slot);
  for (const slot of SLOTS) {
    const pick = pickRecipe(recipesBySlot[slot], soFar, targets, foodsById, boughtSet);
    if (!pick) throw new Error(`No recipes for slot ${slot}`);
    day[slot] = pick.id;
    const r = recipeNutrients(pick, foodsById);
    soFar = addTotals(soFar, r.totals);
  }
  return day;
}

/**
 * Build a full month plan. `month` is { year, month } (month 1–12).
 * Returns { month: "YYYY-MM", days: { "YYYY-MM-DD": { breakfast, lunch, dinner, snack } } }.
 */
export function buildPlan(targets, recipes, month, foodsById, bought = []) {
  const boughtSet = new Set(bought);
  const days = {};
  for (const date of daysInMonth(month.year, month.month)) {
    days[date] = fillDay(recipes, targets, foodsById, boughtSet);
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

/** Sum planned nutrients for dates in range [from, to] inclusive, optional skip slots. */
function plannedRangeTotals(plan, recipesById, foodsById, fromDate, toDate, skip = null) {
  let totals = emptyTotals();
  for (const [date, meals] of Object.entries(plan.days || {})) {
    if (date < fromDate || date > toDate) continue;
    for (const slot of SLOTS) {
      if (skip && skip.date === date && skip.slots?.has(slot)) continue;
      const id = meals[slot];
      const recipe = recipesById.get(id);
      if (!recipe) continue;
      const r = recipeNutrients(recipe, foodsById);
      totals = addTotals(totals, r.totals);
    }
  }
  return totals;
}

function remainingDayCount(plan, fromDate) {
  return Object.keys(plan.days || {}).filter((d) => d >= fromDate).length;
}

/**
 * Remaining daily targets after accounting for what was already eaten this month,
 * spread evenly over remaining days from `fromDate`.
 */
export function remainingDailyTargets(targets, consumed, remainingDays) {
  const days = Math.max(1, remainingDays);
  return targets.map((t) => {
    const eaten = consumed[t.nutrient] || 0;
    // Month budget ≈ daily * days in the planned month portion we care about.
    // We treat the original daily as the per-day goal for remaining days,
    // adjusted by how far ahead/behind the log is relative to "expected so far".
    // Simpler and clearer: remaining budget for the rest of the month =
    // daily * remainingDays, minus any overshoot already logged beyond
    // (daysElapsed * daily). For POC we adjust the remaining daily target:
    if (t.kind === 'max') {
      // If already high, push remaining days lower.
      const overshoot = Math.max(0, eaten - t.daily); // crude: one-day worth reference
      const adjusted = Math.max(t.daily * 0.4, t.daily - overshoot / days);
      return { ...t, daily: adjusted, originalDaily: t.daily };
    }
    // min: if behind, raise remaining days
    const shortfall = Math.max(0, t.daily - eaten);
    // eaten is cumulative; better: compare to expected
    // For a single off-plan day we want: if today blew a max, lower future days.
    // Use: remaining daily = clamp(original ± (eaten_today_effect))
    return { ...t, daily: t.daily + shortfall / days * 0, originalDaily: t.daily };
  });
}

/**
 * Adjust per-day targets for the rest of the month.
 * Month budget keeps the long-run average on track; `recentTotals` (usually
 * today's log) applies an extra pull so a single off-plan meal visibly reshapes
 * the next days — e.g. a high-sat-fat meal lowers sat fat afterward.
 */
export function adjustedTargetsForRest(
  targets,
  consumedMonth,
  daysElapsed,
  daysRemaining,
  recentTotals = null,
) {
  const rem = Math.max(1, daysRemaining);
  const elapsed = Math.max(0, daysElapsed);
  return targets.map((t) => {
    const monthBudget = t.daily * (elapsed + rem);
    const eaten = consumedMonth[t.nutrient] || 0;
    const left = monthBudget - eaten;
    let daily = left / rem;
    if (t.kind === 'max') {
      const recent = recentTotals ? (recentTotals[t.nutrient] || 0) : 0;
      // Today's overshoot beyond one daily allowance is spread over remaining days.
      const spike = Math.max(0, recent - t.daily);
      if (spike > 0) daily = Math.min(daily, t.daily - spike / rem);
      const expectedSoFar = t.daily * Math.max(1, elapsed);
      const overshoot = Math.max(0, eaten - expectedSoFar);
      daily = Math.min(daily, t.daily - overshoot / rem);
      daily = Math.max(t.daily * 0.2, daily);
    } else {
      const recent = recentTotals ? (recentTotals[t.nutrient] || 0) : 0;
      const short = Math.max(0, t.daily - recent);
      if (recentTotals && recent < t.daily) daily = Math.max(daily, t.daily + short / rem);
      else daily = Math.max(t.daily * 0.5, daily);
    }
    return { ...t, daily, originalDaily: t.daily };
  });
}

function effectOnTargets(oldDayAvg, newDayAvg, targets) {
  return targets.map((t) => {
    const before = oldDayAvg[t.nutrient] ?? 0;
    const after = newDayAvg[t.nutrient] ?? 0;
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
    };
  });
}

function averageDailyTotals(plan, recipesById, foodsById, fromDate) {
  const dates = Object.keys(plan.days || {}).filter((d) => d >= fromDate);
  if (dates.length === 0) return emptyTotals();
  let sum = emptyTotals();
  for (const date of dates) {
    const { totals } = dayTotals(plan.days[date], recipesById, foodsById);
    sum = addTotals(sum, totals);
  }
  const avg = emptyTotals();
  for (const k of NUTRIENT_KEYS) avg[k] = sum[k] / dates.length;
  return avg;
}

function recipeUsesBought(recipe, boughtSet) {
  return recipe.ingredients.some((ing) => boughtSet.has(ing.foodId));
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
  const parts = [];
  if (unreachable) {
    parts.push('Not every target can be met with the available recipes; this is the closest plan');
  }

  // Prefer the target the recent log most violated (relative to its daily),
  // then the largest plan delta. Relative scale keeps mg-sodium from drowning g-fat.
  let focus = null;
  let focusScore = -Infinity;
  for (const t of targets) {
    const e = effects.find((x) => x.nutrient === t.nutrient);
    if (!e) continue;
    const recent = recentTotals ? (recentTotals[t.nutrient] || 0) : 0;
    let score = Math.abs(e.delta) / Math.max(1, t.daily);
    if (t.kind === 'max' && recent > t.daily) {
      score += ((recent - t.daily) / t.daily) * 4;
    }
    if (t.kind === 'min' && recentTotals && recent < t.daily) {
      score += ((t.daily - recent) / t.daily) * 4;
    }
    if (t.kind === 'max' && e.delta < -0.2) score += 0.5;
    if (t.kind === 'min' && e.delta > 0.2) score += 0.5;
    if (score > focusScore) {
      focusScore = score;
      focus = { t, e };
    }
  }

  if (focus && Math.abs(focus.e.delta) >= 0.3) {
    const daysTouched = new Set(changed.map((c) => c.date)).size;
    const daysNote = daysTouched > 0 ? ` for the next ${Math.min(7, daysTouched)} days` : '';
    if (focus.t.kind === 'max' && focus.e.delta <= 0) {
      parts.push(`lowered ${nutrientWords(focus.t.nutrient)}${daysNote} (about ${formatDelta(focus.t.nutrient, Math.abs(focus.e.delta))} per day on average)`);
    } else if (focus.t.kind === 'min' && focus.e.delta >= 0) {
      parts.push(`raised ${nutrientWords(focus.t.nutrient)}${daysNote} (about ${formatDelta(focus.t.nutrient, Math.abs(focus.e.delta))} per day on average)`);
    } else {
      parts.push(`adjusted ${nutrientWords(focus.t.nutrient)}${daysNote} (about ${formatDelta(focus.t.nutrient, Math.abs(focus.e.delta))} per day on average)`);
    }
  } else if (changed.length > 0) {
    parts.push(`updated ${changed.length} meal${changed.length === 1 ? '' : 's'} to stay closer to your targets`);
  }

  if (keptForBought.length > 0) {
    parts.push('kept meals that use food already bought');
  }

  if (parts.length === 0) {
    return 'Small adjustments to stay closer to your targets.';
  }
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

/**
 * Replan the rest of the month after a log.
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
  const daysRemaining = remainingDates.length;
  const daysElapsed = elapsedDates.length;

  // Prefer real log for dates that have entries; otherwise assume past planned days were eaten.
  const loggedDates = new Set((log || []).map((e) => e.date));
  let consumedMonth = emptyTotals();
  for (const date of elapsedDates) {
    if (loggedDates.has(date)) {
      const dayLog = (log || []).filter((e) => e.date === date);
      for (const entry of dayLog) {
        const r = loggedNutrients(entry.items, foodsById);
        consumedMonth = addTotals(consumedMonth, r.totals);
      }
    } else {
      const { totals } = dayTotals(plan.days[date], recipesById, foodsById);
      consumedMonth = addTotals(consumedMonth, totals);
    }
  }
  // Today's log (the meal that triggered replan).
  let recentTotals = emptyTotals();
  for (const entry of log || []) {
    if (entry.date === fromDate) {
      const r = loggedNutrients(entry.items, foodsById);
      recentTotals = addTotals(recentTotals, r.totals);
      consumedMonth = addTotals(consumedMonth, r.totals);
    }
  }

  const adjTargets = adjustedTargetsForRest(
    targets,
    consumedMonth,
    daysElapsed,
    daysRemaining,
    recentTotals,
  );

  // Slots already logged today stay fixed (user ate them); others may change.
  const loggedTodaySlots = new Set();
  // We do not track slot on log entries; treat today's planned slots as open
  // except we rebuild all remaining days including today for simplicity,
  // since the log is additive nutrients, not a slot replacement.

  const newPlan = {
    month: plan.month,
    days: { ...Object.fromEntries(Object.entries(plan.days).map(([d, m]) => [d, { ...m }])) },
  };

  const keptForBought = [];

  for (const date of remainingDates) {
    // If today has a log, still replan the meal slots (the log is extra /
    // replacement nutrients already in consumedMonth). Rebuild the day.
    const day = fillDay(recipes, adjTargets, foodsById, boughtSet);
    // Prefer keeping previous recipes that use bought food when score is close.
    const prev = plan.days[date];
    const merged = { ...day };
    for (const slot of SLOTS) {
      const prevId = prev?.[slot];
      const prevRecipe = recipesById.get(prevId);
      if (prevRecipe && recipeUsesBought(prevRecipe, boughtSet)) {
        // Keep if it does not worsen score much versus the fresh pick.
        let soFar = emptyTotals();
        for (const s of SLOTS) {
          if (s === slot) break;
          const id = merged[s];
          const rec = recipesById.get(id);
          if (rec) soFar = addTotals(soFar, recipeNutrients(rec, foodsById).totals);
        }
        const keepTotals = addTotals(soFar, recipeNutrients(prevRecipe, foodsById).totals);
        const pickRecipeObj = recipesById.get(day[slot]);
        const pickTotals = addTotals(soFar, recipeNutrients(pickRecipeObj, foodsById).totals);
        const keepScore = scoreAgainstTargets(keepTotals, adjTargets).score;
        const pickScore = scoreAgainstTargets(pickTotals, adjTargets).score;
        if (keepScore <= pickScore + 0.5) {
          merged[slot] = prevId;
          keptForBought.push({ date, slot, recipeId: prevId });
        }
      }
    }
    newPlan.days[date] = merged;
  }

  const changed = [];
  for (const date of remainingDates) {
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

  const oldAvg = averageDailyTotals(plan, recipesById, foodsById, fromDate);
  const newAvg = averageDailyTotals(newPlan, recipesById, foodsById, fromDate);
  const effects = effectOnTargets(oldAvg, newAvg, adjTargets.map((t, i) => ({
    ...t,
    originalDaily: targets[i].daily,
  })));

  // Unreachable: any adjusted target still badly unmet on the new average.
  let unreachable = false;
  for (const t of adjTargets) {
    const v = newAvg[t.nutrient] ?? 0;
    if (t.kind === 'max' && v > t.daily * 1.15) unreachable = true;
    if (t.kind === 'min' && v < t.daily * 0.85) unreachable = true;
  }
  // Also: if original targets are impossible even on a fresh build for one day
  const sampleDay = fillDay(recipes, targets, foodsById, boughtSet);
  const sample = dayTotals(sampleDay, recipesById, foodsById);
  const sampleScore = scoreAgainstTargets(sample.totals, targets);
  if (sampleScore.unmet >= targets.length) unreachable = true;

  const nothingToChange = changed.length === 0;

  const reason = buildReason({
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
    adjustedTargets: adjTargets,
    consumedMonth,
    recentTotals,
  };
}

export { SLOTS };
