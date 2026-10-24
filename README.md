# NutriPlanner

An adaptive monthly meal planner that rebuilds your plan around what you actually ate, bought and prepared.

Nutrient values come from a curated set of USDA FoodData Central foods. Missing values show as **n/a**, never as zero. This is a support tool, not medical advice.

## Requirements

- A recent Node.js (for tests and the local server)
- A modern desktop or mobile browser

## Start the app

From this folder:

```bash
npx serve .
```

Open the address it prints (for example `http://localhost:3000`).

Do not open `index.html` by double-clicking it: the browser will block loading the data files.

## Run tests

```bash
npm test
```

## What you can do

1. Choose a profile (Weight loss, Cholesterol, or Recovery) and edit daily nutrient targets.
2. Build a month plan and review today’s meals and progress bars.
3. Tick shopping-list items you already have at home.
4. Log a meal (from the plan or by searching a food with a portion).
5. See **Plan updated**: an off-plan meal that goes over a daily maximum is made up over the next 4 days (the rest of the month stays as planned), with before/after meals, a one-sentence reason from the real numbers, the effect on your targets, and a choice to keep your original plan or use the new one.

Everything is stored on this device only (browser localStorage). There are no accounts and no network calls while the app is running.

## Data

Food data: [USDA FoodData Central](https://fdc.nal.usda.gov/) (SR Legacy), a public-domain dataset (CC0).

- `data/foods.json` — curated USDA foods (nutrients per 100 g)
- `data/recipes.json` — recipes built from those foods
- `scripts/build-foods.js` — optional one-off rebuild from a USDA SR Legacy CSV download

## Disclaimer

Support tool, not medical advice.

Licensed under AGPL-3.0.
