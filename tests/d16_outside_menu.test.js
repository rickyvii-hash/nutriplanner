/**
 * D16 (P1 UX): the Log screen becomes "Outside the menu".
 *
 * Planned meals are handled on the day screen (Ate it / Skipped / Replace /
 * Undo / Change), so the screen opened from the day card only holds the former
 * Extra flow: a food search with a portion in grams, the Drinks shortcut, the
 * "To add" draft and "Save and update plan". No tabs, no planned-meal rows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import { buildPlan, replan } from '../src/engine/planner.js';
import {
  newLogDraft,
  draftSavePayload,
  logEntriesForSave,
  mergeLogEntries,
  savedSlotOutcomes,
} from '../src/ui/log.js';
import { logEntryKind } from '../src/ui/plan.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const foods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8'));
const logSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'log.js'), 'utf8');
const planSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'plan.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const navSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'nav.js'), 'utf8');
const updatedSrc = fs.readFileSync(path.join(root, 'src', 'ui', 'updated.js'), 'utf8');

const foodsById = new Map(foods.map((f) => [f.id, f]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const month = { year: 2026, month: 10 };
const FROM = '2026-10-21';
const when = { date: FROM, time: '15:00' };
const targets = profileById('cholesterol').targets;
const plan = buildPlan(targets, recipes, month, foodsById);
const pizza = foods.find((f) => /pizza/i.test(f.name));

// --- Entry point and copy --------------------------------------------------

test('D16: the day card opens "Add food outside the menu", not "Log a meal"', () => {
  assert.match(planSrc, />Add food outside the menu<\/button>/);
  assert.match(planSrc, /Food outside your meals\? Use Add food outside the menu\./);
  assert.match(planSrc, /data-action="log"/);
  // The old entry label is gone from every visible screen source.
  assert.doesNotMatch(planSrc, /Log a meal/);
  assert.doesNotMatch(logSrc, /Log a meal/);
  assert.doesNotMatch(updatedSrc, /Log a meal/);
});

test('D16: the screen is titled "Outside the menu" with the asked subtitle', () => {
  assert.match(logSrc, /<h1>Outside the menu<\/h1>/);
  assert.match(logSrc, /Anything you ate or drank that was not one of your planned meals\./);
  assert.match(logSrc, /Support tool, not medical advice\./);
  // The back link returns to the day screen.
  assert.match(logSrc, /data-back/);
  assert.match(logSrc, /ctx\.navigate\('plan'\)/);
});

test('D16: the two-tab switch is gone and the Extra content shows directly', () => {
  assert.doesNotMatch(logSrc, /mode-tab/);
  assert.doesNotMatch(logSrc, /data-mode/);
  assert.doesNotMatch(logSrc, /From plan/);
  assert.doesNotMatch(logSrc, /data-body="plan"/);
});

test('D16: the screen has no planned-meal rows and no draft-group UI', () => {
  for (const pattern of [
    /plan-meal-row/,
    /data-add-recipe/,
    /data-skip-recipe/,
    /data-clear-choice/,
    /data-replace-recipe/,
    /logged-group/,
    /In this meal/,
  ]) {
    assert.doesNotMatch(logSrc, pattern, 'removed planned-meal UI still in log.js');
  }
});

test('D16: the former Extra flow stays: search, grams, Drinks, To add, Clear all, save', () => {
  assert.match(logSrc, /<span>Search a food<\/span>/);
  assert.match(logSrc, /<span>Portion \(grams\)<\/span>/);
  assert.match(logSrc, /data-drinks/);
  assert.match(logSrc, /Glass 200 ml/);
  assert.match(logSrc, /<h3>To add<\/h3>/);
  assert.match(logSrc, />Clear all<\/button>/);
  assert.match(logSrc, /data-clear-all/);
  assert.match(logSrc, />Save and update plan<\/button>/);
  assert.match(logSrc, /saveLogAndReplan\(draftSavePayload\(draft\)\)/);
});

// --- The save still behaves exactly like the old Extra path ----------------

test('D16: saving an extra produces the same log entry as before and replans', () => {
  assert.ok(pizza, 'data needs a pizza food');
  const draft = newLogDraft();
  draft.items.push({ foodId: pizza.id, grams: 350 });

  const payload = draftSavePayload(draft);
  assert.equal(payload.extra, true, 'free-search foods are extras');
  assert.deepEqual(payload.eaten, []);
  assert.deepEqual(payload.skipped, []);

  const entries = logEntriesForSave(payload, when);
  assert.equal(entries.length, 1, 'an extra-only log is one entry');
  assert.equal(entries[0].extra, true);
  assert.deepEqual(entries[0].items, [{ foodId: pizza.id, grams: 350 }]);

  const log = mergeLogEntries([], entries, {
    date: FROM, planDay: plan.days[FROM], recipesById,
  });
  assert.equal(log.length, 1);

  const result = replan({
    targets, recipes, plan, log, bought: [], foodsById, fromDate: FROM,
  });
  assert.ok(result.reason.length > 0, 'the replan explains itself');
  assert.ok(result.changed.length > 0, 'the off-plan extra changes the next days');
  assert.equal(result.replacements.length, 0, 'an extra never replaces a planned meal');
  assert.deepEqual(result.skippedNames, []);
});

// --- Old saved entries still display and correct on the day screen ---------

test('D16: saved eaten, skipped, replaced and extra entries still render', () => {
  const lunchId = plan.days[FROM].lunch;
  const lunch = recipesById.get(lunchId);
  const other = recipes.find((r) => r.slot === lunch.slot && r.id !== lunch.id);

  const eaten = {
    date: FROM, time: '13:00',
    items: lunch.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
    eaten: [{ recipeId: lunch.id, slot: lunch.slot }],
  };
  const skipped = {
    date: FROM, time: '13:00',
    skipped: [lunch.id], items: [],
    skippedSlots: [{ recipeId: lunch.id, slot: lunch.slot }],
  };
  const replaced = {
    date: FROM, time: '13:00',
    items: other.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams })),
    replaced: [{ slot: lunch.slot, recipeId: other.id, fromRecipeId: lunch.id }],
  };
  const extra = {
    date: FROM, time: '16:00', extra: true,
    items: [{ foodId: pizza.id, grams: 200 }],
  };

  assert.equal(logEntryKind(eaten, lunch), 'Eaten · ' + lunch.slot);
  assert.equal(logEntryKind(skipped, lunch), 'Skipped');
  assert.equal(logEntryKind(replaced, lunch), 'Eaten · replaced');
  assert.equal(logEntryKind(extra, null), 'Outside the menu');

  // The day-screen Logged meals card reads the same saved outcomes and edits them.
  const outcomes = savedSlotOutcomes([eaten, skipped, replaced, extra], FROM, plan.days[FROM], recipesById);
  assert.equal(outcomes.get(lunch.slot)?.kind, 'replaced');
  assert.match(planSrc, /<h3>Logged meals<\/h3>/);
  assert.match(planSrc, /data-correct-remove/);
  assert.match(planSrc, /savedSlotOutcomes\(state\.log, selected/);
});

test('D16: the shopping Swap hand-off still opens the day screen picker', () => {
  assert.match(planSrc, /replaceForwardSlot\(/);
  assert.match(planSrc, /createReplacePicker\(/);
  assert.match(appSrc, /if \(name !== 'plan'\) ctx\.openReplace = null;/);
  // The outside-the-menu screen no longer reads a Replace hand-off.
  assert.doesNotMatch(logSrc, /openReplace/);
  // The screen still shows in the bottom navigation like the other plan views.
  assert.match(appSrc, /ctx\.screen === 'log'/);
  assert.match(navSrc, /state && state\.plan/);
});
