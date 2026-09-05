"use strict";

// Hybrid fusion v2 on a synthetic corpus with controlled vectors, plus the
// pure helpers behind it. Nothing here needs an index build or an embedder.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-fusion-v2-"));
const dbPath = path.join(dir, "index.db");
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE chunks(id INTEGER PRIMARY KEY,source_kind TEXT,repository TEXT,revision TEXT,path TEXT,ord INTEGER,text TEXT,vec BLOB,dims INTEGER);
  CREATE TABLE source_revisions(kind TEXT,repository TEXT,revision TEXT,indexed_at TEXT,files INTEGER,chunks INTEGER);
  CREATE TABLE meta(k TEXT,v TEXT);
`);
const insert = db.prepare("INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?,?)");
const unit = v => { const n = Math.hypot(...v); return Float32Array.from(v.map(x => x / n)); };
let nextId = 0;
const add = (kind, p, ord, text, v) =>
  insert.run(++nextId, kind, kind === "docs" ? "docs" : "game", `${kind}123`, p, ord, text, Buffer.from(unit(v).buffer), 3);

// Two adjacent chunks of one file in the chunker's shape: a header line, then
// bodies whose last and first 400 chars are byte-identical.
// Non-periodic filler, so the shared span occurs exactly once per body.
const filler = (seed, n) => {
  let x = seed >>> 0 || 1;
  return Array.from({ length: n }, () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return String.fromCharCode(97 + ((x >>> 16) % 26));
  }).join("");
};
const body1 = "cloture vote threshold rule: " + filler(1, 900);
const shared = body1.slice(-400);
const body2 = shared + " second part of the cloture rule " + filler(5, 500);
add("code", "src/lib/senate/cloture.ts", 0, `[code] src/lib/senate/cloture.ts (part 1/2)\n${body1}`, [1, 0, 0]);
add("code", "src/lib/senate/cloture.ts", 1, `[code] src/lib/senate/cloture.ts (part 2/2)\n${body2}`, [0.98, 0.2, 0]);
add("docs", "design/cloture.md", 0, "cloture design intent for the senate", [0.9, 0.44, 0]);
add("wiki", "src/lib/seeds/wiki/content/senate.ts", 0, "cloture guide for players", [0.85, 0.53, 0]);
add("code", "src/lib/other/unrelated.ts", 0, "banana bread recipe", [0, 1, 0]);
add("code", "src/lib/constants/leadership.ts", 0, "export const LEADERSHIP_INACTIVE_TURN_THRESHOLD = 6;", [0, 0, 1]);
add("code", "src/lib/turn/leadership.ts", 0, "if (turnsInactive >= LEADERSHIP_INACTIVE_TURN_THRESHOLD) removeLeader(); // LEADERSHIP_INACTIVE_TURN_THRESHOLD", [0.1, 0, 0.99]);
for (const kind of ["code", "docs", "wiki"]) db.prepare("INSERT INTO source_revisions VALUES(?,?,?,?,?,?)")
  .run(kind, kind === "docs" ? "docs" : "game", `${kind}123`, "2026-09-05T00:00:00.000Z", 1, 1);
db.prepare("INSERT INTO meta VALUES('generation','fixture')").run();
db.exec(`CREATE VIRTUAL TABLE chunks_fts USING fts5(text,source_kind UNINDEXED,path UNINDEXED,content='chunks',content_rowid='id');
  INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');`);
db.close();

const CLOTURE = "How many cloture votes are required?";
const IDENT = "What is LEADERSHIP_INACTIVE_TURN_THRESHOLD?";
const QUERY_VECTORS = { [CLOTURE]: [1, 0, 0], [IDENT]: [1, 0, 0] };

