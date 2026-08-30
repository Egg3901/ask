"use strict";

// The investigator: a bounded agentic loop that gathers evidence BEFORE the
// answer model streams.
//
// The single-shot pipeline (one retrieval pass, one heuristic live-data pass,
// one answer) cannot chase anything: if the first retrieval misses a file or
// the question needs a lookup the heuristics did not anticipate, the answer is
// built on whatever happened to arrive. This loop lets a cheap model decide
// what to look at next, the way an operator would: search the code, see a
// constant it does not recognise, search again; see a corp named in the
// question, pull its public trace.
//
// Boundaries, deliberately hard:
// - It gathers evidence only. The answer model still writes the answer, under
//   the same prompt, guard, and citation pipeline as before.
// - search_code is always available. Live gamestate tools exist only when the
//   request already spent live-data quota (useLive), so a code-only question
//   can never secretly read live state.
// - The live toolset is an allowlist of public, read-only lookups. Forensic
//   and moderation tools (alt detection, account tracing, audit spine, ledger)
//   are excluded outright, and trace_character is forced onto the asker's own
//   character.
// - Hard caps on rounds, tool calls, evidence size and wall clock. On any
//   failure it returns what it has; the pipeline treats null as "no extra
//   evidence", never as an error.
const llm = require("./llm");
const retrieve = require("./retrieve");
const mcp = require("./mcp");
const history = require("./history");
const queryAliases = require("./query-aliases");

// Two effort levels. Deep questions get room to actually chase a thread across
// systems; everything else stays tight so latency stays honest.
const CAPS = {
  standard: {
    rounds: Number(process.env.ASK_INVESTIGATE_ROUNDS || 3),
    calls: Number(process.env.ASK_INVESTIGATE_CALLS || 6),
    deadlineMs: Number(process.env.ASK_INVESTIGATE_DEADLINE_MS || 30000),
    evidenceChars: Number(process.env.ASK_INVESTIGATE_MAX_CHARS || 24000),
  },
  deep: {
    rounds: Number(process.env.ASK_INVESTIGATE_DEEP_ROUNDS || 5),
    calls: Number(process.env.ASK_INVESTIGATE_DEEP_CALLS || 10),
    deadlineMs: Number(process.env.ASK_INVESTIGATE_DEEP_DEADLINE_MS || 60000),
    evidenceChars: Number(process.env.ASK_INVESTIGATE_DEEP_MAX_CHARS || 40000),
  },
};
const RESULT_CAP = 5000;

// Public, read-only gamestate lookups a player could reasonably see themselves.
// Everything not listed here does not exist as far as the investigator knows.
//
// Deliberately excluded, and they stay excluded: trace_account, alt_rank,
// alt_ring_audit, trace_ledger, audit_query, trace_actions. Those are forensic
// and moderation surfaces, not player-visible data. election_sim_results is
// internal balance tooling and is not a player answer either.
const LIVE_ALLOWLIST = new Set([
  "game_overview", "countries", "entity_search", "parties", "top_players",
  "elections", "fx_quote", "trace_corp", "trace_sector",
  "trace_election", "trace_race", "trace_approval", "trace_character",
  // Public aggregates and rankings. Their absence is why Ask told players that
  // rankings, counts and distributions "are not available in the source" while
  // the tools to compute them sat one call away.
  "analytics_catalog", "analytics_query", "corporation_rankings",
  // Map-ready public data, including the candidate-roster filters
  // (electionType / senateClass / party / playersOnly) that candidate-map
  // questions need.
  "map_snapshot", "geo_aggregate",
  // Public country and legislature state.
  "country_fiscal", "legislation_catalog",
  // Own-character wealth snapshot. Pinned to the asker below, exactly like
  // trace_character. trace_bonds stays out: it is a forensic holdings
  // breakdown, and nothing in the failure corpus needed it.
  "character_balance_sheet",
  // The public war record: belligerents, front control, battle verdicts,
  // campaigns, tension. The tool itself enforces the public conflict tier
  // (no rosters, no force composition), so it is safe for any asker.
  "wars",
  // Regional macro trend series ({turn, value} per metric) — the same public
  // data the state pages chart, for "how has X changed" questions.
  "macro_history",
  // Per-turn wealth series for one character. Pinned to the asker below,
  // exactly like character_balance_sheet — history is no less private than
  // the current balance.
  "character_wealth_history",
]);

