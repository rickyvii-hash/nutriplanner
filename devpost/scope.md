---
doc: scope
status: approved
---

# NutriPlanner

An adaptive monthly meal planner that rebuilds your plan around what you actually ate, bought and prepared.

## The Unique Kernel
Most meal planners are rigid: they give you a plan and you either follow it or fail. NutriPlanner replans. After you log what you really ate (for example a pizza and an ice cream), it updates the monthly plan, taking into account what has already been bought or prepared, and decides which recipes to keep.

## Who It's For
Someone following a personal nutrition goal (weight loss, lowering cholesterol, or recovering with a minimum energy intake) who gets discouraged by rigid plans. They also want something they can show a doctor. Today they use spreadsheets or calorie counters that do not adjust the rest of the plan.

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
A person sets targets, gets a month plan and a tickable shopping list, logs a meal that goes off-plan, and sees a clear message: "Plan updated", with the changed meals shown and the reason. Nutrient values come from public USDA FoodData Central data, and a missing value is shown as missing, never as zero. A visible health disclaimer says it is not medical advice.

## The POC Boundary
- Small curated set of foods (about 250) from USDA FoodData Central
- Recipes whose nutrients are the sum of their ingredients
- Monthly targets and a proposed plan
- Logging actual meals and recalculating the rest of the month
- Tickable shopping list; tick what has been bought, and the plan uses what is in stock
- Health disclaimer
- Example profiles: weight loss, cholesterol, recovery, athlete
- Shopping by frequency, with "I'm shopping now"
- A printable summary to share with a doctor

## Later
- Entering results after the first period (for example weight) to recalibrate targets
- Summary to share with a doctor

## Explicitly Cut
- Blood test history and lab-value tracking: health claims are risky and out of reach for a proof of concept
- Supermarket integration and delivery: needs commercial partners
- Gamification and family profiles: not needed to prove the kernel
- Professional dashboards for nutritionists: a separate product
