/**
 * The "Add my own food" form and the shared pieces of the food search results.
 * Both search screens (Outside the menu and the Replace "I ate something else"
 * panel) mount the same form, so the fields, the messages and the way a food
 * of your own is logged are identical everywhere.
 */

import {
  CUSTOM_FORM_NOTE, CUSTOM_NAME_MAX, CUSTOM_KCAL_MAX, CUSTOM_OPTIONAL_NUTRIENTS,
  MAX_PORTIONS, gramsForPortions, parsePortions,
  shownFoodName, validateCustomFood,
} from '../engine/custom_foods.js';
import { el, escapeHtml } from './dom.js';

/** The line shown when no database food matches the query. */
export const NO_RESULTS_TEXT = 'No match in the food list. Add my own food to log what you ate.';
export const AMOUNT_GRAMS_LABEL = 'Portion (grams)';
export const AMOUNT_PORTIONS_LABEL = 'Portions';
export const AMOUNT_GRAMS_ERROR = 'Enter a portion between 1 and 5000 g';
export const AMOUNT_PORTIONS_ERROR = `Enter a number of portions between 0.25 and ${MAX_PORTIONS}`;
export const CUSTOM_FOOD_LINK = 'Add my own food';

/** True for a food the person added (not the placeholder of a removed one). */
export function isUserFood(food) {
  return Boolean(food?.custom && !food.missingCustom);
}

/**
 * The amount field works in grams for database foods and in portions for a
 * food the person added: one portion is exactly what was typed in the form.
 */
export function setAmountMode({ custom = false, labelEl = null, inputEl = null } = {}) {
  if (labelEl) labelEl.textContent = custom ? AMOUNT_PORTIONS_LABEL : AMOUNT_GRAMS_LABEL;
  if (inputEl) {
    inputEl.min = custom ? '0.25' : '1';
    inputEl.max = custom ? String(MAX_PORTIONS) : '5000';
    inputEl.step = custom ? '0.25' : '1';
    inputEl.value = custom ? '1' : '100';
    inputEl.placeholder = custom ? 'e.g. 1' : 'e.g. 150';
  }
}

/** The amount as logged grams, or null when the field is not valid. */
export function amountGrams(food, raw, parseGrams) {
  if (!isUserFood(food)) return parseGrams(raw);
  const portions = parsePortions(raw);
  return portions === null ? null : gramsForPortions(portions);
}

/** The message shown when the amount field is not valid. */
export function amountError(food) {
  return isUserFood(food) ? AMOUNT_PORTIONS_ERROR : AMOUNT_GRAMS_ERROR;
}

/**
 * The small form that saves a food of your own: a name, an optional portion
 * description, the calories for that portion and the optional nutrients.
 * Nothing is saved while a message is showing.
 */
export function createCustomFoodForm({ onSave, onCancel } = {}) {
  const nutrientFields = CUSTOM_OPTIONAL_NUTRIENTS.map((field) => `
    <label class="field">
      <span>${escapeHtml(field.label)} (${escapeHtml(field.unit)})</span>
      <input type="number" min="0" step="0.1" inputmode="decimal"
        data-custom-nutrient="${escapeHtml(field.key)}">
    </label>
    <p class="field-error" data-custom-error="${escapeHtml(field.key)}" hidden></p>`).join('');

  const form = el(`<form class="custom-food-form hidden" data-custom-form novalidate>
    <p class="field-label">Your food</p>
    <label class="field">
      <span>Name</span>
      <input type="text" maxlength="${CUSTOM_NAME_MAX}" required autocomplete="off"
        placeholder="e.g. Lasagna" data-custom-name>
    </label>
    <p class="field-error" data-custom-error="name" hidden></p>
    <label class="field">
      <span>Portion description (optional)</span>
      <input type="text" maxlength="${CUSTOM_NAME_MAX}" autocomplete="off"
        placeholder='e.g. "1 plate"' data-custom-portion>
    </label>
    <label class="field">
      <span>Calories for that portion (kcal)</span>
      <input type="number" min="1" max="${CUSTOM_KCAL_MAX}" step="1" required inputmode="numeric"
        placeholder="e.g. 450" data-custom-kcal>
    </label>
    <p class="field-error" data-custom-error="kcal" hidden></p>
    <p class="field-label">Optional, for that same portion</p>
    ${nutrientFields}
    <p class="muted tiny custom-food-note">${escapeHtml(CUSTOM_FORM_NOTE)}</p>
    <div class="custom-food-actions">
      <button type="submit" class="btn-primary btn-small" data-custom-save>Save my food</button>
      <button type="button" class="btn-text" data-custom-cancel>Cancel</button>
    </div>
  </form>`);

  const nameInput = form.querySelector('[data-custom-name]');
  const portionInput = form.querySelector('[data-custom-portion]');
  const kcalInput = form.querySelector('[data-custom-kcal]');
  const nutrientInputs = [...form.querySelectorAll('[data-custom-nutrient]')];

  const paintErrors = (errors = {}) => {
    for (const slot of form.querySelectorAll('[data-custom-error]')) {
      const message = errors[slot.dataset.customError] || '';
      slot.textContent = message;
      slot.hidden = !message;
    }
  };

  const reset = () => {
    for (const input of [nameInput, portionInput, kcalInput, ...nutrientInputs]) input.value = '';
    paintErrors({});
  };

  const close = () => {
    form.classList.add('hidden');
  };

  const open = () => {
    reset();
    form.classList.remove('hidden');
    nameInput.focus();
  };

  const readInput = () => {
    const input = {
      name: nameInput.value,
      portionLabel: portionInput.value,
      kcal: kcalInput.value,
    };
    for (const field of nutrientInputs) input[field.dataset.customNutrient] = field.value;
    return input;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const check = validateCustomFood(readInput());
    if (!check.ok) {
      paintErrors(check.errors);
      const firstBad = form.querySelector(`[data-custom-error="${Object.keys(check.errors)[0]}"]`);
      if (firstBad) {
        const field = firstBad.previousElementSibling;
        if (field && typeof field.focus === 'function') field.focus();
      }
      return;
    }
    paintErrors({});
    if (typeof onSave === 'function') onSave(check.value);
  });
  form.querySelector('[data-custom-cancel]').addEventListener('click', () => {
    close();
    if (typeof onCancel === 'function') onCancel();
  });

  return { element: form, open, close, reset, paintErrors };
}

/**
 * One row of the search results. A food the person added also carries its
 * portion label and a small Remove, so it can be taken out of the list again.
 */
export function searchResultRow(food, { onSelect, onRemove } = {}) {
  const label = shownFoodName(food);
  const portion = isUserFood(food) && food.portionLabel
    ? ` <span class="muted tiny">${escapeHtml(food.portionLabel)}</span>`
    : '';
  const row = el(`<div class="search-result-row">
    <button type="button" class="search-hit" data-food-id="${escapeHtml(food.id)}">${escapeHtml(label)}${portion}</button>
  </div>`);
  const button = row.querySelector('.search-hit');
  button.addEventListener('click', () => {
    const parent = row.parentElement;
    if (parent) {
      for (const other of parent.querySelectorAll('.search-hit')) other.classList.remove('is-selected');
    }
    button.classList.add('is-selected');
    if (typeof onSelect === 'function') onSelect(food);
  });
  if (isUserFood(food) && typeof onRemove === 'function') {
    const remove = el(`<button type="button" class="btn-text btn-small search-remove"
      data-remove-custom="${escapeHtml(food.id)}">Remove</button>`);
    remove.addEventListener('click', () => onRemove(food));
    row.appendChild(remove);
  }
  return row;
}
