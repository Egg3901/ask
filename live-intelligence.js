"use strict";

// A deep live-intelligence module. Callers provide one read-only MCP adapter and
// receive one compact prompt block. Entity resolution, dependent lookups,
// player context, peer inference, FX-aware summaries, and chart data stay here.

const analyticsPlanner = require("./analytics-planner");

const SECTOR_TYPES = [
  "financial", "media", "manufacturing", "chemical_industries", "healthcare",
  "retail", "automobiles", "technology", "energy", "agriculture", "real_estate",
  "construction", "defense", "telecommunications", "entertainment", "logistics", "extraction",
];

const CORP_WORDS = /\b(corp|corporation|company|business|share|revenue|profit|money|cash|sector|market|dividend|earnings|income|valuation|stock)\b/i;
const COUNTRY_WORDS = /\b(country|countries|economy|gdp|inflation|unemployment|population|exchange rate|currency|forex|macro|map|regional|region|state)\b/i;
const PEER_WORDS = /\b(compare|comparison|versus|vs\.?|peer|relative|rank|benchmark|better|worse|outperform|underperform|leader)\b/i;
const MARKET_WORDS = /\b(market|price|commodity|supply|demand|extraction|resource|shortage)\b/i;
const ELECTION_WORDS = /\b(election|vote|poll|race|campaign|seat)\b/i;
const LEGISLATION_WORDS = /\b(bill|bills|legislation|legislative|law|laws|statute|propose (?:a )?(?:bill|law)|what can i propose|on the floor|enacted|pending law)\b/i;
const FX_CODES = "NGN|USD|GBP|JPY|EUR|IEP|CNY|BRL|SUR|DDM|FRF|ITL|ESP|SEK|TRL|GRD|ATS|FIM";
const COUNTRY_IDS = {
  "united states": "US", america: "US", us: "US", usa: "US",
  "united kingdom": "UK", britain: "UK", uk: "UK", germany: "DE", japan: "JP",
  ireland: "IE", brazil: "BR", china: "CN", nigeria: "NG", hungary: "HU",
  poland: "PL", romania: "RO", yugoslavia: "YU", bulgaria: "BG", belarus: "BLR",
  ukraine: "UKR", czechoslovakia: "CS", russia: "RU", france: "FR", italy: "IT",
  spain: "ES", sweden: "SE", turkey: "TR", greece: "GR", austria: "AT",
  finland: "FI", "east germany": "DD", baltics: "BAL",
};
const MAP_WORDS = /\b(map|heatmap|choropleth|geographic|geography|across (?:the )?(?:world|country|countries|states|regions)|by (?:country|state|region))\b/i;
const ANALYTICS_WORDS = /\b(?:map|heatmap|choropleth|visuali[sz](?:e|ation)|chart|graph|plot|rank|ranking|compare|comparison|trend|distribution|breakdown)\b/i;

function namedCountryId(question, fallback = null) {
  const text = String(question || "").toLowerCase();
  const names = Object.keys(COUNTRY_IDS).sort((a, b) => b.length - a.length);
  const match = names.find(name => new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(text));
  if (match) return COUNTRY_IDS[match];
  const inherited = String(fallback || "").trim();
  return COUNTRY_IDS[inherited.toLowerCase()] || (/^[A-Za-z]{2,3}$/.test(inherited) ? inherited.toUpperCase() : null);
}

