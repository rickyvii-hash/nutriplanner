---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast

## Slices

- [x] **1. You can see real recipes with their nutrients, calculated from USDA data**
  Becomes usable: A running app (opened through the local server) that lists the recipes, each with calories, protein, saturated fat, fibre and sodium calculated from real USDA foods. Missing values show as "n/a".
  Why now: The USDA files are the biggest unknown, so the data build comes first. It also proves the whole path end to end (scaffold, data, calculation, screen) and every later slice depends on these numbers.
  PRD ref: `prd.md > Month plan`, `prd.md > States and Boundaries` (missing nutrient value)
  Spec ref: `spec.md > Food and recipe data`, `spec.md > Nutrient calculator`, `spec.md > File Structure`, `spec.md > Stack`
  Build: Scaffold the project per the spec's file structure. Check the real USDA download format first, then write `scripts/build-foods.js` to produce `data/foods.json` (about 250 foods, nutrients per 100 g, missing values as null) from `data/curated_foods.json`. Write about 20 recipes in `data/recipes.json`. Add `src/engine/nutrients.js` and a simple page that lists recipes with their totals.
  Verify (mechanical): `node --test` passes for the nutrient calculator, including a missing-value case; `data/foods.json` contains at least 200 foods and every recipe ingredient resolves to a food; the local server starts and the page lists the recipes.
  Learner check: Open the app and look at three recipes you know. Say whether the calories and protein look believable.
  Commit: `Add USDA food data, recipes and nutrient calculator`

- [x] **2. You can set targets and get a month plan**
  Becomes usable: Pick a profile (Weight loss, Cholesterol, Recovery), edit the targets, add a custom target, press "Build my month plan" and see a Month plan screen with today's meals and daily progress bars. Everything is saved and still there after a reload.
  Why now: The plan is what the kernel later changes, and it needs real targets. Saving it here also tests the data model early.
  PRD ref: `prd.md > Targets`, `prd.md > Month plan`, `prd.md > Screens and Layout` (screens 1 and 2)
  Spec ref: `spec.md > Planner`, `spec.md > Storage`, `spec.md > Screens`, `spec.md > Data Model`
  Build: Add `src/store.js`, `buildPlan` in `src/engine/planner.js`, the Targets and Plan screens and the small router with the bottom bar.
  Verify (mechanical): Tests show `buildPlan` fills every slot of every day for each profile and stays reasonably near the targets; reload in the browser and confirm targets and plan are restored.
  Learner check: Choose Recovery, change one target, build the plan, reload the page, and confirm everything is still there.
  Commit: `Add targets, month plan and local storage`

- [x] **3. You can log a meal and see the plan update (the kernel)**
  Becomes usable: Log "pizza and ice cream", save, and see the Plan updated screen: before and after for the changed meals, a one-sentence reason, the effect on each target, and the buttons "Keep my original plan" and "Use updated plan".
  Why now: This is the unique kernel from `scope.md`, so it comes as early as the plan allows. Everything after it improves or feeds this moment.
  PRD ref: `prd.md > Logging a meal`, `prd.md > Plan updated`, `prd.md > The Core Journey` (steps 5-7), `prd.md > States and Boundaries` (targets cannot all be met, nothing to change)
  Spec ref: `spec.md > Planner`, `spec.md > Screens`, `spec.md > Important Failure Modes`
  Build: Add the Log a meal screen (from plan or search a food, with a portion), `replan` in the planner with the reason built from the numbers, and the Plan updated screen. "Use updated plan" saves the new plan; "Keep my original plan" leaves it alone.
  Verify (mechanical): Tests with a worked example: a high-saturated-fat meal lowers saturated fat in the following days, "nothing to change" returns no changes, impossible targets return the closest plan with a flag; in the browser, log a meal and confirm both buttons behave correctly.
  Learner check: Log pizza and ice cream. Read the Plan updated screen and say whether the reason makes sense and the tone feels calm.
  Commit: `Add meal logging and plan recalculation`

- [x] **4. You can tick what you bought and the plan uses it**
  Becomes usable: A Shopping list built from the plan, grouped by category, with tickable items and an "Already at home" section; ticked food is favoured when the plan is recalculated, and a note explains when a meal was kept because of it.
  Why now: Completes the core loop from `scope.md`. It builds on the working replan, so it can be checked against slice 3.
  PRD ref: `prd.md > Shopping list`, `prd.md > Plan updated`, `prd.md > The Core Journey` (steps 4 and 7)
  Spec ref: `spec.md > Shopping list builder`, `spec.md > Planner`, `spec.md > Data Model`
  Build: Add `src/engine/shopping.js`, the Shopping screen, ticked items saved, and the bonus for ticked ingredients in `replan`, with the note text.
  Verify (mechanical): Tests show that ticking an ingredient makes a recipe using it more likely to be kept, and that ticked items leave the "to buy" list; in the browser, tick items, log a meal, and confirm the note appears.
  Learner check: Tick spinach and chicken, log a meal, and see whether the plan keeps meals that use them and the list agrees.
  Commit: `Add shopping list and pantry-aware replanning`

