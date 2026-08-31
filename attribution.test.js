"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const attribution = require("./attribution");

function fakeVec(...values) {
  return Float32Array.from(values);
}

test("splitSentences keeps prose claims and skips code, tables, headings, notes", () => {
  const answer = [
    "# Cloture",
    "Cloture needs three fifths of the votes cast in the Senate to end debate.",
    "```ts",
    "const CLOTURE = 3 / 5; // this code line must not be attributed",
    "```",
    "| chamber | threshold |",
    "> **Grounding check:** ignore me",
    "- The threshold counts votes cast, not the full seat count of the chamber.",
    "Short one.",
  ].join("\n");
  const sentences = attribution.splitSentences(answer);
  assert.equal(sentences.length, 2);
  assert.match(sentences[0], /three fifths/);
  assert.match(sentences[1], /votes cast, not the full seat count/);
});

test("attribute scores sentences against the chunks that support them", async () => {
  const evidence = [
    { path: "src/lib/turn/billLifecycle.ts", ord: 0, text: "const CLOTURE_FRACTION = 3/5; cloture counts votes cast in the senate chamber" },
    { path: "src/lib/economy/bonds.ts", ord: 1, text: "coupon payments accrue interest on treasury bonds each turn" },
  ];
  const chunkVectors = new Map([
    ["src/lib/turn/billLifecycle.ts#0", fakeVec(1, 0)],
    ["src/lib/economy/bonds.ts#1", fakeVec(0, 1)],
  ]);
  const answer = "Cloture needs three fifths of votes cast in the Senate chamber to succeed. Bond coupons pay interest to holders every single turn.";
  const out = await attribution.attribute(answer, evidence, {
    chunkVectors,
    embedSentences: async texts => texts.map(t => /cloture|senate/i.test(t) ? fakeVec(1, 0) : fakeVec(0, 1)),
  });
  assert.equal(out.total, 2);
  assert.equal(out.supported, 2);
  assert.equal(out.coverage, 1);
  assert.deepEqual(out.sentences[0].cites, ["src/lib/turn/billLifecycle.ts#0"]);
  assert.deepEqual(out.sentences[1].cites, ["src/lib/economy/bonds.ts#1"]);
  assert.equal(out.weak.length, 0);
});

test("an invented claim scores weak and carries no citations", async () => {
  const evidence = [{ path: "src/lib/turn/billLifecycle.ts", ord: 0, text: "cloture counts votes cast" }];
  const answer = "The game models a Phillips curve linking unemployment rates directly to consumer price inflation levels.";
  const out = await attribution.attribute(answer, evidence, {
    chunkVectors: new Map([["src/lib/turn/billLifecycle.ts#0", fakeVec(1, 0)]]),
    embedSentences: async texts => texts.map(() => fakeVec(0.1, 0.99)),
  });
  assert.equal(out.supported, 0);
  assert.equal(out.sentences[0].cites.length, 0);
  assert.equal(out.weak.length, 1);
});

test("fails open: no evidence text or embed failure still returns something sane", async () => {
  assert.equal(await attribution.attribute("Some answer sentence that is long enough to attribute.", [], { chunkVectors: new Map(), embedSentences: async () => [] }), null);
  const lexicalOnly = await attribution.attribute(
    "Cloture counts votes cast in the senate to end debate on legislation.",
    [{ path: "a.ts", ord: 0, text: "cloture votes cast senate debate legislation threshold" }],
    { chunkVectors: new Map(), embedSentences: async () => { throw new Error("embed down"); } },
  );
  assert.equal(lexicalOnly.semantic, false);
  assert.ok(lexicalOnly.sentences[0].score > 0.5);
});
