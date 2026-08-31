"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("./eval/reported-failures.json");
const askPlan = require("./ask-plan");
const grounding = require("./grounding");
const queryAliases = require("./query-aliases");
const answerGuard = require("./answer-guard");

test("every sanitized production report replays through deterministic request boundaries", () => {
  assert.equal(fixtures.length, 9);
  assert.equal(new Set(fixtures.map((fixture) => fixture.name)).size, fixtures.length);

  for (const fixture of fixtures) {
    const expected = fixture.expected;
    const contextual = grounding.needsConversationContext(fixture.question);
    const retrievalQuestion = contextual && fixture.contaminatedRewrite
      ? fixture.contaminatedRewrite
      : fixture.question;
    const plan = askPlan.create(fixture.question, {}, fixture.mode || "auto");
    const contract = queryAliases.deliveryContract(fixture.question, retrievalQuestion, { contextual });
    const guidance = queryAliases.guidance(contextual ? retrievalQuestion : fixture.question);
    const refusal = answerGuard.asksForPrivateMilitaryIntelligence(fixture.question)
      ? answerGuard.protectPublicAnswer("", fixture.question)
      : "";

    if (expected.planIntent) assert.equal(plan.intent, expected.planIntent, fixture.name);
    if (expected.planLive) assert.equal(plan.live, expected.planLive, fixture.name);
    if (expected.planVisual) assert.equal(plan.visual, expected.planVisual, fixture.name);
    if (typeof expected.contextual === "boolean") assert.equal(contextual, expected.contextual, fixture.name);
    if (typeof expected.private === "boolean") assert.equal(Boolean(refusal), expected.private, fixture.name);
    for (const phrase of expected.contractIncludes || []) assert.match(contract, new RegExp(phrase, "i"), fixture.name);
    for (const phrase of expected.contractExcludes || []) assert.doesNotMatch(contract, new RegExp(phrase, "i"), fixture.name);
    for (const phrase of expected.guidanceIncludes || []) assert.match(guidance, new RegExp(phrase, "i"), fixture.name);
    for (const phrase of expected.refusalIncludes || []) assert.match(refusal, new RegExp(phrase, "i"), fixture.name);
    for (const phrase of expected.refusalExcludes || []) assert.doesNotMatch(refusal, new RegExp(phrase, "i"), fixture.name);
  }
});
