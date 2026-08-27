"use strict";

const visualization = require("./visualization");

const BLOCK = /```(?:mermaid|mmd|ahd-map)\s*\n[\s\S]*?```\s*/gi;
const MAP_BLOCK = /```ahd-map\s*\n([\s\S]*?)```/i;

function stripVisuals(answer) {
  return String(answer || "").replace(BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Some picker models (e.g. Mimo via the OpenCode Zen gateway) don't honor the
// native tool_calls contract — they emit tool invocations as XML text inside the
// content: <tool_call><function=search_code><parameter=query>…. The harness never
// parses these, so the raw markup would stream straight to the player as the
// "answer". Detect that shape so the caller can fail the generation (no quota,
// standard retry error) instead of shipping tool-call soup.
const TOOL_LEAK = /<\/?tool_call\b|<function\s*=|<parameter\s*=|<\|(?:tool_call|tool_calls|python_tag)\|>/i;
function looksLikeToolLeak(answer) {
  return TOOL_LEAK.test(String(answer || ""));
}

function matchingMap(datasets, metric) {
  return (datasets || []).find(data => data?.recommended === "map" && (!metric || data.metric === metric)) || null;
}

function matchingDataset(datasets, metric) {
  return (datasets || []).find(data => data?.recommended !== "map" && (!metric || data.metric === metric)) || null;
}

// Prevent a model from presenting a plausible-looking but unsupported chart.
// Canonical maps and chart data are produced by the live adapters, never copied
// from a model response.
function enforce({ answer, datasets = [], plan, visualizationsEnabled = false, question = "" }) {
  const text = String(answer || "").trim();
  const issues = [];
  const expected = plan?.display || { kind: "prose" };
  const map = expected.kind === "map" ? matchingMap(datasets, expected.metric) : null;

  if (expected.kind === "map") {
    const prose = stripVisuals(text);
    if (!map) {
      issues.push("required_live_map_unavailable");
      return { answer: prose, issues, required: false };
    }
    const block = visualization.chart(map, question);
    return { answer: `${block}\n\n${prose}`.trim(), issues, required: false };
  }

  if (expected.kind === "comparison" && expected.canonical) {
    const prose = stripVisuals(text);
    const dataset = matchingDataset(datasets, expected.metric);
    if (!dataset) {
      issues.push("required_live_dataset_unavailable");
      return { answer: prose, issues, required: false };
    }
    if (visualizationsEnabled || plan?.visual === "required") {
      const block = visualization.chart(dataset, question);
      if (block) return { answer: `${block}\n\n${prose}`.trim(), issues, required: false };
    }
    return { answer: prose, issues, required: false };
  }

  // Rule/mechanics answers must stay prose even if an account-wide optional
  // visualization toggle is enabled. This stops words such as “state” from
  // turning an election question into an unrelated economy chart.
  if (plan?.visual === "none") {
    if (BLOCK.test(text)) issues.push("unsupported_visualization_removed");
    BLOCK.lastIndex = 0;
    return { answer: stripVisuals(text), issues, required: false };
  }

  if (visualizationsEnabled && datasets.length) {
    const canonical = visualization.chart(datasets[0], question);
    if (canonical) {
      const prose = stripVisuals(text);
      return { answer: `${canonical}\n\n${prose}`.trim(), issues, required: false };
    }
  }

  return { answer: text, issues, required: false };
}

function inspect(answer, plan) {
  const hasMap = MAP_BLOCK.test(String(answer || ""));
  if (plan?.display?.kind === "map" && !hasMap) return ["required_live_map_missing"];
  return [];
}

module.exports = { enforce, inspect, stripVisuals, looksLikeToolLeak };
