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
const LIVE_ALLOWLIST = new Set([
  "game_overview", "countries", "entity_search", "parties", "top_players",
  "elections", "fx_quote", "extraction_market", "trace_corp", "trace_sector",
  "trace_election", "trace_race", "trace_approval", "trace_character",
]);

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

const SYSTEM = `You are the research scout for a help system answering player questions about A House Divided, a political and economic strategy game. You do NOT answer the question. You gather the evidence a separate writer will answer from.

Work like an investigator:
- Read the question and the evidence already collected. Decide what is still missing to answer it fully and precisely.
- Call tools to fill exactly those gaps. Follow leads: if an excerpt references a constant, file, or system you have not seen, search for it. If the question names a corporation, country, or election and live tools are available, look it up.
- Prefer few, well-aimed calls. Stop as soon as the evidence would let a careful writer answer with real numbers and mechanisms.
- A search that finds nothing is itself evidence: it means the game likely does not model that thing. Note it, do not keep rephrasing the same hunt more than once.
- When nothing useful is missing, stop calling tools and reply with exactly two lines for the writer:
ESTABLISHED: <what the gathered evidence shows, one compressed sentence>
UNKNOWN: <what you searched for and could not find, or "nothing" if the evidence is complete>

Never call a tool for data about other players' private holdings or hidden information. Public data only.`;

function cap(text, limit = RESULT_CAP) {
  const s = String(text || "");
  return s.length > limit ? s.slice(0, limit) + "\n[truncated]" : s;
}

async function liveToolDefs() {
  try {
    const tools = await mcp.listTools("gamestate");
    if (!tools) return [];
    return tools
      .filter(t => LIVE_ALLOWLIST.has(t.name))
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

async function execute(name, args, { useLive, context }) {
  if (name === "search_code") {
    const found = await retrieve.search(String(args.query || ""), { topK: 5, maxChars: 9000 });
    return found ? found.context : "No matching source found for that query.";
  }
  if (!useLive || !LIVE_ALLOWLIST.has(name)) return "Tool not available for this question.";
  // The asker may only trace themselves. Their own character is the one in the
  // session; any other target is rewritten to it rather than refused, so the
  // model still gets the self-lookup it usually actually wanted.
  if (name === "trace_character") {
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
async function run({ question, context = null, useLive = false, deep = false, onAction = null }) {
  const caps = deep ? CAPS.deep : CAPS.standard;
  const defs = [SEARCH_CODE_DEF, ...(useLive ? await liveToolDefs() : [])];
  const started = Date.now();

  const isStaff = context?.isAdmin === true || context?.isModerator === true;
  const playerLine = context?.character?.name
    ? `\n(The asker plays ${context.character.name}${context.character.country ? ` in ${context.character.country}` : ""}${context.corporation?.name ? `, runs ${context.corporation.name}` : ""}.)`
    : "";
  const staffLine = isStaff
    ? `\n(The asker is STAFF: you MAY trace any named player or corporation they ask about, not only their own.)`
    : "";
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `PLAYER QUESTION: ${question}${playerLine}${staffLine}\n\nLive game tools ${useLive ? "ARE" : "are NOT"} available for this question. Gather what the writer needs.` },
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
      try { result = await execute(name, args, { useLive, context }); } catch (e) { result = `Tool failed: ${String(e.message || e).slice(0, 120)}`; }
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

module.exports = { run, LIVE_ALLOWLIST };
