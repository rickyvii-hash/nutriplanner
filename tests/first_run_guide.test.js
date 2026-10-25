/**
 * F6 — First-run guide: three steps, dismissible, How it works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GUIDE_STEPS,
  shouldShowGuide,
  dismissGuideState,
} from '../src/engine/guide.js';

test('three short steps: choose a goal, build the plan, log what you eat', () => {
  assert.equal(GUIDE_STEPS.length, 3);
  const text = GUIDE_STEPS.map((s) => `${s.title} ${s.body}`).join(' ').toLowerCase();
  assert.match(text, /goal|profile/);
  assert.match(text, /build|plan/);
  assert.match(text, /log/);
});

test('shown only when storage is empty and not dismissed', () => {
  assert.equal(shouldShowGuide({ profileId: null, plan: null, guideDismissed: false }), true);
  assert.equal(shouldShowGuide({ profileId: null, plan: null, guideDismissed: true }), false);
  assert.equal(shouldShowGuide({ profileId: 'cholesterol', plan: null, guideDismissed: false }), false);
  assert.equal(shouldShowGuide({
    profileId: 'cholesterol',
    plan: { month: '2026-10', days: {} },
    guideDismissed: false,
  }), false);
});

test('dismissGuideState sets guideDismissed', () => {
  const next = dismissGuideState({ profileId: null, guideDismissed: false });
  assert.equal(next.guideDismissed, true);
});

test('UI source: guide and How it works link', () => {
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const guideUi = fs.readFileSync(new URL('../src/ui/guide.js', import.meta.url), 'utf8');
  assert.match(guideUi, /How it works|choose a goal|Build/i);
  assert.match(app + guideUi, /How it works/);
  assert.match(guideUi, /Dismiss|Got it|Skip/i);
});
