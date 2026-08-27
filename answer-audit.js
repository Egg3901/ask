"use strict";

// Production answer sampler. A random fraction of shipped answers is re-read by
// a free helper model that judges one thing: did this actually answer the
// question, or did it refuse/dodge? The verdict is logged for staff, never
// shown to the player and never used to block or rewrite a response. It exists
// to surface the refusal-bias failure pattern with real traffic instead of a
// fixed eval set.
//
// Everything here fails open. A dead helper, a timeout, or a malformed verdict
// logs nothing and costs the request nothing — it runs after res.end().
const llm = require("./llm");
const store = require("./store");

const SAMPLE_RATE = clampRate(process.env.ASK_AUDIT_SAMPLE);
const MAX_ANSWER_CHARS = 4000;

function clampRate(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.15; // default: audit 15% of answers
  return Math.max(0, Math.min(1, n));
}

function shouldSample() {
  return SAMPLE_RATE > 0 && Math.random() < SAMPLE_RATE;
}

const SYSTEM = `You are a strict QA grader for a game Q&A assistant. You are given a player QUESTION and the ANSWER the assistant returned. Judge only whether the answer actually addressed the question.

Reply with ONE line of compact JSON and nothing else:
{"answered": true|false, "refused": true|false, "confidence": 0.0-1.0, "note": "<=12 words"}

- answered=false when the reply dodges, gives only a formula when a number was asked for, or says it lacks data/access.
- refused=true when the reply declines with "I can't", "I don't have access", "I don't know", "unable to", or similar.
- A legitimate refusal to leak private/opponent data still counts as refused=true but is not a failure — say so in the note.
- confidence is your certainty in the verdict.
Return only the JSON object.`;

function parseVerdict(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  const answered = typeof obj.answered === "boolean" ? obj.answered : null;
  const refused = typeof obj.refused === "boolean" ? obj.refused : null;
  if (answered === null && refused === null) return null;
  let confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) confidence = null;
  else confidence = Math.max(0, Math.min(1, confidence));
  return { answered, refused, confidence, note: String(obj.note || "").slice(0, 200) };
}

// Grade one answer. Returns the verdict object or null. Exposed for tests and
// for an on-demand staff "audit this answer" action.
async function grade({ question, answer, hadLive = false }) {
  const q = String(question || "").trim();
  const a = String(answer || "").trim();
  if (q.length < 4 || a.length < 4) return null;
  const user = `QUESTION:\n${q}\n\nANSWER:\n${a.slice(0, MAX_ANSWER_CHARS)}\n\nLive game data was ${hadLive ? "available" : "NOT available"} for this answer.`;
  let text;
  try {
    text = await llm.complete({ system: SYSTEM, question: user, maxTokens: 120, timeoutMs: 15000 });
  } catch { return null; }
  return parseVerdict(text);
}

// Fire-and-forget from the request handler AFTER the answer is recorded and the
// stream is closed. Awaiting this would add a free-model round-trip to every
// sampled request, so callers must not await it.
function maybeAudit({ answerId = null, question, answer, hadLive = false }) {
  if (!shouldSample()) return;
  Promise.resolve()
    .then(() => grade({ question, answer, hadLive }))
    .then(verdict => {
      if (!verdict) return;
      store.recordAudit({
        answerId, question, hadLive,
        answered: verdict.answered, refused: verdict.refused,
        confidence: verdict.confidence, note: verdict.note,
        model: "helper-chain",
      });
      if (verdict.answered === false) {
        console.warn(`[ask] audit FLAG answerId=${answerId ?? "?"} refused=${verdict.refused} live=${hadLive ? 1 : 0} note=${JSON.stringify(verdict.note)}`);
      }
    })
    .catch(() => { /* advisory only */ });
}

module.exports = { maybeAudit, grade, parseVerdict, shouldSample, SAMPLE_RATE };
