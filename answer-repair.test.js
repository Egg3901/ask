"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const repair = require("./answer-repair");

test("retries a refusal when live evidence was gathered", () => {
  assert.equal(repair.shouldRepair({
    answer: "I don't have access to live data. Paste the screen.",
    hasLiveData: true,
    evidence: "LIVE CORPORATION SECTORS: media in CA and TX",
  }), true);
});

test("does not retry fair-play or evidence-free refusals", () => {
  assert.equal(repair.shouldRepair({
    answer: "I can't share another player's private balance sheet.",
    hasLiveData: true,
    evidence: "some evidence",
  }), false);
  assert.equal(repair.shouldRepair({
    answer: "I don't have enough information.",
    hasLiveData: false,
    evidence: "",
  }), false);
});

test("accepts only a direct non-leaking repaired answer", async () => {
  const complete = async () => ({ text: "AMC owns media in CA; TX is an uncovered market.", model: "repair-model" });
  const out = await repair.repair({
    question: "Where does AMC not own media?",
    answer: "I don't have access to that.",
    evidence: "AMC MEDIA: CA. MARKET REGIONS: CA, TX.",
    complete,
  });
  assert.deepEqual(out, { text: "AMC owns media in CA; TX is an uncovered market.", model: "repair-model" });
});

test("retries a repair that still violates a cross-system answer contract", async () => {
  let calls = 0;
  const complete = async () => {
    calls++;
    return calls === 1
      ? { text: "No. The minister cannot spin it off, but treasury can privatize it and Gosplan appoints directors." }
      : { text: "Yes. The action is named privatization and uses treasury authority. Gosplan or the head of government appoints the SOE director." };
  };
  const out = await repair.repair({
    question: "Can the finance minister spin off a state corporation and control its directors?",
    answer: "No.",
    evidence: "Treasury privatization route. Gosplan director appointment route.",
    requirement: repair.requirementFor("Can the finance minister spin off a state corporation and control its directors?", "facts"),
    complete,
  });
  assert.equal(calls, 2);
  assert.match(out.text, /^Yes\./);
});

test("requires repair for canonical cross-system and precomputed-table contracts", () => {
  assert.match(repair.requirementFor(
    "In the German Question, how do I increase NATO air superiority?",
    "some evidence",
  ), /active German conflict/i);
  const table = repair.requirementFor(
    "Where does my corporation not own media?",
    "PRECOMPUTED UNCOVERED HOME-COUNTRY MEDIA MARKETS",
  );
  assert.match(table, /Markdown table/);
  assert.equal(repair.shouldRepair({ answer: "A plausible but incomplete answer.", hasLiveData: true, evidence: "facts", requirement: table }), true);
});
