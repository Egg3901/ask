"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const starters = require("./starters");

const fullContext = {
  character: { name: "Ada", country: "United Kingdom", party: "Liberal" },
  corporation: { name: "Lakeside", role: "ceo" },
};

test("ships a large unique grounded starter library across every topic", () => {
  assert.ok(starters.QUESTIONS.length >= 95);
  assert.equal(new Set(starters.QUESTIONS.map((question) => question.id)).size, starters.QUESTIONS.length);
  assert.equal(new Set(starters.QUESTIONS.map((question) => question.text)).size, starters.QUESTIONS.length);
  assert.deepEqual(
    new Set(starters.QUESTIONS.map((question) => question.category)),
    new Set(Object.keys(starters.CATEGORIES))
  );
});

test("only includes templates supported by the player's loaded context", () => {
  const generic = starters.catalog(null);
  const contextual = starters.catalog(fullContext);

  assert.ok(contextual.length > generic.length);
  assert.ok(generic.every((question) => !question.personal));
  assert.ok(contextual.some((question) => question.text.includes("Lakeside")));
  assert.ok(contextual.some((question) => question.text.includes("United Kingdom")));
  assert.ok(contextual.some((question) => question.text.includes("Liberal")));
  assert.ok(contextual.some((question) => question.text.includes("Ada")));
  assert.ok(contextual.every((question) => !question.text.includes("{")));
});

test("offers live and mechanics visualization prompts in their own library topic", () => {
  const visualizations = starters.catalog(fullContext).filter((question) => question.category === "visualizations");

  assert.ok(visualizations.length >= 14);
  assert.ok(visualizations.some((question) => question.text.includes("Compare Lakeside with its public peers")));
  assert.ok(visualizations.some((question) => question.text.includes("Anchor-normalized income")));
  assert.ok(visualizations.some((question) => question.text.includes("GBP/USD")));
  assert.ok(visualizations.some((question) => question.text.includes("Ada")));
  assert.ok(visualizations.some((question) => !question.live && question.text.startsWith("Diagram how")));
});

test("prioritizes corporation questions and removes current-state prompts without live quota", () => {
  const withLive = starters.select(starters.catalog(fullContext));
  const withoutLive = starters.catalog(fullContext, { liveAvailable: false });

  assert.deepEqual(withLive.slice(0, 3).map((question) => question.requires), [
    "corporation", "corporation", "corporation",
  ]);
  assert.ok(withLive[0].live);
  assert.ok(withoutLive.every((question) => !question.live));
  assert.ok(withoutLive.some((question) => question.text === "How is Lakeside's credit score calculated?"));
});
