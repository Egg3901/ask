"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const taxonomy = require("./failure-taxonomy");

let nextId = 1;
const ANSWER = "Tariffs apply per turn to every imported unit, scaled by the rate the legislature set. The revenue lands in the treasury the same turn.";
function row(validation = {}, extra = {}) {
  return {
    id: nextId++, question: "How do tariffs work?", answer: ANSWER, validation: JSON.stringify({ issues: [], grounding: [], inventedPaths: [], missedPaths: [], ...validation }),
    feedback_rating: null, review_rating: null, feedback_reason: null, fell_through: null, total_ms: 5000, used_mcp: 0, ts: nextId, ...extra,
  };
}
const attribution = (coverage, total = 8) => ({ attribution: { coverage, total, supported: Math.round(coverage * total), semantic: true, weak: [], sentences: [] } });

test("isFlagged reads defects, not actions the pipeline took", () => {
  assert.equal(taxonomy.isFlagged({ issues: ["truncated"] }), true);
  assert.equal(taxonomy.isFlagged({ issues: ["escalated_tier", "grounding_revised", "retrieval_miss_healed"] }), false);
  assert.equal(taxonomy.isFlagged({ issues: [], grounding: ["claim x unsupported"] }), true);
  assert.equal(taxonomy.isFlagged({ issues: [], inventedPaths: ["src/lib/nope.ts"] }), true);
  assert.equal(taxonomy.isFlagged(attribution(0.2)), true);
  assert.equal(taxonomy.isFlagged(attribution(0.2, 2)), false, "coverage over two sentences is noise");
  assert.equal(taxonomy.isFlagged(JSON.stringify({ issues: ["insufficient_evidence"] })), true);
  assert.equal(taxonomy.isFlagged("not json"), false);
});

test("a canonical contract answer is contract_served whatever else is on the row", () => {
  const r = row({ issues: ["canonical_answer_contract", "truncated"] }, { feedback_rating: "down" });
  assert.equal(taxonomy.classify(r).bucket, "contract_served");
});

test("a guard strip is a false positive only when a human said so; alone it is left for the helper", () => {
  assert.equal(taxonomy.classify(row({ issues: ["private_military_intelligence_removed"] }, { feedback_rating: "down" })).bucket, "guard_false_positive");
  assert.equal(taxonomy.classify(row({ issues: ["private_military_evidence_withheld"] }, { review_rating: "bad" })).bucket, "guard_false_positive");
  assert.equal(taxonomy.classify(row({ issues: ["private_military_intelligence_removed"] })).bucket, "unknown");
});

test("fall-through is the bucket when it was reported or slow, otherwise the row keeps classifying", () => {
  assert.equal(taxonomy.classify(row({}, { fell_through: "gemini-3.6-flash", feedback_rating: "down" })).bucket, "latency_fallthrough");
  assert.equal(taxonomy.classify(row({}, { fell_through: "gemini-3.6-flash", total_ms: 95000 })).bucket, "latency_fallthrough");
  assert.equal(taxonomy.classify(row({ missedPaths: ["src/lib/turn/tariffs.ts"] }, { fell_through: "gemini-3.6-flash" })).bucket, "retrieval_miss");
  assert.equal(taxonomy.classify(row({}, { total_ms: 95000, feedback_rating: "down" })).bucket, "latency_fallthrough");
});

test("refusals: the guard code or the deterministic detector", () => {
  assert.equal(taxonomy.classify(row({ issues: ["refused_with_live_evidence"] })).bucket, "refusal");
  const refused = row({}, { answer: "I don't have access to that data for this country.", used_mcp: 1, feedback_rating: "down" });
  assert.equal(taxonomy.classify(refused).bucket, "refusal");
  assert.equal(taxonomy.classify(refused).rule, "refusal detector");
});

test("retrieval misses: a cited path never supplied, no evidence, or no hits at all", () => {
  assert.equal(taxonomy.classify(row({ missedPaths: ["src/lib/turn/tariffs.ts"] })).bucket, "retrieval_miss");
  assert.equal(taxonomy.classify(row({ issues: ["insufficient_evidence"] })).bucket, "retrieval_miss");
  assert.equal(taxonomy.classify(row({ retrieval: { top1: null, gap15: null, overlap: null, nHits: 0, budgetUsed: null, chunkLenP50: null } }, { feedback_rating: "down" })).bucket, "retrieval_miss");
  assert.equal(taxonomy.classify(row({ issues: ["narrated_evidence_bundle"] })).bucket, "retrieval_miss");
});

test("synthesis misses: the evidence was there and the answer still went wrong", () => {
  assert.equal(taxonomy.classify(row({ inventedPaths: ["src/lib/invented.ts"] })).bucket, "synthesis_miss");
  assert.equal(taxonomy.classify(row({ issues: ["truncated"] })).bucket, "synthesis_miss");
  assert.equal(taxonomy.classify(row({ issues: ["narrated_evidence_bundle"], ...attribution(0.85) })).bucket, "synthesis_miss");
  assert.equal(taxonomy.classify(row({ ...attribution(0.9) }, { feedback_rating: "down" })).bucket, "synthesis_miss");
  assert.equal(taxonomy.classify(row({ grounding: ["one claim unsupported"], ...attribution(0.8) })).bucket, "synthesis_miss");
});

