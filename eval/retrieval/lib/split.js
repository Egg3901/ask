"use strict";
// Deterministic dev/heldout split, stratified by (source group, kind).
//
// Within each stratum queries are ordered by a salted hash of their id, and
// the first 70% become dev. The salt is fixed so the split never moves when
// queries are added elsewhere: a new query only changes its own stratum.
// heldout exists so tuning can be checked on queries it never saw; nothing in
// this harness reads heldout except a run explicitly asked for it.
const crypto = require("node:crypto");

const SALT = "ask-retrieval-eval-2026-09-05";

function sourceGroup(q) { return q.source === "synthetic" ? "synthetic" : "real"; }

function assignSplit(queries, { devFraction = 0.7, salt = SALT } = {}) {
  const strata = new Map();
  for (const q of queries) {
    const key = `${sourceGroup(q)}|${q.kind}`;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(q);
  }
  const out = new Map();
  for (const [, list] of strata) {
    const ordered = list
      .map(q => ({ q, h: crypto.createHash("sha1").update(salt + "|" + q.qid).digest("hex") }))
      .sort((a, b) => a.h < b.h ? -1 : a.h > b.h ? 1 : 0);
    const nDev = Math.round(ordered.length * devFraction);
    ordered.forEach((e, i) => out.set(e.q.qid, i < nDev ? "dev" : "heldout"));
  }
  return out;
}

module.exports = { assignSplit, sourceGroup, SALT };
