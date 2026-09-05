#!/usr/bin/env node
// Build the retrieval gold set. Every step is idempotent and resumable; the
// LLM steps cache by content hash so rerunning costs no calls.
//
//   node eval/retrieval/build-gold.mjs pool          real queries -> gold/real-queries.jsonl
//   node eval/retrieval/build-gold.mjs synth         sample chunks, LLM writes one question each -> gold/synthetic-queries.jsonl
//   node eval/retrieval/build-gold.mjs candidates    dense/bm25/hybrid @50 pools per real query -> $RAG_EVAL_POOLS
//   node eval/retrieval/build-gold.mjs adjudicate    LLM grades each pool listwise -> cache/verdicts.jsonl
//   node eval/retrieval/build-gold.mjs finalize      qrels.txt + sidecar + queries.jsonl with dev/heldout split
//   node eval/retrieval/build-gold.mjs status
//
// Options: --limit N   --max-minutes M   --concurrency C   --dry
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB = require("./lib/db.js");
const { museCall, parseJsonLoose, pMap, sha1, ledgerCount } = require("./lib/muse.js");
const { writeQrels } = require("./lib/trec.js");
const { assignSplit } = require("./lib/split.js");
const { mulberry32 } = require("./lib/stats.js");
const C = require("./lib/curation.js");

// The snapshot must be the index before retrieve.js reads its env.
process.env.RAG_DB = DB.SNAPSHOT;
const retrieve = require("../../retrieve.js");

const GOLD = path.join(__dirname, "gold");
const CACHE = path.join(__dirname, "cache");
const EVAL_DIR = path.join(__dirname, "..");
const POOLS = process.env.RAG_EVAL_POOLS || "/root/misc/ask-remediation/eval/pools";
const ASK_DB = process.env.ASK_DB || "/root/projects/ask-site/ask.db";
const REPLAY = process.env.ASK_REPLAY || "/tmp/ask-replay2.json";
const VERDICTS = path.join(CACHE, "verdicts.jsonl");
const POOL_K = 50;

const args = process.argv.slice(2);
const step = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const LIMIT = Number(opt("limit", Infinity));
const MAX_MINUTES = Number(opt("max-minutes", 8));
const CONCURRENCY = Number(opt("concurrency", 3));
const DRY = opt("dry", false) === true;
const deadline = Date.now() + MAX_MINUTES * 60000;

const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join("\n") + "\n"); };
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

