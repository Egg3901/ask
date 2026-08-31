"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-retrieve-v2-"));
const dbPath = path.join(dir, "index.db");
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE chunks(id INTEGER PRIMARY KEY,source_kind TEXT,repository TEXT,revision TEXT,path TEXT,ord INTEGER,text TEXT,vec BLOB,dims INTEGER);
  CREATE TABLE source_revisions(kind TEXT,repository TEXT,revision TEXT,indexed_at TEXT,files INTEGER,chunks INTEGER);
  CREATE TABLE meta(k TEXT,v TEXT);
`);
const insert = db.prepare("INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?,?)");
const vector = Float32Array.from([1, 0, 0]);
insert.run(1, "code", "game", "game123", "src/rule.ts", 0, "cloture vote rule", Buffer.from(vector.buffer), 3);
insert.run(2, "docs", "docs", "docs123", "design/rule.md", 0, "cloture design", Buffer.from(vector.buffer), 3);
insert.run(3, "wiki", "game", "game123", "src/lib/seeds/wiki/content/rule.ts", 0, "cloture guide", Buffer.from(vector.buffer), 3);
insert.run(4, "code", "game", "game123", "src/lib/metricEngine/__fixtures__/gdpGrowthGolden.ts", 0,
  "export const expectedGdpGrowth = 3.2; export const gdpGrowthScenario = { expectedGdpGrowth };",
  Buffer.from(vector.buffer), 3);
insert.run(5, "code", "game", "game123", "src/lib/budget/inflation.ts", 0,
  "export function calculateInflation() { return demandPull + costPush; }",
  Buffer.from(vector.buffer), 3);
insert.run(6, "code", "game", "game123", "src/lib/metricEngine/outputGap.ts", 0,
  "const rawGap = prevGap + (impulse - GAP_CLOSURE * prevGap) / turnsPerYear; const gdpGrowth = potential + (gap - prevGap) * turnsPerYear;",
  Buffer.from(vector.buffer), 3);
insert.run(7, "code", "game", "game123", "src/lib/constants/techTree/costs.ts", 0,
  "const cashCost = Math.round(dailyGrossRevenueLocal * 0.15); // charged in the corporation localCurrency",
  Buffer.from(vector.buffer), 3);
insert.run(8, "code", "game", "game123", "src/lib/turn/corporation/sectorCalculations.ts", 0,
  "const bindingInput = ratios.lowest; const inputAvailabilityPct = bindingInput.ratio * 100;",
  Buffer.from(vector.buffer), 3);
insert.run(9, "code", "game", "game123", "src/lib/navair/config.ts", 0,
  "export const DAMAGE = { light: 1 };",
  Buffer.from(Float32Array.from([0, 1, 0]).buffer), 3);
insert.run(10, "code", "game", "game123", "src/lib/navair/config.ts", 1,
  "export const BASING = { port: 1 };",
  Buffer.from(Float32Array.from([0, 1, 0]).buffer), 3);
insert.run(11, "code", "game", "game123", "src/lib/navair/config.ts", 2,
  "export const EMBARGO = { buildPerTurn: 12, decayPerTurn: 15 };",
  Buffer.from(Float32Array.from([0, 1, 0]).buffer), 3);
for (const kind of ["code", "docs", "wiki"]) db.prepare("INSERT INTO source_revisions VALUES(?,?,?,?,?,?)")
  .run(kind, kind === "docs" ? "docs" : "game", `${kind}123`, "2026-08-23T00:00:00.000Z", 1, 1);
db.prepare("INSERT INTO meta VALUES('generation','fixture')").run();
db.exec(`CREATE VIRTUAL TABLE chunks_fts USING fts5(text,source_kind UNINDEXED,path UNINDEXED,content='chunks',content_rowid='id');
  INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');`);
db.close();

