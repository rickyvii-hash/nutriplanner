// Device-local persistence. No accounts, no cloud.

const KEY = 'nutriplanner-v1';

const EMPTY = {
  profileId: null,
  targets: [],
  plan: null,
  log: [],
  bought: [],
  keptForBought: [],
};

let storageNotice = null;

export function getStorageNotice() {
  return storageNotice;
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
