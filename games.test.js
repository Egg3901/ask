"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const games = require("./games");

test("an unknown or missing game id falls back to A House Divided", () => {
  assert.equal(games.resolve(undefined).id, "ahd");
  assert.equal(games.resolve("").id, "ahd");
  assert.equal(games.resolve("not-a-game").id, "ahd");
  assert.equal(games.resolve("GRAND-CENTURY").id, "grand-century");
});

test("A House Divided is the only game with live data", () => {
  const live = games.GAMES.filter(g => g.live).map(g => g.id);
  assert.deepEqual(live, ["ahd"]);
  // Fair-play and player-context rules key off multiplayer, not off live.
  assert.deepEqual(games.GAMES.filter(g => g.multiplayer).map(g => g.id), ["ahd"]);
});

test("detection only fires when exactly one game is named", () => {
  assert.equal(games.detect("how does culture work in Grand Century?").id, "grand-century");
  assert.equal(games.detect("what is MetroForge about").id, "metroforge");
  assert.equal(games.detect("how does metroforge handle demand?").id, "metroforge");
  // The name has to stand as a word: a substring inside another token is not a mention.
  assert.equal(games.detect("is metroforged a word"), null);
  // Ambiguous or unnamed questions must not guess.
  assert.equal(games.detect("how does the economy work"), null);
  assert.equal(games.detect("compare ahd and metroforge"), null, "two games named is ambiguous");
});

test("a named game overrides the picker, but silence does not", () => {
  // Player is on A House Divided and asks about another game by name.
  assert.equal(games.forQuestion("how does culture work in Grand Century?", "ahd").id, "grand-century");
  // Player is on Grand Century and asks a generic question: stay put.
  assert.equal(games.forQuestion("how does the economy work", "grand-century").id, "grand-century");
  // No selection at all defaults to A House Divided.
  assert.equal(games.forQuestion("how does the economy work", null).id, "ahd");
});

test("every game is publishable to the client without leaking local paths", () => {
  for (const g of games.publicList()) {
    assert.ok(g.id && g.name && g.short, "needs display fields");
    assert.equal(JSON.stringify(g).includes("/root/"), false, `${g.id} leaks a filesystem path`);
    assert.equal("ragDb" in g, false, `${g.id} exposes its index path`);
    assert.equal("repoDir" in g, false, `${g.id} exposes its repo path`);
  }
});

test("each game has the fields the prompt and citations depend on", () => {
  for (const g of games.GAMES) {
    assert.ok(g.subject, `${g.id} needs a subject for the system prompt`);
    assert.ok(g.pathExample, `${g.id} needs a path example matching its own tree`);
    assert.ok(g.ragDb, `${g.id} needs an index`);
    assert.ok(typeof g.docsSubdir === "string", `${g.id} needs a docs sub-path`);
    assert.ok("githubBase" in g, `${g.id} must state whether it has a public repo`);
  }
  // Index paths must be distinct: a shared file would cross-answer games.
  const dbs = games.GAMES.map(g => g.ragDb);
  assert.equal(new Set(dbs).size, dbs.length, "two games share a retrieval index");
});
