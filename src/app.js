import { NUTRIENTS, recipeNutrients, formatNutrient } from './engine/nutrients.js';

const app = document.getElementById('app');
const SHOWN = ['kcal', 'protein', 'satFat', 'fibre', 'sodium'];

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function header() {
  return `<header class="brand"><span class="logo" aria-hidden="true">🌿</span>
    <div><h1>NutriPlanner</h1><p>Adaptive meal planning that flexes with real life.</p></div></header>`;
}

function footer() {
  return `<p class="footer-note">Support tool, not medical advice.</p>`;
}

function renderRecipes(recipes, foodsById) {
  const heads = SHOWN.map((k) => {
    const n = NUTRIENTS.find((x) => x.key === k);
    return `<th>${n.label}<br>${n.unit}</th>`;
  }).join('');
  const rows = recipes
    .map((r) => {
      const res = recipeNutrients(r, foodsById);
      const cells = SHOWN.map((k) => `<td>${formatNutrient(res, k, k === 'kcal' || k === 'sodium' ? 0 : 1)}</td>`).join('');
      return `<tr><td>${r.icon} ${r.name}<span class="slot">${r.slot}</span></td>${cells}</tr>`;
    })
    .join('');
  return `<section class="card">
      <h2>Recipes</h2>
      <p class="muted">Nutrients per serving, added up from USDA FoodData Central values. “≥” means a value was missing for some ingredient; “n/a” means no ingredient has a value.</p>
      <div style="overflow-x:auto"><table class="recipes"><thead><tr><th>Recipe</th>${heads}</tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
}

async function start() {
  try {
    const [foods, recipes] = await Promise.all([loadJson('data/foods.json'), loadJson('data/recipes.json')]);
    const foodsById = new Map(foods.map((f) => [f.id, f]));
    app.innerHTML = header() + renderRecipes(recipes, foodsById) + footer();
  } catch (err) {
    app.innerHTML =
      header() +
      `<div class="error"><strong>The app could not load its data.</strong>
        <p>Start it with <code>npx serve .</code> and open the address it prints, instead of opening index.html directly.</p>
        <p class="muted">${err.message}</p></div>` +
      footer();
  }
}

start();
