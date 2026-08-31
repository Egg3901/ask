// Grounded entry points into systems that exist in the live A House Divided
// source. Context templates are only included when the player-context bridge
// supplied the matching game identity.

const CATEGORIES = {
  basics: { label: "Basics", icon: "compass" },
  investigate: { label: "Ask tools", icon: "search" },
  economy: { label: "Economy", icon: "chart" },
  politics: { label: "Politics", icon: "landmark" },
  elections: { label: "Elections", icon: "vote" },
  corporations: { label: "Companies", icon: "briefcase" },
  world: { label: "World", icon: "globe" },
  visualizations: { label: "Visualize", icon: "chart" },
};

const QUESTIONS = [
  { id: "basics-turn-order", category: "basics", text: "What happens during a game turn, and in what order?" },
  { id: "basics-actions", category: "basics", text: "How do actions and action points work?" },
  { id: "basics-character-stats", category: "basics", text: "What do my character stats change in practice?" },
  { id: "basics-reputation", category: "basics", text: "How is character reputation gained and lost?" },
  { id: "basics-influence", category: "basics", text: "What is influence, and where can I spend it?" },
  { id: "basics-notifications", category: "basics", text: "Which game events create notifications for players?" },
  { id: "basics-retirement", category: "basics", text: "What happens when a character retires?" },
  { id: "basics-country-move", category: "basics", text: "Can a character change country, and what carries over?" },
  { id: "basics-turn-processing", category: "basics", text: "Why can a turn take longer than usual to process?" },
  { id: "basics-live-vs-rules", category: "basics", text: "What can Ask learn from code versus live game data?" },
  { id: "basics-verify-claim", category: "investigate", text: "Verify this claim: a sector finishes retooling in one turn." },

  { id: "economy-gdp", category: "economy", text: "How is GDP growth calculated each turn?" },
  { id: "economy-inflation", category: "economy", text: "How is inflation recalculated each turn?" },
  { id: "economy-interest", category: "economy", text: "How do interest rates affect the wider economy?" },
  { id: "economy-budget", category: "economy", text: "How do taxes and spending produce a budget balance?" },
  { id: "economy-debt", category: "economy", text: "How does government debt grow or shrink?" },
  { id: "economy-unemployment", category: "economy", text: "What causes unemployment to rise or fall?" },
  { id: "economy-currency", category: "economy", text: "How are exchange rates determined?" },
  { id: "economy-commodities", category: "economy", text: "How are commodity prices set?" },
  { id: "economy-tariffs", category: "economy", text: "How do tariffs change prices, revenue, and trade?" },
  { id: "economy-default", category: "economy", text: "What triggers a sovereign default crisis?" },
  { id: "economy-imf", category: "economy", text: "What does an IMF bailout change?" },
  { id: "economy-pensions", category: "economy", text: "How are pensions funded and paid?" },
  { id: "economy-live-world", category: "economy", live: true, text: "What are the three most important signals in the live world economy right now?" },
  { id: "economy-live-fx-gbp-usd", category: "economy", live: true, text: "What is happening to GBP/USD in game, and which live pressures best explain the move?" },
  { id: "economy-live-shortages", category: "economy", live: true, text: "Which resources have the largest live shortages or surpluses right now?" },
  { id: "economy-causal-autopsy", category: "investigate", live: true, text: "Run a causal autopsy on why US inflation is high right now." },
  { id: "economy-scenario-iron", category: "investigate", live: true, text: "What happens to iron prices if demand rises 5% per turn for 12 turns?" },
  { id: "tools-verify-logistics", category: "investigate", text: "Verify this claim: a Logistics Command directly raises a front's supply level." },
  { id: "tools-corporation-autopsy", category: "investigate", requires: "corporation", live: true, text: "Run a causal autopsy on why my corporation, {corporation}, lost revenue this turn." },
  { id: "tools-scenario-supply", category: "investigate", live: true, text: "What happens to economy-wide prices if supply falls 3% per turn for 8 turns?" },

  { id: "politics-bill", category: "politics", text: "How does a bill move from draft to law?" },
  { id: "politics-cloture", category: "politics", text: "How does cloture work?" },
  { id: "politics-amendments", category: "politics", text: "When can a bill be amended, and who can amend it?" },
  { id: "politics-committees", category: "politics", text: "What powers do legislative committees have?" },
  { id: "politics-cabinet", category: "politics", text: "How are cabinet ministers appointed and removed?" },
  { id: "politics-confidence", category: "politics", text: "How do confidence and no-confidence votes work?" },
  { id: "politics-party-influence", category: "politics", text: "How does party influence change each turn?" },
  { id: "politics-leadership", category: "politics", text: "How are party leaders chosen or replaced?" },
  { id: "politics-whips", category: "politics", text: "What can party whips do during a vote?" },
  { id: "politics-capital", category: "politics", text: "How is political capital earned and spent?" },
  { id: "politics-orders", category: "politics", text: "What can executive orders change?" },
  { id: "politics-referendums", category: "politics", text: "How do referendums get called and resolved?" },

  { id: "elections-tally", category: "elections", text: "How are election votes tallied?" },
  { id: "elections-turnout", category: "elections", text: "What affects election turnout?" },
  { id: "elections-spending", category: "elections", text: "How does campaign spending affect an election?" },
  { id: "elections-polls", category: "elections", text: "How are opinion polls calculated?" },
  { id: "elections-seats", category: "elections", text: "How are legislative seats allocated?" },
  { id: "elections-districts", category: "elections", text: "How are district election winners decided?" },
  { id: "elections-executive", category: "elections", text: "How do presidential and prime ministerial elections differ?" },
  { id: "elections-coalitions", category: "elections", text: "How do governing coalitions form after an election?" },
  { id: "elections-lists", category: "elections", text: "How do party lists translate votes into seats?" },
  { id: "elections-terms", category: "elections", text: "What controls election dates and term limits?" },
  { id: "elections-live-largest", category: "elections", live: true, text: "Which elections are active right now, and which have the most seats at stake?" },
  { id: "elections-live-gop-senate-map", category: "elections", live: true, text: "Map the current GOP Senate Class 1 candidates across the United States using the party's game color." },

  { id: "corporations-profit", category: "corporations", text: "How is a corporation's profit calculated?" },
  { id: "corporations-sectors", category: "corporations", text: "How do corporate sectors earn revenue?" },
  { id: "corporations-wages", category: "corporations", text: "How do wages and employment affect a corporation?" },
  { id: "corporations-shares", category: "corporations", text: "How do shares, ownership, and voting power work?" },
  { id: "corporations-dividends", category: "corporations", text: "When can a corporation pay dividends?" },
  { id: "corporations-valuation", category: "corporations", text: "How is a corporation valued?" },
  { id: "corporations-credit", category: "corporations", text: "How is the corporate credit score calculated?" },
  { id: "corporations-loans", category: "corporations", text: "How do corporate loans and interest costs work?" },
  { id: "corporations-bankruptcy", category: "corporations", text: "What happens when a corporation cannot pay its debts?" },
  { id: "corporations-subsidiaries", category: "corporations", text: "How do subsidiaries and spin-offs work?" },
  { id: "corporations-live-tinky", category: "corporations", live: true, text: "Why is Tinky Corporation valued so highly based on its public live data?" },
  { id: "corporations-live-media", category: "corporations", live: true, text: "Which public media corporations lead on revenue and revenue per stake right now?" },
  { id: "corporations-live-retail", category: "corporations", live: true, text: "Which public retail corporations are outperforming their peers right now, and by how much?" },

  { id: "world-trade-agreements", category: "world", text: "How do free trade agreements change the economy?" },
  { id: "world-sanctions", category: "world", text: "What do international sanctions change?" },
  { id: "world-relations", category: "world", text: "How do diplomatic relations improve or deteriorate?" },
  { id: "world-war", category: "world", text: "How can a country enter or leave a war?" },
  { id: "world-combat", category: "world", text: "How are battles and military losses resolved?" },
  { id: "world-defence", category: "world", text: "What does defence spending buy a country?" },
  { id: "world-crises", category: "world", text: "How do international crises begin and escalate?" },
  { id: "world-migration", category: "world", text: "What drives immigration and emigration?" },
  { id: "world-organizations", category: "world", text: "What powers do international organizations have?" },
  { id: "world-supply", category: "world", text: "How do global supply and trade shocks reach players?" },
  { id: "world-army-logistics", category: "world", text: "How do army logistics and front supply work?" },

  { id: "visualize-tinky-peers", category: "visualizations", live: true, text: "Compare Tinky Corporation with its public peers on revenue and revenue per stake. Visualize the clearest difference." },
  { id: "visualize-country-growth", category: "visualizations", live: true, text: "Compare live GDP growth and unemployment across countries. Visualize the clearest differences." },
  { id: "visualize-country-monetary", category: "visualizations", live: true, text: "Compare live inflation and policy interest rates across countries in a chart." },
  { id: "visualize-commodities", category: "visualizations", live: true, text: "Show current global commodity supply versus demand as a chart." },
  { id: "visualize-elections", category: "visualizations", live: true, text: "Visualize the active elections by country and number of seats." },
  { id: "visualize-gbp-usd", category: "visualizations", live: true, text: "Show the live GBP/USD exchange rate over the last 20 turns and visualize the trend." },
  { id: "visualize-public-media", category: "visualizations", live: true, text: "Rank public media corporations by live Anchor-normalized revenue. Visualize the target and its nearest meaningful peers." },
  { id: "visualize-market-balance", category: "visualizations", live: true, text: "Visualize the biggest live commodity shortages and surpluses, then explain the clearest imbalance." },
  { id: "visualize-scenario-iron", category: "visualizations", live: true, text: "Chart what happens to iron prices if demand rises 5% per turn for 12 turns." },
  { id: "visualize-world-unemployment-map", category: "visualizations", live: true, text: "Show a world map of live unemployment rates. Color higher unemployment as worse and explain the clearest regional pattern." },
  { id: "visualize-world-growth-map", category: "visualizations", live: true, text: "Map live GDP growth across countries and highlight where growth is strongest and weakest." },
  { id: "visualize-italy-approval-map", category: "visualizations", live: true, text: "Show a regional map of live government approval across Italy using the game map colors." },
  { id: "visualize-us-lean-map", category: "visualizations", live: true, text: "Map the current political lean of every US state using the same colors as the game map." },
  { id: "visualize-country-specialization-map", category: "visualizations", requires: "country", live: true, text: "Map each region's primary sector specialization in {country} using the game map colors." },
  { id: "visualize-country-population-map", category: "visualizations", requires: "country", live: true, text: "Show a population map of the regions in {country} and explain the largest concentrations." },
  { id: "visualize-profit-chain", category: "visualizations", text: "Diagram how sector revenue, costs, debt, and taxes become corporate profit." },

  { id: "visualize-context-corporation", category: "visualizations", requires: "corporation", live: true, text: "Compare {corporation} with its public peers on revenue, revenue per stake, and recent trend. Visualize the clearest difference." },
  { id: "visualize-context-corporation-trend", category: "visualizations", requires: "corporation", live: true, text: "Show {corporation}'s live revenue, income, and share-price direction over recent turns. Use the clearest chart or compact table." },
  { id: "visualize-context-corporation-sectors", category: "visualizations", requires: "corporation", live: true, text: "Show where {corporation}'s sector revenue comes from and visualize its strongest current markets." },
  { id: "visualize-context-country", category: "visualizations", requires: "country", live: true, text: "Compare {country}'s growth, inflation, unemployment, and Anchor-normalized income with peer countries. Visualize the clearest result." },
  { id: "visualize-context-character", category: "visualizations", requires: "character", live: true, text: "Show how {character}'s own savings and wealth changed over recent turns. Visualize the largest change." },
  { id: "visualize-context-party", category: "visualizations", requires: "party", live: true, text: "Show the live election picture relevant to {party}. Use a chart or table only if it makes the comparison clearer." },
  { id: "context-country-inflation", category: "economy", requires: "country", live: true, text: "What is driving inflation in {country} right now?" },
  { id: "context-country-budget", category: "economy", requires: "country", text: "How is {country}'s budget position calculated?" },
  { id: "context-country-growth", category: "economy", requires: "country", text: "Which policies most affect growth in {country}?" },
  { id: "context-party-support", category: "politics", requires: "party", live: true, text: "What is shaping {party}'s support right now?" },
  { id: "context-party-influence", category: "politics", requires: "party", text: "How can {party} gain influence between elections?" },
  { id: "context-corporation-profit", category: "corporations", requires: "corporation", live: true, text: "What is driving {corporation}'s profit right now?" },
  { id: "context-corporation-peers", category: "corporations", requires: "corporation", live: true, text: "How does {corporation} compare with its closest public peers right now?" },
  { id: "context-corporation-markets", category: "corporations", requires: "corporation", live: true, text: "Which current markets contribute most to {corporation}'s sector revenue?" },
  { id: "context-corporation-credit", category: "corporations", requires: "corporation", text: "How is {corporation}'s credit score calculated?" },
  { id: "context-corporation-value", category: "corporations", requires: "corporation", text: "How do {corporation}'s sectors feed into its valuation?" },
  { id: "context-character-recent", category: "basics", requires: "character", live: true, text: "What changed most for {character} over recent turns?" },
];

