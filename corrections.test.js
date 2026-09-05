"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-corrections-test-"));
process.env.ASK_DB_PATH = path.join(tempDir, "ask.db");
const store = require("./store");
const retrieve = require("./retrieve");
const corrections = require("./corrections");

test.after(() => {
  store.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// A stand-in embedder keyed on the normalised question, so cosine is exact.
const VECTORS = {
  "how do tariffs work": [1, 0, 0],
  "tariff mechanics explained": [0.95, 0.31, 0],       // cos 0.95 to the first
  "what does a tariff do each turn": [0.8, 0.6, 0],    // cos 0.80
  "how are senators elected": [0, 0, 1],               // cos 0
  "what is a bond": [0.3, 0.954, 0],                   // cos 0.30
};
const keyFor = text => String(text).toLowerCase().replace(/\s+/g, " ").replace(/[?.!,]+$/, "").trim();
let embedCalls = [];
const originalEmbedQuery = retrieve.embedQuery;
retrieve.embedQuery = async text => {
  const raw = keyFor(text);
  embedCalls.push(raw);
  const v = VECTORS[raw];
  if (!v) throw new Error(`no vector for ${raw}`);
  return Float32Array.from(v);
};
test.after(() => { retrieve.embedQuery = originalEmbedQuery; });

const cacheKey = q => `game:ahd|plan:general|plain|standard|viz:0|${keyFor(q)}`;
function seedCache() {
  store.db.exec("DELETE FROM answer_cache");
  for (const q of Object.keys(VECTORS)) {
    store.S.putCache.run(cacheKey(q), `answer to ${q}`, "[]", "[]", "m", Date.now());
  }
}

test("the cache key parser returns the question after the fixed prefix and tolerates a bare key", () => {
  assert.equal(store.cacheQuestionOf("game:ahd|plan:general|plain|standard|viz:1|what is a | pipe"), "what is a | pipe");
  assert.equal(store.cacheQuestionOf("legacy question"), "legacy question");
});

test("a downvote evicts the cache entries whose question is within the corrections threshold, not only the exact key", async () => {
  seedCache();
  embedCalls = [];
  const out = await corrections.evictNearCache("How do tariffs work?");
  assert.equal(out.embedded, 5, "every cached question embedded once on first sight");
  assert.equal(out.evicted, 3);
  assert.deepEqual(out.keys.sort(), [cacheKey("how do tariffs work"), cacheKey("tariff mechanics explained"), cacheKey("what does a tariff do each turn")].sort());
  const remaining = store.cacheRows().map(r => store.cacheQuestionOf(r.q)).sort();
  assert.deepEqual(remaining, ["how are senators elected", "what is a bond"]);
  // The survivors keep their vectors, so the next pass embeds only the reported question.
  assert.ok(store.cacheRows().every(r => r.vec && r.vec.length === 12));
  embedCalls = [];
  const again = await corrections.evictNearCache("How are senators elected?");
  assert.deepEqual(embedCalls, ["how are senators elected"]);
  assert.equal(again.embedded, 0);
  assert.equal(again.evicted, 1);
  assert.deepEqual(store.cacheRows().map(r => store.cacheQuestionOf(r.q)), ["what is a bond"]);
});

test("the threshold is the corrections threshold and is overridable", async () => {
  seedCache();
  const strict = await corrections.evictNearCache("How do tariffs work?", { threshold: 0.9 });
  assert.equal(strict.evicted, 2);
  assert.equal(corrections.MATCH_THRESHOLD, Number(process.env.ASK_CORRECTIONS_THRESHOLD || 0.62));
});

test("a dead embedder fails open: nothing evicted, nothing thrown", async () => {
  seedCache();
  const before = store.cacheRows().length;
  const out = await corrections.evictNearCache("something the embedder has never seen");
  assert.deepEqual(out, { evicted: 0, embedded: 0, keys: [] });
  assert.equal(store.cacheRows().length, before);
  assert.deepEqual(await corrections.evictNearCache(""), { evicted: 0, embedded: 0, keys: [] });
});

test("a cached question the embedder cannot embed is skipped rather than blocking the pass", async () => {
  seedCache();
  store.S.putCache.run(cacheKey("unembeddable question here"), "a", "[]", "[]", "m", Date.now());
  const out = await corrections.evictNearCache("How do tariffs work?");
  assert.equal(out.evicted, 3);
  assert.equal(out.embedded, 5);
  const odd = store.cacheRows().find(r => r.q.endsWith("unembeddable question here"));
  assert.equal(odd.vec, null);
});

test("pending drafts are listed oldest first with whether a proposal is ready", () => {
  store.db.exec("DELETE FROM corrections");
  const ins = store.db.prepare("INSERT INTO corrections(question,correction,source_answer_id,added_by,active,created) VALUES(?,?,?,?,?,?)");
  ins.run("older question", "[DRAFT] Needs staff review", 11, "auto", 0, 1000);
  ins.run("newer question", "[DRAFT] Proposed (auto, unverified): tariffs scale", 12, "auto", 0, 2000);
  ins.run("live lesson", "verified truth", null, "staff", 1, 3000);
  ins.run("disabled lesson", "old truth", null, "staff", 0, 4000);
  const drafts = corrections.pendingDrafts();
  assert.deepEqual(drafts.map(d => [d.question, d.proposed, d.source_answer_id]), [["older question", false, 11], ["newer question", true, 12]]);
});
