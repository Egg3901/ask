const test = require("node:test");
const assert = require("node:assert/strict");
const mcp = require("./mcp");
const askPlan = require("./ask-plan");

test("offers live grounding for public market and country economy questions", () => {
  assert.equal(mcp.looksLive("Why is Tinky valued so highly?"), true);
  assert.equal(mcp.looksLive("How is the German economy doing?"), true);
  assert.equal(mcp.looksLive("Explain the GDP of another country"), true);
  assert.equal(mcp.looksLive("Map regional approval in Italy"), true);
});

test("uses the canonical live leaderboard for the largest public companies", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "corporation_rankings") return JSON.stringify({
      recommended: "bar",
      title: "Largest public corporations by market capitalization",
      metric: "market_cap_anchor",
      unit: "anchor",
      rows: [
        { label: "Alpha", value: 100000 },
        { label: "Beta", value: 15000 },
      ],
    });
    return null;
  };
  const question = "Show me a visualization comparing the 10 largest public companies";

  const intelligence = await mcp.liveIntelligence(
    question,
    {},
    fakeCall,
    askPlan.create(question),
  );

  assert.ok(calls.some(call => call.name === "corporation_rankings"
    && call.args.metric === "market_cap" && call.args.limit === 10));
  assert.equal(intelligence.visualizations[0].metric, "market_cap_anchor");
  assert.match(intelligence.text, /CANONICAL LIVE CORPORATION LEADERBOARD/);
  assert.doesNotMatch(intelligence.text, /not linked to a corporation/i);
});

test("reports a missing required corporation leaderboard without substituting market data", async () => {
  const calls = [];
  const fakeCall = async (name) => {
    calls.push(name);
    return name === "game_overview" ? "{}" : null;
  };
  const question = "Show me a visualization comparing the 10 largest public companies";

  const intelligence = await mcp.liveIntelligence(
    question,
    {},
    fakeCall,
    askPlan.create(question),
  );

  assert.match(intelligence.text, /REQUIRED LIVE CORPORATION LEADERBOARD UNAVAILABLE/);
  assert.equal(intelligence.visualizations.length, 0);
  assert.ok(!calls.includes("extraction_market"));
});

test("requires live retrieval for explicit public candidate map requests", () => {
  assert.equal(mcp.requiresLive("Map GOP Senate 1 candidates Real players only"), true);
  assert.equal(mcp.requiresLive("Diagram how Senate elections work"), false);
});

test("routes Scenario Lab only to the bounded read-only worldsim projection", async () => {
  const calls = [];
  const question = "What happens to iron if demand rises 5% per turn for 12 turns?";
  const intelligence = await mcp.liveIntelligence(
    question,
    {},
    async (name, args, server) => {
      calls.push({ name, args, server });
      return JSON.stringify({
        scenario: args,
        startInflation: 1,
        endInflation: 1.1,
        inflationTrajectory: [{ turn: 1, inflationIndex: 1.01 }],
        commodities: [{ commodity: "iron", startPrice: 2, endPrice: 2.5, changePct: 25 }],
      });
    },
    askPlan.create(question),
  );

  assert.deepEqual(calls, [{
    name: "sim_economy_whatif",
    args: { turns: 12, demandPct: 5, supplyPct: 0, commodity: "iron" },
    server: "worldsim",
  }]);
  assert.match(intelligence.answerContract, /directional projection/i);
  assert.equal(intelligence.visualizations[0].recommended, "line");
});

test("uses canonical live map data for world and country geographic questions", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "countries") return "[]";
    if (name === "economy_pulse") return "{}";
    if (name === "map_snapshot") return JSON.stringify({
      recommended: "map", scope: args.scope, country: args.country,
      title: "Italy approval", metric: args.metric, unit: "%", palette: "good",
      regions: [{ id: "IT_LAZ", label: "Lazio", value: 71.2 }],
    });
    return null;
  };

  const intelligence = await mcp.liveIntelligence(
    "Show a map of regional approval across Italy",
    {},
    fakeCall,
  );

  assert.ok(calls.some(call => call.name === "map_snapshot"
    && call.args.scope === "country" && call.args.country === "IT" && call.args.metric === "approval"));
  assert.equal(intelligence.visualizations[0].recommended, "map");
  assert.equal(intelligence.visualizations[0].regions[0].label, "Lazio");
  assert.match(intelligence.text, /CANONICAL LIVE MAP DATA/);
});

