---
doc: prd
status: approved
---

# NutriPlanner — Product Requirements

An adaptive monthly meal planner for people following a personal nutrition goal: it rebuilds the plan around what they actually ate, bought and prepared.
Source: `scope.md > The Unique Kernel`, `scope.md > The Core Loop`.

## The Core Journey
1. The user opens NutriPlanner for the first time and sees **Choose a profile**: Weight loss, Cholesterol, Recovery. Picking one fills in example monthly targets they can edit.
2. They review the **targets** (each a nutrient with a Min or Max and a daily value) and optionally add a custom target for any nutrient. They tap **Build my month plan**.
3. They land on the **Month plan**: a day strip, today's meals, and daily progress against each target. A **Shopping list** is generated from the plan.
4. They tick what they have already bought. Items already at home leave the "to buy" list.
5. During the month they **log a meal**, from the plan or by searching a food and entering a portion.
6. After saving, they see **Plan updated**: which upcoming meals changed (before and after), one sentence explaining why, and the effect on each target. They choose **Use updated plan** or **Keep my original plan**.
7. The plan for the rest of the month is updated, favouring recipes that use food already bought or prepared. The shopping list updates to match.

Success: the user logs an off-plan meal (for example pizza and ice cream) and sees a clear, calm, explained update to the rest of the month.

## Screens and Layout
Five screens, mobile-first, reached through a bottom bar with three items: **Plan**, **Shopping**, **Targets**. Log a meal and Plan updated are reached from the Plan screen, not from the bar.