process.env.RAG_DB = dbPath;
delete process.env.RAG_FUSION;
global.fetch = async (_url, init) => {
  const text = String(JSON.parse(init.body).input).replace(/^search_query: /, "");
  return { ok: true, json: async () => ({ embeddings: [Array.from(unit(QUERY_VECTORS[text] || [1, 0, 0]))] }) };
};
const retrieve = require("./retrieve");
const { __debug: d } = retrieve;

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("minMax rescales one retriever's candidates to [0,1] and treats a flat list as found", () => {
  assert.deepEqual(d.minMax([3, 1, 2]), [1, 0, 0.5]);
  assert.deepEqual(d.minMax([5]), [1]);
  assert.deepEqual(d.minMax([2, 2]), [1, 1]);
  assert.deepEqual(d.minMax([]), []);
});

test("v2 fuses normalised dense and lexical scores by CombSUM under the authority multiplier", async () => {
  const parts = await d.candidates(CLOTURE, { fusion: "v2" });
  assert.equal(parts.mode, "v2");
  assert.equal(parts.claimType, "mechanic");
  assert.deepEqual(parts.weights, { dense: 0.6, lexical: 0.4 });
  for (const list of [parts.dense, parts.lexical]) {
    for (const c of list) assert.ok(c.score >= 0 && c.score <= 1, `normalised score out of range: ${c.score}`);
  }
  const byKey = new Map(parts.fused.map(c => [`${c.path}#${c.ord}`, c]));
  const both = byKey.get("src/lib/senate/cloture.ts#0");
  assert.equal(both.dense, 1, "best cosine normalises to 1");
  assert.ok(both.lexical > 0, "found by FTS too");
  for (const c of parts.fused) {
    assert.ok(Math.abs(c.score - c.authority * (0.6 * c.dense + 0.4 * c.lexical)) < 1e-12, `CombSUM broken for ${c.path}`);
  }
  const denseOnly = byKey.get("src/lib/other/unrelated.ts#0");
  assert.equal(denseOnly.lexical, 0);
  // Code outranks the wiki restatement for a mechanics question, as legacy intends.
  assert.equal(parts.fused[0].path, "src/lib/senate/cloture.ts");
  assert.ok(parts.fused.findIndex(c => c.source === "wiki") > parts.fused.findIndex(c => c.source === "docs"));
});

test("identifier-shaped questions shift the weight to the lexical side; env overrides the defaults", async () => {
  assert.equal(d.identifierShaped("What is LEADERSHIP_INACTIVE_TURN_THRESHOLD?"), true);
  assert.equal(d.identifierShaped("what does bondTurn do"), true);
  assert.equal(d.identifierShaped("read src/lib/turn/bondTurn.ts"), true);
  assert.equal(d.identifierShaped("How is GDP growth computed by the FOMC?"), false);
  const ident = await d.candidates(IDENT, { fusion: "v2" });
  assert.deepEqual(ident.weights, { dense: 0.4, lexical: 0.6 });
  process.env.RAG_FUSION_DENSE_W = "0.8";
  process.env.RAG_FUSION_DENSE_W_IDENT = "0.25";
  try {
    assert.deepEqual((await d.candidates(CLOTURE, { fusion: "v2" })).weights, { dense: 0.8, lexical: 0.19999999999999996 });
    assert.deepEqual((await d.candidates(IDENT, { fusion: "v2" })).weights, { dense: 0.25, lexical: 0.75 });
  } finally {
    delete process.env.RAG_FUSION_DENSE_W;
    delete process.env.RAG_FUSION_DENSE_W_IDENT;
  }
});

test("applyFloor keeps exact identifier hits inside the top-5 window without reordering the rest", () => {
  const mk = (key, exact = false) => ({ key, exact, score: 0 });
  const [a, b, c, dd, e, f, g] = ["a", "b", "c(ex)", "d", "e", "f", "g(ex)"].map(k => mk(k, k.includes("ex")));
  const out = d.applyFloor([a, b, c, dd, e, f, g], 5);
  assert.deepEqual(out.map(x => x.key), ["a", "b", "c(ex)", "d", "g(ex)", "e", "f"]);
  assert.deepEqual(d.applyFloor([a, b], 5).map(x => x.key), ["a", "b"], "no exact hits: untouched");
  // More exact hits than the window holds: the best five are protected, the rest compete normally.
  const many = Array.from({ length: 9 }, (_, i) => mk(`x${i}`, i >= 3));
  const floored = d.applyFloor(many, 5);
  assert.deepEqual(floored.slice(0, 5).map(x => x.key), ["x3", "x4", "x5", "x6", "x7"]);
  assert.deepEqual(floored.slice(5).map(x => x.key), ["x0", "x1", "x2", "x8"]);
});

