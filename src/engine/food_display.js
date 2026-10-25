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
 * Restaurant chains in this food list. Their rows are the same dish at several
 * chains, so once the chain name is removed they describe one restaurant food.
 */
export const RESTAURANT_BRAND_TOKENS = [
  "APPLEBEE'S",
  "ARBY'S",
  'BURGER KING',
  "DENNY'S",
  "DOMINO'S",
  'LITTLE CAESARS',
  "McDONALD'S",
  "PAPA JOHN'S",
  'PIZZA HUT',
  "T.G.I. FRIDAY'S",
  "TGI FRIDAY'S",
  "WENDY'S",
];

/** The full stored name, before the display shortening. */
function fullSourceName(food) {
  if (!food || typeof food !== 'object') return String(food ?? '');
  return food.usdaName || food.name || '';
}

/** True for a row that comes from a restaurant chain. */
function isRestaurantFood(food) {
  const name = String(fullSourceName(food)).toUpperCase();
  return RESTAURANT_BRAND_TOKENS.some((brand) => name.startsWith(brand.toUpperCase()));
}

/** Words only, lower case, used to compare two names that a brand removal left. */
function nameCore(food) {
  return stripBrandFromName(fullSourceName(food))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when the rows differ only by a brand or a branded product line.
 * "BURGER KING, Cheeseburger" and "McDONALD'S, Cheeseburger" both keep only
 * "cheeseburger"; the rows for salted and unsalted chips still differ.
 */
function isBrandOnlyGroup(group) {
  const first = nameCore(group[0].food);
  return first !== '' && group.every((entry) => nameCore(entry.food) === first);
}

/**
 * A real distinguishing detail for a collision that is not only about a brand:
 * the rest of the full USDA name that the short name leaves out
 * ("with added ascorbic acid", "oil, salted", "calcium and potassium").
 * Plain words in parentheses, never a record number.
 */
function extraNameDetail(food, base) {
  const full = stripBrandFromName(fullSourceName(food));
  if (!full) return '';
  let detail = '';
  const at = full.toLowerCase().indexOf(String(base).toLowerCase());
  if (at === 0) {
    detail = full.slice(String(base).length);
    // The short stored name can end inside a word ("...volume wa"); the rest of
    // that word is not a distinguishing detail.
    if (/[A-Za-z0-9]$/.test(base) && /^[A-Za-z0-9]/.test(detail)) {
      detail = detail.replace(/^[A-Za-z0-9]+/, '');
    }
    detail = detail.replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '').trim();
  }
  if (!detail) {
    // Fallback: the last comma part of the full name that the short name omits.
    const lowerBase = String(base).toLowerCase();
    const segments = full.split(',').map((part) => part.trim()).filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i];
      if (!lowerBase.includes(segment.toLowerCase()) && !displayNameHasBrand(segment)) {
        detail = segment;
        break;
      }
    }
  }
  // Plain words: drop an Oxford comma and refuse anything with a brand or id.
  detail = detail.replace(/,\s*and\s+/gi, ' and ').trim();
  if (!detail || displayNameHasBrand(detail) || /USDA|\d{5,}/i.test(detail)) return '';
  return detail;
}

/** A stable key for a food inside the display-name index. */
function foodKey(food, index) {
  return food?.id || `#${index}`;
}

/** Lowest USDA record number first, then position in the list. */
function byUsdaId(a, b) {
  const first = Number(a.food?.fdcId);
  const second = Number(b.food?.fdcId);
  const firstId = Number.isFinite(first) ? first : Number.POSITIVE_INFINITY;
  const secondId = Number.isFinite(second) ? second : Number.POSITIVE_INFINITY;
  return firstId - secondId || a.index - b.index;
}

const DISPLAY_INDEX = new WeakMap();

/**
 * Names and visibility for every food in a list.
 * A brand-only collision (six chains' "French fries") becomes one visible row
 * named after the dish, with the plain suffix ", restaurant" for restaurant
 * rows. Every row of that group keeps the same label, so an older log entry
 * still reads correctly. A collision with a real difference (salted/unsalted
 * chips) keeps both rows, separated by that difference in parentheses.
 */
