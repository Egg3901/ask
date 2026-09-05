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

const games = require("./games");

const DB_PATH = process.env.RAG_DB || "/root/projects/LSGD-ops-dash/rag/index.db";
const OLLAMA = process.env.OLLAMA_EMBED_URL || "http://127.0.0.1:11434/api/embed";
const MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
// Optional bearer for a gated remote embedder (the box proxy). Local ollama
// ignores it.
const EMBED_HEADERS = {
  "Content-Type": "application/json",
  ...(process.env.OLLAMA_EMBED_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_EMBED_KEY}` } : {}),
};
const TOP_K = Number(process.env.RAG_TOP_K || 8);
const MAX_CHARS = Number(process.env.RAG_MAX_CHARS || 22000);

// One state object per index file. Each game has its own DB (see games.js), and
// each carries its own connection, vector matrix and path cache, so opening
// Grand Century never evicts the A House Divided matrix that most questions hit.
const states = new Map();
function stateFor(game) {
  const g = game && game.ragDb ? game : games.fallback();
  const dbPath = g.id === games.DEFAULT_ID ? DB_PATH : g.ragDb;
  let st = states.get(dbPath);
  if (!st) {
    st = { dbPath, db: null, ready: false, dbSignature: null, sourceAware: false,
           mat: null, matAt: 0, matCount: 0, pathCache: new Map() };
    states.set(dbPath, st);
  }
  return st;
}

function open(st) {
  let signature;
  try {
    const stat = fs.statSync(st.dbPath);
    signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch { return null; }
  if (st.db && signature === st.dbSignature) return st.db;
  if (st.db) {
    try { st.db.close(); } catch {}
    st.db = null; st.mat = null; st.matCount = 0;
  }
  try {
    st.db = new Database(st.dbPath, { readonly: true, fileMustExist: true });
    st.db.pragma("query_only = true");
    st.sourceAware = st.db.prepare("PRAGMA table_info(chunks)").all().some(column => column.name === "source_kind");
    st.ready = st.db.prepare("SELECT COUNT(*) c FROM chunks").get().c > 0;
    st.dbSignature = signature;
  } catch { st.db = null; st.ready = false; st.dbSignature = null; st.sourceAware = false; }
  return st.db;
}

async function embedQuery(text) {
  const r = await fetch(OLLAMA, {
    method: "POST", headers: EMBED_HEADERS,
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
 * Batch document-side embeddings, for attribution over answer sentences.
 * Sliced into small requests: a 40-60 sentence answer in ONE request blew
 * past the serving instance's budget and the whole attribution silently
 * degraded to lexical-only (measured live: semantic=false on long answers).
 */
/**
 * Embed several texts through the SAME single-input request shape as
 * embedQuery, with bounded concurrency. The array-input form of /api/embed
 * timed out consistently on the serving instance while single-input requests
 * passed health checks; rather than depend on that server quirk, attribution
 * uses N known-good requests. Order is preserved.
 */
async function embedEach(texts, { timeoutMs = 4000, concurrency = 4, deadlineMs = 12000 } = {}) {
  if (!texts.length) return [];
  const deadline = Date.now() + deadlineMs;
  const out = new Array(texts.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= texts.length) return;
      const budget = Math.min(timeoutMs, deadline - Date.now());
      if (budget < 300) throw new Error("embed deadline exhausted");
      const r = await fetch(OLLAMA, {
        method: "POST", headers: EMBED_HEADERS,
        body: JSON.stringify({ model: MODEL, input: "search_document: " + texts[index] }),
        signal: AbortSignal.timeout(budget),
      });
      if (!r.ok) throw new Error("embed " + r.status);
      const d = await r.json();
      const v = d.embeddings?.[0];
      if (!Array.isArray(v)) throw new Error("no embedding");
      out[index] = Float32Array.from(v);
    }
  });
  await Promise.all(workers);
  return out;
}

async function embedBatch(texts, { timeoutMs = 20000, slice = 16, deadlineMs = 0 } = {}) {
  if (!texts.length) return [];
  const deadline = deadlineMs > 0 ? Date.now() + deadlineMs : 0;
  const out = [];
  for (let offset = 0; offset < texts.length; offset += slice) {
    // An overall deadline wins over the per-request timeout: callers sitting
    // on the delivery path must not pay per-slice timeouts serially.
    const budget = deadline ? Math.min(timeoutMs, deadline - Date.now()) : timeoutMs;
    if (budget < 300) throw new Error("embed deadline exhausted");
    const group = texts.slice(offset, offset + slice);
    const r = await fetch(OLLAMA, {
      method: "POST", headers: EMBED_HEADERS,
      body: JSON.stringify({ model: MODEL, input: group.map(t => "search_document: " + t) }),
      signal: AbortSignal.timeout(budget),
    });
    if (!r.ok) throw new Error("embed " + r.status);
    const d = await r.json();
    if (!Array.isArray(d.embeddings) || d.embeddings.length !== group.length) throw new Error("bad embedding batch");
    for (const v of d.embeddings) out.push(Float32Array.from(v));
  }
  return out;
}

/** Stored vectors for evidence chunks, keyed path#ord. Missing chunks are omitted. */
function vectorsFor(evidence, game = null) {
  const st = stateFor(game);
  const h = open(st);
  const out = new Map();
  if (!h) return out;
  const q = h.prepare("SELECT vec, dims FROM chunks WHERE path=? AND ord=? LIMIT 1");
  for (const e of evidence || []) {
    try {
      const row = q.get(String(e.path || ""), Number(e.ord || 0));
      if (row?.vec) out.set(`${e.path}#${e.ord}`, new Float32Array(row.vec.buffer, row.vec.byteOffset, row.dims));
    } catch { /* chunk gone between retrieval and attribution: skip */ }
  }
  return out;
}

