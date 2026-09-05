"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const calibration = require("./judge-calibration");

test("Cohen's kappa on known matrices", () => {
  assert.equal(calibration.kappa({ a: 20, b: 5, c: 10, d: 15 }), 0.4);
  assert.equal(calibration.kappa({ a: 10, b: 0, c: 0, d: 10 }), 1);
  assert.equal(calibration.kappa({ a: 0, b: 0, c: 0, d: 0 }), null);
  // Judge flags everything: agreement is pure chance.
  assert.equal(calibration.kappa({ a: 5, b: 5, c: 0, d: 0 }), 0);
  // Judge and human disagree on every row.
  assert.equal(calibration.kappa({ a: 0, b: 5, c: 5, d: 0 }), -1);
});

test("crosstab reads the automated verdict from validation and the human one from ratings", () => {
  const v = (extra = {}) => JSON.stringify({ issues: [], grounding: [], inventedPaths: [], missedPaths: [], ...extra });
  const rows = [
    { validation: v({ issues: ["truncated"] }), feedback_rating: "down", review_rating: null },   // a
    { validation: v({ grounding: ["x"] }), feedback_rating: null, review_rating: null },           // b
    { validation: v({ inventedPaths: ["p"] }), feedback_rating: "up", review_rating: null },       // b, rated
    { validation: v(), feedback_rating: "down", review_rating: null },                             // c
    { validation: v(), feedback_rating: null, review_rating: "bad" },                              // c
    { validation: v(), feedback_rating: null, review_rating: null },                               // d
    { validation: v(), feedback_rating: "up", review_rating: null },                               // d, rated
    { validation: v({ issues: ["escalated_tier"] }), feedback_rating: null, review_rating: "good" }, // d, rated
  ];
  const out = calibration.crosstab(rows);
  assert.equal(out.n, 8);
  assert.deepEqual(out.matrix, { flaggedAndReported: 1, flaggedNotReported: 2, cleanButReported: 2, cleanNotReported: 3 });
  assert.equal(out.nRated, 6);
  assert.deepEqual(out.matrixRated, { flaggedAndReported: 1, flaggedNotReported: 1, cleanButReported: 2, cleanNotReported: 2 });
  assert.equal(out.recall, Number((1 / 3).toFixed(3)));
  assert.equal(out.precision, Number((1 / 3).toFixed(3)));
  assert.equal(out.kappa, calibration.kappa({ a: 1, b: 2, c: 2, d: 3 }));
  assert.equal(out.kappaRated, calibration.kappa({ a: 1, b: 1, c: 2, d: 2 }));
});

test("crosstab on nothing is null kappa, not NaN", () => {
  const out = calibration.crosstab([]);
  assert.equal(out.n, 0);
  assert.equal(out.kappa, null);
  assert.equal(out.recall, null);
});

test("ISO week labels", () => {
  assert.equal(calibration.weekOf(Date.UTC(2026, 8, 5)), "2026-W36");
  assert.equal(calibration.weekOf(Date.UTC(2026, 0, 1)), "2026-W01");
  assert.equal(calibration.weekOf(Date.UTC(2025, 11, 29)), "2026-W01");
  assert.equal(calibration.weekOf(Date.UTC(2025, 11, 28)), "2025-W52");
});
