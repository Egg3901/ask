#!/usr/bin/env node
// Noise floor: the same config run several times.
//
//   node eval/retrieval/noise.mjs results/r1.json results/r2.json results/r3.json
//
// Reports per metric the mean across runs, the sample sd and the range of
// the aggregate, plus how many queries changed ranked lists between runs.
// Any effect a change claims should clear this floor by a wide margin.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./lib/stats.js");
const M = require("./lib/metrics.js");

const files = process.argv.slice(2).filter(a => !a.startsWith("--"));
if (files.length < 2) { console.error("usage: noise.mjs run1.json run2.json [run3.json ...]"); process.exit(2); }
const runs = files.map(f => JSON.parse(fs.readFileSync(f, "utf8")));
const keys = ["recall@4", "recall@8", "recall@16", "recall@32", "success@1", "mrr", "ndcg@10", "recall@budget", "truncation_loss", "hit@8", "hit@budget", "unjudged@8"];
const out = { runs: runs.map(r => r.label), metrics: {}, queriesWithRankChanges: 0, queriesWithMetricChanges: 0, sharedQueries: 0 };
for (const key of keys) {
  const vals = runs.map(r => r.metrics.overall[key].mean).filter(v => typeof v === "number");
  out.metrics[key] = { mean: S.mean(vals), sd: vals.length > 1 ? S.sampleSd(vals) : 0, min: Math.min(...vals), max: Math.max(...vals), range: Math.max(...vals) - Math.min(...vals) };
}
const base = new Map(runs[0].perQuery.map(r => [r.qid, r]));
for (const r of runs[0].perQuery) {
  const others = runs.slice(1).map(x => x.perQuery.find(y => y.qid === r.qid)).filter(Boolean);
  if (others.length !== runs.length - 1) continue;
  out.sharedQueries++;
  const sig = x => x.ranked.map(h => h.docid).join("|");
  if (others.some(o => sig(o) !== sig(r))) out.queriesWithRankChanges++;
  if (others.some(o => keys.some(k => (o.metrics[k] ?? null) !== (r.metrics[k] ?? null)))) out.queriesWithMetricChanges++;
}
console.log(`runs: ${out.runs.join(", ")}\nshared queries: ${out.sharedQueries}; ranked list changed on ${out.queriesWithRankChanges}; any metric changed on ${out.queriesWithMetricChanges}\n`);
for (const [k, v] of Object.entries(out.metrics)) console.log(`${k.padEnd(16)} mean ${v.mean.toFixed(4)}  sd ${v.sd.toFixed(4)}  range ${v.range.toFixed(4)}  [${v.min.toFixed(4)}, ${v.max.toFixed(4)}]`);
const outFile = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
if (outFile) { fs.writeFileSync(outFile, JSON.stringify(out, null, 1)); console.log("wrote", outFile); }
