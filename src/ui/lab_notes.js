// Lab notes screen: values the person chooses to keep on this device, shown
// next to logged intake. The two records stay separate; nothing here reads a
// lab value together with a food value. The fixed note is LAB_DISCLAIMER:
// "These are two separate records shown side by side. They do not show cause
// and effect. Talk to your doctor."

import {
  LAB_DISCLAIMER,
  weeklyIntakeSeries,
  labSeriesByName,
  alignSeriesWithGaps,
} from '../engine/lab_notes.js';
import { todayIso } from '../engine/planner.js';
import { el, escapeHtml, nutrientLabel, nutrientUnit } from './dom.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function formatValue(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  const numeric = typeof value === 'number' ? value : Number(text);
  if (text === '' || !Number.isFinite(numeric)) return 'n/a';
  if (Number.isInteger(numeric)) return String(numeric);
  return String(Math.round(numeric * 1000) / 1000);
}

/**
 * Average of the logged days inside each block of seven days. A block with no
 * logged day stays null: a gap in the chart, never a zero.
 */
export function weeklyAverages(points) {
  const out = [];
  const series = Array.isArray(points) ? points : [];
  for (let i = 0; i < series.length; i += 7) {
    const week = series.slice(i, i + 7);
    const values = week
      .map((point) => point.value)
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    const total = values.reduce((sum, value) => sum + value, 0);
    out.push({
      date: week[0].date,
      value: values.length > 0 ? Math.round((total / values.length) * 1000) / 1000 : null,
    });
  }
  return out;
}

function xLabels(dates) {
  if (dates.length <= 8) return dates.map((date, index) => ({ date, index }));
  return [
    { date: dates[0], index: 0 },
    { date: dates[Math.floor((dates.length - 1) / 2)], index: Math.floor((dates.length - 1) / 2) },
    { date: dates[dates.length - 1], index: dates.length - 1 },
  ];
}

/**
 * One line chart as an SVG string. Null values are gaps: they are not drawn
 * and they break the line, so a missing day can never look like a zero.
 */
