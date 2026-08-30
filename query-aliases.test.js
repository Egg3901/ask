"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const aliases = require("./query-aliases");

test("bridges ticket 1234 blockade wording to command, front support, and trade closure", () => {
  const question = "how do we blockade ddr";
  const out = aliases.expand(question);
  assert.ok(out.some(query => /blockadeClosureFor.*tradeApproaches/i.test(query)));
  assert.ok(out.some(query => /INTERDICTION.*fromSeaControl/i.test(query)));
  assert.ok(out.some(query => /NavairCommandClient/i.test(query)));
  assert.match(aliases.guidance(question), /20 percent.*front-interdiction/i);
  assert.match(aliases.answerIssue(question, "Set ships to Blockade."), /defense officeholder/i);
  assert.equal(aliases.answerIssue(
    question,
    "The defense officeholder opens Naval and air command, stations naval formations on DDR's trade approach, and selects the Blockade standing order. The order takes effect on the next turn. The panel's 20 percent enemy supply cut is front supply interdiction and is separate from the trade blockade.",
  ), "");
});

test("normalizes the air-superiority spelling from ticket 1234", () => {
  const question = "and how do we incraase air sueprioryty";
  const out = aliases.expand(question);
  assert.ok(out.includes("CHANNEL_RATES airSuperiority"));
  assert.match(aliases.guidance(question), /regional naval-air channel/i);
});

test("explains ticket 1234 battle-post changes as an authorization and save issue", () => {
  const question = "this regiment keeps changing its battle post, i keep setting it back but it doesnt save";
  const out = aliases.expand(question);
  assert.ok(out.some(query => /page\.tsx.*defenseMember.*canWrite/i.test(query)));
  assert.ok(out.some(query => /formations.*defense minister/i.test(query)));
  assert.match(aliases.guidance(question), /read-only Combat Command view/i);
  assert.match(aliases.answerIssue(question, "Try selecting Frontline again."), /defense officeholder/i);
  assert.equal(aliases.answerIssue(
    question,
    "Only the country's Defense Secretary or an admin can save battle-role orders. Other officials have a read-only Combat Command view and cannot save those controls. The star marks the recommended role; the saved role is a separate explicit order.",
  ), "");
});

test("bridges player wording for a state-corporation spin-off to the canonical mechanic", () => {
  const out = aliases.expand("They can also spin off state corps right?");
  assert.ok(out.some(query => /privatiz/i.test(query)));
  assert.ok(out.some(query => /national corporation|treasury authority/i.test(query)));
  assert.ok(out.some(query => /SOE director|Gosplan/i.test(query)));
});

test("bridges a post-war regime-change question across conversion, relocation, elections, and quotas", () => {
  const question = "After regime change, can US players join the coalition or can the same DDR party rerun?";
  const out = aliases.expand(question);
  assert.ok(out.some(query => /applyPeaceTerm.*FORCED_ELECTION_DELAY_TURNS/i.test(query)));
  assert.ok(out.some(query => /cross-country election entry/i.test(query)));
  assert.ok(out.some(query => /performRelocation.*independent/i.test(query)));
  assert.ok(out.some(query => /BLOC_LIST_QUOTAS.*governmentType/i.test(query)));
  assert.match(aliases.guidance(question), /separate implemented steps/i);
});

test("requires a regime-change answer to connect treaty choices, relocation, and the runtime quota gate", () => {
  const question = "For regime change in DDR, can US players join afterward or can the SED rerun?";
  assert.match(aliases.answerIssue(question, "The SED can rerun after the war."), /relocation mechanic/i);
  assert.equal(aliases.answerIssue(
    question,
    "The treaty can select a parliamentary republic, presidential republic, or one-party state. US characters cannot file cross-country and must relocate first; relocation makes them independent. A forced democratic conversion starts a fresh snap election after 12 turns; the former ruling party receives a five-seat reservation but a 20 percent vote-share penalty. DDR's 55 percent bloc-list quota is active only under one-party government, so democratic elections use ordinary competitive allocation.",
  ), "");
});

test("bridges electoral-law verification to enactment, population, and registration drift", () => {
  const question = "How can DDR tell whether voting age 16 and registration access +50 worked?";
  const out = aliases.expand(question);
  assert.ok(out.some(query => /votingAgeEligibleByCountry/i.test(query)));
  assert.ok(out.some(query => /votingEligiblePopulation/i.test(query)));
  assert.ok(out.some(query => /registrationDriftMultiplier/i.test(query)));
  assert.match(aliases.guidance(question), /three boundaries/i);
  assert.equal(aliases.answerIssue(
    question,
    "First confirm the bill status is enacted and its electoral-law provision contains voting age 16 and registration access +50. After the next turn, the country-scoped votingEligiblePopulation is the eligible population check. Registration +50 makes upward registration drift 1.5x and decay 0.5x, visible in registration or ledger rows. DDR's fixed bloc-list seat shares are not a valid test.",
  ), "");
});

test("bridges German Question air-superiority wording to the war subsystem", () => {
  const out = aliases.expand("In the German Question, how do I make NATO air superiority higher?");
  assert.ok(out.some(query => /conflict|war/i.test(query)));
  assert.ok(out.some(query => /air superiority|navair/i.test(query)));
  assert.ok(out.some(query => /stationOf/i.test(query)));
  assert.ok(out.some(query => /authorizeBattleAction/i.test(query)));
});

test("bridges general air-superiority mechanics wording to the same subsystem", () => {
  const question = "Which air missions build air superiority, where do they count, and how quickly does control build or decay?";
  const out = aliases.expand(question);
  assert.ok(out.includes("CHANNEL_RATES airSuperiority"));
  assert.ok(out.includes("src/lib/navair/config.ts EMBARGO"));
  assert.ok(out.includes("src/lib/navair/turn.ts stationOf"));
  assert.ok(out.some(query => /CAP PATROL/i.test(query)));
  assert.ok(out.some(query => /stationOf/i.test(query)));
  assert.match(aliases.guidance(question), /regional naval-air channel/i);
  assert.match(aliases.answerIssue(question, "The value builds and decays in each region."), /CAP and PATROL/i);
  assert.equal(aliases.answerIssue(
    question,
    "CAP and PATROL wings stationed in the contested region build the channel by 12 per turn, while it decays by 15 per turn.",
  ), "");
  assert.match(aliases.answerIssue(
    question,
    "CAP and PATROL wings stationed in or near the contested region build and decay the channel at 12 and 15 per turn.",
  ), /not merely in or near/i);
  assert.match(aliases.answerIssue(
    question,
    "CAP and PATROL wings stationed in the contested region build and decay the channel each turn.",
  ), /build by 12 and decay by 15/i);
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
