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

const REVISE_SYSTEM = `You revise an answer from a grounded game assistant. An audit found specific claims about game mechanics that the supplied evidence does not support.

Rewrite the answer so it no longer asserts those claims:
- If the evidence supports a corrected version of a flagged claim, state the corrected version.
- If it does not, remove the claim, or reframe it in one clause as general reasoning explicitly not confirmed by the game's code.
- Keep everything else — structure, numbers, tables, tone, length — as close to the original as possible.
- Never mention this audit, the evidence bundle, tools, or prompts.
Return only the revised answer.`;

/**
 * Corrective pass: instead of stapling a "grounding check" caveat under an
 * answer that asserts invented mechanics, rewrite the answer without them.
 * Returns { text, model, usage } or null; callers fall back to the caveat.
 */
async function revise({ question, answer, claims, evidence, complete = llm.completeResult }) {
  if (!claims?.length) return null;
  const result = await complete({
    system: REVISE_SYSTEM,
    question: `QUESTION:\n${String(question || "").slice(0, 2000)}\n\nUNSUPPORTED CLAIMS (the audit findings to fix):\n${claims.map(c => `- ${c}`).join("\n")}\n\nANSWER TO REVISE:\n${String(answer || "").slice(0, 12000)}\n\nEVIDENCE:\n${String(evidence || "").slice(0, 40000)}`,
    maxTokens: 2400,
    timeoutMs: 25000,
  });
  const text = String(result?.text || "").trim();
  // A revision that collapses to a stub lost the answer; keep the original.
  if (!text || text.length < Math.min(200, String(answer || "").length * 0.3)) return null;
  return { text, model: result.model || null, ...(result.usage ? { usage: result.usage } : {}) };
}

const CONDENSE_SYSTEM = `You rewrite a follow-up question into one standalone search query for a code retrieval system over a strategy game's source.

The follow-up only makes sense inside the conversation ("what about the UK?", "and if I lose?"). Combine it with the conversation so the query names the actual systems, entities, and mechanics being asked about. Reply with ONLY the query text, under 30 words.`;

// Being later in a thread does not make a complete new question a semantic
// follow-up. Condensing every turn let old mechanics leak into topic pivots.
const CONTEXT_REFERENCE = /^(?:and|also|but|so|then)\b|^(?:can|could) you (?:explain|expand|elaborate|show|clarify)\b|\b(?:what|how) about\b|\b(?:the |your )?(?:previous|prior|last|earlier) (?:answer|claim|part|point|response)\b|\b(?:that|this|those|these|it) (?:answer|claim|part|point|mechanic|system|number|result|work|happen|mean)\b|\b(?:the|those|these) (?:scores?|numbers?|ones?|values?|options?|tabs?)\b|\b(?:verify|fact-check|audit|check) (?:that|this|it|the previous|the prior|the last|your answer)\b/i;
const STANDALONE_TOPIC = /\b(?:blockad(?:e|ing|ed)?|logistics|supply|close air support|CAS|air superiority|battle|war|election|inflation|GDP|corporation|company|tax|government|debt|trade|market|bill|cabinet|party|campaign|commodity|unemployment|exchange rate|currency|sanction|migration|referendum)\b/i;

function needsConversationContext(question) {
  const text = String(question || "").trim();
  if (!text) return false;
  const genericPointer = /\bthe (?:scores?|numbers?|ones?|values?|options?|tabs?)\b/i.test(text);
  const reference = CONTEXT_REFERENCE.test(text);
  if (reference && genericPointer && STANDALONE_TOPIC.test(text)) return false;
  return reference
    || (text.length < 100 && /^(?:why|where|when|who|which one|can it|does it|is it|are they)\b/i.test(text) && !STANDALONE_TOPIC.test(text));
}

const CONTEXT_TERM_STOP = new Set(["What", "How", "Where", "When", "Why", "Which", "Available", "The", "This", "That"]);
const CONTEXT_PHRASES = [
  "blockade",
  "air superiority",
  "Naval and air command",
  "battle role",
  "battle post",
  "battle odds",
  "front bar",
  "nuclear stockpile",
];

