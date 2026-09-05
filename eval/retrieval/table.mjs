#!/usr/bin/env node
// Render result files as the markdown table used in README.md.
//   node eval/retrieval/table.mjs results/baseline-*.json
import fs from "node:fs";
const files = process.argv.slice(2);
const f = v => v == null ? "-" : v.toFixed(3);
const cols = ["recall@4", "recall@8", "recall@16", "recall@32", "success@1", "mrr", "ndcg@10", "recall@budget", "truncation_loss", "hit@8", "hit@budget", "unjudged@8"];
console.log(`| run | retriever | K / chars | n | ${cols.map(c => c.replace("recall@", "R@").replace("truncation_loss", "trunc loss").replace("success@1", "S@1").replace("unjudged@8", "unj@8")).join(" | ")} |`);
console.log(`|---|---|---|---|${cols.map(() => "---:").join("|")}|`);
for (const file of files) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [scope, agg] of [["all", r.metrics.overall], ["real", r.metrics.bySource.real], ["synthetic", r.metrics.bySource.synthetic]]) {
    if (!agg) continue;
    console.log(`| ${r.label}${scope === "all" ? "" : " (" + scope + ")"} | ${r.config.retriever} | ${r.config.env.RAG_TOP_K} / ${r.config.env.RAG_MAX_CHARS} | ${agg["recall@8"].n} | ${cols.map(c => f(agg[c].mean)).join(" | ")} |`);
  }
}