function mapMetric(question, scope) {
  const text = String(question || "");
  if (/population/i.test(text)) return "population";
  if (scope === "world") {
    if (/unemployment/i.test(text)) return "unemployment_rate";
    if (/inflation/i.test(text)) return "inflation_rate";
    if (/poverty/i.test(text)) return "poverty_rate";
    if (/cost of living/i.test(text)) return "cost_of_living";
    if (/median income|income/i.test(text)) return "median_income_anchor";
    if (/debt.{0,8}gdp/i.test(text)) return "debt_to_gdp_ratio";
    if (/wage growth/i.test(text)) return "wage_growth";
    if (/trade growth/i.test(text)) return "trade_growth";
    if (/prime rate|interest rate/i.test(text)) return "prime_rate";
    if (/players?/i.test(text)) return "players";
    if (/parties/i.test(text)) return "parties";
    if (/gdp|growth/i.test(text)) return "gdp_growth";
    return null;
  }
  if (/\b(candidate|candidates|who(?:'s| is) running|filings?)\b/i.test(text)
      && /\b(senate|house|governor|president)\b/i.test(text)) return "candidate_roster";
  if (/approval/i.test(text)) return "approval";
  if (/economic lean/i.test(text)) return "economic_lean";
  if (/social lean/i.test(text)) return "social_lean";
  if (/lean|ideolog/i.test(text)) return "lean";
  if (/party org|organization/i.test(text)) return "party_org";
  if (/house/i.test(text)) return "house";
  if (/senate/i.test(text)) return "senate";
  if (/governor/i.test(text)) return "governor";
  if (/president|electoral/i.test(text)) return "presidential";
  if (/speciali[sz]ation|primary sector|sector bonus/i.test(text)) return "sector_specialization";
  return null;
}

// The map service owns native game layers. This registry instead names safe
// geographic aggregations that can be synthesized from public live records.
// Every entry uses the same geo_aggregate contract, rather than introducing a
// bespoke retrieval path for each new question type.
function geoAggregateMetric(question) {
  const text = String(question || "");
  if (!/\b(?:player|players?|character|characters?)\b/i.test(text)) return null;
  if (/\b(?:active|online|last activity|within\s+\d+\s*(?:hour|hr))/i.test(text)) return "active_player_count";
  if (/\b(?:net worth|wealth|richest)\b/i.test(text)) return "player_net_worth_anchor";
  if (/\b(?:campaign funds?|campaign cash)\b/i.test(text)) return "player_campaign_funds";
  if (/\b(?:count|number|how many)\b/i.test(text)) return "player_count";
  return null;
}

function activeWindowHours(question) {
  const match = String(question || "").match(/\b(?:within|last)\s+(\d{1,3})\s*(?:hours?|hrs?)\b/i);
  return match ? Math.max(1, Math.min(168, Number(match[1]))) : 24;
}

function requestedRankingLimit(question) {
  const match = String(question || "").match(/\b(\d{1,2})\b/);
  return match ? Math.max(1, Math.min(25, Number(match[1]))) : 10;
}

function candidateMapFilters(question) {
  const text = String(question || "");
  const electionType = /\bsenate\b/i.test(text) ? "senate"
    : /\bhouse\b/i.test(text) ? "house"
      : /\bgovernor\b/i.test(text) ? "governor"
        : /\bpresident(?:ial)?\b/i.test(text) ? "president" : null;
  const classMatch = text.match(/\bsenate\s*(?:class\s*)?([123])\b/i)
    || text.match(/\bclass\s*([123])\s*(?:senate)?\b/i);
  const party = /\b(gop|republican(?:s| party)?)\b/i.test(text) ? "GOP"
    : /\b(democrat(?:s|ic|ic party)?|dems?)\b/i.test(text) ? "Democrat" : null;
  const playersOnly = /\b(?:real|human|player)[ -]?(?:players?|candidates?)\s+only\b|\breal\s+players?\b/i.test(text);
  return {
    ...(electionType ? { electionType } : {}),
    ...(classMatch ? { senateClass: Number(classMatch[1]) } : {}),
    ...(party ? { party } : {}),
    ...(playersOnly ? { playersOnly: true } : {}),
  };
}

function namedFxPair(question) {
  const text = String(question || "").toUpperCase();
  const direct = text.match(new RegExp(`\\b(${FX_CODES})\\s*(?:/|TO|VS\\.?|VERSUS|AGAINST|-)\\s*(${FX_CODES})\\b`));
  if (direct) return { base: direct[1], quote: direct[2] };
  const aliases = [
    ["POUND", "GBP"], ["STERLING", "GBP"], ["DOLLAR", "USD"],
    ["EURO", "EUR"], ["YEN", "JPY"], ["YUAN", "CNY"],
  ];
  const expanded = aliases.reduce((value, [word, code]) => value.replace(new RegExp(`\\b${word}S?\\b`, "g"), code), text);
  const named = expanded.match(new RegExp(`\\b(${FX_CODES})\\s*(?:/|TO|VS\\.?|VERSUS|AGAINST|-)\\s*(${FX_CODES})\\b`));
  return named ? { base: named[1], quote: named[2] } : null;
}

function cleanCorporationName(value) {
  const name = String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+(?:corporation|corp|company)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 80) return null;
  if (/^(?:my|mine|our|another|a private|the private|its public peers?|their public peers?|public peers?)$/i.test(name)) return null;
  return name;
}

function splitCorporationNames(value) {
  const names = String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s*,\s*|\s+and\s+/i)
    .map(cleanCorporationName)
    .filter(Boolean);
  return [...new Set(names)].slice(0, 5);
}

