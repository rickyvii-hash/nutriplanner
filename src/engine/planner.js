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
 * capBySlot: { slot: { nutrient: value } } swap only for a meal with less of that nutrient (maxima).
 * floorBySlot: { slot: { nutrient: value, keepId } } a meal that differs from keepId must have
 * more of that nutrient than it had; keepId itself (the planned meal) may stay unchanged (minima).
 * upperBounds: { nutrient: maxDayTotal } optional ceiling on the summed day totals; combinations
 * that exceed any bound are skipped. When given and nothing fits, returns null.
 * lowerBounds: { nutrient: minDayTotal } optional floor on the summed day totals, so a swapped
 * day never drops below what it had before.
 */
export function fillDay(
  recipes, targets, foodsById, boughtSet, avoidBySlot = {}, capBySlot = {}, floorBySlot = {},
  upperBounds = null, lowerBounds = null,
) {
  const options = SLOTS.map((slot) => {
    const all = recipesForSlot(recipes, slot);
    if (all.length === 0) throw new Error(`No recipes for slot ${slot}`);
    const cap = capBySlot[slot];
    const floor = floorBySlot[slot];
    const totalsOf = new Map(all.map((r) => [r.id, recipeNutrients(r, foodsById).totals]));
    let allowed = all;
    if (cap) {
      allowed = allowed.filter((r) => Object.entries(cap).every(([n, v]) => totalsOf.get(r.id)[n] <= v + 1e-9));
    }
    if (floor) {
      // Keeping the same meal is not a swap, so it may stay; any other recipe must
      // carry strictly more of the shortfall nutrient to be worth the change.
      const keepId = floor.keepId;
      allowed = allowed.filter((r) => Object.entries(floor).every(([n, v]) => {
        if (n === 'keepId') return true;
        const value = totalsOf.get(r.id)[n];
        return r.id === keepId ? value >= v - 1e-9 : value > v + 1e-9;
      }));
    }
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
  const withinBounds = (totals) => !upperBounds
    || Object.entries(upperBounds).every(([n, max]) => totals[n] <= max + 1e-9);
  const aboveFloors = (totals) => !lowerBounds
    || Object.entries(lowerBounds).every(([n, min]) => totals[n] >= min - 1e-9);
  const walk = (i, soFar, bonus) => {
    if (i === options.length) {
      if (!withinBounds(soFar) || !aboveFloors(soFar)) return;
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
  if (best === null) return null;
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

/** True when a log entry only records skipped planned meals (never counted as eaten). */
export function isSkipEntry(entry) {
  return Array.isArray(entry?.skipped) && entry.skipped.length > 0
    && (!entry.items || entry.items.length === 0);
}

/** Nutrients already logged on or before `throughDate` (inclusive). Skipped meals add nothing. */
export function consumedFromLog(log, foodsById, throughDate = null) {
  let totals = emptyTotals();
  for (const entry of log || []) {
    if (throughDate && entry.date > throughDate) continue;
    if (isSkipEntry(entry)) continue;
    const items = entry.items || [];
    if (items.length === 0) continue;
    const r = loggedNutrients(items, foodsById);
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

/** Shown when the user skips a meal but the profile has no minimum targets to raise. */
export const SKIP_NO_MIN_REASON = 'Skipping a meal does not affect your maximum targets.';

/** "the next 1 day is" / "the next 3 days are": the verb and the noun agree. */
function nextDaysPhrase(n) {
  return n === 1 ? 'the next 1 day is' : `the next ${n} days are`;
}

/**
 * A target moved the wrong way when a maximum went up or a minimum went down.
 * Used to keep the reason honest about a replacement that is not an improvement.
 */
function movedAway(effect) {
  const change = effectChange(effect.nutrient, effect);
  if (change === 0) return 0;
  if (effect.kind === 'max') return change > 0 ? change : 0;
  return change < 0 ? change : 0;
}

/** The target (other than the named one) that moved furthest the wrong way, or null. */
function worstOtherTarget(effects, targets, exceptNutrient) {
  let worst = null;
  for (const e of effects) {
    if (e.nutrient === exceptNutrient) continue;
    const away = movedAway(e);
    if (away === 0) continue;
    const target = targets.find((t) => t.nutrient === e.nutrient);
    const daily = target?.daily || e.daily || 1;
    const score = Math.abs(away) / daily;
    if (!worst || score > worst.score) worst = { effect: e, change: away, score };
  }
  return worst;
}

function buildReason({
  effects, changed, keptForBought, unreachable, nothingToChange, targets, recentTotals,
  skippedNames = [], shortfall = {}, skipNoMin = false, windowDayCount = 0,
  replacements = [], replacementOver = {}, replacementUnder = {}, replacementPrimary = null,
}) {
  if (skipNoMin) return SKIP_NO_MIN_REASON;
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
    const change = effectChange(over.t.nutrient, e);
    const less = change < 0 ? ` (about ${formatAmount(over.t.nutrient, Math.abs(change))} less per day on average)` : '';
    return `${closestNote}You logged ${formatAmount(over.t.nutrient, over.recent)} of ${nutrientWords(over.t.nutrient)} today `
      + `(goal: max ${formatAmount(over.t.nutrient, over.t.daily)}), so ${nextDaysPhrase(daysTouched)} lower in `
      + `${nutrientWords(over.t.nutrient)}${less}.${keptNote}`;
  }

  // A planned meal was swapped for another recipe: say what the swap did, quoting the
  // same rounded per-day numbers the Effect rows show. If it moved a target the wrong
  // way, the reason says so plainly instead of calling it an improvement.
  if (replacements.length > 0 && replacementPrimary) {
    const key = replacementPrimary.nutrient;
    const effect = effects.find((x) => x.nutrient === key);
    const change = effectChange(key, effect);
    const first = replacements[0];
    const what = replacements.length === 1
      ? `You swapped ${first.slot} for ${first.name}`
      : `You swapped ${replacements.length} meals`;
    const than = replacements.length === 1 ? `the planned ${first.slot}` : 'the planned meals';
    const amount = replacementPrimary.kind === 'max'
      ? `about ${formatAmount(key, replacementOver[key] || 0)} more ${nutrientWords(key)} than ${than}`
      : `about ${formatAmount(key, replacementUnder[key] || 0)} less than ${than}`;
    const quoted = `about ${formatAmount(key, Math.abs(change))} ${change < 0 ? 'less' : 'more'} per day on average`;
    const worseOther = worstOtherTarget(effects, targets, key);
    const otherNote = worseOther
      ? ` ${nutrientWords(worseOther.effect.nutrient)} also moves about ${formatAmount(worseOther.effect.nutrient, Math.abs(worseOther.change))} ${worseOther.change > 0 ? 'more' : 'less'} per day on average, which is worse for that ${worseOther.effect.kind === 'max' ? 'maximum' : 'minimum'}.`
      : '';
    if (change === 0) {
      return `${closestNote}${what}, which has ${amount}. The next ${daysTouched} day${daysTouched === 1 ? '' : 's'} changed, but they average the same on that target.${keptNote}`;
    }
    const improves = replacementPrimary.kind === 'max' ? change < 0 : change > 0;
    if (!improves) {
      return `${closestNote}${what}, which has ${amount}. The next ${daysTouched} day${daysTouched === 1 ? '' : 's'} changed, but they average ${quoted}, which is worse for that ${replacementPrimary.kind === 'max' ? 'maximum' : 'minimum'}.${otherNote}${keptNote}`;
    }
    return `${closestNote}${what}, which has ${amount}, so ${nextDaysPhrase(daysTouched)} ${replacementPrimary.kind === 'max' ? 'lower' : 'higher'} in ${nutrientWords(key)} (${quoted}).${otherNote}${keptNote}`;
  }

  // Skipped meals under a minimum: raise the next days and quote the real numbers.
  // Prefer calories when that was part of the shortfall (clearest for Recovery/Athlete);
  // otherwise the minimum that fell furthest short relative to its daily value.
  let under = null;
  for (const t of targets) {
    if (t.kind !== 'min') continue;
    const missed = shortfall[t.nutrient] || 0;
    if (missed <= 0) continue;
    const ratio = missed / t.daily;
    const prefer = t.nutrient === 'kcal' ? 2 : 0;
    const score = ratio + prefer;
    if (!under || score > under.score) under = { t, missed, ratio, score };
  }
  if (under && skippedNames.length > 0) {
    // Quote the real change shown in the effects (rounded after - rounded before),
    // not the intended make-up: the numbers on the same screen must agree.
    const dayEffect = effects.find((e) => e.nutrient === under.t.nutrient);
    const change = effectChange(under.t.nutrient, dayEffect);
    const more = change > 0
      ? ` (about ${formatAmount(under.t.nutrient, change)} more per day on average)`
      : '';
    const names = skippedNames.length === 1
      ? skippedNames[0]
      : `${skippedNames.slice(0, -1).join(', ')} and ${skippedNames[skippedNames.length - 1]}`;
    // Honest about a shortfall the window could not absorb: say how many days had room.
    const notSpread = windowDayCount > 0 && daysTouched < windowDayCount / 2
      ? ` Only ${daysTouched} of the next ${windowDayCount} days had room for a bigger meal, so part of the shortfall is not made up.`
      : '';
    return `${closestNote}You skipped ${names} today `
      + `(about ${formatAmount(under.t.nutrient, under.missed)} of your ${formatAmount(under.t.nutrient, under.t.daily)} minimum), `
      + `so ${nextDaysPhrase(daysTouched)} higher in ${nutrientWords(under.t.nutrient)}${more}.${notSpread}${keptNote}`;
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

/** Decimals the Effect row on Plan updated prints for a per-day average. */
function effectDecimals(key) {
  return key === 'kcal' || key === 'sodium' ? 0 : 1;
}

/** The number the Effect row prints for a per-day average (same rounding as the screen). */
function effectValue(key, v) {
  return Number(Number(v || 0).toFixed(effectDecimals(key)));
}

/**
 * Change quoted in the reason: rounded(after) - rounded(before), i.e. exactly the
 * arithmetic of the two numbers the Effect row shows, never a separately rounded float.
 */
export function effectChange(key, effect) {
  if (!effect) return 0;
  return effectValue(key, effect.after) - effectValue(key, effect.before);
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
  // Skipped meals never count as eaten.
  const eatenDates = new Set(
    (log || []).filter((e) => !isSkipEntry(e) && (e.items || []).length > 0).map((e) => e.date),
  );
  let consumedMonth = emptyTotals();
  for (const date of elapsedDates) {
    if (eatenDates.has(date)) {
      for (const entry of (log || []).filter((e) => e.date === date && !isSkipEntry(e))) {
        const items = entry.items || [];
        if (items.length === 0) continue;
        consumedMonth = addTotals(consumedMonth, loggedNutrients(items, foodsById).totals);
      }
    } else {
      consumedMonth = addTotals(consumedMonth, dayTotals(plan.days[date], recipesById, foodsById).totals);
    }
  }
  // What was logged on the log date (food eaten — skipped meals add nothing here).
  let recentTotals = emptyTotals();
  for (const entry of log || []) {
    if (entry.date !== fromDate || isSkipEntry(entry)) continue;
    const items = entry.items || [];
    if (items.length === 0) continue;
    const r = loggedNutrients(items, foodsById);
    recentTotals = addTotals(recentTotals, r.totals);
    consumedMonth = addTotals(consumedMonth, r.totals);
  }

  // Planned meals marked skipped today: their known nutrients are the shortfall for minima.
  const skippedIds = [];
  for (const entry of log || []) {
    if (entry.date !== fromDate || !Array.isArray(entry.skipped)) continue;
    for (const id of entry.skipped) {
      if (id && !skippedIds.includes(id)) skippedIds.push(id);
    }
  }
  const skippedNames = skippedIds.map((id) => recipesById.get(id)?.name || id);
  const shortfall = {};
  for (const t of targets) {
    if (t.kind !== 'min') continue;
    let sum = 0;
    for (const id of skippedIds) {
      const recipe = recipesById.get(id);
      if (!recipe) continue;
      const r = recipeNutrients(recipe, foodsById);
      if (!r.unknown[t.nutrient]) sum += r.totals[t.nutrient];
    }
    if (sum > 0) shortfall[t.nutrient] = sum;
  }

  // Meals replaced on the log date: what was eaten instead of the planned meal.
  // The difference from the plan feeds the same window rules as an off-plan meal,
  // so a richer swap is made up for on the next days and a lighter one is topped up.
  const replacements = [];
  const replacementOver = {};
  const replacementUnder = {};
  for (const entry of log || []) {
    if (entry.date !== fromDate || !Array.isArray(entry.replaced)) continue;
    for (const r of entry.replaced) {
      const recipe = recipesById.get(r?.recipeId);
      const planned = recipesById.get(plan.days?.[fromDate]?.[r?.slot]);
      if (!recipe || !planned) continue;
      replacements.push({
        slot: r.slot,
        recipeId: recipe.id,
        name: recipe.name,
        plannedId: planned.id,
        plannedName: planned.name,
      });
      const before = recipeNutrients(planned, foodsById);
      const after = recipeNutrients(recipe, foodsById);
      for (const t of targets) {
        const n = t.nutrient;
        // An unknown value is never treated as a difference of zero.
        if (before.unknown[n] || after.unknown[n]) continue;
        const delta = after.totals[n] - before.totals[n];
        if (t.kind === 'max' && delta > 0) replacementOver[n] = (replacementOver[n] || 0) + delta;
        if (t.kind === 'min' && delta < 0) replacementUnder[n] = (replacementUnder[n] || 0) - delta;
      }
    }
  }
  // A swap that leaves the day lower on a minimum raises the next days like a skip.
  for (const [n, v] of Object.entries(replacementUnder)) {
    shortfall[n] = (shortfall[n] || 0) + v;
  }
  // The shortfall nutrient a swap must improve: calories when they fell short,
  // otherwise the minimum that fell furthest short relative to its daily value.
  let floorNutrient = null;
  let floorScore = -Infinity;
  for (const t of targets) {
    if (t.kind !== 'min' || !shortfall[t.nutrient]) continue;
    const score = shortfall[t.nutrient] / t.daily + (t.nutrient === 'kcal' ? 2 : 0);
    if (score > floorScore) {
      floorScore = score;
      floorNutrient = t.nutrient;
    }
  }
  const hasMinTarget = targets.some((t) => t.kind === 'min');
  const skipNoMin = skippedIds.length > 0
    && Object.keys(shortfall).length === 0
    && !hasMinTarget
    && Object.keys(recentTotals).every((k) => !recentTotals[k]);

  // When the only action was skipping and there are no minimums, leave the plan alone.
  if (skipNoMin) {
    return {
      plan: {
        month: plan.month,
        days: Object.fromEntries(Object.entries(plan.days).map(([d, m]) => [d, { ...m }])),
      },
      changed: [],
      effects: effectOnTargets(
        averageDailyTotals(plan, recipesById, foodsById, allDates.filter((d) => d > fromDate).slice(0, WINDOW_DAYS)),
        averageDailyTotals(plan, recipesById, foodsById, allDates.filter((d) => d > fromDate).slice(0, WINDOW_DAYS)),
        targets.map((t) => ({ ...t, originalDaily: t.daily })),
      ),
      reason: SKIP_NO_MIN_REASON,
      unreachable: false,
      nothingToChange: true,
      keptForBought: [],
      adjustedTargets: targets,
      consumedMonth,
      recentTotals,
      windowDates: [],
      skipNoMin: true,
    };
  }

  const windowDates = allDates.filter((d) => d > fromDate).slice(0, WINDOW_DAYS);
  const windowSet = new Set(windowDates);

  // The primary raised minimum: the one whose skipped shortfall is the largest relative
  // to its daily value. Only this nutrient gets an upper bound; the others must simply
  // not go down (one ceiling is easy to meet, four at once almost never are).
  let primaryNutrient = null;
  let primaryTarget = null;
  let primaryRatio = -Infinity;
  for (const t of targets) {
    if (t.kind !== 'min' || !shortfall[t.nutrient]) continue;
    const ratio = shortfall[t.nutrient] / t.daily;
    if (ratio > primaryRatio) {
      primaryRatio = ratio;
      primaryNutrient = t.nutrient;
      primaryTarget = t;
    }
  }

  // Over a maximum today: make it up over the window by lowering each window day
  // below what it had planned, by overshoot / window length.
  const overshoot = {};
  for (const t of targets) {
    const recent = recentTotals[t.nutrient] || 0;
    if (t.kind === 'max' && recent > t.daily) overshoot[t.nutrient] = recent - t.daily;
  }
  // A swap richer than the planned meal also lowers the following days.
  // Take the larger of the daily-max overshoot and the plan-relative excess — never
  // add them, or a rich swap that also busts the daily max would be counted twice.
  for (const [n, v] of Object.entries(replacementOver)) {
    overshoot[n] = Math.max(overshoot[n] || 0, v);
  }
  // The nutrient the replacement reason names: the maximum the swap pushed up most
  // (calories count for more), otherwise the minimum it lowered most.
  let replacementPrimary = null;
  if (replacements.length > 0) {
    for (const t of targets) {
      if (t.kind !== 'max' || !replacementOver[t.nutrient]) continue;
      const score = replacementOver[t.nutrient] / t.daily;
      if (!replacementPrimary || score > replacementPrimary.score) {
        replacementPrimary = { nutrient: t.nutrient, kind: 'max', score };
      }
    }
    if (!replacementPrimary) {
      for (const t of targets) {
        if (t.kind !== 'min' || !replacementUnder[t.nutrient]) continue;
        const score = replacementUnder[t.nutrient] / t.daily + (t.nutrient === 'kcal' ? 2 : 0);
        if (!replacementPrimary || score > replacementPrimary.score) {
          replacementPrimary = { nutrient: t.nutrient, kind: 'min', score };
        }
      }
    }
  }

  // Logged on the last planned day and over a maximum: no window is left to adjust.
  const lastDayOverMax = windowDates.length === 0 && Object.keys(overshoot).length > 0;
  const adjustedMax = windowDates.length > 0 && Object.keys(overshoot).length > 0;
  const adjustedMin = windowDates.length > 0 && Object.keys(shortfall).length > 0;
  const adjusted = adjustedMax || adjustedMin;
  const targetsForDay = (date) => targets.map((t) => {
    const out = { ...t, originalDaily: t.daily };
    if (adjustedMax && overshoot[t.nutrient]) {
      const planned = dayTotals(plan.days[date], recipesById, foodsById).totals[t.nutrient];
      out.daily = Math.max(t.daily * 0.4, Math.min(t.daily, planned) - overshoot[t.nutrient] / windowDates.length);
    }
    if (adjustedMin && shortfall[t.nutrient]) {
      // Raise the day's minimum by shortfall / window, capped at +25% of the daily value.
      const bump = Math.min(shortfall[t.nutrient] / windowDates.length, t.daily * 0.25);
      out.daily = t.daily + bump;
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
      // Maxima: only swap towards less of the nutrient that went over.
      // Minima: only swap towards more of the nutrient that fell short.
      const caps = {};
      const floors = {};
      if (adjustedMax) {
        for (const slot of SLOTS) {
          const old = recipesById.get(plan.days[date]?.[slot]);
          if (!old) continue;
          const totals = recipeNutrients(old, foodsById).totals;
          caps[slot] = Object.fromEntries(Object.keys(overshoot).map((n) => [n, totals[n]]));
        }
      }
      if (adjustedMin && floorNutrient) {
        // A swapped meal must have more of the shortfall nutrient the reason names
        // (calories when that fell short), never less than the meal it replaces.
        for (const slot of SLOTS) {
          const old = recipesById.get(plan.days[date]?.[slot]);
          if (!old) continue;
          const totals = recipeNutrients(old, foodsById).totals;
          floors[slot] = { [floorNutrient]: totals[floorNutrient], keepId: old.id };
        }
      }
      // Raised minimums: a changed day must not go below what it had planned for any
      // of them, and only the primary one gets a ceiling (the ceiling is the day's
      // planned total, or the raised minimum if higher, plus a multiple of the day
      // bump; the multiple is widened only if nothing fits). Bounding all four at
      // once left almost no day changeable; the others just must not go down.
      const plannedTotals = adjustedMin
        ? dayTotals(plan.days[date], recipesById, foodsById).totals
        : null;
      const lowerBounds = {};
      if (adjustedMin) {
        for (const t of targets) {
          if (t.kind !== 'min' || !shortfall[t.nutrient]) continue;
          // The primary nutrient must really rise; the others must only not fall.
          lowerBounds[t.nutrient] = t.nutrient === primaryNutrient
            ? (plannedTotals[t.nutrient] ?? 0) + 1e-6
            : (plannedTotals[t.nutrient] ?? 0);
        }
      }
      let day = null;
      let primaryCeiling = null;
      if (adjustedMin && primaryNutrient) {
        const bump = Math.min(shortfall[primaryNutrient] / windowDates.length, primaryTarget.daily * 0.25);
        const base = Math.max(plannedTotals[primaryNutrient] ?? 0, primaryTarget.daily + bump);
        for (const factor of [1.5, 3, 6, 12]) {
          const ceiling = base + factor * bump;
          day = fillDay(
            recipes, dayTargets, foodsById, boughtSet, avoid, caps, floors,
            { [primaryNutrient]: ceiling }, lowerBounds,
          );
          if (day) {
            primaryCeiling = ceiling;
            break;
          }
        }
      } else {
        day = fillDay(recipes, dayTargets, foodsById, boughtSet, avoid, caps, floors);
      }
      // No combination fits even after the retries: leave this day as it was.
      if (!day) continue;
      const prev = plan.days[date];
      let merged = { ...day };
      const keptHere = [];
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
          keptHere.push({ date, slot, recipeId: prevRecipe.id });
        }
      }
      // Keeping a bought meal must not undo the raised minimums or break the ceiling.
      if (adjustedMin) {
        const totals = dayTotals(merged, recipesById, foodsById).totals;
        const breaksMinimum = Object.entries(lowerBounds)
          .some(([n, min]) => totals[n] < min - 1e-9);
        const breaksCeiling = primaryCeiling !== null
          && totals[primaryNutrient] > primaryCeiling + 1e-9;
        if (breaksMinimum || breaksCeiling) merged = { ...day };
        else keptForBought.push(...keptHere);
      } else {
        keptForBought.push(...keptHere);
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
  // Effects are averaged over the days that really changed, so the "per day on average"
  // number on the same screen can agree with the reason and not be diluted by days left alone.
  const changedDates = [...new Set(changed.map((c) => c.date))].sort();
  const effectDates = changedDates.length > 0 ? changedDates : compareDates;
  const oldAvg = averageDailyTotals(plan, recipesById, foodsById, effectDates);
  const newAvg = averageDailyTotals(newPlan, recipesById, foodsById, effectDates);
  const effects = effectOnTargets(oldAvg, newAvg, targets.map((t) => ({ ...t, originalDaily: t.daily })));

  // Unreachable: a target is still badly missed on the new average over the whole window.
  const windowAvg = averageDailyTotals(newPlan, recipesById, foodsById, compareDates);
  let unreachable = false;
  for (const t of targets) {
    const v = windowAvg.totals[t.nutrient] ?? 0;
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
      skippedNames,
      shortfall,
      skipNoMin: false,
      windowDayCount: windowDates.length,
      replacements,
      replacementOver,
      replacementUnder,
      replacementPrimary,
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
    shortfall,
    skippedNames,
    replacements,
    replacementPrimary,
  };
}

export { SLOTS };
