"use strict";

// Read-only MCP transport adapters for the live-intelligence module.
const intelligence = require("./live-intelligence");

const TOKEN = process.env.MCP_TOKEN || "";
const URLS = {
  gamestate: process.env.MCP_GAMESTATE_URL || "http://127.0.0.1:9730/mcp",
  engine: process.env.MCP_ENGINE_URL || "http://127.0.0.1:9731/mcp",
};

async function callServer(server, name, args = {}, timeoutMs = 25000, preserveToolError = false) {
  const endpoint = URLS[server] || URLS.gamestate;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  const frame = raw.split("\n").find(line => line.startsWith("data:"));
  const parsed = JSON.parse(frame ? frame.slice(5).trim() : raw);
  const content = parsed?.result?.content;
  const text = Array.isArray(content) ? content.map(item => item.text || "").join("\n") : "";
  if (!response.ok || parsed?.error || !text) return null;
  // Rust MCP tools mark expected, user-facing lookup misses as `isError`; the
  // message itself is deliberately plain text rather than an "MCP error" blob.
  // Keep it only for callers that can explain that precise miss to the player.
  if (parsed?.result?.isError === true || /MCP error/i.test(text)) {
    return preserveToolError ? `MCP error: ${text.replace(/^MCP error:\s*/i, "")}` : null;
  }
  return text;
}

async function call(name, args = {}, timeoutMs = 25000) {
  return callServer("gamestate", name, args, timeoutMs);
}

// Tool inventory, cached. The investigator builds its function-calling defs
// from the server's own schemas so a gamestate tool change never needs a
// hand-edited copy here.
let _tools = null, _toolsAt = 0;
async function listTools(server = "gamestate") {
  if (_tools && Date.now() - _toolsAt < 600000) return _tools;
  const endpoint = URLS[server] || URLS.gamestate;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    signal: AbortSignal.timeout(10000),
  });
  const raw = await response.text();
  const frame = raw.split("\n").find(line => line.startsWith("data:"));
  const parsed = JSON.parse(frame ? frame.slice(5).trim() : raw);
  const tools = parsed?.result?.tools;
  if (!Array.isArray(tools)) return null;
  _tools = tools; _toolsAt = Date.now();
  return _tools;
}

const WANTS_STATE = /\b(right now|currently|current|my |mine|our |latest|this turn|per turn|a turn|why did|why is|compare|comparison|peer|benchmark|rank|largest public (?:companies|corporations|businesses)|how much do i|how much am i|what happened|valued|valuation|market cap|balance sheet|economy|gdp|inflation|unemployment|exchange rate|forex|currency|public corporations?|stock market|election|poll|supply|demand|map|heatmap|choropleth|regional|active players?|online players?|player counts?|net[\s-]?worth|wealth|savings|income|earnings|holdings|inequality|richest|poorest|wealthiest|campaign funds?)\b/i;
const REQUIRED_LIVE_CANDIDATE_MAP = /^(?=.*\b(?:map|heatmap|choropleth)\b)(?=.*\b(?:candidate|candidates|filings?)\b)(?=.*\b(?:senate|house|governor|president)\b)[\s\S]*$/i;

function looksLive(question) {
  return WANTS_STATE.test(question || "");
}

// A map of a current election roster has no useful code-only answer. Make this
// narrow class live by default so a player cannot accidentally receive rules
// prose merely because their local live-data switch is off.
function requiresLive(question) {
  return REQUIRED_LIVE_CANDIDATE_MAP.test(question || "");
}

async function liveIntelligence(question, context, callTool = null, plan = null, onAction = null) {
  const base = callTool
    ? (name, args, server) => callTool(name, args, server)
    : (name, args, server, preserveToolError) => callServer(server, name, args, 25000, preserveToolError);
  // Announce each tool call as it fires, so the UI can show the live action log.
  // Wrapping is transparent: onAction never changes the call or its result.
  const adapter = onAction
    ? (name, args, server, pte) => { try { onAction(name, args); } catch {} return base(name, args, server, pte); }
    : base;
  return intelligence.retrieve({ question, context, callTool: adapter, plan });
}

async function liveContext(question, context, callTool = null) {
  return (await liveIntelligence(question, context, callTool)).text;
}

module.exports = {
  listTools,
  liveContext,
  liveIntelligence,
  looksLive,
  requiresLive,
  namedCorporation: intelligence.namedCorporation,
  namedCorporations: intelligence.namedCorporations,
  namedSectorType: intelligence.namedSectorType,
  namedFxPair: intelligence.namedFxPair,
  call,
  callServer,
};
