"use strict";

// Long-term memory built from feedback. A reported answer that gets fixed once
// should stay fixed: staff record the verified truth here, and any future
// question that lands semantically close gets that truth injected into the
// prompt above the retrieved excerpts.
//
// Matching is by embedding, not keywords: the same wrong answer gets asked in
// many phrasings. Rows are embedded once at insert with the same nomic model
// the retrieval index uses, so a match threshold means the same thing in both
// places.
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store");
const retrieve = require("./retrieve");
const investigate = require("./investigate");
const llm = require("./llm");

const MATCH_THRESHOLD = Number(process.env.ASK_CORRECTIONS_THRESHOLD || 0.62);
const MATCH_LIMIT = 2;

const DRAFT_TAG = "[DRAFT]";

const S = {
  insert: store.db.prepare("INSERT INTO corrections(question,correction,vec,source_answer_id,added_by,created) VALUES(?,?,?,?,?,?)"),
  insertDraft: store.db.prepare("INSERT INTO corrections(question,correction,vec,source_answer_id,added_by,active,created) VALUES(?,?,?,?,?,0,?)"),
  active: store.db.prepare("SELECT id,question,correction,vec FROM corrections WHERE active=1"),
  all: store.db.prepare("SELECT id,question,correction,source_answer_id,added_by,active,created FROM corrections ORDER BY created DESC LIMIT 200"),
  setActive: store.db.prepare("UPDATE corrections SET active=? WHERE id=?"),
  resolve: store.db.prepare("UPDATE corrections SET correction=?,added_by=?,active=1 WHERE id=?"),
  draftForAnswer: store.db.prepare("SELECT id FROM corrections WHERE active=0 AND source_answer_id=? LIMIT 1"),
  openDraftForQuestion: store.db.prepare("SELECT id FROM corrections WHERE active=0 AND question=? LIMIT 1"),
};

function norm(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  s = Math.sqrt(s) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / s;
  return out;
}

async function add({ question, correction, sourceAnswerId = null, addedBy = null }) {
  const q = String(question || "").trim();
  const c = String(correction || "").trim();
  if (q.length < 8 || c.length < 8) throw new Error("question and correction are both required");
  const vec = norm(await retrieve.embedQuery(q));
  const r = S.insert.run(q, c, Buffer.from(vec.buffer), sourceAnswerId, addedBy, Date.now());
  // The player who surfaced the wrong answer gets their question back and an
  // in-game note that it was corrected. Lazy require: corrections loads early
  // and notify pulls store.
  if (sourceAnswerId != null) {
    try { require("./notify").creditBack(Number(sourceAnswerId), "correction added", "correction"); } catch { /* advisory */ }
  }
  recordEvalCandidate({ question: q, truth: c, addedBy });
  return { id: r.lastInsertRowid };
}

/** Corrections semantically close to this question, best first. Fails open to []. */
async function match(question) {
  try {
    const rows = S.active.all();
    if (!rows.length) return [];
    const qv = norm(await retrieve.embedQuery(String(question || "")));
    const scored = [];
    for (const row of rows) {
      if (!row.vec) continue;
      const v = new Float32Array(row.vec.buffer, row.vec.byteOffset, row.vec.byteLength / 4);
      if (v.length !== qv.length) continue;
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += qv[i] * v[i];
      if (dot >= MATCH_THRESHOLD) scored.push({ id: row.id, question: row.question, correction: row.correction, score: dot });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MATCH_LIMIT);
  } catch { return []; }
}

/** Prompt block for matched corrections. Empty string when there are none. */
function block(matched) {
  if (!matched || !matched.length) return "";
  return `CURATED CORRECTIONS — staff-verified lessons from past wrong answers on questions like this one.
These are ground truth. If a retrieved excerpt appears to contradict one, the correction wins; say so rather than repeating the old mistake.

${matched.map(m => `- Asked before as: "${m.question}"\n  Verified truth: ${m.correction}`).join("\n")}`;
}

function list() { return S.all.all(); }
function setActive(id, active) { S.setActive.run(active ? 1 : 0, Number(id)); }

