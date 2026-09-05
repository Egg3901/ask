"use strict";
// Integrity of the committed gold set. Cheap, no index needed. If this fails
// the results files built from the gold set are not comparable.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readQrels } = require("./lib/trec.js");
const { KINDS } = require("./lib/curation.js");

const GOLD = path.join(__dirname, "gold");
const jsonl = f => fs.readFileSync(path.join(GOLD, f), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const queries = jsonl("queries.jsonl");
const qrels = readQrels(path.join(GOLD, "qrels.txt"));
const sidecar = new Map(jsonl("qrels.sidecar.jsonl").map(r => [r.docid, r]));
const summary = JSON.parse(fs.readFileSync(path.join(GOLD, "summary.json"), "utf8"));

test("every query has a kind, a split and a unique qid", () => {
  const ids = new Set();
  for (const q of queries) {
    assert.ok(KINDS.includes(q.kind), `${q.qid} kind ${q.kind}`);
    assert.ok(["dev", "heldout"].includes(q.split), `${q.qid} split ${q.split}`);
    assert.ok(!ids.has(q.qid), `duplicate qid ${q.qid}`);
    ids.add(q.qid);
    assert.ok(q.text.length >= 8);
  }
});

test("qrels and queries agree; every judged docid is described in the sidecar", () => {
  const qids = new Set(queries.map(q => q.qid));
  for (const [qid, docs] of qrels) {
    assert.ok(qids.has(qid), `qrels qid ${qid} not in queries`);
    for (const [docid, grade] of docs) {
      assert.ok([0, 1, 2].includes(grade), `${qid} ${docid} grade ${grade}`);
      const s = sidecar.get(docid);
      assert.ok(s, `no sidecar for ${docid}`);
      assert.match(s.hash, /^[0-9a-f]{40}$/);
      assert.match(s.bodySha1, /^[0-9a-f]{40}$/);
      assert.ok(["code", "docs", "wiki"].includes(s.sourceKind));
      assert.ok(["s<800", "m800-2000", "l2000-4000", "xl4000+"].includes(s.lengthBucket));
    }
  }
  for (const q of queries) {
    const docs = qrels.get(q.qid);
    assert.ok(docs && docs.size === q.judged, `${q.qid} judged ${q.judged} vs qrels ${docs ? docs.size : 0}`);
    assert.equal([...docs.values()].filter(g => g >= 1).length, q.relevant, `${q.qid} relevant count`);
  }
});

test("synthetic queries carry exactly their origin chunk at grade 2", () => {
  for (const q of queries.filter(q => q.source === "synthetic")) {
    const docs = qrels.get(q.qid);
    assert.equal(docs.size, 1);
    assert.equal(docs.get(q.origin.docid), 2);
    assert.equal(sidecar.get(q.origin.docid).hash, q.origin.hash);
  }
});

test("split is 70/30 within every (source group, kind) stratum, up to rounding", () => {
  const strata = new Map();
  for (const q of queries) {
    const k = `${q.source === "synthetic" ? "synthetic" : "real"}|${q.kind}`;
    if (!strata.has(k)) strata.set(k, { dev: 0, heldout: 0 });
    strata.get(k)[q.split]++;
  }
  for (const [k, s] of strata) {
    const n = s.dev + s.heldout;
    assert.equal(s.dev, Math.round(n * 0.7), `${k}: dev ${s.dev} of ${n}`);
  }
});

test("no dashes and no player names leaked into committed query text", () => {
  for (const q of queries) {
    assert.doesNotMatch(q.text, /[–—]/, q.qid);
    assert.doesNotMatch(q.text, /\bEgg\b|Nikolaus|Bakhyt|tweamonster|<@\d+>/i, q.qid);
  }
});

test("summary records the snapshot hash and matches the files", () => {
  assert.match(summary.snapshot.sha256, /^[0-9a-f]{64}$/);
  assert.equal(summary.queries, queries.length);
  assert.equal(summary.judgedPairs, [...qrels.values()].reduce((a, m) => a + m.size, 0));
});
