/**
 * P1 — a target edit drops a pending update proposal.
 * A proposal is worked out against the targets as they were; after the targets
 * change (or after a reload) "Use updated" must not apply the old numbers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  proposalToStore, pendingProposalForPlan, withTargetsEdited, saveState, loadState, clearState,
} from '../src/store.js';

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

const targets = [
  { nutrient: 'satFat', kind: 'max', daily: 13 },
  { nutrient: 'protein', kind: 'min', daily: 60 },
];

const proposal = proposalToStore({
  plan: { month: '2026-10', days: { '2026-10-22': { lunch: 'x' } } },
  changed: [{ date: '2026-10-22', slot: 'lunch', before: 'a', after: 'x' }],
  effects: [{ nutrient: 'satFat', kind: 'max', before: 15, after: 12, status: 'Closer to target' }],
  reason: 'You logged 40.0 g of saturated fat today (goal: max 13.0 g), so the next 4 days are lower in saturated fat.',
});

function stateWithProposal() {
  return {
    targets: targets.map((t) => ({ ...t })),
    plan: { month: '2026-10', days: { '2026-10-22': { lunch: 'a' } } },
    planBase: null,
    log: [{ date: '2026-10-22', time: '13:00', items: [{ foodId: 'pizza-cheese', grams: 200 }] }],
    pendingProposal: proposal,
  };
}

test('editing a target value clears the pending proposal and keeps the rest', () => {
  const state = stateWithProposal();
  const edited = state.targets.map((t) => (t.nutrient === 'satFat' ? { ...t, daily: 15 } : t));
  const next = withTargetsEdited(state, edited);

  assert.equal(next.pendingProposal, null);
  assert.equal(pendingProposalForPlan(next), null, 'Use updated has nothing to apply');
  assert.equal(next.targets[0].daily, 15);
  assert.equal(next.plan, state.plan, 'the plan itself is untouched by a target edit');
  assert.deepEqual(next.log, state.log);
});

test('adding or removing a target also clears the pending proposal', () => {
  const added = withTargetsEdited(stateWithProposal(), [
    ...targets, { nutrient: 'fibre', kind: 'min', daily: 25 },
  ]);
  assert.equal(added.pendingProposal, null);
  assert.equal(added.targets.length, 3);

  const removed = withTargetsEdited(stateWithProposal(), [targets[0]]);
  assert.equal(removed.pendingProposal, null);
  assert.equal(removed.targets.length, 1);
});

test('after a reload the cleared proposal is not offered again', () => {
  installMemoryStorage();
  clearState();
  const next = withTargetsEdited(stateWithProposal(), [{ nutrient: 'satFat', kind: 'max', daily: 15 }]);
  saveState(next);
  const loaded = loadState();
  assert.equal(loaded.pendingProposal, null);
  assert.equal(pendingProposalForPlan(loaded), null);
  assert.equal(loaded.targets[0].daily, 15);
});

test('the Targets screen sends every target edit through the clearing helper', () => {
  const src = fs.readFileSync(new URL('../src/ui/targets.js', import.meta.url), 'utf8');
  assert.match(src, /withTargetsEdited/, 'targets.js imports and uses the helper');
  assert.equal(
    (src.match(/onChange\(withTargetsEdited\(/g) || []).length,
    3,
    'a value edit, an added target and a removed target all clear the proposal',
  );
  assert.doesNotMatch(src, /onChange\(\{ \.\.\.state, targets:/, 'no target edit bypasses the helper');
});
