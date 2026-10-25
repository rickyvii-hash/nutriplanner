/**
 * Display names for foods must not show third-party trademarks.
 * USDA source strings stay on `food.name` / id for provenance and search;
 * every on-screen label goes through `displayFoodName`.
 */

/**
 * Brand and product-trademark tokens found in this app's USDA food list
 * (case-insensitive match). Restaurant names and signature product lines are
 * both listed, because neither may reach an on-screen label.
 */
export const FOOD_BRAND_TOKENS = [
  "APPLEBEE'S",
  "ARBY'S",
  'BIG DADDY',
  "BIG DADDY'S",
  "BIG DADDY'S LS 16",
  'BREYERS',
  'BUD LIGHT',
  'BUDWEISER',
  'BURGER KING',
  'CHOBANI',
  'CLASSIC SINGLE',
  "DENNY'S",
  'DIGIORNO',
  "DOMINO'S",
  'EXTRAVAGANZZA',
  'EXTRAVAGANZZA FEAST',
  'FAST BREAK',
  'LITTLE CAESARS',
  "MCDONALD'S",
  "MOTT'S",
  'MOTTS',
  'OCEAN SPRAY',
  'ORIGINAL ROUND',
  "PAPA JOHN'S",
  'PAPA JOHN',
  'PIZZA HUT',
  'RALSTON',
  "REESE'S",
  'SMARTPIZZA',
  'SUPER SUPREME',
  "T.G.I. FRIDAY'S",
  "TGI FRIDAY'S",
  'THE WORKS',
  "THIN 'N CRISPY",
  'THIN N CRISPY',
  'TONY',
  "TONY'S",
  "TONY'S SMARTPIZZA",
  'ULTIMATE DEEP DISH',
  "WENDY'S",
  'ZEVIA',
];

/** Longest-first so "BUD LIGHT" wins over a shorter accidental match. */
const BRAND_RE = new RegExp(
  `\\b(?:${FOOD_BRAND_TOKENS
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b`,
  'gi',
);

/**
 * True when a displayed string still contains a known brand token.
 */
export function displayNameHasBrand(text) {
  if (!text) return false;
  BRAND_RE.lastIndex = 0;
  return BRAND_RE.test(String(text));
}

/**
 * Strip brand tokens from a USDA food name for on-screen use.
 * Returns '' when nothing useful remains (caller should hide the food).
 */
export function stripBrandFromName(name) {
  let out = String(name ?? '');
  out = out.replace(BRAND_RE, ' ');
  // Common leftovers after a leading brand: commas, "SELECT", double spaces.
  out = out
    .replace(/\bSELECT\b/gi, ' ')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Drop a trailing orphaned comma phrase that is only punctuation.
  out = out.replace(/^,\s*/, '').replace(/,\s*$/, '').trim();
  if (out.length < 3) return '';
  // Capitalise first letter if the strip left a lowercase fragment.
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Name shown in the UI. Prefer a stripped name; fall back to empty string when
 * the entry cannot be shown without a trademark (search should skip it).
 */
export function displayFoodName(foodOrName) {
  const raw = typeof foodOrName === 'string'
    ? foodOrName
    : (foodOrName?.name || '');
  const stripped = stripBrandFromName(raw);
  if (!stripped) return '';
  if (displayNameHasBrand(stripped)) return '';
  return stripped;
}

/** Foods safe to offer in free search (have a brand-free display name). */
export function foodsForDisplay(foods) {
  return (Array.isArray(foods) ? foods : []).filter((f) => displayFoodName(f));
}
