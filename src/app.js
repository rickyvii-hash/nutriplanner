import {
  loadState, saveState, getStorageNotice, clearState,
  proposalToStore, pendingProposalForPlan, withoutPendingProposal,
  acceptUpdatedPlan, applyStaleMonthOnStart, startOverState, changeProfileState,
  startScreenFor,
} from './store.js';
import { buildExportPayload, applyImportPayload, EXPORT_FILE_NAME } from './engine/export_import.js';
import {
  buildPlan, replan, todayIso, localTime,
} from './engine/planner.js';
import { renderTargets } from './ui/targets.js';
import { renderPlan } from './ui/plan.js';
import { renderLog, logEntriesForSave, mergeLogEntries } from './ui/log.js';
import { renderUpdated } from './ui/updated.js';
import { renderShopping } from './ui/shopping.js';
import { renderSummary } from './ui/summary.js';
import { renderLabNotes } from './ui/lab_notes.js';
import {
  addLabNote as addLabNoteEntry,
  updateLabNote as updateLabNoteEntry,
  removeLabNote as removeLabNoteEntry,
} from './engine/lab_notes.js';
import { shouldShowNav } from './ui/nav.js';
import { openStartOverPanel, openChangeProfilePanel, openRestorePanel } from './ui/reset.js';
import { shouldShowGuide, dismissGuideState } from './engine/guide.js';
import { openGuide } from './ui/guide.js';

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
  saveLogAndReplan: (payload) => {
    if (!ctx.state.plan) return;
    // Accept either a food-item array (older callers) or { items, skipped, replaced, eaten, extra }.
    const items = Array.isArray(payload) ? payload : (payload?.items || []);
    const skipped = Array.isArray(payload) ? [] : (payload?.skipped || []);
    if (!items.length && !skipped.length) return;
    const when = { date: todayIso(), time: localTime() };
    // Free-search foods are tagged extra, so a saved entry says it was eaten outside
    // the planned meals; a replacement keeps its `replaced` slot instead.
    const entries = logEntriesForSave(
      Array.isArray(payload) ? { items } : payload,
      when,
    );
    if (entries.length === 0) return;
    // Each date/slot keeps one outcome: a slot already logged is replaced, so the
    // same meal can never be counted twice.
    const log = mergeLogEntries(ctx.state.log, entries, {
      date: when.date,
      planDay: ctx.state.plan.days[when.date],
      recipesById: ctx.recipesById,
    });
    const result = replan({
      targets: ctx.state.targets,
      recipes: ctx.recipes,
      plan: ctx.state.plan,
      log,
      bought: ctx.state.bought || [],
      foodsById: ctx.foodsById,
      fromDate: todayIso(),
      mealPrefs: ctx.state.mealPrefs,
    });
    ctx.state = { ...ctx.state, log, pendingProposal: proposalToStore(result) };
    saveState(ctx.state);
    ctx.proposal = result;
    ctx.logDraft = null;
    ctx.navigate('updated');
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
    ctx.state = withoutPendingProposal(ctx.state);
    saveState(ctx.state);
    ctx.proposal = null;
    ctx.navigate('plan');
  },
  // Lab notes are kept on this device like the rest of the state.
  addLabNote: (note) => {
    ctx.state = { ...ctx.state, labNotes: addLabNoteEntry(ctx.state.labNotes, note) };
    saveState(ctx.state);
    render();
  },
  updateLabNote: (id, patch) => {
    ctx.state = { ...ctx.state, labNotes: updateLabNoteEntry(ctx.state.labNotes, id, patch) };
    saveState(ctx.state);
    render();
  },
  removeLabNote: (id) => {
    ctx.state = { ...ctx.state, labNotes: removeLabNoteEntry(ctx.state.labNotes, id) };
    saveState(ctx.state);
    render();
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
    const next = applyImportPayload(ctx.state, data);
    // applyImportPayload returns the same state when the file is not valid.
    if (next === ctx.state) return;
    ctx.state = next;
    saveState(ctx.state);
    ctx.proposal = null;
    ctx.logDraft = null;
    ctx.selectedDate = null;
    ctx.monthBanner = null;
    ctx.screen = startScreenFor(ctx.state);
    render();
  },
  confirmChangeProfile: ({ keepLog = true } = {}) => {
    // The plan goes; the meal log and shopping ticks stay unless the person clears them.
    ctx.state = changeProfileState(ctx.state, { keepLog });
    saveState(ctx.state);
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
    { id: 'lab-notes', label: 'Lab notes', icon: '🧪' },
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
  else if (ctx.screen === 'lab-notes') screen = renderLabNotes(ctx);
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
