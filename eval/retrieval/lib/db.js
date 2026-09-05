"use strict";
// Read-only access to the evaluation snapshot of the retrieval index.
//
// Every gold label and every result file is tied to ONE snapshot file whose
// sha256 is recorded alongside it. The production index is rewritten every
// 15 minutes, so evaluating against it directly would make results
// irreproducible within the hour.
const fs = require("node:fs");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const SNAPSHOT = process.env.RAG_EVAL_DB || "/root/misc/ask-remediation/eval/index-v2.snapshot.db";

const shaCache = new Map();
function sha256File(p) {
  const stat = fs.statSync(p);
  const key = `${p}:${stat.size}:${stat.mtimeMs}`;
  if (shaCache.has(key)) return shaCache.get(key);
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(p, "r");
  const buf = Buffer.alloc(1 << 20);
  for (;;) {
    const n = fs.readSync(fd, buf, 0, buf.length, null);
    if (!n) break;
    h.update(buf.subarray(0, n));
  }
  fs.closeSync(fd);
  const hex = h.digest("hex");
  shaCache.set(key, hex);
  return hex;
}

function openSnapshot(p = SNAPSHOT) {
  const db = new Database(p, { readonly: true, fileMustExist: true });
  db.pragma("query_only = true");
  return db;
}

function snapshotInfo(p = SNAPSHOT) {
  const db = openSnapshot(p);
  try {
    const meta = Object.fromEntries(db.prepare("SELECT k, v FROM meta").all().map(r => [r.k, r.v]));
    const sources = Object.fromEntries(db.prepare("SELECT * FROM source_revisions").all()
      .map(r => [r.kind, { repository: r.repository, revision: r.revision, files: r.files, chunks: r.chunks }]));
    const chunks = db.prepare("SELECT COUNT(*) c FROM chunks").get().c;
    return { path: p, sha256: sha256File(p), chunks, generation: meta.generation || null, publishedAt: meta.published_at || null, sources };
  } finally { db.close(); }
}

function docid(path, ord) { return `${path}#${ord}`; }
function parseDocid(id) {
  const i = id.lastIndexOf("#");
  return { path: id.slice(0, i), ord: Number(id.slice(i + 1)) };
}

/** sha1 of the chunk text after its "[kind] path (part N/M)" header line. */
function bodySha1(text) {
  const s = String(text || "");
  const nl = s.indexOf("\n");
  return crypto.createHash("sha1").update(nl >= 0 ? s.slice(nl + 1) : s).digest("hex");
}

// Length buckets for stratified reporting. The embedder truncates at about
// 2048 tokens, so the long buckets are where a chunking change would show.
const LENGTH_BUCKETS = ["s<800", "m800-2000", "l2000-4000", "xl4000+"];
function lengthBucket(chars) {
  if (chars < 800) return LENGTH_BUCKETS[0];
  if (chars < 2000) return LENGTH_BUCKETS[1];
  if (chars < 4000) return LENGTH_BUCKETS[2];
  return LENGTH_BUCKETS[3];
}

function chunkRow(db, id) {
  const { path, ord } = parseDocid(id);
  const r = db.prepare("SELECT path, ord, hash, source_kind, text FROM chunks WHERE path=? AND ord=? LIMIT 1").get(path, ord);
  if (!r) return null;
  return describe(r);
}

function describe(r) {
  const text = String(r.text || "");
  return {
    docid: docid(r.path, r.ord), path: r.path, ord: r.ord, hash: r.hash,
    bodySha1: bodySha1(text), sourceKind: r.source_kind, chars: text.length,
    lengthBucket: lengthBucket(text.length), text,
  };
}

module.exports = { SNAPSHOT, sha256File, openSnapshot, snapshotInfo, docid, parseDocid, bodySha1, lengthBucket, LENGTH_BUCKETS, chunkRow, describe };
