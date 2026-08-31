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

test("repairs truncated, narrated, and heal-cited drafts", () => {
  assert.equal(repair.shouldRepair({
    answer: "The bond yield is calculated from",
    hasLiveData: false,
    evidence: "bond yield formula excerpt",
    truncated: true,
  }), true);
  assert.equal(repair.shouldRepair({
    answer: "The supplied source excerpts do not include the yield formula.",
    hasLiveData: false,
    evidence: "bond yield formula excerpt",
    narrated: true,
  }), true);
  assert.equal(repair.shouldRepair({
    answer: "Per src/lib/turn/bondTurn.ts the yield is 4%.",
    hasLiveData: false,
    evidence: "bond evidence",
    healedPaths: ["src/lib/turn/bondTurn.ts"],
  }), true);
  // No detected defect and no requirement: leave the answer alone.
  assert.equal(repair.shouldRepair({
    answer: "A complete grounded answer.",
    hasLiveData: false,
    evidence: "evidence",
  }), false);
});

test("issuesFor names each detected defect for the repair model", () => {
  const issues = repair.issuesFor({
    answer: "The draft stopped mid",
    hasLiveData: false,
    truncated: true,
    narrated: true,
    healedPaths: ["src/lib/turn/bondTurn.ts"],
  });
  assert.equal(issues.length, 3);
  assert.match(issues[0], /mid-sentence/);
  assert.match(issues[1], /evidence bundle/);
  assert.match(issues[2], /bondTurn\.ts/);
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
