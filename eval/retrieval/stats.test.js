"use strict";
// Closed-form checks for the significance machinery. df=1 is Cauchy and df=2
// has an elementary CDF, so those p-values are exact by hand.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./lib/stats.js");

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("incomplete beta at known points", () => {
  near(S.betaInc(1, 1, 0.3), 0.3);
  near(S.betaInc(2, 3, 0.5), 0.6875);
  near(S.betaInc(0.5, 0.5, 0.5), 0.5);
});

test("t CDF and quantile", () => {
  near(S.tCdf(0, 5), 0.5);
  near(S.tCdf(1.959964, 1e7), 0.975, 1e-3);
  near(S.tQuantile(0.975, 1), 12.7062, 1e-3);      // tan(0.475 pi)
  near(S.tQuantile(0.975, 2), 4.302653, 1e-3);
  near(S.tQuantile(0.975, 30), 2.042272, 1e-3);
});

test("paired t on df=1 (Cauchy) is exact", () => {
  const r = S.pairedT([1, 3]);
  assert.equal(r.n, 2);
  near(r.mean, 2);
  near(r.t, 2);
  near(r.p, 1 - (2 / Math.PI) * Math.atan(2));    // 0.295167
});

test("paired t on df=2 is exact, with CI", () => {
  const r = S.pairedT([1, 2, 3]);
  near(r.mean, 2);
  near(r.sd, 1);
  near(r.t, 3.464102);
  near(r.p, 0.074180);
  near(r.ci95[0], -0.484138, 1e-3);
  near(r.ci95[1], 4.484138, 1e-3);
});

test("paired t degenerate cases", () => {
  const zero = S.pairedT([0, 0, 0]);
  assert.equal(zero.p, 1);
  assert.deepEqual(zero.ci95, [0, 0]);
  const same = S.pairedT([0.5, 0.5, 0.5]);
  assert.equal(same.p, 0);
  assert.deepEqual(same.ci95, [0.5, 0.5]);
  assert.equal(S.pairedT([1]).p, null);
});

test("permutation test: null gives 1, consistent signs give small p, seeded is reproducible", () => {
  assert.equal(S.permutationTest([0, 0, 0, 0]).p, 1);
  const ones = S.permutationTest(Array(10).fill(1), { iters: 4000 });
  assert.ok(ones.p < 0.02, `p=${ones.p}`);
  const a = S.permutationTest([0.3, -0.1, 0.2, 0.05, 0.4], { seed: 7 });
  const b = S.permutationTest([0.3, -0.1, 0.2, 0.05, 0.4], { seed: 7 });
  assert.equal(a.p, b.p);
  assert.ok(a.p > 0 && a.p <= 1);
});
