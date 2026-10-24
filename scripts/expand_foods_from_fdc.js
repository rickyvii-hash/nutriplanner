// Dev-only data build: fills the fdcId and the per-100 g nutrients of the foods in
// data/curated_foods.json from the public USDA FoodData Central API.
//
// Usage: node scripts/expand_foods_from_fdc.js [--key DEMO_KEY]
//
// Entries that already have a real fdcId keep it. Entries with fdcId null are looked up
// by name (or by the "usda" description when present). Only SR Legacy, Foundation and
// Survey records are accepted; the first SR Legacy match wins. When USDA has no value
// for a nutrient it stays null, never zero. Nothing is invented: a food that cannot be
// found is reported and left as it is.
//
// The API is used only by this script. The app itself is static and never calls it.
// USDA FoodData Central data is public domain (CC0).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const NUTRIENT_IDS = {
  1008: 'kcal',
  1003: 'protein',
  1004: 'fat',
  1258: 'satFat',
  1005: 'carbs',
  1079: 'fibre',
  2000: 'sugars',
  1093: 'sodium',
};

const API_ROOT = 'https://api.nal.usda.gov/fdc/v1';
const DATA_TYPES = ['SR Legacy', 'Foundation', 'Survey (FNDDS)'];

const keyIndex = process.argv.indexOf('--key');
const apiKey = keyIndex > -1 ? process.argv[keyIndex + 1] : 'DEMO_KEY';

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function emptyNutrients() {
  return Object.fromEntries(Object.values(NUTRIENT_IDS).map((key) => [key, null]));
}

/** Nutrients per 100 g from an FDC food object, keyed like data/foods.json. */
function nutrientsFromFdc(food) {
  const per100g = emptyNutrients();
  for (const n of food.foodNutrients || []) {
    const key = NUTRIENT_IDS[n.nutrientId ?? n.nutrient?.id];
    if (!key) continue;
    const amount = n.amount ?? n.value ?? n.nutrientNumber;
    if (amount === null || amount === undefined || amount === '') continue;
    const value = Number(amount);
    if (Number.isFinite(value)) per100g[key] = value;
  }
  return per100g;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(pathname) {
  const separator = pathname.includes('?') ? '&' : '?';
  const url = `${API_ROOT}${pathname}${separator}api_key=${encodeURIComponent(apiKey)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url);
    if (response.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`FDC ${response.status} for ${pathname}`);
    return response.json();
  }
  throw new Error(`FDC rate limit did not clear for ${pathname}`);
}

function pickRecord(foods) {
  for (const dataType of DATA_TYPES) {
    const hit = foods.find((f) => (f.dataType || '').toLowerCase() === dataType.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

async function lookup(entry) {
  const query = entry.usda || entry.name;
  const search = await api(`/foods/search?query=${encodeURIComponent(query)}&pageSize=25`);
  const record = pickRecord(search.foods || []);
  if (!record) return null;
  const detail = await api(`/food/${record.fdcId}`);
  return {
    fdcId: record.fdcId,
    description: record.description || entry.name,
    per100g: nutrientsFromFdc(detail),
  };
}

async function main() {
  const curatedPath = path.join(root, 'data', 'curated_foods.json');
  const foodsPath = path.join(root, 'data', 'foods.json');

  const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
  const foods = JSON.parse(fs.readFileSync(foodsPath, 'utf8'));
  const byId = new Map(foods.map((food) => [food.id, food]));
  const usedFdcIds = new Set(foods.map((food) => food.fdcId).filter(Boolean));

  let added = 0;
  let filled = 0;
  const notFound = [];

  for (const entry of curated) {
    if (entry.fdcId) continue;
    const hit = await lookup(entry);
    await sleep(350);
    if (!hit) {
      notFound.push(entry.name);
      continue;
    }
    if (usedFdcIds.has(hit.fdcId)) {
      notFound.push(`${entry.name} (fdcId ${hit.fdcId} already used)`);
      continue;
    }
    entry.fdcId = hit.fdcId;
    entry.usda = hit.description;
    usedFdcIds.add(hit.fdcId);

    const id = slug(entry.name);
    const existing = byId.get(id);
    if (existing && existing.fdcId && existing.fdcId !== hit.fdcId) {
      notFound.push(`${entry.name} (id slug "${id}" already used)`);
      entry.fdcId = null;
      entry.usda = null;
      continue;
    }
    if (existing) {
      existing.fdcId = hit.fdcId;
      existing.usdaName = hit.description;
      existing.per100g = hit.per100g;
      filled += 1;
    } else {
      const food = {
        id,
        fdcId: hit.fdcId,
        name: entry.name,
        category: entry.category,
        usdaName: hit.description,
        per100g: hit.per100g,
      };
      foods.push(food);
      byId.set(id, food);
      added += 1;
    }
    console.log(`ok  ${entry.name} -> ${hit.fdcId} (${hit.description})`);
  }

  foods.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(curatedPath, JSON.stringify(curated, null, 2) + '\n');
  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 1) + '\n');

  console.log(`\nAdded ${added}, filled ${filled}, total ${foods.length} foods.`);
  if (notFound.length) {
    console.log(`Not resolved (${notFound.length}):`);
    for (const name of notFound) console.log(`  - ${name}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
