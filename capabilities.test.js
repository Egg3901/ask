"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const capabilities = require("./capabilities");

test("recognizes the three explicit intelligence modes", () => {
  assert.equal(capabilities.classify("verify the previous answer").id, "claim-verifier");
  assert.equal(capabilities.classify("run a causal autopsy on why US inflation spiked").id, "causal-autopsy");
  assert.equal(capabilities.classify("what happens to iron if demand rises 5% per turn for 12 turns?").id, "scenario-lab");
});

test("capability contracts require evidence-shaped answers", () => {
  assert.match(capabilities.contract({ intent: "claim_verification" }), /supported, contradicted, or unresolved/i);
  assert.match(capabilities.contract({ intent: "causal_autopsy" }), /causal chain/i);
  assert.match(capabilities.contract({ intent: "scenario_lab" }), /directional projection/i);
});

test("ordinary game questions stay out of specialist modes", () => {
  assert.equal(capabilities.classify("What is the current US inflation rate?"), null);
  assert.equal(capabilities.classify("How does the Senate work?"), null);
});

test("visible controls force a validated specialist mode without rewriting the question", () => {
  assert.equal(capabilities.classify("Check the timing", "verify").intent, "claim_verification");
  assert.equal(capabilities.classify("Why did prices move?", "autopsy").intent, "causal_autopsy");
  assert.equal(capabilities.classify("Iron demand rises 5% per turn for 12 turns", "scenario").intent, "scenario_lab");
  assert.equal(capabilities.normalizeMode("nonsense"), "auto");
  assert.match(capabilities.modeIssue("scenario", "What happens if I raise taxes?"), /demand or supply shock/i);
});
