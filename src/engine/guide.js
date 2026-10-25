// F6 — First-run guide: three short steps, shown once on a fresh device.
// Pure helpers only, so the rules can be tested without a browser.

/** The three steps shown the first time the app is opened. */
export const GUIDE_STEPS = [
  {
    title: 'Choose a goal',
    body: 'Pick a profile as a starting point, then adjust the daily targets to the ones you want to follow.',
  },
  {
    title: 'Build the plan',
    body: 'Build the month plan, then open the shopping list and tick what you already have at home.',
  },
  {
    title: 'Log your food',
    body: 'Mark planned meals on the day screen, or add food eaten outside the menu. A day over a limit updates the plan and shows why.',
  },
];

function isEmpty(state) {
  return !state.profileId && !state.plan;
}

/**
 * The guide appears only on a device with nothing saved yet (no profile and no
 * plan), and never again once it was dismissed.
 */
export function shouldShowGuide(state) {
  if (!state) return true;
  if (state.guideDismissed) return false;
  return isEmpty(state);
}

/** State after the guide is dismissed, so it is not opened automatically again. */
export function dismissGuideState(state) {
  const current = state || {};
  return Object.assign({}, current, { guideDismissed: true });
}
