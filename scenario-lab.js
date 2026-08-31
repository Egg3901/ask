"use strict";

const COMMODITIES = [
  "rare earth", "natural gas", "food products", "consumer goods", "real estate services",
  "software", "freight", "consulting", "electricity", "oil", "coal", "iron", "steel",
  "chemicals", "fertilizers", "pharmaceuticals", "vehicles", "machinery", "agriculture",
];

const SCENARIO_WORDS = /\b(?:what if|what happens|project|projection|scenario|simulate|forecast)\b/i;

function signedShock(text, subject) {
  const patterns = [
    new RegExp(`\\b${subject}\\b[^.!?]{0,28}?(\\d+(?:\\.\\d+)?)\\s*%[^.!?]{0,18}`, "i"),
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%[^.!?]{0,18}?\\b${subject}\\b[^.!?]{0,18}`, "i"),
  ];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0 || value > 50) return null;
    const negative = /\b(?:drop|drops|fall|falls|decline|declines|decrease|decreases|cut|cuts|reduce|reduces|lower|lowers|shrink|shrinks|down)\b/i.test(match[0]);
    return negative ? -value : value;
  }
  return 0;
}

function commodityIn(text) {
  const lower = String(text || "").toLowerCase();
  return COMMODITIES.find(item => new RegExp(`\\b${item.replace(/ /g, "\\s+")}\\b`, "i").test(lower)) || null;
}

function parse(question) {
  const text = String(question || "").trim();
  if (!SCENARIO_WORDS.test(text)) return null;
  const turnMatch = text.match(/\b(?:for|over|across|next)\s+(?:the\s+next\s+)?(\d{1,2})\s+turns?\b/i)
    || text.match(/\b(\d{1,2})[ -]turn\b/i);
  if (!turnMatch) return null;
  const turns = Number(turnMatch[1]);
  if (!Number.isInteger(turns) || turns < 1 || turns > 60) return null;
  const demandPct = signedShock(text, "demand");
  const supplyPct = signedShock(text, "supply");
  if (demandPct == null || supplyPct == null || (demandPct === 0 && supplyPct === 0)) return null;
  const commodity = commodityIn(text);
  return {
    turns,
    demandPct,
    supplyPct,
    ...(commodity ? { commodity: commodity.replace(/ /g, "_") } : {}),
  };
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "unknown";
}

function title(value) {
  return String(value || "economy").replace(/_/g, " ").replace(/^./, char => char.toUpperCase());
}

function fromToolResult(raw) {
  let data;
  try { data = JSON.parse(String(raw || "")); } catch { return null; }
  if (!data?.scenario || !Array.isArray(data.commodities)) return null;
  const scenario = data.scenario;
  const lines = ["## Scenario Lab", ""];
  const shock = [
    scenario.demandPct ? `demand ${scenario.demandPct > 0 ? "+" : ""}${number(scenario.demandPct)}% per turn` : null,
    scenario.supplyPct ? `supply ${scenario.supplyPct > 0 ? "+" : ""}${number(scenario.supplyPct)}% per turn` : null,
  ].filter(Boolean).join("; ");
  lines.push(`Projected ${number(scenario.turns)} turns with ${shock}.`);
  lines.push("");
  for (const row of data.commodities.slice(0, 12)) {
    const sign = Number(row.changePct) > 0 ? "+" : "";
    lines.push(`- **${title(row.commodity)}:** ${number(row.startPrice)} to ${number(row.endPrice)} (${sign}${number(row.changePct)}%).`);
  }
  if (Number.isFinite(Number(data.startInflation)) && Number.isFinite(Number(data.endInflation))) {
    lines.push(`- **Inflation index:** ${number(data.startInflation)} to ${number(data.endInflation)}.`);
  }
  lines.push("");
  lines.push("> This is a directional projection calibrated to live prices, not the canonical turn engine. It isolates the stated shock and should not be read as an exact forecast of player actions or policy feedback.");
  const rows = (data.inflationTrajectory || []).map(point => ({
    label: `T${Number(point.turn)}`,
    value: Number(point.inflationIndex),
  })).filter(row => Number.isFinite(row.value));
  return {
    answer: lines.join("\n"),
    visualization: rows.length ? {
      recommended: "line",
      title: "Scenario inflation path",
      metric: "inflation_index",
      unit: "index",
      rows,
    } : null,
  };
}

async function retrieve({ question, callTool }) {
  const args = parse(question);
  if (!args) return { text: "", targeted: false, usedTools: [], visualizations: [] };
  const raw = await callTool("sim_economy_whatif", args, "worldsim").catch(() => null);
  const formatted = fromToolResult(raw);
  if (!formatted) {
    return {
      text: "SCENARIO LAB UNAVAILABLE: the directional simulator returned no usable projection.",
      targeted: true,
      usedTools: ["worldsim:sim_economy_whatif"],
      visualizations: [],
    };
  }
  return {
    text: `DIRECTIONAL SCENARIO RESULT:\n${String(raw).slice(0, 12000)}`,
    answerContract: formatted.answer,
    targeted: true,
    usedTools: ["worldsim:sim_economy_whatif"],
    visualizations: formatted.visualization ? [formatted.visualization] : [],
  };
}

module.exports = { parse, fromToolResult, retrieve };
