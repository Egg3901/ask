"use strict";

// How well the automated grounding verdict agrees with the humans.
//
// Every answer carries an automated verdict (guard trips, grounding notes,
// invented paths, low attribution coverage) and some carry a human one (a
// player downvote, a staff "bad"). Cross-tabulating the two gives a confusion
// matrix and Cohen's kappa, which is the one number that says whether the
// judge is worth acting on. A judge that agrees with humans at system level
// can still disagree label by label, so kappa is stored weekly and the drift
// is what staff watch, not the absolute value.

const taxonomy = require("./failure-taxonomy");

const HUMAN_NEGATIVE = row => row.feedback_rating === "down" || row.review_rating === "bad";
const HUMAN_POSITIVE = row => row.feedback_rating === "up" || row.review_rating === "good";

/** Cohen's kappa for a 2x2 matrix { a: both yes, b: judge yes human no, c: judge no human yes, d: both no }. */
function kappa({ a = 0, b = 0, c = 0, d = 0 } = {}) {
  const n = a + b + c + d;
  if (!n) return null;
  const observed = (a + d) / n;
  const expected = ((a + b) * (a + c) + (c + d) * (b + d)) / (n * n);
  if (expected === 1) return 1;
  return Number(((observed - expected) / (1 - expected)).toFixed(3));
}

/**
 * Cross-tabulate rows of { validation, feedback_rating, review_rating }.
 * `all` treats an unrated answer as "human did not object", which is the honest
 * reading of a thumbs response rate in the single digits. `rated` keeps only
 * the answers a human actually judged either way.
 */
function crosstab(rows) {
  const all = { a: 0, b: 0, c: 0, d: 0 };
  const rated = { a: 0, b: 0, c: 0, d: 0 };
  for (const row of rows || []) {
    const judge = taxonomy.isFlagged(row.validation);
    const human = HUMAN_NEGATIVE(row);
    const cell = judge ? (human ? "a" : "b") : (human ? "c" : "d");
    all[cell]++;
    if (human || HUMAN_POSITIVE(row)) rated[cell]++;
  }
  const n = all.a + all.b + all.c + all.d;
  return {
    n,
    nRated: rated.a + rated.b + rated.c + rated.d,
    kappa: kappa(all),
    kappaRated: kappa(rated),
    matrix: {
      flaggedAndReported: all.a, flaggedNotReported: all.b,
      cleanButReported: all.c, cleanNotReported: all.d,
    },
    matrixRated: {
      flaggedAndReported: rated.a, flaggedNotReported: rated.b,
      cleanButReported: rated.c, cleanNotReported: rated.d,
    },
    // How much of what humans reported the judge had already caught, and how
    // much of what the judge flagged a human went on to confirm.
    recall: all.a + all.c ? Number((all.a / (all.a + all.c)).toFixed(3)) : null,
    precision: all.a + all.b ? Number((all.a / (all.a + all.b)).toFixed(3)) : null,
  };
}

/** ISO week label, e.g. "2026-W36", so one row per week survives reruns. */
function weekOf(ts = Date.now()) {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

module.exports = { kappa, crosstab, weekOf };