process.env.RAG_DB = dbPath;
global.fetch = async () => ({ ok: true, json: async () => ({ embeddings: [[1, 0, 0]] }) });
const retrieve = require("./retrieve");

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("routes evidence authority by claim type while preserving provenance", async () => {
  const mechanics = await retrieve.search("How many cloture votes are required?", { topK: 8 });
  assert.equal(mechanics.claimType, "mechanic");
  assert.equal(mechanics.hits[0].source, "code");
  assert.match(mechanics.context, /SOURCE code @ game123/);
  assert.match(mechanics.context, /SOURCE docs @ docs123/);
  assert.match(mechanics.context, /SOURCE wiki @ game123/);

  const intent = await retrieve.search("What is the intended design for cloture?", { topK: 3 });
  assert.equal(intent.claimType, "intent");
  assert.equal(intent.hits[0].source, "docs");

  const help = await retrieve.search("How do I use the cloture screen?", { topK: 3 });
  assert.equal(help.claimType, "player_help");
  assert.equal(help.hits[0].source, "wiki");
});

test("reports independently revisioned source health", () => {
  const stats = retrieve.stats();
  assert.equal(stats.generation, "fixture");
  assert.deepEqual(Object.keys(stats.sources), ["code", "docs", "wiki"]);
});

test("exact indexed search finds camel-case mechanics semantic search can miss", () => {
  const found = retrieve.searchExact("GDP growth calculation", { limit: 5 });
  assert.equal(found.files[0], "src/lib/metricEngine/outputGap.ts");
  assert.match(found.context, /const gdpGrowth = potential/);
});

test("reads a known indexed source file without filesystem access", () => {
  const found = retrieve.readIndexedFile("src/lib/budget/inflation.ts");
  assert.match(found.context, /calculateInflation/);
  assert.deepEqual(found.files, ["src/lib/budget/inflation.ts"]);
});

test("expands game abbreviations when exact-searching technology prices", () => {
  const found = retrieve.searchExact("Where do tech LC prices come from?", { limit: 5 });
  assert.equal(found.files[0], "src/lib/constants/techTree/costs.ts");
  assert.match(found.context, /dailyGrossRevenueLocal \* 0\.15/);
});

test("merges exact mechanic evidence into semantic evidence for the writer", async () => {
  const semantic = await retrieve.search("cloture rule", { topK: 1 });
  const exact = retrieve.searchExact("tech LC prices", { limit: 2 });
  const merged = retrieve.mergeEvidence(semantic, exact);
  assert.match(merged.context, /cloture vote rule/);
  assert.match(merged.context, /techTree\/costs\.ts/);
});

test("expands player wording for corporation input constraints", () => {
  const found = retrieve.searchExact("How do I solve input limits for my corp?", { limit: 5 });
  assert.equal(found.files[0], "src/lib/turn/corporation/sectorCalculations.ts");
  assert.match(found.context, /inputAvailabilityPct/);
});

test("an explicit long-file path returns the chunk containing the named symbol", () => {
  const found = retrieve.searchExact("src/lib/navair/config.ts EMBARGO", { limit: 5, maxChars: 8000 });
  assert.equal(found.files[0], "src/lib/navair/config.ts");
  assert.match(found.context, /buildPerTurn: 12/);
  assert.match(found.context, /decayPerTurn: 15/);
});

const testEmbedBatchSlicing = require("node:test");
testEmbedBatchSlicing.test("embedBatch slices long sentence lists into small requests", () => {
  const source = require("node:fs").readFileSync(require.resolve("./retrieve.js"), "utf8");
  // One giant request degraded attribution to lexical-only in production;
  // pin the slicing loop so it cannot quietly regress.
  if (!/for \(let offset = 0; offset < texts\.length; offset \+= slice\)/.test(source)) {
    throw new Error("embedBatch no longer slices its input");
  }
});

testEmbedBatchSlicing.test("embedBatch honors an overall deadline across slices", () => {
  const source = require("node:fs").readFileSync(require.resolve("./retrieve.js"), "utf8");
  if (!/deadline \? Math\.min\(timeoutMs, deadline - Date\.now\(\)\)/.test(source)) {
    throw new Error("embedBatch lost its overall deadline");
  }
  const serverSource = require("node:fs").readFileSync(require.resolve("./server.js"), "utf8");
  // Attribution sits on the delivery path; the deadline and the failure log
  // must both stay.
  if (!/deadlineMs: 12000/.test(serverSource) || !/attribution embed failed/.test(serverSource)) {
    throw new Error("attribution delivery-path budget or logging removed");
  }
});
