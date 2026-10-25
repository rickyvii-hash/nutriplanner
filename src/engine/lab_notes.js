// Lab notes arithmetic. A lab record and the food intake record are two
// separate series: this module only places them next to each other.
// A day with no logged food is a gap (null), never a zero. A nutrient value
// that the food data does not have stays unknown, and is never shown as a zero.

import { NUTRIENT_KEYS } from './nutrients.js';

/** Fixed note shown wherever lab values and intake appear together. */
export const LAB_DISCLAIMER =
  'These are two separate records shown side by side. They do not show cause and effect. Talk to your doctor.';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function lookupFood(foodsById, foodId) {
  if (!foodsById || foodId === null || foodId === undefined) return null;
  if (typeof foodsById.get === 'function') return foodsById.get(foodId) || null;
  return foodsById[foodId] || null;
}

/** Every calendar day from `from` to `to`, both included. Empty when the range is invalid. */
export function isoDateRange(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return [];
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const out = [];
  let at = start;
  // A month plan is the longest range this app needs; the cap only guards bad input.
  while (at <= end && out.length < 4000) {
    out.push(new Date(at).toISOString().slice(0, 10));
    at += 24 * 60 * 60 * 1000;
  }
  return out;
}

function logDates(log) {
  const dates = [];
  for (const entry of Array.isArray(log) ? log : []) {
    if (entry && isIsoDate(entry.date)) dates.push(entry.date);
  }
  return dates.sort();
}

function emptyDay() {
  return { total: 0, known: 0 };
}

/**
 * One point per day: the intake of `nutrient` from the meals logged that day.
 * A day with nothing logged is a gap with value null. A day whose logged foods
 * all lack this nutrient is also null, because "n/a" is not zero.
 * `from` and `to` are YYYY-MM-DD and both included; without them the logged
 * dates define the range.
 */
export function weeklyIntakeSeries(log, nutrient, foodsById, { from, to } = {}) {
  if (!NUTRIENT_KEYS.includes(nutrient)) return [];
  const dates = logDates(log);
  const start = from || dates[0];
  const end = to || dates[dates.length - 1];
  const range = isoDateRange(start, end);
  if (range.length === 0) return [];

  const byDate = new Map();
  for (const entry of Array.isArray(log) ? log : []) {
    if (!entry || !isIsoDate(entry.date)) continue;
    if (entry.date < start || entry.date > end) continue;
    const items = Array.isArray(entry.items) ? entry.items : [];
    if (items.length === 0) continue;
    const day = byDate.get(entry.date) || emptyDay();
    for (const item of items) {
      const food = lookupFood(foodsById, item ? item.foodId : null);
      if (!food || !food.per100g) continue;
      const grams = Number(item.grams);
      if (!Number.isFinite(grams) || grams <= 0) continue;
      const per100 = food.per100g[nutrient];
      if (per100 === null || per100 === undefined || !Number.isFinite(per100)) continue;
      day.total += (per100 * grams) / 100;
      day.known += 1;
    }
    byDate.set(entry.date, day);
  }

  return range.map((date) => {
    const day = byDate.get(date);
    return {
      date,
      value: day && day.known > 0 ? round3(day.total) : null,
    };
  });
}

function numericValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * The entered values for one lab name, oldest first. The name match ignores
 * surrounding spaces and letter case. Entries without a date or a number are
 * left out instead of being replaced by a zero.
 */
export function labSeriesByName(labNotes, name) {
  const wanted = String(name === null || name === undefined ? '' : name).trim().toLowerCase();
  if (!wanted) return [];
  return (Array.isArray(labNotes) ? labNotes : [])
    .filter((note) => note && String(note.name === null || note.name === undefined ? '' : note.name).trim().toLowerCase() === wanted)
    .map((note, index) => ({
      index,
      date: note.date,
      value: numericValue(note.value),
    }))
    .filter((point) => isIsoDate(point.date) && point.value !== null)
    .sort((a, b) => (a.date === b.date ? a.index - b.index : a.date.localeCompare(b.date)))
    .map(({ date, value }) => ({ date, value }));
}

function cleanSeries(series) {
  return (Array.isArray(series) ? series : [])
    .filter((point) => point && isIsoDate(point.date))
    .map((point, index) => ({
      index,
      date: point.date,
      value: numericValue(point.value),
    }))
    .sort((a, b) => (a.date === b.date ? a.index - b.index : a.date.localeCompare(b.date)));
}

function fillOverDates(series, dates) {
  const byDate = new Map();
  for (const point of series) {
    // When the same date appears twice, the last entered point is the one drawn.
    byDate.set(point.date, point.value);
  }
  return dates.map((date) => ({
    date,
    value: byDate.has(date) ? byDate.get(date) : null,
  }));
}

/**
 * Places the lab series and the intake series on the same list of dates so a
 * chart can draw them next to each other. Each series keeps its own values;
 * a date that one of them does not have stays null (a gap), never zero.
 */
export function alignSeriesWithGaps(labs, intake) {
  const labPoints = cleanSeries(labs);
  const intakePoints = cleanSeries(intake);
  const dates = [...new Set([
    ...labPoints.map((point) => point.date),
    ...intakePoints.map((point) => point.date),
  ])].sort();
  return {
    labs: fillOverDates(labPoints, dates),
    intake: fillOverDates(intakePoints, dates),
  };
}

/** A lab note ready for the state, or null when name, value or date is missing. */
export function cleanLabNote(note) {
  if (!note || typeof note !== 'object') return null;
  const name = String(note.name === null || note.name === undefined ? '' : note.name).trim();
  const value = numericValue(note.value);
  const date = String(note.date === null || note.date === undefined ? '' : note.date).trim();
  if (!name || value === null || !isIsoDate(date)) return null;
  return {
    name,
    value,
    unit: String(note.unit === null || note.unit === undefined ? '' : note.unit).trim(),
    date,
    note: String(note.note === null || note.note === undefined ? '' : note.note).trim(),
  };
}

/** First free id in the lab-1, lab-2, ... sequence. */
export function nextLabNoteId(labNotes) {
  const used = new Set((Array.isArray(labNotes) ? labNotes : []).map((note) => note && note.id));
  let n = 1;
  while (used.has('lab-' + n)) n += 1;
  return 'lab-' + n;
}

/** Add one lab note. An invalid note leaves the list unchanged. */
export function addLabNote(labNotes, note, { id } = {}) {
  const list = Array.isArray(labNotes) ? labNotes : [];
  const clean = cleanLabNote(note);
  if (!clean) return [...list];
  const wantedId = String(id || (note && note.id) || '').trim();
  const unique = wantedId && !list.some((entry) => entry && entry.id === wantedId)
    ? wantedId
    : nextLabNoteId(list);
  return [...list, { id: unique, ...clean }];
}

/** Change one lab note by id. An invalid patch leaves the list unchanged. */
export function updateLabNote(labNotes, id, patch) {
  const list = Array.isArray(labNotes) ? labNotes : [];
  const index = list.findIndex((note) => note && note.id === id);
  if (index < 0) return [...list];
  const clean = cleanLabNote({ ...list[index], ...(patch || {}) });
  if (!clean) return [...list];
  const next = list.slice();
  next[index] = { id, ...clean };
  return next;
}

/** Remove one lab note by id. */
export function removeLabNote(labNotes, id) {
  return (Array.isArray(labNotes) ? labNotes : []).filter((note) => !note || note.id !== id);
}
