"use strict";

// One small interface hides catalog matching, query shaping, bounds, and
// presentation judgment. The MCP catalog owns which metrics are available;
// adding a metric there does not require another routing branch here.

const STOP = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is",
  "me", "of", "on", "or", "show", "the", "to", "with",
]);
const OPEN_ENDED_VISUAL = /(?=[\s\S]*\b(?:visuali[sz](?:e|ation)|chart|graph|plot|map)\b)(?=[\s\S]*\b(?:interesting|surprising|insightful|showcase|anything|something)\b)/i;

function words(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .match(/[a-z0-9]+/g)?.filter(word => word.length > 1 && !STOP.has(word)) || [];
}

function phrase(value) {
  return words(value).join(" ");
}

function metricScore(question, metric) {
  const normalizedQuestion = phrase(question);
  const aliases = [metric?.id, ...(metric?.aliases || [])].filter(Boolean);
  let best = 0;
  for (const alias of aliases) {
    const normalizedAlias = phrase(alias);
    if (!normalizedAlias) continue;
    if (normalizedQuestion.includes(normalizedAlias)) {
      best = Math.max(best, 100 + words(normalizedAlias).length);
      continue;
    }
    const wanted = new Set(words(normalizedAlias));
    const overlap = words(normalizedQuestion).filter(word => wanted.has(word)).length;
    if (overlap >= Math.min(2, wanted.size)) best = Math.max(best, overlap);
  }
  return best;
}

function choosePresentation(question, dataset) {
  const text = String(question || "");
  const supported = new Set(dataset?.presentations || []);
  const choices = [
    [/\b(?:map|heatmap|choropleth|geograph)/i, "map"],
    [/\b(?:rank|ranking|largest|smallest|highest|lowest|top\s+\d+)/i, "ranked_bar"],
    [/\b(?:trend|over time|history|timeline|change over)/i, "line"],
    [/\b(?:share|composition|breakdown|parts? of|percent of total)/i, "pie"],
    [/\b(?:table|tabular|rows?)\b/i, "table"],
  ];
  for (const [pattern, presentation] of choices) {
    if (pattern.test(text) && supported.has(presentation)) return presentation;
  }
  return supported.has(dataset?.defaultPresentation)
    ? dataset.defaultPresentation
    : [...supported][0] || null;
}

function requestedLimit(question) {
  const match = String(question || "").match(/\b(?:top\s*)?(\d{1,2})\b/i);
  return match ? Math.max(1, Math.min(25, Number(match[1]))) : null;
}

function requestedWindow(question) {
  const match = String(question || "").match(/\b(?:within|last)\s+(\d{1,3})\s*(?:hours?|hrs?)\b/i);
  return match ? Math.max(1, Math.min(168, Number(match[1]))) : null;
}

function plan(question, catalog, context = {}) {
  const candidates = [];
  for (const dataset of catalog?.datasets || []) {
    for (const metric of dataset?.metrics || []) {
      const score = metricScore(question, metric);
      if (score > 0) candidates.push({ dataset, metric, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  let chosen = candidates[0];
  let showcase = false;
  // An open-ended visualization has no metric words to match. Let catalog
  // order declare the default showcase, while supporting explicit showcase
  // markers when the catalog grows. The selected values still come from the
  // live analytics query, never from the answer model.
  if (!chosen && OPEN_ENDED_VISUAL.test(String(question || ""))) {
    for (const dataset of catalog?.datasets || []) {
      const metric = (dataset.metrics || []).find(item => item.showcase === true)
        || (dataset.showcaseMetric
          ? (dataset.metrics || []).find(item => item.id === dataset.showcaseMetric)
          : null)
        || dataset.metrics?.[0];
      if (!metric || !choosePresentation(question, dataset)) continue;
      chosen = { dataset, metric, score: 0 };
      showcase = true;
      break;
    }
  }
  if (!chosen) return null;

  const presentation = choosePresentation(question, chosen.dataset);
  if (!presentation) return null;
  const args = {
    dataset: chosen.dataset.id,
    metric: chosen.metric.id,
    presentation,
  };

  const dimensions = new Set((chosen.dataset.dimensions || []).map(item => item.id));
  if (dimensions.has("scope")) {
    args.scope = context.country ? "country" : "world";
    if (context.country) args.country = context.country;
  } else if (dimensions.has("country") && context.country) {
    args.country = context.country;
  }

  const aggregations = chosen.metric.aggregations || [];
  if (aggregations.includes("average") && /\b(?:average|mean|per player|per character)\b/i.test(question)) {
    args.aggregation = "average";
  } else if (aggregations.includes("sum")) {
    args.aggregation = "sum";
  }
  const limit = requestedLimit(question);
  if (limit != null) args.limit = limit;
  const windowHours = requestedWindow(question);
  if (windowHours != null) args.windowHours = windowHours;

  return {
    dataset: chosen.dataset.id,
    metric: chosen.metric.id,
    presentation,
    args,
    score: chosen.score,
    rationale: showcase
      ? `catalog showcase ${chosen.dataset.id}.${chosen.metric.id}; ${presentation} is its supported default`
      : `catalog metric ${chosen.metric.id}; ${presentation} is supported by ${chosen.dataset.id}`,
  };
}

module.exports = { plan, choosePresentation };