function namedCorporations(question) {
  const text = String(question || "").trim();
  const eventMatch = text.match(
    /\b(?:what (?:did )?happen(?:ed)? to|what(?:'s| is) (?:going on|up) with|tell me about)\s+(.+?)(?:\s+(?:corporation|corp|company))?(?:[?.!]|$)/i,
  );
  if (eventMatch) {
    const names = splitCorporationNames(eventMatch[1]);
    const remainder = text.slice((eventMatch.index || 0) + eventMatch[0].length);
    const companion = remainder.match(/\b(?:with|versus|vs\.?)\s+(.+?)(?:[?.!]|$)/i);
    if (companion) names.push(...splitCorporationNames(companion[1]));
    if (names.length) return [...new Set(names)].slice(0, 5);
  }
  const peerMatch = text.match(
    /\b(?:compare|comparison of)\s+(.+?)\s+(?:with|to|against|versus|vs\.?)\s+(?:its|their)\s+(?:public\s+)?peers\b/i,
  );
  if (peerMatch) return splitCorporationNames(peerMatch[1]);

  const patterns = [
    /\bwhy\s+(?:is|are)\s+(.+?)\s+(?:valued|worth|performing|doing)\b/i,
    /\b(?:compare|comparison of)\s+(.+?)\s+(?:with|to|against|versus|vs\.?)\s+(.+?)(?:[?.!]|$)/i,
    /\b(?:balance sheet|financials|valuation|market cap)\s+(?:of|for)\s+(?:the\s+)?(.+?)(?:\s+corporation)?[?.!]*$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const names = match.slice(1).flatMap(splitCorporationNames);
    if (names.length) return [...new Set(names)].slice(0, 5);
  }
  return [];
}

function comparableCorporationName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\s*the\s+/, "")
    .replace(/\s+(?:corporation|corp|company)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namedCorporation(question) {
  return namedCorporations(question)[0] || null;
}

function namedSectorType(question) {
  const text = String(question || "").toLowerCase();
  return SECTOR_TYPES.find(type => {
    const words = type.split("_").join("[\\s_-]+");
    return new RegExp(`\\b${words}\\b`).test(text);
  }) || null;
}

function namedSectorState(question, sectorType) {
  if (!sectorType) return null;
  const sectorWords = sectorType.replace(/_/g, "[\\s_-]+");
  const match = String(question || "").match(new RegExp(`\\b(?:my|the|in)\\s+([a-z][a-z .'-]{1,50}?)\\s+${sectorWords}\\s+sector\\b`, "i"));
  if (!match) return null;
  const candidate = match[1].replace(/\s+/g, " ").trim();
  if (/^(?:corporation'?s?|company'?s?|current|own|public|private)$/i.test(candidate)) return null;
  return candidate;
}

function payload(result) {
  try { return JSON.parse(result); } catch { return null; }
}

function cap(value, limit = 2500) {
  return String(value || "").slice(0, limit);
}

function asJson(value) {
  return JSON.stringify(value, null, 2);
}

// Minimum entity_search score we will act on. Below this the match is a guess,
// and guessing which corporation a player meant is how you answer about someone
// else's company.
const ENTITY_MATCH_FLOOR = 0.55;
// Two candidates this close in score are a genuine ambiguity, not a winner.
const ENTITY_TIE_EPSILON = 0.02;

/**
 * Resolve a player's informal corporation name to a canonical one.
 *
 * Players type "Tinky corp", "doofenschmirtsevil incorpirated", "meyer corp".
 * The old approach asked trace_corp for the raw string and then for
 * `${raw} Corporation`, which resolves none of those: it told players the
 * largest public corporation in the game "could not be found". entity_search
 * does fuzzy matching server-side and gets "Tinky corp" to "Tinky Winky
 * Corporation" at 0.915 in a single call.
 *
 * Returns `ambiguous` with the candidates when two names score within an
 * epsilon of each other, so the writer asks which one rather than picking.
 */
async function resolveCorporation(name, callTool) {
  const found = payload(await callTool("entity_search", {
    query: name, types: ["corporation"], limit: 5,
  }, "gamestate").catch(() => null));

  const matches = (Array.isArray(found?.results) ? found.results : [])
    .filter(r => r?.type === "corporation" && Number(r.score) >= ENTITY_MATCH_FLOOR)
    .sort((a, b) => Number(b.score) - Number(a.score));

  if (matches.length) {
    const top = matches[0];
    const tied = matches.filter(r => Number(top.score) - Number(r.score) <= ENTITY_TIE_EPSILON);
    // A public corporation is the one a player asking a loose question almost
    // always means; only treat it as ambiguous if the tie is between peers of
    // the same visibility.
    const publicTied = tied.filter(r => r.public);
    const pick = publicTied.length === 1 ? publicTied[0] : tied.length > 1 ? null : top;

    if (!pick) {
      return {
        requested: name, resolved: null, ambiguous: tied.map(r => r.name),
        result: null, data: null,
      };
    }
    const result = await callTool("trace_corp", { corporation: pick.name }, "gamestate").catch(() => null);
    const data = payload(result);
    if (result && !data?.error) {
      return { requested: name, resolved: data?.corporation?.name || pick.name, result, data };
    }
  }

  // entity_search found nothing usable. Fall back to the literal lookups so a
  // name it does not index still has a chance.
  const variants = [name];
  if (!/\b(?:corporation|corp|company)$/i.test(name)) variants.push(`${name} Corporation`);
  let failure = null;
  for (const corporation of variants) {
    const result = await callTool("trace_corp", { corporation }, "gamestate").catch(() => null);
    const data = payload(result);
    if (result && !data?.error) {
      return { requested: name, resolved: data?.corporation?.name || corporation, result, data };
    }
    if (result) failure = result;
  }
  return { requested: name, resolved: name, result: failure, data: payload(failure) };
}

function sectorSummary(raw) {
  const data = payload(raw);
  const stakes = Array.isArray(data?.currentStakes) ? data.currentStakes : [];
  if (!data || !stakes.length) return raw;
  const bySector = {};
  for (const stake of stakes) {
    const sector = stake.sector || "unknown";
    const row = bySector[sector] || (bySector[sector] = { stakes: 0, revenueAnchor: 0, averageSharePct: 0, shareRows: 0 });
    row.stakes += 1;
    row.revenueAnchor += Number(stake.revenueAnchor || 0);
    if (Number.isFinite(Number(stake.sharePct))) {
      row.averageSharePct += Number(stake.sharePct);
      row.shareRows += 1;
    }
  }
  for (const row of Object.values(bySector)) {
    row.revenueAnchor = Math.round(row.revenueAnchor * 100) / 100;
    row.averageSharePct = row.shareRows ? Math.round((row.averageSharePct / row.shareRows) * 100) / 100 : null;
    delete row.shareRows;
  }
  return asJson({
    corporation: data.corporation,
    fx: data.fx,
    summaryBySector: bySector,
    sectorCountTrend: data.sectorCountTrend,
    sectorLosses: data.sectorLosses,
    strongestStakes: stakes.slice(0, 8),
  });
}

function dominantSector(raw) {
  const data = payload(raw);
  const totals = new Map();
  for (const stake of data?.currentStakes || []) {
    if (!stake.sector) continue;
    const value = Number(stake.revenueAnchor ?? stake.revenue ?? 0);
    totals.set(stake.sector, (totals.get(stake.sector) || 0) + (Number.isFinite(value) ? value : 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function targetSectorRow(name, raw, sectorType) {
  const data = payload(raw);
  const stakes = (data?.currentStakes || []).filter(stake => stake.sector === sectorType);
  if (!stakes.length) return null;
  return {
    name,
    stakes: stakes.length,
    revenueAnchor: Math.round(stakes.reduce((sum, stake) => sum + Number(stake.revenueAnchor || 0), 0) * 100) / 100,
  };
}

function comparisonVisualization(title, comparisonRaw, target = null) {
  const comparison = payload(comparisonRaw)?.sectorComparison;
  if (!comparison) return null;
  const rows = (comparison.leaders || []).slice(0, 8).map(row => ({
    label: row.name,
    value: Number(row.revenueAnchor || 0),
    stakes: Number(row.stakes || 0),
  }));
  if (target && !rows.some(row => row.label.toLowerCase() === target.name.toLowerCase())) {
    rows.push({ label: target.name, value: target.revenueAnchor, stakes: target.stakes });
  }
  return {
    recommended: "bar",
    title,
    metric: "revenueAnchor",
    unit: "anchor",
    source: "live exchangeRates-normalized MCP data",
    rows,
  };
}

function marketVisualization(raw) {
  const data = payload(raw);
  const rows = (data?.perResource || []).slice(0, 12).map(row => ({
    label: row.resource,
    supply: Number(row.supply || 0),
    demand: Number(row.demand || 0),
  }));
  return rows.length ? { recommended: "grouped_bar", title: "Live resource supply and demand", unit: "units", rows } : null;
}

function electionVisualization(raw) {
  const data = payload(raw);
  const list = Array.isArray(data) ? data : data?.elections;
  const rows = (list || []).filter(row => Number.isFinite(Number(row.totalSeats))).slice(0, 12)
    .map(row => ({ label: `${row.countryId || ""} ${row.electionType || row.state || "election"}`.trim(), value: Number(row.totalSeats) }));
  return rows.length ? { recommended: "bar", title: "Live elections by seats", unit: "seats", rows } : null;
}

function countryVisualization(raw, question) {
  const countries = payload(raw);
  if (!Array.isArray(countries)) return null;
  const text = String(question || "");
  const choice = /inflation/i.test(text) ? ["inflationRate", "inflation rate", "percent"]
    : /unemployment/i.test(text) ? ["unemploymentRate", "unemployment rate", "percent"]
      : /income/i.test(text) ? ["medianIncomeAnchor", "median income", "anchor"]
        : /poverty/i.test(text) ? ["povertyRate", "poverty rate", "percent"]
          : /cost of living/i.test(text) ? ["costOfLiving", "cost of living index", "index"]
            : /population/i.test(text) ? ["population", "population", "people"]
              : ["gdpGrowth", "GDP growth", "percent"];
  const [metric, label, unit] = choice;
  const rows = countries.map(country => ({
    label: country.countryId,
    value: Number(metric === "population" ? country.population : country.economy?.[metric]),
  })).filter(row => row.label && Number.isFinite(row.value));
  if (!rows.length) return null;
  return {
    recommended: "bar",
    title: `Live country ${label} comparison`,
    metric,
    unit,
    focusCountry: null,
    rows: rows.sort((a, b) => b.value - a.value),
  };
}

function fxVisualization(raw) {
  const data = payload(raw);
  if (!data?.pair || !Array.isArray(data.history)) return null;
  const metric = data.chart?.metric || `${data.current?.quoteCurrency || "quote"} per ${data.current?.baseCurrency || "base"}`;
  const rows = data.history.slice(-20).map(point => ({
    label: `T${point.turn}`,
    value: Number(point.quotePerBase),
  })).filter(row => Number.isFinite(row.value));
  return rows.length ? {
    recommended: "line",
    title: `${data.pair} exchange rate`,
    metric,
    unit: metric,
    rows,
  } : null;
}

async function retrieve({ question, context = {}, callTool, plan = null }) {
  const text = String(question || "");
  const parts = [];
  const visualizations = [];
  const usedTools = [];
  const candidateMapRequested = plan?.intent === "candidate_roster" || mapMetric(text, "country") === "candidate_roster";
  const aggregateMapRequested = MAP_WORDS.test(text) && Boolean(geoAggregateMetric(text));
  // A "which corporations should I buy" question needs the same live exchange
  // ranking a leaderboard question does. Without it the answer is a lecture on
  // how to read the stock list instead of named companies with figures.
  const corporationLeaderboardRequested = plan?.intent === "corporation_leaderboard"
    || plan?.intent === "corporation_investment";
  const call = async (name, args = {}, server = "gamestate", preserveToolError = false) => {
    usedTools.push(`${server}:${name}`);
    return callTool(name, args, server, preserveToolError).catch(() => null);
  };

  const focusCountry = context?.character?.country || context?.country || null;
  let handledAnalyticsDataset = null;
  const overview = await call("game_overview");
  if (overview) parts.push(`CURRENT WORLD STATE:\n${cap(overview)}`);
  // Everything above is generic boilerplate fetched for every live question.
  // Anything pushed after this point is specific to what was actually asked,
  // and that distinction decides whether the scout needs to run.
  const genericParts = parts.length;

  if (ANALYTICS_WORDS.test(text)) {
    const catalog = payload(await call("analytics_catalog"));
    const selected = analyticsPlanner.plan(text, catalog, {
      country: namedCountryId(text, focusCountry),
    });
    if (selected) {
      const result = await call("analytics_query", selected.args, "gamestate", true);
      const data = payload(result);
      const displayReady = data?.metric
        && (Array.isArray(data.regions) || Array.isArray(data.rows));
      if (displayReady) {
        handledAnalyticsDataset = selected.dataset;
        visualizations.push(data);
        parts.push(`AGENT-PLANNED LIVE ANALYTICS (${selected.rationale}):\n${cap(result, 9000)}`);
      } else if (result && /MCP error/i.test(result)) {
        parts.push(`AGENT-PLANNED ANALYTICS RESULT (${selected.rationale}):\n${cap(result, 1400)}`);
      }
    }
  }

  if (corporationLeaderboardRequested && handledAnalyticsDataset !== "public_corporation_rankings") {
    const metric = plan?.display?.metric === "liquid_capital_anchor" ? "liquid_capital" : "market_cap";
    const country = namedCountryId(text);
    const ranking = await call("corporation_rankings", {
      metric,
      // A buy question needs breadth to choose from; the top few by market cap
      // are the mega-caps, which is not the same as the best purchase.
      limit: plan?.intent === "corporation_investment" ? 25 : requestedRankingLimit(text),
      ...(country ? { country } : {}),
    });
    const data = payload(ranking);
    if (data?.recommended === "bar" && Array.isArray(data.rows)) {
      visualizations.push(data);
      parts.push(`CANONICAL LIVE CORPORATION LEADERBOARD:\n${cap(ranking, 9000)}`);
    } else {
      parts.push("REQUIRED LIVE CORPORATION LEADERBOARD UNAVAILABLE: the read-only corporation_rankings lookup returned no canonical dataset. Say that the live ranking is temporarily unavailable and do not substitute commodity, sector, country, or model-invented values.");
    }
  }

  const fxPair = namedFxPair(text);
  if (fxPair) {
    const fx = await call("fx_quote", { ...fxPair, historyTurns: 20 });
    if (fx) {
      parts.push(`FOCUSED LIVE FX QUOTE (${fxPair.base}/${fxPair.quote}):\n${cap(fx, 7000)}`);
      const viz = fxVisualization(fx);
      if (viz) visualizations.push(viz);
    }
  }
  // Candidate maps are a specialised election lookup. Do not attach a generic
  // country economy chart just because the word "map" appears in the request.
  if (COUNTRY_WORDS.test(text) && !fxPair && !candidateMapRequested && !aggregateMapRequested && !plan?.suppressGenericCountryEconomy) {
    const [countries, economy] = await Promise.all([
      call("countries"),
      call("economy_pulse", {}, "engine"),
    ]);
    if (focusCountry) parts.push(`PLAYER FOCUS COUNTRY: ${focusCountry}`);
    if (countries) parts.push(`CURRENT COUNTRY FOOTPRINTS:\n${cap(countries, 3500)}`);
    if (economy) parts.push(`CURRENT ECONOMY COMPARISON:\n${cap(economy, 5000)}`);
    const viz = countryVisualization(countries, text);
    if (viz) {
      viz.focusCountry = focusCountry;
      visualizations.push(viz);
    }
  }

  if (MAP_WORDS.test(text)) {
    const worldScope = /\b(world|global|countries|by country)\b/i.test(text);
    let country = namedCountryId(text, focusCountry);
    if (!worldScope && !country) {
      const place = text.match(/\b(?:in|across|within|for)\s+([a-z][a-z .'-]{1,45})/i)?.[1]?.replace(/\b(?:by|using|showing|colored?|coloured?)\b[\s\S]*$/i, "").trim();
      if (place) {
        const found = payload(await call("entity_search", { query: place, types: ["state"], limit: 1 }));
        country = found?.results?.[0]?.countryId || null;
      }
    }
    const scope = worldScope ? "world" : "country";
    const metric = mapMetric(text, scope);
    const aggregateMetric = geoAggregateMetric(text);
    const filters = metric === "candidate_roster" ? candidateMapFilters(text) : {};
    // GOP and Democratic Senate classes are specifically US office labels. The
    // country is therefore unambiguous even when the player omits "United States".
    if (!worldScope && !country && metric === "candidate_roster" && filters.party) country = "US";
    if (aggregateMetric && handledAnalyticsDataset !== "player_geography" && (scope === "world" || country)) {
      const aggregate = await call("geo_aggregate", {
        scope, metric: aggregateMetric, ...(country ? { country } : {}),
        ...(aggregateMetric === "active_player_count" ? { windowHours: activeWindowHours(text) } : {}),
      }, "gamestate", true);
      const data = payload(aggregate);
      if (data?.recommended === "map" && Array.isArray(data.regions)) {
        visualizations.unshift(data);
        parts.push(`SYNTHESIZED LIVE MAP DATA (${scope}${country ? `, ${country}` : ""}; ${aggregateMetric}):\n${cap(aggregate, 9000)}`);
      } else if (aggregate && /MCP error/i.test(aggregate)) {
        parts.push(`LIVE GEOGRAPHIC AGGREGATE RESULT (${scope}${country ? `, ${country}` : ""}; ${aggregateMetric}):\n${cap(aggregate, 1400)}`);
      }
    } else if (metric && (scope === "world" || country)) {
      const map = await call("map_snapshot", {
        scope, metric, ...(country ? { country } : {}),
        ...filters,
      }, "gamestate", true);
      const data = payload(map);
      if (data?.recommended === "map" && Array.isArray(data.regions)) {
        visualizations.unshift(data);
        parts.push(`CANONICAL LIVE MAP DATA (${scope}${country ? `, ${country}` : ""}; ${metric}):\n${cap(map, 9000)}`);
      } else if (map && /MCP error/i.test(map)) {
        // A failed, scoped map lookup is still useful grounding. It keeps the
        // model from claiming that a dataset is absent when the live service
        // instead reported the concrete missing party, class, or filing.
        parts.push(`LIVE MAP LOOKUP RESULT (${scope}${country ? `, ${country}` : ""}; ${metric}):\n${cap(map, 1400)}`);
      }
    }
  }

  // A country's live fiscal position: the decomposition behind budget, deficit,
  // debt, and "what's pushing inflation" questions, not the formula.
  if (plan?.intent === "country_fiscal") {
    const country = namedCountryId(text, focusCountry);
    if (country) {
      const fiscal = await call("country_fiscal", { country });
      const data = payload(fiscal);
      if (data?.available) parts.push(`LIVE FISCAL POSITION (${country}):\n${cap(fiscal, 6000)}`);
      else if (fiscal) parts.push(`LIVE FISCAL LOOKUP (${country}):\n${cap(fiscal, 1200)}`);
    }
  }

  // Live legislative record for "what bills are on the floor / can I propose".
  if (LEGISLATION_WORDS.test(text)) {
    const country = namedCountryId(text, focusCountry);
    if (country) {
      const bills = await call("legislation_catalog", { country, limit: 15 });
      if (bills && !/MCP error/i.test(bills)) parts.push(`LIVE LEGISLATION (${country}):\n${cap(bills, 6000)}`);
    }
  }

  const charName = context?.character?.name;
  if (charName && /\b(my|mine|i |i'm|am i)\b/i.test(text)) {
    // The canonical wealth snapshot first (net worth, cash, savings, bonds),
    // then the recent history — "show my net worth" needs the concrete figure.
    if (plan?.intent === "player_wealth" || /\b(net[\s-]?worth|wealth|savings|money|holdings|balance|worth)\b/i.test(text)) {
      const sheet = await call("character_balance_sheet", { character: charName });
      const data = payload(sheet);
      if (data?.found) parts.push(`THIS PLAYER'S WEALTH (${charName}) — report these concrete figures:\n${cap(sheet, 3000)}`);
      // A change/trend question needs the per-turn series, not just today's
      // snapshot. The portfolio series values stocks and funds the cash-based
      // balance sheet does not carry, so on wealth-over-time questions the
      // series is the authoritative net-worth figure.
      if (/\b(chang(?:e|ed|es|ing)|trend|history|over (?:recent|the last|time)|recent turns|grew|grown|dropped|gained|lost|biggest|largest)\b/i.test(text)) {
        const series = await call("character_wealth_history", { character: charName, turns: 48 });
        if (series && !/MCP error/i.test(series)) {
          parts.push(`THIS PLAYER'S WEALTH OVER TIME (${charName}) — per-turn net worth INCLUDING stock/bond/fund positions (unlike the cash-based sheet above; prefer THESE figures for wealth-over-time and largest-change questions):\n${cap(series, 6000)}`);
        }
      }
    }
    const character = await call("trace_character", { character: charName });
    if (character) parts.push(`THIS PLAYER'S RECENT HISTORY (${charName}):\n${cap(character)}`);
  }

  const requestedNames = namedCorporations(text);
  const explicitSector = namedSectorType(text);
  const explicitState = namedSectorState(text, explicitSector);
  const ownCorpName = context?.corporation?.name;
  const corpish = CORP_WORDS.test(text) && !corporationLeaderboardRequested;
  const requestsOwnCorporation = Boolean(
    ownCorpName
    && requestedNames.length === 1
    && comparableCorporationName(requestedNames[0]) === comparableCorporationName(ownCorpName)
  );

  if (requestedNames.length && !requestsOwnCorporation && !/\b(my|mine|our)\b/i.test(text)) {
    const traces = await Promise.all(requestedNames.map(name => resolveCorporation(name, call)));
    for (const trace of traces) {
      if (trace.result) parts.push(`REQUESTED CORPORATION (${trace.resolved}; disclose corporation-specific financial details only if this result establishes public visibility):\n${cap(trace.result)}`);
      // Two corporations matched the player's wording equally well. Say so and
      // let them choose, rather than silently reporting on one of them.
      else if (trace.ambiguous?.length) {
        parts.push(`AMBIGUOUS CORPORATION NAME: "${trace.requested}" matches several corporations equally well: ${trace.ambiguous.join(", ")}. Ask the player which one they mean. Do NOT report figures for any of them.`);
      }
    }
    if (explicitSector) {
      const resolved = traces.filter(trace => trace.result && !trace.data?.error);
      const sectorTraces = await Promise.all(resolved.map(async trace => ({
        name: trace.resolved,
        result: await call("trace_sector", { corporation: trace.resolved, sectorType: explicitSector }),
      })));
      for (const trace of sectorTraces) {
        if (trace.result) parts.push(`REQUESTED CORPORATION ${explicitSector.toUpperCase()} SECTORS (${trace.name}):\n${cap(sectorSummary(trace.result), 3500)}`);
      }
      const comparison = await call("trace_sector", { sectorType: explicitSector });
      if (comparison) {
        parts.push(`${explicitSector.toUpperCase()} SECTOR COMPARISON BASELINE:\n${cap(comparison, 4500)}`);
        const viz = comparisonVisualization(`${explicitSector} corporation revenue comparison`, comparison);
        if (viz) visualizations.push(viz);
      }
    }
  } else if (ownCorpName && corpish) {
    const [corporation, sectors] = await Promise.all([
      call("trace_corp", { corporation: ownCorpName }),
      call("trace_sector", {
        corporation: ownCorpName,
        ...(explicitSector ? { sectorType: explicitSector } : {}),
        ...(explicitState ? { state: explicitState } : {}),
      }),
    ]);
    if (corporation) parts.push(`THIS PLAYER'S CORPORATION (${ownCorpName}${context.corporation.ticker ? `, ${context.corporation.ticker}` : ""}${context.corporation.role ? `, they are ${context.corporation.role}` : ""}):\n${cap(corporation, 3500)}`);
    if (sectors) parts.push(`${explicitState ? `FOCUSED CORPORATION MARKET CELL (${explicitState}, ${explicitSector})` : "THIS PLAYER'S CORPORATION SECTORS"}:\n${cap(sectorSummary(sectors), 4500)}`);

    const peerSector = explicitSector || (PEER_WORDS.test(text) ? dominantSector(sectors) : null);
    if (peerSector) {
      const comparison = await call("trace_sector", { sectorType: peerSector });
      if (comparison) {
        parts.push(`${peerSector.toUpperCase()} SECTOR COMPARISON BASELINE:\n${cap(comparison, 4500)}`);
        const target = targetSectorRow(ownCorpName, sectors, peerSector);
        const viz = comparisonVisualization(`${ownCorpName} compared with ${peerSector} peers`, comparison, target);
        if (viz) visualizations.push(viz);
      }
    }
  } else if (explicitSector && corpish) {
    const sectorArgs = {
      sectorType: explicitSector,
      ...(explicitState ? { state: explicitState } : {}),
    };
    const sector = await call("trace_sector", sectorArgs);
    if (sector) {
      parts.push(`${explicitState ? `${explicitState.toUpperCase()} ${explicitSector.toUpperCase()} MARKET CELL` : `${explicitSector.toUpperCase()} PUBLIC SECTOR COMPARISON`}:
${cap(sector, 5000)}`);
      if (!explicitState) {
        const viz = comparisonVisualization(`Public ${explicitSector} corporation revenue`, sector);
        if (viz) visualizations.push(viz);
      }
    }
  } else if (corpish && !ownCorpName) {
    parts.push("NOTE: this player is not linked to a corporation in the game database. Say so plainly rather than guessing.");
  }

  if (MARKET_WORDS.test(text) && !corporationLeaderboardRequested) {
    const market = await call("extraction_market");
    if (market) {
      parts.push(`CURRENT MARKET STATE:\n${cap(market, 4500)}`);
      const viz = marketVisualization(market);
      if (viz) visualizations.push(viz);
    }
  }
  if (ELECTION_WORDS.test(text)) {
    const elections = await call("elections");
    if (elections) {
      parts.push(`CURRENT ELECTIONS:\n${cap(elections, 4000)}`);
      const viz = electionVisualization(elections);
      if (viz) visualizations.push(viz);
    }
  }

  if (visualizations.length) {
    parts.push(`VISUALIZATION DATA:\n${asJson(visualizations.slice(0, 2))}`);
  }
  if (!parts.length) return { text: "", visualizations: [], usedTools, targeted: false };
  return {
    text: `LIVE GAME INTELLIGENCE (read-only, fetched just now; current facts outrank stale documentation):\n\n${parts.join("\n\n")}`,
    visualizations,
    usedTools,
    // False means the heuristics matched nothing and all we have is the world
    // snapshot every question gets. That is the state in which answers used to
    // tell players the data did not exist, so it is the signal to send the scout.
    targeted: parts.length > genericParts,
  };
}

module.exports = { retrieve, resolveCorporation, namedCorporation, namedCorporations, namedSectorType, namedSectorState, namedFxPair, candidateMapFilters, geoAggregateMetric, activeWindowHours };
