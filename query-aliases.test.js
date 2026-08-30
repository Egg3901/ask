"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const aliases = require("./query-aliases");

test("bridges player wording for a state-corporation spin-off to the canonical mechanic", () => {
  const out = aliases.expand("They can also spin off state corps right?");
  assert.ok(out.some(query => /privatiz/i.test(query)));
  assert.ok(out.some(query => /national corporation|treasury authority/i.test(query)));
  assert.ok(out.some(query => /SOE director|Gosplan/i.test(query)));
});

test("bridges German Question air-superiority wording to the war subsystem", () => {
  const out = aliases.expand("In the German Question, how do I make NATO air superiority higher?");
  assert.ok(out.some(query => /conflict|war/i.test(query)));
  assert.ok(out.some(query => /air superiority|navair/i.test(query)));
  assert.ok(out.some(query => /stationOf/i.test(query)));
  assert.ok(out.some(query => /authorizeBattleAction/i.test(query)));
});

test("does not add unrelated aliases", () => {
  assert.deepEqual(aliases.expand("How does a bill become law?"), []);
  assert.equal(aliases.guidance("How does a bill become law?"), "");
});

test("states the required neighboring subsystem and both halves of a compound capability question", () => {
  assert.match(aliases.guidance("In the German Question, how do I make NATO air superiority higher?"), /active German conflict.*not.*crisis ladder/i);
  assert.match(aliases.guidance("In the German Question, how do I make NATO air superiority higher?"), /which air missions count/i);
  assert.match(aliases.guidance("In the German Question, how do I make NATO air superiority higher?"), /who may issue/i);
  assert.match(aliases.guidance("Can the finance minister spin off a state corporation and control its directors?"), /two required parts/i);
});

test("checks that repaired cross-system answers satisfy the domain contract", () => {
  assert.match(aliases.answerIssue(
    "Can the finance minister spin off a state corporation and control its directors?",
    "No. The finance minister cannot spin one off, but can privatize it through treasury authority. Gosplan appoints the director.",
  ), /opens by denying/i);
  assert.equal(aliases.answerIssue(
    "Can the finance minister spin off a state corporation and control its directors?",
    "Yes. The action is named privatization and uses treasury authority. Gosplan or the head of government appoints the SOE director.",
  ), "");
  assert.match(aliases.answerIssue(
    "In the German Question, how do I increase NATO air superiority?",
    "Station wings in the region on CAP. The channel builds and decays outside the crisis board.",
  ), /CAP and PATROL/i);
});
