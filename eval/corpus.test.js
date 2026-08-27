"use strict";

// WS9 deterministic evaluation gate. Every case runs against the real routing
// (ask-plan) and refusal detection (answer-guard) with no model calls, so it is
// fast and reproducible and can gate every change. Model-graded evaluation is
// the sampler in production (answer-audit.js); this file locks the decisions
// that are deterministic.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const plan = require("../ask-plan");
const guard = require("../answer-guard");

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus.json"), "utf8"));

for (const c of corpus.routing) {
  test(`routing [${c.category}]: ${c.question}`, () => {
    const p = plan.create(c.question);
    if (c.expect.id != null) assert.equal(p.id, c.expect.id, `id for "${c.question}"`);
    if (c.expect.live != null) assert.equal(p.live, c.expect.live, `live for "${c.question}"`);
    if (c.expect.kind != null) assert.equal(p.display.kind, c.expect.kind, `display.kind for "${c.question}"`);
  });
}

for (const c of corpus.guard) {
  test(`guard [${c.category}]: ${c.answer.slice(0, 48)}…`, () => {
    assert.equal(guard.detectRefusal(c.answer, c.hasLive), c.expectRefusal, c.answer);
  });
}

// The known-gap list is documentation, not a pass/fail gate: it records where
// routing is deliberately not yet where we want it, and what unblocks it. If a
// gap's desired routing starts happening, delete it here and promote it to a
// real routing case above.
test("known gaps are still gaps (promote them to routing cases once fixed)", () => {
  for (const g of corpus.known_gaps || []) {
    assert.equal(plan.create(g.question).intent, g.current,
      `"${g.question}" now routes differently — move it to routing (desired: ${g.desired})`);
  }
});
