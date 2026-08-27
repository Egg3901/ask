"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const guard = require("./answer-guard");

test("flags a refusal when live evidence was available", () => {
  assert.equal(guard.detectRefusal("I cannot determine your net worth from what I have.", true), true);
  assert.equal(guard.detectRefusal("I do not have access to that.", true), true);
  assert.equal(guard.detectRefusal("I don't have the data for your holdings.", true), true);
});

test("does not flag a real answer", () => {
  assert.equal(guard.detectRefusal("Based on the live data, your net worth is 4200.", true), false);
});

test("does not flag a legitimate fair-play refusal", () => {
  assert.equal(guard.detectRefusal("I can't share another player's private balance sheet.", true), false);
});

test("does not flag a long code answer that merely caveats mid-text", () => {
  const long = "Inflation is computed from several pressure terms. " + "detail ".repeat(120);
  assert.equal(guard.detectRefusal(long, false), false);
});

test("an empty answer is not a refusal", () => {
  assert.equal(guard.detectRefusal("", true), false);
});

test("flags an answer that narrates its own retrieval bundle", () => {
  // Every shape below appeared in the shipped corpus. The player asked about the
  // game; being told what Ask was handed is never the answer.
  for (const shape of [
    "The supplied source does not expose that ranking.",
    "That is not in the evidence provided for this question.",
    "The live world snapshot only covers global state, not per-country fiscal data.",
    "I only have what you've shown me, which is your character snapshot.",
    "The files I haven't been given contents for would answer this.",
    "I can't see any data on that beyond what the retrieved excerpts contain.",
  ]) {
    assert.equal(guard.detectBundleNarration(shape), true, shape);
  }
});

test("does not flag an answer that just cites a file or hedges honestly", () => {
  for (const clean of [
    "The salvage fraction is 0.2, set in src/lib/constants/corporations.ts.",
    "I can't see which bills are live in Ohio right now; the state legislation page will show you.",
    "Your net worth is 249,000 anchor, up from 231,000 last turn.",
    "Seeded composition puts California at 25D/15R, which is the starting configuration.",
  ]) {
    assert.equal(guard.detectBundleNarration(clean), false, clean);
  }
});

test("an opportunistic chart about something else is not relevant to the question", () => {
  // This exact pairing shipped: a country GDP-growth bar chart rendered directly
  // above an answer refusing to map Senate candidates.
  const gdp = { metric: "gdp_growth", title: "Live country GDP growth comparison", unit: "percent" };
  assert.equal(guard.datasetMatchesQuestion(gdp, "Map GOP Senate 1 candidates Real players only"), false);
  assert.equal(guard.datasetMatchesQuestion(gdp, "compare GDP growth across countries"), true);
});

test("a chart about the thing that was asked stays", () => {
  for (const [dataset, question] of [
    [{ metric: "senate_candidates", title: "US — GOP Senate Class 1 candidates" }, "Map GOP Senate 1 candidates"],
    [{ metric: "market_cap_anchor", title: "Largest public corporations by market capitalization" }, "compare the size of the 10 largest public companies"],
    [{ metric: "population", title: "US — Population" }, "Show a population map of the regions in US"],
  ]) {
    assert.equal(guard.datasetMatchesQuestion(dataset, question), true, question);
  }
});

test("a dataset with no describable subject is not blocked", () => {
  assert.equal(guard.datasetMatchesQuestion({}, "anything at all"), true);
});

test("flags an answer that stops mid-thought but not one that ends cleanly", () => {
  const body = "Readiness rises with command posture. ".repeat(8);
  assert.equal(guard.looksTruncated(body + "Ensure every command has a designated commander to avoid the"), true);
  assert.equal(guard.looksTruncated(body + "That is the whole mechanism."), false);
  assert.equal(guard.looksTruncated(body + "```"), false);
  assert.equal(guard.looksTruncated("Short and unfinished but too short to judge"), false);
});

test("a guard-flagged answer is always graded, not left to the sample draw", () => {
  const audit = require("./answer-audit");
  // Every one of these is a deterministic guard trip, so the 15% draw must not
  // decide whether it gets looked at.
  for (const issue of ["narrated_evidence_bundle", "truncated", "refused_with_live_evidence"]) {
    assert.ok(audit.AUDIT_ALWAYS.has(issue), issue);
  }
  assert.equal(audit.AUDIT_ALWAYS.has("some_benign_issue"), false);
});
