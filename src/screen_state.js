// Transient screen state lasts only for the next paint: a hand-off from the
// shopping list, a status line, a minimised banner, a correction notice or the
// one-shot scroll guard. Any action that replaces the saved state resets all of
// them together, so an old value can never leak onto the new screen.

export const TRANSIENT_SCREEN_KEYS = [
  'openReplace',
  'dayStatus',
  'dayBannerMinimized',
  'logNotice',
  'suppressStripScroll',
];

/** The value each transient key has before any screen sets it. */
export const TRANSIENT_SCREEN_DEFAULTS = {
  openReplace: null,
  dayStatus: null,
  dayBannerMinimized: false,
  logNotice: null,
  suppressStripScroll: false,
};

/**
 * Reset every transient screen value on `ctx` in place and return it.
 * The saved state (targets, plan, log, shopping) is untouched.
 */
export function resetTransientScreenState(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  for (const key of TRANSIENT_SCREEN_KEYS) {
    ctx[key] = TRANSIENT_SCREEN_DEFAULTS[key];
  }
  return ctx;
}
