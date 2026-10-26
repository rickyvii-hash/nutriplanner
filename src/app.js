import {
  loadState, saveState, getStorageNotice, clearState,
  proposalToStore, pendingProposalForPlan, withoutPendingProposal,
  acceptUpdatedPlan, rejectUpdatedPlan, applyStaleMonthOnStart, startOverState, changeProfileState,
  restoredStateAndScreen,
} from './store.js';
import { buildExportPayload, applyImportPayload, EXPORT_FILE_NAME } from './engine/export_import.js';
import { registerDisplayFoods } from './engine/food_display.js';
import {
  allFoodsWithCustomFoods, buildCustomFood, foodIndexWithCustomFoods, removeCustomFoodFromList,
} from './engine/custom_foods.js';
import {
  buildPlan, todayIso, localTime,
} from './engine/planner.js';
import { renderTargets } from './ui/targets.js';
import { renderPlan, daySaveDecision } from './ui/plan.js';
import { renderLog, mergeLogEntries } from './ui/log.js';
import { recomputeShownPlan } from './engine/plan_from_log.js';
import { computeExtraSave, extraSaveNextState } from './engine/extra_save.js';
import { previewExtra } from './engine/preview_extra.js';
import { makePlannedExtra, plannedExtraToLogEntry } from './engine/planned_extras.js';
import { renderUpdated } from './ui/updated.js';
import { renderShopping } from './ui/shopping.js';
import { renderSummary } from './ui/summary.js';
import { shouldShowNav } from './ui/nav.js';
import { openStartOverPanel, openChangeProfilePanel, openRestorePanel } from './ui/reset.js';
import { shouldShowGuide, dismissGuideState } from './engine/guide.js';
import { openGuide } from './ui/guide.js';
import { resetTransientScreenState } from './screen_state.js';

const app = document.getElementById('app');

/**
 * Save a change to the planned outside-the-menu meals and recompute the shown
 * plan with the same pure function the log uses: the base plan, the log, the
 * decisions and the planned meals are the only inputs. Returns the recompute
 * result, whose proposal is null when the plan does not need to change.
 */
function afterPlannedChange(context, { plannedExtras, log, fromDate }) {
  const recomputed = recomputeShownPlan({
    planBase: context.state.planBase || context.state.plan,
    plan: context.state.plan,
    log,
    decisions: context.state.updateDecisions || [],
    plannedExtras,
    today: todayIso(),
    targets: context.state.targets,
    recipes: context.recipes,
    foodsById: context.foodsById,
    bought: context.state.bought || [],
    mealPrefs: context.state.mealPrefs,
    fromDate,
  });
  context.state = {
    ...context.state,
    log,
    plannedExtras,
    updateDecisions: recomputed.decisions,
    pendingProposal: proposalToStore(recomputed.result),
  };
  saveState(context.state);
  context.proposal = recomputed.result;
  context.logDraft = null;
  context.selectedDate = fromDate;
  return recomputed;
}

