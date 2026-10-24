// Device-local persistence. No accounts, no cloud.

const KEY = 'nutriplanner-v1';

const EMPTY = {
  profileId: null,
  targets: [],
  plan: null,
  log: [],
  bought: [],
  keptForBought: [],
  shopEvery: 7,
  shopStart: null,
  pendingProposal: null,
};

let storageNotice = null;

export function getStorageNotice() {
  return storageNotice;
}

/** Fields of a replan result that the Plan updated screen needs after a reload. */
export function proposalToStore(proposal) {
  if (!proposal) return null;
  return {
    plan: proposal.plan,
    changed: proposal.changed || [],
    effects: proposal.effects || [],
    reason: proposal.reason || '',
    unreachable: Boolean(proposal.unreachable),
    nothingToChange: Boolean(proposal.nothingToChange),
    keptForBought: proposal.keptForBought || [],
    skipNoMin: Boolean(proposal.skipNoMin),
  };
}

/**
 * A stored proposal belongs to the current plan when its month matches.
 * Returns the proposal, or null when it is missing or for another month.
 */
export function pendingProposalForPlan(state) {
  const pending = state?.pendingProposal;
  if (!pending || !state?.plan) return null;
  const pendingMonth = pending.plan?.month;
  if (pendingMonth && pendingMonth !== state.plan.month) return null;
  return pending;
}

/** Drop a stored proposal (after Use / Keep, or when the plan month is no longer current). */
export function withoutPendingProposal(state) {
  if (!state) return state;
  if (state.pendingProposal == null) return state;
  return { ...state, pendingProposal: null };
}

export function loadState() {
  storageNotice = null;
  try {
    if (typeof localStorage === 'undefined') {
      storageNotice = 'This browser cannot keep data between visits.';
      return { ...EMPTY };
    }
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY, bought: [], log: [], targets: [], keptForBought: [] };
    const data = JSON.parse(raw);
    return {
      profileId: data.profileId ?? null,
      targets: Array.isArray(data.targets) ? data.targets : [],
      plan: data.plan ?? null,
      log: Array.isArray(data.log) ? data.log : [],
      bought: Array.isArray(data.bought) ? data.bought : [],
      keptForBought: Array.isArray(data.keptForBought) ? data.keptForBought : [],
      shopEvery: [2, 3, 5, 7].includes(data.shopEvery) ? data.shopEvery : 7,
      shopStart: typeof data.shopStart === 'string' ? data.shopStart : null,
      pendingProposal: data.pendingProposal && typeof data.pendingProposal === 'object'
        ? data.pendingProposal
        : null,
    };
  } catch {
    storageNotice = 'Saved data could not be read; starting fresh for this session.';
    return { ...EMPTY, bought: [], log: [], targets: [], keptForBought: [] };
  }
}

export function saveState(state) {
  storageNotice = null;
  try {
    if (typeof localStorage === 'undefined') {
      storageNotice = 'This browser cannot keep data between visits.';
      return false;
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({
        profileId: state.profileId,
        targets: state.targets,
        plan: state.plan,
        log: state.log,
        bought: state.bought,
        keptForBought: state.keptForBought || [],
        shopEvery: state.shopEvery || 7,
        shopStart: state.shopStart || null,
        pendingProposal: state.pendingProposal || null,
      }),
    );
    return true;
  } catch {
    storageNotice = 'Data will not be kept after you close this page.';
    return false;
  }
}

export function clearState() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
