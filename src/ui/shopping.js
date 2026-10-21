import {
  buildShoppingList,
  shoppingWindow,
  currentShopStart,
  windowCoverage,
  savedShopStart,
  SHOP_EVERY_OPTIONS,
} from '../engine/shopping.js';
import { todayIso } from '../engine/planner.js';
import { el, escapeHtml } from './dom.js';

export function renderShopping(ctx) {
  const { state, recipes, foodsById } = ctx;
  const root = el(`<div class="screen screen-shopping"></div>`);

  root.appendChild(el(`<header class="brand brand-compact">
    <span class="logo" aria-hidden="true">🌿</span>
    <div><h1>Shopping list</h1><p>Tick what you already have at home.</p></div>
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
    ctx.onChange({ ...state, shopEvery, shopStart: todayIso() });
  });

  const list = buildShoppingList({
    plan: state.plan,
    recipes,
    foodsById,
    bought: state.bought || [],
    fromDate: window.from,
    toDate: window.to,
  });

  const buyCard = el(`<section class="card"><h2>To buy</h2><div class="shop-groups" data-buy></div></section>`);
  const buyEl = buyCard.querySelector('[data-buy]');
  if (list.toBuyGrouped.length === 0) {
    buyEl.appendChild(el(`<p class="muted">Everything in this shopping window is already at home.</p>`));
  } else {
    for (const group of list.toBuyGrouped) {
      const block = el(`<div class="shop-group"><h3>${escapeHtml(group.category)}</h3><ul></ul></div>`);
      const ul = block.querySelector('ul');
      for (const item of group.items) {
        const li = el(`<li class="shop-item">
          <label>
            <input type="checkbox" data-food="${escapeHtml(item.foodId)}">
            <span>${escapeHtml(item.name)}</span>
          </label>
          <span class="muted tiny">${item.grams} g</span>
        </li>`);
        ul.appendChild(li);
      }
      buyEl.appendChild(block);
    }
  }
  root.appendChild(buyCard);

  const homeCard = el(`<section class="card"><h2>Already at home</h2><div class="shop-groups" data-home></div></section>`);
  const homeEl = homeCard.querySelector('[data-home]');
  if (list.atHome.length === 0) {
    homeEl.appendChild(el(`<p class="muted">Tick items above when you buy them. They will move here and leave the to-buy list.</p>`));
  } else {
    for (const group of list.atHomeGrouped) {
      const block = el(`<div class="shop-group"><h3>${escapeHtml(group.category)}</h3><ul></ul></div>`);
      const ul = block.querySelector('ul');
      for (const item of group.items) {
        const li = el(`<li class="shop-item is-bought">
          <label>
            <input type="checkbox" checked data-food="${escapeHtml(item.foodId)}">
            <span>${escapeHtml(item.name)}</span>
          </label>
          <span class="muted tiny">${item.grams} g</span>
        </li>`);
        ul.appendChild(li);
      }
      homeEl.appendChild(block);
    }
  }
  root.appendChild(homeCard);

  if (state.keptForBought?.length) {
    root.appendChild(el(`<section class="card note-card">
      <h3>Kept for what you already bought</h3>
      <p class="muted">After the last update, ${state.keptForBought.length} meal slot${state.keptForBought.length === 1 ? '' : 's'} stayed on the plan because ingredients were already at home.</p>
    </section>`));
  }

  root.appendChild(el(`<p class="footer-note">Support tool, not medical advice.</p>`));

  root.querySelectorAll('input[data-food]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.food;
      const bought = new Set(state.bought || []);
      if (input.checked) bought.add(id);
      else bought.delete(id);
      ctx.onChange({ ...state, bought: [...bought] });
    });
  });

  return root;
}