/**
 * Top chunks for a question, as text the model can actually read.
 * Returns { context, files, count } or null when the index is unavailable, so
 * callers can fall back to the old path rather than answer with nothing.
 */
async function search(question, { topK = TOP_K, maxChars = MAX_CHARS, claimType = inferClaimType(question), game = null, fusion } = {}) {
  const st = stateFor(game);
  if (fusionMode(fusion) === "v2") {
    const top = await collectV2(question, claimType, st);
    if (!top) return null;
    return finishV2(top, topK, claimType, maxChars, st, 1);
  }
  const top = await collect(question, claimType, st);
  if (!top) return null;
  return finish(top, topK, claimType, maxChars, st);
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
async function searchMulti(question, subQueries = [], { topK = TOP_K, maxChars = MAX_CHARS, claimType = inferClaimType(question), game = null, fusion } = {}) {
  const st = stateFor(game);
  const queries = [question, ...subQueries.map(q => String(q || "").trim()).filter(Boolean).slice(0, 4)];
  if (queries.length === 1) return search(question, { topK, maxChars, claimType, game, fusion });
  if (fusionMode(fusion) === "v2") return searchMultiV2(queries, claimType, st, topK, maxChars);
  const lists = await Promise.all(queries.map(q => collect(q, claimType, st).catch(() => null)));
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
  return finish(merged, topK, claimType, maxChars, st);
}

/** Ranked candidate chunks for one query string. null when the index is unavailable. */
async function collect(question, claimType, st) {
  const parts = await candidatesLegacy(question, claimType, st);
  return parts ? parts.fused : null;
}

/**
 * The legacy fusion, with its per-retriever lists exposed for __debug. With
 * `debug` off this does exactly the work collect() always did; the dense
 * snapshot is only taken when a caller asks to see it.
 */
async function candidatesLegacy(question, claimType, st, { debug = false } = {}) {
  const h = open(st);
  if (!h || !st.ready) return null;

  let qv;
  try { qv = await embedQuery(question); } catch { return null; }

  const M = matrix(st);
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
    scores[i] = dot * weightFor(meta[i].path, meta[i].source, claimType, st.sourceAware);
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
  const dense = debug ? top.map(t => ({ ...t })) : null;
  const lexical = keywordHits(h, question, st.sourceAware);
  for (const r of lexical) {
    const k = r.path + "#" + r.ord;
    if (seen.has(k)) {
      const ex = top.find(t => t.path === r.path && t.ord === r.ord);
      if (ex) ex.score += 0.35;                   // found by both: strong signal
      continue;
    }
    seen.add(k);
    top.push({ ...r, score: r.boost * weightFor(r.path, r.source, claimType, st.sourceAware) });
  }

  top.sort((a, b) => b.score - a.score);
  return { dense, lexical, fused: top };
}

// ── vector cache ──────────────────────────────────────────────────────────────
// Held in memory so a question costs one dot-product sweep, not a table scan.
// 18.6k chunks x 768 dims x 4 bytes is about 57MB, which is cheap next to
// re-reading SQLite per request. Refreshed as the index grows.
const MAT_TTL = 120000;

function matrix(st) {
  const h = open(st);
  if (!h) return null;
  const now = Date.now();
  // TTL only. Do NOT invalidate on row-count change: while the index is being
  // built the count moves on every query, which would mean a full reload every
  // single time and made queries 20x SLOWER than the naive version.
  if (st.mat && now - st.matAt < MAT_TTL) return st.mat;

  const shape = h.prepare("SELECT dims, COUNT(*) n FROM chunks GROUP BY dims ORDER BY n DESC LIMIT 1").get();
  if (!shape?.n || !shape?.dims) { st.mat = null; return null; }
  // Most refresh checks are against an unchanged index. Keep the existing
  // matrix instead of rebuilding hundreds of MB of vectors and source text.
  if (st.mat && st.matCount === shape.n && st.mat.dims === shape.dims) {
    st.matAt = now;
    return st.mat;
  }

  const dims = shape.dims;
  const data = new Float32Array(shape.n * dims);
  const meta = new Array(shape.n);
  let n = 0;
  // Iterate so SQLite does not materialise every vector blob and every chunk
  // string in a second giant JS array while the final matrix is being built.
  const projection = st.sourceAware
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
  st.mat = { data, dims, n, meta };
  st.matAt = now; st.matCount = n;
  return st.mat;
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
  for (const m of q.matchAll(/\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)*\b/g)) ids.add(m[0]);        // CONST or CONST_NAME
  for (const m of q.matchAll(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]{2,}\b/g)) ids.add(m[0]);   // camelCase
  for (const m of q.matchAll(/\b[\w/.-]+\.(?:ts|tsx|js|jsx|json)\b/g)) ids.add(m[0]);        // file.ts
  const words = (q.toLowerCase().match(/\b[a-z][a-z-]{4,}\b/g) || [])
    .filter(w => !STOP.has(w));
  return { ids: [...ids].slice(0, 4), words: [...new Set(words)].slice(0, 6) };
}

