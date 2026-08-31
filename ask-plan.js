"use strict";

const capabilities = require("./capabilities");

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
// "Which corporations should I buy" is an ordinary question about a game's
// public stock exchange, and it must reach the live exchange data or the answer
// is a lecture about how to read the stock list. Deliberately requires an equity
// context so "buy a plant for my corporation" stays a build question.
const CORP_INVESTMENT = /\b(?:(?:which|what)\s+(?:\w+\s+){0,3}(?:corporations?|corps?|companies|stocks?|shares?)\b[\s\S]{0,60}\b(?:buy|purchase|invest|acquire|own)|(?:corporations?|corps?|companies|stocks?|shares?)\s+(?:\w+\s+){0,4}?(?:to|should\s+i|i\s+should)\s+(?:buy|purchase|invest|acquire|own)|(?:buy|buying|purchase|purchasing|invest(?:ing)?)\s+(?:in\s+)?(?:\w+\s+){0,3}\b(?:shares?|stocks?|equity|stake)\b|\b(?:good|smart|worth|bad|solid|safe)\s+(?:buy|investment|purchase|pick)\b|\bshares?\s+available\b|\bwhat\s+(?:should|do)\s+i\s+invest\b|\b(?:stock|investment)\s+(?:tips?|picks?|advice|recommendations?)\b)/i;
const PLAYER_WEALTH = /\b(?:net[\s-]?worth|player wealth|wealth (?:distribution|inequality|gap|ranking)|inequality|richest|poorest|wealthiest|savings|my (?:money|cash|wealth|holdings|balance|assets|portfolio)|how much (?:am i worth|money do i have|do i have)|rich(?:er)?(?: am i| than| are (?:we|players|the players)))\b/i;
const FISCAL = /\b(?:budget|deficit|surplus|fiscal|debt[\s-]?to[\s-]?gdp|national debt|credit rating|government spending|govt spending|tax revenue|(?:pushing|driving|fueling|behind|causing|lower|lowering|reduce|reducing|cut|curb|bring down|slow) (?:[a-z]{2,}\s+){0,3}inflation|inflation (?:fastest|faster|down|lower))\b/i;
const ESTIMATION = /\b(?:how much would|how much does it cost|what would it cost|how expensive|how long until|how long would|how many turns|what would happen if|what happens if|what would .{0,40} do to)\b/i;
const VISUAL = /\b(?:visuali[sz](?:e|ation)|chart|graph|diagram|plot|map|heatmap|choropleth)\b/i;
const SHOWCASE_VISUAL = /(?=[\s\S]*\b(?:visuali[sz](?:e|ation)|chart|graph|plot|map)\b)(?=[\s\S]*\b(?:interesting|surprising|insightful|showcase|anything|something)\b)/i;

function create(question, context = {}) {
  const text = String(question || "").trim();
  const explicitVisual = VISUAL.test(text);
  const capability = capabilities.classify(text);
  const candidateMap = MAP.test(text) && CANDIDATES.test(text) && OFFICE.test(text);
  const map = MAP.test(text);
  const fx = FX.test(text);
  const electionRules = !map && ELECTION_RULES.test(text) && ELECTION_QUESTION.test(text);
  const corporationLeaderboard = !map && CORP_LEADERBOARD.test(text);
  const corporationInvestment = !map && CORP_INVESTMENT.test(text);
  const corporation = !map && CORP.test(text);

  if (capability?.intent === "scenario_lab") return {
    id: capability.id, intent: capability.intent, live: "required",
    display: { kind: "trend", metric: "inflation_index", canonical: true },
    visual: explicitVisual ? "required" : "none", suppressGenericCountryEconomy: true,
    status: "Running a live-calibrated directional scenario…", context,
  };
  if (capability?.intent === "causal_autopsy") return {
    id: capability.id, intent: capability.intent,
    live: /\b(?:current|currently|right now|my|our|this turn|recent)\b/i.test(text) ? "required" : "preferred",
    display: { kind: "prose", metric: null, canonical: false },
    visual: explicitVisual ? "optional" : "none", suppressGenericCountryEconomy: false,
    status: "Tracing live state through rules and shipped changes…", context,
  };
  if (capability?.intent === "claim_verification") return {
    id: capability.id, intent: capability.intent, live: "preferred",
    display: { kind: "prose", metric: null, canonical: false },
    visual: "none", suppressGenericCountryEconomy: false,
    status: "Verifying each claim against the game…", context,
  };
  if (capability?.intent === "army_logistics") return {
    id: capability.id, intent: capability.intent, live: "none",
    display: { kind: "prose", metric: null, canonical: false },
    visual: "none", suppressGenericCountryEconomy: true,
    status: "Reading the battlefield supply rules…", context,
  };

  if (candidateMap) return {
    id: "candidate-roster-map", intent: "candidate_roster", live: "required",
    display: { kind: "map", metric: "candidate_roster", canonical: true },
    visual: "required", suppressGenericCountryEconomy: true,
    status: "Checking public election filings…", context,
  };
  if (SHOWCASE_VISUAL.test(text)) return {
    id: "live-showcase", intent: "live_showcase", live: "required",
    display: { kind: "map", metric: null, canonical: true },
    visual: "required", suppressGenericCountryEconomy: true,
    status: "Finding an interesting live pattern…", context,
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
  if (corporationInvestment) return {
    id: "public-corporation-investment", intent: "corporation_investment", live: "required",
    display: { kind: "comparison", metric: "market_cap_anchor", canonical: true },
    // A buy question wants named companies and figures, not a chart. The chart
    // only appears if the player actually asked for one.
    visual: explicitVisual ? "required" : "none", suppressGenericCountryEconomy: true,
    status: "Reading the public exchange…", context,
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
  if (ESTIMATION.test(text)) return {
    id: "estimation", intent: "estimation", live: "preferred",
    display: { kind: "prose", metric: null, canonical: false },
    visual: explicitVisual ? "optional" : "none", suppressGenericCountryEconomy: false,
    status: "Estimating from the formula and current values…", context,
  };
  if (!map && FISCAL.test(text)) return {
    id: "country-fiscal", intent: "country_fiscal", live: "preferred",
    display: { kind: "prose", metric: null, canonical: false },
    visual: explicitVisual ? "optional" : "none", suppressGenericCountryEconomy: true,
    status: "Reading the live fiscal position…", context,
  };
  return {
    id: "general", intent: "general", live: "preferred",
    display: { kind: "prose", metric: null, canonical: false },
    visual: explicitVisual ? "optional" : "none", suppressGenericCountryEconomy: false,
    status: "Checking the relevant game information…", context,
  };
}

module.exports = { create };