export function lineChart({
  dates, points, unit, title, color = '#2f6b4f', note = '', ariaLabel = '',
}) {
  const width = 640;
  const height = 190;
  const pad = { left: 54, right: 16, top: 18, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const values = points
    .map((point) => point.value)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0 || dates.length === 0) {
    return `<div class="lab-chart" role="img" aria-label="${escapeHtml(ariaLabel || title)}">
      <p class="lab-chart-title">${escapeHtml(title)}</p>
      <p class="muted tiny">No values in this period.</p>
      ${note ? `<p class="muted tiny">${escapeHtml(note)}</p>` : ''}
    </div>`;
  }

  let low = Math.min(...values);
  let high = Math.max(...values);
  if (low === high) {
    low -= 0.5;
    high += 0.5;
  }
  const span = high - low;
  const xFor = (index) => (dates.length <= 1
    ? pad.left + plotW / 2
    : pad.left + (index * plotW) / (dates.length - 1));
  const yFor = (value) => pad.top + ((high - value) / span) * plotH;
  const xText = (index) => xFor(index).toFixed(1);
  const yText = (value) => yFor(value).toFixed(1);

  const ticks = [0, 0.5, 1].map((fraction) => {
    const value = low + (high - low) * (1 - fraction);
    const y = (pad.top + plotH * fraction).toFixed(1);
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e3e8e2" stroke-width="1"></line>
      <text x="${pad.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="#6d7a70">${escapeHtml(formatValue(value))}</text>`;
  }).join('');

  let path = '';
  let pen = false;
  points.forEach((point, index) => {
    if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${xText(index)},${yText(point.value)} `;
    pen = true;
  });

  const dots = points.map((point, index) => {
    if (typeof point.value !== 'number' || !Number.isFinite(point.value)) return '';
    const label = `${point.date}: ${formatValue(point.value)}${unit ? ` ${unit}` : ''}`;
    return `<circle cx="${xText(index)}" cy="${yText(point.value)}" r="4" fill="${color}">
      <title>${escapeHtml(label)}</title>
    </circle>`;
  }).join('');

  const labels = xLabels(dates).map(({ date, index }) => (
    `<text x="${xText(index)}" y="${height - 8}" text-anchor="${dates.length <= 1 ? 'middle' : (index === 0 ? 'start' : (index === dates.length - 1 ? 'end' : 'middle'))}" font-size="11" fill="#6d7a70">${escapeHtml(date.slice(5))}</text>`
  )).join('');

  return `<div class="lab-chart" role="img" aria-label="${escapeHtml(ariaLabel || title)}">
    <p class="lab-chart-title">${escapeHtml(title)}</p>
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" focusable="false" aria-hidden="true">
      ${ticks}
      <path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>
      ${dots}
      ${labels}
    </svg>
    ${note ? `<p class="muted tiny">${escapeHtml(note)}</p>` : ''}
  </div>`;
}

function uniqueLabNames(labNotes) {
  const names = [];
  for (const note of labNotes) {
    const name = String(note && note.name ? note.name : '').trim();
    if (name && !names.some((seen) => seen.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function planRange(state) {
  const planDates = Object.keys(state.plan && state.plan.days ? state.plan.days : {}).sort();
  if (planDates.length > 0) {
    return { from: planDates[0], to: planDates[planDates.length - 1] };
  }
  const logDates = (Array.isArray(state.log) ? state.log : [])
    .map((entry) => entry && entry.date)
    .filter((date) => typeof date === 'string' && ISO_DATE.test(date))
    .sort();
  if (logDates.length > 0) {
    return { from: logDates[0], to: logDates[logDates.length - 1] };
  }
  return { from: todayIso(), to: todayIso() };
}

function fillForm(form, note) {
  form.elements.name.value = note ? note.name || '' : '';
  form.elements.value.value = note && note.value !== undefined && note.value !== null ? String(note.value) : '';
  form.elements.unit.value = note ? note.unit || '' : '';
  form.elements.date.value = note ? note.date || todayIso() : todayIso();
  form.elements.note.value = note ? note.note || '' : '';
}

export function renderLabNotes(ctx) {
  const { state } = ctx;
  const labNotes = Array.isArray(state.labNotes) ? state.labNotes : [];
  const backTarget = state.plan ? 'plan' : 'targets';
  const root = el(`<div class="screen screen-lab-notes"></div>`);

  root.appendChild(el(`<header class="brand brand-compact">
    <button type="button" class="btn-text back" data-back>← ${state.plan ? 'Plan' : 'Targets'}</button>
    <div><h1>Lab notes</h1><p>Values you choose to keep on this device.</p></div>
  </header>`));

  root.appendChild(el(`<section class="card note-card lab-disclaimer" data-lab-disclaimer>
    <p>${escapeHtml(LAB_DISCLAIMER)}</p>
  </section>`));

  const formCard = el(`<section class="card">
    <h2 data-form-title>Add a lab note</h2>
    <form data-form novalidate>
      <label class="field">
        <span>Name</span>
        <input name="name" type="text" autocomplete="off" placeholder="e.g. LDL" required>
      </label>
      <label class="field">
        <span>Value</span>
        <input name="value" type="number" step="any" inputmode="decimal" placeholder="e.g. 120" required>
      </label>
      <label class="field">
        <span>Unit</span>
        <input name="unit" type="text" autocomplete="off" placeholder="e.g. mg/dL">
      </label>
      <label class="field">
        <span>Date</span>
        <input name="date" type="date" required>
      </label>
      <label class="field">
        <span>Note</span>
        <textarea name="note" rows="2" placeholder="Optional"></textarea>
      </label>
      <p class="field-error" data-form-error hidden>Enter a name, a value and a date.</p>
      <div class="stack-actions dual">
        <button type="button" class="btn-text" data-cancel hidden>Cancel edit</button>
        <button type="submit" class="btn-primary" data-submit>Save lab note</button>
      </div>
    </form>
  </section>`);
  root.appendChild(formCard);

  const form = formCard.querySelector('[data-form]');
  const formTitle = formCard.querySelector('[data-form-title]');
  const formError = formCard.querySelector('[data-form-error]');
  const cancelButton = formCard.querySelector('[data-cancel]');
  const submitButton = formCard.querySelector('[data-submit]');
  let editingId = null;
  fillForm(form, null);

  const resetForm = () => {
    editingId = null;
    fillForm(form, null);
    formTitle.textContent = 'Add a lab note';
    submitButton.textContent = 'Save lab note';
    cancelButton.hidden = true;
    formError.hidden = true;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = {
      name: form.elements.name.value,
      value: form.elements.value.value,
      unit: form.elements.unit.value,
      date: form.elements.date.value,
      note: form.elements.note.value,
    };
    const value = raw.value === '' ? null : Number(raw.value);
    if (!raw.name.trim() || value === null || !Number.isFinite(value) || !ISO_DATE.test(raw.date)) {
      formError.hidden = false;
      return;
    }
    formError.hidden = true;
    const payload = {
      name: raw.name.trim(),
      value,
      unit: raw.unit.trim(),
      date: raw.date,
      note: raw.note.trim(),
    };
    if (editingId) ctx.updateLabNote(editingId, payload);
    else ctx.addLabNote(payload);
  });

  cancelButton.addEventListener('click', resetForm);

  const listCard = el(`<section class="card">
    <h2>Your lab notes</h2>
    <div data-lab-list></div>
  </section>`);
  const listEl = listCard.querySelector('[data-lab-list]');
  const sorted = labNotes.slice().sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    return byDate !== 0 ? byDate : String(a.name || '').localeCompare(String(b.name || ''));
  });

  if (sorted.length === 0) {
    listEl.appendChild(el(`<p class="muted">No lab notes yet.</p>`));
  } else {
    for (const note of sorted) {
      const row = el(`<div class="lab-note-row">
        <div class="lab-note-main">
          <div class="lab-note-head">
            <strong>${escapeHtml(note.name || '')}</strong>
            <span class="lab-note-value">${escapeHtml(formatValue(note.value))}${note.unit ? ` ${escapeHtml(note.unit)}` : ''}</span>
          </div>
          <div class="muted tiny">${escapeHtml(note.date || '')}</div>
          ${note.note ? `<p class="lab-note-text">${escapeHtml(note.note)}</p>` : ''}
        </div>
        <div class="lab-note-actions">
          <button type="button" class="btn-text btn-small" data-edit="${escapeHtml(String(note.id))}">Edit</button>
          <button type="button" class="btn-text btn-small" data-remove="${escapeHtml(String(note.id))}">Remove</button>
        </div>
      </div>`);
      row.querySelector('[data-edit]').addEventListener('click', () => {
        editingId = note.id;
        fillForm(form, note);
        formTitle.textContent = 'Edit lab note';
        submitButton.textContent = 'Save changes';
        cancelButton.hidden = false;
        formError.hidden = true;
        formCard.scrollIntoView({ block: 'start' });
      });
      row.querySelector('[data-remove]').addEventListener('click', () => {
        if (!window.confirm('Remove this lab note?')) return;
        const wasEditing = editingId === note.id;
        ctx.removeLabNote(note.id);
        if (wasEditing) resetForm();
      });
      listEl.appendChild(row);
    }
  }
  root.appendChild(listCard);

  const names = uniqueLabNames(labNotes);
  const selectedName = names.includes(ctx.labNoteName) ? ctx.labNoteName : (names[0] || '');
  const targetNutrients = [];
  for (const target of state.targets || []) {
    if (target && target.nutrient && !targetNutrients.includes(target.nutrient)) {
      targetNutrients.push(target.nutrient);
    }
  }
  const selectedNutrient = targetNutrients.includes(ctx.labNoteNutrient)
    ? ctx.labNoteNutrient
    : (targetNutrients[0] || '');

  const chartCard = el(`<section class="card">
    <h2>Values and intake</h2>
    <p class="muted tiny">Two records on the same dates. A day with no log is a gap, not a zero.</p>
    <div class="lab-controls">
      <label class="field">
        <span>Lab value</span>
        <select data-lab-name></select>
      </label>
      <label class="field">
        <span>Intake nutrient</span>
        <select data-nutrient></select>
      </label>
    </div>
    <div class="lab-charts" data-charts></div>
  </section>`);
  root.appendChild(chartCard);

  const nameSelect = chartCard.querySelector('[data-lab-name]');
  const nutrientSelect = chartCard.querySelector('[data-nutrient]');
  const chartsEl = chartCard.querySelector('[data-charts]');

  if (names.length === 0) {
    nameSelect.appendChild(el(`<option value="">No lab notes yet</option>`));
    nameSelect.disabled = true;
  } else {
    for (const name of names) {
      const option = el(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
      if (name === selectedName) option.selected = true;
      nameSelect.appendChild(option);
    }
  }

  if (targetNutrients.length === 0) {
    nutrientSelect.appendChild(el(`<option value="">No target yet</option>`));
    nutrientSelect.disabled = true;
  } else {
    for (const nutrient of targetNutrients) {
      const option = el(`<option value="${escapeHtml(nutrient)}">${escapeHtml(nutrientLabel(nutrient))}</option>`);
      if (nutrient === selectedNutrient) option.selected = true;
      nutrientSelect.appendChild(option);
    }
  }

  const paintCharts = () => {
    chartsEl.innerHTML = '';
    // Read the selects each time so a new choice is the one drawn.
    const labName = nameSelect.value;
    const nutrient = nutrientSelect.value;
    const labs = labName ? labSeriesByName(labNotes, labName) : [];
    const range = planRange(state);
    const daily = nutrient
      ? weeklyIntakeSeries(state.log || [], nutrient, ctx.foodsById, range)
      : [];
    const intake = weeklyAverages(daily);
    const aligned = alignSeriesWithGaps(labs, intake);
    const dates = aligned.labs.map((point) => point.date);

    if (dates.length === 0) {
      chartsEl.appendChild(el(`<p class="muted">Add a lab note or log a meal to see the chart.</p>`));
      return;
    }

    const unit = (labNotes.find((note) => String(note.name || '').trim().toLowerCase() === labName.toLowerCase()) || {}).unit || '';
    chartsEl.appendChild(el(lineChart({
      dates,
      points: aligned.labs,
      unit,
      title: labName ? `Lab record: ${labName}` : 'Lab record',
      color: '#2f6b4f',
      note: 'Each dot is a value you entered. A date with no value is a gap.',
      ariaLabel: `Lab values over time for ${labName || 'the selected lab'}`,
    })));

    if (nutrient) {
      chartsEl.appendChild(el(lineChart({
        dates,
        points: aligned.intake,
        unit: nutrientUnit(nutrient),
        title: `Intake: ${nutrientLabel(nutrient)} (weekly average per day)`,
        color: '#8a5a2b',
        note: 'Each dot averages the days with a log in that week. A day with no log is a gap, not a zero.',
        ariaLabel: `${nutrientLabel(nutrient)} intake over time`,
      })));
    } else {
      chartsEl.appendChild(el(`<p class="muted tiny">Add a target on the Targets screen to show intake.</p>`));
    }
  };

  nameSelect.addEventListener('change', () => {
    ctx.labNoteName = nameSelect.value;
    paintCharts();
  });
  nutrientSelect.addEventListener('change', () => {
    ctx.labNoteNutrient = nutrientSelect.value;
    paintCharts();
  });
  paintCharts();

  root.querySelector('[data-back]').addEventListener('click', () => ctx.navigate(backTarget));
  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  return root;
}
