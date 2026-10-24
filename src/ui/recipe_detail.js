// Recipe detail: ingredients, target nutrients and three honest outside-search links.
// The links only open when the person taps one; the app never opens them itself.

import { recipeNutrients, formatNutrient } from '../engine/nutrients.js';
import { el, escapeHtml, nutrientLabel, nutrientUnit } from './dom.js';

export const DETAIL_NOTE = 'Opens a web search. NutriPlanner does not take orders.';
const FALLBACK_QUERY = 'meal';

/** The text used in a search link: the dish name, or "meal" when it is empty. */
export function searchTerm(name) {
  const clean = String(name ?? '').trim();
  return clean || FALLBACK_QUERY;
}

/** Google search for the full recipe of a dish. */
export function fullRecipeUrl(name) {
  return `https://www.google.com/search?q=${encodeURIComponent(searchTerm(name))}+recipe`;
}

/** Google Maps search for places serving the dish nearby. */
export function findNearbyUrl(name) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchTerm(name))}+near+me`;
}

/** Google search for delivery of the dish nearby. */
export function orderDeliveryUrl(name) {
  return `https://www.google.com/search?q=${encodeURIComponent(searchTerm(name))}+delivery+near+me`;
}

/** The three outside-search links for a dish, in the order they are shown. */
export function detailLinks(name) {
  return [
    { id: 'full-recipe', label: 'Full recipe', href: fullRecipeUrl(name) },
    { id: 'find-nearby', label: 'Find nearby', href: findNearbyUrl(name) },
    { id: 'order-delivery', label: 'Order delivery', href: orderDeliveryUrl(name) },
  ];
}

/**
 * Everything the detail panel shows, built without a browser so it can be tested.
 * Nutrients follow the current targets; a missing value stays "n/a", never zero.
 */
export function recipeDetailModel(recipe, { targets = [], foodsById } = {}) {
  if (!recipe) return null;
  const foods = foodsById instanceof Map ? foodsById : new Map(Object.entries(foodsById || {}));
  const result = recipeNutrients(recipe, foods);

  const ingredients = (recipe.ingredients || []).map((ing) => ({
    name: foods.get(ing.foodId)?.name || ing.foodId,
    grams: ing.grams,
  }));

  const nutrients = (Array.isArray(targets) ? targets : [])
    .filter((t) => t && result.unknown[t.nutrient] !== undefined)
    .map((t) => {
      const decimals = t.nutrient === 'kcal' || t.nutrient === 'sodium' ? 0 : 1;
      const value = formatNutrient(result, t.nutrient, decimals);
      const unit = nutrientUnit(t.nutrient);
      return {
        key: t.nutrient,
        label: nutrientLabel(t.nutrient),
        unit,
        value,
        text: value === 'n/a' ? 'n/a' : `${value} ${unit}`,
      };
    });

  return {
    name: recipe.name || FALLBACK_QUERY,
    icon: recipe.icon || '',
    ingredients,
    nutrients,
    links: detailLinks(recipe.name),
    note: DETAIL_NOTE,
  };
}

/**
 * Open the detail panel inside `mount` (the current screen) for one recipe.
 * Returns the panel element, or null when there is no browser or no recipe.
 */
export function openRecipeDetail(ctx, recipe, mount) {
  if (typeof document === 'undefined' || !mount || !recipe) return null;
  const model = recipeDetailModel(recipe, {
    targets: ctx?.state?.targets || [],
    foodsById: ctx?.foodsById,
  });
  if (!model) return null;

  // One panel at a time.
  mount.querySelectorAll('[data-recipe-detail]').forEach((node) => node.remove());

  const overlay = el(`<div class="recipe-overlay" data-recipe-detail>
    <section class="recipe-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(model.name)}">
      <div class="recipe-panel-head">
        <h2>${model.icon ? `<span aria-hidden="true">${escapeHtml(model.icon)}</span> ` : ''}${escapeHtml(model.name)}</h2>
        <button type="button" class="btn-icon recipe-close" data-close-detail aria-label="Close recipe details">×</button>
      </div>
      <div class="recipe-body"></div>
    </section>
  </div>`);

  const body = overlay.querySelector('.recipe-body');

  const ingredients = el(`<section class="recipe-section">
    <h3>Ingredients</h3>
    <ul class="recipe-ingredients"></ul>
  </section>`);
  const ingredientList = ingredients.querySelector('ul');
  for (const ing of model.ingredients) {
    ingredientList.appendChild(el(`<li>
      <span>${escapeHtml(ing.name)}</span>
      <span class="recipe-grams">${escapeHtml(ing.grams)} g</span>
    </li>`));
  }
  body.appendChild(ingredients);

  const nutrients = el(`<section class="recipe-section">
    <h3>Nutrients for your targets</h3>
    <ul class="recipe-nutrients"></ul>
  </section>`);
  const nutrientList = nutrients.querySelector('ul');
  if (model.nutrients.length === 0) {
    nutrients.appendChild(el(`<p class="muted tiny">No targets set yet.</p>`));
  }
  for (const n of model.nutrients) {
    nutrientList.appendChild(el(`<li>
      <span>${n.label}</span>
      <span>${escapeHtml(n.text)}</span>
    </li>`));
  }
  body.appendChild(nutrients);

  const links = el(`<section class="recipe-section">
    <h3>More about this meal</h3>
    <div class="recipe-links"></div>
    <p class="recipe-note muted tiny">${DETAIL_NOTE}</p>
  </section>`);
  const linksWrap = links.querySelector('.recipe-links');
  for (const link of model.links) {
    const a = document.createElement('a');
    a.className = 'btn-secondary recipe-link';
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.dataset.link = link.id;
    a.textContent = link.label;
    linksWrap.appendChild(a);
  }
  body.appendChild(links);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  overlay.querySelector('[data-close-detail]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  mount.appendChild(overlay);
  return overlay;
}
