/**
 * Rebuild curated_foods.json + foods.json from a local USDA SR Legacy CSV folder.
 * Keeps the original curated entries, then adds prioritized off-plan foods.
 *
 * Usage: node scripts/expand_curated_from_csv.js <USDA CSV folder>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataDir = process.argv[2];
if (!dataDir) {
  console.error('Usage: node scripts/expand_curated_from_csv.js <USDA CSV folder>');
  process.exit(1);
}

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

/** Prefer these patterns so cola/burger/pizza land in the set before the cap. */
const PRIORITY = [
  { re: /beverages,\s*carbonated,\s*cola/i, cat: 'Beverages', boost: 100 },
  { re: /beverages,\s*zevia,\s*cola/i, cat: 'Beverages', boost: 90 },
  { re: /soft drink.*cola|cola.*,\s*soft/i, cat: 'Beverages', boost: 90 },
  { re: /fast foods?,.*hamburger/i, cat: 'Prepared', boost: 100 },
  { re: /fast foods?,.*cheeseburger/i, cat: 'Prepared', boost: 100 },
  { re: /mcdonald.?s,.*hamburger|burger king,.*hamburger|wendy.?s,.*hamburger/i, cat: 'Prepared', boost: 95 },
  { re: /mcdonald.?s,.*cheeseburger|burger king,.*cheeseburger/i, cat: 'Prepared', boost: 95 },
  { re: /french fries/i, cat: 'Prepared', boost: 90 },
  { re: /pizza/i, cat: 'Prepared', boost: 85 },
  { re: /ice cream/i, cat: 'Sweets', boost: 85 },
  { re: /alcoholic beverage,\s*beer/i, cat: 'Beverages', boost: 90 },
  { re: /alcoholic beverage,\s*wine,\s*table/i, cat: 'Beverages', boost: 80 },
  { re: /potato chips|tortilla chips/i, cat: 'Snacks', boost: 80 },
  { re: /pasta,\s*cooked|spaghetti,\s*cooked/i, cat: 'Prepared', boost: 70 },
  { re: /lasagna|macaroni and cheese|hot dog|sandwich/i, cat: 'Prepared', boost: 70 },
  { re: /coffee,\s*brewed|orange juice|apple juice/i, cat: 'Beverages', boost: 70 },
  { re: /chocolate|cookie|cake|doughnut|muffin|brownie|candy/i, cat: 'Sweets', boost: 40 },
  { re: /popcorn|pretzel/i, cat: 'Snacks', boost: 40 },
];

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (let j = 0; j < line.length; j += 1) {
    const ch = line[j];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

function friendly(desc) {
  let n = desc.replace(/\s+/g, ' ').trim();
  if (n === n.toUpperCase() && n.length > 8) {
    n = n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return n.slice(0, 70);
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Start from the foods that already ship with recipes (those with real nutrients today).
const currentFoods = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const baseCurated = currentFoods
  .filter((f) => f.fdcId && Object.values(f.per100g || {}).some((v) => v != null))
  .map((f) => ({
    name: f.name,
    category: f.category || 'Other',
    fdcId: f.fdcId,
    usda: f.usdaName || f.name,
  }));

const byFdc = new Map(baseCurated.map((e) => [String(e.fdcId), e]));
const candidates = [];

const foodLines = fs.readFileSync(path.join(dataDir, 'food.csv'), 'utf8').split(/\r?\n/);
for (let i = 1; i < foodLines.length; i += 1) {
  const line = foodLines[i];
  if (!line) continue;
  const cols = parseCsvLine(line);
  const fdcId = cols[0];
  const desc = cols[2] || '';
  if (byFdc.has(String(fdcId))) continue;
  if (/infant|babyfood|research|label claim/i.test(desc)) continue;
  let best = null;
  for (const rule of PRIORITY) {
    if (rule.re.test(desc)) {
      if (!best || rule.boost > best.boost) best = rule;
    }
  }
  if (!best) continue;
  candidates.push({
    name: friendly(desc),
    category: best.cat,
    fdcId: Number(fdcId),
    usda: desc,
    boost: best.boost,
  });
}

candidates.sort((a, b) => b.boost - a.boost || a.name.localeCompare(b.name));
const curated = [...baseCurated];
for (const c of candidates) {
  if (byFdc.has(String(c.fdcId))) continue;
  byFdc.set(String(c.fdcId), c);
  curated.push({
    name: c.name,
    category: c.category,
    fdcId: c.fdcId,
    usda: c.usda,
  });
  if (curated.length >= 480) break;
}

fs.writeFileSync(path.join(root, 'data', 'curated_foods.json'), `${JSON.stringify(curated, null, 1)}\n`);
console.log(`curated=${curated.length} (base ${baseCurated.length})`);

const foods = new Map();
const usedIds = new Set();
for (const f of curated) {
  let id = slug(f.name);
  if (usedIds.has(id)) id = `${id}-${f.fdcId}`;
  usedIds.add(id);
  foods.set(String(f.fdcId), {
    id,
    fdcId: f.fdcId,
    name: f.name,
    category: f.category,
    usdaName: f.usda,
    per100g: Object.fromEntries(Object.values(NUTRIENTS).map((k) => [k, null])),
  });
}

const nutrientLines = fs.readFileSync(path.join(dataDir, 'food_nutrient.csv'), 'utf8').split(/\n/);
for (let i = 1; i < nutrientLines.length; i += 1) {
  const cols = nutrientLines[i].replace(/\r$/, '').split('","').map((c) => c.replace(/"/g, ''));
  if (cols.length < 4) continue;
  const food = foods.get(cols[1]);
  const key = NUTRIENTS[cols[2]];
  if (!food || !key || cols[3] === '') continue;
  food.per100g[key] = Number(cols[3]);
}

const out = [...foods.values()]
  .filter((f) => Object.values(f.per100g).some((v) => v !== null))
  .sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(root, 'data', 'foods.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`Wrote ${out.length} foods`);
for (const stem of ['pizza', 'cola', 'hamburger', 'beer', 'ice cream', 'french fries', 'pasta']) {
  const n = out.filter((f) => f.name.toLowerCase().includes(stem)).length;
  console.log(`  ${stem}: ${n}`);
}
