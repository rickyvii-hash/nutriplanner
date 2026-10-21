import { dayTotals, todayIso, SLOTS } from '../engine/planner.js';
import { foodNutrients } from '../engine/nutrients.js';
import { el, escapeHtml, nutrientLabel, nutrientUnit } from './dom.js';

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

  root.appendChild(el(`<header class="brand brand-compact">
    <span class="logo" aria-hidden="true">🌿</span>
    <div><h1>Month plan</h1><p>Adaptive meal planning that flexes with real life.</p></div>
  </header>`));

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
    list.appendChild(el(`<li class="meal-item">
      <span class="meal-slot">${slot}</span>
      <span class="meal-name">${recipe?.icon || ''} ${escapeHtml(recipe?.name || meals[slot])}</span>
    </li>`));
  }
  mealCard.querySelector('[data-action="log"]').addEventListener('click', () => ctx.navigate('log'));
  root.appendChild(mealCard);

  const dayLog = (state.log || []).filter((e) => e.date === selected);
  const { totals: plannedTotals, incomplete: plannedIncomplete } = dayTotals(meals, recipesById, foodsById);
  let displayTotals = { ...plannedTotals };
  let incomplete = { ...plannedIncomplete };

  if (dayLog.length > 0) {
    displayTotals = Object.fromEntries(Object.keys(plannedTotals).map((k) => [k, 0]));
    incomplete = {};
    for (const entry of dayLog) {
      for (const it of entry.items) {
        const food = foodsById.get(it.foodId);
        if (!food) continue;
        const n = foodNutrients(food, it.grams);
        for (const k of Object.keys(displayTotals)) {
          if (n[k] === null || n[k] === undefined) incomplete[k] = true;
          else displayTotals[k] += n[k];
        }
      }
    }
  }

  const bars = el(`<section class="card"><h3>Daily progress</h3><div class="progress-list"></div>
    <p class="muted tiny">${dayLog.length ? 'Based on meals you logged for this day.' : 'Based on planned meals (nothing logged yet).'}</p>
  </section>`);
  const progressList = bars.querySelector('.progress-list');
  for (const t of state.targets) {
    const value = displayTotals[t.nutrient] ?? 0;
    const daily = t.daily;
    const pct = daily > 0 ? Math.min(100, Math.round((value / daily) * 100)) : 0;
    const cls = progressClass(t.kind, value, daily);
    const valueText = incomplete[t.nutrient] && !(value > 0) ? 'n/a' : value.toFixed(t.nutrient === 'kcal' || t.nutrient === 'sodium' ? 0 : 1);
    progressList.appendChild(el(`<div class="progress-row">
      <div class="progress-meta">
        <span>${nutrientLabel(t.nutrient)}</span>
        <span class="muted">${valueText} / ${t.kind === 'max' ? 'max' : 'min'} ${daily} ${nutrientUnit(t.nutrient)}</span>
      </div>
      <div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`));
  }
  root.appendChild(bars);

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