test("an exact identifier hit with no semantic signal still lands in the top five", async () => {
  const parts = await d.candidates(IDENT, { fusion: "v2" });
  const exact = parts.lexical.filter(l => l.exact).map(l => l.path).sort();
  assert.deepEqual(exact, ["src/lib/constants/leadership.ts", "src/lib/turn/leadership.ts"]);
  const positions = parts.fused.map((c, i) => [c.path, i, c.exact]).filter(([, , ex]) => ex);
  assert.equal(positions.length, 2);
  for (const [p, i] of positions) assert.ok(i < 5, `${p} ranked at ${i}`);
  // The weaker of the two normalises to 0 on both retrievers and would sink without the floor.
  assert.ok(parts.fused.some(c => c.exact && c.score === 0));
  const found = await retrieve.search(IDENT, { fusion: "v2", topK: 8 });
  assert.deepEqual(found.hits.slice(0, 2).map(h => h.path).sort(), ["src/lib/constants/leadership.ts", "src/lib/turn/leadership.ts"]);
});

test("rrfMerge rewards cross-query consensus, rescales to a top score of 1, and keeps ranks and the exact flag", () => {
  const mk = (key, extra = {}) => ({ path: key, ord: 0, text: key, source: "code", ...extra });
  const A = mk("A"), B = mk("B"), C = mk("C", { exact: true }), D = mk("D");
  const merged = d.rrfMerge([[A, B, C], [B, A, D], [B, C, A]], 60, 10);
  assert.deepEqual(merged.map(c => c.path), ["B", "A", "C", "D"]);
  assert.equal(merged[0].score, 1);
  assert.ok(Math.abs(merged[0].rrf - (1 / 62 + 1 / 61 + 1 / 61)) < 1e-15);
  assert.ok(Math.abs(merged[1].score - (1 / 61 + 1 / 62 + 1 / 63) / merged[0].rrf) < 1e-15);
  assert.deepEqual(merged[1].ranks, { 0: 0, 1: 1, 2: 2 });
  assert.equal(merged[2].exact, true);
  assert.equal(merged[0].exact, false);
  assert.deepEqual(d.rrfMerge([null, [A]], 60, 10).map(c => c.path), ["A"], "a failed sub-query is skipped");
});

test("selectV2 walks exact hits first, then one chunk per query, then MMR", () => {
  const mk = (key, score, ranks = {}, exact = false) => ({ path: key, ord: 0, score, ranks, exact });
  const a = mk("a", 1.0, { 0: 0 });
  const b = mk("b", 0.9, { 0: 1 });
  const c = mk("c", 0.8, { 0: 2 });
  const ex = mk("ex", 0.5, {}, true);
  const z = mk("z", 0.1, { 1: 0 });          // the only chunk sub-query 1 found, at the bottom of the fused list
  const scored = [a, b, c, ex, mk("d", 0.7), mk("e", 0.6), z];
  const picked = d.selectV2(scored, 4, 2, d.fusionConfig(), {}, () => null);
  assert.deepEqual(picked.map(x => x.path), ["ex", "a", "z", "b"]);
});

test("MMR drops a near-duplicate of an already picked chunk in favour of new information", () => {
  const vectors = { a: [1, 0, 0], dup: [1, 0, 0], other: [0, 1, 0] };
  const mk = (key, score, ranks = {}) => ({ path: key, ord: 0, score, ranks, exact: false });
  const scored = [mk("a", 1.0, { 0: 0 }), mk("dup", 0.95, { 0: 1 }), mk("other", 0.8, { 0: 2 })];
  const vec = c => Float32Array.from(vectors[c.path]);
  const picked = d.selectV2(scored, 2, 1, d.fusionConfig(), {}, vec);
  assert.deepEqual(picked.map(x => x.path), ["a", "other"]);
  process.env.RAG_FUSION_MMR_LAMBDA = "1";
  try {
    const pure = d.selectV2(scored, 2, 1, d.fusionConfig(), {}, vec);
    assert.deepEqual(pure.map(x => x.path), ["a", "dup"], "lambda 1 is plain relevance order");
  } finally {
    delete process.env.RAG_FUSION_MMR_LAMBDA;
  }
});

