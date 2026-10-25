/**
 * D13: on a phone every text-style button and small control is at least 44 x 44 px,
 * and nothing is forced wider than the 375 px viewport. Static checks on the
 * stylesheet and on the markup of the named controls; no browser is needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].split(',').map((s) => s.trim()).filter(Boolean),
  body: match[2],
}));

function bodiesFor(selector) {
  return rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join('\n');
}

function pxValues(body, property) {
  const re = new RegExp(`${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`, 'g');
  return [...body.matchAll(re)].map((match) => Number(match[1]));
}

const LABELS = [
  'Cancel',
  'How it works',
  'Clear all',
  'Start over',
  'Change profile',
  'Undo',
];

function buttonsIn(folder) {
  const found = [];
  for (const file of fs.readdirSync(new URL(folder, import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const source = fs.readFileSync(new URL(`${folder}${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/<button\b([^>]*)>\s*([^<]+?)\s*<\/button>/g)) {
      found.push({ file, attrs: match[1], label: match[2].trim() });
    }
  }
  return found;
}

test('D13: text-style buttons are 44 x 44 or larger', () => {
  const body = bodiesFor('.btn-text');
  assert.ok(body, 'a .btn-text rule exists');
  assert.ok(Math.max(...pxValues(body, 'min-height')) >= 44, '.btn-text has min-height 44px');
  assert.ok(Math.max(...pxValues(body, 'min-width')) >= 44, '.btn-text has min-width 44px');
  assert.ok(pxValues(body, 'padding').length > 0, '.btn-text keeps padding so it still looks like a link');
});

test('D13: small controls are 44 px tall and at least 44 px wide', () => {
  const body = bodiesFor('.btn-small');
  assert.ok(Math.max(...pxValues(body, 'min-height')) >= 44, '.btn-small has min-height 44px');
  assert.ok(Math.max(...pxValues(body, 'min-width')) >= 44, '.btn-small has min-width 44px');
});

test('D13: the confirmation panels keep their Cancel full height too', () => {
  const body = bodiesFor('.confirm-actions .btn-secondary');
  assert.ok(Math.max(...pxValues(body, 'min-height')) >= 44);
});

test('D13: no touched control is forced wider than a 375 px phone', () => {
  for (const selector of ['.btn-text', '.btn-small', '.btn-icon']) {
    for (const width of pxValues(bodiesFor(selector), 'min-width')) {
      assert.ok(width <= 375, `${selector} min-width ${width}px fits the phone`);
    }
    for (const width of pxValues(bodiesFor(selector), 'width')) {
      assert.ok(width <= 375, `${selector} width ${width}px fits the phone`);
    }
  }
});

test('D13: every named control is a real touch-target button', () => {
  const buttons = buttonsIn('../src/ui/');
  for (const label of LABELS) {
    const matches = buttons.filter((button) => button.label === label);
    assert.ok(matches.length > 0, `found a "${label}" button`);
    for (const button of matches) {
      const cls = /class="([^"]*)"/.exec(button.attrs)?.[1] || '';
      assert.match(cls, /btn-/, `"${label}" in ${button.file} has a button class`);
      // Text-style and small controls must rely on the 44 px rules checked above.
      if (/\bbtn-(text|small|icon)\b/.test(cls)) continue;
      assert.match(cls, /btn-(secondary|primary)/, `"${label}" in ${button.file} is a styled button`);
    }
  }
});
