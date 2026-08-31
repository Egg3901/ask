const test = require("node:test");
const assert = require("node:assert/strict");

const visualization = require("./visualization");

const comparison = {
  recommended: "bar",
  title: "The Money Printer compared with media peers",
  metric: "revenueAnchor",
  unit: "anchor",
  rows: [
    { label: "The Money Printer", value: 23368401.27, stakes: 5 },
    { label: "The Workers' Daily", value: 5188350.91, stakes: 4 },
    { label: "Tinky Corporation", value: 1588308.37, stakes: 1 },
  ],
};

test("recognizes an explicit visualization request independently of the settings toggle", () => {
  assert.equal(visualization.requested("Visualize the clearest difference."), true);
  assert.equal(visualization.requested("Show this as a chart"), true);
  assert.equal(visualization.requested("Map unemployment across the world"), true);
  assert.equal(visualization.requested("Compare my corporation with its peers"), false);
});

test("creates a native game map block from live geographic data", () => {
  const map = {
    recommended: "map", scope: "country", country: "IT", title: "Italy approval",
    metric: "approval", unit: "%", palette: "good",
    regions: [{ id: "IT_LAZ", label: "Lazio", value: 71.2 }],
  };
  const answer = visualization.ensure("Lazio currently leads.", [map], { required: true });
  assert.match(answer, /^```ahd-map\n/);
  assert.match(answer, /"country":"IT"/);
  assert.match(answer, /Lazio currently leads\.$/);
});

test("creates a chart from live comparison data when the model omits one", () => {
  const answer = visualization.ensure(
    "The Money Printer leads its public media peers.",
    [comparison],
    { required: true },
  );

  assert.match(answer, /^```mermaid\nxychart-beta/);
  assert.match(answer, /The Money Printer/);
  assert.match(answer, /23368401\.27/);
  assert.match(answer, /The Money Printer leads its public media peers\.$/);
});

test("keeps all ten rows in a requested top-ten chart", () => {
  const topTen = {
    ...comparison,
    rows: Array.from({ length: 10 }, (_, index) => ({
      label: `Company ${index + 1}`,
      value: 10 - index,
    })),
  };

  const answer = visualization.ensure("Ten public companies ranked.", [topTen], { required: true });

  assert.match(answer, /Company 10/);
  assert.match(answer, /bar \[10, 9, 8, 7, 6, 5, 4, 3, 2, 1\]/);
});