test("synthesizes a live public geographic aggregate when no native map layer exists", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "countries") return "[]";
    if (name === "economy_pulse") return "{}";
    if (name === "geo_aggregate") return JSON.stringify({
      recommended: "map", scope: args.scope, title: "Live world active player characters",
      metric: args.metric, unit: "players", palette: "magnitude",
      regions: [{ id: "US", label: "US", value: 8 }],
    });
    return null;
  };

  const intelligence = await mcp.liveIntelligence(
    "Map active players online within 24 hours by country",
    {},
    fakeCall,
  );

  assert.ok(calls.some(call => call.name === "geo_aggregate"
    && call.args.scope === "world" && call.args.metric === "active_player_count"
    && call.args.windowHours === 24));
  assert.ok(!calls.some(call => call.name === "map_snapshot"));
  assert.equal(intelligence.visualizations[0].metric, "active_player_count");
  assert.match(intelligence.text, /SYNTHESIZED LIVE MAP DATA/);
});

test("synthesizes Anchor-normalized player wealth by state from the shared aggregate contract", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "geo_aggregate") return JSON.stringify({
      recommended: "map", scope: "country", country: "US", title: "US aggregate player net worth by state",
      metric: args.metric, unit: "anchor", palette: "magnitude",
      regions: [{ id: "CA", label: "CA", value: 123 }],
    });
    return null;
  };

  const intelligence = await mcp.liveIntelligence(
    "Show a map of player net worth by state in the United States",
    {},
    fakeCall,
  );

  assert.ok(calls.some(call => call.name === "geo_aggregate"
    && call.args.scope === "country" && call.args.country === "US"
    && call.args.metric === "player_net_worth_anchor"));
  assert.equal(intelligence.visualizations[0].unit, "anchor");
});

test("discovers and queries a novel map through the analytics catalog", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "analytics_catalog") return JSON.stringify({
      schemaVersion: "1",
      datasets: [{
        id: "player_geography",
        description: "Privacy-safe aggregates of player characters grouped by country or state.",
        dimensions: [{ id: "scope" }, { id: "country" }],
        metrics: [{
          id: "player_net_worth_anchor",
          aliases: ["player net worth", "player wealth"],
          unit: "anchor",
          aggregations: ["sum", "average"],
        }],
        presentations: ["map", "ranked_bar", "table"],
        defaultPresentation: "map",
      }],
    });
    if (name === "analytics_query") return JSON.stringify({
      schemaVersion: "1", datasetId: args.dataset,
      recommended: "map", scope: args.scope, country: args.country,
      title: "US aggregate player net worth by state",
      metric: args.metric, unit: "anchor", palette: "magnitude",
      regions: [{ id: "CA", label: "California", value: 123 }],
    });
    return null;
  };

  const intelligence = await mcp.liveIntelligence(
    "Create a map of US states by average player net worth",
    {},
    fakeCall,
  );

  assert.ok(calls.some(call => call.name === "analytics_catalog"));
  assert.ok(calls.some(call => call.name === "analytics_query"
    && call.args.dataset === "player_geography"
    && call.args.metric === "player_net_worth_anchor"
    && call.args.presentation === "map"
    && call.args.scope === "country"
    && call.args.country === "US"
    && call.args.aggregation === "average"));
  assert.ok(!calls.some(call => call.name === "geo_aggregate"));
  assert.equal(intelligence.visualizations[0].metric, "player_net_worth_anchor");
  assert.match(intelligence.text, /AGENT-PLANNED LIVE ANALYTICS/);
});

test("turns a party Senate candidate map request into a scoped live roster map", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "countries") return "[]";
    if (name === "economy_pulse") return "{}";
    if (name === "map_snapshot") return JSON.stringify({
      recommended: "map", scope: "country", country: "US", metric: args.metric,
      palette: "canonical", regions: [{ id: "PA", label: "Pennsylvania", value: 1, color: "#e53935" }],
    });
    return null;
  };

  const intelligence = await mcp.liveIntelligence("Map GOP Senate 1 candidates in the United States", {}, fakeCall);
  assert.ok(calls.some(call => call.name === "map_snapshot" &&
    call.args.metric === "candidate_roster" && call.args.country === "US" &&
    call.args.electionType === "senate" && call.args.senateClass === 1 && call.args.party === "GOP"));
  assert.equal(intelligence.visualizations[0].metric, "candidate_roster");
});

