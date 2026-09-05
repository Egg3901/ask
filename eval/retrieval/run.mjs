#!/usr/bin/env node
// Run every gold query through retrieval under one config and score it.
//
//   node eval/retrieval/run.mjs --config flash --label baseline-2026-09-05-flash
//   node eval/retrieval/run.mjs --config flash --env RAG_FUSION=v2 --label fusion-v2-flash
//   node eval/retrieval/run.mjs --config '{"retriever":"hybrid","env":{"RAG_TOP_K":"12"}}' --label k12
//
// Options: --split dev|heldout|all (default dev)   --out <file>   --limit N   --quiet
//
// Per query, two retrieval calls through the public API:
//   ranked    search(q, { topK: 32, maxChars: 1e9 }): the top-32 after the
//             2-per-file cap with NO budget cut, i.e. the ranked list.
//   delivered search(q) with the config's env, i.e. exactly what production
//             would hand the model, after the char budget dropped what did
//             not fit.
// searchMulti() is used instead when the query has stored subQueries.
//
// nDCG@10 is condensed-list (unjudged docs removed before scoring).
// Recall/Success/MRR are positional over the raw list; unjudged docs earn
// nothing and are reported as unjudged@8. See lib/metrics.js.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB = require("./lib/db.js");
const M = require("./lib/metrics.js");
const { readQrels, writeRun } = require("./lib/trec.js");

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : (args[i + 1] === undefined || args[i + 1].startsWith("--") ? true : args[i + 1]); };
const CONFIGS = JSON.parse(fs.readFileSync(path.join(__dirname, "configs.json"), "utf8"));
const configArg = opt("config", "flash");
const config = configArg.trim().startsWith("{") ? JSON.parse(configArg) : CONFIGS[configArg];
if (!config) { console.error(`unknown config ${configArg}; known: ${Object.keys(CONFIGS).filter(k => k !== "note").join(", ")}`); process.exit(2); }
const label = opt("label", `${configArg}-${new Date().toISOString().slice(0, 10)}`);
const split = opt("split", "dev");
const LIMIT = Number(opt("limit", Infinity));
const QUIET = opt("quiet", false) === true;
const RANKED_K = 32;
// --fast: derive the delivered list by running the production finish() over
// the ranked hits instead of a second public search() (which would embed the
// same query again; the embedder is the bottleneck on a loaded box). The two
// are identical by construction: finish() picks a prefix of the same sorted
// list, then applies the same budget. The first SELF_CHECK_N queries run
// both paths and the run aborts on any difference, so the shortcut is never
// trusted silently.
const FAST = opt("fast", false) === true;
const SELF_CHECK_N = 12;
let selfChecks = 0;

// Env must be in place before retrieve.js is required.
const env = { RAG_DB: DB.SNAPSHOT, ...(config.env || {}) };
for (const a of args.filter((a, i) => args[i - 1] === "--env")) { const [k, ...v] = a.split("="); env[k] = v.join("="); }
Object.assign(process.env, env);
const retrieve = require("../../retrieve.js");
const retriever = config.retriever || "hybrid";
const configK = Number(env.RAG_TOP_K || 8);
const configChars = Number(env.RAG_MAX_CHARS || 22000);

