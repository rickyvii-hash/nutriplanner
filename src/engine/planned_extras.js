// Meals the person already knows they will eat outside the menu (D26).
// A planned meal is expected intake, not eaten food: it is stored apart from
// the log, it never counts as logged, and the plan only uses it on its own date.

import { displayFoodName } from './food_display.js';

/** The time a planned meal defaults to when the person does not pick one. */
export const PLANNED_DEFAULT_TIME = '20:00';

/** Headline of a planned outside-the-menu meal on the day screen. */
export const PLANNED_EXTRA_LABEL = 'Planned outside the menu';

/** A planned meal whose day has passed without "Ate it" was never eaten. */
export const PLANNED_EXTRA_NOT_LOGGED = 'Planned outside the menu · not logged';

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isTimeText(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ''));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** The next calendar day as YYYY-MM-DD, without time-zone drift. */
export function nextDayIso(isoDate) {
  const [year, month, day] = String(isoDate || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The food lines of a planned meal: a real food id and a positive number of grams. */
function cleanItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      foodId: typeof item?.foodId === 'string' ? item.foodId : '',
      grams: Number(item?.grams),
      name: typeof item?.name === 'string' ? item.name : '',
    }))
    .filter((item) => item.foodId && Number.isFinite(item.grams) && item.grams > 0)
    .map((item) => (item.name
      ? { foodId: item.foodId, grams: item.grams, name: item.name }
      : { foodId: item.foodId, grams: item.grams }));
}

/**
 * One planned outside-the-menu meal: { id, date, time, items }. The id keeps the
 * entry addressable on the day screen even when two planned meals share a day.
 */
export function makePlannedExtra({
  id = null, date = '', time = PLANNED_DEFAULT_TIME, items = [],
} = {}) {
  const clean = cleanItems(items);
  const day = isDateText(date) ? date : '';
  const clock = isTimeText(time) ? time : PLANNED_DEFAULT_TIME;
  return {
    id: typeof id === 'string' && id ? id : `planned-${day}-${clock}-${clean.map((item) => item.foodId).join('-')}`,
    date: day,
    time: clock,
    items: clean,
  };
}

/** Saved planned meals that still hold a date and at least one food. Older data stays readable. */
export function normalizePlannedExtras(list) {
  return (Array.isArray(list) ? list : [])
    .filter((entry) => entry && typeof entry === 'object' && isDateText(entry.date))
    .map((entry) => makePlannedExtra(entry))
    .filter((entry) => entry.items.length > 0);
}

/** The log entry "Ate it" writes: the same foods, date and time, now eaten food. */
export function plannedExtraToLogEntry(extra) {
  const entry = makePlannedExtra(extra);
  return {
    date: entry.date,
    time: entry.time,
    extra: true,
    items: entry.items.map((item) => ({ ...item })),
  };
}

/** The food names the day screen and the reason show, brand-free for database foods. */
export function plannedExtraFoodNames(extra, foodsById = null) {
  return (extra?.items || []).map((item) => {
    const food = foodsById?.get?.(item.foodId) || null;
    return displayFoodName(food) || item.name || 'Food';
  });
}

/** "Planned outside the menu · 20:00", or "not logged" once the day has passed. */
export function plannedExtraLabel(extra, { today = null } = {}) {
  if (today && extra?.date && extra.date < today) return PLANNED_EXTRA_NOT_LOGGED;
  return `${PLANNED_EXTRA_LABEL} · ${extra?.time || PLANNED_DEFAULT_TIME}`;
}

/** The planned meals of one date, oldest time first. */
export function plannedExtrasForDate(list, date) {
  return normalizePlannedExtras(list)
    .filter((extra) => extra.date === date)
    .sort((a, b) => {
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}
