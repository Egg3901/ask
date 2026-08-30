"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const investigate = require("./investigate");
const clarification = require("./clarification");
const evaluation = require("./eval/general-capabilities");

test("recognizes requests for Ask's own data and tool inventory", () => {
  assert.equal(investigate.needsCapabilityInventory("list everything your api can give me"), true);
  assert.equal(investigate.needsCapabilityInventory("what is the US inflation rate?"), false);
  assert.equal(investigate.needsCapabilityInventory("what data determines inflation?"), false);
});

test("treats player-asserted capabilities as mechanics that require evidence", () => {
  assert.equal(investigate.needsMechanicEvidence("They can also spin off state corps right?"), true);
  assert.equal(investigate.needsMechanicEvidence("Can the finance minister privatize a state enterprise?"), true);
});

test("reclassifies every formerly general failure into a testable capability", () => {
  const expected = new Map([
    [13, "output_reliability"], [14, "output_reliability"],
    [22, "context_reference"], [36, "relevant_chart"],
    [48, "evaluation_integrity"], [89, "mechanic_evidence"],
    [92, "mechanic_evidence"], [102, "capability_inventory"],
    [156, "context_reference"], [177, "war_mechanics"],
  ]);
  assert.deepEqual(evaluation.GENERAL_CAPABILITIES, expected);
});

test("quarantines only the known contextless synthetic evaluator row", () => {
  assert.equal(evaluation.isInvalidFixture({ id: 48, question: "Why did this happen?", baseline_answer_len: 9 }), true);
  assert.equal(evaluation.isInvalidFixture({ id: 22, question: "Is the last part of this true?", baseline_answer_len: 605 }), false);
});

test("clarifies a missing referent instead of inventing an antecedent", () => {
  assert.equal(clarification.missingReference("Is the last part of this true?", false), true);
  assert.equal(clarification.missingReference("Why did this happen?", false), true);
  assert.equal(clarification.missingReference("Is the last part of this true?", true), false);
  assert.equal(clarification.missingReference("Is it possible to win the election?", false), false);
  assert.equal(clarification.missingReference("Is this law available in East Germany?", false), false);
  assert.match(clarification.answer("Is the last part of this true?", false), /Paste or identify/);
});
