"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const confidence = require("./retrieval-confidence");

const hit = (path, ord, score, len) => ({ path, ord, score, text: "x".repeat(len) });

test("features come from hits[].score and hits[].text only", () => {
  const result = { hits: [
    hit("a.ts", 0, 0.91, 1000), hit("b.ts", 1, 0.80, 3000), hit("c.ts", 0, 0.75, 500),
    hit("d.ts", 2, 0.70, 2000), hit("e.ts", 0, 0.61, 4000), hit("f.ts", 0, 0.50, 100),
  ] };
  const f = confidence.features(result, { maxChars: 22000 });
  assert.equal(f.top1, 0.91);
  assert.equal(f.gap15, 0.3);
  assert.equal(f.nHits, 6);
  assert.equal(f.chunkLenP50, 2000);
  assert.equal(f.budgetUsed, Number((10600 / 22000).toFixed(3)));
  assert.equal(f.overlap, null);
});

test("hits are ranked before the gap is measured, whatever order they arrive in", () => {
  const result = { hits: [hit("a", 0, 0.2, 10), hit("b", 0, 0.9, 10), hit("c", 0, 0.5, 10)] };
  const f = confidence.features(result);
  assert.equal(f.top1, 0.9);
  assert.equal(f.gap15, 0.7);
});

test("an empty or null result reports nothing rather than zeros", () => {
  assert.deepEqual(confidence.features(null), { top1: null, gap15: null, overlap: null, nHits: 0, budgetUsed: null, chunkLenP50: null });
  assert.deepEqual(confidence.features({ hits: [] }), { top1: null, gap15: null, overlap: null, nHits: 0, budgetUsed: null, chunkLenP50: null });
  const single = confidence.features({ hits: [hit("a", 0, 0.4, 50)] });
  assert.equal(single.top1, 0.4);
  assert.equal(single.gap15, null);
  assert.equal(single.nHits, 1);
});

test("budget use is capped at 1 and hits without a numeric score are ignored", () => {
  const f = confidence.features({ hits: [hit("a", 0, 0.5, 30000), { path: "b", ord: 0, score: "n/a", text: "y" }] }, { maxChars: 10000 });
  assert.equal(f.nHits, 1);
  assert.equal(f.budgetUsed, 1);
});

test("overlap is the share of the smaller retriever list the other also found", () => {
  const dense = ["a#0", "b#0", "c#0", "d#0"];
  const lexical = [{ path: "c", ord: 0 }, { path: "a", ord: 0 }];
  assert.equal(confidence.overlapOf(dense, lexical), 1);
  assert.equal(confidence.overlapOf(dense, ["z#9", "a#0"]), 0.5);
  assert.equal(confidence.overlapOf(dense, []), null);
  const f = confidence.features({ hits: [hit("a", 0, 0.5, 10)] }, { dense, lexical });
  assert.equal(f.overlap, 1);
});

test("distribution reports p10/p50/p90 per feature and n: 0 for a feature never recorded", () => {
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push({ top1: i / 10, gap15: null, overlap: null, nHits: i, budgetUsed: 0.5, chunkLenP50: 100 * i });
  const d = confidence.distribution(rows);
  assert.equal(d.top1.n, 10);
  assert.equal(d.top1.p10, 0.2);
  assert.equal(d.top1.p50, 0.6);
  assert.equal(d.top1.p90, 1);
  assert.equal(d.nHits.p50, 6);
  assert.equal(d.overlap.n, 0);
  assert.equal(d.overlap.p50, null);
  assert.equal(d.gap15.n, 0);
  assert.deepEqual(Object.keys(d), confidence.FEATURES);
});
