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
const store = require("./store");
const retrieve = require("./retrieve");

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
    return { id: r.lastInsertRowid, draft: true };
  } catch { return null; }
}

// Staff writes the verified truth and activates a draft in one step.
function resolve(id, correction, addedBy = "staff") {
  const c = String(correction || "").trim();
  if (c.length < 8) throw new Error("a verified correction is required");
  const r = S.resolve.run(c, addedBy, Number(id));
  return { updated: r.changes };
}

function isDraft(row) { return row && row.active === 0 && String(row.correction || "").startsWith(DRAFT_TAG); }

module.exports = { add, match, block, list, setActive, draft, resolve, isDraft, DRAFT_TAG, MATCH_THRESHOLD };
