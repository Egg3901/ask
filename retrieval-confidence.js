"use strict";

// Post-retrieval confidence features for one answer, computed from the
// search() result that fed the model. Pure arithmetic over hits[].score and
// hits[].text: no I/O, no model call, so it runs on every answer.
//
// Why these features: how strong the best hit is, how far it stands above the
// rest, and whether the dense and lexical retrievers agreed all track the
// quality of the answer that follows. Recorded on the row as
// validation.retrieval, rolled up as p10/p50/p90 over the window, so a shift
// in retrieval shows up in the console before it shows up as complaints.

const DEFAULT_MAX_CHARS = Number(process.env.RAG_MAX_CHARS || 22000);
const FEATURES = ["top1", "gap15", "overlap", "nHits", "budgetUsed", "chunkLenP50"];

const round = (v, places = 3) => (Number.isFinite(v) ? Number(v.toFixed(places)) : null);

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
}

function keyOf(hit) {
  if (typeof hit === "string") return hit;
  return `${hit?.path || ""}#${hit?.ord ?? 0}`;
}

// Share of the smaller retriever list that the other retriever also found.
// null when the retriever does not expose its per-source candidate lists.
function overlapOf(dense, lexical) {
  if (!Array.isArray(dense) || !Array.isArray(lexical) || !dense.length || !lexical.length) return null;
  const a = new Set(dense.map(keyOf));
  const b = new Set(lexical.map(keyOf));
  let both = 0;
  for (const k of a) if (b.has(k)) both++;
  return round(both / Math.min(a.size, b.size));
}

/**
 * Confidence features for one retrieval result.
 * `result` is what search()/searchMulti() returned: { hits: [{ path, ord, score, text }] } or null.
 * `maxChars` is the character budget retrieval was given for this question.
 * `dense` / `lexical` are optional per-retriever candidate lists (hits or "path#ord" keys).
 */
function features(result, { maxChars = DEFAULT_MAX_CHARS, dense = null, lexical = null } = {}) {
  const hits = Array.isArray(result?.hits) ? result.hits.filter(h => h && h.score != null && Number.isFinite(Number(h.score))) : [];
  const scores = hits.map(h => Number(h.score)).sort((a, b) => b - a);
  const nHits = hits.length;
  const top1 = nHits ? round(scores[0]) : null;
  const gap15 = nHits >= 2 ? round(scores[0] - scores[Math.min(4, nHits - 1)]) : null;
  const lengths = hits.map(h => String(h.text || "").length).sort((a, b) => a - b);
  const used = lengths.reduce((sum, n) => sum + n, 0);
  const budget = Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_MAX_CHARS;
  const budgetUsed = nHits ? round(Math.min(1, used / budget)) : null;
  const chunkLenP50 = nHits ? percentile(lengths, 0.5) : null;
  return { top1, gap15, overlap: overlapOf(dense, lexical), nHits, budgetUsed, chunkLenP50 };
}

/**
 * p10/p50/p90 per feature over a list of recorded feature objects. A feature
 * that was null on every row (overlap, until the retriever exposes its lists)
 * reports n: 0 rather than a fabricated zero.
 */
function distribution(list) {
  const out = {};
  for (const key of FEATURES) {
    // null is a recorded absence, not a zero: Number(null) is 0, so it is
    // excluded before the finite check.
    const values = (list || []).map(f => f && f[key]).filter(v => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
    out[key] = { n: values.length, p10: percentile(values, 0.1), p50: percentile(values, 0.5), p90: percentile(values, 0.9) };
  }
  return out;
}

module.exports = { features, distribution, overlapOf, FEATURES, DEFAULT_MAX_CHARS };
