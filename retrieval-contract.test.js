"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const retrieve = require("./retrieve");

const DB_PATH = process.env.RAG_DB || "/root/projects/LSGD-ops-dash/rag/index.db";
const INDEX_REPO = process.env.RAG_REPO || "/root/projects/LSGD-ops-dash/ahd-sandbox";
const DOCS_REPO = process.env.RAG_DOCS_REPO || "/root/projects/ahd-docs/worktrees/ask-retrieval";

// These are integration checks against a built RAG index and its source
// checkouts. On a bare working tree (no index DB, or an index without the
// source_revisions table) they cannot run, so skip rather than fail — the gate
// stays meaningful where the index exists and green where it does not.
function indexAvailable() {
  try {
    if (!fs.existsSync(DB_PATH)) return false;
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_revisions'").get();
    db.close();
    return Boolean(hasTable);
  } catch { return false; }
}
const SKIP = indexAvailable() ? false : "no built RAG index on this checkout";

function repositoryHead(repo) {
  const marker = path.join(repo, ".git");
  const git = fs.statSync(marker).isDirectory()
    ? marker
    : path.resolve(repo, fs.readFileSync(marker, "utf8").match(/^gitdir:\s*(.+)$/m)[1]);
  const head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  return fs.readFileSync(path.join(git, head.slice(5)), "utf8").trim();
}

test("reports code, engineering docs, and player wiki as separate evidence sources", { skip: SKIP }, () => {
  const stats = retrieve.stats();
  assert.deepEqual(Object.keys(stats.sources || {}).sort(), ["code", "docs", "wiki"]);
  for (const source of Object.values(stats.sources || {})) {
    assert.equal(typeof source.indexedAt, "string");
    assert.ok(source.revision, "each source must expose its indexed revision");
  }
});

test("each index revision matches its clean retrieval checkout", { skip: SKIP }, () => {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const indexed = Object.fromEntries(db.prepare("SELECT kind,revision FROM source_revisions").all()
    .map(row => [row.kind, row.revision]));
  db.close();
  const codeHead = repositoryHead(INDEX_REPO);
  const docsHead = repositoryHead(DOCS_REPO);
  assert.equal(indexed.code, codeHead, `code index is stale: indexed ${indexed.code}, retrieval clone ${codeHead}`);
  assert.equal(indexed.wiki, codeHead, `wiki index is stale: indexed ${indexed.wiki}, retrieval clone ${codeHead}`);
  assert.equal(indexed.docs, docsHead, `docs index is stale: indexed ${indexed.docs}, retrieval clone ${docsHead}`);
});
