"use strict";

// Deterministic per-sentence answer attribution, adapted from RAGFlow's
// insert_citations: split the answer into prose sentences, score each against
// the evidence chunks that were actually sent to the model with a hybrid of
// token overlap (0.1) and embedding cosine (0.9), and record which chunks
// support which sentences. No model call: one batch embedding request plus
// arithmetic, so it can run on every answer.
//
// v1 consumers: validation telemetry (per-sentence support scores, weak
// sentences), the console, and a conservative low-support note. The same data
// later powers per-sentence citation superscripts in the UI.

const TOKEN_WEIGHT = 0.1;
const COSINE_WEIGHT = 0.9;
// RAGFlow starts at 0.63 and decays; our chunks are code-heavy, where cosine
// runs lower than prose-on-prose, so the support bar sits lower.
const SUPPORT_THRESHOLD = Number(process.env.ASK_ATTRIBUTION_SUPPORT || 0.52);
const WEAK_THRESHOLD = Number(process.env.ASK_ATTRIBUTION_WEAK || 0.40);
const MAX_SENTENCES = 60;
const MAX_CITES_PER_SENTENCE = 4;

const STOP = new Set("a an and are as at be by can did do does for from how i in is it its of on or that the this to was were what when where which who why with you your not no if then than but they their there its it's".split(/\s+/));

function tokens(text) {
  return new Set((String(text || "").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []).filter(t => !STOP.has(t)));
}

function tokenOverlap(sentenceTokens, chunkTokens) {
  if (!sentenceTokens.size) return 0;
  let hit = 0;
  for (const t of sentenceTokens) if (chunkTokens.has(t)) hit++;
  return hit / sentenceTokens.size;
}

function normalize(vector) {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i] * b[i];
  return score;
}

/**
 * Prose sentences worth attributing. Skips code fences, tables, headings,
 * citation footers and anything too short to carry a claim.
 */
function splitSentences(answer) {
  const out = [];
  let inFence = false;
  for (const line of String(answer || "").split("\n")) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!trimmed || /^\|/.test(trimmed) || /^#{1,6}\s/.test(trimmed) || /^>/.test(trimmed)) continue;
    const prose = trimmed.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "");
    for (const raw of prose.split(/(?<=[.!?])\s+(?=[A-Z0-9`*_"'([])/)) {
      const sentence = raw.trim();
      if (sentence.length < 35 || sentence.length > 600) continue;
      out.push(sentence);
      if (out.length >= MAX_SENTENCES) return out;
    }
  }
  return out;
}

/**
 * Attribute an answer to its evidence chunks.
 * `evidence`: [{ path, ord, text }], the chunks actually sent to the model.
 * `chunkVectors`: Map "path#ord" -> Float32Array (stored index vectors).
 * `embedSentences`: async (texts) -> Float32Array[].
 * Returns null when there is nothing to attribute; otherwise
 * { sentences: [{ text, score, cites }], coverage, weak, supported, total }.
 */
async function attribute(answer, evidence, { chunkVectors, embedSentences }) {
  const chunks = (evidence || []).filter(e => e && e.text);
  const sentences = splitSentences(answer);
  if (!chunks.length || !sentences.length) return null;

  let vectors = [];
  try { vectors = await embedSentences(sentences); } catch { vectors = []; }
  const haveVectors = vectors.length === sentences.length;

  const chunkTokens = chunks.map(c => tokens(c.text));
  const chunkVecs = chunks.map(c => {
    const v = chunkVectors?.get(`${c.path}#${c.ord}`);
    return v ? normalize(v) : null;
  });

  const scored = sentences.map((sentence, si) => {
    const sTokens = tokens(sentence);
    const sVec = haveVectors ? normalize(vectors[si]) : null;
    let best = 0;
    const perChunk = chunks.map((c, ci) => {
      const lex = tokenOverlap(sTokens, chunkTokens[ci]);
      const sem = sVec && chunkVecs[ci] ? cosine(sVec, chunkVecs[ci]) : 0;
      // Without vectors on either side, fall back to lexical-only so code
      // identifiers still attribute; scale up so the same threshold applies.
      const score = sVec && chunkVecs[ci] ? TOKEN_WEIGHT * lex + COSINE_WEIGHT * sem : lex;
      if (score > best) best = score;
      return { ci, score };
    });
    const cites = perChunk
      .filter(x => x.score >= SUPPORT_THRESHOLD && x.score >= best * 0.99)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CITES_PER_SENTENCE)
      .map(x => `${chunks[x.ci].path}#${chunks[x.ci].ord}`);
    return { text: sentence.slice(0, 200), score: Number(best.toFixed(3)), cites };
  });

  const supported = scored.filter(s => s.score >= SUPPORT_THRESHOLD).length;
  const weak = scored.filter(s => s.score < WEAK_THRESHOLD).map(s => s.text.slice(0, 120));
  return {
    sentences: scored,
    total: scored.length,
    supported,
    coverage: Number((supported / scored.length).toFixed(3)),
    weak,
    semantic: haveVectors,
  };
}

module.exports = { attribute, splitSentences, tokens, SUPPORT_THRESHOLD, WEAK_THRESHOLD };
