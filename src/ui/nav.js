/** The bottom bar appears only once a month plan exists (first use shows the profile choice alone). */
export function shouldShowNav(state) {
  return Boolean(state && state.plan);
}
