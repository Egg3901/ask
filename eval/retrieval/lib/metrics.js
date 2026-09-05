"use strict";
// Per-query retrieval metrics.
//
// Two lists per query:
//   ranked    the candidate list after top-K selection with the 2-per-file cap,
//             i.e. what retrieval RANKED, before the char budget ran.
//   delivered the chunks that survived finish()'s char budget, i.e. what the
//             model actually received. finish() drops with `continue`, so a
//             chunk can be ranked 2nd and still never be delivered.
//
// Positional metrics (Recall@K, Success@1, MRR, Recall@budget) are computed on
// the raw lists because the positions are physical: the model sees exactly
// those K slots. An unjudged doc in those slots earns no credit; it is NOT
// counted as a miss against the query either, because recall's denominator is
// the judged relevant set. nDCG@10 uses the CONDENSED list (unjudged docs
// removed before scoring) so a retriever that surfaces new, unjudged material
// is not penalised as if it were wrong. unjudged@K is reported so the reader
// can see how much of the ranking the pool never covered.

function relevantSet(qrel, relMin = 1) {
  const rel = new Set();
  for (const [d, g] of qrel) if (g >= relMin) rel.add(d);
  return rel;
}

function recallAt(ranked, rel, k) {
  if (!rel.size) return null;
  let hit = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) if (rel.has(ranked[i])) hit++;
  return hit / rel.size;
}

function successAt1(ranked, rel) {
  if (!rel.size) return null;
  return ranked.length && rel.has(ranked[0]) ? 1 : 0;
}

function mrr(ranked, rel) {
  if (!rel.size) return null;
  for (let i = 0; i < ranked.length; i++) if (rel.has(ranked[i])) return 1 / (i + 1);
  return 0;
}

function dcgOf(grades) {
  let s = 0;
  for (let i = 0; i < grades.length; i++) s += (Math.pow(2, grades[i]) - 1) / Math.log2(i + 2);
  return s;
}

/** Condensed-list nDCG@k: unjudged docs are removed from the ranking before scoring. */
function ndcgAt(ranked, qrel, k = 10, relMin = 1) {
  const rel = relevantSet(qrel, relMin);
  if (!rel.size) return null;
  const condensed = ranked.filter(d => qrel.has(d)).slice(0, k);
  const dcg = dcgOf(condensed.map(d => qrel.get(d)));
  const ideal = [...qrel.values()].filter(g => g >= relMin).sort((a, b) => b - a).slice(0, k);
  const idcg = dcgOf(ideal);
  return idcg > 0 ? dcg / idcg : null;
}

function unjudgedAt(ranked, qrel, k) {
  const n = Math.min(k, ranked.length);
  if (!n) return null;
  let u = 0;
  for (let i = 0; i < n; i++) if (!qrel.has(ranked[i])) u++;
  return u / n;
}

function recallDelivered(delivered, rel) {
  if (!rel.size) return null;
  let hit = 0;
  for (const d of new Set(delivered)) if (rel.has(d)) hit++;
  return hit / rel.size;
}

/**
 * Deterministic order for a raw scored list: score descending, then docid
 * ascending so equal scores never depend on input order.
 */
function orderByScore(hits) {
  return [...hits].sort((a, b) => (b.score - a.score) || (a.docid < b.docid ? -1 : a.docid > b.docid ? 1 : 0));
}

const K_LIST = [4, 8, 16, 32];

/**
 * All per-query metrics. `configK` is the run's RAG_TOP_K, used for the
 * budget-loss figure that isolates the char budget from the K cut.
 */
function queryMetrics({ ranked, delivered, qrel, configK = 8, relMin = 1 }) {
  const rel = relevantSet(qrel, relMin);
  const strict = relevantSet(qrel, 2);
  const m = { relevant: rel.size, judged: qrel.size };
  for (const k of K_LIST) m[`recall@${k}`] = recallAt(ranked, rel, k);
  m["success@1"] = successAt1(ranked, rel);
  m.mrr = mrr(ranked, rel);
  m["ndcg@10"] = ndcgAt(ranked, qrel, 10, relMin);
  m["recall@budget"] = recallDelivered(delivered, rel);
  m["truncation_loss"] = m["recall@16"] == null ? null : m["recall@16"] - m["recall@budget"];
  m[`recall@config`] = recallAt(ranked, rel, configK);
  m["budget_loss"] = m["recall@config"] == null ? null : m["recall@config"] - m["recall@budget"];
  // Any relevant chunk at all: the coarsest and most decision-relevant view,
  // "did the model receive something usable".
  m["hit@8"] = rel.size ? (ranked.slice(0, 8).some(d => rel.has(d)) ? 1 : 0) : null;
  m["hit@budget"] = rel.size ? (delivered.some(d => rel.has(d)) ? 1 : 0) : null;
  m["recall@8_strict"] = recallAt(ranked, strict, 8);
  m["recall@budget_strict"] = recallDelivered(delivered, strict);
  m["unjudged@8"] = unjudgedAt(ranked, qrel, 8);
  m.delivered = delivered.length;
  // Per relevant doc: where it landed. Drives the source_kind and length strata.
  const deliveredSet = new Set(delivered);
  m.docs = [...rel].map(d => {
    const pos = ranked.indexOf(d);
    return { docid: d, grade: qrel.get(d), rank: pos >= 0 ? pos + 1 : null, in8: pos >= 0 && pos < 8, in16: pos >= 0 && pos < 16, delivered: deliveredSet.has(d) };
  });
  return m;
}

const METRIC_KEYS = [...K_LIST.map(k => `recall@${k}`), "success@1", "mrr", "ndcg@10", "recall@budget", "truncation_loss", "recall@config", "budget_loss", "hit@8", "hit@budget", "recall@8_strict", "recall@budget_strict", "unjudged@8"];

/** Mean of each metric over queries where it is defined, with the count used. */
function aggregate(rows, keys = METRIC_KEYS) {
  const out = {};
  for (const key of keys) {
    const vals = rows.map(r => r[key]).filter(v => typeof v === "number" && Number.isFinite(v));
    out[key] = { mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: vals.length };
  }
  out.queries = rows.length;
  return out;
}

module.exports = { relevantSet, recallAt, successAt1, mrr, ndcgAt, unjudgedAt, recallDelivered, orderByScore, queryMetrics, aggregate, K_LIST, METRIC_KEYS, dcgOf };
