"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const llm = require("./llm");

test("an Ollama Railway service base URL resolves to the OpenAI chat endpoint", () => {
  assert.equal(
    llm.completionUrl("ollama", "http://lakeside-ollama.railway.internal:11434"),
    "http://lakeside-ollama.railway.internal:11434/v1/chat/completions",
  );
  assert.equal(
    llm.completionUrl("ollama", "http://lakeside-ollama.railway.internal:11434/"),
    "http://lakeside-ollama.railway.internal:11434/v1/chat/completions",
  );
});

test("an explicit Ollama completion path is preserved", () => {
  assert.equal(
    llm.completionUrl("ollama", "http://ollama:11434/v1/chat/completions"),
    "http://ollama:11434/v1/chat/completions",
  );
});