// ── pool ─────────────────────────────────────────────────────────────────────
function pool() {
  const out = new Map();   // dedupeKey -> query
  const add = (text, kind, source, ref) => {
    const clean = C.anonymize(text);
    if (!clean || clean.length < 8) return;
    const key = C.dedupeKey(clean);
    if (out.has(key)) { out.get(key).alsoIn.push(`${source}:${ref}`); return; }
    if (!kind) { log(`${source}:${ref} is new but has no kind, skipping: ${clean.slice(0, 70)}`); return; }
    if (!C.KINDS.includes(kind)) throw new Error(`bad kind ${kind} for ${source}:${ref}`);
    out.set(key, { qid: "r_" + sha1(key).slice(0, 10), text: clean, kind, source, sourceRef: String(ref), alsoIn: [] });
  };
  // (i) historical ask.db, phrasing only
  if (fs.existsSync(ASK_DB)) {
    const Database = require("better-sqlite3");
    const db = new Database(ASK_DB, { readonly: true });
    for (const r of db.prepare("SELECT id, question FROM asks ORDER BY id").all()) {
      if (C.ASK_DB_SKIP.has(r.id)) continue;
      add(r.question, C.ASK_DB_KIND[r.id], "ask_db", r.id);
    }
    db.close();
  } else log("ask.db not found, skipping", ASK_DB);
  // (ii) production downvote replay feed
  if (fs.existsSync(REPLAY)) {
    for (const c of JSON.parse(fs.readFileSync(REPLAY, "utf8")).candidates || []) {
      if (C.REPLAY_SKIP.has(c.answerId)) continue;
      add(c.question, C.REPLAY_KIND[c.answerId], "replay_downvote", c.answerId);
    }
  } else log("replay feed not found, skipping", REPLAY);
  // (iii) committed eval files
  for (const c of JSON.parse(fs.readFileSync(path.join(EVAL_DIR, "reported-failures.json"), "utf8"))) {
    add(c.question, C.REPORTED_FAILURES_KIND[c.name] || "mechanic", "reported_failures", c.name);
  }
  for (const c of JSON.parse(fs.readFileSync(path.join(EVAL_DIR, "general-replay-cases.json"), "utf8"))) {
    if (C.GENERAL_REPLAY_SKIP.has(c.id)) continue;
    add(c.q, C.GENERAL_REPLAY_KIND[c.id], "general_replay", c.id);
  }
  JSON.parse(fs.readFileSync(path.join(EVAL_DIR, "corpus-candidates.json"), "utf8")).forEach((c, i) => {
    add(c.question, C.CORPUS_CANDIDATES_KIND[i] || "mechanic", "corpus_candidates", i);
  });
  for (const c of JSON.parse(fs.readFileSync(path.join(EVAL_DIR, "ticket-1234-cases.json"), "utf8"))) {
    if (C.TICKET_SKIP.has(c.id)) continue;
    add(c.q, C.TICKET_KIND[c.id] || "mechanic", "ticket_1234", c.id);
  }
  // (iv) authored
  JSON.parse(fs.readFileSync(path.join(GOLD, "authored.json"), "utf8")).questions.forEach((q, i) => add(q.text, q.kind, "authored", i));

  const rows = [...out.values()];
  writeJsonl(path.join(GOLD, "real-queries.jsonl"), rows);
  const byKind = {}, bySource = {};
  for (const r of rows) { byKind[r.kind] = (byKind[r.kind] || 0) + 1; bySource[r.source] = (bySource[r.source] || 0) + 1; }
  log(`real queries: ${rows.length}`, JSON.stringify(byKind), JSON.stringify(bySource));
  if (DRY) for (const r of rows) console.log(`${r.qid}\t${r.kind}\t${r.source}\t${r.text.slice(0, 110)}`);
}

// ── synth ────────────────────────────────────────────────────────────────────
// Stratified sample. Tests, fixtures, data tables and typings are excluded:
// a player never asks a question that a test file is the best answer to.
const SYNTH_PLAN = [
  { name: "code-lib", where: "source_kind='code' AND path LIKE 'src/lib/%'", quota: { "s<800": 15, "m800-2000": 25, "l2000-4000": 25, "xl4000+": 25 } },
  { name: "code-app", where: "source_kind='code' AND path LIKE 'src/app/%'", quota: { "s<800": 3, "m800-2000": 4, "l2000-4000": 4, "xl4000+": 4 } },
  { name: "code-components", where: "source_kind='code' AND path LIKE 'src/components/%'", quota: { "s<800": 3, "m800-2000": 4, "l2000-4000": 4, "xl4000+": 4 } },
  { name: "docs", where: "source_kind='docs'", quota: { "s<800": 3, "m800-2000": 7, "l2000-4000": 10, "xl4000+": 20 } },
  { name: "wiki", where: "source_kind='wiki'", quota: { "s<800": 3, "m800-2000": 7, "l2000-4000": 10, "xl4000+": 20 } },
];
const EXCLUDE = "path NOT LIKE '%.test.%' AND path NOT LIKE '%__tests__%' AND path NOT LIKE '%__fixtures__%' AND path NOT LIKE '%.spec.%' AND path NOT LIKE '%.d.ts' AND path NOT LIKE '%RegionImages%' AND path NOT LIKE 'src/data/%' AND path NOT LIKE 'src/typings/%' AND path NOT LIKE 'src/i18n/%'";
const SYNTH_BATCH = 6;

