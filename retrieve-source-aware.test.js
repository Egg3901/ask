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
  const mechanics = await retrieve.search("How many cloture votes are required?", { topK: 3 });
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
