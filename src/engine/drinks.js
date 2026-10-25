// Drinks for the free search: a short list of everyday drinks and the
// millilitre presets people use for them. Nothing here judges a drink:
// beer and wine are listed like water or coffee.

/** Common drink portions, in millilitres. */
export const DRINK_PRESETS = {
  glass: 200,
  cup: 240,
  can: 330,
  smallBottle: 500,
};

/** ml converted at about 1 g per ml, so a 330 ml can logs 330 g. */
export function mlToGrams(ml) {
  const value = Number(ml);
  if (!Number.isFinite(value)) return 0;
  return value;
}

// Words that name a drink. Whole words only, so "chocolate" never counts as
// cola and "watermelon" never counts as water.
const DRINK_WORDS = new Set([
  'water',
  'coffee',
  'espresso',
  'tea',
  'milk',
  'juice',
  'cola',
  'soda',
  'beer',
  'wine',
  'beverage',
  'beverages',
  'drink',
  'drinks',
]);

/** The whole words of a text, lowercased: "Almond milk, unsweetened" -> almond, milk, unsweetened. */
function wholeWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when the food name or id names a drink. */
export function isDrinkFood(food) {
  if (!food) return false;
  const words = new Set([...wholeWords(food.name), ...wholeWords(food.id)]);
  for (const word of DRINK_WORDS) {
    if (words.has(word)) return true;
  }
  return false;
}

/** Every drink in the food list, sorted by name; the order is stable. */
export function listDrinkFoods(foods) {
  if (!Array.isArray(foods)) return [];
  return foods
    .filter(isDrinkFood)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}
