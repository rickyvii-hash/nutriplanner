---
doc: spec
status: approved
---

# NutriPlanner — Technical Spec

## How This Works, In Plain Language
NutriPlanner is a small web app that runs in your browser on your own computer. There is no server, no account and no cloud.

It has four simple pieces:
1. **A food list**: a file with about 250 foods and their nutrients, taken from the public USDA FoodData Central dataset. Think of it as a spreadsheet the app reads.
2. **A recipe list**: a second file with about 20 recipes. Each recipe is a list of foods with amounts. The nutrients of a recipe are simply the sum of its foods.
3. **The planner**: a small piece of code, readable and testable, that does the arithmetic. It builds the month plan, and after you log a meal it works out how much of each target is still missing for the rest of the month and picks the recipes for the remaining meals that get closest, preferring recipes whose ingredients you already bought.
4. **The screens**: the five screens from the PRD. They show what the planner worked out.

Your choices (targets, plan, meals you logged, ticked items) are kept in the browser's own memory ("localStorage", a sticky note the browser keeps for one site), so they are still there when you come back.

Why this shape: there is nothing to install except a tiny local web server, there are no services to wire up, and the planner's reasoning is plain arithmetic, so the "reason" text on the Plan updated screen is generated from real numbers, not made up.

## The Core Journey Through the System
PRD ref: `prd.md > The Core Journey`.
1. The user opens the app. It reads `foods.json` and `recipes.json`, and any saved data from localStorage. If there is none, it shows the Targets screen.
2. The user picks a profile and edits targets. Targets are saved. "Build my month plan" calls the planner, which assigns a recipe to each meal slot of each day of the month and saves the plan.
3. The Month plan screen reads the plan and the food data and shows today's meals and the progress bars.
4. The Shopping list is derived from the plan: all ingredients of the planned meals, grouped by category, minus items ticked as bought. Ticks are saved.
5. The user logs a meal. The portions are converted to nutrients using the food data, and the entry is saved in the log.
6. The planner is called with the targets, the log, the ticked items and the current plan. It returns a proposed new plan, the list of changed meals and a reason built from the numbers.
7. The Plan updated screen shows before and after. "Use updated plan" saves the proposal as the plan, and "Keep my original plan" discards it.
8. The Shopping list and Month plan redraw from the new saved plan.