test("infers the US and real-player filter for an abbreviated GOP Senate map request", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "map_snapshot") return JSON.stringify({
      recommended: "map", scope: "country", country: "US", metric: "candidate_roster",
      palette: "canonical", regions: [{ id: "PA", label: "Pennsylvania", value: 1, color: "#e53935" }],
    });
    return null;
  };

  await mcp.liveIntelligence("Map GOP Senate 1 candidates real players only", {}, fakeCall);
  assert.ok(calls.some(call => call.name === "map_snapshot" &&
    call.args.country === "US" && call.args.electionType === "senate" &&
    call.args.senateClass === 1 && call.args.party === "GOP" && call.args.playersOnly === true));
});

test("keeps a scoped candidate map lookup failure for the answer instead of substituting another chart", async () => {
  const calls = [];
  const fakeCall = async (name) => {
    calls.push(name);
    if (name === "game_overview") return "{}";
    if (name === "map_snapshot") return "MCP error: no public party matched GOP in this country; available parties: Conservative";
    return null;
  };

  const intelligence = await mcp.liveIntelligence("Map GOP Senate 1 candidates real players only", {}, fakeCall);
  assert.equal(intelligence.visualizations.length, 0);
  assert.match(intelligence.text, /LIVE MAP LOOKUP RESULT/);
  assert.match(intelligence.text, /no public party matched GOP/);
  assert.ok(!calls.includes("countries"));
  assert.ok(!calls.includes("economy_pulse"));
});

