// The Replace picker on the day screen: another recipe for the same slot, or the
// "I ate something else" free-search path. It only builds the save payload; the
// caller saves it through the same log path the Log screen uses.

import { searchFoods } from '../engine/search.js';
import { slotRecipeKind, slotLabel } from '../engine/meal_prefs.js';
import { displayFoodName } from '../engine/food_display.js';
import { el, escapeHtml } from './dom.js';
import { createDrinkPicker, parsePortion } from './log.js';

function foodName(foods, foodsById, foodId) {
  const food = foodsById?.get ? foodsById.get(foodId) : (foods || []).find((f) => f.id === foodId);
  return displayFoodName(food) || food?.id || foodId;
}

/** The payload for swapping a planned meal with another recipe for the same slot. */
export function recipeReplacementPayload(slot, currentRecipe, recipe) {
  return {
    items: recipe.ingredients.map((ing) => ({ foodId: ing.foodId, grams: ing.grams })),
    skipped: [],
    replaced: [{ slot, recipeId: recipe.id, fromRecipeId: currentRecipe?.id || null }],
  };
}

/** The payload for swapping a planned meal with free-search foods. */
export function foodReplacementPayload(slot, currentRecipe, items) {
  const names = items.map((it) => it.name);
  const name = names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
  return {
    items: items.map((it) => ({ foodId: it.foodId, grams: it.grams })),
    skipped: [],
    replaced: [{ slot, fromRecipeId: currentRecipe?.id || null, recipeId: null, name }],
  };
}

/**
 * Build the Replace picker under one meal row. `onPick` receives the payload to
 * save; the picker closes itself once a choice is made.
 */
