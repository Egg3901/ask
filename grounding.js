// Two helper passes around the main answer, both fail-open.
//
// decompose(): one embedding cannot cover a question that spans several game
// systems. A cheap model splits the question into per-system search queries so
// retrieval can union them (retrieve.searchMulti). Measured motivation: the
// benched inflation/bonds/deficit case, where the missing file was one system
// over from everything the single query found.
//
// check(): more evidence does not stop a model inventing the connective tissue
// between systems (Phillips curves, credit-rating decay — all judged ungrounded
// on the deep bench even with the wide retrieval window). Post-answer, the same
// cheap model lists game-mechanic claims the excerpts do not support, and the
// answer gets an honest note instead of silent confident invention.
const llm = require("./llm");

const DECOMPOSE_SYSTEM = `You write search queries for a code retrieval system over a strategy game's source (A House Divided: elections, parties, government, corporations, markets, bonds, inflation, military, turns).

Split the player's question into 2 to 4 short search queries, each targeting ONE distinct game system or mechanic the question touches. Queries should read like what the relevant code is about, not like the question.

Only reply with an empty array when the question plainly names a single mechanic. When in doubt, split: a redundant query costs nothing, a missing one loses the evidence.
Reply with ONLY a JSON array of strings.`;

async function decompose(question) {
  const raw = await llm.complete({ system: DECOMPOSE_SYSTEM, question: String(question || ""), maxTokens: 300, timeoutMs: 8000 });
  if (!raw) return [];
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter(q => typeof q === "string" && q.trim().length >= 3).slice(0, 4);
  } catch { return []; }
}

const CHECK_SYSTEM = `You audit an answer produced by a game help system for A House Divided. The system must only describe game mechanics that appear in the source excerpts it was given.

List claims in the ANSWER about how THE GAME works that the EXCERPTS do not support: invented formulas, invented thresholds, real-world economics or politics presented as if the game models it.

Do NOT flag: claims the excerpts support, hedged statements ("the code does not show..."), general real-world background clearly framed as background, or navigation/UI advice.

Reply with ONLY a JSON object: {"ungrounded":["short claim", ...]} with at most 4 entries, each under 15 words. Reply {"ungrounded":[]} if the answer is grounded.`;

async function check(answer, context) {
  const user = `EXCERPTS:\n${String(context || "").slice(0, 80000)}\n\nANSWER:\n${String(answer || "").slice(0, 30000)}`;
  const raw = await llm.complete({ system: CHECK_SYSTEM, question: user, maxTokens: 400, timeoutMs: 25000 });
  if (!raw) return [];
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const out = JSON.parse(m[0]);
    if (!Array.isArray(out.ungrounded)) return [];
    return out.ungrounded.filter(c => typeof c === "string" && c.trim()).slice(0, 4);
  } catch { return []; }
}

const CONDENSE_SYSTEM = `You rewrite a follow-up question into one standalone search query for a code retrieval system over a strategy game's source.

The follow-up only makes sense inside the conversation ("what about the UK?", "and if I lose?"). Combine it with the conversation so the query names the actual systems, entities, and mechanics being asked about. Reply with ONLY the query text, under 30 words.`;

/**
 * Standalone retrieval query for a follow-up turn. "What about the UK?" embeds
 * uselessly on its own; fused with the thread it retrieves what the player
 * actually means. Returns null on any failure, callers fall back to the raw
 * question.
 */
async function condense(historyTurns, question) {
  const thread = (historyTurns || [])
    .map(t => `Q: ${String(t.content || t.question || "").slice(0, 300)}`)
    .join("\n");
  if (!thread) return null;
  const raw = await llm.complete({
    system: CONDENSE_SYSTEM,
    question: `CONVERSATION SO FAR:\n${thread.slice(0, 2400)}\n\nFOLLOW-UP: ${question}`,
    maxTokens: 80, timeoutMs: 6000,
  });
  const q = String(raw || "").trim().replace(/^["']|["']$/g, "");
  return q.length >= 8 && q.length <= 300 ? q : null;
}

// Mechanical grounding: a file path named in the answer that was never in the
// evidence is an invention, detectable with zero model calls. This was a bench
// validator (2 invented paths measured on DeepSeek Flash); now it runs on every
// answer.
const PATH_RE = /\b(?:src|app|lib|scripts|design|prisma|public)\/[\w./-]+\.(?:ts|tsx|js|jsx|json|md)\b/g;

/** Paths the answer cites that the supplied evidence never contained. */
function inventedPaths(answer, evidenceText) {
  const known = new Set((String(evidenceText || "").match(PATH_RE) || []));
  const out = new Set();
  for (const p of String(answer || "").match(PATH_RE) || []) {
    // A cited parent is fine: naming src/lib/turn/bondTurn.ts when the evidence
    // shows that exact path, or a sub-path of it, is grounded.
    if (!known.has(p) && ![...known].some(k => k.endsWith(p) || p.endsWith(k))) out.add(p);
  }
  return [...out];
}

/** Player-facing note for invented file paths. Empty string when there are none. */
function pathNote(paths) {
  if (!paths || !paths.length) return "";
  return `\n\n> **Source check:** ${paths.join(", ")} ${paths.length === 1 ? "was" : "were"} not among the files I actually read for this answer, so treat claims resting on ${paths.length === 1 ? "it" : "them"} with caution.`;
}

/** Player-facing note for ungrounded claims. Empty string when there are none. */
function note(claims) {
  if (!claims || !claims.length) return "";
  return `\n\n> **Grounding check:** the game code I read does not confirm: ${claims.map(c => c.trim().replace(/\.$/, "")).join("; ")}. Treat those parts as general reasoning, not confirmed game rules.`;
}

module.exports = { decompose, check, note, condense, inventedPaths, pathNote };
