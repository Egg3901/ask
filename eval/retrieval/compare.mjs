#!/usr/bin/env node
// Paired comparison of two run files produced by run.mjs.
//
//   node eval/retrieval/compare.mjs results/A.json results/B.json [--metrics recall@8,recall@budget] [--iters 10000]
//
// Reports, per metric, overall and per kind: mean delta (B minus A), 95% CI,
// paired t p-value, sign-flip permutation p-value, and flags any stratum
// with n < 40 as underpowered. Also flags a material change in unjudged@8,
// which means B is surfacing docs the pool never graded and needs
// re-adjudication before its numbers can be trusted.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const S = require("./lib/stats.js");
const M = require("./lib/metrics.js");

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith("--") && (args[args.indexOf(a) - 1] || "").startsWith("--") === false);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
if (files.length < 2) { console.error("usage: compare.mjs runA.json runB.json [--metrics a,b] [--iters N] [--json out]"); process.exit(2); }
const [A, B] = files.slice(0, 2).map(f => JSON.parse(fs.readFileSync(f, "utf8")));
const metrics = (opt("metrics", "") || "").split(",").filter(Boolean);
const keys = metrics.length ? metrics : ["recall@4", "recall@8", "recall@16", "recall@32", "success@1", "mrr", "ndcg@10", "recall@budget", "truncation_loss", "hit@8", "hit@budget"];
const iters = Number(opt("iters", 10000));
const MIN_N = 40;

if (A.snapshot.sha256 !== B.snapshot.sha256) console.error(`WARNING: runs use different index snapshots (${A.snapshot.sha256.slice(0, 12)} vs ${B.snapshot.sha256.slice(0, 12)})`);
const byQid = new Map(A.perQuery.map(r => [r.qid, r]));
const pairs = B.perQuery.filter(r => byQid.has(r.qid)).map(r => ({ qid: r.qid, kind: r.kind, source: r.source, a: byQid.get(r.qid).metrics, b: r.metrics }));
if (!pairs.length) { console.error("no shared qids"); process.exit(1); }

function test(rows, key) {
  const deltas = rows.filter(r => typeof r.a[key] === "number" && typeof r.b[key] === "number").map(r => r.b[key] - r.a[key]);
  if (!deltas.length) return null;
  const t = S.pairedT(deltas);
  const perm = S.permutationTest(deltas, { iters });
  const wins = deltas.filter(d => d > 0).length, losses = deltas.filter(d => d < 0).length;
  return { n: deltas.length, meanA: S.mean(rows.filter(r => typeof r.a[key] === "number").map(r => r.a[key])), meanB: S.mean(rows.filter(r => typeof r.b[key] === "number").map(r => r.b[key])), delta: t.mean, ci95: t.ci95, pT: t.p, pPerm: perm.p, wins, losses, underpowered: deltas.length < MIN_N };
}

const report = { a: A.label, b: B.label, sharedQueries: pairs.length, iters, minN: MIN_N, overall: {}, bySource: {}, byKind: {}, flags: [] };
for (const key of keys) report.overall[key] = test(pairs, key);
for (const src of ["real", "synthetic"]) { report.bySource[src] = {}; for (const key of keys) report.bySource[src][key] = test(pairs.filter(p => p.source === src), key); }
for (const kind of [...new Set(pairs.map(p => p.kind))].sort()) { report.byKind[kind] = {}; for (const key of keys) report.byKind[kind][key] = test(pairs.filter(p => p.kind === kind), key); }

const unj = test(pairs, "unjudged@8");
if (unj && Math.abs(unj.delta) >= 0.05) report.flags.push(`unjudged@8 moved by ${unj.delta.toFixed(3)} (${unj.meanA.toFixed(3)} -> ${unj.meanB.toFixed(3)}): B surfaces docs the pool never graded; re-adjudicate before trusting B's rank metrics`);
for (const [kind, m] of Object.entries(report.byKind)) { const any = Object.values(m).find(Boolean); if (any && any.underpowered) report.flags.push(`kind ${kind}: n=${any.n} < ${MIN_N}, underpowered`); }
for (const [src, m] of Object.entries(report.bySource)) { const any = Object.values(m).find(Boolean); if (any && any.underpowered) report.flags.push(`source ${src}: n=${any.n} < ${MIN_N}, underpowered`); }

const f = v => v == null ? "  -   " : (v >= 0 ? "+" : "") + v.toFixed(3);
const row = (name, r) => r ? `${name.padEnd(22)} n=${String(r.n).padStart(3)}  A ${r.meanA.toFixed(3)}  B ${r.meanB.toFixed(3)}  delta ${f(r.delta)}  CI [${f(r.ci95 ? r.ci95[0] : null)}, ${f(r.ci95 ? r.ci95[1] : null)}]  p_t ${r.pT == null ? "  -  " : r.pT.toFixed(4)}  p_perm ${r.pPerm == null ? "  -  " : r.pPerm.toFixed(4)}  W/L ${r.wins}/${r.losses}${r.underpowered ? "  UNDERPOWERED" : ""}` : `${name.padEnd(22)} (no paired values)`;
console.log(`A = ${A.label}\nB = ${B.label}\nshared queries: ${pairs.length}; delta = B - A; paired t and sign-flip permutation (${iters} iters), two-sided\n`);
console.log("OVERALL"); for (const key of keys) console.log(row(key, report.overall[key]));
for (const src of ["real", "synthetic"]) { console.log(`\nSOURCE ${src}`); for (const key of keys) console.log(row(key, report.bySource[src][key])); }
for (const [kind, m] of Object.entries(report.byKind)) { console.log(`\nKIND ${kind}`); for (const key of keys) console.log(row(key, m[key])); }
if (report.flags.length) { console.log("\nFLAGS"); for (const fl of report.flags) console.log(" -", fl); }
const outFile = opt("json", null);
if (outFile) { fs.writeFileSync(outFile, JSON.stringify(report, null, 1)); console.log("wrote", outFile); }
