/**
 * D24: the "Snacks per day" buttons are narrower than a fingertip and the text,
 * number and select fields are 39 px tall. Static checks on the stylesheet: the
 * buttons are at least 44 x 44 px, the fields at least 44 px tall, and nothing
 * gets a fixed width wider than a 375 px phone.
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

function pxValues(body, property) {
  const re = new RegExp(`${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`, 'g');
  return [...body.matchAll(re)].map((match) => Number(match[1]));
}

/** True when some rule naming the selector sets the property to at least 44 px. */
function hasTouchSize(selector, property) {
  return rules.some((rule) => rule.selectors.includes(selector)
    && pxValues(rule.body, property).some((value) => value >= 44));
}

test('D24: the "Snacks per day" buttons are at least 44 x 44 px', () => {
  assert.ok(hasTouchSize('.freq-option', 'min-height'), '.freq-option min-height is 44px or more');
  assert.ok(hasTouchSize('.freq-option', 'min-width'), '.freq-option min-width is 44px or more');
});

test('D24: text, number and search inputs and selects are at least 44 px tall', () => {
  for (const selector of [
    'input[type="text"]',
    'input[type="number"]',
    'input[type="search"]',
    'select',
  ]) {
    assert.ok(hasTouchSize(selector, 'min-height'), `${selector} is 44px tall`);
  }
});

test('D24: nothing touched here is forced wider than a 375 px phone', () => {
  for (const selector of [
    '.freq-option',
    'input[type="text"]',
    'input[type="number"]',
    'input[type="search"]',
    'select',
  ]) {
    for (const rule of rules.filter((r) => r.selectors.includes(selector))) {
      for (const width of [...pxValues(rule.body, 'width'), ...pxValues(rule.body, 'min-width')]) {
        assert.ok(width <= 375, `${selector} width ${width}px fits the phone`);
      }
    }
  }
});