function namedContextTerms(historyTurns, question) {
  if (!/\b(?:scores?|stats?|these|those|them|it|that|this|increase|raise|lower)\b/i.test(String(question || ""))) return [];
  const priorUser = [...(historyTurns || [])].reverse().find(turn => turn?.role === "user");
  if (!priorUser) return [];
  const words = String(priorUser.content || priorUser.question || "").match(/\b[A-Z][a-zA-Z]{3,}\b/g) || [];
  return [...new Set(words.filter(word => !CONTEXT_TERM_STOP.has(word)))].slice(0, 8);
}

function restoreContextTerms(query, historyTurns, question) {
  const base = String(query || "").trim();
  const standalone = base.length >= 8 && base.length <= 300 ? base : String(question || "").trim();
  if (!standalone) return null;
  const thread = (historyTurns || []).map(turn => String(turn?.content || turn?.question || "")).join("\n");
  const phrases = needsConversationContext(question)
    ? CONTEXT_PHRASES.filter(phrase => new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "i").test(thread))
    : [];
  const missing = [...namedContextTerms(historyTurns, question), ...phrases]
    .filter(term => !standalone.toLowerCase().includes(term.toLowerCase()));
  return missing.length ? `${standalone}: ${[...new Set(missing)].join(", ")}`.slice(0, 300) : standalone;
}

/**
 * Standalone retrieval query for a follow-up turn. "What about the UK?" embeds
 * uselessly on its own; fused with the thread it retrieves what the player
 * actually means. Returns null on any failure, callers fall back to the raw
 * question.
 */
async function condense(historyTurns, question) {
  if (!needsConversationContext(question)) return String(question || "").trim() || null;
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
  return restoreContextTerms(q, historyTurns, question);
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

/**
 * Split cited-but-unread paths into the two cases that need different handling.
 *
 * `invented` — no such file in the indexed corpus. The model made it up.
 * `missed`   — the file is real; retrieval simply did not supply it.
 *
 * Measured over the shipped corpus: 19 of 22 were `missed`, not `invented`. The
 * old single bucket told players to distrust nineteen correct citations, which
 * degrades a right answer for a reason that is our fault, not the model's.
 *
 * `exists` is injected (retrieve.hasPath) so this stays pure and testable.
 */
function classifyPaths(answer, evidenceText, exists) {
  const flagged = inventedPaths(answer, evidenceText);
  const missed = [], invented = [];
  for (const p of flagged) {
    if (typeof exists === "function" && exists(p)) missed.push(p);
    else invented.push(p);
  }
  return { missed, invented };
}

/** Player-facing note for invented file paths. Empty string when there are none. */
function pathNote(paths) {
  if (!paths || !paths.length) return "";
  return `\n\n> **Source check:** ${paths.join(", ")} ${paths.length === 1 ? "does" : "do"} not exist in the game's source, so treat claims resting on ${paths.length === 1 ? "it" : "them"} as unverified.`;
}

/**
 * Player-facing note for a real file the answer cited without reading.
 *
 * Deliberately gentler than pathNote: the path is right, so saying it "was not
 * among the files I read" reads as though the citation were bogus. The honest
 * caveat is narrower — the file exists, but this answer did not verify against
 * its contents.
 */
function missedPathNote(paths) {
  if (!paths || !paths.length) return "";
  const one = paths.length === 1;
  return `\n\n> **Source check:** ${paths.join(", ")} ${one ? "is a real file but was" : "are real files but were"} not open in front of me for this answer, so the specifics I attribute to ${one ? "it" : "them"} are from recall rather than a direct read.`;
}

/** Player-facing note for ungrounded claims. Empty string when there are none. */
function note(claims) {
  if (!claims || !claims.length) return "";
  return `\n\n> **Grounding check:** the game code I read does not confirm: ${claims.map(c => c.trim().replace(/\.$/, "")).join("; ")}. Treat those parts as general reasoning, not confirmed game rules.`;
}

module.exports = { decompose, check, revise, note, condense, needsConversationContext, namedContextTerms, restoreContextTerms, inventedPaths, pathNote, classifyPaths, missedPathNote };