// Authenticated moderators and admins may use read-only diagnostic surfaces
// for support and enforcement. The public set remains unchanged and is still
// the default everywhere, including Discord Ask.
const MODERATOR_LIVE_ALLOWLIST = new Set([
  ...LIVE_ALLOWLIST,
  "military_roster",
  "extraction_market", "trace_account", "trace_bonds", "trace_ledger",
  "trace_actions", "alt_rank", "alt_ring_audit", "audit_query",
]);

const allowedLiveTools = privateAccess => privateAccess ? MODERATOR_LIVE_ALLOWLIST : LIVE_ALLOWLIST;

// Tools that read one character's private standing. Non-staff askers are pinned
// to their own character on every one of these, never just the first.
const SELF_ONLY_TOOLS = new Set(["trace_character", "character_balance_sheet", "character_wealth_history"]);

const SEARCH_CODE_DEF = {
  type: "function",
  function: {
    name: "search_code",
    description: "Search the game's source code, engineering docs, and wiki for a topic. Returns the most relevant excerpts. Call again with a different query if the first results miss a system, file, or constant you need.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for, phrased like what the relevant code is about." } },
      required: ["query"],
    },
  },
};

const INDEX_BROWSE_DEFS = [
  {
    type: "function",
    function: {
      name: "grep_code",
      description: "Search exact symbols and words in the indexed source. Use after search_code misses a formula, function, constant, or named mechanic. This handles camelCase such as gdpGrowth and works without filesystem access.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Exact mechanic, symbol, phrase, or likely filename to find." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read all indexed chunks for an exact source path returned by search_code or grep_code.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Exact repository-relative source path." } },
        required: ["path"],
      },
    },
  },
];

const CAPABILITY_DEF = {
  type: "function",
  function: {
    name: "list_capabilities",
    description: "List everything Ask can currently retrieve: source evidence, change history, and the public read-only live game tools. Use when asked what Ask, its API, or its tools can provide.",
    parameters: { type: "object", properties: {} },
  },
};

// Change history. Separate from search_code because they answer different
// questions: search_code says what the game does, these say when it started
// doing it. A player reporting that something broke, dropped or "used to" work
// differently is asking the second question, and the code alone cannot answer it.
const HISTORY_TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_history",
      description: "Search the game's shipped change history (real commits on the live branch) for changes to a system. Use when the player says something changed, broke, dropped, or used to work differently — the current code cannot tell you WHEN a mechanic started behaving that way. Pass the file path from a code excerpt to see what recently changed in that exact file.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The system or behaviour in question, in a few words." },
          path: { type: "string", description: "Optional source path from an excerpt, to list changes to that file only." },
          days: { type: "integer", description: "How far back to look. Defaults to 45." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_change",
      description: "Read one shipped change in full: its message, the files it touched, and what it actually altered. Call this on a commit from search_history when you need to say what a change did rather than only that it happened.",
      parameters: {
        type: "object",
        properties: {
          sha: { type: "string", description: "The commit id from search_history." },
          path: { type: "string", description: "Optional: restrict to one file's changes." },
        },
        required: ["sha"],
      },
    },
  },
];

const SYSTEM = `You are the research scout for a help system answering player questions about A House Divided, a political and economic strategy game. You do NOT answer the question. You gather the evidence a separate writer will answer from.

Work like an investigator:
- Read the question and the evidence already collected. Decide what is still missing to answer it fully and precisely.
- Call tools to fill exactly those gaps. Follow leads: if an excerpt references a constant, file, or system you have not seen, search for it. If the question names a corporation, country, or election and live tools are available, look it up.
- If semantic search misses a formula or named mechanic, call grep_code with its exact words or likely camelCase symbol, then read_file on the matching path. Do not report a mechanic absent until both search styles miss it.
- Player wording often names the screen action rather than the code concept. Search close product synonyms too (for example spin off / float / sell a state enterprise may be privatization of a national corporation), and inspect the UI action plus its authorization route before denying that a capability exists.
- When the question names a tracked value from a neighboring subsystem, follow that value. Do not deny it merely because the first named feature does not own it (for example air superiority during the German war belongs to the war and regional air system, not the diplomatic crisis board).
- Treat a player's correction or claimed capability as a strong search lead. Verify it, but do not override it with an absolute "does not exist" conclusion based on one subsystem or one failed wording match.
- If the player asks what Ask, its API, or its tools can provide, call list_capabilities. Do not infer the inventory from examples or source filenames.
- If the player says something changed, broke, dropped, got worse, or used to work differently, search the change history for the files the code excerpts came from, then read the one change that fits. Current code cannot date a change; only the history can.
- Prefer few, well-aimed calls. Stop as soon as the evidence would let a careful writer answer with real numbers and mechanisms.
- A search that finds nothing is itself evidence: it means the game likely does not model that thing. Note it, do not keep rephrasing the same hunt more than once.
- When nothing useful is missing, stop calling tools and reply with exactly two lines for the writer:
ESTABLISHED: <what the gathered evidence shows, one compressed sentence>
UNKNOWN: <what you searched for and could not find, or "nothing" if the evidence is complete>

Never call a tool for data about other players' private holdings or hidden information. Public data only.`;

