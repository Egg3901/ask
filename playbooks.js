"use strict";

// Distilled investigation playbooks. Each entry encodes how an experienced
// operator actually diagnoses this class of question — the order of checks,
// the denominator traps, the tool that is authoritative when two disagree.
// These are METHODS, not facts: a fact about the game belongs in the
// corrections store where staff can retire it; a method belongs here because
// it survives balance patches.
//
// `scout` lines steer the research pass (investigate.run). `writer` lines are
// appended to the answer prompt so the final model applies the same judgment
// to the evidence it was handed.

const PLAYBOOKS = [
  {
    id: "wealth_trend",
    match: /\b(?:my|his|her|their)?\s*(?:wealth|net worth|portfolio|fortune)\b.*\b(?:over|trend|chang|grow|histor|since|dropp|fell|rose)|\b(?:wealth|net worth) (?:over time|history|trend)\b/i,
    scout: "For wealth-over-time questions the per-turn portfolio series (character_wealth_history) is authoritative; the balance sheet is a cash snapshot and understates anyone holding stocks. Pull the series, then name the single largest move and check what turn it happened.",
    writer: "A cash balance is not a wealth trend. If the evidence includes a per-turn wealth series, build the answer on the series and treat the balance-sheet cash figure as one component only.",
  },
  {
    id: "regional_macro",
    match: /\b(?:unemployment|gdp|inflation|growth|wages?|labou?r force|migration|population)\b.*\b(?:in|for|across)\s+[A-Z]|\b(?:state|region|country)\b.*\b(?:unemployment|gdp|inflation|wages?)\b/i,
    scout: "Macro trend series are keyed by STATE or REGION id, not by country. For a country-level question, resolve the country's states first (entity_search or countries), then read the state series or use an analytics aggregate. A miss on the country name does not mean the data is absent.",
    writer: "If a regional series was fetched for a country-level question, say which regions the numbers cover rather than presenting one state as the whole country.",
  },
  {
    id: "market_share",
    match: /\b(?:market share|market gap|uncovered|dominat\w+|TAM|sell (?:more|into)|demand for|who (?:buys|controls))\b/i,
    scout: "Market denominators differ by direction: selling is scoped to a country's market, buying to a state's. A global total includes markets the player cannot reach, so never compute a share against the global figure without saying so. Prefer the precomputed market tables when the live pass produced them.",
    writer: "Name the denominator on any share you state (this country's market, this state's demand, or global). A share of an unreachable global total is not actionable and must be labeled as context, not opportunity.",
  },
  {
    id: "war_status",
    match: /\b(?:war|front|battle|invasion|offensive|casualt|ground (?:gain|loss)|winning|losing)\b/i,
    scout: "War data is the public conflict record only: belligerents, front control, verdicts, tension. Force composition, rosters and strength rankings are hidden by design; do not chase them, state the fog-of-war rule instead. When narrating ground shifts use the named winner field, never a signed percentage you interpret yourself.",
    writer: "State outcomes in terms of who gained ground and what the front shows. If the question asks who is 'stronger', say plainly that force strength is fogged by design and pivot to the public record.",
  },
  {
    id: "election_result",
    match: /\b(?:election|primary|seat|ballot|runoff|won|lost|vote share|polling)\b.*\b(?:why|how|wrong|unfair|robbed|stolen|lost|missing)|\b(?:lost|missing|taken)\b.*\bseat\b/i,
    scout: "Before concluding anything about a disputed race, pull that exact race (trace_race or trace_election) and compare the tally to the complaint. Check the era's electoral rules for that chamber, and whether the seat count changed from apportionment rather than votes.",
    writer: "Ground any election explanation in the specific race's numbers from the evidence. Never tell a player a seat they currently hold was wrongly won; if tally and complaint disagree, show both and say which mechanic explains the gap.",
  },
  {
    id: "election_debrief",
    match: /\b(?:why (?:did|have) (?:i|we|my)\b.{0,60}\b(?:lo(?:se|st)|w[io]n)|what (?:cost|lost) (?:me|us)\b|debrief\b.{0,40}\b(?:race|election|campaign)|post[- ]?mortem\b.{0,40}\b(?:race|election))/i,
    scout: "Debrief a resolved race from its record: pull the exact race (trace_race), the asker's approval history around it (trace_approval), and the era's electoral rules for that chamber. Decompose the margin: turnout, favorability, incumbency, party lean, apportionment changes. Use calculate for every gap you quote. If the race is still LIVE, gather only public standing and stop: forecasting a contested race is off limits.",
    writer: "Structure the debrief: the actual margin first, then the two or three channels that moved it (with numbers from the tally), then what was structural versus playable, then ONE concrete lesson for next time. Never tell a player a seat someone currently holds was wrongly won, and never predict an unresolved race.",
  },
  {
    id: "economy_causal",
    match: /\b(?:why (?:is|are|did|has|have)|what(?:'s| is) (?:causing|driving)|crash|spik\w+|collaps\w+|plummet\w+|soar\w+)\b.*\b(?:price|inflation|gdp|market|econom|stock|profit|revenue|wage|unemployment|currency|exchange)\b/i,
    scout: "For a 'why did X move' question, establish the timeline first: when did it move (trend series), what shipped near that turn (change history), and what does the current pulse show. A mechanic explanation without a date is a guess. Seeded configuration is not the live world; read live values before blaming a constant.",
    writer: "Causal answers need a when before a why. Lead with what the series shows and anchor the mechanism to the turn where the move started; if the evidence cannot date the move, say that instead of asserting a cause.",
  },
  {
    id: "fx",
    match: /\b(?:exchange rate|forex|fx|currency|convert|devalu|appreciat\w+ against)\b/i,
    scout: "Quote the exact pair asked about, and check the history direction: a pair that looks absurd is usually quoted the other way around or era-scaled. Pull a short history so the writer can say whether the level is normal for this era.",
    writer: "State the pair direction explicitly (how much of B one unit of A buys) and whether the current level is in line with its recent history.",
  },
];

/** All playbooks whose pattern matches the question. */
function matches(question) {
  const text = String(question || "");
  return PLAYBOOKS.filter(p => p.match.test(text));
}

/** Scout-facing method lines, or "" when nothing matches. */
function scoutBrief(question) {
  const hit = matches(question);
  if (!hit.length) return "";
  return `INVESTIGATION METHOD (distilled from how operators diagnose this class of question — follow it):\n${hit.map(p => `- ${p.scout}`).join("\n")}`;
}

/** Writer-facing method lines, or "" when nothing matches. */
function writerBrief(question) {
  const hit = matches(question);
  if (!hit.length) return "";
  return `ANSWER METHOD FOR THIS QUESTION CLASS:\n${hit.map(p => `- ${p.writer}`).join("\n")}`;
}

module.exports = { matches, scoutBrief, writerBrief, PLAYBOOKS };