/** FTS5/BM25 hits, merged into the semantic ranking. */
function keywordHits(h, question, sourceAware) {
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

function exactTerms(question) {
  const raw = String(question || "");
  const words = raw.match(/\b[A-Za-z][A-Za-z0-9]{2,}\b/g) || [];
  const useful = words.filter(word => !STOP.has(word.toLowerCase())).slice(0, 10);
  const terms = new Map(termsIn(raw).ids.map(term => [term, 5]));
  for (const word of useful) terms.set(word, Math.max(terms.get(word) || 0, /^[A-Z]{2,6}$/.test(word) ? 2 : 1));
  // Player prose says "GDP growth" while the code says `gdpGrowth`. FTS5 does
  // not split camel case, so explicitly bridge adjacent prose tokens.
  for (let i = 0; i < useful.length - 1; i++) {
    const a = useful[i].toLowerCase();
    const b = useful[i + 1];
    const camel = a + b[0].toUpperCase() + b.slice(1).toLowerCase();
    terms.set(camel, Math.max(terms.get(camel) || 0, 4));
  }
  const upper = new Set(words.filter(word => /^[A-Z]{2,6}$/.test(word)));
  if (upper.has("LC")) {
    terms.set("localCurrency", 4);
    terms.set("currency", Math.max(terms.get("currency") || 0, 2));
  }
  if (/\btech(?:nology)?\b/i.test(raw) && /\b(?:price|prices|cost|costs)\b/i.test(raw)) {
    terms.set("techTree", 4);
    terms.set("cashCost", 4);
    terms.set("techNodeCashCost", 5);
  }
  if (/\binput\b/i.test(raw) && /\b(?:limit|limits|shortage|shortages|constraint|constraints)\b/i.test(raw)) {
    terms.set("bindingInput", 5);
    terms.set("inputAvailabilityPct", 5);
    terms.set("inputCost", 4);
    terms.set("getEffectiveStrategyRates", 4);
  }
  return [...terms]
    .filter(([term]) => /^[A-Za-z0-9_.\/-]{2,80}$/.test(term))
    .slice(0, 20)
    .map(([term, weight]) => ({ term, weight }));
}

function exactContext(rows, maxChars, st) {
  let budget = maxChars;
  const blocks = [], files = [];
  const perFile = new Map();
  for (const row of rows) {
    const seen = perFile.get(row.path) || 0;
    if (seen >= 2) continue;
    const body = String(row.text || "").slice(0, 6200);
    if (!body || body.length > budget) continue;
    budget -= body.length;
    perFile.set(row.path, seen + 1);
    files.push(row.path);
    const label = st.sourceAware
      ? `SOURCE ${row.source || "code"} @ ${row.revision || "unknown"} | ${row.path}`
      : row.path;
    blocks.push(`--- ${label} (part ${Number(row.ord) + 1}) ---\n${body}`);
  }
  if (!blocks.length) return null;
  return {
    context: `EXACT INDEXED SOURCE MATCHES (literal symbols, phrases, and paths):\n\n${blocks.join("\n\n")}`,
    files: [...new Set(files)],
    count: blocks.length,
  };
}

function exactQuality(row, term) {
  let score = /\.test\.[cm]?[jt]sx?$|\/__tests__\/|\/__fixtures__\//i.test(row.path) ? -8 : 3;
  if (/\/lib\/(?:metricEngine|turn)\//.test(row.path)) score += 8;
  if (/\/components?\/|\/types?\//.test(row.path)) score -= 5;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b(?:const|let|var|function|class|interface|type)\\s+${escaped}\\b|\\b${escaped}\\s*=`, "i").test(row.text)) score += 18;
  return score;
}

function addExactCandidate(byKey, row, term, score) {
  const key = `${row.path}#${row.ord}`;
  const existing = byKey.get(key);
  if (existing) {
    // Repeating a common word across query variants should not let a fixture
    // crowd out the file that defines the requested symbol. Preserve the best
    // individual signal and use distinct matches only as a small tie-breaker.
    existing.exactScore = Math.max(existing.exactScore, score);
    existing.termHits.add(term.toLowerCase());
    if (row.rank != null) existing.rank = Math.min(existing.rank, row.rank);
    return;
  }
  byKey.set(key, { ...row, exactScore: score, termHits: new Set([term.toLowerCase()]) });
}

/** Literal indexed-code search for the scout when semantic retrieval misses. */
function searchExact(question, { limit = 8, maxChars = 18000, game = null } = {}) {
  const st = stateFor(game);
  const h = open(st);
  if (!h || !st.ready) return null;
  const projection = st.sourceAware
    ? "c.source_kind source,c.repository,c.revision"
    : "'code' source,'' repository,'' revision";
  const byKey = new Map();
  const terms = exactTerms(question);
  for (const { term, weight } of terms) {
    try {
      const pathProjection = st.sourceAware
        ? "source_kind source,repository,revision"
        : "'code' source,'' repository,'' revision";
      const pathRows = h.prepare(
        `SELECT path,ord,text,${pathProjection},0 rank FROM chunks
         WHERE source_kind='code' AND lower(path) LIKE ? ORDER BY path,ord LIMIT ?`,
      ).all(`%${term.toLowerCase()}%`, Math.max(20, Math.min(80, limit * 5)));
      for (const row of pathRows) {
        // An explicit file path can match every chunk in a long file. Prefer
        // the chunk that also contains the named symbol or phrase, otherwise
        // the first two chunks win by insertion order and the exact definition
        // later in the file never reaches the model.
        const body = String(row.text || "").toLowerCase();
        const contentTerms = /[/.]/.test(term)
          ? terms.filter(({ term: candidate, weight: candidateWeight }) =>
            candidateWeight > 1 && candidate.toLowerCase() !== term.toLowerCase() && body.includes(candidate.toLowerCase()),
          )
          : [];
        const definitionMatches = contentTerms.filter(({ term: candidate }) => exactQuality(row, candidate) >= 20).length;
        const score = weight * 10 + 6 + exactQuality(row, term) + contentTerms.length * 10 + definitionMatches * 30;
        addExactCandidate(byKey, row, term, score);
      }
    } catch { /* path search is an enhancement */ }
    try {
      const rows = h.prepare(
        `SELECT c.path,c.ord,c.text,${projection},bm25(chunks_fts) rank
         FROM chunks_fts f JOIN chunks c ON c.id=f.rowid
         WHERE chunks_fts MATCH ? AND c.source_kind='code'
         ORDER BY rank LIMIT ?`,
      ).all(`"${term.replace(/"/g, '""')}"`, Math.max(100, Math.min(500, limit * 25)));
      for (const row of rows) {
        const score = weight * 10 + exactQuality(row, term);
        addExactCandidate(byKey, row, term, score);
      }
    } catch { /* one invalid FTS term must not break the evidence pass */ }
  }
  const rows = [...byKey.values()]
    .sort((a, b) => b.exactScore - a.exactScore || b.termHits.size - a.termHits.size || a.rank - b.rank || a.path.localeCompare(b.path))
    .slice(0, Math.max(1, Math.min(20, limit)));
  return exactContext(rows, maxChars, st);
}

/** Read a known path from the index. Works when Ask runs without a repo clone. */
function readIndexedFile(filePath, { maxChars = 18000, game = null } = {}) {
  const key = String(filePath || "").trim().replace(/^\.\//, "");
  if (!key || key.includes("..") || key.startsWith("/") || /(?:^|\/)\.env|\.(?:pem|key|p12|pfx)$/i.test(key)) return null;
  const st = stateFor(game);
  const h = open(st);
  if (!h || !st.ready) return null;
  const projection = st.sourceAware
    ? "source_kind source,repository,revision"
    : "'code' source,'' repository,'' revision";
  const rows = h.prepare(
    `SELECT path,ord,text,${projection} FROM chunks WHERE source_kind='code' AND path=? ORDER BY ord LIMIT 40`,
  ).all(key);
  return exactContext(rows, maxChars, st);
}

function mergeEvidence(primary, exact) {
  if (!primary) return exact;
  if (!exact) return primary;
  return {
    ...primary,
    context: `${primary.context}\n\n${exact.context}`,
    files: [...new Set([...(primary.files || []), ...(exact.files || [])])],
    count: Number(primary.count || 0) + Number(exact.count || 0),
  };
}

// ── hybrid fusion v2 ──────────────────────────────────────────────────────────
// Selected per call with RAG_FUSION=v2, or { fusion: "v2" } in the search
// options. Unset means the legacy fusion above, unchanged.
//
// What legacy gets wrong, measured 2026-09-05: the dense score is a weighted
// cosine, the keyword pass discards its BM25 magnitude for a flat boost, the
// dual-hit bonus is an unnormalised +0.35, sub-queries merge by MAX so one of
// them can consume the whole budget, and the only diversity control is a
// 2-per-file cap. v2 keeps both retrievers' raw scores, min-max normalises
// each within the query, sums them under a dense/lexical weight, keeps the
// AUTHORITY multiplier, floors exact identifier hits, merges sub-queries by
// reciprocal rank fusion with a one-per-query quota at budget fill, picks the
// shortlist with MMR over the vectors already in memory, and trims the
// byte-identical overlap between adjacent chunks of one file. Knobs and the
// reasoning are in docs/retrieval-fusion-v2.md.

function fusionMode(override) {
  const mode = override != null && override !== "" ? String(override) : (process.env.RAG_FUSION || "legacy");
  return mode === "v2" ? "v2" : "legacy";
}

function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const clamp01 = v => Math.min(1, Math.max(0, v));

/** Read per call so an eval harness can sweep knobs without reloading the module. */
function fusionConfig() {
  return {
    denseW: clamp01(envNumber("RAG_FUSION_DENSE_W", 0.6)),
    denseWIdent: clamp01(envNumber("RAG_FUSION_DENSE_W_IDENT", 0.4)),
    rrfK: Math.max(1, envNumber("RAG_FUSION_RRF_K", 60)),
    mmrLambda: clamp01(envNumber("RAG_FUSION_MMR_LAMBDA", 0.7)),
    lexLimit: Math.max(1, Math.floor(envNumber("RAG_FUSION_LEX_LIMIT", 24))),
    floor: 5,        // exact identifier hits stay inside the top-5 window
    // A chunk "belongs" to a query when it is in that query's top-3. Looser
    // membership let a consensus chunk sitting ninth in a sub-query's list
    // mark that sub-query as covered while its own best hit never got in.
    originN: 3,
    minOverlap: 32,  // shorter shared spans are coincidence, not chunker overlap
  };
}

// Identifier-shaped questions: ALL_CAPS_WITH_UNDERSCORES, camelCase, or a
// path/like/this.ts. The player named a symbol, so the lexical side gets the
// larger weight. Plain acronyms (GDP, FOMC) are prose and do not qualify.
const IDENT_SHAPES = [
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/,
  /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/,
  /\b[\w-]+(?:\/[\w.-]+)+\.[a-z]{1,4}\b|\b[\w-]+\.(?:ts|tsx|js|jsx|json|md)\b/,
];
function identifierShaped(question) {
  const q = String(question || "");
  return IDENT_SHAPES.some(re => re.test(q));
}

/**
 * Min-max to [0,1] over one retriever's candidate list for this query. A flat
 * list (one candidate, or all tied) scores 1: being found counts, and the
 * absent side of a dual hit already contributes 0.
 */
function minMax(values) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo;
  return values.map(v => (range > 0 ? (v - lo) / range : 1));
}

/** FTS5 hits with their BM25 value kept (negated, so higher is better) and an exact-identifier flag. */
function lexicalHits(h, question, sourceAware, cfg) {
  const { ids, words } = termsIn(question);
  const byKey = new Map();
  const sourceProjection = sourceAware
    ? "c.source_kind source,c.repository,c.revision"
    : "'code' source,'' repository,'' revision";
  const run = (expr, limit, exact) => {
    try {
      const rows = h.prepare(
        `SELECT c.path,c.ord,c.text,${sourceProjection},bm25(chunks_fts) rank FROM chunks_fts f JOIN chunks c ON c.id=f.rowid
         WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`).all(expr, limit);
      for (const r of rows) {
        const key = r.path + "#" + r.ord;
        const raw = -Number(r.rank);
        const prev = byKey.get(key);
        if (prev) { prev.raw = Math.max(prev.raw, raw); prev.exact = prev.exact || exact; continue; }
        byKey.set(key, {
          path: r.path, ord: r.ord, text: r.text, source: r.source, repository: r.repository, revision: r.revision,
          raw, exact,
        });
      }
    } catch { /* FTS is an enhancement; a bad expression must not break search */ }
  };
  for (const id of ids) run(`"${id}"`, 5, true);
  if (words.length) run(words.map(w => `"${w}"`).join(" OR "), cfg.lexLimit, false);
  return [...byKey.values()];
}

/**
 * Exact identifier hits never rank below the top-`floor` window. The window
 * holds the best `floor` exact hits plus the best remaining candidates, in
 * score order; everything else follows in score order. More exact hits than
 * the window can hold compete normally for the rest.
 */
function applyFloor(sorted, floor) {
  const size = Math.min(floor, sorted.length);
  const exact = sorted.filter(c => c.exact).slice(0, size);
  if (!exact.length) return sorted;
  const window = new Set(exact);
  for (const c of sorted) {
    if (window.size >= size) break;
    if (!c.exact) window.add(c);
  }
  return [...sorted.filter(c => window.has(c)), ...sorted.filter(c => !window.has(c))];
}

/** Mark which query found each chunk (top-originN only), for the quota at budget fill. */
function tagRanks(list, queryIndex, originN) {
  list.forEach((c, i) => {
    c.ranks = c.ranks || {};
    if (i < originN) c.ranks[queryIndex] = i;
  });
  return list;
}

/** v2 candidates for one query. null when the index is unavailable. */
async function collectV2(question, claimType, st, { debug = false } = {}) {
  const h = open(st);
  if (!h || !st.ready) return null;

  let qv;
  try { qv = await embedQuery(question); } catch { return null; }

  const M = matrix(st);
  if (!M || M.n === 0) return null;
  if (M.dims !== qv.length) return null;

  const cfg = fusionConfig();
  const wDense = identifierShaped(question) ? cfg.denseWIdent : cfg.denseW;
  const wLex = 1 - wDense;

  // Same sweep as legacy. The candidate cut is still on the weighted score:
  // an upweighted constants chunk just below the raw cutoff must survive to
  // be normalised at all.
  const { data, dims, n, meta } = M;
  const cosine = new Float32Array(n);
  const weighted = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * dims;
    let dot = 0;
    for (let j = 0; j < dims; j++) dot += qv[j] * data[off + j];
    cosine[i] = dot;
    weighted[i] = dot * weightFor(meta[i].path, meta[i].source, claimType, st.sourceAware);
  }
  const KEEP = Math.min(n, 200);
  const sorted = Float32Array.prototype.slice.call(weighted).sort();
  const cutoff = sorted[Math.max(0, n - KEEP)];
  const dense = [];
  for (let i = 0; i < n && dense.length < KEEP * 2; i++) {
    if (weighted[i] < cutoff) continue;
    dense.push({ ...meta[i], cosine: cosine[i], authority: weightFor(meta[i].path, meta[i].source, claimType, st.sourceAware) });
  }
  const denseNorm = minMax(dense.map(d => d.cosine));
  dense.forEach((d, i) => { d.norm = denseNorm[i]; });

  const lexical = lexicalHits(h, question, st.sourceAware, cfg);
  const lexNorm = minMax(lexical.map(l => l.raw));
  lexical.forEach((l, i) => { l.norm = lexNorm[i]; });

  // CombSUM: a chunk both retrievers found gets both normalised scores; a
  // chunk one side missed contributes 0 there. Authority multiplies the sum.
  const byKey = new Map();
  for (const d of dense) {
    byKey.set(d.path + "#" + d.ord, {
      path: d.path, ord: d.ord, text: d.text, source: d.source, repository: d.repository, revision: d.revision,
      authority: d.authority, dense: d.norm, lexical: 0, exact: false,
    });
  }
  for (const l of lexical) {
    const key = l.path + "#" + l.ord;
    const ex = byKey.get(key);
    if (ex) { ex.lexical = l.norm; ex.exact = ex.exact || l.exact; continue; }
    byKey.set(key, {
      path: l.path, ord: l.ord, text: l.text, source: l.source, repository: l.repository, revision: l.revision,
      authority: weightFor(l.path, l.source, claimType, st.sourceAware), dense: 0, lexical: l.norm, exact: l.exact,
    });
  }
  const fused = [...byKey.values()];
  for (const c of fused) c.score = c.authority * (wDense * c.dense + wLex * c.lexical);
  fused.sort((a, b) => b.score - a.score);
  const ranked = tagRanks(applyFloor(fused, cfg.floor), 0, cfg.originN);
  return debug ? { dense, lexical, fused: ranked, weights: { dense: wDense, lexical: wLex } } : ranked;
}

/**
 * Reciprocal rank fusion across per-query candidate lists. Consensus across
 * sub-queries is what MAX-merge could not see; a chunk three sub-queries each
 * rank tenth now beats one that a single sub-query ranked first. Scores are
 * rescaled so the best is 1, which keeps the MMR relevance term on the same
 * footing as the single-query path. The exact flag survives the merge.
 */
function rrfMerge(lists, k, originN) {
  const byKey = new Map();
  lists.forEach((list, qi) => {
    if (!list) return;
    list.forEach((c, i) => {
      const key = c.path + "#" + c.ord;
      let e = byKey.get(key);
      if (!e) {
        e = {
          path: c.path, ord: c.ord, text: c.text, source: c.source, repository: c.repository, revision: c.revision,
          authority: c.authority, score: 0, rrf: 0, exact: false, ranks: {},
        };
        byKey.set(key, e);
      }
      e.rrf += 1 / (k + i + 1);
      e.exact = e.exact || Boolean(c.exact);
      if (i < originN) e.ranks[qi] = i;
    });
  });
  const merged = [...byKey.values()].sort((a, b) => b.rrf - a.rrf);
  const top = merged.length ? merged[0].rrf : 1;
  for (const c of merged) c.score = c.rrf / top;
  return merged;
}

async function searchMultiV2(queries, claimType, st, topK, maxChars) {
  const cfg = fusionConfig();
  const lists = await Promise.all(queries.map(q => collectV2(q, claimType, st).catch(() => null)));
  if (!lists.some(Boolean)) return null;
  const merged = applyFloor(rrfMerge(lists, cfg.rrfK, cfg.originN), cfg.floor);
  return finishV2(merged, topK, claimType, maxChars, st, queries.length);
}

function dot(a, b) {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += a[j] * b[j];
  return s;
}

/** Stored vector for a candidate, from the matrix already in memory. null when the chunk is not in it. */
function vectorFor(st, c) {
  const M = st.mat;
  if (!M) return null;
  if (!M.index) {
    M.index = new Map();
    for (let i = 0; i < M.n; i++) M.index.set(M.meta[i].path + "#" + M.meta[i].ord, i);
  }
  const i = M.index.get(c.path + "#" + c.ord);
  return i == null ? null : M.data.subarray(i * M.dims, (i + 1) * M.dims);
}

/**
 * Which chunks go to the budget walk, and in what order. The budget binds on
 * nearly every question (6000-char chunks against a 22000-char window), so
 * walk order is the real selection: it is a priority ladder, not a sort.
 *   1. exact identifier hits inside the floor window: the player named it;
 *   2. the best unrepresented chunk for each query, question first, so every
 *      sub-query contributes one chunk before any contributes a second;
 *   3. MMR over the fused shortlist for the rest: relevance minus the
 *      nearest already-picked chunk, so two overlapping chunks of one file do
 *      not both spend the budget when a second file would add more.
 */
function selectV2(scored, topK, queryCount, cfg, st, vectors = null) {
  const picked = [];
  const pickedSet = new Set();
  const take = c => { picked.push(c); pickedSet.add(c); };

  for (const c of scored.slice(0, cfg.floor)) if (c.exact && picked.length < topK) take(c);

  for (let q = 0; q < queryCount && picked.length < topK; q++) {
    if (picked.some(c => c.ranks && c.ranks[q] != null)) continue;
    let best = null;
    for (const c of scored) {
      if (pickedSet.has(c) || !c.ranks || c.ranks[q] == null) continue;
      if (!best || c.ranks[q] < best.ranks[q]) best = c;
    }
    if (best) take(best);
  }

  const shortlist = scored.slice(0, Math.max(topK * 5, 40));
  let top = 0;
  for (const c of shortlist) if (c.score > top) top = c.score;
  const rel = c => (top > 0 ? c.score / top : 0);
  const vec = vectors || (c => vectorFor(st, c));
  const pool = shortlist.filter(c => !pickedSet.has(c)).map(c => ({ c, v: vec(c), maxSim: 0 }));
  const bump = p => {
    const pv = vec(p);
    if (!pv) return;
    for (const entry of pool) if (entry.v) entry.maxSim = Math.max(entry.maxSim, dot(entry.v, pv));
  };
  for (const p of picked) bump(p);
  while (picked.length < topK && pool.length) {
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = cfg.mmrLambda * rel(pool[i].c) - (1 - cfg.mmrLambda) * pool[i].maxSim;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    const [chosen] = pool.splice(best, 1);
    take(chosen.c);
    bump(chosen.c);
  }
  return picked;
}

// The chunker prefixes each chunk with a "[kind] path (part n/N)" line and
// overlaps consecutive bodies by 400 chars. The dedupe compares bodies with
// that line excluded and cuts the shared span from whichever block the model
// reads second, so the text stays contiguous in reading order.
const CHUNK_HEADER = /^\[[a-z]+\] [^\n]*\n/;
function splitHeader(text) {
  const m = text.match(CHUNK_HEADER);
  return m ? [m[0], text.slice(m[0].length)] : ["", text];
}

function overlapLength(a, b, min) {
  for (let l = Math.min(a.length, b.length, 1000); l >= min; l--) {
    if (a.endsWith(b.slice(0, l))) return l;
  }
  return 0;
}

/** Trim byte-identical overlap between adjacent ords of one file. Mutates `body` in place; only ever shrinks. */
function dedupeOverlaps(included, minOverlap) {
  const byFile = new Map();
  included.forEach((entry, i) => {
    const key = `${entry.c.source || "code"}|${entry.c.path}`;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(i);
  });
  for (const indices of byFile.values()) {
    if (indices.length < 2) continue;
    const byOrd = indices.slice().sort((x, y) => included[x].c.ord - included[y].c.ord);
    for (let k = 0; k + 1 < byOrd.length; k++) {
      const a = byOrd[k], b = byOrd[k + 1];
      if (included[b].c.ord !== included[a].c.ord + 1) continue;
      const [, bodyA] = splitHeader(included[a].body);
      const [headB, bodyB] = splitHeader(included[b].body);
      const L = overlapLength(bodyA, bodyB, minOverlap);
      if (!L) continue;
      if (a < b) {
        if (bodyB.length > L) included[b].body = headB + bodyB.slice(L);
      } else if (bodyA.length > L) {
        included[a].body = included[a].body.slice(0, included[a].body.length - L);
      }
    }
  }
  return included;
}

function finishV2(scored, topK, claimType, maxChars = MAX_CHARS, st = { sourceAware: false }, queryCount = 1) {
  const cfg = fusionConfig();
  const selected = selectV2(scored, topK, queryCount, cfg, st);

  // Same budget walk as legacy: `continue`, NOT `break`, so one oversized
  // chunk cannot silently drop every smaller chunk behind it.
  let budget = maxChars;
  const included = [];
  for (const c of selected) {
    const body = c.text.length > 6200 ? c.text.slice(0, 6200) : c.text;
    if (body.length > budget) continue;
    budget -= body.length;
    included.push({ c, body });
  }
  if (!included.length) return null;
  dedupeOverlaps(included, cfg.minOverlap);

  const blocks = [];
  const files = [];
  const evidence = [];
  for (const { c, body } of included) {
    files.push(c.path);
    evidence.push({
      source: c.source || "code", repository: c.repository || null,
      revision: c.revision || null, path: c.path, ord: c.ord, score: c.score,
      text: body,
    });
    const label = st.sourceAware
      ? `SOURCE ${c.source} @ ${c.revision} | ${c.path}`
      : c.path;
    blocks.push(`--- ${label} (part ${c.ord + 1}, relevance ${c.score.toFixed(3)}) ---\n${body}`);
  }
  return {
    context: st.sourceAware
      ? `RETRIEVED EVIDENCE (${claimType} question). For current mechanics, executable code wins conflicts. For design intent, engineering docs win. For player navigation and explanation, shipped wiki prose is preferred unless it conflicts with code.\n\n${blocks.join("\n\n")}`
      : `SOURCE CODE (the actual text of the most relevant parts of the game, retrieved for this question.\nThis is the game's real current behaviour and outranks any documentation):\n\n${blocks.join("\n\n")}`,
    files: [...new Set(files)],
    count: blocks.length,
    hits: evidence,
    claimType,
  };
}

/**
 * Per-retriever candidate lists for one question, for the eval harness. Pure
 * addition: reads the same paths search() takes in whichever mode is active
 * (or the `fusion` override) and changes nothing.
 */
async function debugCandidates(question, { claimType = inferClaimType(question), game = null, fusion } = {}) {
  const st = stateFor(game);
  const mode = fusionMode(fusion);
  const slim = c => ({ path: c.path, ord: c.ord, source: c.source || "code" });
  if (mode === "v2") {
    const parts = await collectV2(question, claimType, st, { debug: true });
    if (!parts) return null;
    return {
      mode, claimType, weights: parts.weights,
      dense: parts.dense.map(d => ({ ...slim(d), score: d.norm, cosine: d.cosine, authority: d.authority }))
        .sort((a, b) => b.cosine - a.cosine),
      lexical: parts.lexical.map(l => ({ ...slim(l), score: l.norm, bm25: -l.raw, exact: l.exact }))
        .sort((a, b) => b.bm25 - a.bm25),
      fused: parts.fused.map(c => ({ ...slim(c), score: c.score, dense: c.dense, lexical: c.lexical, authority: c.authority, exact: c.exact })),
    };
  }
  const parts = await candidatesLegacy(question, claimType, st, { debug: true });
  if (!parts) return null;
  return {
    mode, claimType, weights: null,
    dense: parts.dense.map(d => ({ ...slim(d), score: d.score })).sort((a, b) => b.score - a.score),
    lexical: parts.lexical.map(l => ({ ...slim(l), score: l.boost, exact: l.boost === 1.5 })),
    fused: parts.fused.map(c => ({ ...slim(c), score: c.score })),
  };
}

const __debug = {
  candidates: debugCandidates,
  fusionMode, fusionConfig, identifierShaped, minMax, applyFloor, rrfMerge, selectV2, dedupeOverlaps, overlapLength,
};

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

function weightFor(p, source = "code", claimType = "general", sourceAware = false) {
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

function finish(scored, topK, claimType, maxChars = MAX_CHARS, st = { sourceAware: false }) {
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
      // The chunk body actually sent to the model, so downstream attribution
      // can measure which sentences of the answer this chunk supports without
      // re-parsing the assembled context string.
      text: body,
    });
    const label = st.sourceAware
      ? `SOURCE ${c.source} @ ${c.revision} | ${c.path}`
      : c.path;
    blocks.push(`--- ${label} (part ${c.ord + 1}, relevance ${c.score.toFixed(3)}) ---\n${body}`);
  }
  if (!blocks.length) return null;

  return {
    context: st.sourceAware
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
function hasPath(path, game = null) {
  const key = String(path || "").trim();
  if (!key) return false;
  const st = stateFor(game);
  if (st.pathCache.has(key)) return st.pathCache.get(key);
  const h = open(st);
  if (!h) return false;                       // no index: claim nothing either way
  let found = false;
  try {
    found = !!h.prepare("SELECT 1 FROM chunks WHERE path=? LIMIT 1").get(key);
  } catch { found = false; }
  if (st.pathCache.size > 5000) st.pathCache.clear();
  st.pathCache.set(key, found);
  return found;
}

function stats(game = null) {
  const st = stateFor(game);
  const h = open(st);
  if (!h) return { ready: false, chunks: 0 };
  try {
    const c = h.prepare("SELECT COUNT(*) c FROM chunks").get().c;
    if (st.sourceAware) {
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

// ── evaluation hook ───────────────────────────────────────────────────────────
// Per-retriever candidate lists for the retrieval eval harness
// (eval/retrieval). Nothing on the answer path calls this. It reads the same
// matrix, the same authority weights and the same FTS expressions collect()
// uses, so "dense-only" and "BM25-only" here mean the production components
// run in isolation, not a reimplementation. Keep the dense formula identical
// to the sweep in collect(): dot product times weightFor().
async function isolatedCandidates(question, { claimType = inferClaimType(question), game = null, denseK = 200, ftsLimit = 50 } = {}) {
  const st = stateFor(game);
  const h = open(st);
  if (!h || !st.ready) return null;
  const qv = await embedQuery(question);
  const M = matrix(st);
  if (!M || M.n === 0 || M.dims !== qv.length) return null;
  const { data, dims, n, meta } = M;
  const scored = new Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * dims;
    let dot = 0;
    for (let j = 0; j < dims; j++) dot += qv[j] * data[off + j];
    scored[i] = { i, score: dot * weightFor(meta[i].path, meta[i].source, claimType, st.sourceAware) };
  }
  scored.sort((a, b) => b.score - a.score);
  const dense = scored.slice(0, denseK).map(d => ({ ...meta[d.i], score: d.score }));

  // BM25-only: the expressions keywordHits() builds, ranked by bm25 within
  // each expression, explicit symbols ahead of rare words. The score keeps the
  // production boost*weight magnitude and adds a strictly decreasing rank term
  // so the list has a total order finish() can consume.
  const { ids, words } = termsIn(question);
  const sourceProjection = st.sourceAware
    ? "c.source_kind source,c.repository,c.revision"
    : "'code' source,'' repository,'' revision";
  const byKey = new Map();
  const runFts = (expr, boost) => {
    let rows = [];
    try {
      rows = h.prepare(
        `SELECT c.path,c.ord,c.text,${sourceProjection},bm25(chunks_fts) rank FROM chunks_fts f JOIN chunks c ON c.id=f.rowid
         WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?`).all(expr, ftsLimit);
    } catch { return; }
    rows.forEach((r, idx) => {
      const key = r.path + "#" + r.ord;
      const score = boost * weightFor(r.path, r.source, claimType, st.sourceAware) + (ftsLimit - idx) * 1e-4;
      const prev = byKey.get(key);
      if (!prev || score > prev.score) byKey.set(key, { ...r, boost, score });
    });
  };
  for (const id of ids) runFts(`"${id}"`, 1.5);
  if (words.length) runFts(words.map(w => `"${w}"`).join(" OR "), 0.92);
  const bm25 = [...byKey.values()].sort((a, b) => b.score - a.score);

  const hybrid = await collect(question, claimType, st);
  return { claimType, dense, bm25, hybrid: hybrid || [] };
}

// The harness reads the production components in isolation through the same
// debug surface fusion v2 exposes; distinct keys so neither shape shadows the
// other. Nothing on the answer path calls these.
__debug.isolated = isolatedCandidates;
__debug.finish = (scored, { topK = TOP_K, maxChars = MAX_CHARS, claimType = "general", game = null } = {}) =>
  finish(scored, topK, claimType, maxChars, stateFor(game));

module.exports = { inferClaimType, search, searchMulti, searchExact, readIndexedFile, mergeEvidence, stats, embedQuery, embedBatch, embedEach, vectorsFor, hasPath, __debug };