test("preserves an MCP tool's structured lookup error only when requested", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    jsonrpc: "2.0", id: 1,
    result: { content: [{ type: "text", text: "no public party matched GOP" }], isError: true },
  }), { status: 200 });
  try {
    assert.equal(await mcp.callServer("gamestate", "map_snapshot", {}, 1000), null);
    assert.equal(
      await mcp.callServer("gamestate", "map_snapshot", {}, 1000, true),
      "MCP error: no public party matched GOP",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("does not spend live quota on a purely timeless mechanics question", () => {
  assert.equal(mcp.looksLive("How are action points calculated?"), false);
});

test("recognizes a live player-ranking question even without the word rank", () => {
  assert.equal(mcp.looksLive("is tweamonster one of the worst players"), true);
});

test("extracts an explicitly named corporation without treating private or own requests as names", () => {
  assert.equal(mcp.namedCorporation("Why is Tinkey corporation valued so highly?"), "Tinkey");
  assert.equal(mcp.namedCorporation("What is the balance sheet of Tinky Corporation?"), "Tinky");
  assert.equal(mcp.namedCorporation("What is the balance sheet of a private corporation?"), null);
  assert.equal(mcp.namedCorporation("Why is my corporation valued highly?"), null);
});

test("extracts every corporation from the exact multi-corporation comparison form", () => {
  assert.deepEqual(
    mcp.namedCorporations("Why is Tinky corporation, Lockheed commerce and Fiskars (all retail) doing so much better than other corps?"),
    ["Tinky", "Lockheed commerce", "Fiskars"],
  );
});

test("extracts informal corporation names from a conversational stock question", () => {
  assert.deepEqual(
    mcp.namedCorporations("What did happen to butxot corp? How did its stock not plummet with tinky."),
    ["butxot", "tinky"],
  );
});

test("looks up every corporation in a comparison as a separate live-data request", async () => {
  const calls = [];
  const question = "Why is Tinky corporation, Lockheed commerce and Fiskars (all retail) doing so much better than other corps?";
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    return name === "trace_corp" ? JSON.stringify({ public: true, name: args.corporation }) : "{}";
  };

  const context = await mcp.liveContext(question, {}, fakeCall);

  assert.deepEqual(
    calls.filter(call => call.name === "trace_corp").map(call => call.args.corporation),
    ["Tinky", "Lockheed commerce", "Fiskars"],
  );
  assert.match(context, /REQUESTED CORPORATION \(Tinky;/);
  assert.match(context, /REQUESTED CORPORATION \(Lockheed commerce;/);
  assert.match(context, /REQUESTED CORPORATION \(Fiskars;/);
});

test("resolves a corporation suffix and adds the requested sector comparison baseline", async () => {
  const calls = [];
  const question = "Why is Tinky corporation, Lockheed commerce and Fiskars (all retail) doing so much better than other corps?";
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "trace_corp" && args.corporation === "Tinky") {
      return JSON.stringify({ error: "corporation not found: Tinky" });
    }
    if (name === "trace_corp") {
      const resolved = args.corporation === "Tinky Corporation" ? "Tinky Corporation" : args.corporation;
      return JSON.stringify({ corporation: { name: resolved, isPrivate: false }, timeline: [] });
    }
    if (name === "trace_sector" && !args.corporation) {
      return JSON.stringify({ sectorComparison: { sectorType: "retail", corporations: [] } });
    }
    if (name === "trace_sector") {
      return JSON.stringify({ corporation: { name: args.corporation }, currentStakes: [] });
    }
    return null;
  };

  const context = await mcp.liveContext(question, {}, fakeCall);

  assert.ok(calls.some(call => call.name === "trace_corp" && call.args.corporation === "Tinky Corporation"));
  assert.ok(calls.some(call => call.name === "trace_sector" && call.args.corporation === "Tinky Corporation" && call.args.sectorType === "retail"));
  assert.ok(calls.some(call => call.name === "trace_sector" && !call.args.corporation && call.args.sectorType === "retail"));
  assert.doesNotMatch(context, /corporation not found: Tinky/i);
  assert.match(context, /RETAIL SECTOR COMPARISON BASELINE:/);
});

test("uses player context to compare their corporation with live peers and chart data", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "trace_corp") {
      return JSON.stringify({ corporation: { name: "My Company", currency: "GBP", isPrivate: true }, timeline: [] });
    }
    if (name === "trace_sector" && args.corporation) {
      return JSON.stringify({
        corporation: { name: "My Company" },
        currentStakes: [
          { sector: "retail", revenueAnchor: 80 },
          { sector: "retail", revenueAnchor: 20 },
          { sector: "technology", revenueAnchor: 10 },
        ],
      });
    }
    if (name === "trace_sector" && args.sectorType === "retail") {
      return JSON.stringify({
        sectorComparison: {
          sectorType: "retail",
          visibility: "public exchange-visible corporations only",
          corporationsCompared: 2,
          leaders: [
            { name: "Peer One", revenueAnchor: 150 },
            { name: "Peer Two", revenueAnchor: 90 },
          ],
        },
      });
    }
    return null;
  };

  const context = await mcp.liveContext(
    "Compare my corporation to its peers and show me the difference",
    { corporation: { name: "My Company", role: "ceo" } },
    fakeCall,
  );

  assert.ok(calls.some(call => call.name === "trace_sector" && call.args.sectorType === "retail" && !call.args.corporation));
  assert.match(context, /RETAIL SECTOR COMPARISON BASELINE:/);
  assert.match(context, /VISUALIZATION DATA:/);
  assert.match(context, /Peer One/);
});

test("builds complete owned coverage and a region universe for corporation market-gap questions", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "trace_corp") return JSON.stringify({ corporation: { name: "My Company", countryId: "US" } });
    if (name === "trace_sector") return JSON.stringify({
      currentStakes: [
        { country: "US", state: "CA", stateName: "California", sector: "media", sharePct: 20 },
        { country: "US", state: "TX", stateName: "Texas", sector: "media", sharePct: 10 },
      ],
    });
    if (name === "map_snapshot") return JSON.stringify({ regions: [
      { id: "CA", label: "California", value: 1 },
      { id: "TX", label: "Texas", value: 1 },
      { id: "FL", label: "Florida", value: 1 },
    ] });
    return null;
  };

  const intelligence = await mcp.liveIntelligence(
    "Give me a table of potential media areas my corporation does not own yet",
    { corporation: { name: "My Company", role: "ceo" } },
    fakeCall,
  );
  const context = intelligence.text;

  assert.ok(calls.some(call => call.name === "map_snapshot" && call.args.country === "US"));
  assert.match(context, /COMPLETE OWNED MEDIA MARKET COVERAGE/);
  assert.match(context, /PRECOMPUTED UNCOVERED HOME-COUNTRY MEDIA MARKETS/);
  assert.match(context, /Florida/);
  assert.doesNotMatch(context, /California.*uncovered|Texas.*uncovered/i);
  assert.match(intelligence.answerContract, /Largest uncovered media markets in US/);
  assert.match(intelligence.answerContract, /Florida/);
  assert.doesNotMatch(intelligence.answerContract, /California|Texas/);
  assert.doesNotMatch(intelligence.answerContract, /\|\s*(?:revenue|profit)\b|\$[\d,.]+/i);
});

