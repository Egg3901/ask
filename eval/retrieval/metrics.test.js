"use strict";
// Hand-computed fixtures for every metric the harness reports. If one of
// these fails, the baseline numbers cannot be trusted; fix the metric, not
// the fixture.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./lib/metrics.js");

const q = (obj) => new Map(Object.entries(obj));
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("A: single relevant at rank 1 and delivered", () => {
  const m = M.queryMetrics({ ranked: ["r1", "u1", "u2", "u3"], delivered: ["r1", "u1"], qrel: q({ r1: 2 }) });
  assert.equal(m["recall@4"], 1);
  assert.equal(m["recall@8"], 1);
  assert.equal(m["success@1"], 1);
  assert.equal(m.mrr, 1);
  assert.equal(m["ndcg@10"], 1);
  assert.equal(m["recall@budget"], 1);
  assert.equal(m.truncation_loss, 0);
  near(m["unjudged@8"], 0.75);
});

test("B: relevant ranked 3rd but dropped by the char budget", () => {
  const m = M.queryMetrics({ ranked: ["u1", "u2", "r1", "u3", "u4"], delivered: ["u1", "u2", "u3"], qrel: q({ r1: 2 }), configK: 8 });
  assert.equal(m["recall@4"], 1);
  assert.equal(m["success@1"], 0);
  near(m.mrr, 1 / 3);
  assert.equal(m["ndcg@10"], 1);
  assert.equal(m["recall@budget"], 0);
  assert.equal(m.truncation_loss, 1);
  assert.equal(m.budget_loss, 1);
  assert.equal(m["hit@8"], 1);
  assert.equal(m["hit@budget"], 0);
});

test("C: mixed grades with unjudged docs; nDCG over the condensed list only", () => {
  const m = M.queryMetrics({
    ranked: ["u1", "a", "u2", "b", "u3", "u4"], delivered: ["u1", "a", "u2"],
    qrel: q({ a: 1, b: 2, z: 0 }), configK: 2,
  });
  assert.equal(m.relevant, 2);
  assert.equal(m.judged, 3);
  assert.equal(m["recall@4"], 1);
  assert.equal(m["recall@config"], 0.5);          // top-2 = [u1, a]
  assert.equal(m["success@1"], 0);                 // unjudged at rank 1 earns nothing
  assert.equal(m.mrr, 0.5);
  // condensed = [a(1), b(2)]: DCG = 1/log2(2) + 3/log2(3) = 2.892789; IDCG = 3 + 1/log2(3) = 3.630930
  near(m["ndcg@10"], 0.79671);
  assert.equal(m["recall@budget"], 0.5);
  assert.equal(m.truncation_loss, 0.5);
  assert.equal(m.budget_loss, 0);
  near(m["unjudged@8"], 4 / 6);
  assert.equal(m["recall@8_strict"], 1);           // only b is grade 2, at rank 4
  assert.equal(m["recall@budget_strict"], 0);
  assert.deepEqual(m.docs.map(d => [d.docid, d.rank, d.delivered]), [["a", 2, true], ["b", 4, false]]);
});

test("D: no relevant judged doc makes rank metrics undefined and aggregate skips them", () => {
  const m = M.queryMetrics({ ranked: ["z", "u1"], delivered: ["z"], qrel: q({ z: 0 }) });
  assert.equal(m["recall@8"], null);
  assert.equal(m.mrr, null);
  assert.equal(m["ndcg@10"], null);
  assert.equal(m["recall@budget"], null);
  assert.equal(m.truncation_loss, null);
  assert.equal(m["hit@budget"], null);
  assert.equal(m["unjudged@8"], 0.5);
  const agg = M.aggregate([m, { "recall@8": 1 }, { "recall@8": 0 }]);
  assert.equal(agg["recall@8"].mean, 0.5);
  assert.equal(agg["recall@8"].n, 2);
  assert.equal(agg["mrr"].n, 0);
  assert.equal(agg["mrr"].mean, null);
});

test("E: score ties break by docid so ranking never depends on input order", () => {
  const a = M.orderByScore([{ docid: "b", score: 0.5 }, { docid: "a", score: 0.5 }, { docid: "c", score: 0.9 }]);
  const b = M.orderByScore([{ docid: "a", score: 0.5 }, { docid: "c", score: 0.9 }, { docid: "b", score: 0.5 }]);
  assert.deepEqual(a.map(h => h.docid), ["c", "a", "b"]);
  assert.deepEqual(b.map(h => h.docid), ["c", "a", "b"]);
  const m = M.queryMetrics({ ranked: a.map(h => h.docid), delivered: [], qrel: q({ b: 2 }) });
  near(m.mrr, 1 / 3);
  assert.equal(m["recall@budget"], 0);
});

test("F: more relevant docs than K", () => {
  const m = M.queryMetrics({
    ranked: ["a", "u1", "u2", "b", "u3", "u4", "u5", "c"], delivered: ["a", "u1"],
    qrel: q({ a: 2, b: 2, c: 1 }),
  });
  near(m["recall@4"], 2 / 3);
  assert.equal(m["recall@8"], 1);
  assert.equal(m["recall@16"], 1);
  assert.equal(m["success@1"], 1);
  assert.equal(m.mrr, 1);
  near(m["ndcg@10"], 1);                            // condensed [2,2,1] is already ideal
  near(m["recall@budget"], 1 / 3);
  near(m.truncation_loss, 2 / 3);
  assert.equal(m["hit@8"], 1);
  assert.equal(m["hit@budget"], 1);
});

test("G: a judged non-relevant doc at rank 1 stays in the condensed list", () => {
  const m = M.queryMetrics({ ranked: ["z", "a", "u1"], delivered: ["z", "a"], qrel: q({ z: 0, a: 2 }) });
  assert.equal(m["success@1"], 0);
  assert.equal(m.mrr, 0.5);
  near(m["ndcg@10"], 1.892789 / 3);                 // DCG = 0 + 3/log2(3); IDCG = 3
  assert.equal(m["recall@budget"], 1);
  near(m["unjudged@8"], 1 / 3);
});

test("H: relevant doc beyond the nDCG cutoff still counts for recall@16", () => {
  const nonrel = Array.from({ length: 10 }, (_, i) => `n${i}`);
  const qrel = q(Object.fromEntries([...nonrel.map(d => [d, 0]), ["a", 2]]));
  const m = M.queryMetrics({ ranked: [...nonrel, "a"], delivered: [], qrel });
  assert.equal(m["ndcg@10"], 0);
  assert.equal(m["recall@8"], 0);
  assert.equal(m["hit@8"], 0);
  assert.equal(m["recall@16"], 1);
  near(m.mrr, 1 / 11);
});

test("I: duplicate delivered docids are not double counted", () => {
  const m = M.queryMetrics({ ranked: ["a", "b"], delivered: ["a", "a"], qrel: q({ a: 2, b: 2 }) });
  assert.equal(m["recall@budget"], 0.5);
});

test("J: dcg helper matches the textbook definition", () => {
  near(M.dcgOf([2, 1, 0]), 3 + 1 / Math.log2(3));
  assert.equal(M.dcgOf([]), 0);
});
