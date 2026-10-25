import { todayIso } from '../engine/planner.js';
import { activeSlots, slotLabel } from '../engine/meal_prefs.js';
import { foodNutrients, formatNutrient, sumNutrients } from '../engine/nutrients.js';
import { displayFoodName } from '../engine/food_display.js';
import { el, escapeHtml, nutrientLabel, nutrientUnit } from './dom.js';
import { openRecipeDetail } from './recipe_detail.js';
import { createReplacePicker } from './replace_picker.js';
import {
  parsePortion,
  newLogDraft,
  addRecipeGroup,
  skipRecipeGroup,
  draftSavePayload,
  savedSlotOutcomes,
} from './log.js';
import {
  removeLogEntry,
  updateLogEntryItems,
  convertLogEntryToSkipped,
  convertSkippedEntryToEaten,
  findPlannedRecipeForEntry,
  applyLogCorrection,
} from '../log_corrections.js';

/** Every status a day-screen meal row can show. */
export const MEAL_STATUS_LABELS = {
  planned: 'Planned',
  eaten: 'Eaten',
  skipped: 'Skipped',
  replaced: 'Replaced',
};

/**
 * The save payload of one day-screen action for one planned meal. It is built with
 * the same draft helpers the Log screen uses, so "Ate it" and "Skipped" save exactly
 * the log entry a Log save would: one meal, the same payload shape.
 * Returns null for an unknown action or a missing recipe.
 */
export function dayMealSavePayload(recipe, slot, action) {
  if (!recipe) return null;
  const draft = newLogDraft();
  if (action === 'eat') addRecipeGroup(draft, recipe, slot || null);
  else if (action === 'skip') skipRecipeGroup(draft, recipe.id, slot || null);
  else return null;
  return draftSavePayload(draft);
}

/**
 * The row model of one meal of the selected day: its status from the saved log and
 * the actions the existing rules allow. A meal with no saved outcome is Planned and
 * offers Ate it / Skipped / Replace while the day is today or ahead. A day already
 * over cannot receive a new outcome, but a saved one can still be Undo or changed
 * through the same correction rules the Logged meals card uses. A replaced meal can
 * only be undone: it is redone through Replace, never flipped to a skip.
 */
export function mealRowModel({
  date,
  slot,
  recipe = null,
  log = [],
  planDay = null,
  recipesById = null,
  outcomes = null,
  today = todayIso(),
} = {}) {
  const saved = outcomes || savedSlotOutcomes(log, date, planDay, recipesById);
  const outcome = saved.get(slot) || null;
  const status = outcome?.kind || 'planned';
  const planRecipe = recipe
    || (outcome?.recipeId && recipesById?.get ? recipesById.get(outcome.recipeId) : null)
    || null;
  const past = Boolean(date && today && date < today);
  const open = !past;
  const entryIndex = Number.isInteger(outcome?.index) ? outcome.index : null;

  const row = {
    slot,
    date,
    past,
    status,
    statusLabel: MEAL_STATUS_LABELS[status] || MEAL_STATUS_LABELS.planned,
    entryIndex,
    recipeId: outcome?.recipeId || planRecipe?.id || null,
    canEat: false,
    canSkip: false,
    canReplace: false,
    canUndo: false,
    canChange: false,
    changeTo: null,
  };

  if (!outcome) {
    const hasRecipe = Boolean(planRecipe);
    row.canEat = open && hasRecipe;
    row.canSkip = open && hasRecipe;
    row.canReplace = open && hasRecipe;
    return row;
  }

  row.canUndo = entryIndex !== null;
  if (status === 'eaten') {
    row.canChange = row.canUndo;
    row.changeTo = 'skipped';
  } else if (status === 'skipped' && planRecipe) {
    row.canChange = row.canUndo;
    row.changeTo = 'eaten';
  }
  return row;
}

/**
 * The one-shot hand-off from the shopping list's Swap meal: { date, slot }.
 * Returns { date, slot } when the picker should open on the day screen, or null
 * when that meal is no longer planned, is already logged, or its day is over.
 * The day screen still renders in every case; the picker just does not open.
 */