function buildDisplayIndex(foods) {
  const names = new Map();
  const labels = new WeakMap();
  const visibleIds = new Set();
  const visibleFoods = new WeakSet();

  const entries = [];
  foods.forEach((food, index) => {
    if (!food || typeof food !== 'object') return;
    const key = foodKey(food, index);
    if (food.custom) {
      const label = String(food.name ?? '').trim();
      if (label) {
        names.set(key, label);
        labels.set(food, label);
        visibleIds.add(key);
        visibleFoods.add(food);
      }
      return;
    }
    const base = stripBrandFromName(sourceName(food));
    if (!base || displayNameHasBrand(base)) return;
    entries.push({ food, base, index, key });
  });

  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.base)) groups.set(entry.base, []);
    groups.get(entry.base).push(entry);
  }

  const show = (entry, label) => {
    names.set(entry.key, label);
    labels.set(entry.food, label);
    visibleIds.add(entry.key);
    visibleFoods.add(entry.food);
  };
  const keepHidden = (entry, label) => {
    names.set(entry.key, label);
    labels.set(entry.food, label);
  };

  for (const [base, group] of groups) {
    if (group.length === 1) {
      show(group[0], base);
      continue;
    }

    if (isBrandOnlyGroup(group)) {
      const sorted = group.slice().sort(byUsdaId);
      const restaurant = group.every((entry) => isRestaurantFood(entry.food));
      const label = restaurant ? `${base}, restaurant` : base;
      // One row is offered; the others stay only for older log entries.
      show(sorted[0], label);
      for (const entry of sorted.slice(1)) keepHidden(entry, label);
      continue;
    }

    // A real difference keeps both rows: the detail in parentheses is the
    // difference itself, never a record number.
    const sorted = group.slice().sort(byUsdaId);
    const usedDetails = new Set();
    let plainUsed = false;
    for (const entry of sorted) {
      const detail = extraNameDetail(entry.food, base);
      const detailKey = detail.toLowerCase();
      if (!detail || usedDetails.has(detailKey)) {
        // No usable detail: one row keeps the plain name, the rest stay only
        // for older log entries.
        if (!plainUsed) {
          plainUsed = true;
          show(entry, base);
        } else {
          keepHidden(entry, base);
        }
        continue;
      }
      usedDetails.add(detailKey);
      show(entry, `${base} (${detail})`);
    }
  }

  return { names, labels, visibleIds, visibleFoods };
}

/** Index for a food list, kept until that list changes. */
export function displayIndexFor(foods) {
  if (!Array.isArray(foods)) {
    return {
      names: new Map(), labels: new WeakMap(), visibleIds: new Set(), visibleFoods: new WeakSet(),
    };
  }
  // The app adds a custom food by clearing and refilling the same list, so the
  // cache also watches its length and its ends.
  const last = foods.length - 1;
  const cached = DISPLAY_INDEX.get(foods);
  if (cached
    && cached.length === foods.length
    && cached.first === (foods[0] ?? null)
    && cached.last === (foods[last] ?? null)) {
    return cached.index;
  }
  const index = buildDisplayIndex(foods);
  DISPLAY_INDEX.set(foods, {
    index, length: foods.length, first: foods[0] ?? null, last: foods[last] ?? null,
  });
  return index;
}

/** The display name of every food in a list, keyed by food id. */
export function displayNamesFor(foods) {
  return displayIndexFor(foods).names;
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
 * trademark (search should skip it). A hidden twin (a second chain's "French
 * fries") keeps the same label as the row that is offered, so older log lines
 * still read correctly.
 */
export function displayFoodName(foodOrName) {
  const food = foodOrName && typeof foodOrName === 'object' ? foodOrName : null;
  const raw = food ? sourceName(food) : String(foodOrName ?? '');
  const base = stripBrandFromName(raw);
  if (!base) return '';
  if (displayNameHasBrand(base)) return '';
  if (food && registeredFoods) {
    const index = displayIndexFor(registeredFoods);
    const label = index.labels.get(food) ?? index.names.get(foodKey(food));
    if (label) return label;
  }
  return base;
}

/** True when a food may appear in search results, pickers and the drinks list. */
export function isFoodDisplayVisible(food) {
  if (!food || typeof food !== 'object') return Boolean(displayFoodName(food));
  if (food.custom) return Boolean(String(food.name ?? '').trim());
  if (!registeredFoods) return Boolean(displayFoodName(food));
  const index = displayIndexFor(registeredFoods);
  if (index.labels.has(food)) return index.visibleFoods.has(food);
  const key = foodKey(food);
  if (index.names.has(key)) return index.visibleIds.has(key);
  return Boolean(displayFoodName(food));
}

/** Foods safe to offer in free search: brand-free and not a hidden twin. */
export function foodsForDisplay(foods) {
  if (!Array.isArray(foods)) return [];
  const index = displayIndexFor(foods);
  return foods.filter((food) => food && index.visibleFoods.has(food));
}
