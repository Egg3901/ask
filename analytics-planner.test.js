"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("./analytics-planner");

const catalog = {
  schemaVersion: "1",
  datasets: [{
    id: "player_geography",
    description: "Privacy-safe player aggregates grouped by country or state.",
    dimensions: [{ id: "scope" }, { id: "country" }],
    metrics: [{
      id: "civic_participation",
      aliases: ["civic participation", "political engagement"],
      unit: "score",
      aggregations: ["sum", "average"],
    }],
    presentations: ["map", "ranked_bar", "table"],
    defaultPresentation: "map",
  }],
};

test("plans a newly cataloged metric without a metric-specific routing rule", () => {
  const result = planner.plan(
    "Map average civic participation across US states",
    catalog,
    { country: "US" },
  );

  assert.equal(result.dataset, "player_geography");
  assert.equal(result.metric, "civic_participation");
  assert.equal(result.presentation, "map");
  assert.deepEqual(result.args, {
    dataset: "player_geography",
    metric: "civic_participation",
    presentation: "map",
    scope: "country",
    country: "US",
    aggregation: "average",
  });
});

test("chooses a ranked bar when the user asks to rank geographic aggregates", () => {
  const result = planner.plan(
    "Rank countries by political engagement",
    catalog,
  );

  assert.equal(result.presentation, "ranked_bar");
  assert.equal(result.args.scope, "world");
});

test("declines a request that has no catalog-supported metric", () => {
  assert.equal(planner.plan("Map annual rainfall", catalog, { country: "US" }), null);
});
