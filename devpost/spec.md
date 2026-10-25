---
doc: spec
status: approved
---

# NutriPlanner — Technical Spec

## How This Works, In Plain Language
NutriPlanner is a small web app that runs in your browser on your own computer. There is no server, no account and no cloud.

It has four simple pieces:
1. **A food list**: a file with about 480 foods and their nutrients, taken from the public USDA FoodData Central SR Legacy dataset. Think of it as a spreadsheet the app reads.
2. **A recipe list**: a second file with about 40 recipes. Each recipe is a list of foods with amounts. The nutrients of a recipe are simply the sum of its foods.
3. **The planner**: a small piece of code, readable and testable, that does the arithmetic. It builds the month plan, and after you log a meal it works out how much of each target is still missing for the rest of the month and picks the recipes for the remaining meals that get closest, preferring recipes whose ingredients you already bought.
4. **The screens**: the screens from the PRD, with a bottom bar (Plan, Shopping, Targets) plus Log, Plan updated, the Summary for your doctor, the recipe detail overlay and the Start over / Change profile confirmations. They show what the planner worked out.

Your choices (targets, plan, meals you logged, ticked items) are kept in the browser's own memory ("localStorage", a sticky note the browser keeps for one site), so they are still there when you come back.

Why this shape: there is nothing to install except a tiny local web server, there are no services to wire up, and the planner's reasoning is plain arithmetic, so the "reason" text on the Plan updated screen is generated from real numbers, not made up.

## The Core Journey Through the System
PRD ref: `prd.md > The Core Journey`.
1. The user opens the app. It reads `foods.json` and `recipes.json`, and any saved data from localStorage. If there is none, it shows the Targets screen.
2. The user picks a profile and edits targets. Targets are saved. "Build my month plan" calls the planner, which assigns a recipe to each meal slot of each day of the month and saves the plan.
3. The Month plan screen reads the plan and the food data and shows today's meals and the progress bars.
4. The Shopping list is derived from the plan: all ingredients of the planned meals, grouped by category, minus items ticked as bought. Ticks are saved.
5. The user handles a planned meal on the day screen (Ate it, a skip, or a replacement with another recipe or with a food they ate instead), or adds a free-search food outside the menu (an Extra / outside meal). Portions are converted to nutrients using the food data, and the entry is saved in the log. Saved entries can later be corrected (remove, change portion, switch Eaten and Skipped), and Start over / Change profile are confirmed before they erase anything.
6. The planner is called with the targets, the log, the ticked items and the current plan. It returns a proposed new plan, the list of changed meals and a reason built from the numbers (same rounding as the Effect rows).
7. The Plan updated screen shows before and after. "Use updated plan" saves the proposal as the plan, and "Keep my original plan" discards it.
8. The Shopping list and Month plan redraw from the new saved plan.
9. Tapping a meal opens the recipe detail overlay (`recipe_detail.js`). The three link buttons are ordinary `<a target="_blank" rel="noopener noreferrer">` tags; the app never opens them itself.

