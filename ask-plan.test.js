"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const plan = require("./ask-plan");
const guard = require("./answer-guard");

test("classifies a candidate roster map as required live canonical map output", () => {
  const request = plan.create("Map GOP Senate 1 candidates, real players only");
  assert.equal(request.id, "candidate-roster-map");
  assert.equal(request.live, "required");
  assert.equal(request.display.kind, "map");
  assert.equal(request.display.metric, "candidate_roster");
});

test("treats a House seat question as rules prose rather than country economy", () => {
  const request = plan.create("Can two Democrats get elected to New York House seats?");
  assert.equal(request.id, "election-rules");
  assert.equal(request.visual, "none");
  assert.equal(request.suppressGenericCountryEconomy, true);
});

test("removes an unsupported GDP chart from an election-rules answer", () => {
  const request = plan.create("Can two Democrats get elected to New York House seats?");
  const outcome = guard.enforce({
    answer: "```mermaid\nxychart-beta\n  title GDP\n```\n\nYes, if they win separate districts.",
    datasets: [{ recommended: "bar", metric: "gdpGrowth", rows: [{ label: "US", value: 7 }] }],
    plan: request,
    visualizationsEnabled: true,
  });
  assert.doesNotMatch(outcome.answer, /mermaid|GDP/);
  assert.match(outcome.answer, /separate districts/);
  assert.deepEqual(outcome.issues, ["unsupported_visualization_removed"]);
});

test("replaces a model map with the exact canonical live map", () => {
  const request = plan.create("Map GOP Senate 1 candidates, real players only");
  const outcome = guard.enforce({
    answer: "```mermaid\nflowchart LR\n A-->B\n```\n\nFive states have candidates.",
    datasets: [{ recommended: "map", metric: "candidate_roster", scope: "country", country: "US", title: "Roster", regions: [{ id: "MD", label: "Maryland", value: 1 }] }],
    plan: request,
  });
  assert.match(outcome.answer, /^```ahd-map/);
  assert.match(outcome.answer, /candidate_roster/);
  assert.doesNotMatch(outcome.answer, /flowchart/);
});

test("classifies a largest-public-corporations request as a live leaderboard", () => {
  const request = plan.create("Show me a visualization comparing the 10 largest public companies");
  assert.equal(request.intent, "corporation_leaderboard");
  assert.equal(request.live, "required");
  assert.equal(request.display.kind, "comparison");
  assert.equal(request.display.metric, "market_cap_anchor");
  assert.equal(request.visual, "required");
});

test("removes an invented leaderboard when its required live dataset is unavailable", () => {
  const request = plan.create("Show me a visualization comparing the 10 largest public companies");
  const outcome = guard.enforce({
    answer: "```mermaid\nxychart-beta\n  bar [100, 90]\n```\n\nThe largest companies are Alpha and Beta.",
    datasets: [],
    plan: request,
    visualizationsEnabled: true,
  });

  assert.doesNotMatch(outcome.answer, /mermaid|bar \[/);
  assert.deepEqual(outcome.issues, ["required_live_dataset_unavailable"]);
});