export function createReplacePicker({
  slot,
  currentRecipe,
  recipes = [],
  foods = [],
  foodsById = null,
  onPick,
}) {
  const otherRecipes = recipes.filter((r) => r.slot === slotRecipeKind(slot) && r.id !== currentRecipe?.id);
  const slotText = escapeHtml(slotLabel(slot));
  const picker = el(`<div class="replace-picker" data-replace-picker>
    <p class="field-label">Replace ${slotText} with another ${slotText} recipe</p>
    <div class="replace-options"></div>
    <button type="button" class="btn-secondary" data-ate-elsewhere>I ate something else</button>
    <div class="replace-custom hidden" data-replace-custom>
      <p class="field-label">Search the food you ate instead</p>
      <label class="field">
        <span>Search a food</span>
        <input type="search" placeholder="e.g. pizza, ice cream" data-replace-search>
      </label>
      <button type="button" class="btn-secondary btn-small" data-replace-drinks>Drinks</button>
      <div class="search-results" data-replace-results></div>
      <label class="field">
        <span>Portion (grams)</span>
        <input type="number" min="1" max="5000" step="1" placeholder="e.g. 150" value="100" data-replace-portion>
      </label>
      <p class="field-error" data-replace-portion-error hidden>Enter a portion between 1 and 5000 g</p>
      <button type="button" class="btn-secondary" data-replace-add disabled>Add food</button>
      <ul class="logged-items" data-replace-items></ul>
      <p class="muted tiny" data-replace-empty>Nothing added yet.</p>
      <button type="button" class="btn-primary" data-replace-save disabled>Replace with these foods</button>
    </div>
    <button type="button" class="btn-text" data-close-picker>Cancel</button>
  </div>`);

  const pick = (payload) => {
    if (typeof onPick === 'function') onPick(payload);
    picker.remove();
  };

  const options = picker.querySelector('.replace-options');
  if (otherRecipes.length === 0) {
    options.appendChild(el(`<p class="muted tiny">No other ${slotText} recipes available.</p>`));
  }
  for (const other of otherRecipes) {
    const btn = el(`<button type="button" class="search-hit">${other.icon || ''} ${escapeHtml(other.name)}</button>`);
    btn.addEventListener('click', () => pick(recipeReplacementPayload(slot, currentRecipe, other)));
    options.appendChild(btn);
  }

  const customBox = picker.querySelector('[data-replace-custom]');
  picker.querySelector('[data-ate-elsewhere]').addEventListener('click', () => {
    customBox.classList.toggle('hidden');
  });

  const customItems = [];
  let selectedId = null;
  const searchInput = picker.querySelector('[data-replace-search]');
  const results = picker.querySelector('[data-replace-results]');
  const portionInput = picker.querySelector('[data-replace-portion]');
  const portionError = picker.querySelector('[data-replace-portion-error]');
  const addBtn = picker.querySelector('[data-replace-add]');
  const itemList = picker.querySelector('[data-replace-items]');
  const emptyNote = picker.querySelector('[data-replace-empty]');
  const saveBtn = picker.querySelector('[data-replace-save]');

  const paintCustom = () => {
    itemList.innerHTML = '';
    customItems.forEach((it, index) => {
      const name = foodName(foods, foodsById, it.foodId);
      itemList.appendChild(el(`<li class="logged-item">
        <span>${escapeHtml(name)}</span>
        <input type="number" min="1" max="5000" step="1" value="${it.grams}"
          data-custom-edit="${index}" aria-label="${escapeHtml(name)} grams">
        <span class="muted">g</span>
        <button type="button" class="btn-icon" data-custom-del="${index}"
          aria-label="Remove ${escapeHtml(name)}">×</button>
      </li>`));
    });
    emptyNote.classList.toggle('hidden', customItems.length > 0);
    saveBtn.disabled = customItems.length === 0;
    itemList.querySelectorAll('[data-custom-edit]').forEach((input) => {
      input.addEventListener('change', () => {
        const index = Number(input.dataset.customEdit);
        const grams = parsePortion(input.value);
        if (grams === null) {
          input.value = customItems[index].grams;
          return;
        }
        customItems[index].grams = grams;
      });
    });
    itemList.querySelectorAll('[data-custom-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        customItems.splice(Number(btn.dataset.customDel), 1);
        paintCustom();
      });
    });
  };

  const runSearch = () => {
    const query = searchInput.value || '';
    results.innerHTML = '';
    selectedId = null;
    addBtn.disabled = true;
    if (!query.trim()) return;
    for (const food of searchFoods(foods, query, { limit: 12 })) {
      const shown = displayFoodName(food);
      if (!shown) continue;
      const btn = el(`<button type="button" class="search-hit">${escapeHtml(shown)}</button>`);
      btn.addEventListener('click', () => {
        selectedId = food.id;
        results.querySelectorAll('.search-hit').forEach((x) => x.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        addBtn.disabled = false;
      });
      results.appendChild(btn);
    }
  };
  searchInput.addEventListener('input', runSearch);
  portionInput.addEventListener('input', () => portionError.classList.add('hidden'));

  const drinkPicker = createDrinkPicker(foods, (food, grams) => {
    results.querySelectorAll('.search-hit').forEach((x) => x.classList.remove('is-selected'));
    selectedId = food.id;
    portionInput.value = grams;
    portionError.classList.add('hidden');
    addBtn.disabled = false;
  });
  const drinksBtn = picker.querySelector('[data-replace-drinks]');
  drinksBtn.after(drinkPicker.element);
  drinksBtn.addEventListener('click', () => drinkPicker.toggle());

  addBtn.addEventListener('click', () => {
    if (!selectedId) return;
    const grams = parsePortion(portionInput.value);
    if (grams === null) {
      portionError.classList.remove('hidden');
      portionInput.focus();
      return;
    }
    portionError.classList.add('hidden');
    const name = foodName(foods, foodsById, selectedId);
    customItems.push({ foodId: selectedId, grams, name });
    paintCustom();
  });

  saveBtn.addEventListener('click', () => {
    if (customItems.length === 0) return;
    pick(foodReplacementPayload(slot, currentRecipe, customItems));
  });

  picker.querySelector('[data-close-picker]').addEventListener('click', () => picker.remove());
  paintCustom();
  return picker;
}