## Stack
- **HTML, CSS and plain JavaScript (ES modules)**, no framework. Rationale: fewest moving parts for a five-day build, and no build step to break.
- **Node.js** (already installed, v24) for two things only: a one-off script that builds `foods.json` from the USDA download, and the built-in test runner (`node --test`) for the planner. Node docs: https://nodejs.org/api/test.html
- **A tiny local web server** to open the app, because browsers do not load ES modules from a double-clicked file. `npx serve` (https://www.npmjs.com/package/serve), or `python -m http.server` as an alternative. This is flagged to verify at the start of the build.
- **Data:** USDA FoodData Central, public domain (CC0). Downloads: https://fdc.nal.usda.gov/download-datasets.html. Exact file and column names are not verified yet; check this first in the build.
- **Charts and icons:** none. Progress bars are plain CSS. Foods and nutrients use emoji or simple inline icons (no photographs).

Accepted tradeoff: less powerful than a database-backed app, but more reliable and quicker for a proof of concept. A real product would rebuild the data layer.

## Where It Runs and How Someone Tries It
- Runs locally in a desktop or mobile-sized browser window, no API keys, no accounts.
- Start: from the project folder, `npx serve .` and open the address it prints (for example `http://localhost:3000`). A reviewer does not need to run it: the demo video shows it working.
- Demo recording: a screen recording of the five screens in the core journey, under 3 minutes.
- Deployment is optional and not planned. A static host would work later, since the app has no server.

## Look and Feel
Implements `prd.md > Look and Feel`. Reference mockups are in `devpost/design/`.
- Palette: soft greens and warm neutrals, dark green primary buttons, tan or amber for "close to a limit", never red.
- Type: a clean, readable sans-serif system font stack. Large clear headings, generous spacing.
- Density: spacious and calm, rounded cards, mobile-first layout that also looks good on desktop.
- Tone of copy: neutral and kind, no medical claims. Footer on every screen: "Support tool, not medical advice."
- Foods and nutrients use emoji or inline icons. No photographs and no large hero image.
- Plain CSS can honour all of this, with CSS variables for the colours.

## Components

### Food and recipe data
`data/foods.json` and `data/recipes.json`. Foods carry id, name, category, nutrients per 100 g (calories, protein, total fat, saturated fat, carbohydrate, fibre, sugars, sodium) and an optional "unit" weight. A missing nutrient is `null`, never 0.
PRD ref: `prd.md > Month plan`, `prd.md > States and Boundaries`.

### Nutrient calculator
`src/engine/nutrients.js`. Sums a recipe or a logged meal from foods and portions. Keeps track of which nutrients are missing, so totals can say "n/a" when a value is unknown.
PRD ref: `prd.md > Month plan`, `prd.md > Logging a meal`.

### Planner
`src/engine/planner.js`. Two functions: `buildPlan(targets, recipes, month)` and `replan(state)`.
- Builds the month day by day. For each meal slot it scores each recipe by how close the day would get to the targets, and picks the best.
- `replan` first works out what is still missing for each target over the rest of the month, using what has already been eaten, and spreads that evenly over the remaining days. It then reassigns recipes to the remaining slots with the same scoring, adding a bonus for recipes whose ingredients are ticked as bought.
- It returns the new plan, the changed meals, the effect on each target and a reason generated from the numbers (for example "lowered saturated fat for the next 3 days and kept meals that use food already bought").
- If the targets cannot all be met, it returns the closest plan with a flag so the screen can say so plainly.
PRD ref: `prd.md > Plan updated`, `prd.md > States and Boundaries`.

### Shopping list builder
`src/engine/shopping.js`. Collects the ingredients of the remaining planned meals, groups them by category, and marks items ticked as "already at home".
PRD ref: `prd.md > Shopping list`.

### Storage
`src/store.js`. Reads and writes targets, plan, log and ticked items in localStorage. If localStorage is not available, the app still runs for the session and shows a small notice.
PRD ref: `prd.md > States and Boundaries` (persistence).

### Screens
`src/ui/`: `targets.js`, `plan.js`, `log.js`, `updated.js`, `shopping.js`, plus `app.js` as a small router with the bottom bar (Plan, Shopping, Targets).
PRD ref: `prd.md > Screens and Layout`.

## Data Model
- **Food**: `{ id, name, category, per100g: { kcal, protein, fat, satFat, carbs, fibre, sugars, sodium }, unitGrams? }`. Lives in `foods.json`, fixed.
- **Recipe**: `{ id, name, slot (breakfast/lunch/dinner/snack), ingredients: [{ foodId, grams }] }`. Lives in `recipes.json`, fixed.
- **Targets**: `[{ nutrient, kind: "min" | "max", daily }]`. Live in localStorage, change when the user edits.
- **Plan**: `{ month, days: { "YYYY-MM-DD": { breakfast: recipeId, lunch, dinner, snack } } }`. In localStorage, replaced on "Use updated plan".
- **Log**: `[{ date, time, items: [{ foodId, grams }] }]`. In localStorage, appended on "Save and update plan".
- **Bought**: `[foodId]`. In localStorage, changed by ticking items.
All user data survives closing and reopening the browser. Fixed data is read from the files each time.

## File Structure
```
nutriplanner_hackathon/
├── index.html            # the single page
├── styles/
│   └── app.css           # colours, layout, components
├── src/
│   ├── app.js            # start-up, router, bottom bar
│   ├── store.js          # save and load from localStorage
│   ├── engine/
│   │   ├── nutrients.js  # sums and missing values
│   │   ├── planner.js    # buildPlan, replan
│   │   └── shopping.js   # shopping list
│   └── ui/               # one file per screen
├── data/
│   ├── foods.json        # about 250 USDA foods
│   ├── recipes.json      # about 20 recipes
│   └── curated_foods.json  # list of USDA ids chosen for the data build
├── scripts/
│   └── build-foods.js    # one-off: USDA download -> foods.json
├── tests/                # node --test for the engine
├── devpost/              # Devpost learning workspace and design mockups
├── LICENSE
└── README.md
```

## External Services and Dependencies
- **USDA FoodData Central** download (not a live API): https://fdc.nal.usda.gov/download-datasets.html. Public domain (CC0), no key, no rate limit. Used once, by `scripts/build-foods.js`. The app itself makes no network calls.
- **serve** (local web server, dev only): https://www.npmjs.com/package/serve
- No other dependencies, no accounts and no cost.

## Important Failure Modes
- **Targets that cannot all be met** → the Plan updated screen says so plainly and shows the closest plan, with no blame.
- **A food has a missing nutrient** → shown as "n/a" and not added as zero; the daily total says some values are unknown.
- **App opened by double-clicking `index.html`** → ES modules and JSON loading fail; the README states to start the local server, and the page shows a short message if the data cannot be loaded.
- **localStorage unavailable** → the app works for the session and says data will not be kept.

## What Was Simplified and Why
- **A fixed set of about 250 foods** instead of the full USDA database — the values can be checked by hand and the files stay small. The fuller version would need search over thousands of foods and translations.
- **About 20 recipes** instead of a recipe database — enough to show the plan changing.
- **Local browser storage** instead of accounts and sync — no login needed to prove the idea.
- **Plain arithmetic scoring** instead of a machine-learning model — explainable and testable, and the reason text comes from real numbers.
- **"Prepared food" is treated as ticked ingredients** — the user ticks what is bought; separate "cooked leftovers" tracking is deferred.

## Decisions and Open Issues
**Learner choices**
- Plain web app run locally, no cloud: accepted the recommended approach.
- All-English app and repository.

**Derived implementation details**
- Plain JavaScript, localStorage and a scoring planner follow from the choices above and from the PRD.

**Learner uncertainty**
- None was stated when asked. The planner's scoring is the most likely place for questions, so the build will show its numbers on the Plan updated screen and tests will cover one worked example.

**Open issues**
- Exact USDA file and column names to be verified first in the build (flagged above).
- Final list of about 250 foods and about 20 recipes; the working assumption is to include foods that appear in the recipes plus common extras.
- Carried over from the PRD: the recalculation approach is as described under Planner; the recipe count is as above.
