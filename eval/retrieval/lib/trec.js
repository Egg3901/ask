"use strict";
// TREC qrels and run files.
//   qrels: qid 0 docid grade
//   run:   qid Q0 docid rank score label
// docid is `path#ord`. Paths never contain whitespace in this corpus, which
// is what keeps the whitespace-delimited format safe; assert it on write.
const fs = require("node:fs");

function assertToken(s) {
  if (/\s/.test(s)) throw new Error(`whitespace in TREC token: ${JSON.stringify(s)}`);
  return s;
}

function readQrels(file) {
  const out = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [qid, , docid, grade] = line.trim().split(/\s+/);
    if (!out.has(qid)) out.set(qid, new Map());
    out.get(qid).set(docid, Number(grade));
  }
  return out;
}

function writeQrels(file, qrels) {
  const lines = [];
  for (const [qid, docs] of qrels) {
    for (const [docid, grade] of [...docs].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      lines.push(`${assertToken(qid)} 0 ${assertToken(docid)} ${grade}`);
    }
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

function writeRun(file, label, perQuery) {
  const lines = [];
  for (const { qid, ranked } of perQuery) {
    ranked.forEach((h, i) => {
      lines.push(`${assertToken(qid)} Q0 ${assertToken(h.docid)} ${i + 1} ${Number(h.score).toFixed(6)} ${assertToken(label)}`);
    });
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

/** qid -> docids in rank order (rank column wins; ties in score are irrelevant once ranked). */
function readRun(file) {
  const rows = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [qid, , docid, rank, score] = line.trim().split(/\s+/);
    if (!rows.has(qid)) rows.set(qid, []);
    rows.get(qid).push({ docid, rank: Number(rank), score: Number(score) });
  }
  const out = new Map();
  for (const [qid, list] of rows) out.set(qid, list.sort((a, b) => a.rank - b.rank).map(r => r.docid));
  return out;
}

module.exports = { readQrels, writeQrels, writeRun, readRun };
