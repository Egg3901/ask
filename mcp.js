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

const WANTS_STATE = /\b(right now|currently|current|my |mine|our |latest|this turn|per turn|a turn|why did|why is|compare|comparison|peer|benchmark|rank|largest public (?:companies|corporations|businesses)|how much do i|how much am i|what happened|valued|valuation|market cap|balance sheet|economy|gdp|inflation|unemployment|exchange rate|forex|currency|public corporations?|stock market|election|poll|supply|demand|map|heatmap|choropleth|regional|active players?|online players?|player counts?|net[\s-]?worth|wealth|savings|income|earnings|holdings|inequality|richest|poorest|wealthiest|campaign funds?|wars?|battle|front line|invasion|casualt(?:y|ies)|cold war|tension)\b/i;
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

// A context-aware "answer with live data" suggestion for a code-only answer
// that could be sharper with the live pass. Returns null when there's nothing
// worth offering. The label is tuned to the plan intent so the chip reads
// "See your live net worth" instead of a generic prompt.
const HINT_BY_INTENT = {
  player_wealth: { label: "See your live net worth", note: "Your live savings, holdings, and rank." },
  country_fiscal: { label: "See the live fiscal numbers", note: "Live revenue, spending, debt, and inflation." },
  corporation_leaderboard: { label: "See the live ranking", note: "Ranked from live exchange data." },
  corporation_analysis: { label: "Answer with live corporation data", note: "Your corporation's current state." },
  foreign_exchange: { label: "See the live rate", note: "The current quote and recent history." },
  estimation: { label: "Estimate with live values", note: "Plug in your current game numbers." },
};
function liveHintFor(plan, question) {
  if (!plan || plan.live === "none") return null;
  if (!looksLive(question) && !HINT_BY_INTENT[plan.intent]) return null;
  const preset = HINT_BY_INTENT[plan.intent];
  return {
    available: true,
    intent: plan.intent || "general",
    label: preset?.label || "Answer with live game data",
    note: preset?.note || "Looks like a question about your current game.",
  };
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

// ── Live-data provenance ────────────────────────────────────────────────────
// The evidence log records raw tool ids like "gamestate:trace_corp", with the
// namespace, duplicates, and code-search calls all mixed in. A player reading
// "what was this answer built from" needs the live READS named in their own
// vocabulary, and needs them kept distinct from the code and docs the citations
// already cover.

// Calls that search the repository rather than read the running world. They are
// already represented by the file citations, so listing them again as "live
// data" would overstate what the answer actually saw.
const CODE_TOOLS = new Set(["search_code", "search_history", "show_change", "read_file", "list_files", "grep"]);

const LIVE_LABELS = {
  game_overview: "Game overview",
  countries: "Countries",
  country_fiscal: "Country finances",
  parties: "Parties",
  elections: "Elections",
  top_players: "Top players",
  macro_history: "Economic history",
  wars: "Wars and fronts",
  entity_search: "Entity lookup",
  corporation_rankings: "Corporation rankings",
  extraction_market: "Extraction market",
  fx_quote: "Exchange rates",
  geo_aggregate: "Regional aggregates",
  legislation_catalog: "Legislation",
  map_snapshot: "Map snapshot",
  analytics_query: "Analytics",
  analytics_catalog: "Analytics",
  election_sim_results: "Election projections",
  economy_pulse: "Economy pulse",
  engine_health: "Engine health",
  recent_turns: "Recent turns",
  trace_corp: "Corporation detail",
  trace_sector: "Sector detail",
  trace_character: "Character detail",
  trace_election: "Election detail",
  trace_race: "Race detail",
  trace_ledger: "Ledger",
  trace_account: "Account history",
  trace_bonds: "Bond market",
  trace_actions: "Action history",
  trace_approval: "Approval history",
  character_balance_sheet: "Balance sheet",
  character_wealth_history: "Wealth history",
  country_groups: "Country groups",
};

/**
 * Clean, deduplicated list of the live game data an answer actually read.
 * Order is preserved (first read first) because it reflects how the answer was
 * assembled. Unknown tools fall back to a de-underscored name rather than being
 * dropped: a source we cannot label is still a source that was used.
 */
function liveSources(tools = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(tools) ? tools : []) {
    const name = String(raw || "").split(":").pop().trim();
    if (!name || CODE_TOOLS.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({
      id: name,
      label: LIVE_LABELS[name] || name.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()),
    });
  }
  return out;
}

module.exports = {
  listTools,
  liveSources,
  LIVE_LABELS,
  liveContext,
  liveIntelligence,
  looksLive,
  requiresLive,
  liveHintFor,
  namedCorporation: intelligence.namedCorporation,
  namedCorporations: intelligence.namedCorporations,
  namedSectorType: intelligence.namedSectorType,
  namedFxPair: intelligence.namedFxPair,
  call,
  callServer,
};
