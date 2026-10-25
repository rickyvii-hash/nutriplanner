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

/** Sentence case: a capital first letter, the rest in lower case. */
function sentenceCase(text) {
  const lower = String(text ?? '').toLowerCase();
  return lower.replace(/[a-z]/, (letter) => letter.toUpperCase());
}

/** True when the text has fewer than three letters (a trademark-only row). */
function hasEnoughLetters(text) {
  return String(text ?? '').replace(/[^A-Za-z]/g, '').length >= 3;
}

/**
 * Make one brand-free name read naturally:
 * - a leading size ("12 Cheese Pizza") moves to the end as "(12 in)";
 * - stray punctuation, doubled spaces and doubled commas are removed;
 * - a leading lone letter left by a brand strip is dropped;
 * - the first word is capitalised and the rest is lower case.
 * Returns '' when nothing useful remains (caller should hide the food).
 */
export function stripBrandFromName(name) {
  let out = String(name ?? '').replace(BRAND_RE, ' ');
  // Common leftovers after a leading brand: commas, "SELECT", extra spaces.
  out = out
    .replace(/\bSELECT\b/gi, ' ')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  out = out.replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '').trim();

  // A size at the front of what is left ("12", "14") belongs at the end.
  let size = '';
  const leadingSize = /^(\d{1,2}(?:\.\d+)?)\s*(?:["”]|in(?:ch(?:es)?)?|cm)?\s*[-,;:]?\s+/i.exec(out);
  if (leadingSize) {
    size = leadingSize[1];
    out = out.slice(leadingSize[0].length);
  }

  // A lone letter at the start is a leftover, not part of the dish name.
  out = out.replace(/^([A-Za-z])(?=\s*[,;:\-–—]|\s+)/, ' ');
  out = out
    .replace(/\s*,\s*/g, ', ')
    .replace(/^\s*,\s*/, '')
    .replace(/,\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // A bare "crust" left after a trademark was removed adds nothing.
  out = out.replace(/,\s*crust\s*$/i, '').trim();

  if (!hasEnoughLetters(out)) return '';
  out = sentenceCase(out);
  if (size) out += ` (${size} in)`;
  return out;
}

/** The source string a food shows: the stored USDA name. */
function sourceName(food) {
  if (!food || typeof food !== 'object') return String(food ?? '');
  return food.name || food.usdaName || '';
}

/**
 * A real distinguishing detail for a food whose short name collides with
 * another: the last part of the full USDA name that the short name leaves out
 * ("with added ascorbic acid", "salted", "calcium, and potassium").
 */
function extraNameDetail(food, base) {
  const full = stripBrandFromName(food?.usdaName || '');
  if (!full || full === base) return '';
  const lowerBase = String(base).toLowerCase();
  const segments = full.split(',').map((part) => part.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (!lowerBase.includes(segment.toLowerCase()) && !displayNameHasBrand(segment)) {
      return segment;
    }
  }
  return '';
}

/** A stable key for a food inside the display-name index. */
function foodKey(food, index) {
  return food?.id || `#${index}`;
}

/** The real USDA record number, used only when two names would still collide. */
function collisionDetail(food, index) {
  if (food?.fdcId !== undefined && food?.fdcId !== null && food?.fdcId !== '') {
    return `USDA ${food.fdcId}`;
  }
  // Without a record number the position in the list is the only stable detail.
  return String(index + 1);
}

const NAME_INDEX = new WeakMap();

/**
 * The display name of every food in a list, kept unique.
 * Two foods can produce the same words after their brands are removed (six
 * restaurant "French fries", for example). The first keeps the plain name; a
 * later one adds a real distinguishing detail in parentheses, never a brand.
 */
export function displayNamesFor(foods) {
  if (!Array.isArray(foods)) return new Map();
  if (NAME_INDEX.has(foods)) return NAME_INDEX.get(foods);

  const entries = [];
  foods.forEach((food, index) => {
    const base = stripBrandFromName(sourceName(food));
    if (base) entries.push({ food, base, index });
  });

  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.base)) groups.set(entry.base, []);
    groups.get(entry.base).push(entry);
  }

  const names = new Map();
  for (const [base, group] of groups) {
    if (group.length === 1) {
      const entry = group[0];
      names.set(foodKey(entry.food, entry.index), base);
      continue;
    }
    const usedDetails = new Set();
    group.forEach((entry, position) => {
      const realDetail = extraNameDetail(entry.food, base);
      let detail = realDetail && !usedDetails.has(realDetail.toLowerCase())
        ? realDetail
        : collisionDetail(entry.food, position);
      // Even a record number must not repeat: add the position in that case.
      let suffix = 2;
      while (usedDetails.has(detail.toLowerCase())) {
        detail = `${collisionDetail(entry.food, position)} ${suffix}`;
        suffix += 1;
      }
      usedDetails.add(detail.toLowerCase());
      names.set(foodKey(entry.food, entry.index), `${base} (${detail})`);
    });
  }

  NAME_INDEX.set(foods, names);
  return names;
}

/** Every food the app has loaded, used so on-screen names stay unique. */
let registeredFoods = null;

/**
 * Register the loaded food list once. Every later `displayFoodName(food)` can
 * then resolve a collision against the whole list without changing the callers.
 */
export function registerDisplayFoods(foods) {
  registeredFoods = Array.isArray(foods) ? foods : null;
  return registeredFoods ? displayNamesFor(registeredFoods) : new Map();
}

/**
 * Name shown in the UI. Empty when the entry cannot be shown without a
 * trademark (search should skip it). When the food belongs to the registered
 * list, the name is also made unique against the rest of that list.
 */
export function displayFoodName(foodOrName) {
  const food = foodOrName && typeof foodOrName === 'object' ? foodOrName : null;
  const raw = food ? sourceName(food) : String(foodOrName ?? '');
  const base = stripBrandFromName(raw);
  if (!base) return '';
  if (displayNameHasBrand(base)) return '';
  if (food && registeredFoods) {
    const unique = displayNamesFor(registeredFoods).get(food.id);
    if (unique) return unique;
  }
  return base;
}

/** Foods safe to offer in free search (have a brand-free display name). */
export function foodsForDisplay(foods) {
  return (Array.isArray(foods) ? foods : []).filter((f) => displayFoodName(f));
}