function needsMechanicEvidence(question) {
  const text = String(question || "");
  return /\b(?:calculat(?:e|ed|ion)|formula|affect(?:s|ed|ing)?|impact|cause|causing|driv(?:e|es|ing)|lower|reduce|cut|curb|raise|increase|decrease|fastest|limits?|how does|what happens if|comes? from|source of|determines?|authority|allowed|possible)\b/i.test(text)
    || /\bcan\b[^?\n]{0,100}\b(?:do|appoint|control|direct|privati[sz]e|spin[\s-]?off|create|buy|sell|change|set|operate|manage)\b/i.test(text);
}

function needsCapabilityInventory(question) {
  return /\b(?:list|show|what|which|everything|all)\b[\s\S]{0,45}\b(?:your|ask(?:'s)?)\s*(?:api|tools?|capabilit(?:y|ies)|data)\b|\b(?:list|show)\b[\s\S]{0,35}\b(?:api|tools?)\b|\bwhat can (?:you|ask) (?:access|retrieve|show|answer)\b/i
    .test(String(question || ""));
}

async function capabilityCatalog(privateAccess = false) {
  const tools = await mcp.listTools("gamestate");
  const allowed = allowedLiveTools(privateAccess);
  const publicTools = Array.isArray(tools)
    ? tools.filter(tool => allowed.has(tool.name)).map(tool => ({
      name: tool.name,
      description: String(tool.description || "").replace(/\s+/g, " ").trim().slice(0, 300),
    }))
    : [];
  return JSON.stringify({
    evidence: [
      "semantic search across executable code, engineering docs, and the player wiki",
      "literal symbol and path search plus reading complete indexed source files",
      "deployed Git change history with commit details",
    ],
    [privateAccess ? "liveModeratorTools" : "livePublicTools"]: publicTools,
    privacy: privateAccess
      ? "This authenticated moderator session may inspect read-only private and forensic records for support and enforcement."
      : "Character-scoped tools are pinned to the signed-in player. Other players' private holdings and hidden information are unavailable.",
  }, null, 2);
}

function cap(text, limit = RESULT_CAP) {
  const s = String(text || "");
  return s.length > limit ? s.slice(0, limit) + "\n[truncated]" : s;
}

async function liveToolDefs(privateAccess = false) {
  try {
    const tools = await mcp.listTools("gamestate");
    if (!tools) return [];
    const allowed = allowedLiveTools(privateAccess);
    return tools
      .filter(t => allowed.has(t.name))
      .map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: String(t.description || "").slice(0, 700),
          parameters: t.inputSchema || { type: "object", properties: {} },
        },
      }));
  } catch { return []; }
}