// Auto-drafted, inactive correction from a signal that an answer was wrong: a
// downvote with a reason, or the sampler judging a question unanswered. Staff
// review and rewrite the body before it goes live — a draft never affects a
// player answer on its own (match() reads active=1 only).
//
// Dedup so one bad question class doesn't spawn a pile of drafts: skip if an
// active correction already covers it, if a draft already exists for the same
// answer, or if an open draft already exists for this exact question. Fails
// open (best-effort telemetry, never throws into the request path).
async function draft({ question, reason = "", sourceAnswerId = null }) {
  try {
    const q = String(question || "").trim();
    if (q.length < 8) return null;
    if (sourceAnswerId != null && S.draftForAnswer.get(Number(sourceAnswerId))) return null;
    if (S.openDraftForQuestion.get(q)) return null;
    const near = await match(q);
    if (near.length) return null; // an active lesson already covers this class
    const body = `${DRAFT_TAG} Needs staff review — write the verified truth here. Flagged because: ${String(reason || "answer reported").slice(0, 300)}`;
    const vec = norm(await retrieve.embedQuery(q));
    const r = S.insertDraft.run(q, body, Buffer.from(vec.buffer), sourceAnswerId, "auto", Date.now());
    // Kick off a proposed body in the background. Staff throughput is what
    // limits the correction flywheel: a draft that says only "needs review"
    // makes staff research the truth from scratch, so most drafts just sit.
    propose(r.lastInsertRowid, q, reason).catch(() => {});
    return { id: r.lastInsertRowid, draft: true };
  } catch { return null; }
}

const PROPOSE_SYSTEM = `You draft a correction entry for a game help system covering A House Divided. A player question produced a wrong or failed answer. From the EVIDENCE (game source excerpts gathered for this question), write the verified truth a future answer should state.

Rules:
- 1 to 4 sentences, declarative, written for the answering model to rely on.
- Only state what the evidence shows. Cite the file path for each mechanic claim.
- If the evidence does not settle the question, write exactly what is unresolved and which file or system staff should check. Never guess.
Reply with ONLY the correction text.`;

// Research the flagged question and replace the placeholder draft body with a
// proposed truth. The draft stays inactive either way: nothing written here
// reaches a player until staff resolve it. Fails open — a dead helper leaves
// the plain placeholder, which is exactly what drafts were before.
const S_getDraft = store.db.prepare("SELECT id,question,correction,active FROM corrections WHERE id=?");
const S_propose = store.db.prepare("UPDATE corrections SET correction=? WHERE id=? AND active=0");
async function propose(id, question, reason = "") {
  const evidence = await investigate.run({ question, useLive: false, deep: false });
  if (!evidence?.text) return null;
  const ask = () => llm.complete({
    system: PROPOSE_SYSTEM,
    question: `PLAYER QUESTION: ${question}\n\nWHY IT WAS FLAGGED: ${String(reason || "answer reported").slice(0, 300)}\n\nEVIDENCE:\n${evidence.text.slice(0, 24000)}`,
    // Generous budget on purpose: the helper backstop streams its first token
    // in ~15s on prompts this size, and a reasoning model can spend a small
    // completion budget entirely on hidden thinking. One retry for the same
    // reason — this runs in the background, so patience is free.
    maxTokens: 600, timeoutMs: 60000,
  });
  const proposed = (await ask()) || (await ask());
  const text = String(proposed || "").trim();
  if (text.length < 20) return null;
  // Re-check the row: staff may have resolved it while the research ran, and
  // a resolved correction must never be overwritten by an auto proposal.
  const row = S_getDraft.get(Number(id));
  if (!row || row.active !== 0) return null;
  const body = `${DRAFT_TAG} Proposed (auto, unverified — confirm before activating): ${text.slice(0, 1500)}\n\nFlagged because: ${String(reason || "answer reported").slice(0, 300)}`;
  S_propose.run(body, Number(id));
  return { id: Number(id), proposed: true };
}

