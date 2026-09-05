"use strict";

// Legacy fusion must be byte-for-byte what shipped before RAG_FUSION existed.
//
// eval/fusion-legacy-hits.json was captured from the pre-switch retrieve.js
// against a built index: ten mechanics questions through search() and
// searchMulti(), with hit order, scores, files, count, claim type and a hash
// of the assembled context. With RAG_FUSION unset the new code must reproduce
// every one of them exactly. The capture is tied to the index revisions it
// ran against, so on a different index this skips rather than lies; rebuild
// the fixture with RAG_FUSION_FIXTURE_UPDATE=1 once legacy parity is known.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

delete process.env.RAG_FUSION;
const retrieve = require("./retrieve");

const FIXTURE = path.join(__dirname, "eval", "fusion-legacy-hits.json");
const OLLAMA = process.env.OLLAMA_EMBED_URL || "http://127.0.0.1:11434/api/embed";
const UPDATE = process.env.RAG_FUSION_FIXTURE_UPDATE === "1";

const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const slim = r => ({
  claimType: r.claimType, files: r.files, count: r.count, contextSha256: sha(r.context),
  hits: r.hits.map(({ path: p, ord, source, score }) => ({ path: p, ord, source, score })),
});

async function reason() {
  let fixture;
  try { fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8")); } catch { return { skip: "no legacy fixture" }; }
  const stats = retrieve.stats();
  if (!stats.ready || !stats.sources) return { skip: "no built RAG index on this checkout" };
  const live = Object.fromEntries(Object.entries(stats.sources).map(([k, v]) => [k, v.revision]));
  if (!UPDATE && JSON.stringify(live) !== JSON.stringify(fixture.index.revisions)) {
    return { skip: `index revisions differ from the fixture (${JSON.stringify(live)})` };
  }
  try {
    const r = await fetch(OLLAMA, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text", input: "search_query: ping" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { skip: `embedder returned ${r.status}` };
  } catch { return { skip: "embedder unreachable" }; }
  return { fixture, live };
}

test("RAG_FUSION unset reproduces the captured legacy hits exactly", async t => {
  const state = await reason();
  if (state.skip) return t.skip(state.skip);
  const { fixture, live } = state;
  const out = { ...fixture, capturedAt: new Date().toISOString(), index: { ...fixture.index, revisions: live }, cases: [] };
  for (const c of fixture.cases) {
    const single = slim(await retrieve.search(c.question));
    const multi = slim(await retrieve.searchMulti(c.question, c.subQueries));
    out.cases.push({ question: c.question, subQueries: c.subQueries, single, multi });
    if (UPDATE) continue;
    assert.deepEqual(single, c.single, `search(): ${c.question}`);
    assert.deepEqual(multi, c.multi, `searchMulti(): ${c.question}`);
  }
  if (UPDATE) fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + "\n");
});

test("the fusion override on a call beats the environment", async t => {
  const state = await reason();
  if (state.skip) return t.skip(state.skip);
  const c = state.fixture.cases[0];
  process.env.RAG_FUSION = "v2";
  try {
    const legacy = slim(await retrieve.search(c.question, { fusion: "legacy" }));
    assert.deepEqual(legacy, c.single);
  } finally {
    delete process.env.RAG_FUSION;
  }
  const v2 = await retrieve.search(c.question, { fusion: "v2" });
  assert.ok(v2 && Array.isArray(v2.hits) && v2.hits.length > 0);
  for (const h of v2.hits) {
    assert.deepEqual(Object.keys(h).sort(), ["ord", "path", "repository", "revision", "score", "source", "text"]);
  }
  assert.deepEqual(Object.keys(v2).sort(), ["claimType", "context", "count", "files", "hits"]);
});
