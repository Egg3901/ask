"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const guard = require("./answer-guard");

test("public answers remove live military intelligence paraphrases", () => {
  const sensitive = [
    "Northland currently operates three armored corps.",
    "Northland's army consists of twelve infantry battalions.",
    "Northland is at 43% readiness.",
    "The Airlift Wing is absent from Northland forces.",
    "Northland is missing a Logistics Command.",
    "Northland maintains two carrier groups near the coast.",
  ];
  for (const answer of sensitive) {
    assert.notEqual(guard.protectPublicAnswer(answer), answer, answer);
  }
});

test("private military questions are refused before a euphemistic answer can pass", () => {
  const answer = guard.protectPublicAnswer(
    "They are well prepared.",
    "How many battalions does Northland currently deploy?",
  );
  assert.match(answer, /public|fog of war|private military/i);
  assert.doesNotMatch(answer, /well prepared/i);
});

test("a current named-country military comparison is refused before streaming", () => {
  const question = "Compare the current militaries of the US, UK, Russia, and East Germany.";
  assert.equal(guard.asksForPrivateMilitaryIntelligence(question), true);
  assert.match(guard.protectPublicAnswer("", question), /public|fog of war|private military/i);
});

test("public answers preserve generic quantified military mechanics", () => {
  const mechanics = "A division contains three brigades in the formation model.";
  assert.equal(guard.protectPublicAnswer(mechanics, "How are divisions composed?"), mechanics);
  const commandMechanic = "A Logistics Command adds regional supply throughput.";
  assert.equal(guard.protectPublicAnswer(commandMechanic, "What does a Logistics Command do?"), commandMechanic);
  const requirement = "You need to have a Logistics Command assigned to support regional supply.";
  assert.equal(guard.protectPublicAnswer(requirement, "What does a Logistics Command do?"), requirement);
  const hypothetical = "If your country has no Logistics Command, regional supply throughput falls.";
  assert.equal(guard.protectPublicAnswer(hypothetical, "What does a Logistics Command do?"), hypothetical);
  const missionMechanic = "A country's air-superiority figure is built by formations stationed in the region on CAP or PATROL. It builds by 12 and decays by 15 per turn.";
  assert.equal(guard.protectPublicAnswer(
    missionMechanic,
    "Which air missions build air superiority, where do they count, and how quickly does it build or decay?",
  ), missionMechanic);
  const workedExample = "With hostile weight at 0, one wing on CAP builds the channel by 12 per turn.";
  assert.equal(guard.protectPublicAnswer(
    workedExample,
    "Which air missions build air superiority, where do they count, and how quickly does it build or decay?",
  ), workedExample);

  const namedLeak = "East has no Logistics Command assigned to the region.";
  assert.notEqual(guard.protectPublicAnswer(namedLeak, "How does regional supply work?"), namedLeak);
});

test("ticket 1234 air-superiority typo still preserves a mechanics answer", () => {
  const answer = "Station CAP and PATROL wings in the contested region. Air superiority builds by 12 per turn toward your contest share and decays by 15 when you lose that share.";
  assert.equal(
    guard.protectPublicAnswer(answer, "and how do we incraase air sueprioryty"),
    answer,
  );
});

test("ticket 1234 battle-role save explanation is not treated as roster leakage", () => {
  const answer = "Only the Defense Secretary can save a regiment's battle role. Other officials see a read-only view.";
  assert.equal(guard.protectPublicAnswer(
    answer,
    "this regiment keeps changing its battle post, i keep setting it back but it doesnt save",
  ), answer);
});

test("ticket 1234 preserves the deliberately public nuclear stockpile record", () => {
  const question = "Where can I see how many nuclear warheads the UK has?";
  const answer = "Open World, then Conflicts. The nuclear powers strip publicly lists the UK's current warhead stockpile and best device tier.";
  assert.equal(guard.protectPublicAnswer(answer, question), answer);
});

