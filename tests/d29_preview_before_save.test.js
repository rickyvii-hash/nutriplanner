/**
 * D29 (P1): "See the effect before you save".
 *
 * While the person is still building the list on "Outside the menu", a small
 * card under "To add" says what saving the current draft would do. It is the
 * same computation the save runs (log entries + merged log + the pure replan),
 * done as a dry run: no state, no storage, no navigation, no draft changes.
 * The numbers it shows must equal the Plan updated screen after the same save.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profileById } from '../src/engine/profiles.js';
import { buildPlan } from '../src/engine/planner.js';
import { buildCustomFood, foodIndexWithCustomFoods } from '../src/engine/custom_foods.js';
import { emptyAppState, saveState } from '../src/store.js';
import { newLogDraft, draftSavePayload } from '../src/ui/log.js';
import {
  previewExtra, computeExtraSave, extraSaveNextState, topEffectRows, PREVIEW_NO_CHANGE,
  PREVIEW_HEADLINE,
} from '../src/engine/preview_extra.js';
import { previewCardModel, PREVIEW_UNREACHABLE_NOTE } from '../src/ui/preview_card.js';
import { effectRowModel } from '../src/ui/updated.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const foods = JSON.parse(read('data/foods.json'));
const recipes = JSON.parse(read('data/recipes.json'));
const recipesById = new Map(recipes.map((r) => [r.id, r]));
const dbFoodsById = new Map(foods.map((f) => [f.id, f]));

const appSrc = read('src/app.js');
const logSrc = read('src/ui/log.js');
const updatedSrc = read('src/ui/updated.js');
const previewSrc = read('src/engine/preview_extra.js');
const cardSrc = read('src/ui/preview_card.js');
const stylesSrc = read('styles/app.css');

const MONTH = { year: 2026, month: 10 };
const TODAY = '2026-10-24';
const NOW_TIME = '18:52';
const YESTERDAY = '2026-10-23';
const JUST_NOW = { date: TODAY, time: NOW_TIME };
const EARLIER = { date: YESTERDAY, time: '13:00' };
const PIZZA = 'pizza-cheese';
const ICE_CREAM = 'ice-cream-vanilla';
const COLA = 'beverages-carbonated-cola-regular';
const PROFILES = ['cholesterol', 'recovery'];

const customFood = buildCustomFood({
  name: 'Test smoothie', kcal: 210, protein: 8, fibre: 3, sodium: 90,
});

function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

function makeCtx(profileId, { customFoods = [] } = {}) {
  const targets = profileById(profileId).targets;
  const state = {
    ...emptyAppState(),
    profileId,
    targets,
    plan: buildPlan(targets, recipes, MONTH, dbFoodsById),
    planBase: null,
    log: [],
    plannedExtras: [],
    updateDecisions: [],
    customFoods,
  };
  return {
    state,
    recipes,
    recipesById,
    foodsById: customFoods.length
      ? foodIndexWithCustomFoods(foods, customFoods)
      : dbFoodsById,
    proposal: { marker: 'the open proposal must stay' },
    logDraft: {
      items: [{ foodId: PIZZA, grams: 350 }],
      groups: [],
      skipped: [],
    },
  };
}

function draftPayload(items) {
  const draft = newLogDraft();
  draft.items.push(...items);
  return draftSavePayload(draft);
}

function snapshotStorage(map) {
  return JSON.stringify([...map.entries()]);
}

// --- 1) A dry run: same computation, nothing written ------------------------

test('D29: previewExtra changes nothing: state, storage, proposals and draft stay as they were', () => {
  const storage = installMemoryStorage();
  const ctx = makeCtx('cholesterol');
  saveState(ctx.state);
  const stateBefore = JSON.stringify(ctx.state);
  const storageBefore = snapshotStorage(storage);
  const proposalBefore = ctx.proposal;
  const draftBefore = JSON.stringify(ctx.logDraft);
  const payload = draftPayload([{ foodId: PIZZA, grams: 350 }]);
  const payloadBefore = JSON.stringify(payload);

  const preview = previewExtra(ctx, payload, JUST_NOW, { today: TODAY, nowTime: NOW_TIME });

  assert.equal(preview.shown, true);
  assert.equal(JSON.stringify(ctx.state), stateBefore, 'ctx.state must not change');
  assert.equal(snapshotStorage(storage), storageBefore, 'localStorage must not change');
  assert.equal(ctx.proposal, proposalBefore, 'ctx.proposal must not be replaced');
  assert.equal(ctx.state.pendingProposal, null, 'no proposal may be stored');
  assert.equal(JSON.stringify(ctx.logDraft), draftBefore, 'the draft must not change');
  assert.equal(JSON.stringify(payload), payloadBefore, 'the payload must not change');
  // The dry run never stores or navigates on its own.
  assert.doesNotMatch(previewSrc, /saveState|localStorage|navigate\(|ctx\.state\s*=/);
});

test('D29: the save path and the preview share one computation (no second planner)', () => {
  const fn = appSrc.match(/saveLogAndReplan:[\s\S]*?navigate\('updated'\);/);
  assert.ok(fn, 'saveLogAndReplan must exist');
  assert.match(fn[0], /computeExtraSave\(/, 'the save must call the shared computation');
  assert.match(appSrc, /from '\.\/engine\/preview_extra\.js'/);
  assert.match(appSrc, /extraSaveNextState\(/);
  // The preview module itself must not build a plan: it calls the shared code.
  assert.match(previewSrc, /computeExtraSave\(/);
  assert.doesNotMatch(previewSrc, /\bbuildPlan\(|\breplan\(/, 'no separate planner in the preview');
});

test('D29: what the save would store equals what the card previews', () => {
  const ctx = makeCtx('cholesterol');
  const payload = draftPayload([{ foodId: PIZZA, grams: 350 }, { foodId: ICE_CREAM, grams: 100 }]);
  const preview = previewExtra(ctx, payload, JUST_NOW, { today: TODAY, nowTime: NOW_TIME });
  const computed = computeExtraSave({
    state: ctx.state,
    recipes,
    recipesById,
    foodsById: dbFoodsById,
    payload,
    when: JUST_NOW,
    today: TODAY,
  });
  const next = extraSaveNextState(ctx.state, computed);
  assert.ok(next.pendingProposal, 'a real save stores the proposal');
  const model = previewCardModel(preview);
  assert.equal(model.reason, next.pendingProposal.reason);
  assert.deepEqual(
    model.rows,
    topEffectRows(next.pendingProposal.effects).map(effectRowModel),
  );
});

// --- 2) When the card appears ----------------------------------------------

test('D29: no card for an empty list, a planned meal, or an invalid Earlier moment', () => {
  const ctx = makeCtx('cholesterol');
  const empty = draftPayload([]);
  assert.equal(previewCardModel(previewExtra(ctx, empty, JUST_NOW, { today: TODAY, nowTime: NOW_TIME })), null);

  const payload = draftPayload([{ foodId: PIZZA, grams: 200 }]);
  // A planned meal is expected intake, not eaten food: no preview card.
  assert.equal(
    previewCardModel(previewExtra(ctx, payload, { ...JUST_NOW, planned: true }, { today: TODAY, nowTime: NOW_TIME })),
    null,
  );
  // Earlier needs a real, past moment inside the plan month.
  for (const when of [
    { date: '2026-10-25', time: '09:00' },
    { date: TODAY, time: '23:59' },
    { date: '', time: '' },
    { date: '2026-09-30', time: '12:00' },
  ]) {
    assert.equal(
      previewCardModel(previewExtra(ctx, payload, when, { today: TODAY, nowTime: NOW_TIME })),
      null,
      JSON.stringify(when),
    );
  }
  assert.ok(previewCardModel(previewExtra(ctx, payload, EARLIER, { today: TODAY, nowTime: NOW_TIME })));
});

test('D29: an unknown or removed food in the draft hides the card instead of throwing', () => {
  const ctx = makeCtx('cholesterol');
  const payload = draftPayload([
    { foodId: PIZZA, grams: 200 },
    { foodId: 'a-food-that-no-longer-exists', grams: 100, name: 'Old custom food' },
  ]);
  let preview;
  assert.doesNotThrow(() => {
    preview = previewExtra(ctx, payload, JUST_NOW, { today: TODAY, nowTime: NOW_TIME });
  });
  assert.equal(preview.shown, false);
  assert.equal(previewCardModel(preview), null);
});

// --- 3) Honesty: the card equals the Plan updated screen -------------------

test('D29 honesty: reason and effect rows match the real save for every draft, on two profiles', () => {
  const drafts = [
    { name: 'pizza 350 g', items: [{ foodId: PIZZA, grams: 350 }], when: JUST_NOW },
    { name: 'ice cream 100 g', items: [{ foodId: ICE_CREAM, grams: 100 }], when: JUST_NOW },
    { name: 'a drink', items: [{ foodId: COLA, grams: 330 }], when: JUST_NOW },
    { name: 'a custom food', items: [{ foodId: customFood.id, grams: 150 }], when: JUST_NOW, custom: true },
    { name: 'an Earlier entry for yesterday', items: [{ foodId: PIZZA, grams: 250 }], when: EARLIER },
  ];
  for (const profileId of PROFILES) {
    for (const draft of drafts) {
      const customFoods = draft.custom ? [customFood] : [];
      const ctx = makeCtx(profileId, { customFoods });
      const payload = draftPayload(draft.items);
      const options = { today: TODAY, nowTime: NOW_TIME };
      const preview = previewExtra(ctx, payload, draft.when, options);
      assert.equal(preview.shown, true, `${profileId} / ${draft.name}: a card is shown`);

      // The real save path: the very computation saveLogAndReplan runs.
      const computed = computeExtraSave({
        state: ctx.state,
        recipes,
        recipesById,
        foodsById: ctx.foodsById,
        payload,
        when: draft.when,
        today: TODAY,
      });
      assert.ok(computed, `${profileId} / ${draft.name}: the save computes a result`);
      const proposal = computed.result && computed.result.nothingToChange !== true
        ? computed.result
        : null;
      const model = previewCardModel(preview);

      if (proposal) {
        assert.equal(model.reason, proposal.reason, `${profileId} / ${draft.name}: same reason`);
        assert.deepEqual(
          model.rows,
          topEffectRows(proposal.effects).map(effectRowModel),
          `${profileId} / ${draft.name}: same effect rows`,
        );
        assert.equal(preview.nothingToChange, false);
        for (const row of model.rows) {
          assert.ok(row.label && row.status && row.detail, 'a row is fully formatted');
          assert.match(row.detail, /\/day avg \(goal (max|min) /);
        }
      } else {
        assert.equal(model.reason, PREVIEW_NO_CHANGE, `${profileId} / ${draft.name}: stay line`);
        assert.deepEqual(model.rows, []);
        assert.equal(preview.nothingToChange, true);
      }

      // The stored proposal would read the same after the save.
      const next = extraSaveNextState(ctx.state, computed);
      assert.equal(next.pendingProposal.reason, computed.result.reason);
    }
  }
});

test('D29: the card shows at most the two effect rows that change most', () => {
  const ctx = makeCtx('cholesterol');
  const payload = draftPayload([{ foodId: PIZZA, grams: 350 }, { foodId: ICE_CREAM, grams: 150 }]);
  const preview = previewExtra(ctx, payload, JUST_NOW, { today: TODAY, nowTime: NOW_TIME });
  assert.ok(preview.rows.length <= 2);
  const computed = computeExtraSave({
    state: ctx.state,
    recipes,
    recipesById,
    foodsById: dbFoodsById,
    payload,
    when: JUST_NOW,
    today: TODAY,
  });
  if (computed.result.effects.length > 2) {
    assert.equal(preview.rows.length, 2);
  }
});

test('D29: an over-maximum day is said plainly, exactly as the Plan updated screen does', () => {
  const ctx = makeCtx('cholesterol');
  const payload = draftPayload([{ foodId: PIZZA, grams: 500 }, { foodId: ICE_CREAM, grams: 300 }]);
  const preview = previewExtra(ctx, payload, JUST_NOW, { today: TODAY, nowTime: NOW_TIME });
  const model = previewCardModel(preview);
  if (preview.proposal?.reason && /goes over your goal/.test(preview.proposal.reason)) {
    assert.match(model.reason, /goes over your goal/);
  }
  if (preview.proposal?.unreachable) {
    assert.equal(model.note, PREVIEW_UNREACHABLE_NOTE);
  }
});

// --- 4) The card on the screen ---------------------------------------------

test('D29: the card sits under "To add", updates with the draft and never blocks typing', () => {
  assert.match(logSrc, /previewExtra\(/);
  assert.match(logSrc, /data-preview/);
  assert.match(logSrc, /renderPreviewCard\(/);
  // Planned meals never get the eaten-food preview.
  assert.match(logSrc, /whenMode === 'planned'/);
  // A small debounce and a try/catch: typing is never blocked and nothing throws.
  assert.match(logSrc, /setTimeout\(/);
  assert.match(logSrc, /try\s*\{[\s\S]*previewExtra\(/);
  assert.match(logSrc, /catch/);
  // The card is painted after the list and before the Save button.
  const cardAt = logSrc.indexOf('data-preview');
  const saveAt = logSrc.indexOf('data-save');
  assert.ok(cardAt > 0 && cardAt < saveAt, 'the card host comes before Save');
  assert.match(cardSrc, /If you save this/);
  // The no-change sentence lives in the engine: the card shows it verbatim.
  const noChange = previewCardModel({ shown: true, nothingToChange: true });
  assert.equal(noChange.reason, PREVIEW_NO_CHANGE);
  assert.match(PREVIEW_NO_CHANGE, /Your plan would stay as it is\./);
});

test('D29: the card reuses the exact Effect row formatting of Plan updated', () => {
  assert.match(updatedSrc, /export function effectRowModel/);
  assert.match(updatedSrc, /effectRowModel\(e\)/);
  assert.match(cardSrc, /effectRowModel/);
  assert.match(cardSrc, /preview-effect/);
  assert.match(cardSrc, /escapeHtml\(/);
  assert.equal(PREVIEW_HEADLINE, 'If you save this');
  assert.equal(PREVIEW_NO_CHANGE, 'Your plan would stay as it is.');
});

test('D29: phone width 375 px: the card wraps and never overflows', () => {
  assert.match(stylesSrc, /\.preview-card\b/);
  assert.match(stylesSrc, /\.preview-card[\s\S]{0,400}(max-width|overflow-wrap|flex-wrap)/);
  assert.match(stylesSrc, /\.preview-card \.preview-effect[\s\S]{0,400}flex-wrap/);
  assert.doesNotMatch(stylesSrc, /\.preview-card[^}]*width:\s*[4-9]\d\dpx/);
});
