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
        method: "POST", headers: { "Content-Type": "application/json" },
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
      method: "POST", headers: { "Content-Type": "application/json" },
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
async function search(question, { topK = TOP_K, maxChars = MAX_CHARS, claimType = inferClaimType(question), game = null } = {}) {
  const st = stateFor(game);
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
async function searchMulti(question, subQueries = [], { topK = TOP_K, maxChars = MAX_CHARS, claimType = inferClaimType(question), game = null } = {}) {
  const st = stateFor(game);
  const queries = [question, ...subQueries.map(q => String(q || "").trim()).filter(Boolean).slice(0, 4)];
  if (queries.length === 1) return search(question, { topK, maxChars, claimType, game });
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
  for (const r of keywordHits(h, question, st.sourceAware)) {
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
  return top;
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

module.exports = { inferClaimType, search, searchMulti, searchExact, readIndexedFile, mergeEvidence, stats, embedQuery, embedBatch, embedEach, vectorsFor, hasPath };
