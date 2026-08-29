"use strict";

const REQUEST_WORDS = /\b(?:visuali[sz](?:e|ation)|chart|graph|diagram|plot|map|heatmap|choropleth)\b/i;
const MERMAID_BLOCK = /```(?:mermaid|mmd)\s*\n[\s\S]*?```/i;
const MAP_BLOCK = /```ahd-map\s*\n[\s\S]*?```/i;

function requested(question) {
  return REQUEST_WORDS.test(String(question || ""));
}

function shortLabel(value) {
  const label = String(value || "").replace(/\s+/g, " ").trim();
  return label.length > 24 ? `${label.slice(0, 23).trim()}…` : label;
}

function axisLabel(dataset) {
  const labels = {
    revenueAnchor: "Revenue (anchor)",
    market_cap_anchor: "Market capitalization (anchor)",
    liquid_capital_anchor: "Liquid capital (anchor)",
    gdpGrowth: "GDP growth (%)",
    inflationRate: "Inflation (%)",
    unemploymentRate: "Unemployment (%)",
    medianIncomeAnchor: "Income (anchor)",
    population: "Population",
  };
  return labels[dataset.metric] || String(dataset.unit || dataset.metric || "Value");
}

const LABELLING = new Set([
  "label", "detail", "id", "country", "countryId", "localCurrency",
  "metric", "name", "scope", "state", "unit",
]);

function numericSeries(rows) {
  const keys = new Set();
  for (const row of rows || []) {
    for (const [key, value] of Object.entries(row || {})) {
      if (!LABELLING.has(key) && Number.isFinite(Number(value))) keys.add(key);
    }
  }
  return [...keys];
}

const WANTS_MAP = /\b(?:map|heatmap|choropleth)\b/i;
const WANTS_CHART = /\b(?:chart|graph|plot|bar chart|line chart|pie)\b/i;

/** True when the player named a chart and did not name a map. */
function chartRequested(question) {
  const text = String(question || "");
  return WANTS_CHART.test(text) && !WANTS_MAP.test(text);
}

/** Rows a chart can be built from, treating map regions as rows. */
function chartableRows(dataset) {
  const rows = Array.isArray(dataset?.rows) && dataset.rows.length ? dataset.rows : (dataset?.regions || []);
  // A grouped-bar dataset carries its numbers in named series and has no `value`
  // at all, so requiring one here silently emptied every multi-series chart.
  return (rows || []).filter(row => row && row.label != null
    && Object.entries(row).some(([key, value]) => !LABELLING.has(key) && Number.isFinite(Number(value))));
}

function recommend(dataset, question = "") {
  const declared = dataset?.recommended === "ranked_bar" ? "bar" : dataset?.recommended;
  // "I wanted a chart, not a map" was a real report. A region dataset defaults to
  // a map, and that default used to win even when the player said "chart", so an
  // explicit request overrides it whenever the rows can carry a chart.
  const overrideMap = chartRequested(question) && chartableRows(dataset).length > 0;
  if (["map", "bar", "line", "grouped_bar", "pie", "table"].includes(declared)) {
    if (!(declared === "map" && overrideMap)) return declared;
  } else if (Array.isArray(dataset?.regions) && !overrideMap) {
    return "map";
  }
  if (dataset?.partOfWhole === true) return "pie";
  const text = String(question || "");
  if (/\b(?:table|tabular|rows?)\b/i.test(text)) return "table";
  if (/\b(?:trend|over time|history|timeline|change over)\b/i.test(text)) return "line";
  const rows = chartableRows(dataset);
  const series = numericSeries(rows);
  if (series.length > 1 && !series.includes("value")) return "grouped_bar";
  if (rows.length > 1 && rows.every(row => /^(?:T\d+|\d{4}(?:-\d{2})?(?:-\d{2})?)$/i.test(String(row.label || "")))) return "line";
  if (series.includes("value")) return "bar";
  return "table";
}

function table(dataset) {
  const rows = chartableRows(dataset).slice(0, 25);
  if (!rows.length) return null;
  const clean = value => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const title = clean(dataset.title || "Item");
  return [
    `| ${title} | Value | Detail |`,
    "| --- | ---: | --- |",
    ...rows.map(row => `| ${clean(row.label)} | ${clean(row.value)} | ${clean(row.detail)} |`),
  ].join("\n");
}

function pie(dataset) {
  const rows = chartableRows(dataset)
    .map(row => ({ label: shortLabel(row.label), value: Number(row.value) }))
    .filter(row => row.label && Number.isFinite(row.value) && row.value >= 0)
    .slice(0, 12);
  if (!rows.length) return null;
  return [
    "```mermaid",
    `pie showData title ${JSON.stringify(String(dataset.title || "Composition"))}`,
    ...rows.map(row => `  ${JSON.stringify(row.label)} : ${row.value}`),
    "```",
  ].join("\n");
}

function xyChart(dataset, kind) {
  const inputRows = chartableRows(dataset).slice(0, 12);
  const labels = inputRows.map(row => shortLabel(row.label));
  const fields = kind === "grouped_bar" ? numericSeries(inputRows).filter(key => key !== "value") : ["value"];
  if (!labels.length || !fields.length) return null;
  const series = fields.map(field => ({
    field,
    values: inputRows.map(row => Number(row[field])),
  })).filter(item => item.values.every(Number.isFinite));
  if (!series.length) return null;
  const values = series.flatMap(item => item.values);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const padding = Math.max(Math.abs(max), Math.abs(min), 1) * 0.08;
  const top = Math.round((max + padding) * 100) / 100;
  const bottom = Math.round((min < 0 ? min - padding : 0) * 100) / 100;
  const suffix = series.length > 1 ? ` (${series.map(item => item.field).join(", ")})` : "";
  const title = String(`${dataset.title || "Live comparison"}${suffix}`).replace(/\s+/g, " ").trim();
  const mark = kind === "line" ? "line" : "bar";
  return [
    "```mermaid",
    "xychart-beta",
    `  title ${JSON.stringify(title)}`,
    `  x-axis ${JSON.stringify(labels)}`,
    `  y-axis ${JSON.stringify(axisLabel(dataset))} ${bottom} --> ${top}`,
    ...series.map(item => `  ${mark} [${item.values.join(", ")}]`),
    "```",
  ].join("\n");
}

function chart(dataset, question = "") {
  const kind = recommend(dataset, question);
  if (kind === "map") {
    try {
      return `\`\`\`ahd-map\n${JSON.stringify(dataset)}\n\`\`\``;
    } catch { return null; }
  }
  if (kind === "table") return table(dataset);
  if (kind === "pie") return pie(dataset);
  return xyChart(dataset, kind);
}

function ensure(answer, datasets = [], { required = false, question = "" } = {}) {
  const text = String(answer || "").trim();
  const existing = text.match(MAP_BLOCK)?.[0] || text.match(MERMAID_BLOCK)?.[0] || null;
  if (existing) {
    const prose = text.replace(existing, "").replace(/\n{3,}/g, "\n\n").trim();
    return prose ? `${existing}\n\n${prose}` : existing;
  }
  if (!required) return text;
  const generated = chart(datasets[0], question);
  return generated ? `${generated}\n\n${text}`.trim() : text;
}

/**
 * Did a finished answer actually carry a chart or map? This is what the
 * visualization allowance is charged against — the delivered artifact, not the
 * intent to produce one.
 */
function contains(answer) {
  const text = String(answer || "");
  return Boolean(text.match(MAP_BLOCK) || text.match(MERMAID_BLOCK));
}

module.exports = { requested, chartRequested, recommend, chart, ensure, contains };
