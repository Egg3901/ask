"use strict";

// The scout's tool playbook: one line per tool saying when to reach for it and
// the trap that burns people. The function-calling defs already describe what
// each tool RETURNS; this block encodes the judgment the defs cannot carry
// (which tool is authoritative, which key space it is keyed by, which lookup
// looks right but answers the wrong question). Curated by hand, like
// playbooks.js: methods survive balance patches, facts do not belong here.
//
// Lines stay under 140 characters so the whole block reads in about 30 lines
// and never crowds the evidence budget.

const LINES = {
  search_code: "First stop for any mechanic: semantic search over code, docs, and wiki. Rephrase once before concluding a miss.",
  grep_code: "Exact symbols, constants, and camelCase names semantic search missed. A miss here is strong absence evidence.",
  read_file: "The full indexed file once search_code or grep_code names the path. Never guess paths.",
  calculate: "Every derived number: growth, share, difference, per capita. Never do arithmetic in your head.",
  search_history: "When something changed, broke, or 'used to' work. Current code cannot date a change; the history can.",
  show_change: "Open one commit from search_history when you must say what a change did, not just that it happened.",
  list_capabilities: "The player asks what Ask, its API, or its tools can provide. Never infer the inventory from examples.",
  game_overview: "Current turn, era, and world basics. Cheap first call that anchors any live answer in time.",
  entity_search: "Resolve a fuzzy player, corporation, country, or state name to its exact id before deeper lookups.",
  countries: "Country list with economy, currency, and fx basics. The starting point for cross-country comparisons.",
  macro_history: "Macro trend series keyed by STATE or REGION, not country: resolve a country to its states first.",
  character_wealth_history: "Authoritative for wealth trends. The balance sheet is a cash snapshot and understates stockholders.",
  character_balance_sheet: "The asker's current cash and holdings snapshot. For any trend use character_wealth_history instead.",
  wars: "Public conflict tier only: no rosters or strength rankings exist here. Use the named ground winner, not your own math.",
  trace_corp: "One corporation's public record and timeline when the question names it.",
  trace_sector: "Sector stakes plus the public sector leader comparison: the peer baseline for corporation questions.",
  trace_race: "One specific race's tally and candidates, for a disputed or named contest.",
  trace_election: "A whole election cycle's structure and results across races; trace_race for one contest's detail.",
  trace_approval: "A politician's approval history over turns.",
  corporation_rankings: "The canonical ranked leaderboard of public corporations. Never hand-build a ranking from traces.",
  analytics_catalog: "Always read the catalog before analytics_query: it names the datasets, metrics, and valid dimensions.",
  analytics_query: "Aggregates, counts, and distributions, only after the catalog names the dataset and metric.",
  fx_quote: "One exchange pair with history. State the pair direction: an absurd level is usually the inverse quote.",
  map_snapshot: "Display-ready map data for a built-in stat, including the candidate roster filters.",
  geo_aggregate: "Region-keyed public aggregate for a map or comparison when no native map layer exists.",
  country_fiscal: "One country's budget: revenue, spending, debt.",
  legislation_catalog: "Bills and enacted law in a legislature.",
  elections: "The upcoming and recent elections overview; drop to trace_race for one contest.",
  top_players: "The public player leaderboard for rank and best-player questions.",
  parties: "Party list, leadership, and membership by country.",
  community_search: "Player norms, sentiment, and feature discussion from Discord. Lowest authority; never establishes a mechanic.",
};

/**
 * The "WHEN TO USE EACH TOOL" prompt section for the tools actually offered
 * this run. Order follows the offered list, unknown names are skipped, and an
 * empty result means no known tool was offered.
 */
function block(toolNames) {
  const seen = new Set();
  const lines = [];
  for (const raw of Array.isArray(toolNames) ? toolNames : []) {
    const name = String(raw || "");
    if (!LINES[name] || seen.has(name)) continue;
    seen.add(name);
    lines.push(`- ${name}: ${LINES[name]}`);
  }
  if (!lines.length) return "";
  return `WHEN TO USE EACH TOOL:\n${lines.join("\n")}`;
}

module.exports = { block, LINES };
