"use strict";

// One bucket per flagged or downvoted answer, so the miss queue is ranked by
// what actually went wrong rather than by who complained loudest.
//
// Rules run over stored data only (guard trips, attribution coverage, missed
// and invented paths, the refusal detector, fall-through, timing) and decide
// where they can. Where they cannot, one cheap helper-model call fills the
// bucket and the verdict is cached per answer id in answer_buckets, so the
// model is consulted at most once per answer, ever. Nothing here touches a
// player answer.

const answerGuard = require("./answer-guard");

const BUCKETS = ["retrieval_miss", "synthesis_miss", "refusal", "guard_false_positive", "contract_served", "latency_fallthrough", "unknown"];

// Guard trips that record a defect. The other codes record an action the
// pipeline took (escalated_tier, grounding_revised, retrieval_miss_healed,
// answer_contract_repaired) or a contract it served (canonical_answer_contract)
// and are not failures.
const DEFECT_ISSUES = new Set([
  "truncated", "narrated_evidence_bundle", "refused_with_live_evidence", "insufficient_evidence",
  "irrelevant_visualization_withheld", "required_live_map_unavailable", "required_live_dataset_unavailable",
  "required_live_map_missing", "private_military_intelligence_removed", "private_military_evidence_withheld",
]);
const GUARD_STRIP = new Set(["private_military_intelligence_removed", "private_military_evidence_withheld"]);
const LOW_COVERAGE = 0.35;   // matches the support-check note threshold
const HIGH_COVERAGE = 0.7;   // the evidence carried the answer; a defect is the model's
const MIN_SENTENCES = 4;     // coverage over fewer sentences is noise
const SLOW_MS = 60000;

function parse(v) {
  if (v && typeof v === "object") return v;
  try { return JSON.parse(v || "{}") || {}; } catch { return {}; }
}
const list = v => (Array.isArray(v) ? v : []);

function coverageOf(validation) {
  const a = validation?.attribution;
  if (!a || !Number.isFinite(Number(a.coverage)) || Number(a.total || 0) < MIN_SENTENCES) return null;
  return Number(a.coverage);
}

/** The automated verdict: did any deterministic check call this answer defective? */
function isFlagged(validationLike) {
  const v = parse(validationLike);
  if (list(v.issues).some(code => DEFECT_ISSUES.has(code))) return true;
  if (list(v.grounding).length) return true;
  if (list(v.inventedPaths).length) return true;
  // A real file cited that retrieval never supplied: the answer spoke about
  // code it had not read, which is the retrieval-miss signal itself.
  if (list(v.missedPaths).length) return true;
  const coverage = coverageOf(v);
  return coverage != null && coverage < LOW_COVERAGE;
}

function isDownvoted(row) { return row?.feedback_rating === "down" || row?.review_rating === "bad"; }
function isCandidate(row) { return isDownvoted(row) || isFlagged(row?.validation); }

/**
 * Deterministic classification. Returns { bucket, rule } where rule names the
 * evidence that decided it; bucket "unknown" means the rules could not decide.
 */
function classify(row) {
  const v = parse(row?.validation);
  const issues = new Set(list(v.issues));
  const down = isDownvoted(row);
  const coverage = coverageOf(v);
  const retrieval = v.retrieval && typeof v.retrieval === "object" ? v.retrieval : null;
  const has = code => issues.has(code);

  if (has("canonical_answer_contract")) return { bucket: "contract_served", rule: "canonical_answer_contract" };
  if ([...GUARD_STRIP].some(has) && down) return { bucket: "guard_false_positive", rule: "guard strip plus a human report" };
  if (row?.fell_through && (down || Number(row.total_ms) > SLOW_MS)) return { bucket: "latency_fallthrough", rule: "served via fall-through" };
  if (has("refused_with_live_evidence")) return { bucket: "refusal", rule: "refused_with_live_evidence" };
  if (answerGuard.detectRefusal(row?.answer, Boolean(row?.used_mcp))) return { bucket: "refusal", rule: "refusal detector" };
  if (list(v.missedPaths).length) return { bucket: "retrieval_miss", rule: "missedPaths" };
  if (has("insufficient_evidence")) return { bucket: "retrieval_miss", rule: "insufficient_evidence" };
  if (retrieval && retrieval.nHits === 0) return { bucket: "retrieval_miss", rule: "no hits" };
  if (list(v.inventedPaths).length) return { bucket: "synthesis_miss", rule: "inventedPaths" };
  if (has("truncated")) return { bucket: "synthesis_miss", rule: "truncated" };
  if (has("narrated_evidence_bundle")) {
    return coverage != null && coverage >= HIGH_COVERAGE
      ? { bucket: "synthesis_miss", rule: "narrated the bundle with the evidence in hand" }
      : { bucket: "retrieval_miss", rule: "narrated_evidence_bundle" };
  }
  if (coverage != null && coverage >= HIGH_COVERAGE && (down || list(v.grounding).length)) {
    return { bucket: "synthesis_miss", rule: "flagged with high evidence coverage" };
  }
  if (coverage != null && coverage < LOW_COVERAGE && retrieval && Number.isFinite(retrieval.top1)) {
    return retrieval.top1 < 0.5
      ? { bucket: "retrieval_miss", rule: "low coverage and a weak top hit" }
      : { bucket: "synthesis_miss", rule: "low coverage over a strong top hit" };
  }
  if (Number(row?.total_ms) > SLOW_MS && down) return { bucket: "latency_fallthrough", rule: "slow and reported" };
  return { bucket: "unknown", rule: null };
}

