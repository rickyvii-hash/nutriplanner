// Free-search over the food list.
// A query is split into words; every word must match a whole word or a word
// prefix of the food name or id, so "cola" never matches "chocolate chip cookies".
// Foods that match all words directly rank above foods found through a synonym.

import { foodSearchLabel } from './custom_foods.js';

/** Small English synonym map for the off-plan foods people search for most. */
export const SYNONYMS = {
  cola: ['cola', 'coke', 'soda', 'soft drink'],
  coke: ['cola', 'coke', 'soda', 'soft drink'],
  soda: ['soda', 'cola', 'coke', 'soft drink'],
  fries: ['fries', 'french fries', 'french fried'],
  fry: ['fries', 'french fries', 'french fried'],
  burger: ['burger', 'hamburger', 'cheeseburger'],
  hamburger: ['burger', 'hamburger', 'cheeseburger'],
  cheeseburger: ['burger', 'hamburger', 'cheeseburger'],
  beer: ['beer', 'ale', 'lager', 'alcoholic beverage'],
  ale: ['beer', 'ale', 'lager'],
  lager: ['beer', 'ale', 'lager'],
  'ice cream': ['ice cream'],
  chips: ['chips', 'crisps', 'potato chips'],
  crisps: ['chips', 'crisps'],
  pasta: ['pasta', 'noodles', 'noodle'],
  noodles: ['pasta', 'noodles', 'noodle'],
  pizza: ['pizza'],
  chocolate: ['chocolate'],
  water: ['water'],
  tea: ['tea'],
  milk: ['milk'],
  juice: ['juice'],
  coffee: ['coffee'],
  espresso: ['coffee', 'espresso'],
  wine: ['wine'],
};

// Combining marks left over after NFD, built from char codes so the file stays plain text.
const COMBINING_MARKS = new RegExp(
  '[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']',
  'g',
);

/** Lowercase, trim and remove accents, so an unaccented query finds an accented name. */
export function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}

/** The words of a text, split on anything that is not a letter or a digit. */
export function words(text) {
  return normalizeText(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/** A few plural forms of a word, used so "apples" still finds "Apple". */
function wordForms(word) {
  const forms = new Set([word]);
  if (word.length > 4 && word.endsWith('ies')) forms.add(word.slice(0, -3) + 'y');
  else if (word.length > 4 && word.endsWith('es')) forms.add(word.slice(0, -2));
  if (word.length > 3 && word.endsWith('s')) forms.add(word.slice(0, -1));
  return [...forms];
}

/**
 * True when one word of the food matches one word of the query.
 * Short query words (under 5 letters) must match a whole food word, so "cola"
 * never matches "colada" or the "cola" inside "chocolate".
 */
function wordMatches(foodWord, queryWord) {
  if (foodWord === queryWord) return true;
  for (const form of wordForms(queryWord)) {
    if (foodWord === form) return true;
  }
  for (const form of wordForms(foodWord)) {
    if (form === queryWord) return true;
  }
  // Prefix match only for longer stems (pizza → pizzas is fine; cola → colada is not).
  if (queryWord.length >= 5 && foodWord.startsWith(queryWord)) return true;
  for (const form of wordForms(queryWord)) {
    if (form.length >= 5 && foodWord.startsWith(form)) return true;
  }
  return false;
}

/** All words of `phrase` must match the food words, in any order. */
function phraseMatches(foodWords, phrase) {
  const phraseWords = words(phrase);
  if (phraseWords.length === 0) return false;
  return phraseWords.every((pw) => foodWords.some((fw) => wordMatches(fw, pw)));
}

function scoreFood(food, query, queryWords) {
  const name = normalizeText(food.name);
  const id = normalizeText(food.id || '');
  const nameWords = words(food.name);
  const idWords = words(food.id || '');
  // The label the UI actually shows, so a query also matches the brand-free name.
  const displayWords = words(foodSearchLabel(food));

  if (name === query || (id && id === query.replace(/\s+/g, '-'))) return 100;
  if (name.startsWith(query)) return 80;

  // Direct match: every query word is a word or word prefix of name/id/display.
  const direct = queryWords.every((qw) => nameWords.some((fw) => wordMatches(fw, qw)))
    || queryWords.every((qw) => displayWords.some((fw) => wordMatches(fw, qw)))
    || queryWords.every((qw) => idWords.some((fw) => wordMatches(fw, qw)));
  if (direct) {
    const wholeWords = queryWords.every(
      (qw) => nameWords.includes(qw) || displayWords.includes(qw) || idWords.includes(qw),
    );
    return wholeWords ? 70 : 60;
  }

  // Synonym match: every query word is either direct or covered by a synonym.
  const synonymOnly = queryWords.every((qw) => {
    if (nameWords.some((fw) => wordMatches(fw, qw))
      || displayWords.some((fw) => wordMatches(fw, qw))
      || idWords.some((fw) => wordMatches(fw, qw))) return true;
    const alternatives = SYNONYMS[qw] || [];
    return alternatives.some((alt) => phraseMatches(nameWords, alt)
      || phraseMatches(displayWords, alt)
      || phraseMatches(idWords, alt));
  });
  if (synonymOnly) return 40;

  // A phrase synonym such as "ice cream" taken as a whole.
  const phrase = SYNONYMS[query];
  if (phrase && phrase.some((alt) => phraseMatches(nameWords, alt) || phraseMatches(displayWords, alt))) return 30;
  return 0;
}

/**
 * Search the food list for a free-text query.
 * Returns the best matches, best first, limited to `limit` (12 by default).
 */
export function searchFoods(foods, query, { limit = 12 } = {}) {
  const text = normalizeText(query);
  const queryWords = words(text);
  if (!Array.isArray(foods) || queryWords.length === 0) return [];

  const scored = [];
  for (const food of foods) {
    if (!food || !food.name) continue;
    // A food whose label cannot be made brand-free is not offered in search.
    if (!foodSearchLabel(food)) continue;
    const score = scoreFood(food, text, queryWords);
    if (score > 0) scored.push({ food, score });
  }

  scored.sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name));
  return scored.slice(0, Math.max(0, limit)).map((hit) => hit.food);
}
