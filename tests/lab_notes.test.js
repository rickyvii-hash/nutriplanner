/**
 * F5 — Lab notes: local values + intake chart, no interpretation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LAB_DISCLAIMER,
  weeklyIntakeSeries,
  labSeriesByName,
  alignSeriesWithGaps,
} from '../src/engine/lab_notes.js';
import { weeklyAverages } from '../src/ui/lab_notes.js';

const foods = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const foodsById = new Map(foods.map((f) => [f.id, f]));

test('disclaimer text is fixed and non-causal', () => {
  assert.match(LAB_DISCLAIMER, /two separate records/i);
  assert.match(LAB_DISCLAIMER, /do not show cause and effect/i);
  assert.match(LAB_DISCLAIMER, /doctor/i);
  assert.doesNotMatch(LAB_DISCLAIMER, /better|worse|improve|risk|treat/i);
});

test('missing intake days are gaps (null), never zero', () => {
  const log = [
    { date: '2026-10-01', items: [{ foodId: 'pizza-cheese', grams: 100 }] },
    // 2026-10-02 missing
    { date: '2026-10-03', items: [{ foodId: 'pizza-cheese', grams: 50 }] },
  ];
  const series = weeklyIntakeSeries(log, 'satFat', foodsById, {
    from: '2026-10-01',
    to: '2026-10-03',
  });
  assert.ok(Array.isArray(series));
  const byDay = Object.fromEntries(series.map((p) => [p.date, p.value]));
  assert.equal(typeof byDay['2026-10-01'], 'number');
  assert.equal(byDay['2026-10-02'], null, 'gap must be null, not 0');
  assert.equal(typeof byDay['2026-10-03'], 'number');
  assert.notEqual(byDay['2026-10-02'], 0);
  const gap = series.find((p) => p.date === '2026-10-02');
  assert.equal(gap.incomplete, false, 'a day with no log is a gap, not an incomplete sum');
  assert.equal(series.find((p) => p.date === '2026-10-01').incomplete, false);
});

test('a day where a logged food lacks the nutrient is incomplete, not a partial exact value', () => {
  // This beer has no satFat value in the food data: the day's sum would be partial.
  const log = [
    {
      date: '2026-10-01',
      items: [
        { foodId: 'pizza-cheese', grams: 100 },
        { foodId: 'alcoholic-beverage-beer-light-bud-light', grams: 200 },
      ],
    },
    // A day whose only logged foods have no value for this nutrient is incomplete too.
    { date: '2026-10-02', items: [{ foodId: 'alcoholic-beverage-beer-light-bud-light', grams: 200 }] },
    { date: '2026-10-03', items: [{ foodId: 'pizza-cheese', grams: 100 }] },
  ];
  const series = weeklyIntakeSeries(log, 'satFat', foodsById, {
    from: '2026-10-01',
    to: '2026-10-03',
  });
  const partial = series.find((p) => p.date === '2026-10-01');
  assert.equal(partial.incomplete, true, 'a missing value marks the day incomplete');
  assert.equal(partial.value, null, 'a partial sum is never shown as an exact value');
  const missingOnly = series.find((p) => p.date === '2026-10-02');
  assert.equal(missingOnly.incomplete, true);
  assert.equal(missingOnly.value, null, 'unknown is never turned into zero');
  const known = series.find((p) => p.date === '2026-10-03');
  assert.equal(known.incomplete, false);
  assert.equal(typeof known.value, 'number');
});

test('weekly averages: a week with an incomplete day has no certain mean', () => {
  // 2026-10-01 is incomplete: its logged foods lack the nutrient, so the day has
  // no exact value. Averaging only the complete days of that week would present
  // a certain number the data does not support.
  const log = [
    { date: '2026-10-01', items: [{ foodId: 'alcoholic-beverage-beer-light-bud-light', grams: 200 }] },
    { date: '2026-10-02', items: [{ foodId: 'pizza-cheese', grams: 100 }] },
    { date: '2026-10-03', items: [{ foodId: 'pizza-cheese', grams: 200 }] },
    { date: '2026-10-08', items: [{ foodId: 'pizza-cheese', grams: 100 }] },
  ];
  const daily = weeklyIntakeSeries(log, 'satFat', foodsById, { from: '2026-10-01', to: '2026-10-14' });
  const weeks = weeklyAverages(daily);
  assert.equal(weeks.length, 2);

  const partialWeek = weeks[0];
  assert.equal(partialWeek.date, '2026-10-01');
  assert.equal(partialWeek.incomplete, true, 'the partial day makes the whole week incomplete');
  assert.equal(partialWeek.value, null, 'an incomplete week is never an exact average');

  const completeWeek = weeks[1];
  assert.equal(completeWeek.incomplete, false);
  assert.equal(typeof completeWeek.value, 'number', 'a week with complete days keeps its average');
});

test('weekly averages: no logged day in a week stays a gap, and complete days average', () => {
  const series = [
    { date: '2026-10-01', value: 10, incomplete: false },
    { date: '2026-10-02', value: null, incomplete: false },
    { date: '2026-10-03', value: 20, incomplete: false },
    { date: '2026-10-04', value: null, incomplete: false },
    { date: '2026-10-05', value: null, incomplete: false },
    { date: '2026-10-06', value: null, incomplete: false },
    { date: '2026-10-07', value: null, incomplete: false },
    { date: '2026-10-08', value: null, incomplete: false },
    { date: '2026-10-09', value: null, incomplete: false },
    { date: '2026-10-10', value: null, incomplete: false },
    { date: '2026-10-11', value: null, incomplete: false },
    { date: '2026-10-12', value: null, incomplete: false },
    { date: '2026-10-13', value: null, incomplete: false },
    { date: '2026-10-14', value: null, incomplete: false },
  ];
  const weeks = weeklyAverages(series);
  assert.equal(weeks[0].value, 15, 'the mean covers only the days that have a value');
  assert.equal(weeks[0].incomplete, false);
  assert.equal(weeks[1].value, null, 'a week with no logged day is a gap, not a zero');
  assert.equal(weeks[1].incomplete, false);
});

test('labSeriesByName groups entered values by date', () => {
  const notes = [
    { id: 'a', name: 'LDL', value: 130, unit: 'mg/dL', date: '2026-09-01', note: '' },
    { id: 'b', name: 'LDL', value: 120, unit: 'mg/dL', date: '2026-10-01', note: 'lab' },
    { id: 'c', name: 'HbA1c', value: 5.5, unit: '%', date: '2026-10-01', note: '' },
  ];
  const series = labSeriesByName(notes, 'LDL');
  assert.equal(series.length, 2);
  assert.equal(series[0].value, 130);
  assert.equal(series[1].value, 120);
});

test('alignSeriesWithGaps keeps lab and intake as separate series', () => {
  const labs = [{ date: '2026-10-01', value: 100 }, { date: '2026-10-08', value: 90 }];
  const intake = [{ date: '2026-10-01', value: 12 }, { date: '2026-10-02', value: null }];
  const aligned = alignSeriesWithGaps(labs, intake);
  assert.ok(aligned.labs && aligned.intake);
  assert.doesNotMatch(JSON.stringify(aligned), /correlation|cause|better/i);
});

test('UI source: Lab notes screen and disclaimer; no interpretive wording', () => {
  const src = fs.readFileSync(new URL('../src/ui/lab_notes.js', import.meta.url), 'utf8');
  assert.match(src, /Lab notes/);
  assert.match(src, /two separate records/i);
  assert.doesNotMatch(src, /better|worse|improving|worsening|you should|recommend/i);
});

test('doctor summary includes lab values under the same note', () => {
  const src = fs.readFileSync(new URL('../src/ui/summary.js', import.meta.url), 'utf8');
  assert.match(src, /Lab notes|lab notes/i);
  assert.match(src, /cause and effect|two separate records/i);
});