const ctx = {
  state: loadState(),
  // The database foods as loaded; `foods` also holds the foods the person added.
  dbFoods: [],
  foods: [],
  recipes: [],
  foodsById: new Map(),
  recipesById: new Map(),
  screen: 'targets',
  selectedDate: null,
  // One-shot hand-off from the shopping list: { date, slot } to open on Plan.
  openReplace: null,
  proposal: null,
  logDraft: null,
  monthBanner: null,
  navigate: (name) => {
    ctx.screen = name;
    if (name !== 'log') ctx.logDraft = null;
    // A Swap meal hand-off survives the move to the day screen, which reads it once.
    if (name !== 'plan') ctx.openReplace = null;
    render();
  },
  // A redraw in place (a day-screen save) keeps the page where it was, and the
  // day strip must not pull the page back up to itself.
  refresh: () => {
    ctx.suppressStripScroll = true;
    render({ keepScroll: true });
  },
  // Keep the search list and the nutrient lookup in step with the saved state.
  // The list is updated in place so a screen that already holds it sees the change.
  refreshFoods: () => {
    const customFoods = Array.isArray(ctx.state.customFoods) ? ctx.state.customFoods : [];
    ctx.foods.length = 0;
    ctx.foods.push(...allFoodsWithCustomFoods(ctx.dbFoods, customFoods));
    ctx.foodsById = foodIndexWithCustomFoods(
      ctx.dbFoods,
      customFoods,
      ctx.state.log || [],
      ctx.state.plannedExtras || [],
    );
  },
  // Save a food the person typed. The values are for one portion, so one portion
  // equals exactly what was entered; a nutrient left empty stays unknown.
  addCustomFood: (value) => {
    const customFoods = Array.isArray(ctx.state.customFoods) ? ctx.state.customFoods : [];
    const food = buildCustomFood(value, customFoods);
    ctx.state = { ...ctx.state, customFoods: [...customFoods, food] };
    saveState(ctx.state);
    ctx.refreshFoods();
    return food;
  },
  // Remove a food from the searchable list. A food the log or a planned meal
  // already uses keeps its definition, hidden but resolving by id, so the next
  // replan never meets an unknown food; a food nothing uses is really removed.
  removeCustomFood: (id) => {
    const customFoods = Array.isArray(ctx.state.customFoods) ? ctx.state.customFoods : [];
    const log = ctx.state.log || [];
    const plannedExtras = ctx.state.plannedExtras || [];
    ctx.state = {
      ...ctx.state,
      customFoods: removeCustomFoodFromList(customFoods, id, { log, plannedExtras }),
    };
    saveState(ctx.state);
    ctx.refreshFoods();
  },
  onChange: (next) => {
    ctx.state = next;
    // The open proposal lives only as long as the saved one: editing targets (or
    // anything else that drops it) must not leave the old numbers on screen.
    if (!next.pendingProposal) ctx.proposal = null;
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
      { mealPrefs: ctx.state.mealPrefs },
    );
    // A new month plan replaces any leftover update proposal and clears a stale-month banner.
    ctx.state = withoutPendingProposal({ ...ctx.state, plan, planBase: null, keptForBought: [] });
    ctx.proposal = null;
    ctx.monthBanner = null;
    saveState(ctx.state);
    ctx.selectedDate = todayIso();
    ctx.navigate('plan');
  },
  saveLogAndReplan: (payload, options = {}) => {
    if (!ctx.state.plan) return;
    // The outside-the-menu screen logs now or an earlier moment. The day screen
    // passes the day it is showing, so a meal chosen on another day is saved for
    // that day on this path.
    const when = {
      date: options?.date || payload?.when?.date || todayIso(),
      time: options?.time || payload?.when?.time || localTime(),
    };
    const today = todayIso();
    // One shared computation, the same one behind the dry-run card: the entries
    // and the merged log are built with logEntriesForSave + mergeLogEntries, then
    // recomputePlanAfterSave or the replan engine produce the proposal. No plan
    // is ever computed twice. The base choice: ctx.state.planBase when the person
    // already logged that day, plan: ctx.state.plan otherwise; the days already
    // over are kept (keptPastDays, built inside the shared computation).
    const computed = computeExtraSave({
      state: ctx.state,
      recipes: ctx.recipes,
      recipesById: ctx.recipesById,
      foodsById: ctx.foodsById,
      payload,
      when,
      today,
    });
    if (!computed) return;
    const result = computed.result;
    // The saved state and the pending proposal the screens read.
    ctx.state = extraSaveNextState(ctx.state, computed);
    saveState(ctx.state);
    ctx.proposal = result;
    ctx.logDraft = null;
    const pastDays = when.date < today;
    if (pastDays) {
      // An entry dated before today counts on that day exactly as if it had been
      // in the log all along: the days already over stay frozen and the make-up
      // window starts from today.
      if (options.stay) return result;
      // The person sees where the entry went: the day screen opens on that date.
      ctx.selectedDate = when.date;
      if (computed.proposal) {
        ctx.navigate('updated');
        return result;
      }
      ctx.dayStatus = `Added for ${when.date}. Plan unchanged.`;
      ctx.navigate('plan');
      return result;
    }
    // A day-screen save asks to stay: the day screen decides what to show (a
    // short status line, or the pending banner it can review later). The result
    // is stored either way, so a Skipped / Replace save that changes the plan
    // still opens the usual Plan updated screen.
    if (options.stay) return result;
    // An outside-the-menu save never passes `stay`. A real change still opens
    // Plan updated; a save that changed nothing comes back to the day screen
    // with a short status line instead of a Plan checked screen with no news.
    const decision = daySaveDecision({ action: options.action || 'extra', proposal: result });
    if (decision.mode === 'inline') {
      ctx.dayStatus = decision.statusText;
      ctx.navigate('plan');
      return result;
    }
    ctx.navigate('updated');
    return result;
  },
  // D29: the dry run behind "If you save this". It reads the saved state and the
  // draft payload only: nothing is stored, navigated or changed.
  previewExtra: (payload, when) => previewExtra(ctx, payload, when),
  // D26: a meal the person already knows they will eat outside the menu. It is
  // not eaten food: it goes to its own list, the plan leaves room for it on its
  // date, and the usual Plan updated screen asks whether to keep or use it.
  savePlannedExtra: (value) => {
    if (!ctx.state?.plan) return null;
    const planned = Array.isArray(ctx.state.plannedExtras) ? ctx.state.plannedExtras : [];
    let extra = makePlannedExtra(value);
    if (extra.items.length === 0) return null;
    // Keep every planned meal addressable even when two share a date and time.
    if (planned.some((item) => item.id === extra.id)) {
      let n = 2;
      while (planned.some((item) => item.id === `${extra.id}-${n}`)) n += 1;
      extra = { ...extra, id: `${extra.id}-${n}` };
    }
    const recomputed = afterPlannedChange(ctx, {
      plannedExtras: [...planned, extra],
      log: ctx.state.log || [],
      fromDate: extra.date,
    });
    if (recomputed.proposal) {
      ctx.navigate('updated');
      return recomputed.result;
    }
    ctx.dayStatus = `Planned for ${extra.date}. Plan unchanged.`;
    ctx.navigate('plan');
    return recomputed.result;
  },
  // "Ate it" moves the planned meal into the log with its own date and time, then
  // the plan is recomputed from the base through the normal path.
  atePlannedExtra: (id) => {
    const planned = Array.isArray(ctx.state.plannedExtras) ? ctx.state.plannedExtras : [];
    const extra = planned.find((item) => item.id === id);
    if (!extra || !ctx.state.plan) return null;
    const entry = plannedExtraToLogEntry(extra);
    const log = mergeLogEntries(ctx.state.log, [entry], {
      date: extra.date,
      planDay: ctx.state.plan.days?.[extra.date],
      recipesById: ctx.recipesById,
    });
    const recomputed = afterPlannedChange(ctx, {
      plannedExtras: planned.filter((item) => item.id !== id),
      log,
      fromDate: extra.date,
    });
    if (recomputed.proposal) {
      ctx.navigate('updated');
      return recomputed.result;
    }
    ctx.dayStatus = `Added for ${extra.date}. Plan unchanged.`;
    ctx.navigate('plan');
    return recomputed.result;
  },
  // "Remove" deletes the planned meal and recomputes everything from the base.
  removePlannedExtra: (id) => {
    const planned = Array.isArray(ctx.state.plannedExtras) ? ctx.state.plannedExtras : [];
    const extra = planned.find((item) => item.id === id);
    if (!extra || !ctx.state.plan) return null;
    const recomputed = afterPlannedChange(ctx, {
      plannedExtras: planned.filter((item) => item.id !== id),
      log: ctx.state.log || [],
      fromDate: extra.date,
    });
    if (recomputed.proposal) {
      ctx.navigate('updated');
      return recomputed.result;
    }
    ctx.dayStatus = 'Planned meal removed. Plan unchanged.';
    ctx.navigate('plan');
    return recomputed.result;
  },
  useUpdatedPlan: () => {
    if (!ctx.proposal) return;
    // Remember the plan from before this accepted update, so a later correction
    // of the triggering log can replan from it.
    ctx.state = acceptUpdatedPlan(ctx.state, ctx.proposal);
    saveState(ctx.state);
    ctx.proposal = null;
    ctx.navigate('plan');
  },
  keepOriginalPlan: () => {
    // Remember the refusal, so a later correction never re-applies this update.
    ctx.state = rejectUpdatedPlan(ctx.state, ctx.proposal);
    saveState(ctx.state);
    ctx.proposal = null;
    ctx.navigate('plan');
  },
  dismissUpdatedPlan: () => {
    // Nothing changed, so there is nothing to accept or refuse: close the notice
    // and go back, leaving the plan untouched.
    ctx.state = withoutPendingProposal(ctx.state);
    saveState(ctx.state);
    ctx.proposal = null;
    ctx.navigate('plan');
  },
  // The guide opens from the Targets "How it works" link, without touching the dismiss flag.
  openGuide: () => openGuide(ctx, { firstRun: false }),
  // Closing the first-run guide keeps it from opening automatically on later visits.
  dismissGuide: () => {
    ctx.state = dismissGuideState(ctx.state);
    saveState(ctx.state);
    render();
  },
  // Both actions ask for confirmation before anything is erased.
  startOver: () => openStartOverPanel(ctx),
  changeProfile: () => openChangeProfilePanel(ctx),
  confirmStartOver: () => {
    // Remove the saved data and forget everything held in memory.
    clearState();
    ctx.state = startOverState();
    resetTransientScreenState(ctx);
    ctx.proposal = null;
    ctx.logDraft = null;
    ctx.selectedDate = null;
    ctx.monthBanner = null;
    ctx.screen = 'targets';
    render();
  },
  // Download my data: a local JSON file built from what is saved right now.
  downloadData: () => {
    const payload = buildExportPayload(ctx.state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = EXPORT_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  // Restore from file asks for confirmation before replacing anything.
  openRestore: (data, summary) => openRestorePanel(ctx, data, summary),
  confirmRestore: (data) => {
    const imported = applyImportPayload(ctx.state, data);
    // applyImportPayload returns the same state when the file is not valid.
    if (imported === ctx.state) return;
    // A restored plan for another month is cleared exactly like on start: the
    // Targets banner explains it, instead of opening the old month as Today.
    const restored = restoredStateAndScreen(imported);
    ctx.state = restored.state;
    saveState(ctx.state);
    resetTransientScreenState(ctx);
    ctx.proposal = null;
    ctx.logDraft = null;
    ctx.selectedDate = null;
    ctx.monthBanner = restored.banner;
    ctx.screen = restored.screen;
    render();
  },
  confirmChangeProfile: ({ keepLog = true } = {}) => {
    // The plan goes; the meal log and shopping ticks stay unless the person clears them.
    ctx.state = changeProfileState(ctx.state, { keepLog });
    saveState(ctx.state);
    resetTransientScreenState(ctx);
    ctx.proposal = null;
    ctx.logDraft = null;
    ctx.selectedDate = null;
    ctx.monthBanner = null;
    ctx.screen = 'targets';
    render();
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

function render({ keepScroll = false } = {}) {
  const scroll = keepScroll && typeof window !== 'undefined'
    ? { x: window.scrollX, y: window.scrollY }
    : null;
  // Every screen reads the same lookup, so a saved, removed or restored food is
  // reflected everywhere on the next paint.
  ctx.refreshFoods();
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
  // Put the page back where it was after a redraw in place: no scroll jump.
  if (scroll && typeof window.scrollTo === 'function') window.scrollTo(scroll.x, scroll.y);
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
    ctx.dbFoods = foods;
    registerDisplayFoods(foods);
    ctx.recipes = recipes;
    ctx.refreshFoods();
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
    if (pending && pending.nothingToChange !== true && !stale.banner) {
      // A pending update is never applied on its own and never lost: the day
      // screen shows it as a banner with Review the update / Not now.
      ctx.proposal = pending;
      ctx.screen = ctx.state.plan ? 'plan' : 'updated';
    } else if (ctx.state.plan) {
      ctx.state = withoutPendingProposal(ctx.state);
      saveState(ctx.state);
      ctx.screen = 'plan';
    } else {
      ctx.screen = 'targets';
    }
    render();
    // First paint on an empty device: three short steps over the profile choice.
    if (shouldShowGuide(ctx.state)) openGuide(ctx, { firstRun: true });
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
