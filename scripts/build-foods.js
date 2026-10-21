// One-off data build: reads the USDA FoodData Central "SR Legacy" CSV download
// and writes data/foods.json for the foods listed in data/curated_foods.json.
//
// Usage: node scripts/build-foods.js <folder with the unzipped USDA CSV files>
// Download: https://fdc.nal.usda.gov/download-datasets.html (SR Legacy, CSV)
// USDA FoodData Central data is public domain (CC0).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NUTRIENTS = {
  1008: 'kcal',
  1003: 'protein',
  1004: 'fat',
  1258: 'satFat',
  1005: 'carbs',
  1079: 'fibre',
  2000: 'sugars',
  1093: 'sodium',
};

const dataDir = process.argv[2];
if (!dataDir) {
  console.error('Usage: node scripts/build-foods.js <USDA CSV folder>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const curated = JSON.parse(fs.readFileSync(path.join(root, 'data', 'curated_foods.json'), 'utf8'));
const wanted = new Map(curated.map((f) => [String(f.fdcId), f]));

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const foods = new Map();
for (const f of curated) {
  const id = slug(f.name);
  if ([...foods.values()].some((x) => x.id === id)) throw new Error('Duplicate food id: ' + id);
  foods.set(String(f.fdcId), {
    id,
    fdcId: f.fdcId,
    name: f.name,
    category: f.category,
    usdaName: f.usda,
    // null means "USDA has no value": never treated as zero.
    per100g: Object.fromEntries(Object.values(NUTRIENTS).map((k) => [k, null])),
  });
}

// food_nutrient.csv columns: id, fdc_id, nutrient_id, amount, ...
const lines = fs.readFileSync(path.join(dataDir, 'food_nutrient.csv'), 'utf8').split('\n');
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].replace(/\r$/, '').split('","').map((c) => c.replace(/"/g, ''));
  if (cols.length < 4) continue;
  const food = foods.get(cols[1]);
  const key = NUTRIENTS[cols[2]];
  if (!food || !key || cols[3] === '') continue;
  food.per100g[key] = Number(cols[3]);
}

const out = [...foods.values()].sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(root, 'data', 'foods.json'), JSON.stringify(out, null, 1) + '\n');

const missing = {};
for (const f of out) {
  for (const [k, v] of Object.entries(f.per100g)) if (v === null) (missing[k] = missing[k] || []).push(f.name);
}
console.log(`Wrote ${out.length} foods to data/foods.json`);
for (const [k, names] of Object.entries(missing)) console.log(`  missing ${k}: ${names.length}`);