function sampleChunks() {
  const file = path.join(CACHE, "synth-sample.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const db = DB.openSnapshot();
  const rnd = mulberry32(20260905);
  const picked = [];
  for (const plan of SYNTH_PLAN) {
    const rows = db.prepare(`SELECT path, ord, hash, source_kind, text FROM chunks WHERE ${plan.where} AND ${EXCLUDE}`).all().map(DB.describe);
    for (const [bucket, n] of Object.entries(plan.quota)) {
      const pool = rows.filter(r => r.lengthBucket === bucket);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      for (const r of pool.slice(0, n)) picked.push({ stratum: plan.name, docid: r.docid, hash: r.hash, bodySha1: r.bodySha1, sourceKind: r.sourceKind, chars: r.chars, lengthBucket: r.lengthBucket });
    }
  }
  db.close();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(picked, null, 1));
  return picked;
}

function synthPrompt(items) {
  const blocks = items.map((it, i) => `[${i + 1}] ${it.docid} (${it.sourceKind})\n${it.text.slice(0, 2500)}`).join("\n\n");
  return `You write realistic questions for a search benchmark. The product is an assistant that answers questions about A House Divided, a multiplayer political and economic strategy game (elections, legislatures, parties, corporations, commodities, banking, budgets, wars), using the game's source code, engineering docs and wiki.

For each excerpt below, write ONE question that a player (or a curious power user) would plausibly ask, such that THIS excerpt is the best place to find the answer.

Rules:
- Ask about game behaviour, rules, numbers, causes or where to find things, the way a player types in chat. Do not mention file paths.
- Name a code identifier (a CONSTANT_NAME or functionName) only when the excerpt defines it and a power user might ask by name; do that for at most one excerpt in this batch.
- Vary the register: some short and sloppy, some precise and multi-part.
- Paraphrase in the asker's words; do not copy sentences from the excerpt.
- If the excerpt is not answerable material (imports, boilerplate, UI plumbing with no game meaning, test scaffolding, data with no rule), set question to null.
- kind is one of: "symbol" (asks by identifier), "mechanic" (one rule or number), "causal" (how systems affect each other, why something happens), "navigation" (where to click or find something).

Return ONLY a JSON array like [{"id": 1, "question": "...", "kind": "mechanic"}, {"id": 2, "question": null, "kind": null}].

EXCERPTS:

${blocks}
`;
}