test("dedupeOverlaps trims the shared span from whichever adjacent block the model reads second", () => {
  const head1 = "[code] p.ts (part 1/2)\n", head2 = "[code] p.ts (part 2/2)\n";
  const entry = (ord, body) => ({ c: { path: "p.ts", ord, source: "code" }, body });
  assert.equal(d.overlapLength(body1, body2, 32), 400);

  const forward = d.dedupeOverlaps([entry(0, head1 + body1), entry(1, head2 + body2)], 32);
  assert.equal(forward[0].body, head1 + body1);
  assert.equal(forward[1].body, head2 + body2.slice(400), "head of the later block goes, header stays");

  const backward = d.dedupeOverlaps([entry(1, head2 + body2), entry(0, head1 + body1)], 32);
  assert.equal(backward[0].body, head2 + body2);
  assert.equal(backward[1].body, head1 + body1.slice(0, body1.length - 400), "tail of the earlier block goes");

  const gap = d.dedupeOverlaps([entry(0, head1 + body1), entry(2, head2 + body2)], 32);
  assert.equal(gap[1].body, head2 + body2, "non-adjacent ords are not overlap");

  const coincidence = d.dedupeOverlaps([entry(0, "alpha beta gamma end"), entry(1, "end of the line")], 32);
  assert.equal(coincidence[1].body, "end of the line", "a short shared span is not chunker overlap");

  const plain = d.dedupeOverlaps([entry(0, body1), entry(1, body2)], 32);
  assert.equal(plain[1].body, body2.slice(400), "docs chunks without a header line still dedupe");
});

test("the env switch selects v2, which dedupes overlap that legacy sends twice", async () => {
  const count = s => s.split(shared).length - 1;
  const legacy = await retrieve.search(CLOTURE, { topK: 2 });
  assert.deepEqual(legacy.hits.map(h => h.ord), [0, 1]);
  assert.equal(count(legacy.context), 2);

  process.env.RAG_FUSION = "v2";
  try {
    const v2 = await retrieve.search(CLOTURE, { topK: 2 });
    assert.deepEqual(v2.hits.map(h => h.ord), [0, 1]);
    assert.equal(count(v2.context), 1);
    assert.ok(v2.hits[1].text.startsWith("[code] src/lib/senate/cloture.ts (part 2/2)\n second part"));
    assert.ok(v2.context.endsWith(v2.hits[1].text), "hits[].text is the deduped body the model actually reads");
    assert.equal(v2.count, 2);
    assert.deepEqual(Object.keys(v2).sort(), ["claimType", "context", "count", "files", "hits"]);
    assert.deepEqual(Object.keys(v2.hits[0]).sort(), ["ord", "path", "repository", "revision", "score", "source", "text"]);
  } finally {
    delete process.env.RAG_FUSION;
  }
});

test("__debug.candidates in legacy mode mirrors the shipped ranking", async () => {
  const parts = await d.candidates(CLOTURE);
  assert.equal(parts.mode, "legacy");
  assert.equal(parts.weights, null);
  const found = await retrieve.search(CLOTURE, { topK: 8 });
  assert.deepEqual(parts.fused.slice(0, found.hits.length).map(c => `${c.path}#${c.ord}`), found.hits.map(h => `${h.path}#${h.ord}`));
  assert.ok(parts.lexical.every(l => typeof l.exact === "boolean"));
  assert.ok(parts.dense.length >= 1 && parts.dense.every((c, i, arr) => i === 0 || arr[i - 1].score >= c.score));
});