// Staff writes the verified truth and activates a draft in one step.
function resolve(id, correction, addedBy = "staff") {
  const c = String(correction || "").trim();
  if (c.length < 8) throw new Error("a verified correction is required");
  const row = S_getDraft.get(Number(id));
  const r = S.resolve.run(c, addedBy, Number(id));
  if (r.changes && row) recordEvalCandidate({ question: row.question, truth: c, addedBy });
  return { updated: r.changes };
}

// Every resolved correction is a confirmed failure with a verified truth —
// exactly what the regression corpus is made of. Candidates land in a side
// file for review rather than straight into eval/corpus.json, because corpus
// entries are deterministic assertions and turning a truth statement into one
// takes a human (or agent) pass.
const CANDIDATES_PATH = path.join(__dirname, "eval", "corpus-candidates.json");
function recordEvalCandidate(entry) {
  try {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf8")); } catch {}
    if (!Array.isArray(list)) list = [];
    if (list.some(e => e && e.question === entry.question)) return;
    list.push({ question: entry.question, truth: entry.truth, addedBy: entry.addedBy || "staff", created: Date.now() });
    fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(list, null, 2) + "\n");
  } catch (e) { console.error("[ask] eval candidate write failed:", String(e?.message || e)); }
}

function isDraft(row) { return row && row.active === 0 && String(row.correction || "").startsWith(DRAFT_TAG); }

/** Drafts waiting for staff, oldest first, with whether a proposed body is ready. */
function pendingDrafts(limit = 50) { return store.pendingDrafts(limit); }

// ── Semantic cache eviction ─────────────────────────────────────────────────
// The corrections embedding: the same model and normalisation the index and
// the corrections table use, so MATCH_THRESHOLD means the same thing here.
async function embed(text) { return norm(await retrieve.embedQuery(String(text || ""))); }

// Several questions through the same path with bounded concurrency and a
// deadline. A question that fails to embed is null and simply not compared.
async function embedQueries(texts, { concurrency = 4, deadlineMs = 20000 } = {}) {
  const out = new Array(texts.length).fill(null);
  const deadline = Date.now() + deadlineMs;
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= texts.length || Date.now() > deadline) return;
      try { out[i] = await embed(texts[i]); } catch { out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Downvote consequence, widened. The exact-key eviction stops the reported
 * phrasing being served; this stops its paraphrases too, by evicting every
 * cached answer whose question sits within MATCH_THRESHOLD cosine of the
 * reported one. Cached rows are embedded the first time this pass sees them
 * and the vector is stored, so the steady-state cost is one query embedding.
 * Fails open: an embedder outage leaves the exact eviction as the whole effect.
 */
async function evictNearCache(question, { threshold = MATCH_THRESHOLD, maxEmbeds = 200 } = {}) {
  try {
    const q = String(question || "").trim();
    if (q.length < 4) return { evicted: 0, embedded: 0, keys: [] };
    const rows = store.cacheRows();
    if (!rows.length) return { evicted: 0, embedded: 0, keys: [] };
    const qv = await embed(q);
    const missing = rows.filter(r => !r.vec).slice(0, maxEmbeds);
    const vecs = await embedQueries(missing.map(r => store.cacheQuestionOf(r.q)));
    let embedded = 0;
    missing.forEach((r, i) => {
      if (!vecs[i]) return;
      store.setCacheVec(r.q, vecs[i]);
      r.vec = Buffer.from(vecs[i].buffer, vecs[i].byteOffset, vecs[i].byteLength);
      embedded++;
    });
    const doomed = [];
    for (const r of rows) {
      if (!r.vec) continue;
      const v = new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4);
      if (v.length !== qv.length) continue;
      if (cosine(qv, v) >= threshold) doomed.push(r.q);
    }
    return { evicted: store.evictCacheKeys(doomed), embedded, keys: doomed };
  } catch { return { evicted: 0, embedded: 0, keys: [] }; }
}

module.exports = { add, match, block, list, setActive, draft, propose, resolve, isDraft, pendingDrafts, embed, embedQueries, evictNearCache, DRAFT_TAG, MATCH_THRESHOLD, CANDIDATES_PATH };
