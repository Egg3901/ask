// Chunk retrieval over the nomic index.
//
// Replaces the old path, which sent the model a FILE INDEX (name, size, export
// names, first 2.5KB) and asked it to reason about contents it never received.
// This sends the actual text of the most relevant chunks instead.
//
// Query embedding runs in ollama, not in-process: transformers.js/ONNX leaks an
// arena per input shape and this is a long-lived server.
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.RAG_DB || "/root/projects/LSGD-ops-dash/rag/index.db";
const OLLAMA = process.env.OLLAMA_EMBED_URL || "http://127.0.0.1:11434/api/embed";
const MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const TOP_K = Number(process.env.RAG_TOP_K || 8);
const MAX_CHARS = Number(process.env.RAG_MAX_CHARS || 22000);

let db = null, ready = false, dbSignature = null, sourceAware = false;
function open() {
  let signature;
  try {
    const stat = fs.statSync(DB_PATH);
    signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch { return null; }
  if (db && signature === dbSignature) return db;
  if (db) {
    try { db.close(); } catch {}
    db = null; _mat = null; _matCount = 0;
  }
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("query_only = true");
    sourceAware = db.prepare("PRAGMA table_info(chunks)").all().some(column => column.name === "source_kind");
    ready = db.prepare("SELECT COUNT(*) c FROM chunks").get().c > 0;
    dbSignature = signature;
  } catch { db = null; ready = false; dbSignature = null; sourceAware = false; }
  return db;
}

