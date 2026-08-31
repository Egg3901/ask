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
const corrections = require("./corrections");

// A refusal the grader flagged as correct behavior (declining to leak private
// or opponent data) is not a quality failure, so it should not seed a draft.
const LEGIT_REFUSAL = /\bprivate|fair.?play|opponent|not a failure|legitimate|confidential\b/i;

const SAMPLE_RATE = clampRate(process.env.ASK_AUDIT_SAMPLE);
const MAX_ANSWER_CHARS = 4000;

// Validation issues that make an answer worth grading regardless of the sample
// draw. Each one is a deterministic guard trip, not a guess: the answer either
// described its own retrieval bundle, stopped mid-sentence, declined while
// holding live evidence, or had a chart pulled because it was about something
// else. All four were top failure classes in the corpus audit.
const AUDIT_ALWAYS = new Set([
  "narrated_evidence_bundle",
  "truncated",
  "refused_with_live_evidence",
  "answer_contract_repaired",
  "irrelevant_visualization_withheld",
  "required_live_map_missing",
  "required_live_map_unavailable",
  "required_live_dataset_unavailable",
]);

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
function maybeAudit({ answerId = null, question, answer, hadLive = false, issues = [] }) {
  // A random 15% draw is the right way to measure the baseline and the wrong way
  // to catch known-suspect answers. The output guards already decided this one
  // looks wrong — narrated its own evidence, stopped mid-sentence, refused with
  // live data in hand — so it gets graded every time, not one time in seven.
  const flagged = Array.isArray(issues) && issues.some(i => AUDIT_ALWAYS.has(i));
  if (!flagged && !shouldSample()) return;
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
      // The sampler judging an answer as not-answered is a later-discovered
      // failure: credit the question back and tell the player in-game.
      if (verdict.answered === false) {
        try { require("./notify").creditBack(answerId, "sampler judged the answer as not answering", "refund"); } catch { /* advisory */ }
      }
      if (verdict.answered === false) {
        console.warn(`[ask] audit FLAG answerId=${answerId ?? "?"} refused=${verdict.refused} live=${hadLive ? 1 : 0} note=${JSON.stringify(verdict.note)}`);
        // Seed a staff-review draft, unless the grader judged it a correct
        // refusal of private data. Dedup lives in corrections.draft().
        if (!LEGIT_REFUSAL.test(verdict.note || "")) {
          corrections.draft({ question, reason: `sampler: unanswered — ${verdict.note || "no detail"}`, sourceAnswerId: answerId })
            .catch(() => {});
        }
      }
    })
    .catch(() => { /* advisory only */ });
}

module.exports = { maybeAudit, grade, parseVerdict, shouldSample, SAMPLE_RATE, AUDIT_ALWAYS };