// Starter questions for the single-player games.
//
// Kept deliberately small and mechanism-shaped. These games have no live world
// and no player context, so there are no personal or live variants — every entry
// is answerable from the game's own code. Categories reuse the shared labels.
const GAME_QUESTIONS = {
  "grand-century": [
    { id: "gc-loop", category: "basics", text: "What happens on each tick, and in what order?" },
    { id: "gc-pops", category: "world", text: "How do pops grow, migrate, and change occupation?" },
    { id: "gc-industry", category: "economy", text: "How do factories decide what to produce?" },
    { id: "gc-market", category: "economy", text: "How are prices set on the world market?" },
    { id: "gc-war", category: "world", text: "How does a front advance or break in a war?" },
    { id: "gc-mobilize", category: "world", text: "How are pops turned into armies?" },
    { id: "gc-politics", category: "politics", text: "What gates which reforms a nation can enact?" },
    { id: "gc-diplomacy", category: "politics", text: "How do alliances and casus belli work?" },
    { id: "gc-map", category: "world", text: "Where does the 1820 province map come from?" },
  ],
  metroforge: [
    { id: "mf-demand", category: "world", text: "How is passenger demand generated across the city?" },
    { id: "mf-routing", category: "world", text: "How do passengers choose a route through the network?" },
    { id: "mf-track", category: "basics", text: "What are the rules for laying track and placing stations?" },
    { id: "mf-service", category: "basics", text: "How does a service pattern turn into vehicle movements?" },
    { id: "mf-city", category: "world", text: "How is the street layout generated?" },
    { id: "mf-economy", category: "economy", text: "What determines whether a line makes or loses money?" },
    { id: "mf-growth", category: "world", text: "How does the city react to the network I build?" },
  ],
  electioneer: [
    { id: "el-turn", category: "basics", text: "What happens when I end a campaign turn?" },
    { id: "el-polling", category: "elections", text: "How is polling calculated between turns?" },
    { id: "el-spend", category: "elections", text: "How do ad spending and ground game change the result?" },
    { id: "el-swing", category: "elections", text: "How does a national swing translate into seats?" },
    { id: "el-uk", category: "elections", text: "How do the UK general elections differ from the US ones?" },
    { id: "el-events", category: "world", text: "What events can fire mid-campaign, and what do they change?" },
    { id: "el-scenarios", category: "basics", text: "Which historical elections are playable?" },
  ],
};

