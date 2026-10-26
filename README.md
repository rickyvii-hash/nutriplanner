# NutriPlanner

An adaptive monthly meal planner that rebuilds your plan around what you actually ate, bought and prepared.

Nutrient values come from a curated set of USDA FoodData Central foods. Missing values show as **n/a**, never as zero. This is a support tool, not medical advice.

## Requirements

- A recent Node.js (for tests and the local server)
- A modern desktop or mobile browser

## Try it online

Try it online: https://rickyvii-hash.github.io/nutriplanner/  
*(Publish this folder with GitHub Pages, then paste the site URL here.)*

### Enable GitHub Pages (after you create a public repo for this folder)

1. Push **only** the contents of this `project/app` folder to the repository default branch (for example `main`), or put them under a `docs/` folder.
2. On GitHub: **Settings → Pages**.
3. Source: **Deploy from a branch**.
4. Branch: `main` (or your default) and folder: **/ (root)** if the app files are at the repo root, or **/docs** if you copied them into `docs/`.
5. Save. After a minute, open `https://<user>.github.io/<repo>/` (or the `/docs` URL GitHub shows).
6. Asset paths are relative (`styles/…`, `src/…`, `data/…`), so the app also works under a project-pages sub-path such as `/<repo>/`.

Leave the Pages URL as a placeholder until the owner publishes the public repository.

## Start the app locally

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

1. Choose a profile (Weight loss, Cholesterol, Recovery, or Athlete) and edit daily nutrient targets. A short first-run guide explains the idea; open it again from **How it works**.
2. Under **My meals**, switch breakfast, lunch and dinner on or off and choose 0 or 1 snack. The plan uses only those slots; daily targets stay the same.
3. Build a month plan and review today’s meals. Daily progress starts at zero and only counts food you have logged (planned meals stay planned until you log them).
4. On the shopping list tick items as they go in your cart (they stay visible, with Undo and an "N of M in cart" count), or mark one **Not found** and swap a meal that uses it.
5. On the day screen mark each meal **Ate it**, **Skipped** or **Replace**, and **Undo** or **Change** it right there. For anything else, use **Add food outside the menu** (say when: **Just now**, **Earlier** with a past date and time, or **Planned** for something you already know you will eat later): search a food with a portion in grams, or pick a drink from **Drinks** with ml presets (glass, cup, can, bottle). Food outside the menu and drinks count in the day totals and in the plan update.
6. **Replace** a planned meal with another recipe for the same slot, or with **I ate something else**.
7. Undo or edit a saved log entry: remove it, change a portion, or switch a meal between Eaten and Skipped. The month plan is always recomputed from your original plan plus the meals you still have logged (and whether you accepted each update), so an old correction cannot leave a stale make-up behind.
8. **Download my data** / **Restore from file** to back up or move your plan, logs and targets on this device.
9. **Start over** (with confirmation) erases the month plan, meal logs and shopping ticks. **Change profile** keeps the log unless you choose Start over.
10. See **Plan updated**: an off-plan meal that goes over a daily maximum is made up over the next 4 days, with before/after meals, a one-sentence reason from the real numbers, and a choice to keep the original plan or use the new one.
11. Open a **Summary for your doctor**: targets against logged days, meals logged, and print or save-as-PDF.

Everything is stored on this device only (browser localStorage). There are no accounts and no background network calls while the app is running. A recipe detail panel has links that open a Google or Maps search in a new tab, but only when you tap them.

## Roadmap

Planned for a later version, not in this proof of concept:

- A weekly shopping **budget** that shapes the plan: choose a budget and the planner favours affordable recipes while keeping your targets.
- Excluded foods (allergies, intolerances, dislikes) and a second snack.
- A simple lab-notes view that puts your own lab values next to your intake, without interpreting them.

## Data

Food data: [USDA FoodData Central](https://fdc.nal.usda.gov/) (SR Legacy), a public-domain dataset (CC0).

- `data/foods.json` — about 480 curated USDA foods (nutrients per 100 g)
- `data/recipes.json` — about 40 recipes built from those foods
- `scripts/build-foods.js` — optional one-off rebuild from a USDA SR Legacy CSV download

## Disclaimer

Support tool, not medical advice.

Licensed under AGPL-3.0.
