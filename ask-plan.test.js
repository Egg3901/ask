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

test("a buy question reaches the live exchange instead of a lecture", () => {
  // Both of these were refused as "investment advice" on a game's fictional
  // stock exchange, using figures already on the public stock market page.
  for (const q of [
    "What corporations have shares available that you think I should purchase?",
    "Can you generally advise me what corporations I should buy?",
    "what stocks should i buy",
    "is tinky winky a good buy right now",
  ]) {
    const request = plan.create(q);
    assert.equal(request.intent, "corporation_investment", q);
    assert.equal(request.live, "required", q);
  }
});

test("a buy question answers in prose unless a chart was asked for", () => {
  assert.equal(plan.create("what stocks should i buy").visual, "none");
  assert.equal(plan.create("chart the stocks I should buy").visual, "required");
});

test("buying something that is not equity stays an ordinary question", () => {
  for (const q of [
    "I want to buy a plant for my corporation",
    "what can i do to improve my company that i run as ceo",
    "how much does it cost to co-sponsor",
    "which bond maturity is better 2 year 5 year 7 year",
  ]) {
    assert.notEqual(plan.create(q).intent, "corporation_investment", q);
  }
});

test("the fair-play rules permit in-game investment suggestions", () => {
  const system = require("./prompt").build({ liveData: true });
  assert.match(system, /IN-GAME INVESTMENT SUGGESTIONS ARE ALLOWED/);
  // The boundary that stays: public data only, and no trading against a person.
  assert.match(system, /only public, exchange-visible data/);
  assert.match(system, /planning trades to damage a named player/);
});
