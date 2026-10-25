/**
 * P1-2: a restore that brings back a plan for another calendar month follows the
 * same stale-month path as a reload. The old month's first day is never opened as
 * Today, and the Targets screen explains what happened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildExportPayload, applyImportPayload } from '../src/engine/export_import.js';
import { emptyAppState, restoredStateAndScreen } from '../src/store.js';

const NOW = new Date(2026, 9, 25); // 2026-10-25, local time

function backupWithPlan(month) {
  return buildExportPayload({
    ...emptyAppState(),
    profileId: 'cholesterol',
    targets: [{ nutrient: 'satFat', kind: 'max', daily: 13 }],
    plan: { month, days: { [month + '-01']: { lunch: 'recipe-lunch' } } },
    log: [{ date: month + '-01', time: '12:00', items: [{ foodId: 'pizza-cheese', grams: 100 }] }],
    bought: ['pizza-cheese'],
  });
}

test('P1-2: restoring a plan from a past month clears it and shows the Targets banner', () => {
  const imported = applyImportPayload(emptyAppState(), backupWithPlan('2026-09'));
  assert.equal(imported.plan.month, '2026-09', 'the file does bring an old month plan');

  const restored = restoredStateAndScreen(imported, NOW);

  assert.equal(restored.state.plan, null, 'the old month plan is cleared, never opened as today');
  assert.equal(restored.state.planBase, null);
  assert.ok(restored.banner, 'a banner must explain the cleared plan');
  assert.match(restored.banner, /September 2026/);
  assert.match(restored.banner, /October 2026/);
  assert.equal(restored.screen, 'targets', 'the person lands on Targets, not on the old plan');
  assert.deepEqual(restored.state.log, imported.log, 'the restored log is kept');
  assert.deepEqual(restored.state.bought, imported.bought, 'the restored shopping ticks are kept');
});

test('P1-2: restoring a plan for the current month keeps it and opens the plan', () => {
  const imported = applyImportPayload(emptyAppState(), backupWithPlan('2026-10'));
  const restored = restoredStateAndScreen(imported, NOW);

  assert.equal(restored.state.plan.month, '2026-10');
  assert.equal(restored.banner, null);
  assert.equal(restored.screen, 'plan');
});

test('P1-2: the restore confirmation applies the stale-month path', () => {
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const body = src.match(/confirmRestore:[\s\S]*?\n  \},/);
  assert.ok(body, 'confirmRestore must exist');
  assert.match(body[0], /restoredStateAndScreen|applyStaleMonthOnStart/);
  assert.match(body[0], /ctx\.monthBanner = restored\.banner|ctx\.monthBanner = stale\.banner/);
});