const GOLD = path.join(__dirname, "gold");
const queries = fs.readFileSync(path.join(GOLD, "queries.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
  .filter(q => split === "all" || q.split === split).slice(0, LIMIT);
const qrels = readQrels(path.join(GOLD, "qrels.txt"));
const sidecar = new Map(fs.readFileSync(path.join(GOLD, "qrels.sidecar.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).map(r => [r.docid, r]));
const goldSummary = JSON.parse(fs.readFileSync(path.join(GOLD, "summary.json"), "utf8"));
const snapshot = DB.snapshotInfo(env.RAG_DB);
if (snapshot.sha256 !== goldSummary.snapshot.sha256) {
  console.error(`WARNING: index sha256 ${snapshot.sha256.slice(0, 12)} differs from the gold set's ${goldSummary.snapshot.sha256.slice(0, 12)}; docids may not line up. Re-adjudicate via the sidecar hashes before trusting this run.`);
}

const hitsOf = r => (r && r.hits ? r.hits.map(h => ({ docid: DB.docid(h.path, h.ord), score: Number(h.score) || 0, chars: h.text ? h.text.length : 0 })) : []);

// retrieve.js returns null when the embedder fails (it is designed to fall
// back rather than throw). On a loaded box that happens. A null must never be
// scored as "retrieved nothing": retry, then fail the query loudly.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, what) {
  let last = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { last = await fn(); } catch (e) { last = null; if (attempt === 4) throw e; }
    if (last) return last;
    await sleep(700 * attempt);
  }
  throw new Error(`${what} returned null after 4 attempts (embedder failure?)`);
}

async function retrieveBoth(q) {
  const subQueries = Array.isArray(q.subQueries) ? q.subQueries.filter(Boolean) : [];
  if (retriever === "hybrid") {
    const call = (opts) => withRetry(() => subQueries.length ? retrieve.searchMulti(q.text, subQueries, opts) : retrieve.search(q.text, opts), "search()");
    const ranked = await call({ topK: RANKED_K, maxChars: 1e9 });
    let delivered;
    if (FAST && ranked && ranked.hits) {
      delivered = retrieve.__debug.finish(ranked.hits, { topK: configK, maxChars: configChars, claimType: ranked.claimType });
      if (selfChecks < SELF_CHECK_N) {
        selfChecks++;
        const pub = hitsOf(await call({})).map(h => h.docid).join("|");
        const fast = hitsOf(delivered).map(h => h.docid).join("|");
        if (pub !== fast) throw new Error(`--fast self-check failed on ${q.qid}: search() delivered [${pub}] but finish(ranked) gave [${fast}]`);
      }
    } else delivered = await call({});
    return { ranked: hitsOf(ranked), delivered: hitsOf(delivered), claimType: (delivered || ranked || {}).claimType || null };
  }
  const c = await withRetry(() => retrieve.__debug.isolated(q.text, { denseK: 200, ftsLimit: 50 }), "__debug.isolated()");
  const list = retriever === "dense" ? c.dense : c.bm25;
  const ranked = retrieve.__debug.finish(list, { topK: RANKED_K, maxChars: 1e9, claimType: c.claimType });
  const delivered = retrieve.__debug.finish(list, { topK: configK, maxChars: configChars, claimType: c.claimType });
  return { ranked: hitsOf(ranked), delivered: hitsOf(delivered), claimType: c.claimType };
}

const perQuery = [];
const t0 = Date.now();
for (const q of queries) {
  const qrel = qrels.get(q.qid) || new Map();
  const started = Date.now();
  let r;
  try { r = await retrieveBoth(q); } catch (e) {
    if (/self-check failed/.test(String(e && e.message))) { console.error(String(e.message)); process.exit(1); }
    r = { ranked: [], delivered: [], claimType: null, error: String(e && e.message || e) };
  }
  const m = r.error
    ? Object.fromEntries([["relevant", M.relevantSet(qrel).size], ["judged", qrel.size], ["docs", []], ["error", true], ...M.METRIC_KEYS.map(k => [k, null])])
    : M.queryMetrics({ ranked: r.ranked.map(h => h.docid), delivered: r.delivered.map(h => h.docid), qrel, configK });
  perQuery.push({
    qid: q.qid, kind: q.kind, source: q.source === "synthetic" ? "synthetic" : "real", sourceDetail: q.source, split: q.split,
    claimType: r.claimType, ms: Date.now() - started, error: r.error || null,
    deliveredChars: r.delivered.reduce((a, h) => a + h.chars, 0), ranked: r.ranked, delivered: r.delivered.map(h => h.docid),
    metrics: m,
  });
  if (!QUIET && perQuery.length % 50 === 0) console.error(`${perQuery.length}/${queries.length}`);
}

function group(rows, keyFn) {
  const g = new Map();
  for (const r of rows) { const k = keyFn(r); if (k == null) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return Object.fromEntries([...g].sort().map(([k, list]) => [k, M.aggregate(list.map(r => r.metrics))]));
}
// Doc-level strata: for every judged relevant doc, did it reach top-8 / delivery.
function docStrata(rows, attr) {
  const g = new Map();
  for (const r of rows) for (const d of r.metrics.docs) {
    const s = sidecar.get(d.docid);
    const k = s ? s[attr] : "unknown";
    if (!g.has(k)) g.set(k, { docs: 0, in8: 0, in16: 0, delivered: 0 });
    const e = g.get(k); e.docs++; if (d.in8) e.in8++; if (d.in16) e.in16++; if (d.delivered) e.delivered++;
  }
  return Object.fromEntries([...g].sort().map(([k, e]) => [k, { docs: e.docs, "hit@8": e.in8 / e.docs, "hit@16": e.in16 / e.docs, "hit@budget": e.delivered / e.docs }]));
}
const scored = perQuery.filter(r => r.metrics.relevant > 0 && !r.error);
const errors = perQuery.filter(r => r.error);
if (errors.length) console.error(`WARNING: ${errors.length} queries failed retrieval and are excluded from every metric: ${errors.slice(0, 5).map(r => r.qid + " (" + r.error + ")").join("; ")}`);
const result = {
  label, config: { name: configArg.startsWith("{") ? "inline" : configArg, retriever, env }, split, fast: FAST,
  createdAt: new Date().toISOString(), rankedK: RANKED_K,
  askSiteRev: (() => { try { return execSync("git rev-parse --short HEAD", { cwd: path.join(__dirname, "..", ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } })(),
  snapshot, gold: { builtAt: goldSummary.builtAt, snapshotSha256: goldSummary.snapshot.sha256, queries: queries.length, scored: scored.length, noRelevant: perQuery.filter(r => !r.error && r.metrics.relevant === 0).length },
  errors: errors.length,
  notes: [
    "nDCG@10 is condensed-list: unjudged docs are removed from the ranking before scoring, so they are never treated as non-relevant.",
    "Recall@K, Success@1 and MRR are positional over the raw ranked list (top-32 after the 2-per-file cap, no char budget); unjudged docs earn no credit. unjudged@8 shows how much of the top-8 the pool never judged.",
    "recall@budget is recall over the chunks that survived the char budget (what the model received). truncation_loss = recall@16 - recall@budget. budget_loss = recall@configK - recall@budget isolates the budget from the K cut.",
    "Queries with no judged relevant doc are excluded from rank metrics (gold.noRelevant) but still counted for unjudged@8.",
    "Synthetic queries have exactly one gold positive (the originating chunk); nDCG is degenerate for them and other relevant chunks are unjudged. Read real and synthetic separately.",
  ],
  timing: { totalMs: Date.now() - t0, meanMs: perQuery.length ? Math.round(perQuery.reduce((a, r) => a + r.ms, 0) / perQuery.length) : null },
  metrics: {
    overall: M.aggregate(perQuery.map(r => r.metrics)),
    bySource: group(perQuery, r => r.source),
    byKind: group(perQuery, r => r.kind),
    byKindReal: group(perQuery.filter(r => r.source === "real"), r => r.kind),
    byDocSourceKind: docStrata(perQuery, "sourceKind"),
    byDocLength: docStrata(perQuery, "lengthBucket"),
    byDocSourceKindReal: docStrata(perQuery.filter(r => r.source === "real"), "sourceKind"),
    byDocLengthReal: docStrata(perQuery.filter(r => r.source === "real"), "lengthBucket"),
  },
  perQuery,
};
const out = opt("out", path.join(__dirname, "results", `${label}.json`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1));
writeRun(out.replace(/\.json$/, ".run"), label, perQuery.map(r => ({ qid: r.qid, ranked: r.ranked })));

const f = v => v == null ? "   -  " : v.toFixed(3);
const line = (name, a) => `${name.padEnd(14)} n=${String(a.queries).padStart(3)}  R@4 ${f(a["recall@4"].mean)}  R@8 ${f(a["recall@8"].mean)}  R@16 ${f(a["recall@16"].mean)}  R@32 ${f(a["recall@32"].mean)}  S@1 ${f(a["success@1"].mean)}  MRR ${f(a.mrr.mean)}  nDCG@10 ${f(a["ndcg@10"].mean)}  R@budget ${f(a["recall@budget"].mean)}  trunc ${f(a.truncation_loss.mean)}  hit@budget ${f(a["hit@budget"].mean)}  unj@8 ${f(a["unjudged@8"].mean)}`;
console.log(`${label}  retriever=${retriever}  K=${configK}  chars=${configChars}  split=${split}  snapshot=${snapshot.sha256.slice(0, 12)}  ${result.timing.totalMs}ms  errors=${errors.length}`);
console.log(line("overall", result.metrics.overall));
for (const [k, a] of Object.entries(result.metrics.bySource)) console.log(line(k, a));
for (const [k, a] of Object.entries(result.metrics.byKindReal)) console.log(line("real/" + k, a));
console.log("doc strata (real):", JSON.stringify(result.metrics.byDocSourceKindReal), JSON.stringify(result.metrics.byDocLengthReal));
console.log("wrote", out);