const HELPER_SYSTEM = `You classify why a game help answer failed. Pick exactly one bucket:
retrieval_miss: the sources needed for the answer were never retrieved, so the answer is thin, generic, or admits it lacks the file.
synthesis_miss: the right sources were retrieved but the answer misread, contradicted, or ignored them.
refusal: the answer declined or said it lacked access although it could have answered.
guard_false_positive: a safety guard removed or replaced an ordinary rules answer that exposed nothing private.
contract_served: a fixed canonical answer was served and the complaint is about that canonical text.
latency_fallthrough: the answer was late, cut short, or came from a backup model and that is the complaint.
unknown: none of the above can be told from the material.
Reply with the bucket name only.`;

/** One helper-model verdict for a row the rules could not place. null when the helper declines or answers off-list. */
async function classifyWithHelper(row, { complete }) {
  const v = parse(row?.validation);
  const cov = coverageOf(v);
  const user = [
    `QUESTION: ${String(row?.question || "").slice(0, 500)}`,
    `ANSWER: ${String(row?.answer || "").slice(0, 2500)}`,
    `GUARD TRIPS: ${list(v.issues).join(", ") || "none"}`,
    `EVIDENCE COVERAGE: ${cov == null ? "unmeasured" : cov}`,
    `FILES CITED BUT NOT RETRIEVED: ${list(v.missedPaths).join(", ") || "none"}`,
    `PLAYER REPORT: ${row?.feedback_rating === "down" ? (row.feedback_reason || "reported without a reason") : "none"}`,
    `SERVED VIA FALLBACK: ${row?.fell_through ? "yes" : "no"}`,
  ].join("\n");
  let text = null;
  try { text = await complete({ system: HELPER_SYSTEM, question: user, maxTokens: 12, timeoutMs: 15000 }); } catch { return null; }
  const word = String(text || "").toLowerCase().match(/[a-z_]+/g)?.find(w => BUCKETS.includes(w));
  return word && word !== "unknown" ? word : null;
}

/**
 * Bucket every candidate row in the window, using cached helper verdicts for
 * rows the rules left unknown. Synchronous and cheap: it never calls a model.
 */
function report(rows, { buckets = new Map(), perBucket = 10 } = {}) {
  const out = {};
  for (const name of BUCKETS) out[name] = { count: 0, downvoted: 0, questions: [] };
  let total = 0, byRule = 0, byHelper = 0;
  for (const row of rows || []) {
    if (!isCandidate(row)) continue;
    total++;
    let { bucket, rule } = classify(row);
    let method = "rules";
    if (bucket === "unknown") {
      const cached = buckets.get(Number(row.id));
      if (cached && BUCKETS.includes(cached.bucket) && cached.bucket !== "unknown") { bucket = cached.bucket; rule = cached.note || null; method = "helper"; }
    }
    if (method === "rules" && bucket !== "unknown") byRule++;
    if (method === "helper") byHelper++;
    const b = out[bucket];
    b.count++;
    if (isDownvoted(row)) b.downvoted++;
    b.questions.push({
      answerId: row.id, question: String(row.question || "").slice(0, 200), ts: row.ts,
      rating: row.feedback_rating || null, reason: row.feedback_reason ? String(row.feedback_reason).slice(0, 200) : null,
      rule, method,
    });
  }
  // Reported answers first inside each bucket, then newest, and only the top N.
  for (const name of BUCKETS) {
    out[name].questions.sort((x, y) => Number(y.rating === "down") - Number(x.rating === "down") || (y.ts || 0) - (x.ts || 0));
    out[name].questions = out[name].questions.slice(0, perBucket);
  }
  return { total, byRule, byHelper, unknown: out.unknown.count, buckets: out };
}

/**
 * Fill in cached helper verdicts for rows the rules could not place. Bounded
 * per call, fails open, and skips answers already in answer_buckets. Runs in
 * the background from the taxonomy endpoint; never on a player request.
 */
async function classifyPending({ store, llm, sinceMs, limit = 5, log = () => {} } = {}) {
  store = store || require("./store");
  llm = llm || require("./llm");
  const rows = store.taxonomyRows(sinceMs);
  const cached = store.answerBuckets(rows.map(r => r.id));
  const pending = rows.filter(r => isCandidate(r) && !cached.has(Number(r.id)) && classify(r).bucket === "unknown").slice(0, limit);
  let done = 0;
  for (const row of pending) {
    const bucket = await classifyWithHelper(row, { complete: llm.complete });
    if (!bucket) continue;
    store.putAnswerBucket({ answerId: row.id, bucket, method: "helper", model: "helper-chain" });
    done++;
    log(`[taxonomy] answer ${row.id} -> ${bucket}`);
  }
  return { considered: pending.length, classified: done };
}

module.exports = { BUCKETS, DEFECT_ISSUES, classify, classifyWithHelper, report, classifyPending, isFlagged, isDownvoted, isCandidate, coverageOf, HELPER_SYSTEM };