test("moves a model-generated chart before prose without duplicating it", () => {
  const chart = "```mermaid\nflowchart LR\n  A --> B\n```";
  const answer = visualization.ensure(`Long explanation first.\n\n${chart}\n\nFinal note.`, [], { required: true });

  assert.equal(answer.indexOf(chart), 0);
  assert.equal(answer.match(/```mermaid/g)?.length, 1);
  assert.match(answer, /Long explanation first\.\n\nFinal note\.$/);
});

test("renders a time-shaped canonical dataset as a line chart", () => {
  const answer = visualization.chart({
    title: "Player wealth over time",
    metric: "wealth_anchor",
    unit: "anchor",
    rows: [{ label: "T10", value: 4 }, { label: "T11", value: 7 }],
  }, "Show the trend over time");

  assert.match(answer, /line \[4, 7\]/);
  assert.doesNotMatch(answer, /bar \[/);
});

test("renders multi-series rows as a grouped bar chart", () => {
  const answer = visualization.chart({
    title: "Supply and demand",
    unit: "units",
    rows: [
      { label: "Oil", supply: 5, demand: 8 },
      { label: "Coal", supply: 9, demand: 6 },
    ],
  });

  assert.match(answer, /bar \[5, 9\]/);
  assert.match(answer, /bar \[8, 6\]/);
});

test("renders genuine parts of a whole as a pie chart", () => {
  const answer = visualization.chart({
    title: "Revenue composition",
    partOfWhole: true,
    rows: [{ label: "Retail", value: 70 }, { label: "Media", value: 30 }],
  });

  assert.match(answer, /pie showData/);
  assert.match(answer, /"Retail" : 70/);
});

test("uses a table for canonical datasets that explicitly request one", () => {
  const answer = visualization.chart({
    recommended: "table",
    title: "State comparison",
    rows: [{ label: "California", value: 12, detail: "three players" }],
  });

  assert.match(answer, /\| State comparison \| Value \| Detail \|/);
  assert.match(answer, /\| California \| 12 \| three players \|/);
});

test("an explicit chart request is not answered with a map", () => {
  // Reported 2026-08-23: "Didn't want a map I wanted a chart". A region dataset
  // defaults to a map, and that default beat the player's own words.
  const regions = {
    recommended: "map", metric: "player_net_worth_anchor", title: "Aggregate player net worth",
    regions: [{ id: "US", label: "US", value: 5e8 }, { id: "UK", label: "UK", value: 1.9e8 }],
  };
  const asked = "can you make a chart that shows wealth net worth distribution among players in the US and UK";
  assert.equal(visualization.recommend(regions, asked), "bar");
  assert.match(visualization.chart(regions, asked), /xychart-beta/);
  // Regions carry the values, so the chart is built without new adapter output.
  assert.match(visualization.chart(regions, asked), /\["US","UK"\]/);

  // A map is still a map when that is what was asked for, or when nothing was.
  assert.equal(visualization.recommend(regions, "map player net worth by country"), "map");
  assert.equal(visualization.recommend(regions, ""), "map");
  // "chart me a map of X" names both; the map wins.
  assert.equal(visualization.recommend(regions, "chart me a map of net worth"), "map");
});

test("a categorical comparison on one metric renders as a bar chart", () => {
  // The series is keyed by its metric name, not `value`: before the bar rule
  // this clean entities-on-one-metric comparison fell through to a table.
  const dataset = {
    title: "GDP growth by country",
    metric: "gdpGrowth",
    unit: "%",
    rows: [
      { label: "US", gdpGrowth: 2.1 },
      { label: "UK", gdpGrowth: 1.4 },
      { label: "France", gdpGrowth: 0.9 },
      { label: "Italy", gdpGrowth: 0.4 },
    ],
  };
  assert.equal(visualization.recommend(dataset), "bar");
  const answer = visualization.chart(dataset);
  assert.match(answer, /xychart-beta/);
  assert.match(answer, /bar \[2\.1, 1\.4, 0\.9, 0\.4\]/);
  assert.match(answer, /GDP growth \(%\)/);
});

test("time-shaped labels beat the categorical bar rule and stay a line", () => {
  const dataset = {
    metric: "gdpGrowth",
    rows: [
      { label: "T10", gdpGrowth: 1.1 },
      { label: "T11", gdpGrowth: 1.5 },
      { label: "T12", gdpGrowth: 1.9 },
    ],
  };
  assert.equal(visualization.recommend(dataset), "line");
  assert.match(visualization.chart(dataset), /line \[1\.1, 1\.5, 1\.9\]/);
});

test("too few or too many categories fall back to a table, not a bar", () => {
  const row = index => ({ label: `Entity ${index}`, population: index + 1 });
  const two = { metric: "population", rows: [row(1), row(2)] };
  const thirteen = { metric: "population", rows: Array.from({ length: 13 }, (_, i) => row(i)) };
  assert.equal(visualization.recommend(two), "table");
  assert.equal(visualization.recommend(thirteen), "table");
});

test("the guard ships an unplanned categorical comparison as a bar chart", () => {
  const guard = require("./answer-guard");
  const dataset = {
    title: "Unemployment by state",
    metric: "unemploymentRate",
    unit: "%",
    rows: [
      { label: "California", unemploymentRate: 5.2 },
      { label: "Texas", unemploymentRate: 4.1 },
      { label: "Ohio", unemploymentRate: 6.3 },
    ],
  };
  const out = guard.enforce({
    answer: "Ohio runs hottest.", datasets: [dataset], plan: null,
    visualizationsEnabled: true, question: "compare unemployment across these states",
  });
  assert.match(out.answer, /xychart-beta/);
  assert.match(out.answer, /bar \[5\.2, 4\.1, 6\.3\]/);
  assert.match(out.answer, /Ohio runs hottest\.$/);
});

test("the guard passes the question through so the request can win", () => {
  const guard = require("./answer-guard");
  const askPlan = require("./ask-plan");
  const regions = {
    recommended: "map", metric: "player_net_worth_anchor", title: "Net worth",
    regions: [{ id: "US", label: "US", value: 5e8 }, { id: "UK", label: "UK", value: 1.9e8 }],
  };
  const q = "make me a graph of player net worth";
  const out = guard.enforce({
    answer: "Here it is.", datasets: [regions], plan: askPlan.create(q),
    visualizationsEnabled: true, question: q,
  });
  assert.match(out.answer, /xychart-beta/);
  assert.doesNotMatch(out.answer, /ahd-map/);
});