async function execute(name, args, { useLive, context, game, historyDays, privateAccess = false }) {
  if (name === "list_capabilities") return capabilityCatalog(privateAccess);
  if (name === "search_code") {
    const found = await retrieve.search(String(args.query || ""), { topK: 5, maxChars: 9000, game });
    return found ? found.context : "No matching source found for that query.";
  }
  if (name === "grep_code") {
    const found = retrieve.searchExact(String(args.query || ""), { limit: 8, maxChars: 14000, game });
    return found ? found.context : "No exact indexed source match found for that query.";
  }
  if (name === "read_file") {
    const found = retrieve.readIndexedFile(String(args.path || ""), { maxChars: 18000, game });
    return found ? found.context : "No indexed source file exists at that path.";
  }
  if (name === "search_history") {
    const paths = args.path ? [String(args.path)] : [];
    const found = await history.search({
      game, query: String(args.query || ""), paths,
      sinceDays: Number(args.days) || historyDays || history.SINCE_DAYS,
    });
    if (!found.length) return "No shipped changes found for that in the window searched.";
    const dated = await history.withDeployDates(game, found);
    return await history.lines({ game, commits: dated });
  }
  if (name === "show_change") {
    const c = await history.show({ game, sha: String(args.sha || ""), path: args.path ? String(args.path) : null });
    if (!c) return "No such shipped change (it may not have reached the live branch).";
    const stat = c.files.map(f => `${f.path} +${f.added}/-${f.removed}`).join("\n");
    return [`${c.sha.slice(0, 9)} ${c.date.slice(0, 10)}${c.deployed?.date ? ` (live from ${c.deployed.date.slice(0, 10)})` : ""}: ${c.subject}`,
      c.body ? `\n${c.body.slice(0, 1200)}` : "", `\nFILES:\n${stat}`,
      c.diff ? `\nWHAT CHANGED:\n${c.diff}` : ""].filter(Boolean).join("\n");
  }
  if (!useLive || !allowedLiveTools(privateAccess).has(name)) return "Tool not available for this question.";
  // The asker may only trace themselves. Their own character is the one in the
  // session; any other target is rewritten to it rather than refused, so the
  // model still gets the self-lookup it usually actually wanted.
  if (SELF_ONLY_TOOLS.has(name)) {
    // Staff (admins/moderators) may inspect any character — useful for support
    // and moderation. Everyone else is pinned to their own, so a player can
    // never read another player's private standing.
    const isStaff = context?.isAdmin === true || context?.isModerator === true;
    const requested = args?.character || args?.name;
    if (isStaff && requested) {
      args = { ...args, character: requested, name: requested };
    } else {
      const own = context?.character?.name;
      if (!own) return "Not available: you have no character in this session.";
      args = { ...args, character: own, name: own };
    }
  }
  const out = await mcp.call(name, args, 20000);
  return out || "No result.";
}

/**
 * Run the investigation. Returns { text, tools } or null when nothing was
 * gathered. `text` is a prompt-ready evidence block.
 */