test("treats a named account corporation and its public peers as the player's corporation", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "trace_corp" && args.corporation === "The Money Printer") {
      return JSON.stringify({ corporation: { name: "The Money Printer", isPrivate: false }, timeline: [] });
    }
    if (name === "trace_sector" && args.corporation === "The Money Printer") {
      return JSON.stringify({
        corporation: { name: "The Money Printer" },
        currentStakes: [{ sector: "retail", revenueAnchor: 125 }],
      });
    }
    if (name === "trace_sector" && args.sectorType === "retail") {
      return JSON.stringify({
        sectorComparison: {
          sectorType: "retail",
          visibility: "public exchange-visible corporations only",
          leaders: [{ name: "Public Peer", stakes: 2, revenueAnchor: 150 }],
        },
      });
    }
    return JSON.stringify({ error: `corporation not found: ${args.corporation || "unknown"}` });
  };

  const context = await mcp.liveContext(
    "Compare The Money Printer with its public peers on revenue, revenue per stake, and recent trend. Visualize the clearest difference.",
    { corporation: { name: "The Money Printer", ticker: "EGG", role: "ceo" } },
    fakeCall,
  );

  assert.deepEqual(
    calls.filter(call => call.name === "trace_corp").map(call => call.args.corporation),
    ["The Money Printer"],
  );
  assert.ok(calls.some(call => call.name === "trace_sector" && call.args.corporation === "The Money Printer"));
  assert.ok(calls.some(call => call.name === "trace_sector" && call.args.sectorType === "retail" && !call.args.corporation));
  assert.match(context, /THIS PLAYER'S CORPORATION \(The Money Printer, EGG, they are ceo\):/);
  assert.match(context, /VISUALIZATION DATA:/);
});

test("uses the live economy MCP for country comparisons and player country context", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "countries") return JSON.stringify([
      { countryId: "UK", economy: { gdpGrowth: 2.1 }, currency: "GBP", fx: { localPerAnchor: 0.8 } },
      { countryId: "US", economy: { gdpGrowth: 1.8 }, currency: "USD", fx: { localPerAnchor: 1 } },
    ]);
    if (name === "economy_pulse") return JSON.stringify({ countries: [{ countryId: "UK", gdpGrowth: 2.1 }] });
    if (name === "trace_character") return "{}";
    return null;
  };

  const context = await mcp.liveContext(
    "How is my country's economy doing compared with other countries?",
    { character: { name: "Ada", country: "UK" } },
    fakeCall,
  );

  assert.ok(calls.some(call => call.name === "economy_pulse"));
  assert.match(context, /CURRENT ECONOMY COMPARISON:/);
  assert.match(context, /PLAYER FOCUS COUNTRY: UK/);
  assert.match(context, /VISUALIZATION DATA:/);
  assert.match(context, /Live country GDP growth comparison/);
  assert.match(context, /"focusCountry": "UK"/);
});

test("uses a focused FX quote and charts the requested pair instead of GDP", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "fx_quote") return JSON.stringify({
      pair: "GBP/USD",
      current: { quotePerBase: 3.531133, basePerQuote: 0.283195 },
      changeOverHistoryPct: -5.02,
      history: [
        { turn: 322, quotePerBase: 3.624956 },
        { turn: 323, quotePerBase: 3.59392 },
        { turn: 324, quotePerBase: 3.531133 },
      ],
      chart: { metric: "USD per GBP", x: [322, 323, 324], y: [3.624956, 3.59392, 3.531133] },
    });
    if (name === "countries") throw new Error("broad country data should not be used for a focused pair");
    return null;
  };

  const intelligence = await mcp.liveIntelligence("Whatbthenhell is up with the GBP to USD exchange rate in game?", {}, fakeCall);

  assert.ok(calls.some(call => call.name === "fx_quote" && call.args.base === "GBP" && call.args.quote === "USD"));
  assert.ok(!calls.some(call => call.name === "countries"));
  assert.match(intelligence.text, /FOCUSED LIVE FX QUOTE \(GBP\/USD\)/);
  assert.equal(intelligence.visualizations[0].title, "GBP/USD exchange rate");
  assert.equal(intelligence.visualizations[0].metric, "USD per GBP");
  assert.doesNotMatch(JSON.stringify(intelligence.visualizations), /GDP/i);
});