const REQUIREMENT_ORDER = { corporation: 0, character: 1, party: 2, country: 3 };

function replacements(context) {
  return {
    country: context?.character?.country || "",
    party: context?.character?.party || "",
    character: context?.character?.name || "",
    corporation: context?.corporation?.name || "",
  };
}

function catalog(context, { liveAvailable = true, game = "ahd" } = {}) {
  // A single-player game has no player context and no live tier, so its list is
  // returned as-is rather than run through the personalisation filters.
  const own = GAME_QUESTIONS[game];
  if (own) {
    return own.map(question => ({
      ...question, label: CATEGORIES[question.category].label, personal: false,
    }));
  }
  const values = replacements(context);
  return QUESTIONS
    .filter((question) => !question.requires || values[question.requires])
    .filter((question) => !question.live || liveAvailable)
    .map((question) => ({
      ...question,
      label: CATEGORIES[question.category].label,
      personal: Boolean(question.requires),
      text: question.text.replace(/\{(country|party|character|corporation)\}/g, (_match, key) => values[key]),
    }))
    .sort((a, b) => {
      if (a.personal !== b.personal) return a.personal ? -1 : 1;
      if (a.personal && b.personal) return REQUIREMENT_ORDER[a.requires] - REQUIREMENT_ORDER[b.requires];
      return 0;
    });
}

function select(items, category = "for-you", offset = 0, limit = 4) {
  const pool = category === "for-you" ? items : items.filter((item) => item.category === category);
  if (!pool.length) return [];
  const start = ((offset % pool.length) + pool.length) % pool.length;
  return Array.from({ length: Math.min(limit, pool.length) }, (_unused, index) => pool[(start + index) % pool.length]);
}

module.exports = { CATEGORIES, QUESTIONS, GAME_QUESTIONS, catalog, select };