async function embedQuery(text) {
  const r = await fetch(OLLAMA, {
    method: "POST", headers: { "Content-Type": "application/json" },
    // nomic requires a task prefix; documents were indexed as search_document.
    body: JSON.stringify({ model: MODEL, input: "search_query: " + text }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error("embed " + r.status);
  const d = await r.json();
  const v = d.embeddings?.[0];
  if (!Array.isArray(v)) throw new Error("no embedding");
  return Float32Array.from(v);
}

/**
 * Top chunks for a question, as text the model can actually read.
 * Returns { context, files, count } or null when the index is unavailable, so
 * callers can fall back to the old path rather than answer with nothing.
 */
async function search(question, { topK = TOP_K, maxChars = MAX_CHARS, claimType = inferClaimType(question) } = {}) {
  const top = await collect(question, claimType);
  if (!top) return null;
  return finish(top, topK, claimType, maxChars);
}

/**
 * Retrieval over the union of the question and model-written sub-queries.
 *
 * One embedding cannot cover a question spanning several systems: the benched
 * "inflation, bonds and deficit" case retrieved four chunks and missed
 * bondTurn.ts entirely, and every model scored 1-2 on grounding because the
 * evidence was not there. Candidates from each sub-query are merged (max score
 * wins on duplicates) and the shared char budget is spent on the union.
 */
async function searchMulti(question, subQueries = [], { topK = TOP_K, maxChars = MAX_CHARS, claimType = inferClaimType(question) } = {}) {
  const queries = [question, ...subQueries.map(q => String(q || "").trim()).filter(Boolean).slice(0, 4)];
  if (queries.length === 1) return search(question, { topK, maxChars, claimType });
  const lists = await Promise.all(queries.map(q => collect(q, claimType).catch(() => null)));
  const byKey = new Map();
  for (const list of lists) {
    if (!list) continue;
    for (const c of list) {
      const k = c.path + "#" + c.ord;
      const prev = byKey.get(k);
      if (!prev || c.score > prev.score) byKey.set(k, c);
    }
  }
  if (!byKey.size) return null;
  const merged = [...byKey.values()].sort((a, b) => b.score - a.score);
  return finish(merged, topK, claimType, maxChars);
}

/** Ranked candidate chunks for one query string. null when the index is unavailable. */
async function collect(question, claimType) {
  const h = open();
  if (!h || !ready) return null;

  let qv;
  try { qv = await embedQuery(question); } catch { return null; }

  const M = matrix();
  if (!M || M.n === 0) return null;
  if (M.dims !== qv.length) return null;

  // Score against one contiguous Float32Array rather than rebuilding a Buffer
  // view per row. Same maths, but ~20x faster and it does not re-read SQLite on
  // every question.
  // Score into a typed array and keep only a small top-N via partial selection.
  // Allocating 10k+ objects and sorting them cost more than the maths did.
  const { data, dims, n, meta } = M;
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * dims;
    let dot = 0;
    for (let j = 0; j < dims; j++) dot += qv[j] * data[off + j];   // both sides normalised
    // Weight in the sweep, not after: otherwise the top-KEEP cutoff is chosen on
    // raw similarity, so an upweighted constants chunk just below the raw cutoff
    // is dropped before its weight could have lifted it above a wiki chunk.
    scores[i] = dot * weightFor(meta[i].path, meta[i].source, claimType);
  }
  // Single pass for a cheap score threshold, then materialise only the winners.
  const KEEP = Math.min(n, 200);
  const sorted = Float32Array.prototype.slice.call(scores).sort();      // ascending
  const cutoff = sorted[Math.max(0, n - KEEP)];
  const top = [];
  const seen = new Set();
  for (let i = 0; i < n && top.length < KEEP * 2; i++) {
    if (scores[i] < cutoff) continue;
    seen.add(meta[i].path + "#" + meta[i].ord);
    top.push({ ...meta[i], score: scores[i] });
  }

  // Hybrid: keyword search (FTS5/BM25) alongside the semantic search.
  //
  // Dense vectors are poor at rare, precise terms. "cloture" and
  // LEADERSHIP_INACTIVE_TURN_THRESHOLD both failed on vectors alone: a token
  // appearing in a handful of chunks carries little semantic signal, while
  // keyword matching finds it instantly. Running both and merging covers the
  // two failure modes — vectors handle paraphrase, keywords handle precision.
  for (const r of keywordHits(h, question)) {
    const k = r.path + "#" + r.ord;
    if (seen.has(k)) {
      const ex = top.find(t => t.path === r.path && t.ord === r.ord);
      if (ex) ex.score += 0.35;                   // found by both: strong signal
      continue;
    }
    seen.add(k);
    top.push({ ...r, score: r.boost * weightFor(r.path, r.source, claimType) });
  }

  top.sort((a, b) => b.score - a.score);
  return top;
}

// ── vector cache ──────────────────────────────────────────────────────────────
// Held in memory so a question costs one dot-product sweep, not a table scan.
// 18.6k chunks x 768 dims x 4 bytes is about 57MB, which is cheap next to
// re-reading SQLite per request. Refreshed as the index grows.
let _mat = null, _matAt = 0, _matCount = 0;
const MAT_TTL = 120000;

function matrix() {
  const h = open();
  if (!h) return null;
  const now = Date.now();
  // TTL only. Do NOT invalidate on row-count change: while the index is being
  // built the count moves on every query, which would mean a full reload every
  // single time and made queries 20x SLOWER than the naive version.
  if (_mat && now - _matAt < MAT_TTL) return _mat;

  const shape = h.prepare("SELECT dims, COUNT(*) n FROM chunks GROUP BY dims ORDER BY n DESC LIMIT 1").get();
  if (!shape?.n || !shape?.dims) { _mat = null; return null; }
  // Most refresh checks are against an unchanged index. Keep the existing
  // matrix instead of rebuilding hundreds of MB of vectors and source text.
  if (_mat && _matCount === shape.n && _mat.dims === shape.dims) {
    _matAt = now;
    return _mat;
  }

  const dims = shape.dims;
  const data = new Float32Array(shape.n * dims);
  const meta = new Array(shape.n);
  let n = 0;
  // Iterate so SQLite does not materialise every vector blob and every chunk
  // string in a second giant JS array while the final matrix is being built.
  const projection = sourceAware
    ? "path,ord,text,vec,source_kind source,repository,revision"
    : "path,ord,text,vec,'code' source,'' repository,'' revision";
  for (const r of h.prepare(`SELECT ${projection} FROM chunks WHERE dims=?`).iterate(dims)) {
    const v = new Float32Array(r.vec.buffer, r.vec.byteOffset, dims);
    data.set(v, n * dims);
    meta[n] = {
      path: r.path, ord: r.ord, text: r.text,
      source: r.source, repository: r.repository, revision: r.revision,
    };
    n++;
  }
  _mat = { data, dims, n, meta };
  _matAt = now; _matCount = n;
  return _mat;
}

const STOP = new Set(("the a an and or but if is are was were be been do does did of to in on for with " +
  "what how why when where which who whom that this these those it its as at by from can could should " +
  "would will my me i you your our we they them there here about into out up down over under so than " +
  "then now also just only more most some any all no not exact exactly number value work works game").split(" "));

/**
 * Terms worth a keyword lookup: identifiers, and rare content words.
 * Ordinary English is dropped so a normal question does not match everything.
 */
function termsIn(question) {
  const q = String(question || "");
  const ids = new Set();
  for (const m of q.matchAll(/\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/g)) ids.add(m[0]);        // CONST_NAME
  for (const m of q.matchAll(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]{2,}\b/g)) ids.add(m[0]);   // camelCase
  for (const m of q.matchAll(/\b[\w/.-]+\.(?:ts|tsx|js|jsx|json)\b/g)) ids.add(m[0]);        // file.ts
  const words = (q.toLowerCase().match(/\b[a-z][a-z-]{4,}\b/g) || [])
    .filter(w => !STOP.has(w));
  return { ids: [...ids].slice(0, 4), words: [...new Set(words)].slice(0, 6) };
}

/** FTS5/BM25 hits, merged into the semantic ranking. */
function keywordHits(h, question) {
  const { ids, words } = termsIn(question);
  const out = [];
  const run = (expr, boost, limit) => {
    try {
      const sourceProjection = sourceAware
        ? "c.source_kind source,c.repository,c.revision"
        : "'code' source,'' repository,'' revision";
      const rows = h.prepare(
        `SELECT c.path,c.ord,c.text,${sourceProjection} FROM chunks_fts f JOIN chunks c ON c.id=f.rowid
         WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?`).all(expr, limit);
      for (const r of rows) out.push({ ...r, boost });
    } catch { /* FTS is an enhancement; a bad expression must not break search */ }
  };
  // An explicitly named symbol is an unambiguous request, so it outranks
  // everything the vectors found.
  for (const id of ids) run(`"${id}"`, 1.5, 5);
  // Rare content words are a weaker signal: enough to surface a chunk the
  // vectors missed, not enough to displace a strong semantic match.
  if (words.length) run(words.map(w => `"${w}"`).join(" OR "), 0.92, 8);
  return out;
}

// Source authority applied to ranking, not just to the prompt.
//
// The repo contains its own wiki and guide prose (src/lib/seeds/wiki/content,
// src/app/guides). Those files are written in player language, so they match a
// player's question far better than the code does — and then crowd the code out
// of the results. That inverts the rule that code is authoritative: the model
// ends up reading the same documentation the player already read.
//
// Constants and turn logic get a lift; embedded documentation gets a haircut.
// It still surfaces when nothing else matches, just not ahead of the real thing.
const AUTHORITY = {
  mechanic: { code: 1.30, docs: 1.00, wiki: 0.72 },
  intent: { code: 1.00, docs: 1.30, wiki: 0.75 },
  player_help: { code: 1.00, docs: 1.05, wiki: 1.15 },
  general: { code: 1.12, docs: 1.00, wiki: 0.88 },
};

function inferClaimType(question) {
  const q = String(question || "").toLowerCase();
  if (/\b(intended|architecture|design|roadmap|planned|why was|why is .* designed)\b/.test(q)) return "intent";
  if (/\b(where do i|how do i|how can i|get started|beginner|guide|which screen|what should i click)\b/.test(q)) return "player_help";
  if (/\b(how many|how much|what happens|who breaks|threshold|require|rule|formula|can .* have)\b/.test(q)) return "mechanic";
  return "general";
}

function weightFor(p, source = "code", claimType = "general") {
  if (sourceAware) {
    let weight = (AUTHORITY[claimType] || AUTHORITY.general)[source] || 1;
    if (source === "code" && /\.test\.tsx?$/.test(p)) weight *= 0.85;
    if (source === "code" && /\/lib\/constants\//.test(p)) weight *= 1.08;
    return weight;
  }
  if (/\/seeds\/wiki\/content\//.test(p)) return 0.72;
  if (/\/app\/guides\//.test(p)) return 0.78;
  if (/\.test\.tsx?$/.test(p)) return 0.85;
  if (/\/lib\/constants\//.test(p)) return 1.18;
  if (/\/lib\/(turn|elections?|economy|corporations|military)\//.test(p)) return 1.10;
  return 1;
}

function finish(scored, topK, claimType, maxChars = MAX_CHARS) {
  // Keep at most 2 chunks per file so one long file cannot crowd out the rest.
  const perFile = new Map(), picked = [];
  for (const s of scored) {
    const n = perFile.get(s.path) || 0;
    if (n >= 2) continue;
    perFile.set(s.path, n + 1);
    picked.push(s);
    if (picked.length >= topK) break;
  }

  let budget = maxChars;
  const blocks = [];
  const included = [];
  const evidence = [];
  for (const c of picked) {
    const body = c.text.length > 6200 ? c.text.slice(0, 6200) : c.text;
    // `continue`, NOT `break`. A single large chunk used to exhaust the budget
    // and silently drop every smaller chunk ranked below it — which is how a
    // 900-byte constants file holding the exact answer got picked, reported as
    // a source, and then never actually sent to the model.
    if (body.length > budget) continue;
    budget -= body.length;
    included.push(c.path);
    evidence.push({
      source: c.source || "code", repository: c.repository || null,
      revision: c.revision || null, path: c.path, ord: c.ord, score: c.score,
    });
    const label = sourceAware
      ? `SOURCE ${c.source} @ ${c.revision} | ${c.path}`
      : c.path;
    blocks.push(`--- ${label} (part ${c.ord + 1}, relevance ${c.score.toFixed(3)}) ---\n${body}`);
  }
  if (!blocks.length) return null;

  return {
    context: sourceAware
      ? `RETRIEVED EVIDENCE (${claimType} question). For current mechanics, executable code wins conflicts. For design intent, engineering docs win. For player navigation and explanation, shipped wiki prose is preferred unless it conflicts with code.\n\n${blocks.join("\n\n")}`
      : `SOURCE CODE (the actual text of the most relevant parts of the game, retrieved for this question.\nThis is the game's real current behaviour and outranks any documentation):\n\n${blocks.join("\n\n")}`,
    // Only what was actually sent. Reporting picked-but-dropped files made the
    // model think it had seen code it never received.
    files: [...new Set(included)],
    count: blocks.length,
    hits: evidence,
    claimType,
  };
}

// Does this path exist in the indexed corpus at all?
//
// The distinction matters more than it looks. When an answer cites a file that
// was not in its evidence, there are two very different causes: the model
// invented a plausible-looking path, or the file is real and RETRIEVAL MISSED
// IT. Measured over the shipped corpus, 19 of 22 such citations were real files
// — so treating them all as inventions told players to distrust correct answers.
//
// Cached, because this runs on every answer against a read-only index.
const pathCache = new Map();
function hasPath(path) {
  const key = String(path || "").trim();
  if (!key) return false;
  if (pathCache.has(key)) return pathCache.get(key);
  const h = open();
  if (!h) return false;                       // no index: claim nothing either way
  let found = false;
  try {
    found = !!h.prepare("SELECT 1 FROM chunks WHERE path=? LIMIT 1").get(key);
  } catch { found = false; }
  if (pathCache.size > 5000) pathCache.clear();
  pathCache.set(key, found);
  return found;
}

function stats() {
  const h = open();
  if (!h) return { ready: false, chunks: 0 };
  try {
    const c = h.prepare("SELECT COUNT(*) c FROM chunks").get().c;
    if (sourceAware) {
      const rows = h.prepare("SELECT * FROM source_revisions ORDER BY kind").all();
      const sources = Object.fromEntries(rows.map(row => [row.kind, {
        repository: row.repository, revision: row.revision,
        indexedAt: row.indexed_at, files: row.files, chunks: row.chunks,
      }]));
      const generation = h.prepare("SELECT v FROM meta WHERE k='generation'").get()?.v || null;
      return { ready: rows.length === 3 && c > 0, chunks: c, generation, sources };
    }
    const meta = {};
    for (const r of h.prepare("SELECT k,v FROM meta").all()) meta[r.k] = r.v;
    return { ready: c > 0, chunks: c, commit: meta.last_commit, model: meta.model };
  } catch { return { ready: false, chunks: 0 }; }
}

module.exports = { inferClaimType, search, searchMulti, stats, embedQuery, hasPath };
