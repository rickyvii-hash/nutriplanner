import {
  buildShoppingList,
  cartProgress,
  mealsUsingFood,
  markItemInCart,
  markItemNotFound,
  shoppingNowState,
  shoppingWindow,
  currentShopStart,
  undoItemState,
  windowCoverage,
  savedShopStart,
  SHOP_EVERY_OPTIONS,
} from '../engine/shopping.js';
import { todayIso } from '../engine/planner.js';
import { slotLabel } from '../engine/meal_prefs.js';
import { displayFoodName } from '../engine/food_display.js';
import { el, escapeHtml } from './dom.js';

export function renderShopping(ctx) {
  const { state, recipes, foodsById } = ctx;
  const root = el(`<div class="screen screen-shopping"></div>`);

  root.appendChild(el(`<header class="brand brand-compact">
    <span class="logo" aria-hidden="true">🌿</span>
    <div><h1>Shopping list</h1><p>Tick items as they go in your cart.</p></div>
  </header>`));

  if (!state.plan) {
    root.appendChild(el(`<section class="card empty-state">
      <h2>No list yet</h2>
      <p class="muted">Build a month plan first. The shopping list is made from its ingredients.</p>
      <button type="button" class="btn-primary" data-go="targets">Go to Targets</button>
    </section>`));
    root.querySelector('[data-go="targets"]').addEventListener('click', () => ctx.navigate('targets'));
    root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));
    return root;
  }

  const shopEvery = SHOP_EVERY_OPTIONS.includes(state.shopEvery) ? state.shopEvery : 7;
  const savedStart = savedShopStart(state.shopStart, todayIso());
  const shopStart = currentShopStart(savedStart, shopEvery, todayIso());
  const window = shoppingWindow(shopStart, shopEvery);
  const coverage = windowCoverage(state.plan, window);
  const coverageNote = coverage.truncated
    ? `<p class="muted tiny" data-window-note>The month plan ends on ${escapeHtml(coverage.lastPlanDate)}, so this list covers ${coverage.coveredDays} of ${coverage.requestedDays} days.</p>`
    : '';

  const windowCard = el(`<section class="card shop-window">
    <h2>Shopping window</h2>
    <p class="shop-dates" data-window>Meals from ${window.from} to ${window.to}</p>
    ${coverageNote}
    <p class="field-label">Shop every</p>
    <div class="freq-options" role="group" aria-label="Shop every">
      ${SHOP_EVERY_OPTIONS.map((n) => `<button type="button" class="freq-option${n === shopEvery ? ' is-active' : ''}" data-shop-every="${n}" aria-pressed="${n === shopEvery ? 'true' : 'false'}">${n} days</button>`).join('')}
    </div>
    <button type="button" class="btn-primary btn-small" data-action="shop-now">I'm shopping now</button>
  </section>`);
  root.appendChild(windowCard);

  const pickFrequency = (nextEvery) => {
    const next = { ...state, shopEvery: nextEvery, shopStart: savedStart };
    ctx.onChange(next);
  };
  windowCard.querySelectorAll('[data-shop-every]').forEach((btn) => {
    btn.addEventListener('click', () => pickFrequency(Number(btn.dataset.shopEvery)));
  });
  windowCard.querySelector('[data-action="shop-now"]').addEventListener('click', () => {
    // A new window; the not-found list belongs to the old trip and is cleared.
    ctx.onChange(shoppingNowState({ ...state, shopEvery }, todayIso()));
  });

  const list = buildShoppingList({
    plan: state.plan,
    recipes,
    foodsById,
    bought: state.bought || [],
    notFound: state.notFound || [],
    fromDate: window.from,
    toDate: window.to,
  });
  const progress = cartProgress(list);

  const buyCard = el(`<section class="card"><h2>To buy</h2>
    <p class="shop-progress" data-cart-progress>${progress.text}</p>
    <div class="shop-groups" data-buy></div>
  </section>`);
  const buyEl = buyCard.querySelector('[data-buy]');
  if (list.toBuyGrouped.length === 0) {
    buyEl.appendChild(el(`<p class="muted">Everything in this shopping window is in the cart or at home.</p>`));
  } else {
    for (const group of list.toBuyGrouped) {
      const block = el(`<div class="shop-group"><h3>${escapeHtml(group.category)}</h3><ul></ul></div>`);
      const ul = block.querySelector('ul');
      for (const item of group.items) {
        const li = el(`<li class="shop-item">
          <label>
            <input type="checkbox" data-food="${escapeHtml(item.foodId)}" aria-label="In cart: ${escapeHtml(displayFoodName(item.name) || item.foodId)}">
            <span>${escapeHtml(displayFoodName(item.name) || item.foodId)}</span>
          </label>
          <span class="shop-item-actions">
            <span class="muted tiny">${item.grams} g</span>
            <button type="button" class="btn-secondary btn-small" data-not-found="${escapeHtml(item.foodId)}">Not found</button>
          </span>
        </li>`);
        ul.appendChild(li);
      }
      buyEl.appendChild(block);
    }
  }
  root.appendChild(buyCard);

  // Directly under To buy: a ticked item stays visible, struck through, with Undo.
  const cartCard = el(`<section class="card"><h2>In cart / at home</h2>
    <div class="shop-groups" data-cart></div>
  </section>`);
  const cartEl = cartCard.querySelector('[data-cart]');
  if (list.inCart.length === 0) {
    cartEl.appendChild(el(`<p class="muted">Tick items above when you put them in the cart. They stay here with an Undo button.</p>`));
  } else {
    for (const group of list.inCartGrouped) {
      const block = el(`<div class="shop-group"><h3>${escapeHtml(group.category)}</h3><ul></ul></div>`);
      const ul = block.querySelector('ul');
      for (const item of group.items) {
        const li = el(`<li class="shop-item is-bought">
          <label>
            <input type="checkbox" checked data-food="${escapeHtml(item.foodId)}" aria-label="In cart: ${escapeHtml(displayFoodName(item.name) || item.foodId)}">
            <span>${escapeHtml(displayFoodName(item.name) || item.foodId)}</span>
          </label>
          <span class="shop-item-actions">
            <span class="badge-in-cart">In cart</span>
            <span class="muted tiny">${item.grams} g</span>
            <button type="button" class="btn-secondary btn-small" data-undo-food="${escapeHtml(item.foodId)}">Undo</button>
          </span>
        </li>`);
        ul.appendChild(li);
      }
      cartEl.appendChild(block);
    }
  }
  root.appendChild(cartCard);

  // Items that were not in the shop: each row says which planned meals use it.
  if (list.notFound.length > 0) {
    const missCard = el(`<section class="card"><h2>Not found</h2>
      <div class="shop-groups" data-notfound></div>
    </section>`);
    const missEl = missCard.querySelector('[data-notfound]');
    for (const group of list.notFoundGrouped) {
      const block = el(`<div class="shop-group"><h3>${escapeHtml(group.category)}</h3><ul></ul></div>`);
      const ul = block.querySelector('ul');
      for (const item of group.items) {
        const meals = mealsUsingFood({
          plan: state.plan,
          recipes,
          recipesById: ctx.recipesById,
          foodId: item.foodId,
          fromDate: window.from,
          toDate: window.to,
        });
        const swapRows = meals.length === 0
          ? '<li class="muted tiny">No planned meal in this window uses it.</li>'
          : meals.map((meal) => `<li class="shop-swap-row">
              <span>${escapeHtml(meal.date)} · ${escapeHtml(slotLabel(meal.slot))} · ${escapeHtml(meal.recipeName)}</span>
              <button type="button" class="btn-secondary btn-small" data-swap-meal="${escapeHtml(item.foodId)}" data-date="${escapeHtml(meal.date)}" data-slot="${escapeHtml(meal.slot)}">Swap meal</button>
            </li>`).join('');
        const li = el(`<li class="shop-item is-not-found">
          <div class="shop-item-main">
            <span>${escapeHtml(displayFoodName(item.name) || item.foodId)}</span>
            <span class="badge-not-found">Not found</span>
            <span class="muted tiny">${item.grams} g</span>
            <button type="button" class="btn-secondary btn-small" data-undo-food="${escapeHtml(item.foodId)}">Undo</button>
          </div>
          <p class="muted tiny shop-swap-hint">Not in the shop? Swap one of the meals that use it.</p>
          <ul class="shop-swaps">${swapRows}</ul>
        </li>`);
        ul.appendChild(li);
      }
      missEl.appendChild(block);
    }
    root.appendChild(missCard);
  }

  if (state.keptForBought?.length) {
    root.appendChild(el(`<section class="card note-card">
      <h3>Kept for what you already bought</h3>
      <p class="muted">After the last update, ${state.keptForBought.length} meal slot${state.keptForBought.length === 1 ? '' : 's'} stayed on the plan because ingredients were already at home.</p>
    </section>`));
  }

  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  // A tick means "in the cart"; unticking or Undo puts the item back in To buy.
  root.querySelectorAll('input[data-food]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.food;
      ctx.onChange(input.checked ? markItemInCart(state, id) : undoItemState(state, id));
    });
  });

  // Not found keeps the item on screen and takes it out of the cart.
  root.querySelectorAll('[data-not-found]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.onChange(markItemNotFound(state, btn.dataset.notFound));
    });
  });

  root.querySelectorAll('[data-undo-food]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.onChange(undoItemState(state, btn.dataset.undoFood));
    });
  });

  // Swap a planned meal that uses the missing ingredient: the day screen opens
  // for that date with the meal's Replace picker already open.
  root.querySelectorAll('[data-swap-meal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.date;
      const slot = btn.dataset.slot;
      if (!date || !slot) return;
      ctx.selectedDate = date;
      ctx.openReplace = { date, slot };
      ctx.navigate('plan');
    });
  });

  return root;
}
