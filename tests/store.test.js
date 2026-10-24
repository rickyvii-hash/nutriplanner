import test from 'node:test';
import assert from 'node:assert/strict';
import {
  proposalToStore,
  pendingProposalForPlan,
  withoutPendingProposal,
  saveState,
  loadState,
  clearState,
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

const sampleProposal = {
  plan: { month: '2026-10', days: { '2026-10-22': { breakfast: 'a', lunch: 'b', dinner: 'c', snack: 'd' } } },
  changed: [{ date: '2026-10-22', slot: 'lunch', before: 'x', after: 'y' }],
  effects: [{ nutrient: 'kcal', kind: 'max', before: 2000, after: 1800, status: 'Closer to target' }],
  reason: 'You logged 40.0 g of saturated fat today (goal: max 13.0 g), so the next 4 days are lower in saturated fat.',
  unreachable: false,
  nothingToChange: false,
  keptForBought: [{ date: '2026-10-22', slot: 'dinner', recipeId: 'c' }],
  skipNoMin: false,
  windowDates: ['2026-10-22'],
};

test('proposalToStore keeps the fields the Plan updated screen needs', () => {
  const stored = proposalToStore(sampleProposal);
  assert.equal(stored.plan.month, '2026-10');
  assert.equal(stored.changed.length, 1);
  assert.equal(stored.effects.length, 1);
  assert.match(stored.reason, /saturated fat/);
  assert.equal(stored.unreachable, false);
  assert.equal(stored.nothingToChange, false);
  assert.equal(stored.keptForBought.length, 1);
  // Extra planner fields are dropped so the saved blob stays small.
  assert.equal(stored.windowDates, undefined);
});

test('proposalToStore returns null for a missing proposal', () => {
  assert.equal(proposalToStore(null), null);
  assert.equal(proposalToStore(undefined), null);
});

test('pendingProposalForPlan returns the proposal when the month matches', () => {
  const state = {
    plan: { month: '2026-10', days: {} },
    pendingProposal: proposalToStore(sampleProposal),
  };
  const pending = pendingProposalForPlan(state);
  assert.ok(pending);
  assert.equal(pending.plan.month, '2026-10');
  assert.equal(pending.changed.length, 1);
});

test('pendingProposalForPlan drops a proposal for another month', () => {
  const state = {
    plan: { month: '2026-11', days: {} },
    pendingProposal: proposalToStore(sampleProposal),
  };
  assert.equal(pendingProposalForPlan(state), null);
});

test('pendingProposalForPlan returns null when there is no plan or no proposal', () => {
  assert.equal(pendingProposalForPlan({ plan: null, pendingProposal: proposalToStore(sampleProposal) }), null);
  assert.equal(pendingProposalForPlan({ plan: { month: '2026-10' }, pendingProposal: null }), null);
  assert.equal(pendingProposalForPlan(null), null);
});

test('withoutPendingProposal clears a stored proposal', () => {
  const state = {
    plan: { month: '2026-10' },
    log: [{ date: '2026-10-21', items: [] }],
    pendingProposal: proposalToStore(sampleProposal),
  };
  const cleared = withoutPendingProposal(state);
  assert.equal(cleared.pendingProposal, null);
  assert.equal(cleared.plan.month, '2026-10');
  assert.equal(cleared.log.length, 1);
  // Original state is not mutated.
  assert.ok(state.pendingProposal);
});

test('saveState and loadState round-trip a pending proposal; clearState removes it', () => {
  installMemoryStorage();
  const state = {
    profileId: 'cholesterol',
    targets: [{ nutrient: 'satFat', kind: 'max', daily: 13 }],
    plan: { month: '2026-10', days: {} },
    log: [{ date: '2026-10-21', time: '20:00', items: [{ foodId: 'pizza-cheese', grams: 350 }] }],
    bought: [],
    keptForBought: [],
    shopEvery: 7,
    shopStart: '2026-10-21',
    pendingProposal: proposalToStore(sampleProposal),
  };
  assert.equal(saveState(state), true);
  const loaded = loadState();
  assert.equal(loaded.pendingProposal.plan.month, '2026-10');
  assert.equal(loaded.pendingProposal.changed.length, 1);
  assert.match(loaded.pendingProposal.reason, /saturated fat/);
  assert.ok(pendingProposalForPlan(loaded));

  clearState();
  const empty = loadState();
  assert.equal(empty.pendingProposal, null);
  assert.equal(empty.plan, null);
});
