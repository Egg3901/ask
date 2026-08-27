"use strict";

// A deliberately small, inspectable request contract. It keeps retrieval,
// rendering, and answer validation on the same interpretation of a question.
const MAP = /\b(?:map|heatmap|choropleth)\b/i;
const CANDIDATES = /\b(?:candidate|candidates|filings?)\b/i;
const OFFICE = /\b(?:senate|house|governor|president)\b/i;
const FX = /\b(?:forex|fx|exchange rate|currency pair|[A-Z]{3}\s*(?:\/|to|vs\.?)\s*[A-Z]{3})\b/i;
const ELECTION_RULES = /\b(?:house|lower chamber|senate|district|constituen|seat|elected|election system)\b/i;
const ELECTION_QUESTION = /\b(?:can |how |which |what |one person|multiple|same party|at-large|single.member)\b/i;
const CORP = /\b(?:corporation|corp|company|public peer|peer(?:s)?|revenue per stake|valuation|valued|stock)\b/i;
const CORP_LEADERBOARD = /^(?=[\s\S]*\b(?:largest|biggest|top|rank|ranking|leaderboard)\b)(?=[\s\S]*\bpublic\b)(?=[\s\S]*\b(?:corporations?|corps?|companies|businesses)\b)[\s\S]*$/i;
const PLAYER_WEALTH = /\b(?:net[\s-]?worth|player wealth|wealth (?:distribution|inequality|gap|ranking)|inequality|richest|poorest|wealthiest|savings)\b/i;
const VISUAL = /\b(?:visuali[sz](?:e|ation)|chart|graph|diagram|plot|map|heatmap|choropleth)\b/i;

function create(question, context = {}) {
  const text = String(question || "").trim();
  const explicitVisual = VISUAL.test(text);
  const candidateMap = MAP.test(text) && CANDIDATES.test(text) && OFFICE.test(text);
  const map = MAP.test(text);
  const fx = FX.test(text);
  const electionRules = !map && ELECTION_RULES.test(text) && ELECTION_QUESTION.test(text);
  const corporationLeaderboard = !map && CORP_LEADERBOARD.test(text);
  const corporation = !map && CORP.test(text);

  if (candidateMap) return {
    id: "candidate-roster-map", intent: "candidate_roster", live: "required",
    display: { kind: "map", metric: "candidate_roster", canonical: true },
    visual: "required", suppressGenericCountryEconomy: true,
    status: "Checking public election filings…", context,
  };
  if (map) return {
    id: "live-map", intent: "geographic_comparison", live: "required",
    display: { kind: "map", metric: null, canonical: true },
    visual: "required", suppressGenericCountryEconomy: true,
    status: "Preparing the live game map…", context,
  };
  if (fx) return {
    id: "fx-quote", intent: "foreign_exchange", live: "required",
    display: { kind: "trend", metric: "exchange_rate", canonical: true },
    visual: explicitVisual ? "optional" : "none", suppressGenericCountryEconomy: true,
    status: "Checking the live exchange rate…", context,
  };
  if (electionRules) return {
    id: "election-rules", intent: "election_rules", live: "preferred",
    display: { kind: "prose", metric: null, canonical: false },
    visual: "none", suppressGenericCountryEconomy: true,
    status: "Checking the relevant election rules…", context,
  };
  if (corporationLeaderboard) return {
    id: "public-corporation-leaderboard", intent: "corporation_leaderboard", live: "required",
    display: {
      kind: "comparison",
      metric: /\b(?:liquid capital|cash)\b/i.test(text) ? "liquid_capital_anchor" : "market_cap_anchor",
      canonical: true,
    },
    visual: explicitVisual ? "required" : "optional", suppressGenericCountryEconomy: true,
    status: "Ranking public corporations using live exchange data…", context,
  };
  if (corporation) return {
    id: "public-corporation", intent: "corporation_analysis", live: "preferred",
    display: { kind: "comparison", metric: null, canonical: false },
    visual: explicitVisual ? "optional" : "none", suppressGenericCountryEconomy: false,
    status: "Checking public corporation data…", context,
  };
  if (!map && PLAYER_WEALTH.test(text)) return {
    id: "player-wealth", intent: "player_wealth", live: "required",
    display: { kind: "comparison", metric: "player_net_worth", canonical: false },
    visual: explicitVisual ? "required" : "optional", suppressGenericCountryEconomy: true,
    status: "Reading live player wealth…", context,
  };
  return {
    id: "general", intent: "general", live: "preferred",
    display: { kind: "prose", metric: null, canonical: false },
    visual: explicitVisual ? "optional" : "none", suppressGenericCountryEconomy: false,
    status: "Checking the relevant game information…", context,
  };
}

module.exports = { create };