## Stack
- **HTML, CSS and plain JavaScript (ES modules)**, no framework. Rationale: fewest moving parts for a five-day build, and no build step to break.
- **Node.js** (already installed, v24) for two things only: a one-off script that builds `foods.json` from the USDA download, and the built-in test runner (`node --test`) for the planner. Node docs: https://nodejs.org/api/test.html
- **A tiny local web server** to open the app, because browsers do not load ES modules from a double-clicked file. `npx serve` (https://www.npmjs.com/package/serve), or `python -m http.server` as an alternative. This is flagged to verify at the start of the build.
- **Data:** USDA FoodData Central, public domain (CC0). Downloads: https://fdc.nal.usda.gov/download-datasets.html. The build uses the SR Legacy dataset; the column names are mapped once by `scripts/build-foods.js`.
- **Charts and icons:** none. Progress bars are plain CSS. Foods and nutrients use emoji or simple inline icons (no photographs).

Accepted tradeoff: less powerful than a database-backed app, but more reliable and quicker for a proof of concept. A real product would rebuild the data layer.

## Where It Runs and How Someone Tries It
- Runs locally in a desktop or mobile-sized browser window, no API keys, no accounts.
- Start: from the project folder, `npx serve .` and open the address it prints (for example `http://localhost:3000`). A reviewer does not need to run it: the demo video shows it working.
- Demo recording: a screen recording of the core journey in the PRD, under 3 minutes.
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
`src/ui/`: `targets.js`, `plan.js`, `log.js`, `updated.js`, `shopping.js`, `summary.js`, `recipe_detail.js`, `reset.js` (Start over and Change profile confirmations), plus `app.js` as a small router with the bottom bar (Plan, Shopping, Targets).
PRD ref: `prd.md > Screens and Layout`.

### Logging actions
`log.js` builds one grouped block per planned recipe and tags free-search food as an extra. `log_corrections.js` corrects saved entries without mutating the state passed in: change portions, remove an entry, switch a planned meal between Eaten and Skipped, then recalculate from the corrected log. Replace can pick another recipe for the slot or log a searched food as "I ate something else" (`replaced`), which counts as replaced, not skipped and not an extra. Extras carry `extra: true`, count in the day totals and feed the adaptive replan.
`store.js` holds the reset actions: Start over clears the plan, log and ticks; Change profile clears the plan and keeps the log unless the user also chooses Start over.
PRD ref: `prd.md > Logging a meal`, `prd.md > Starting over and changing profile`.

### Recipe detail and outside links
`src/ui/recipe_detail.js`. Pure helpers build three URLs from the dish name with `encodeURIComponent`:
- Full recipe: `https://www.google.com/search?q=<name>+recipe`
- Find nearby: `https://www.google.com/maps/search/?api=1&query=<name>+near+me`
- Order delivery: `https://www.google.com/search?q=<name>+delivery+near+me`
Empty names fall back to `meal`. The panel lists ingredients (grams), nutrients for the current targets via `recipeNutrients` (missing values as "n/a"), and the shared note that NutriPlanner does not take orders. No API keys, no backend, no scraping.
PRD ref: `prd.md > Recipe detail`.

## Data Model
- **Food**: `{ id, name, category, per100g: { kcal, protein, fat, satFat, carbs, fibre, sugars, sodium }, unitGrams? }`. Lives in `foods.json`, fixed.
- **Recipe**: `{ id, name, slot (breakfast/lunch/dinner/snack), icon?, ingredients: [{ foodId, grams }] }`. Lives in `recipes.json`, fixed.
- **Targets**: `[{ nutrient, kind: "min" | "max", daily }]`. Live in localStorage, change when the user edits.
- **Plan**: `{ month, days: { "YYYY-MM-DD": { breakfast: recipeId, lunch, dinner, snack } } }`. In localStorage, replaced on "Use updated plan".
- **Log**: `[{ date, time, items: [{ foodId, grams }], skipped?, eaten?, replaced?, extra? }]`. `skipped` lists planned recipe ids not eaten; `eaten` records the planned blocks that were eaten; `replaced` lists the slot a food stands for (`{ slot, recipeId, fromRecipeId }`, with `recipeId: null` and a `name` when the person ate something else); `extra: true` marks free-search food eaten outside the planned slots. In localStorage, appended on "Save and update plan" or Replace, and corrected in place from the Plan screen.
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
│   └── ui/               # one file per screen, including recipe_detail.js
├── data/
│   ├── foods.json        # about 480 USDA SR Legacy foods
│   ├── recipes.json      # about 40 recipes built from those foods
│   └── curated_foods.json  # list of USDA ids chosen for the data build
├── scripts/
│   └── build-foods.js    # one-off: USDA download -> foods.json
├── tests/                # node --test for the engine and UI helpers
├── devpost/              # Devpost learning workspace and design mockups
├── LICENSE
└── README.md
```

## External Services and Dependencies
- **USDA FoodData Central** download (not a live API): https://fdc.nal.usda.gov/download-datasets.html. Public domain (CC0), no key, no rate limit. Used once, by `scripts/build-foods.js`. While the app is running it does not call USDA; the only network use is when the person taps an outside-search link and the browser opens Google or Maps.
- **serve** (local web server, dev only): https://www.npmjs.com/package/serve
- No other dependencies, no accounts and no cost.

## Important Failure Modes
- **Targets that cannot all be met** → the Plan updated screen says so plainly and shows the closest plan, with no blame.
- **A food has a missing nutrient** → shown as "n/a" and not added as zero; the daily total says some values are unknown.
- **App opened by double-clicking `index.html`** → ES modules and JSON loading fail; the README states to start the local server, and the page shows a short message if the data cannot be loaded.
- **localStorage unavailable** → the app works for the session and says data will not be kept.

## What Was Simplified and Why
- **A fixed set of about 480 foods** from USDA SR Legacy instead of the full USDA database — the values can be checked and the files stay small enough for a local app. The fuller version would need search over thousands of foods and translations.
- **About 40 recipes** instead of a recipe database — enough to show the plan changing and to reach the Athlete minimums.
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
- None for the proof of concept: the USDA SR Legacy columns are mapped by the build script, and the food and recipe lists are settled at about 480 foods and about 40 recipes, all built from foods already in the data.
- Carried over from the PRD: the recalculation approach is as described under Planner; the recipe count is as above.