async function run({ question, context = null, useLive = false, deep = false, onAction = null, game = null, changeQuestion = false }) {
  const caps = deep ? CAPS.deep : CAPS.standard;
  const isStaff = context?.isAdmin === true || context?.isModerator === true;
  const historyDefs = (await history.available(game)) ? HISTORY_TOOL_DEFS : [];
  const defs = [SEARCH_CODE_DEF, ...INDEX_BROWSE_DEFS, CAPABILITY_DEF, ...historyDefs, ...(useLive ? await liveToolDefs(isStaff) : [])];
  const historyDays = history.sinceDaysFor(question);
  const started = Date.now();
  const resolution = queryAliases.guidance(question);

  const playerLine = context?.character?.name
    ? `\n(The asker plays ${context.character.name}${context.character.country ? ` in ${context.character.country}` : ""}${context.corporation?.name ? `, runs ${context.corporation.name}` : ""}.)`
    : "";
  const subjectLine = context?.selectedSubject?.name
    ? `\n(The Discord command explicitly selected ${context.selectedSubject.name}${context.selectedSubject.country ? ` in ${context.selectedSubject.country}` : ""} as the public subject. Resolve pronouns to that character, but use only public tools and public facts.)`
    : "";
  const staffLine = isStaff
    ? `\n(The asker is STAFF: you MAY trace any named player or corporation they ask about, not only their own.)`
    : "";
  const messages = [
    { role: "system", content: SYSTEM + (isStaff ? `\n\nPRIVATE MODERATOR ACCESS: This authenticated moderator may inspect private player, corporation, forensic, audit, and hidden records for support or enforcement. Use the available private tools when the question calls for them. The public-data-only restriction above does not apply to this session.` : "") },
    // A cheap scout model reads a conditional instruction in the system prompt
    // as optional and never fires the tool. When the caller already knows this
    // is a change question, say so as an order in the turn it is answering.
    { role: "user", content: `PLAYER QUESTION: ${question}${playerLine}${subjectLine}${staffLine}${resolution ? `\n\nDOMAIN RESOLUTION (required): ${resolution}` : ""}\n\nLive game tools ${useLive ? "ARE" : "are NOT"} available for this question. Gather what the writer needs.${
      changeQuestion && historyDefs.length
        ? `\n\nThis player is reporting that something CHANGED. The current code cannot tell the writer WHEN it changed, so you MUST call search_history — first for the system in the question, then, if a code excerpt points at the file behind it, again with that path. Open the one change that fits with show_change. Do not stop after search_code alone.`
        : ""}` },
  ];

  const blocks = [];
  const used = [];
  const misses = [];
  let assessment = "";
  let calls = 0;

  for (let round = 0; round < caps.rounds; round++) {
    if (Date.now() - started > caps.deadlineMs) break;
    const msg = await llm.chatRaw({ messages, tools: defs, maxTokens: 900, timeoutMs: 20000 });
    if (!msg) break;
    const toolCalls = (msg.tool_calls || []).slice(0, caps.calls - calls);
    if (!toolCalls.length) { assessment = String(msg.content || "").trim(); break; }
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });

    // Independent lookups in one round run concurrently; the round barrier is
    // what lets the model react to what came back.
    const results = await Promise.all(toolCalls.map(async tc => {
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}
      const name = tc.function?.name || "";
      if (onAction) { try { onAction(name, args); } catch {} }
      let result;
      try { result = await execute(name, args, { useLive, context, game, historyDays, privateAccess: isStaff }); } catch (e) { result = `Tool failed: ${String(e.message || e).slice(0, 120)}`; }
      return { tc, name, args, result: cap(result) };
    }));

    for (const { tc, name, args, result } of results) {
      calls++;
      used.push(name);
      // A failed code search is negative evidence, not noise. Recording it lets
      // the writer say "the game does not model X" with confidence instead of
      // bridging the gap with invented mechanics.
      if (name === "search_code" && /^No matching source/.test(result)) misses.push(String(args.query || "").slice(0, 120));
      const budget = caps.evidenceChars - blocks.join("").length;
      if (budget > 200 && !/^(No matching source|No result\.|Tool not available|Tool failed)/.test(result)) {
        blocks.push(`--- ${name}(${JSON.stringify(args).slice(0, 160)}) ---\n${cap(result, budget)}`);
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
    if (calls >= caps.calls) break;
  }

  // The brief matters most when the loop was cut off by a cap: UNKNOWN is where
  // soft misses live (searches that returned chunks, none of them on topic),
  // which literal empty results almost never catch. Force the wrap-up turn if
  // the model never got to write it.
  if (!assessment && blocks.length && Date.now() - started < caps.deadlineMs + 10000) {
    messages.push({ role: "user", content: "Stop investigating. Write the two-line brief now (ESTABLISHED / UNKNOWN), no tool calls." });
    const wrap = await llm.chatRaw({ messages, maxTokens: 300, timeoutMs: 12000 });
    assessment = String(wrap?.content || "").trim();
  }

  if (!blocks.length && !misses.length) return null;
  const parts = [];
  if (blocks.length) parts.push(blocks.join("\n\n"));
  if (misses.length) parts.push(`SEARCHED AND NOT FOUND — the scout searched the code for the following and found nothing. Treat these as strong evidence the game does NOT model them; say so plainly rather than describing how they might work:\n${misses.map(m => `- ${m}`).join("\n")}`);
  if (assessment) parts.push(`SCOUT ASSESSMENT (a compressed brief from the research pass; trust the raw evidence above over this summary if they disagree):\n${assessment.slice(0, 1200)}`);
  return {
    text: `INVESTIGATION EVIDENCE (gathered live for this question by a research pass; same authority rules apply — code excerpts rank as code, live tool output ranks as live data):\n\n${parts.join("\n\n")}`,
    tools: used,
    misses,
    assessment,
  };
}

module.exports = {
  run, needsMechanicEvidence, needsCapabilityInventory, capabilityCatalog,
  LIVE_ALLOWLIST, MODERATOR_LIVE_ALLOWLIST, SELF_ONLY_TOOLS,
};
