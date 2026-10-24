import {
  loadState, saveState, getStorageNotice,
  proposalToStore, pendingProposalForPlan, withoutPendingProposal,
  applyStaleMonthOnStart,
} from './store.js';
import {
  buildPlan, replan, todayIso, localTime,
} from './engine/planner.js';
import { renderTargets } from './ui/targets.js';
import { renderPlan } from './ui/plan.js';
import { renderLog } from './ui/log.js';
import { renderUpdated } from './ui/updated.js';
import { renderShopping } from './ui/shopping.js';
import { renderSummary } from './ui/summary.js';
import { shouldShowNav } from './ui/nav.js';

const app = document.getElementById('app');

const ctx = {
  state: loadState(),
  foods: [],
  recipes: [],
  foodsById: new Map(),
  recipesById: new Map(),
  screen: 'targets',
  selectedDate: null,
  proposal: null,
  logDraft: null,
  monthBanner: null,
  navigate: (name) => {
    ctx.screen = name;
    if (name !== 'log') ctx.logDraft = null;
    render();
  },
  refresh: () => {
    render();
  },
  onChange: (next) => {
    ctx.state = next;
    saveState(ctx.state);
    render();
  },
  buildPlan: () => {
    if (!ctx.state.targets?.length) return;
    const now = new Date();
    const plan = buildPlan(
      ctx.state.targets,
      ctx.recipes,
      { year: now.getFullYear(), month: now.getMonth() + 1 },
      ctx.foodsById,
      ctx.state.bought || [],
    );
    // A new month plan replaces any leftover update proposal and clears a stale-month banner.
    ctx.state = withoutPendingProposal({ ...ctx.state, plan, keptForBought: [] });
    ctx.proposal = null;
    ctx.monthBanner = null;
    saveState(ctx.state);
    ctx.selectedDate = todayIso();
    ctx.navigate('plan');
  },
  saveLogAndReplan: (payload) => {
    if (!ctx.state.plan) return;
    // Accept either a food-item array (older callers) or { items, skipped, replaced }.
    const items = Array.isArray(payload) ? payload : (payload?.items || []);
    const skipped = Array.isArray(payload) ? [] : (payload?.skipped || []);
    // A replacement records which planned meal was swapped, so the reason can name it.
    const replaced = Array.isArray(payload) ? [] : (payload?.replaced || []);
    if (!items.length && !skipped.length) return;
    const log = [...(ctx.state.log || [])];
    const when = { date: todayIso(), time: localTime() };
    if (items.length) log.push({ ...when, items, ...(replaced.length ? { replaced: [...replaced] } : {}) });
    // Always include items: [] on skips so older progress code never iterates undefined.
    if (skipped.length) log.push({ ...when, skipped: [...skipped], items: [] });
    const result = replan({
      targets: ctx.state.targets,
      recipes: ctx.recipes,
      plan: ctx.state.plan,
      log,
      bought: ctx.state.bought || [],
      foodsById: ctx.foodsById,
      fromDate: todayIso(),
    });
    ctx.state = { ...ctx.state, log, pendingProposal: proposalToStore(result) };
    saveState(ctx.state);
    ctx.proposal = result;
    ctx.logDraft = null;
    ctx.navigate('updated');
  },
  useUpdatedPlan: () => {
    if (!ctx.proposal) return;
    ctx.state = withoutPendingProposal({
      ...ctx.state,
      plan: ctx.proposal.plan,
      keptForBought: ctx.proposal.keptForBought || [],
    });
    saveState(ctx.state);
    ctx.proposal = null;
    ctx.navigate('plan');
  },
  keepOriginalPlan: () => {
    ctx.state = withoutPendingProposal(ctx.state);
    saveState(ctx.state);
    ctx.proposal = null;
    ctx.navigate('plan');
  },
};

function navBar() {
  const items = [
    { id: 'plan', label: 'Plan', icon: '📅' },
    { id: 'shopping', label: 'Shopping', icon: '🛒' },
    { id: 'targets', label: 'Targets', icon: '🎯' },
  ];
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Main');
  for (const item of items) {
    const active = ctx.screen === item.id
      || (item.id === 'plan' && (ctx.screen === 'log' || ctx.screen === 'updated' || ctx.screen === 'summary'));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `nav-item${active ? ' is-active' : ''}`;
    btn.innerHTML = `<span aria-hidden="true">${item.icon}</span><span>${item.label}</span>`;
    btn.addEventListener('click', () => ctx.navigate(item.id));
    nav.appendChild(btn);
  }
  return nav;
}

function render() {
  app.innerHTML = '';
  const notice = getStorageNotice();
  if (notice) {
    const n = document.createElement('div');
    n.className = 'storage-notice';
    n.textContent = notice;
    app.appendChild(n);
  }

  let screen;
  if (ctx.screen === 'targets') screen = renderTargets(ctx);
  else if (ctx.screen === 'plan') screen = renderPlan(ctx);
  else if (ctx.screen === 'log') screen = renderLog(ctx);
  else if (ctx.screen === 'updated') screen = renderUpdated(ctx);
  else if (ctx.screen === 'shopping') screen = renderShopping(ctx);
  else if (ctx.screen === 'summary') screen = renderSummary(ctx);
  else screen = renderTargets(ctx);

  app.appendChild(screen);
  if (shouldShowNav(ctx.state)) app.appendChild(navBar());
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

async function start() {
  try {
    const [foods, recipes] = await Promise.all([
      loadJson('data/foods.json'),
      loadJson('data/recipes.json'),
    ]);
    ctx.foods = foods;
    ctx.recipes = recipes;
    ctx.foodsById = new Map(foods.map((f) => [f.id, f]));
    ctx.recipesById = new Map(recipes.map((r) => [r.id, r]));
    // Keep one shopping window on record, starting today until you shop again.
    ctx.state = {
      ...ctx.state,
      shopEvery: [2, 3, 5, 7].includes(ctx.state.shopEvery) ? ctx.state.shopEvery : 7,
      shopStart: ctx.state.shopStart || todayIso(),
    };
    // A plan for another month must not open as today: clear it, keep targets/log/shopping.
    const stale = applyStaleMonthOnStart(ctx.state);
    ctx.state = stale.state;
    ctx.monthBanner = stale.banner;
    if (stale.banner) ctx.proposal = null;
    saveState(ctx.state);

    const pending = pendingProposalForPlan(ctx.state);
    if (pending && !stale.banner) {
      ctx.proposal = pending;
      ctx.screen = 'updated';
    } else if (ctx.state.plan) {
      ctx.state = withoutPendingProposal(ctx.state);
      saveState(ctx.state);
      ctx.screen = 'plan';
    } else {
      ctx.screen = 'targets';
    }
    render();
  } catch (err) {
    app.innerHTML = `<div class="screen">
      <header class="brand"><span class="logo" aria-hidden="true">🌿</span>
        <div><h1>NutriPlanner</h1><p>Adaptive meal planning that flexes with real life.</p></div>
      </header>
      <div class="error"><strong>The app could not load its data.</strong>
        <p>Start it with <code>npx serve .</code> and open the address it prints, instead of opening index.html directly.</p>
        <p class="muted">${err.message}</p></div>
      <p class="footer-note">Support tool, not medical advice.</p>
    </div>`;
  }
}

start();