test("low coverage splits on the retrieval signal: weak top hit is retrieval, strong top hit is synthesis", () => {
  const weak = row({ ...attribution(0.2), retrieval: { top1: 0.31, gap15: 0.02, overlap: null, nHits: 6, budgetUsed: 0.4, chunkLenP50: 900 } });
  const strong = row({ ...attribution(0.2), retrieval: { top1: 0.82, gap15: 0.3, overlap: null, nHits: 8, budgetUsed: 0.6, chunkLenP50: 1200 } });
  assert.equal(taxonomy.classify(weak).bucket, "retrieval_miss");
  assert.equal(taxonomy.classify(strong).bucket, "synthesis_miss");
  // Low coverage with no retrieval features recorded cannot be split by rule.
  assert.equal(taxonomy.classify(row(attribution(0.2))).bucket, "unknown");
});

test("a bare downvote with nothing else on the row is unknown, not guessed", () => {
  const r = taxonomy.classify(row({}, { feedback_rating: "down", feedback_reason: "wrong" }));
  assert.equal(r.bucket, "unknown");
  assert.equal(r.rule, null);
});

test("report buckets every candidate once, prefers reported answers, caps per bucket, and uses cached helper verdicts", () => {
  const rows = [
    row({ issues: ["escalated_tier"] }),                                   // not a candidate
    row({ missedPaths: ["a.ts"] }),
    row({ missedPaths: ["b.ts"] }, { feedback_rating: "down", ts: 50 }),
    row({ missedPaths: ["c.ts"] }, { ts: 99 }),
    row({ issues: ["truncated"] }),
    row({}, { feedback_rating: "down" }),                                  // unknown by rule
    row({}, { feedback_rating: "down" }),                                  // unknown, cached below
  ];
  const cached = new Map([[rows[6].id, { bucket: "synthesis_miss", method: "helper", note: "misread the rate table" }]]);
  const out = taxonomy.report(rows, { buckets: cached, perBucket: 2 });
  assert.equal(out.total, 6);
  assert.equal(out.byRule, 4);
  assert.equal(out.byHelper, 1);
  assert.equal(out.unknown, 1);
  assert.equal(out.buckets.retrieval_miss.count, 3);
  assert.equal(out.buckets.retrieval_miss.downvoted, 1);
  assert.equal(out.buckets.retrieval_miss.questions.length, 2, "perBucket cap");
  assert.equal(out.buckets.retrieval_miss.questions[0].answerId, rows[2].id, "reported answer first");
  assert.equal(out.buckets.synthesis_miss.count, 2);
  assert.equal(out.buckets.synthesis_miss.questions.find(q => q.answerId === rows[6].id).method, "helper");
  assert.equal(out.buckets.synthesis_miss.questions.find(q => q.answerId === rows[6].id).rule, "misread the rate table");
  assert.deepEqual(Object.keys(out.buckets), taxonomy.BUCKETS);
});

test("the helper verdict is accepted only when it names a bucket other than unknown", async () => {
  const r = row({}, { feedback_rating: "down" });
  assert.equal(await taxonomy.classifyWithHelper(r, { complete: async () => " Synthesis_miss\n" }), "synthesis_miss");
  assert.equal(await taxonomy.classifyWithHelper(r, { complete: async () => "unknown" }), null);
  assert.equal(await taxonomy.classifyWithHelper(r, { complete: async () => "the answer was fine" }), null);
  assert.equal(await taxonomy.classifyWithHelper(r, { complete: async () => { throw new Error("dead"); } }), null);
  assert.equal(await taxonomy.classifyWithHelper(r, { complete: async () => null }), null);
});

test("classifyPending asks the helper only about unplaced candidates with no cached verdict, within the limit", async () => {
  const rows = [
    row({ missedPaths: ["a.ts"] }),                     // rules decide, never sent
    row({}, { feedback_rating: "down" }),               // unknown, cached, never sent
    row({}, { feedback_rating: "down" }),               // unknown, sent
    row({}, { feedback_rating: "down" }),               // unknown, sent
    row({}, { feedback_rating: "down" }),               // unknown, beyond the limit
    row({ issues: ["escalated_tier"] }),                // not a candidate
  ];
  const stored = [];
  const store = {
    taxonomyRows: () => rows,
    answerBuckets: () => new Map([[rows[1].id, { bucket: "refusal" }]]),
    putAnswerBucket: entry => { stored.push(entry); return true; },
  };
  const asked = [];
  const llm = { complete: async ({ question }) => { asked.push(question); return "retrieval_miss"; } };
  const out = await taxonomy.classifyPending({ store, llm, sinceMs: 0, limit: 2 });
  assert.equal(out.considered, 2);
  assert.equal(out.classified, 2);
  assert.deepEqual(stored.map(s => s.answerId), [rows[2].id, rows[3].id]);
  assert.equal(stored[0].bucket, "retrieval_miss");
  assert.equal(stored[0].method, "helper");
  assert.match(asked[0], /PLAYER REPORT/);
});