test("passes a player-facing state name into a focused corporation-sector lookup", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "trace_corp") return JSON.stringify({ corporation: { name: "The Money Printer", isPrivate: false } });
    if (name === "trace_sector" && args.corporation) return JSON.stringify({
      corporation: { name: "The Money Printer" },
      currentStakes: [{ state: "IT_LAZ", sector: "media", revenueAnchor: 100, sharePct: 67 }],
    });
    if (name === "trace_sector") return JSON.stringify({ sectorComparison: { leaders: [] } });
    return null;
  };

  const context = await mcp.liveContext(
    "Why is my Lazio media sector so dominant?",
    { corporation: { name: "The Money Printer", role: "ceo" } },
    fakeCall,
  );

  assert.ok(calls.some(call => call.name === "trace_sector"
    && call.args.corporation === "The Money Printer"
    && call.args.state === "Lazio"
    && call.args.sectorType === "media"));
  assert.match(context, /FOCUSED CORPORATION MARKET CELL/);
});

test("grounds a generic public sector leaderboard without requiring a linked corporation", async () => {
  const calls = [];
  const fakeCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "game_overview") return "{}";
    if (name === "trace_sector") return JSON.stringify({
      sectorComparison: {
        leaders: [
          { name: "Media One", revenueAnchor: 500, stakes: 2 },
          { name: "Media Two", revenueAnchor: 300, stakes: 1 },
        ],
      },
    });
    return null;
  };

  const context = await mcp.liveContext(
    "Which public media corporations lead on revenue right now? Visualize it.",
    {},
    fakeCall,
  );

  assert.ok(calls.some(call => call.name === "trace_sector" && call.args.sectorType === "media" && !call.args.corporation));
  assert.match(context, /MEDIA PUBLIC SECTOR COMPARISON/);
  assert.match(context, /VISUALIZATION DATA/);
  assert.doesNotMatch(context, /not linked to a corporation/i);
});

test("extracts both sides of a bare head-to-head when one carries a corp word", () => {
  assert.deepEqual(
    mcp.namedCorporations("Tinky corp vs meyer corp: which is the better buy right now?"),
    ["Tinky", "meyer"],
  );
  assert.deepEqual(
    mcp.namedCorporations("Compare Tinky Winky Corporation and Meyer Corporation"),
    ["Tinky Winky", "Meyer"],
  );
  // Countries are not companies: the bare vs-pattern must not fire without a corp word.
  assert.deepEqual(mcp.namedCorporations("US vs USSR who wins the war"), []);
});

// ── Live-data provenance ────────────────────────────────────────────────────

test("live sources name the game state an answer read, without the plumbing", () => {
  const out = mcp.liveSources([
    "gamestate:game_overview", "gamestate:trace_corp", "gamestate:trace_sector",
    "gamestate:trace_sector", "investigate:entity_search", "investigate:search_code",
  ]);
  assert.deepEqual(out.map(s => s.label),
    ["Game overview", "Corporation detail", "Sector detail", "Entity lookup"]);
  // Namespaces are stripped, repeats collapse, and order is first-read-first.
  assert.deepEqual(out.map(s => s.id),
    ["game_overview", "trace_corp", "trace_sector", "entity_search"]);
});

test("code searches are not passed off as live data", () => {
  // These are already covered by the file citations. Listing them as live reads
  // would claim the answer saw the running world when it only read the repo.
  assert.deepEqual(mcp.liveSources(["investigate:search_code", "investigate:show_change", "investigate:search_history"]), []);
});

test("an unlabelled tool is still reported rather than silently dropped", () => {
  const out = mcp.liveSources(["gamestate:some_new_tool"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Some new tool");
});

test("live sources survive junk input", () => {
  for (const input of [null, undefined, [], ["", null, ":"], "not an array"]) {
    assert.deepEqual(mcp.liveSources(input), []);
  }
});
