/**
 * Stale decision notice when a trigger day loses its log entry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPlan, replan, todayIso } from "../src/engine/planner.js";
import { recomputeShownPlan, STALE_DECISIONS_NOTICE } from "../src/engine/plan_from_log.js";
import { profileById } from "../src/engine/profiles.js";

const foods = JSON.parse(fs.readFileSync(new URL("../data/foods.json", import.meta.url), "utf8"));
const recipes = JSON.parse(fs.readFileSync(new URL("../data/recipes.json", import.meta.url), "utf8"));
const foodsById = new Map(foods.map((f) => [f.id, f]));
const targets = profileById("cholesterol").targets;
const plan = buildPlan(targets, recipes, { year: 2026, month: 10 }, foodsById);

test("stale decision drops with the recomputed notice", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 24, 12, 0, 0) });
  t.after(() => t.mock.timers.reset());
  assert.equal(todayIso(), "2026-10-24");
  const log = [{ date: "2026-10-24", time: "12:00", items: [{ foodId: "apple-raw", grams: 100 }], extra: true }];
  const out = recomputeShownPlan({
    planBase: plan,
    plan,
    log,
    decisions: [
      { triggerDate: "2026-10-18", accepted: true },
      { triggerDate: "2026-10-24", accepted: true },
    ],
    today: "2026-10-24",
    targets,
    recipes,
    foodsById,
  });
  assert.equal(out.notice, STALE_DECISIONS_NOTICE);
  assert.deepEqual(out.decisions, [{ triggerDate: "2026-10-24", accepted: true }]);
});
