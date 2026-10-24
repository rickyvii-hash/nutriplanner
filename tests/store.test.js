import test from 'node:test';
import assert from 'node:assert/strict';
import {
  proposalToStore,
  pendingProposalForPlan,
  withoutPendingProposal,
  saveState,
  loadState,
  clearState,
  currentMonthKey,
  formatMonthYear,
  stalePlanBanner,
  applyStaleMonthOnStart,
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

test('currentMonthKey and formatMonthYear are stable pure helpers', () => {
  assert.equal(currentMonthKey(new Date(2026, 9, 24)), '2026-10');
  assert.equal(currentMonthKey(new Date(2026, 10, 1)), '2026-11');
  assert.equal(formatMonthYear('2026-10'), 'October 2026');
  assert.equal(formatMonthYear('2026-11'), 'November 2026');
});

test('stalePlanBanner is null for the current month and set for an old month', () => {
  const now = new Date(2026, 10, 1); // 1 November 2026
  assert.equal(stalePlanBanner('2026-11', now), null);
  assert.equal(
    stalePlanBanner('2026-10', now),
    'Your saved plan is for October 2026. Build the plan for November 2026.',
  );
  assert.equal(stalePlanBanner(null, now), null);
});

test('applyStaleMonthOnStart clears an old plan, keeps log and shopping, drops the proposal', () => {
  const now = new Date(2026, 10, 1);
  const state = {
    profileId: 'recovery',
    targets: [{ nutrient: 'kcal', kind: 'min', daily: 2200 }],
    plan: { month: '2026-10', days: { '2026-10-15': { breakfast: 'a' } } },
    log: [{ date: '2026-10-15', time: '12:00', items: [{ foodId: 'apple-raw', grams: 100 }] }],
    bought: ['spinach-raw'],
    keptForBought: [{ date: '2026-10-16', slot: 'lunch', recipeId: 'x' }],
    shopEvery: 3,
    shopStart: '2026-10-14',
    pendingProposal: proposalToStore(sampleProposal),
  };
  const result = applyStaleMonthOnStart(state, now);
  assert.equal(result.screenHint, 'targets');
  assert.match(result.banner, /October 2026/);
  assert.match(result.banner, /November 2026/);
  assert.equal(result.state.plan, null);
  assert.equal(result.state.pendingProposal, null);
  assert.equal(result.state.keptForBought.length, 0);
  assert.equal(result.state.log.length, 1);
  assert.deepEqual(result.state.bought, ['spinach-raw']);
  assert.equal(result.state.shopEvery, 3);
  assert.equal(result.state.targets[0].daily, 2200);
  assert.equal(result.state.profileId, 'recovery');
});

test('applyStaleMonthOnStart leaves a current-month plan alone', () => {
  const now = new Date(2026, 9, 24);
  const state = {
    plan: { month: '2026-10', days: {} },
    log: [],
    pendingProposal: null,
  };
  const result = applyStaleMonthOnStart(state, now);
  assert.equal(result.banner, null);
  assert.equal(result.screenHint, 'plan');
  assert.equal(result.state.plan.month, '2026-10');
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