test("trusted canonical mechanics contracts cross the final delivery guard unchanged", () => {
  const aliases = require("./query-aliases");
  const question = "How do we blockade DDR, why does my battle role revert when I save it, how do we move the front, and can we use nuclear warheads?";
  const answer = aliases.canonicalAnswer(question);
  const delivered = guard.enforce({
    answer,
    question,
    privacyQuestion: question,
    privacyGuardEnabled: true,
    trustedStaticAnswer: true,
  });
  assert.equal(delivered.answer, answer);
  assert.deepEqual(delivered.issues, []);
});

test("a mechanics question does not make named live formations publishable", () => {
  const answer = "Station Northland's three fighter wings in the contested region.";
  assert.notEqual(
    guard.protectPublicAnswer(answer, "How do we increase air superiority?"),
    answer,
  );
});

test("a follow-up uses its condensed mechanics context for the privacy guard", () => {
  const answer = "The defense officeholder can open the Commands tab and select Open naval and air command.";
  const result = guard.enforce({
    answer,
    question: "where can we find that tab",
    privacyQuestion: "Where does the defense officeholder find Naval and air command to set a blockade?",
    plan: { display: { kind: "prose" }, visual: "none" },
  });
  assert.equal(result.answer, answer);
  assert.ok(!result.issues.includes("private_military_intelligence_removed"));
});

test("the final answer guard replaces military intelligence and records the issue", () => {
  const result = guard.enforce({
    answer: "Northland maintains two carrier groups near the coast.",
    question: "What is happening near the coast?",
    plan: { display: { kind: "prose" }, visual: "optional" },
  });
  assert.doesNotMatch(result.answer, /Northland|carrier groups/i);
  assert.ok(result.issues.includes("private_military_intelligence_removed"));
});

test("the final answer guard preserves private intelligence for moderator access", () => {
  const answer = "Northland maintains two carrier groups near the coast.";
  const result = guard.enforce({
    answer,
    question: "What is happening near the coast?",
    plan: { display: { kind: "prose" }, visual: "optional" },
    privacyGuardEnabled: false,
  });
  assert.equal(result.answer, answer);
  assert.ok(!result.issues.includes("private_military_intelligence_removed"));
});

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

test("a fenced JSON tool call is a leak, not an answer", () => {
  const leak = 'Let me re-verify by checking the current git state.\n\n```json\n{"name": "bash", "arguments": {"command": "git log", "description": "check"}}\n```';
  assert.equal(guard.looksLikeToolLeak(leak), true);
  assert.equal(guard.looksLikeToolLeak('<tool_call><function=search_code>'), true);
  // A real answer that merely shows JSON data must still go out.
  assert.equal(guard.looksLikeToolLeak('The payload is `{"name": "Tinky Winky Corporation", "ticker": "TWC"}`.'), false);
  assert.equal(guard.looksLikeToolLeak('Cloture needs three fifths of the votes cast.'), false);
});

test("civilian sentences with ambiguous inventory words are not military intelligence", () => {
  const question = "How does the game calculate a corporation stock price each turn?";
  const answer = "The market cap includes 500,000 units of outstanding stock. Each corporation has equipment and personnel costs in its ledger. Price moves with earnings per share.";
  assert.equal(guard.protectPublicAnswer(answer, question), answer);
  // Real military leaks still refuse: unambiguous inventory stands alone...
  assert.equal(
    guard.protectPublicAnswer("The US currently has 12 armored divisions stationed in Europe.", question),
    guard.protectPublicAnswer("", "what is the live military roster for the US?"),
  );
  // ...and ambiguous words still refuse when the sentence carries military context.
  assert.notEqual(
    guard.protectPublicAnswer("The German army has 40 ships deployed near the front.", question),
    "The German army has 40 ships deployed near the front.",
  );
  // A military question keeps full protection even for ambiguous words.
  assert.notEqual(
    guard.protectPublicAnswer("They have 300 aircraft available.", "what aircraft does the UK have deployed right now?"),
    "They have 300 aircraft available.",
  );
});