export function replaceForwardSlot({
  openReplace,
  plan,
  log = [],
  date,
  recipesById = null,
  today = todayIso(),
} = {}) {
  if (!openReplace || typeof openReplace !== 'object') return null;
  if (!date || openReplace.date !== date) return null;
  const slot = openReplace.slot;
  if (typeof slot !== 'string' || !slot) return null;
  const planDay = plan?.days?.[date];
  // A slot the day no longer holds (a replan removed it) has nothing to replace.
  if (!planDay || !planDay[slot]) return null;
  // A day already over accepts no new outcome, so no picker opens on it.
  if (today && date < today) return null;
  // A meal with a saved outcome is no longer the planned meal to swap.
  if (savedSlotOutcomes(log, date, planDay, recipesById).get(slot)) return null;
  return { date, slot };
}

/** True when a saved entry only records skipped planned meals. */
function isSkippedEntry(entry) {
  return Array.isArray(entry?.skipped) && entry.skipped.length > 0
    && (!entry.items || entry.items.length === 0);
}

/**
 * The headline of a saved log entry. A planned meal is named by its slot
 * ("Eaten · breakfast"), so food eaten outside the plan never hides which meal
 * it was; that food keeps its own "Extra / outside meals" entry. `recipe` is the
 * planned recipe already matched for the entry, if any.
 */
export function logEntryKind(entry, recipe = null) {
  if (isSkippedEntry(entry)) return 'Skipped';
  if (Array.isArray(entry?.replaced) && entry.replaced.length > 0) return 'Eaten · replaced';
  const hasEaten = Array.isArray(entry?.eaten) && entry.eaten.length > 0;
  // An extra with no planned meal is food eaten outside the plan, not a slot.
  if (entry?.extra && !hasEaten) return 'Extra / outside meals';
  if (!hasEaten) return 'Eaten';
  const slot = entry.eaten.find((info) => info?.slot)?.slot || recipe?.slot || null;
  return slot ? `Eaten · ${slotLabel(slot)}` : 'Eaten';
}

/**
 * Text for a daily nutrient value: "n/a" when nothing is known, "≥12.2" when a meal
 * of the day has no value for it (a partial sum is never printed as certain).
 */
export function dayValueText(result, nutrient) {
  const decimals = nutrient === 'kcal' || nutrient === 'sodium' ? 0 : 1;
  return formatNutrient(result, nutrient, decimals);
}

/**
 * The one-line summary above the day's meal list: how many planned meals already
 * have a saved outcome. `slots` is the day's own list of on slots (the day screen
 * passes exactly the slots its rows show), and `outcomes` is the map returned by
 * savedSlotOutcomes, the same source the row status chips read. Eaten and replaced
 * meals count as logged; a skipped meal is counted apart, never as eaten.
 * Returns { total, logged, skipped, text }.
 */
export function dayMealProgress({ planDay = null, slots = null, outcomes = null } = {}) {
  const planned = (Array.isArray(slots) ? slots : Object.keys(planDay || {}))
    .filter((slot) => planDay?.[slot]);
  let logged = 0;
  let skipped = 0;
  for (const slot of planned) {
    const kind = outcomes?.get?.(slot)?.kind || null;
    if (kind === 'eaten' || kind === 'replaced') logged += 1;
    else if (kind === 'skipped') skipped += 1;
  }
  const text = skipped > 0
    ? `${logged} of ${planned.length} logged, ${skipped} skipped`
    : `${logged} of ${planned.length} meals logged`;
  return { total: planned.length, logged, skipped, text };
}

/**
 * What the day's progress bars show, and the line that explains it.
 * Progress is what was actually logged for the day: planned meals are a plan,
 * not food already eaten, so they are never counted here. A skipped meal is not
 * eaten either. With an empty (or skipped-only) log every total is 0.
 * Returns { result, note } where result is shaped like sumNutrients.
 */
