---
doc: scope
status: approved
---

# NutriPlanner

An adaptive monthly meal planner that rebuilds your plan around what you actually ate, bought and prepared.

## The Unique Kernel
Most meal planners are rigid: they give you a plan and you either follow it or fail. NutriPlanner replans. After you log what you really ate (for example a pizza and an ice cream), it updates the monthly plan, taking into account what has already been bought or prepared, and decides which recipes to keep.

## Who It's For
Someone following a personal nutrition goal (weight loss, lowering cholesterol, recovery, or high training energy needs) who gets discouraged by rigid plans. They also want something they can show a doctor. Today they use spreadsheets or calorie counters that do not adjust the rest of the plan.

## The Core Loop
1. Set monthly nutrient targets (a minimum or a maximum for any nutrient).
2. See the proposed plan and the shopping list built from it.
3. Log what was actually eaten, and tick what has been bought.
4. The plan is updated for the rest of the month, with a message explaining the change, and keeps the recipes that use food already bought or prepared.

They come back each day to log meals and see the adjusted plan.

## Inspiration & Identity
Not established yet. Should feel calm and reassuring, not guilt-inducing. To be refined in the PRD.

## Why This Matters to the Learner
Born from managing cholesterol through food for a family member, and from a recovery period when it mattered how much energy every spoonful of broth provided. Intended as a support tool alongside a doctor, never a replacement.

## What "Working" Looks Like
A person sets targets, gets a month plan and a tickable shopping list, adds food outside the menu (or skips or replaces a planned meal), and sees a clear message: "Plan updated", with the changed meals shown and the reason. Meals can be logged from the plan, by searching a food, or as an **Extra / outside meal** not tied to a planned slot; extras count in the day totals and in the update. A saved log entry can be corrected: removed, given a different portion, or switched between Eaten and Skipped. A planned meal can be replaced with another recipe or with "I ate something else", which logs a searched food as replaced rather than skipped or eaten. **Start over** asks for confirmation and erases the plan, logs and shopping ticks; **Change profile** keeps the log unless Start over is chosen. They can open a meal detail for ingredients and target nutrients, and use honest outside web searches for a full recipe, nearby places or delivery — NutriPlanner never takes orders. Nutrient values come from public USDA FoodData Central data, and a missing value is shown as missing, never as zero. A visible health disclaimer says it is not medical advice.

## The POC Boundary
- Curated set of foods (about 480) from USDA FoodData Central SR Legacy
- Recipes (about 40) whose nutrients are the sum of their ingredients
- Monthly targets and a proposed plan
- Logging actual meals and recalculating the rest of the month (4-day make-up window)
- Grouped "Add as eaten" blocks on the log screen (recipe name with indented ingredients)
- Skip a planned meal; replace a planned meal with another recipe for the same slot or with "I ate something else" (searched food logged as replaced), with Plan updated preview before keeping or using the change
- Extra / outside meals: foods found by search that are not tied to a planned slot (`extra: true`); they count in the day totals and in the adaptive replan
- Undo or edit a saved log entry: remove it, change a portion, or switch a meal between Eaten and Skipped
- Start over (confirmation erases the month plan, meal logs and shopping ticks) and Change profile (keeps the log unless Start over is chosen)
- Recipe detail panel: ingredients, nutrients for the current targets, and three outside-search links (full recipe, find nearby, order delivery) that open a new browser tab only when tapped, with the note "Opens a web search. NutriPlanner does not take orders."
- Tickable shopping list; tick what has been bought, and the plan uses what is in stock
- Health disclaimer
- Example profiles: weight loss, cholesterol, recovery, athlete
- Shopping by frequency, with "I'm shopping now"
- My meals: breakfast/lunch/dinner on or off, 0 or 1 snack; plan uses only chosen slots
- Drinks shortcut with ml presets; Download my data / Restore from file; first-run guide
- A printable summary to share with a doctor

## Later
- Entering results after the first period (for example weight) to recalibrate targets
- In-app cooking steps written for every recipe

## Explicitly Cut
- Blood test history and lab-value tracking: health claims are risky and out of reach for a proof of concept
- Real supermarket integration, partner APIs, scraping, or a fake delivery cart inside the app (outside search links only)
- Gamification and family profiles: not needed to prove the kernel
- Professional dashboards for nutritionists: a separate product
