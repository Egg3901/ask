"use strict";
// Paired significance over per-query metric deltas.
//
// Paired t-test (Student t via the regularised incomplete beta) and a
// sign-flip permutation test as a distribution-free cross-check. Both are
// two-sided. The permutation RNG is seeded so a report is reproducible.

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function sampleSd(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

// Lanczos log-gamma, continued-fraction incomplete beta (Numerical Recipes).
function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
/** Regularised incomplete beta I_x(a, b). */
function betaInc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Student t CDF. */
function tCdf(t, df) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = df / (df + t * t);
  const tail = 0.5 * betaInc(df / 2, 0.5, x);
  return t >= 0 ? 1 - tail : tail;
}
function tTwoSidedP(t, df) { return 2 * (1 - tCdf(Math.abs(t), df)); }
/** Upper quantile t_{p, df} by bisection. */
function tQuantile(p, df) {
  let lo = 0, hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function pairedT(deltas) {
  const n = deltas.length;
  if (n < 2) return { n, mean: n ? deltas[0] : null, sd: null, se: null, t: null, df: n - 1, p: null, ci95: null };
  const m = mean(deltas), sd = sampleSd(deltas), se = sd / Math.sqrt(n), df = n - 1;
  if (sd === 0) return { n, mean: m, sd, se, t: m === 0 ? 0 : Infinity, df, p: m === 0 ? 1 : 0, ci95: [m, m] };
  const t = m / se;
  const q = tQuantile(0.975, df);
  return { n, mean: m, sd, se, t, df, p: tTwoSidedP(t, df), ci95: [m - q * se, m + q * se] };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sign-flip permutation test on paired deltas. p includes the +1 smoothing so it is never 0. */
function permutationTest(deltas, { iters = 10000, seed = 12345 } = {}) {
  const n = deltas.length;
  if (!n) return { n, p: null, iters };
  const obs = Math.abs(mean(deltas));
  const rnd = mulberry32(seed);
  let ge = 0;
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += rnd() < 0.5 ? deltas[j] : -deltas[j];
    if (Math.abs(s / n) >= obs - 1e-12) ge++;
  }
  return { n, p: (ge + 1) / (iters + 1), iters, seed };
}

module.exports = { mean, sampleSd, betaInc, tCdf, tTwoSidedP, tQuantile, pairedT, permutationTest, mulberry32 };