export function dayProgressTotals(dayMeals, dayLog, recipesById, foodsById) {
  const parts = [];
  let hasSkipped = false;
  for (const entry of dayLog || []) {
    for (const it of entry.items || []) {
      const food = foodsById.get(it.foodId);
      if (food) parts.push(foodNutrients(food, it.grams));
    }
    if ((entry.skipped || []).length > 0) hasSkipped = true;
  }

  if (parts.length > 0) {
    return { result: sumNutrients(parts), note: 'Based on the food you logged for this day.' };
  }
  if (hasSkipped) {
    return {
      result: sumNutrients([]),
      note: 'Progress is based on what was logged: skipped meals are not counted as eaten. Nothing eaten logged yet.',
    };
  }
  return {
    result: sumNutrients([]),
    note: 'Progress is based on what was logged: nothing yet. Planned meals count only once you log them.',
  };
}

function progressClass(kind, value, daily) {
  if (daily <= 0) return '';
  const ratio = value / daily;
  if (kind === 'max') {
    if (ratio >= 1) return 'bar-warn';
    if (ratio >= 0.85) return 'bar-near';
    return 'bar-ok';
  }
  if (ratio >= 1) return 'bar-ok';
  if (ratio >= 0.7) return 'bar-near';
  return 'bar-low';
}

