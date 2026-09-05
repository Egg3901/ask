"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const digest = require("./scripts/weekly-digest");

function health() {
  return {
    since: 1, answers: { total: 164, live: 40, up: 6, down: 16 },
    audience: { active: 30, previousActive: 28, activeToday: 5, newUsers: 3, byProvider: { ahd: 20, discord: 10 }, questionsPerDay: 23.4 },
    audits: { total: 20, not_answered: 2, refused: 1 },
    corrections: { active: 0, draftsPending: 11, drafts: [{ id: 4, question: "How do carriers work?", proposed: true }, { id: 9, question: "Why did my bond price fall?", proposed: false }] },
    retrieval: { n: 150, top1: { n: 150, p10: 0.41, p50: 0.63, p90: 0.81 }, gap15: { n: 150, p10: 0.02, p50: 0.11, p90: 0.3 }, overlap: { n: 0, p10: null, p50: null, p90: null }, nHits: { n: 150, p10: 4, p50: 8, p90: 16 }, budgetUsed: { n: 150, p10: 0.2, p50: 0.55, p90: 0.95 }, chunkLenP50: { n: 150, p10: 400, p50: 1100, p90: 2600 } },
    taxonomy: { total: 24, byRule: 20, byHelper: 2, unknown: 2, buckets: {
      retrieval_miss: { count: 5, downvoted: 1, examples: ["What does the port cost?"] },
      synthesis_miss: { count: 3, downvoted: 2, examples: ["How are tariffs applied?"] },
      refusal: { count: 0, downvoted: 0, examples: [] },
      guard_false_positive: { count: 13, downvoted: 13, examples: ["What do the ship types do?"] },
      contract_served: { count: 1, downvoted: 0, examples: ["What is Ask?"] },
      latency_fallthrough: { count: 0, downvoted: 0, examples: [] },
      unknown: { count: 2, downvoted: 2, examples: ["hmm"] },
    } },
    calibration: { since: 1, n: 164, nRated: 22, kappa: 0.21, kappaRated: 0.4, matrix: { flaggedAndReported: 5, flaggedNotReported: 12, cleanButReported: 11, cleanNotReported: 136 }, history: [{ week: "2026-W36", since: 1, kappa: 0.21 }, { week: "2026-W35", since: 0, kappa: 0.18 }] },
    embedding: { ok: true }, docConflictsOpen: 1, docConflicts: [{ source: "wiki", page: "Tariffs", claim: "5% flat", actual: "scaled", seen: 3 }],
    issues: [{ issue: "escalated_tier", n: 34 }],
    retrievalMisses: [{ path: "src/lib/turn/ports.ts", misses: 1, downvotes: 1, meanCoverage: 0.2, priority: 1.6, last_ts: 1 }],
    models: [{ model: "gemini-3.6-flash", served: 100, sampled: 100, ttftP50: 2100, ttftP90: 5200, viaFallthrough: 0, flagged: 3 }],
  };
}

test("requiring the digest script does not run it", () => {
  assert.equal(typeof digest.format, "function");
});

test("the digest carries one line per failure bucket, the judge kappa, the pending drafts, and miss priority", () => {
  const body = digest.format(health());
  assert.match(body, /11 drafts waiting for review/);
  assert.match(body, /draft #4: "How do carriers work\?" \(proposal ready\)/);
  assert.match(body, /Retrieval confidence \(150 answers\): top hit p50 0\.63 \(p10 0\.41\)/);
  assert.match(body, /Failures by bucket \(24 flagged or reported, 2 unplaced\)/);
  assert.match(body, /· guard_false_positive ×13 \(13 reported\): "What do the ship types do\?"/);
  assert.match(body, /· retrieval_miss ×5 \(1 reported\)/);
  assert.match(body, /· contract_served ×1: "What is Ask\?"/);
  assert.doesNotMatch(body, /· refusal ×0/);
  assert.doesNotMatch(body, /· unknown ×/);
  assert.match(body, /Judge vs humans: kappa 0\.21 over 164 answers \(rated only 0\.40 over 22\) · caught 5 of 16 reports · 12 flags unconfirmed · 2026-W35 was 0\.18/);
  assert.match(body, /`src\/lib\/turn\/ports\.ts` ×1, 1 reported, coverage 0\.20, priority 1\.6/);
  assert.ok(body.length <= 1900);
  assert.match(body, /Console:/, "the console link survives the length cap on a full week");
});

test("an empty week omits the sections it has nothing for", () => {
  const h = health();
  h.retrieval = { n: 0 };
  h.taxonomy = { total: 0, buckets: {} };
  h.calibration = { n: 0 };
  h.corrections = { active: 0, draftsPending: 0, drafts: [] };
  const body = digest.format(h);
  assert.doesNotMatch(body, /Retrieval confidence/);
  assert.doesNotMatch(body, /Failures by bucket/);
  assert.doesNotMatch(body, /Judge vs humans/);
  assert.match(body, /0 drafts waiting for review/);
});