- [x] **5. It looks and behaves like the mockups, with every empty state**
  Becomes usable: The finished proof of concept: look and feel as in `devpost/design/`, disclaimer on every screen, all states from the PRD, mobile and desktop layouts, a README and start instructions.
  Why now: Design and presentation carry half of the judging, so polish gets a proper slice after the behavior is proven.
  PRD ref: `prd.md > Look and Feel`, `prd.md > States and Boundaries`, `prd.md > What We're Building`
  Spec ref: `spec.md > Look and Feel`, `spec.md > Where It Runs and How Someone Tries It`, `spec.md > Important Failure Modes`
  Build: Apply the colours, type and spacing from the spec to every screen, add first-use, empty and error states, the footer disclaimer, icons or emoji instead of photos, and write the README with the start command.
  Verify (mechanical): Walk the core journey in the browser at a phone width and a desktop width and compare against the mockups; confirm the disclaimer appears on all five screens; run all tests.
  Learner check: Go through the whole journey once as if recording the demo, and say what you would change.
  Commit: `Polish design, states and README`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — after slice 3 (the kernel)
- [ ] Final kick-the-tires exploration and feedback completed

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: not started
Route and stops: not started
Edit outcome: not started
Reflection: not started
Activity mode: not started

## Revisions

- 2026-10-21: Recovery profile often surfaces “targets cannot all be met” because a 2200 kcal daily minimum is hard to hit with the current recipe set; the screen shows the closest plan as specified.
- 2026-10-21: Initial month plans can repeat the same dinner across days when one recipe scores best for every day; variety was not required by the PRD.
- 2026-10-21: Shopping list grams are totals for the remaining month (not a single shop), which can look large; acceptable for the POC.
- 2026-10-21: Replan window. `prd.md > Plan updated` says the rest of the month is recalculated, but spreading one off-plan meal over about 30 days diluted it to nothing: pizza and ice cream on the Cholesterol profile gave "No changes needed". The update now makes the overshoot up over the next 4 days and leaves the rest of the month unchanged, which matches the approved mockup ("lower over the next 3 days"). A swapped meal must have less of the nutrient that went over.
- 2026-10-21: Recovery was unreachable (month average 1453 kcal against a minimum of 2200). Added 12 energy-dense recipes (36 in total, all from foods already in the data) and changed the recipe choice to look at the whole day at once instead of one meal at a time.
- 2026-10-21: Variety. A recipe now rests for up to 3 days before it can fill the same slot again, so the same dinner no longer repeats every day. The shopping list still shows month totals (accepted for the proof of concept).
- 2026-10-21: Scope widened by the owner. Three items moved from Later/Deferred into the proof of concept: shopping by frequency with "I'm shopping now" (this also fixes the month-sized shopping totals), a printable summary for a doctor, and an Athlete example profile. Everything else in Deferred and Explicitly Cut stays out. Features are frozen on Friday 23 October in the evening.
- 2026-10-24: Stale month on start. A saved plan for another calendar month no longer opens as today: Targets shows a calm banner, the old plan is cleared, targets/log/shopping settings stay, and "Build my month plan" builds the current month.
- 2026-10-24: Pending plan-update proposal is stored with the rest of the state so a reload still opens Plan updated; Use/Keep clear it, and a stale month drops it.
- 2026-10-24: Skipped meals ("I ate less"). From plan, each meal can be Skipped; shortfalls on minimum targets raise the next 4 days (capped at +25%), swaps need more of that nutrient, and the doctor summary lists skips without counting them as eaten.
- 2026-10-24: Control pass fixes. Month-plan progress no longer crashes on skip-only log entries; skip reason quotes the intended daily make-up; bottom padding and meal action layout keep Save/Use clear of the nav on phones.
- 2026-10-24: Grouped "Add as eaten" blocks on the log screen; Replace next to Skipped with Plan updated preview (reason quotes Effect rounding).
- 2026-10-24: v2 — Recipe detail panel from Plan and Log (ingredients, target nutrients) with three honest outside-search links (Full recipe, Find nearby, Order delivery); no API keys, no fake cart. Planning docs updated to match.


- 2026-10-24: Owner defects D1–D5 on v2: Start over with confirmation; undo/edit saved log entries; improved free search and ~480 real USDA SR Legacy foods; Replace "I ate something else"; Extra / outside meals path.