export function renderPlan(ctx) {
  const { state, recipesById, foodsById } = ctx;
  const root = el(`<div class="screen screen-plan"></div>`);
  // A one-shot hand-off from the shopping list is read here, once, even when the
  // plan or that meal is gone: it then leaves no trace and shows no error.
  const openReplace = ctx.openReplace && typeof ctx.openReplace === 'object'
    ? ctx.openReplace
    : null;
  ctx.openReplace = null;

  const header = el(`<header class="brand brand-compact">
    <span class="logo" aria-hidden="true">🌿</span>
    <div><h1>Month plan</h1><p>Adaptive meal planning that flexes with real life.</p></div>
  </header>`);
  if (state.plan) {
    // A clear way back to the start screen, with a confirmation before anything is erased.
    const reset = el(`<button type="button" class="btn-text" data-action="start-over">Start over</button>`);
    reset.addEventListener('click', () => ctx.startOver?.());
    header.appendChild(reset);
  }
  root.appendChild(header);

  // A one-line note after a log correction that needed no plan change.
  if (ctx.logNotice) {
    root.appendChild(el(`<section class="card notice-card" data-log-notice>
      <p>${escapeHtml(ctx.logNotice)}</p>
    </section>`));
    ctx.logNotice = null;
  }

  if (!state.plan) {
    root.appendChild(el(`<section class="card empty-state">
      <h2>No plan yet</h2>
      <p class="muted">Choose a profile and tap <strong>Build my month plan</strong> on the Targets screen.</p>
      <button type="button" class="btn-primary" data-go="targets">Go to Targets</button>
    </section>`));
    root.querySelector('[data-go="targets"]').addEventListener('click', () => ctx.navigate('targets'));
    root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));
    return root;
  }

  const summaryCard = el(`<section class="card summary-cta">
    <div class="row">
      <div>
        <h3>For your doctor</h3>
        <p class="muted tiny">A printable page with your targets and the meals you logged.</p>
      </div>
      <button type="button" class="btn-secondary btn-small" data-action="summary">Summary for your doctor</button>
    </div>
  </section>`);
  summaryCard.querySelector('[data-action="summary"]').addEventListener('click', () => ctx.navigate('summary'));
  root.appendChild(summaryCard);

  const dates = Object.keys(state.plan.days).sort();
  const today = todayIso();
  let selected = ctx.selectedDate && state.plan.days[ctx.selectedDate] ? ctx.selectedDate : today;
  // The Swap meal hand-off names its own day; a date not in the plan is ignored.
  if (openReplace?.date && state.plan.days[openReplace.date]) selected = openReplace.date;
  if (!state.plan.days[selected]) selected = dates.find((d) => d >= today) || dates[0];

  const strip = el(`<section class="card day-strip-wrap"><div class="day-strip" role="list"></div></section>`);
  const stripEl = strip.querySelector('.day-strip');
  for (const date of dates) {
    const d = new Date(`${date}T12:00:00`);
    const label = d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2);
    const num = d.getDate();
    const btn = el(`<button type="button" class="day-chip${date === selected ? ' is-selected' : ''}${date === today ? ' is-today' : ''}" role="listitem" data-date="${date}" aria-label="${date}${date === today ? ' (today)' : ''}">
      <span class="dow">${label}</span><span class="dom">${num}</span>
    </button>`);
    btn.addEventListener('click', () => {
      ctx.selectedDate = date;
      ctx.refresh();
    });
    stripEl.appendChild(btn);
  }
  root.appendChild(strip);

  queueMicrotask(() => {
    stripEl.querySelector('.is-selected')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  });

  const meals = state.plan.days[selected];
  const mealCard = el(`<section class="card">
    <div class="row">
      <h2>${selected === today ? 'Today' : selected}</h2>
      <button type="button" class="btn-primary btn-small" data-action="log">Log a meal</button>
    </div>
    <p class="muted tiny meal-progress" data-day-progress></p>
    <ul class="meal-list"></ul>
    <p class="muted tiny meal-log-hint">Food outside your meals? Use Log a meal.</p>
  </section>`);
  const list = mealCard.querySelector('.meal-list');
  // Today shows only the meals that are on; other days show the slots they hold.
  const daySlots = selected === today
    ? activeSlots(state.mealPrefs).filter((slot) => meals?.[slot])
    : Object.keys(meals || {}).filter((slot) => meals[slot]);
  // One saved outcome per planned slot, read exactly as the Log screen reads it.
  const outcomes = savedSlotOutcomes(state.log, selected, meals, recipesById);
  // "N of M meals logged" reads the same saved outcomes as the row status chips.
  const progress = dayMealProgress({ planDay: meals, slots: daySlots, outcomes });
  const progressEl = mealCard.querySelector('[data-day-progress]');
  progressEl.textContent = progress.text;
  progressEl.setAttribute('data-day-progress-total', String(progress.total));
  let openPicker = null;
  const closePicker = () => {
    if (openPicker) openPicker.remove();
    openPicker = null;
  };
  // The same Replace picker the Log screen offers, inline under a meal row.
  const openReplacement = (item, slot, recipe) => {
    closePicker();
    const picker = createReplacePicker({
      slot,
      currentRecipe: recipe,
      recipes: ctx.recipes,
      foods: ctx.foods,
      foodsById,
      onPick: (payload) => saveOneMeal(payload),
    });
    item.appendChild(picker);
    openPicker = picker;
  };
  // Meal rows on this day, so a hand-off can find the slot it asks for.
  const rowsBySlot = new Map();
  // A day-screen save takes the same path the Log screen uses; only the selected
  // date changes, so a meal chosen on a day ahead is saved for that day.
  const saveOneMeal = (payload) => {
    if (!payload || typeof ctx.saveLogAndReplan !== 'function') return;
    ctx.saveLogAndReplan(payload, { date: selected });
  };
  // Undo and Change use the same correction path as the Logged meals card below.
  const correctMeal = (nextState) => {
    if (!nextState || nextState === ctx.state) return;
    applyLogCorrection(ctx, nextState, { fromDate: selected });
  };

  for (const slot of daySlots) {
    const recipe = recipesById.get(meals[slot]);
    const row = mealRowModel({ date: selected, slot, recipe, outcomes, recipesById, today });
    const item = el(`<li class="meal-item" data-slot="${escapeHtml(slot)}">
      <button type="button" class="meal-open" data-open-recipe="${escapeHtml(recipe?.id || '')}" aria-haspopup="dialog">
        <span class="meal-slot">${escapeHtml(slotLabel(slot))}</span>
        <span class="meal-name">${recipe?.icon || ''} ${escapeHtml(recipe?.name || meals[slot])}</span>
        <span class="meal-status meal-status-${escapeHtml(row.status)}" data-meal-status>${escapeHtml(row.statusLabel)}</span>
      </button>
      <div class="meal-row-actions"></div>
    </li>`);
    // Tapping a planned meal opens its detail panel in place; it never leaves the screen.
    item.querySelector('[data-open-recipe]').addEventListener('click', () => {
      if (recipe) openRecipeDetail(ctx, recipe, root);
    });

    const actions = item.querySelector('.meal-row-actions');
    if (row.canEat) {
      const btn = el(`<button type="button" class="btn-secondary btn-small" data-meal-eat="${escapeHtml(slot)}">Ate it</button>`);
      btn.addEventListener('click', () => saveOneMeal(dayMealSavePayload(recipe, slot, 'eat')));
      actions.appendChild(btn);
    }
    if (row.canSkip) {
      const btn = el(`<button type="button" class="btn-secondary btn-small" data-meal-skip="${escapeHtml(slot)}">Skipped</button>`);
      btn.addEventListener('click', () => saveOneMeal(dayMealSavePayload(recipe, slot, 'skip')));
      actions.appendChild(btn);
    }
    if (row.canReplace) {
      const btn = el(`<button type="button" class="btn-secondary btn-small" data-meal-replace="${escapeHtml(slot)}">Replace</button>`);
      btn.addEventListener('click', () => {
        if (openPicker && item.contains(openPicker)) {
          closePicker();
          return;
        }
        openReplacement(item, slot, recipe);
      });
      actions.appendChild(btn);
    }
    if (row.canUndo) {
      const btn = el(`<button type="button" class="btn-secondary btn-small" data-meal-undo="${row.entryIndex}">Undo</button>`);
      btn.addEventListener('click', () => {
        const entry = ctx.state.log?.[row.entryIndex];
        if (!entry) return;
        correctMeal(removeLogEntry(ctx.state, row.entryIndex));
      });
      actions.appendChild(btn);
    }
    if (row.canChange) {
      const btn = el(`<button type="button" class="btn-secondary btn-small" data-meal-change="${row.entryIndex}" data-change-to="${escapeHtml(row.changeTo)}">Change</button>`);
      btn.addEventListener('click', () => {
        const entry = ctx.state.log?.[row.entryIndex];
        if (!entry) return;
        if (row.changeTo === 'skipped') {
          correctMeal(convertLogEntryToSkipped(ctx.state, row.entryIndex, row.recipeId, slot));
        } else if (row.changeTo === 'eaten') {
          const planned = recipe || recipesById.get(row.recipeId);
          if (!planned) return;
          correctMeal(convertSkippedEntryToEaten(ctx.state, row.entryIndex, planned, slot));
        }
      });
      actions.appendChild(btn);
    }
    // A row with no allowed action keeps no empty container.
    if (actions.childElementCount === 0) actions.remove();
    rowsBySlot.set(slot, { item, recipe });
    list.appendChild(item);
  }
  // The shopping list's Swap meal: open this meal's Replace picker, but only
  // while the meal is still planned and not yet logged. Otherwise the day screen
  // shows as usual, with no picker and no error.
  const forward = replaceForwardSlot({
    openReplace, plan: state.plan, log: state.log, date: selected, recipesById, today,
  });
  const forwardRow = forward ? rowsBySlot.get(forward.slot) : null;
  if (forwardRow && forwardRow.recipe) {
    openReplacement(forwardRow.item, forward.slot, forwardRow.recipe);
  }
  mealCard.querySelector('[data-action="log"]').addEventListener('click', () => ctx.navigate('log'));
  root.appendChild(mealCard);

  const dayLog = (state.log || []).filter((e) => e.date === selected);
  // Only what the user logged counts as progress; the planned meals above are a plan.
  const { result: display, note: progressNote } =
    dayProgressTotals(meals, dayLog, recipesById, foodsById);

  const bars = el(`<section class="card"><h3>Daily progress</h3><div class="progress-list"></div>
    <p class="muted tiny">${progressNote}</p>
  </section>`);
  const progressList = bars.querySelector('.progress-list');
  for (const t of state.targets) {
    const value = display.totals[t.nutrient] ?? 0;
    const daily = t.daily;
    const pct = daily > 0 ? Math.min(100, Math.round((value / daily) * 100)) : 0;
    const cls = progressClass(t.kind, value, daily);
    const valueText = dayValueText(display, t.nutrient);
    progressList.appendChild(el(`<div class="progress-row">
      <div class="progress-meta">
        <span>${nutrientLabel(t.nutrient)}</span>
        <span class="muted">${valueText} / ${t.kind === 'max' ? 'max' : 'min'} ${daily} ${nutrientUnit(t.nutrient)}</span>
      </div>
      <div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`));
  }
  root.appendChild(bars);

  // Logged meals for this day can be corrected in place. Every saved entry shows
  // controls to remove it, change an eaten meal into skipped (and back), or edit
  // the portions of the food it holds.
  const dayEntries = (state.log || [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.date === selected);
  const planDay = state.plan.days[selected];
  const loggedCard = el(`<section class="card">
    <h3>Logged meals</h3>
    <p class="muted tiny">Correct a mistake here and the plan is recalculated from the corrected log.</p>
    <ul class="log-edits"></ul>
  </section>`);
  const editList = loggedCard.querySelector('.log-edits');
  if (dayEntries.length === 0) {
    editList.appendChild(el(`<li class="muted tiny" data-no-log>Nothing logged for this day yet.</li>`));
  }
  for (const { entry, index } of dayEntries) {
    const skipped = isSkippedEntry(entry);
    const replaced = Array.isArray(entry.replaced) ? entry.replaced[0] : null;
    // An extra is food eaten outside the planned meals: it is not tied to a slot,
    // so it is never matched to a planned recipe (which would offer a skip).
    const extra = Boolean(entry.extra);
    const hasEaten = Array.isArray(entry.eaten) && entry.eaten.length > 0;
    const recipe = skipped
      ? recipesById.get(entry.skipped[0]) || null
      : (extra && !hasEaten)
        ? null
        : findPlannedRecipeForEntry(entry, planDay, recipesById);
    const kind = logEntryKind(entry, recipe);
    const when = [entry.date, entry.time].filter(Boolean).join(' · ');
    const li = el(`<li class="log-edit" data-entry="${index}">
      <div class="log-edit-head">
        <span class="log-edit-kind">${escapeHtml(kind)}</span>
        <span class="muted tiny">${escapeHtml(when)}</span>
      </div>
    </li>`);

    if (replaced) {
      const plannedName = recipesById.get(replaced.fromRecipeId)?.name || replaced.fromRecipeId;
      li.appendChild(el(`<p class="muted tiny log-edit-note">You ate ${escapeHtml(recipe?.name || 'another meal')}
        instead of the planned ${escapeHtml(replaced.slot)} (${escapeHtml(plannedName)}).
        Remove this entry to choose another meal with Replace.</p>`));
    }

    if (skipped) {
      li.appendChild(el(`<p class="log-edit-skipped">Skipped · ${escapeHtml(recipe?.name || entry.skipped[0])}</p>`));
    } else if ((entry.items || []).length > 0) {
      const items = el(`<ul class="log-edit-items"></ul>`);
      entry.items.forEach((it, itemIndex) => {
        const food = foodsById.get(it.foodId);
        const name = displayFoodName(food) || food?.id || it.foodId;
        items.appendChild(el(`<li class="log-edit-item">
          <span>${escapeHtml(name)}</span>
          <input type="number" min="1" max="5000" step="1" value="${it.grams}"
            data-correct-entry="${index}" data-correct-item="${itemIndex}"
            aria-label="${escapeHtml(name)} grams">
          <span class="muted">g</span>
        </li>`));
      });
      li.appendChild(items);
    }

    const actions = el(`<div class="log-edit-actions">
      <button type="button" class="btn-secondary btn-small" data-correct-remove="${index}">Remove entry</button>
    </div>`);
    // The slot is passed along: with two snacks the same recipe can fill both, and a
    // correction on one must not touch the other.
    const skippedSlot = (Array.isArray(entry.skippedSlots) ? entry.skippedSlots : [])
      .find((info) => info && info.recipeId === recipe?.id)?.slot || '';
    const eatenSlot = (Array.isArray(entry.eaten) ? entry.eaten : [])
      .find((info) => info && info.recipeId === recipe?.id)?.slot || '';
    if (replaced) {
      // A replaced meal is removed and re-done through Replace, never turned into a skip.
    } else if (skipped && recipe) {
      actions.appendChild(el(`<button type="button" class="btn-secondary btn-small" data-correct-eat="${index}" data-recipe="${escapeHtml(recipe.id)}" data-slot="${escapeHtml(skippedSlot)}">Add as eaten</button>`));
    } else if (!skipped && !extra && recipe) {
      // Extras hold no slot, and turning a mixed entry into Skipped would drop the
      // extra foods: neither offers "Mark as skipped".
      actions.appendChild(el(`<button type="button" class="btn-secondary btn-small" data-correct-skip="${index}" data-recipe="${escapeHtml(recipe.id)}" data-slot="${escapeHtml(eatenSlot)}">Mark as skipped</button>`));
    }
    li.appendChild(actions);
    editList.appendChild(li);
  }
  root.appendChild(loggedCard);

  const updateAfterCorrection = (nextState, entry) => {
    applyLogCorrection(ctx, nextState, { fromDate: entry?.date });
  };

  editList.querySelectorAll('[data-correct-entry]').forEach((input) => {
    input.addEventListener('change', () => {
      const index = Number(input.dataset.correctEntry);
      const itemIndex = Number(input.dataset.correctItem);
      const entry = ctx.state.log?.[index];
      if (!entry) return;
      const grams = parsePortion(input.value);
      if (grams === null) {
        input.value = entry.items[itemIndex]?.grams ?? '';
        return;
      }
      const items = entry.items.map((it, i) => (i === itemIndex ? { ...it, grams } : it));
      updateAfterCorrection(updateLogEntryItems(ctx.state, index, items), entry);
    });
  });
  editList.querySelectorAll('[data-correct-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.correctRemove);
      const entry = ctx.state.log?.[index];
      if (!entry) return;
      updateAfterCorrection(removeLogEntry(ctx.state, index), entry);
    });
  });
  editList.querySelectorAll('[data-correct-skip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.correctSkip);
      const entry = ctx.state.log?.[index];
      if (!entry) return;
      updateAfterCorrection(
        convertLogEntryToSkipped(ctx.state, index, btn.dataset.recipe, btn.dataset.slot || null),
        entry,
      );
    });
  });
  editList.querySelectorAll('[data-correct-eat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.correctEat);
      const entry = ctx.state.log?.[index];
      const recipe = recipesById.get(btn.dataset.recipe);
      if (!entry || !recipe) return;
      updateAfterCorrection(
        convertSkippedEntryToEaten(ctx.state, index, recipe, btn.dataset.slot || null),
        entry,
      );
    });
  });

  const upcoming = dates.filter((d) => d > selected).slice(0, 3);
  if (upcoming.length) {
    const up = el(`<section class="card"><h3>Upcoming days</h3><ul class="upcoming"></ul></section>`);
    const ul = up.querySelector('.upcoming');
    for (const date of upcoming) {
      const dayMeals = state.plan.days[date] || {};
      const meals = Object.keys(dayMeals)
        .filter((slot) => dayMeals[slot])
        .map((slot) => recipesById.get(dayMeals[slot]))
        .filter(Boolean)
        .map((r) => `<li>${r.icon || ''} ${escapeHtml(r.name)}</li>`)
        .join('');
      ul.appendChild(el(`<li class="upcoming-day"><span class="muted">${date}</span><ul>${meals}</ul></li>`));
    }
    root.appendChild(up);
  }

  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));
  return root;
}
