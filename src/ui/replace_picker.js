// The Replace picker on the day screen: another recipe for the same slot, or the
// "I ate something else" free-search path. It only builds the save payload; the
// caller saves it through the same log path the Log screen uses.

import { searchFoods } from '../engine/search.js';
import { slotRecipeKind, slotLabel } from '../engine/meal_prefs.js';
import {
  customFoodInUse, customFoodRemovalNote, portionsFromGrams, shownFoodName,
} from '../engine/custom_foods.js';
import { el, escapeHtml } from './dom.js';
import { createDrinkPicker, parsePortion, stateAfterFoodAdd } from './log.js';
import {
  NO_RESULTS_TEXT, amountError, amountGrams, createCustomFoodForm, isUserFood,
  searchResultRow, setAmountMode,
} from './custom_food.js';

function foodName(foods, foodsById, foodId, fallback = '') {
  const food = foodsById?.get?.(foodId) || (foods || []).find((f) => f.id === foodId) || null;
  return shownFoodName(food, fallback || foodId);
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
  ctx = null,
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
      <p class="muted tiny no-results" data-no-results hidden>${escapeHtml(NO_RESULTS_TEXT)}</p>
      <p class="muted tiny custom-food-note" data-custom-note hidden></p>
      <button type="button" class="btn-text btn-small" data-custom-add>Add my own food</button>
      <div data-custom-host></div>
      <label class="field">
        <span>Portion (grams)</span>
        <input type="number" min="1" max="5000" step="1" placeholder="e.g. 150" value="100" data-replace-portion>
      </label>
      <p class="field-error" data-replace-portion-error hidden>Enter a portion between 1 and 5000 g</p>
      <button type="button" class="btn-secondary" data-replace-add disabled>Add food</button>
      <ul class="logged-items" data-replace-items></ul>
      <p class="sr-only" role="status" aria-live="polite" data-replace-status></p>
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

  let customItems = [];
  let selectedFood = null;
  const searchInput = picker.querySelector('[data-replace-search]');
  const results = picker.querySelector('[data-replace-results]');
  const portionInput = picker.querySelector('[data-replace-portion]');
  const portionLabel = portionInput.closest('.field')?.querySelector('span') || null;
  const portionError = picker.querySelector('[data-replace-portion-error]');
  const addBtn = picker.querySelector('[data-replace-add]');
  const itemList = picker.querySelector('[data-replace-items]');
  const emptyNote = picker.querySelector('[data-replace-empty]');
  const saveBtn = picker.querySelector('[data-replace-save]');
  const noResults = picker.querySelector('[data-no-results]');
  const noteEl = picker.querySelector('[data-custom-note]');
  const addStatus = picker.querySelector('[data-replace-status]');

  const findFood = (foodId) => foodsById?.get?.(foodId) || foods.find((f) => f.id === foodId) || null;

  const showNote = (text) => {
    noteEl.textContent = text || '';
    noteEl.hidden = !text;
  };

  const paintCustom = () => {
    itemList.innerHTML = '';
    customItems.forEach((it, index) => {
      const custom = isUserFood(findFood(it.foodId));
      const amount = custom ? portionsFromGrams(it.grams) : it.grams;
      const unit = custom ? 'portions' : 'g';
      const bounds = custom ? 'min="0.25" max="50" step="0.25"' : 'min="1" max="5000" step="1"';
      const name = foodName(foods, foodsById, it.foodId, it.name);
      itemList.appendChild(el(`<li class="logged-item">
        <span>${escapeHtml(name)}</span>
        <input type="number" ${bounds} value="${amount}"
          data-custom-edit="${index}" aria-label="${escapeHtml(name)} ${unit}">
        <span class="muted">${unit}</span>
        <button type="button" class="btn-icon" data-custom-del="${index}"
          aria-label="Remove ${escapeHtml(name)}">×</button>
      </li>`));
    });
    emptyNote.classList.toggle('hidden', customItems.length > 0);
    saveBtn.disabled = customItems.length === 0;
    itemList.querySelectorAll('[data-custom-edit]').forEach((input) => {
      input.addEventListener('change', () => {
        const index = Number(input.dataset.customEdit);
        const item = customItems[index];
        if (!item) return;
        const food = findFood(item.foodId);
        const grams = isUserFood(food)
          ? amountGrams(food, input.value, parsePortion)
          : parsePortion(input.value);
        if (grams === null) {
          input.value = isUserFood(food) ? portionsFromGrams(item.grams) : item.grams;
          return;
        }
        item.grams = grams;
      });
    });
    itemList.querySelectorAll('[data-custom-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        customItems.splice(Number(btn.dataset.customDel), 1);
        paintCustom();
      });
    });
  };

  const choose = (food) => {
    selectedFood = food;
    setAmountMode({ custom: isUserFood(food), labelEl: portionLabel, inputEl: portionInput });
    portionError.textContent = amountError(food);
    portionError.classList.add('hidden');
    addBtn.disabled = false;
  };

  const runSearch = (autoSelectId = null) => {
    const query = searchInput.value || '';
    results.innerHTML = '';
    selectedFood = null;
    addBtn.disabled = true;
    noResults.hidden = true;
    if (!query.trim()) return;
    for (const food of searchFoods(foods, query, { limit: 12 })) {
      const row = searchResultRow(food, {
        onSelect: (picked) => choose(picked),
        onRemove: (removed) => {
          const used = customFoodInUse(removed.id, {
            log: ctx?.state?.log || [],
            plannedExtras: ctx?.state?.plannedExtras || [],
          });
          ctx?.removeCustomFood?.(removed.id);
          showNote(customFoodRemovalNote(removed.name, used));
          runSearch();
        },
      });
      results.appendChild(row);
    }
    if (results.children.length === 0) noResults.hidden = false;
    if (autoSelectId) {
      const b = results.querySelector(`[data-food-id="${autoSelectId}"]`);
      if (b) b.click();
    }
  };
  searchInput.addEventListener('input', () => {
    showNote('');
    runSearch();
  });
  portionInput.addEventListener('input', () => portionError.classList.add('hidden'));

  // "Add my own food": the same form the Outside the menu screen offers.
  const customForm = createCustomFoodForm({
    onSave: (value) => {
      if (!ctx?.addCustomFood) return;
      const food = ctx.addCustomFood(value);
      customForm.close();
      showNote('');
      searchInput.value = food.name;
      runSearch(food.id);
    },
    onCancel: () => customForm.close(),
  });
  picker.querySelector('[data-custom-host]').appendChild(customForm.element);
  picker.querySelector('[data-custom-add]').addEventListener('click', () => {
    showNote('');
    customForm.open();
  });

  const drinkPicker = createDrinkPicker(foods, (food, grams) => {
    choose(food);
    portionInput.value = grams;
  });
  const drinksBtn = picker.querySelector('[data-replace-drinks]');
  drinksBtn.after(drinkPicker.element);
  drinksBtn.addEventListener('click', () => drinkPicker.toggle());

  addBtn.addEventListener('click', () => {
    if (!selectedFood) return;
    const grams = amountGrams(selectedFood, portionInput.value, parsePortion);
    if (grams === null) {
      portionError.textContent = amountError(selectedFood);
      portionError.classList.remove('hidden');
      portionInput.focus();
      return;
    }
    portionError.classList.add('hidden');
    const food = selectedFood;
    const after = stateAfterFoodAdd(customItems, food, grams);
    customItems = after.items;
    // The payload names the foods, so the display name travels with the line.
    const added = customItems[customItems.length - 1];
    added.name = added.name || foodName(foods, foodsById, food.id);
    selectedFood = after.selectedFood;
    setAmountMode({ custom: false, labelEl: portionLabel, inputEl: portionInput });
    portionInput.value = after.portion;
    addBtn.disabled = !after.addEnabled;
    addStatus.textContent = after.status;
    // The chosen row is no longer selected either, so a second tap adds nothing.
    results.querySelectorAll('.search-hit.is-selected').forEach((hit) => hit.classList.remove('is-selected'));
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
