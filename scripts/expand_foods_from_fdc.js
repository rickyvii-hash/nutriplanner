/**
 * Expand data/foods.json from USDA FDC search results (SR Legacy).
 * Uses nutrients already present on search hits — no per-id detail calls (avoids DEMO_KEY 429).
 * Usage: node scripts/expand_foods_from_fdc.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const API = 'https://api.nal.usda.gov/fdc/v1';
const KEY = process.env.FDC_API_KEY || 'DEMO_KEY';

const NUTRIENT_MAP = {
  1008: 'kcal',
  1003: 'protein',
  1004: 'fat',
  1258: 'satFat',
  1005: 'carbs',
  1079: 'fibre',
  2000: 'sugars',
  1093: 'sodium',
};

const QUERIES = [
  'pizza', 'pepperoni pizza', 'cheese pizza', 'frozen pizza',
  'hamburger', 'cheeseburger', 'hamburger with bun',
  'french fries', 'potato chips', 'tortilla chip',
  'ice cream', 'ice creams', 'sherbet',
  'cola', 'carbonated beverage', 'soft drink cola',
  'beer', 'beer light', 'alcoholic beverage beer',
  'wine', 'red wine', 'white wine',
  'coffee', 'orange juice', 'apple juice', 'grape juice',
  'chocolate', 'candy', 'cookie', 'cake', 'brownie',
  'sandwich', 'hot dog', 'lasagna', 'macaroni and cheese',
  'pasta cooked', 'spaghetti', 'egg noodles',
  'croissant', 'doughnut', 'muffin',
  'banana raw', 'apple raw', 'grapes raw', 'orange raw',
  'popcorn', 'pretzels', 'mixed nuts',
  'milkshake', 'fast food',
];

const CATEGORY_FOR = (desc) => {
  const d = desc.toLowerCase();
  if (/beer|wine|cola|soda|drink|juice|coffee|beverage|carbonated/.test(d)) return 'Beverages';
  if (/ice cream|sherbet|cake|cookie|chocolate|doughnut|muffin|croissant|candy|brownie/.test(d)) return 'Sweets';
  if (/chip|pretzel|popcorn|nuts/.test(d)) return 'Snacks';
  if (/pizza|burger|fries|sandwich|hot dog|lasagna|pasta|macaroni|spaghetti|noodle|fast food/.test(d)) return 'Prepared';
  if (/apple|banana|grape|orange|fruit/.test(d)) return 'Produce';
  return 'Other';
};

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function friendlyName(description) {
  let n = String(description || '').replace(/\s+/g, ' ').trim();
  if (n === n.toUpperCase() && n.length > 8) {
    n = n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return n.slice(0, 80);
}

function nutrientsFromHit(hit) {
  const per100g = Object.fromEntries(Object.values(NUTRIENT_MAP).map((k) => [k, null]));
  for (const n of hit.foodNutrients || []) {
    const nid = n.nutrientId || n.nutrient?.id;
    const key = NUTRIENT_MAP[nid];
    if (!key) continue;
    const amount = n.value ?? n.amount;
    if (amount === null || amount === undefined || amount === '') continue;
    per100g[key] = Number(amount);
  }
  return per100g;
}

async function search(query) {
  const url = `${API}/foods/search?api_key=${KEY}&query=${encodeURIComponent(query)}&pageSize=15&dataType=SR%20Legacy`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search ${query}: ${res.status}`);
  return res.json();
}

async function main() {
  const foodsPath = path.join(root, 'data', 'foods.json');
  const curatedPath = path.join(root, 'data', 'curated_foods.json');
  const foods = JSON.parse(fs.readFileSync(foodsPath, 'utf8'));
  const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
  const byFdc = new Map(foods.filter((f) => f.fdcId).map((f) => [String(f.fdcId), f]));
  const usedIds = new Set(foods.map((f) => f.id));

  let added = 0;
  for (const q of QUERIES) {
    try {
      const data = await search(q);
      let fromQ = 0;
      for (const hit of data.foods || []) {
        if (!hit.fdcId || byFdc.has(String(hit.fdcId))) continue;
        const per100g = nutrientsFromHit(hit);
        if (Object.values(per100g).every((v) => v === null)) continue;
        const name = friendlyName(hit.description);
        let id = slug(name) || `fdc-${hit.fdcId}`;
        if (usedIds.has(id)) id = `${id}-${hit.fdcId}`;
        const entry = {
          id,
          fdcId: Number(hit.fdcId),
          name,
          category: CATEGORY_FOR(name),
          usdaName: hit.description,
          per100g,
        };
        foods.push(entry);
        curated.push({
          name: entry.name,
          category: entry.category,
          fdcId: entry.fdcId,
          usda: entry.usdaName,
        });
        byFdc.set(String(hit.fdcId), entry);
        usedIds.add(id);
        added += 1;
        fromQ += 1;
      }
      console.log(`search ${q}: +${fromQ} (total ${foods.length})`);
      await sleep(800);
    } catch (err) {
      console.error(String(err));
      await sleep(2500);
    }
  }

  foods.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(foodsPath, `${JSON.stringify(foods, null, 1)}\n`);
  fs.writeFileSync(curatedPath, `${JSON.stringify(curated, null, 1)}\n`);
  console.log(`Done. foods=${foods.length} added=${added}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
