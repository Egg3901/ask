"use strict";

// Deterministic arithmetic for the research scout. The prompt orders the
// answer model to CALCULATE, but token prediction is not arithmetic: growth
// rates, shares, and per-capita numbers were routinely off. This gives the
// scout a real evaluator, so any derived number in the evidence is computed,
// not predicted.
//
// A hand-rolled recursive-descent parser, no eval, no Function, no names
// except the fixed function table. Anything unrecognized throws, and the tool
// wrapper turns that into a plain error string for the model.

const FUNCS = {
  sum: xs => xs.reduce((a, b) => a + b, 0),
  avg: xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN,
  min: xs => Math.min(...xs),
  max: xs => Math.max(...xs),
  abs: xs => Math.abs(one(xs, "abs")),
  sqrt: xs => Math.sqrt(one(xs, "sqrt")),
  round: xs => {
    if (xs.length === 2) { const f = 10 ** Math.trunc(xs[1]); return Math.round(xs[0] * f) / f; }
    return Math.round(one(xs, "round"));
  },
  // pctchange(old, new): the growth rate players actually ask about.
  pctchange: xs => {
    if (xs.length !== 2) throw new Error("pctchange takes (old, new)");
    if (xs[0] === 0) throw new Error("pctchange from zero is undefined");
    return ((xs[1] - xs[0]) / Math.abs(xs[0])) * 100;
  },
  // share(part, whole): a percentage share with the divide-by-zero named.
  share: xs => {
    if (xs.length !== 2) throw new Error("share takes (part, whole)");
    if (xs[1] === 0) throw new Error("share of a zero whole is undefined");
    return (xs[0] / xs[1]) * 100;
  },
};

function one(xs, name) {
  if (xs.length !== 1) throw new Error(`${name} takes one argument`);
  return xs[0];
}

const MAX_EXPR = 400;

function evaluate(expr) {
  const src = String(expr || "").trim();
  if (!src) throw new Error("empty expression");
  if (src.length > MAX_EXPR) throw new Error(`expression longer than ${MAX_EXPR} chars`);
  let i = 0;

  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const peek = () => { ws(); return src[i]; };
  const eat = ch => { ws(); if (src[i] !== ch) throw new Error(`expected "${ch}" at position ${i}`); i++; };

  function number() {
    ws();
    // Digits with optional thousands separators and decimals: 1,234,567.89.
    // Separator groups must be exactly three digits, or "sum(1, 2)" would
    // parse "1," as one number and eat the argument comma.
    const m = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (!m) throw new Error(`expected a number at position ${i}`);
    i += m[0].length;
    let value = Number(m[0].replace(/,/g, ""));
    if (!Number.isFinite(value)) throw new Error(`bad number "${m[0]}"`);
    ws();
    // Human magnitude suffixes appear constantly in live data.
    const suffix = /^([kKmMbBtT])(?![a-zA-Z])/.exec(src.slice(i));
    if (suffix) {
      i += 1;
      value *= { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[suffix[1].toLowerCase()];
    } else if (src[i] === "%") {
      i += 1;
      value /= 100;
    }
    return value;
  }

  function args() {
    const out = [primaryExpr()];
    while (peek() === ",") { eat(","); out.push(primaryExpr()); }
    return out;
  }

  function atom() {
    ws();
    if (src[i] === "(") { eat("("); const v = primaryExpr(); eat(")"); return v; }
    if (src[i] === "-") { i++; return -atom(); }
    if (src[i] === "+") { i++; return atom(); }
    const fn = /^([a-z]+)\s*\(/i.exec(src.slice(i));
    if (fn) {
      const name = fn[1].toLowerCase();
      if (!FUNCS[name]) throw new Error(`unknown function "${fn[1]}"`);
      i += fn[0].length;
      const xs = args();
      eat(")");
      const v = FUNCS[name](xs);
      if (!Number.isFinite(v)) throw new Error(`${name} did not produce a finite number`);
      return v;
    }
    return number();
  }

  function power() {
    const base = atom();
    if (peek() === "^") { eat("^"); return base ** power(); }
    return base;
  }

  function term() {
    let v = power();
    for (;;) {
      const c = peek();
      if (c === "*") { eat("*"); v *= power(); }
      else if (c === "/") { eat("/"); const d = power(); if (d === 0) throw new Error("division by zero"); v /= d; }
      else return v;
    }
  }

  function primaryExpr() {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === "+") { eat("+"); v += term(); }
      else if (c === "-") { eat("-"); v -= term(); }
      else return v;
    }
  }

  const value = primaryExpr();
  ws();
  if (i < src.length) throw new Error(`unexpected "${src[i]}" at position ${i}`);
  if (!Number.isFinite(value)) throw new Error("result is not a finite number");
  return value;
}

/** Render a result the way a careful analyst would hand it over. */
function format(value) {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(Number(value.toPrecision(10)));
}

module.exports = { evaluate, format, FUNCS };