1. **Targets** (choose profile, edit targets): three profile cards, a list of targets, "Add custom target", and the button "Build my month plan".
2. **Month plan**: a strip of days (today highlighted), today's meals, daily target progress bars, and a short "Upcoming days" preview. A "Log a meal" button.
3. **Log a meal**: two modes, "From plan" (today's planned meal with "Add as eaten") and "Free search" (search a food, set the portion in g or ml). A list of logged items with editable portions, and the button "Save and update plan".
4. **Plan updated**: success banner, "What changed" (before and after per meal), "Reason" in one sentence, "Effect on targets", and the buttons "Keep my original plan" and "Use updated plan".
5. **Shopping list**: items grouped by category with tickable checkboxes, a section "Already at home", and a note explaining when a recipe was kept because its ingredients are already bought.

A reference mockup for each screen is in `devpost/design/` (`targets.webp`, `month-plan.webp`, `log-meal.webp`, `plan-updated.webp`, `shopping-list.webp`).

## Look and Feel
Established from the mockups the learner chose:
- Calm, reassuring, never guilt-inducing: soft greens and warm neutrals, rounded cards, plenty of white space, readable type.
- Dark green primary buttons. A tan or amber bar for nutrients that are close to a limit, never red.
- Simple icons or emoji for foods and nutrients. **No food photographs** (cost and licensing).
- A small logo and tagline "Adaptive meal planning that flexes with real life." The large hero image is dropped.
- Every screen shows a small footer: "Support tool, not medical advice."
- Wording is neutral about health: "Within target", "Closer to target", "Lower over the next 3 days". No medical claims such as "supports heart health" or "healthy range".

## Features and Behavior

### Targets
- Each target has a nutrient, a Min or Max, and a daily value. Example profiles load preset values and remain editable.
- The user can add a custom target for any nutrient available in the food data.
- Targets apply to the whole month.

### Month plan
- The plan covers the current month, one day at a time, with breakfast, lunch, dinner and snack.
- Each recipe's nutrients are the sum of its ingredients, taken from the food data.
- Daily progress shows consumed versus target for each nutrient.

### Logging a meal
- The user can mark a planned meal as eaten, or search a food and enter a portion in grams or millilitres.
- Several items can be logged together as one meal.

### Plan updated
- After a log, the rest of the month is recalculated so the targets are still met as closely as possible.
- Recipes whose ingredients are already bought or prepared are kept where they still fit the targets.
- The screen shows before and after for each changed meal, a one-sentence reason, and the effect on each target.
- "Keep my original plan" leaves the plan unchanged.

### Shopping by frequency
- The user chooses how often they shop: every 2, 3, 5 or 7 days (default 7). The list shows the meals from the start of the current shopping window to the day before the next shop, with its dates.
- "I'm shopping now" starts a new window from today, whatever was planned, and the list is rebuilt for it. Items already at home stay out of the to-buy list.

### Summary for your doctor
- A screen reachable from the Month plan: the profile and period, the targets, the meals logged (date and foods with grams), and the average per logged day against each target in neutral words ("Within target", "Above target", "Below target", or "Incomplete data" when a nutrient value is missing, because a partial sum must never look like a certain result). If nothing is logged yet it shows the planned averages and says so.
- A "Print or save as PDF" button uses the browser's print view; the navigation and buttons are not printed. The page says it only lists what was entered and is not medical advice.

### Shopping list
- The list is built from the planned meals, grouped by category.
- The user ticks what has been bought. Ticked items count as available when the plan is recalculated.
- A note explains when a meal was kept because its ingredients are already bought.

## States and Boundaries
- **First use** — no profile chosen yet: the user sees only "Choose a profile", with no empty plan.
- **No meals logged** — Month plan shows the proposed plan with progress at zero.
- **Missing nutrient value** — shown as "n/a", never as 0, and not counted toward a total as if it were zero.
- **Targets cannot all be met** — the update screen says so plainly and shows the closest plan, without blame.
- **Nothing to change** — logging a meal that keeps targets on track shows "No changes needed".
- **Persistence** — the plan, targets, logs and ticked items are kept on the device between visits (assumption: no accounts, no sync).
- **Food data** — a small fixed set of about 250 foods from USDA FoodData Central, with names in English.
- **Disclaimer** — "Support tool, not medical advice." is visible on every screen.

## Product Decisions
- All-English app, repository and video — required by the hackathon.
- Targets are configurable for any nutrient, so one engine serves weight loss, cholesterol and recovery — avoids per-condition logic and keeps the build small.
- Shopping list and "already at home" are part of the core loop, not later — the replan depends on what is already bought or prepared.
- Monthly planning horizon with a day-by-day view — the learner chose monthly goals and plan.
- Neutral health wording and a visible disclaimer — the app is a support tool for use alongside a doctor.
- No food photos, no login, no cloud — to keep the proof of concept small and licence-safe.

## What We're Building
- Profile selection and editable monthly targets, including a custom target
- A curated set of about 250 USDA foods and a set of recipes built from them
- Month plan with daily meals and progress against targets
- Logging a meal, from plan or by searching a food with a portion
- Plan recalculation after a log, with the Plan updated screen (before and after, reason, effect, keep or use)
- Tickable shopping list with "Already at home", feeding the recalculation
- Shopping by frequency: the user chooses how often they shop (every 2, 3, 5 or 7 days); the list covers only the meals until the next shop, and "I'm shopping now" starts a new list from today
- A printable summary for the user's doctor (targets, what was eaten, averages against the targets), with the disclaimer
- A fourth example profile, Athlete (high energy and protein minimums)
- Persistence on the device, disclaimer on every screen

## Deferred From the POC
- Entering results after the first period (for example weight) to recalibrate targets — second feedback loop
- Recipes, Progress and Profile areas — not needed to prove the kernel

## Possible Later Enhancements
Other target profiles; family profiles; supermarket links; richer progress charts.

## Non-Goals
- No blood test or lab-value tracking: health claims are out of reach for a proof of concept.
- No medical advice or treatment recommendations.
- No supermarket integration or delivery.
- No gamification and no professional dashboards.
- No accounts or cloud sync.

## Open Questions
- Which recipes and how many to ship with the app (about 20 is the working assumption). Can wait until `4-spec`.
- How the recalculation chooses between meals (technical approach). Belongs to `4-spec`.
