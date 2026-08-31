"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const calc = require("./calc");

test("basic arithmetic with precedence", () => {
  assert.strictEqual(calc.evaluate("2 + 3 * 4"), 14);
  assert.strictEqual(calc.evaluate("(2 + 3) * 4"), 20);
  assert.strictEqual(calc.evaluate("2 ^ 3 ^ 2"), 512);
  assert.strictEqual(calc.evaluate("-4 + 10"), 6);
  assert.strictEqual(calc.evaluate("10 / 4"), 2.5);
});

test("thousands separators, suffixes, percents", () => {
  assert.strictEqual(calc.evaluate("1,234,567 + 433"), 1235000);
  assert.strictEqual(calc.evaluate("2.5m / 1k"), 2500);
  assert.strictEqual(calc.evaluate("3b / 1m"), 3000);
  assert.strictEqual(calc.evaluate("200 * 15%"), 30);
});

test("functions", () => {
  assert.strictEqual(calc.evaluate("sum(1, 2, 3, 4)"), 10);
  assert.strictEqual(calc.evaluate("avg(2, 4, 6)"), 4);
  assert.strictEqual(calc.evaluate("max(1, 9, 4)"), 9);
  assert.strictEqual(calc.evaluate("round(2.567, 2)"), 2.57);
  assert.strictEqual(calc.evaluate("pctchange(200, 250)"), 25);
  assert.strictEqual(calc.evaluate("share(25, 200)"), 12.5);
  assert.strictEqual(calc.evaluate("sqrt(144)"), 12);
});

test("nesting", () => {
  assert.strictEqual(calc.evaluate("round(pctchange(1,000, 1,250))"), 25);
  assert.strictEqual(calc.evaluate("sum(1, 2) * max(2, 3)"), 9);
});

test("rejects anything that is not arithmetic", () => {
  assert.throws(() => calc.evaluate("process.exit(1)"));
  assert.throws(() => calc.evaluate("require('fs')"));
  assert.throws(() => calc.evaluate("1; 2"));
  assert.throws(() => calc.evaluate("x + 1"));
  assert.throws(() => calc.evaluate("constructor(1)"));
  assert.throws(() => calc.evaluate(""));
  assert.throws(() => calc.evaluate("a".repeat(500)));
});

test("names failure modes", () => {
  assert.throws(() => calc.evaluate("1 / 0"), /division by zero/);
  assert.throws(() => calc.evaluate("pctchange(0, 5)"), /undefined/);
  assert.throws(() => calc.evaluate("share(5, 0)"), /undefined/);
});

test("format is compact and readable", () => {
  assert.strictEqual(calc.format(25), "25");
  assert.strictEqual(calc.format(2.5666666666), "2.566666667");
  assert.strictEqual(calc.format(1234567.891), "1,234,567.89");
});
