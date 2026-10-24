import { dayTotals, todayIso, SLOTS } from '../engine/planner.js';
import { foodNutrients, formatNutrient, sumNutrients } from '../engine/nutrients.js';
import { el, escapeHtml, nutrientLabel, nutrientUnit } from './dom.js';
import { openRecipeDetail } from './recipe_detail.js';
import { parsePortion } from './log.js';
import {
  removeLogEntry,
  updateLogEntryItems,
  convertLogEntryToSkipped,
  convertSkippedEntryToEaten,
  findPlannedRecipeForEntry,
  applyLogCorrection,
} from '../log_corrections.js';

/** True when a saved entry only records skipped planned meals. */
function isSkippedEntry(entry) {
  return Array.isArray(entry?.skipped) && entry.skipped.length > 0
    && (!entry.items || entry.items.length === 0);
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
 * What the day's progress bars show, and the line that explains it.
 * Meals actually logged win; when nothing was eaten, planned meals count except
 * the ones the user marked Skipped. A skipped meal is never counted as eaten.
 * Returns { result, note } where result is shaped like dayTotals.
 */
export function dayProgressTotals(dayMeals, dayLog, recipesById, foodsById) {
  const parts = [];
  const skippedIds = new Set();
  for (const entry of dayLog || []) {
    for (const it of entry.items || []) {
      const food = foodsById.get(it.foodId);
      if (food) parts.push(foodNutrients(food, it.grams));
    }
    for (const id of entry.skipped || []) skippedIds.add(id);
  }

  if (parts.length > 0) {
    return { result: sumNutrients(parts), note: 'Based on meals you logged for this day.' };
  }
  if (skippedIds.size > 0) {
    // Keep the planned meals that were not skipped; the skipped one is gone.
    const remaining = {};
    for (const slot of SLOTS) {
      const id = dayMeals?.[slot];
      if (id && !skippedIds.has(id)) remaining[slot] = id;
    }
    return {
      result: dayTotals(remaining, recipesById, foodsById),
      note: 'Based on planned meals (skipped meals are not counted as eaten).',
    };
  }
  return {
    result: dayTotals(dayMeals, recipesById, foodsById),
    note: 'Based on planned meals (nothing logged yet).',
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
    <ul class="meal-list"></ul>
  </section>`);
  const list = mealCard.querySelector('.meal-list');
  for (const slot of SLOTS) {
    const recipe = recipesById.get(meals[slot]);
    const item = el(`<li class="meal-item">
      <button type="button" class="meal-open" data-open-recipe="${escapeHtml(recipe?.id || '')}" aria-haspopup="dialog">
        <span class="meal-slot">${slot}</span>
        <span class="meal-name">${recipe?.icon || ''} ${escapeHtml(recipe?.name || meals[slot])}</span>
      </button>
    </li>`);
    // Tapping a planned meal opens its detail panel in place; it never leaves the screen.
    item.querySelector('[data-open-recipe]').addEventListener('click', () => {
      if (recipe) openRecipeDetail(ctx, recipe, root);
    });
    list.appendChild(item);
  }
  mealCard.querySelector('[data-action="log"]').addEventListener('click', () => ctx.navigate('log'));
  root.appendChild(mealCard);

  const dayLog = (state.log || []).filter((e) => e.date === selected);
  // Skipped meals have no food items: they are dropped from the planned values.
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
    const kind = skipped
      ? 'Skipped'
      : replaced
        ? 'Eaten · replaced'
        : extra
          ? (hasEaten ? 'Eaten · extra' : 'Extra / outside meals')
          : 'Eaten';
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
        const name = food?.name || it.foodId;
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
    if (replaced) {
      // A replaced meal is removed and re-done through Replace, never turned into a skip.
    } else if (skipped && recipe) {
      actions.appendChild(el(`<button type="button" class="btn-secondary btn-small" data-correct-eat="${index}" data-recipe="${escapeHtml(recipe.id)}">Add as eaten</button>`));
    } else if (!skipped && !extra && recipe) {
      // Extras hold no slot, and turning a mixed entry into Skipped would drop the
      // extra foods: neither offers "Mark as skipped".
      actions.appendChild(el(`<button type="button" class="btn-secondary btn-small" data-correct-skip="${index}" data-recipe="${escapeHtml(recipe.id)}">Mark as skipped</button>`));
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
      updateAfterCorrection(convertLogEntryToSkipped(ctx.state, index, btn.dataset.recipe), entry);
    });
  });
  editList.querySelectorAll('[data-correct-eat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.correctEat);
      const entry = ctx.state.log?.[index];
      const recipe = recipesById.get(btn.dataset.recipe);
      if (!entry || !recipe) return;
      updateAfterCorrection(convertSkippedEntryToEaten(ctx.state, index, recipe), entry);
    });
  });

  const upcoming = dates.filter((d) => d > selected).slice(0, 3);
  if (upcoming.length) {
    const up = el(`<section class="card"><h3>Upcoming days</h3><ul class="upcoming"></ul></section>`);
    const ul = up.querySelector('.upcoming');
    for (const date of upcoming) {
      const meals = ['breakfast', 'lunch', 'dinner', 'snack']
        .map((slot) => recipesById.get(state.plan.days[date][slot]))
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
