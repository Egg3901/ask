"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const askPlan = require("./ask-plan");
const live = require("./live-intelligence");
const router = require("./router");
const models = require("./models");
const llm = require("./llm");

const QUESTION = "If the presidential election goes to a contingency election, who would win, using live data?";

test("contingent presidential questions require live Deep synthesis", () => {
  const plan = askPlan.create(QUESTION);
  const route = router.choose({ question: QUESTION, useMcp: true, deepReasoning: plan.reasoning === "deep" });
  assert.equal(plan.intent, "contingent_election");
  assert.equal(plan.live, "required");
  assert.equal(route.tier, "deep");
});

test("contingent presidential retrieval reads the race and both election maps", async () => {
  const calls = [];
  const callTool = async (tool, args) => {
    calls.push([tool, args]);
    return JSON.stringify({ tool, args });
  };
  const result = await live.retrieve({
    question: QUESTION,
    plan: askPlan.create(QUESTION),
    callTool,
  });
  assert.deepEqual(calls.slice(1), [
    ["trace_race", { election: "president", country: "US" }],
    ["map_snapshot", { scope: "country", country: "US", metric: "presidential" }],
    ["map_snapshot", { scope: "country", country: "US", metric: "house" }],
  ]);
  assert.match(result.text, /ACTIVE PRESIDENTIAL RACE/);
  assert.match(result.text, /HOUSE DELEGATION CONTROL/);
  assert.match(result.text, /Never assume the real-world 50-state delegation count/);
});

test("Nous exposes Luna Max through the compatible completion client", () => {
  assert.equal(models.providerDisplayFor("openai/gpt-5.6-luna"), "Nous Portal");
  assert.equal(models.displayFor("openai/gpt-5.6-luna"), "GPT-5.6 Luna Max");
  assert.equal(models.effortFor("openai/gpt-5.6-luna", "high"), "max");
  assert.equal(llm.completionUrl("nous"), "https://inference-api.nousresearch.com/v1/chat/completions");
});
