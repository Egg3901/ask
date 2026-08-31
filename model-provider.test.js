"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const models = require("./models");

test("names the actual provider behind routed cloud and fallback models", () => {
  assert.equal(models.providerDisplayFor("deepseek-v4-flash:cloud"), "Ollama Cloud");
  assert.equal(models.providerDisplayFor("minimax/minimax-m3-free"), "Command Code");
  assert.equal(models.providerDisplayFor("deepseek-v4-flash"), "DeepSeek API");
});

test("labels deterministic live-data contracts as Lakeside rather than an LLM provider", () => {
  assert.equal(models.displayFor("ask-live-contract"), "Live Data");
  assert.equal(models.providerOf("ask-live-contract"), "lakeside");
  assert.equal(models.providerDisplayFor("ask-live-contract"), "Lakeside");
});

test("labels deterministic mechanics contracts as Lakeside rather than an LLM provider", () => {
  assert.equal(models.displayFor("ask-mechanics-contract"), "Mechanics");
  assert.equal(models.providerOf("ask-mechanics-contract"), "lakeside");
  assert.equal(models.providerDisplayFor("ask-mechanics-contract"), "Lakeside");
});