async function synth() {
  const sample = sampleChunks();
  log(`synthetic sample: ${sample.length} chunks`);
  const db = DB.openSnapshot();
  const batches = [];
  for (let i = 0; i < sample.length; i += SYNTH_BATCH) batches.push(sample.slice(i, i + SYNTH_BATCH));
  const dir = path.join(CACHE, "synth-batches");
  fs.mkdirSync(dir, { recursive: true });
  let calls = 0, done = 0;
  const todo = batches.map((b, i) => ({ b, i })).filter(({ i }) => !fs.existsSync(path.join(dir, `${String(i).padStart(3, "0")}.json`))).slice(0, LIMIT);
  log(`batches: ${batches.length} total, ${todo.length} to do`);
  await pMap(todo, async ({ b, i }) => {
    if (Date.now() > deadline) return;
    const items = b.map(s => ({ ...s, text: DB.chunkRow(db, s.docid)?.text || "" }));
    const prompt = synthPrompt(items);
    if (DRY) { console.log(prompt.slice(0, 1500)); return; }
    let parsed = null, raw = null, attempts = 0;
    while (!parsed && attempts < 3) {
      attempts++; calls++;
      const r = await museCall(prompt, { purpose: "synth" });
      raw = r;
      if (!r.ok) { log(`batch ${i} attempt ${attempts} failed: ${r.error}`); continue; }
      const j = parseJsonLoose(r.text);
      if (Array.isArray(j)) parsed = j;
      else log(`batch ${i} attempt ${attempts}: unparseable output`);
    }
    if (!parsed) return;
    const rows = parsed.map(e => {
      const idx = Number(e.id) - 1;
      const src = b[idx];
      if (!src) return null;
      const question = typeof e.question === "string" && e.question.trim().length >= 10 ? C.anonymize(e.question) : null;
      const kind = ["symbol", "mechanic", "causal", "navigation"].includes(e.kind) ? e.kind : (question ? "mechanic" : null);
      return { origin: src, question, kind };
    }).filter(Boolean);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(3, "0")}.json`), JSON.stringify({ batch: i, ms: raw.ms, rows }, null, 1));
    done++;
  }, CONCURRENCY);
  db.close();
  log(`synth: ${done} batches written, ${calls} LLM calls this run`);
  // Assemble
  const rows = [];
  const seen = new Set();
  for (const f of fs.readdirSync(dir).sort()) {
    for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).rows) {
      if (!r.question) continue;
      const key = C.dedupeKey(r.question);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ qid: "s_" + sha1(r.origin.docid + "|" + key).slice(0, 10), text: r.question, kind: r.kind, source: "synthetic", origin: r.origin });
    }
  }
  writeJsonl(path.join(GOLD, "synthetic-queries.jsonl"), rows);
  const byKind = {}, byStratum = {};
  for (const r of rows) { byKind[r.kind] = (byKind[r.kind] || 0) + 1; byStratum[r.origin.stratum] = (byStratum[r.origin.stratum] || 0) + 1; }
  log(`synthetic queries: ${rows.length}`, JSON.stringify(byKind), JSON.stringify(byStratum));
}

// ── candidates ───────────────────────────────────────────────────────────────
async function candidates() {
  const which = opt("synthetic", false) === true ? "synthetic-queries.jsonl" : "real-queries.jsonl";
  const queries = readJsonl(path.join(GOLD, which));
  fs.mkdirSync(POOLS, { recursive: true });
  const db = DB.openSnapshot();
  const hashQ = db.prepare("SELECT hash, source_kind, length(text) chars, text FROM chunks WHERE path=? AND ord=? LIMIT 1");
  let n = 0;
  for (const q of queries) {
    const file = path.join(POOLS, `${q.qid}.json`);
    if (fs.existsSync(file)) continue;
    if (n >= LIMIT || Date.now() > deadline) break;
    const c = await retrieve.__debug.isolated(q.text, { denseK: POOL_K, ftsLimit: POOL_K });
    if (!c) { log(`no candidates for ${q.qid}`); continue; }
    const pool = new Map();
    const take = (list, name) => list.slice(0, POOL_K).forEach((h, i) => {
      const id = DB.docid(h.path, h.ord);
      if (!pool.has(id)) {
        const row = hashQ.get(h.path, h.ord);
        pool.set(id, { docid: id, hash: row?.hash || null, bodySha1: DB.bodySha1(row?.text || ""), sourceKind: row?.source_kind || h.source, chars: row?.chars || 0, retrievers: {}, });
      }
      pool.get(id).retrievers[name] = i + 1;
    });
    take(c.dense, "dense"); take(c.bm25, "bm25"); take(c.hybrid, "hybrid");
    fs.writeFileSync(file, JSON.stringify({ qid: q.qid, text: q.text, kind: q.kind, claimType: c.claimType, snapshotSha256: DB.sha256File(DB.SNAPSHOT), sizes: { dense: c.dense.length, bm25: c.bm25.length, hybrid: c.hybrid.length }, pool: [...pool.values()] }, null, 1));
    n++;
  }
  db.close();
  log(`candidates: ${n} pools written, ${fs.readdirSync(POOLS).length} total on disk`);
}

// ── adjudicate ───────────────────────────────────────────────────────────────
// One line per graded query: { qhash, qid, ts, ms, v: { chunkHash: grade } }.
// Grade 0 is stored explicitly: it is a judged non-relevant, distinct from
// a chunk the pool never contained.
function loadVerdicts() {
  const m = new Map();   // `${qhash}|${hash}` -> grade
  for (const line of readJsonl(VERDICTS)) for (const [hash, grade] of Object.entries(line.v || {})) m.set(`${line.qhash}|${hash}`, grade);
  return m;
}
const qhashOf = text => sha1(C.dedupeKey(text));

// Code identifiers the question names: CONSTANT_NAMES (an underscore, or
// seven or more capitals so GDP, NATO and FOMC read as prose), camelCase and
// file paths. Narrower than retrieve.js termsIn() on purpose: this only
// decides which excerpt the judge sees.
function identifiersIn(text) {
  const q = String(text || "");
  const ids = new Set();
  for (const m of q.matchAll(/\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)*\b/g)) if (m[0].includes("_") || m[0].length >= 7) ids.add(m[0]);
  for (const m of q.matchAll(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]{2,}\b/g)) ids.add(m[0]);
  for (const m of q.matchAll(/\b[\w/.-]+\.(?:ts|tsx|js|jsx|json)\b/g)) ids.add(m[0]);
  return [...ids];
}

// Excerpt shown to the judge. Version 2: when the question names an
// identifier and the chunk contains it past the first 200 chars, show the
// header plus a window around the first occurrence. Without that, a constant
// defined halfway down a constants file was invisible and graded 0 while
// sitting at BM25 rank 1. Questions with no identifier get the same first
// 400 chars as version 1, so their cached verdicts remain valid.
const EXCERPT_VERSION = 2;
function excerptFor(text, ids) {
  const t = String(text || "");
  const head = t.slice(0, 400);
  const lower = t.toLowerCase();
  for (const id of ids) {
    const i = lower.indexOf(id.toLowerCase());
    if (i < 0) continue;
    if (i < 200) return head;
    const start = Math.max(0, i - 120);
    return t.slice(0, 200) + "\n[...]\n" + t.slice(start, start + 320);
  }
  return head;
}

function judgePrompt(q, items) {
  const ids = identifiersIn(q.text);
  const blocks = items.map((it, i) => `[${i}] ${it.docid} (${it.sourceKind})\n${excerptFor(it.text, ids)}`).join("\n\n");
  return `You grade search results for a question asked by a player of A House Divided, a multiplayer political and economic strategy game (elections, legislatures, parties, corporations, commodities, banking, budgets, wars). The assistant answers from the game's source code, engineering docs and wiki, and code is authoritative for how the game behaves now.

QUESTION: ${q.text}

Grade each candidate excerpt for how well it answers the question:
2 = directly answers it: states the rule, number, formula or location asked about, or is the code that implements exactly what was asked
1 = partially relevant: the same mechanic or system, useful context, part of the answer, but not the specific answer
0 = not relevant, or only shares vocabulary with the question

Guidance:
- Plain-language questions are answered by the code that implements the mechanic even if the player named nothing in it.
- A test file that asserts the exact rule is at most 1; the implementation or the wiki page stating the rule is 2.
- If the question asks for live game state, personal data or a chart, grade the code or docs behind that computation: 2 if it is the exact computation or rule, 1 if it is the surrounding system.
- If the question is about Ask itself, opinions, or another game, nothing scores unless the excerpt is literally about that.
- Most candidates are 0. Be strict about 2.

Reply with ONLY a JSON object mapping candidate index to grade for candidates graded 1 or 2, for example {"3": 2, "17": 1}. Reply {} if none qualify.

CANDIDATES (${items.length}):

${blocks}
`;
}

// --regrade ids | kind:<kind> | <qid,qid,...>: drop the cached verdicts for
// the selected queries so they are graded again (with the current excerpt
// version), then proceed as normal.
function regradeSelection(queries) {
  const sel = opt("regrade", null);
  if (!sel || sel === true) return new Set();
  if (sel === "ids") return new Set(queries.filter(q => identifiersIn(q.text).length).map(q => q.qid));
  if (sel.startsWith("kind:")) return new Set(queries.filter(q => q.kind === sel.slice(5)).map(q => q.qid));
  return new Set(sel.split(",").map(s => s.trim()).filter(Boolean));
}

async function adjudicate() {
  const which = opt("synthetic", false) === true ? "synthetic-queries.jsonl" : "real-queries.jsonl";
  const queries = readJsonl(path.join(GOLD, which));
  const regrade = regradeSelection(queries);
  if (regrade.size && !DRY) {
    const kept = readJsonl(VERDICTS).filter(l => !regrade.has(l.qid));
    writeJsonl(VERDICTS, kept);
    log(`regrade: dropped cached verdicts for ${regrade.size} queries`);
  }
  const verdicts = loadVerdicts();
  const db = DB.openSnapshot();
  const textQ = db.prepare("SELECT text FROM chunks WHERE path=? AND ord=? LIMIT 1");
  const todo = [];
  for (const q of queries) {
    const file = path.join(POOLS, `${q.qid}.json`);
    if (!fs.existsSync(file)) continue;
    const p = JSON.parse(fs.readFileSync(file, "utf8"));
    const qh = qhashOf(q.text);
    const missing = p.pool.filter(c => c.hash && !verdicts.has(`${qh}|${c.hash}`));
    if (!missing.length && !(DRY && regrade.has(q.qid))) continue;
    todo.push({ q, p, qh });
  }
  if (DRY && regrade.size) { for (const { q } of todo) console.log(`${q.qid}\t${q.kind}\t${identifiersIn(q.text).join(",")}\t${q.text.slice(0, 80)}`); log(`regrade selection: ${todo.length}`); return; }
  log(`adjudicate: ${todo.length} queries need verdicts (${queries.length} total)`);
  let calls = 0, done = 0, failed = 0;
  await pMap(todo.slice(0, LIMIT), async ({ q, p, qh }) => {
    if (Date.now() > deadline) return;
    // Deterministic shuffle so grading order carries no retriever rank signal.
    const rnd = mulberry32(parseInt(qh.slice(0, 8), 16));
    const items = p.pool.filter(c => c.hash).map(c => ({ ...c }));
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    for (const it of items) { const { path: pp, ord } = DB.parseDocid(it.docid); it.text = textQ.get(pp, ord)?.text || ""; }
    const prompt = judgePrompt(q, items);
    if (DRY) { console.log(prompt.slice(0, 2500), "\n...", prompt.length, "chars"); return; }
    let grades = null, attempts = 0, ms = 0;
    while (!grades && attempts < 3) {
      attempts++; calls++;
      const r = await museCall(prompt, { purpose: "adjudicate" });
      ms = r.ms;
      if (!r.ok) { log(`${q.qid} attempt ${attempts} failed: ${r.error}`); continue; }
      const j = parseJsonLoose(r.text);
      if (j && typeof j === "object" && !Array.isArray(j)) grades = j;
      else log(`${q.qid} attempt ${attempts}: unparseable: ${String(r.text).slice(0, 120)}`);
    }
    if (!grades) { failed++; fs.appendFileSync(path.join(CACHE, "adjudicate-failures.jsonl"), JSON.stringify({ qid: q.qid, ts: new Date().toISOString() }) + "\n"); return; }
    const v = {};
    let nonzero = 0;
    items.forEach((it, i) => {
      let g = Number(grades[String(i)] ?? 0);
      if (![0, 1, 2].includes(g)) g = 0;
      if (g) nonzero++;
      v[it.hash] = g;
    });
    fs.appendFileSync(VERDICTS, JSON.stringify({ qhash: qh, qid: q.qid, ts: new Date().toISOString(), ms, ev: EXCERPT_VERSION, v }) + "\n");
    done++;
    log(`${q.qid} graded ${items.length} candidates, ${nonzero} relevant (${ms}ms) [${q.kind}] ${q.text.slice(0, 60)}`);
  }, CONCURRENCY);
  db.close();
  log(`adjudicate: ${done} queries graded, ${failed} failed, ${calls} LLM calls this run; ledger total ${ledgerCount()}`);
}

// ── finalize ─────────────────────────────────────────────────────────────────
function finalize() {
  const real = readJsonl(path.join(GOLD, "real-queries.jsonl"));
  const synthetic = readJsonl(path.join(GOLD, "synthetic-queries.jsonl"));
  const verdicts = loadVerdicts();
  const db = DB.openSnapshot();
  const qrels = new Map();
  const sidecar = new Map();
  const describe = (docid) => { if (!sidecar.has(docid)) { const r = DB.chunkRow(db, docid); if (r) sidecar.set(docid, { docid, hash: r.hash, bodySha1: r.bodySha1, sourceKind: r.sourceKind, chars: r.chars, lengthBucket: r.lengthBucket }); } };
  const queries = [];
  let unjudgedReal = 0;
  for (const q of real) {
    const file = path.join(POOLS, `${q.qid}.json`);
    const qh = qhashOf(q.text);
    const docs = new Map();
    if (fs.existsSync(file)) {
      const p = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const c of p.pool) {
        if (!c.hash) continue;
        const g = verdicts.get(`${qh}|${c.hash}`);
        if (g === undefined) continue;
        docs.set(c.docid, g);
        describe(c.docid);
      }
    }
    if (!docs.size) { unjudgedReal++; continue; }
    qrels.set(q.qid, docs);
    const relevant = [...docs.values()].filter(g => g >= 1).length;
    queries.push({ qid: q.qid, text: q.text, kind: q.kind, source: q.source, sourceRef: q.sourceRef, alsoIn: q.alsoIn, judged: docs.size, relevant, subQueries: q.subQueries || [] });
  }
  for (const q of synthetic) {
    qrels.set(q.qid, new Map([[q.origin.docid, 2]]));
    describe(q.origin.docid);
    queries.push({ qid: q.qid, text: q.text, kind: q.kind, source: "synthetic", origin: q.origin, judged: 1, relevant: 1, subQueries: [] });
  }
  db.close();
  const split = assignSplit(queries);
  for (const q of queries) q.split = split.get(q.qid);
  writeQrels(path.join(GOLD, "qrels.txt"), qrels);
  writeJsonl(path.join(GOLD, "qrels.sidecar.jsonl"), [...sidecar.values()].sort((a, b) => a.docid < b.docid ? -1 : 1));
  writeJsonl(path.join(GOLD, "queries.jsonl"), queries);
  const info = DB.snapshotInfo();
  const summary = {
    builtAt: new Date().toISOString(), snapshot: info, queries: queries.length,
    real: queries.filter(q => q.source !== "synthetic").length, synthetic: queries.filter(q => q.source === "synthetic").length,
    realUnjudged: unjudgedReal, noRelevant: queries.filter(q => q.relevant === 0).length,
    byKind: {}, bySplit: {}, judgedPairs: [...qrels.values()].reduce((a, m) => a + m.size, 0),
    llmCalls: { total: ledgerCount(), synth: ledgerCount("synth"), adjudicate: ledgerCount("adjudicate") },
  };
  for (const q of queries) {
    summary.byKind[q.kind] = (summary.byKind[q.kind] || 0) + 1;
    const k = `${q.source === "synthetic" ? "synthetic" : "real"}/${q.split}`;
    summary.bySplit[k] = (summary.bySplit[k] || 0) + 1;
  }
  fs.writeFileSync(path.join(GOLD, "summary.json"), JSON.stringify(summary, null, 2));
  log(JSON.stringify(summary, null, 1));
}

function status() {
  const real = readJsonl(path.join(GOLD, "real-queries.jsonl"));
  const synthetic = readJsonl(path.join(GOLD, "synthetic-queries.jsonl"));
  const pools = fs.existsSync(POOLS) ? fs.readdirSync(POOLS).length : 0;
  const verdicts = loadVerdicts();
  const graded = new Set(readJsonl(VERDICTS).map(v => v.qid)).size;
  console.log(JSON.stringify({ real: real.length, synthetic: synthetic.length, pools, verdictPairs: verdicts.size, gradedQueries: graded, llmCalls: { total: ledgerCount(), synth: ledgerCount("synth"), adjudicate: ledgerCount("adjudicate") } }, null, 2));
}

const steps = { pool, synth, candidates, adjudicate, finalize, status };
if (!steps[step]) { console.error("usage: build-gold.mjs <pool|synth|candidates|adjudicate|finalize|status> [--limit N] [--max-minutes M] [--concurrency C] [--synthetic] [--dry]"); process.exit(2); }
await steps[step]();
