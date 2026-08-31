"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("./auth");
const prompt = require("./prompt");
const games = require("./games");
const { normalizeDiscordAsk, discordSession } = require("./discord-ask");

test("Discord questions are translated into the full Ask request contract", () => {
  const out = normalizeDiscordAsk({
    question: "How has my corporation performed?",
    responseLength: "detailed",
    thinking: "deep",
    convId: "discord-thread-123",
    requester: {
      discordUserId: "42",
      discordUsername: "egg",
      characterId: "char-1",
      characterName: "Alice",
      country: "US",
      corporationName: "Acme",
    },
  });
  assert.deepEqual(out, {
    question: "How has my corporation performed?",
    style: "standard",
    length: "deep",
    effort: "auto",
    useMcp: true,
    visualizations: true,
    mode: "auto",
    convId: "discord-thread-123",
  });
});

test("Discord accepts only known Ask modes", () => {
  assert.equal(normalizeDiscordAsk({ question: "Check this claim", mode: "verify" }).mode, "verify");
  assert.equal(normalizeDiscordAsk({ question: "Check this claim", mode: "anything" }).mode, "auto");
});

test("Discord sessions are public player sessions with self-scoped game identity", () => {
  const session = discordSession({
    discordId: "42",
    discordUsername: "egg",
    requester: {
      characterId: "char-1",
      characterName: "Alice",
      country: "US",
      corporationName: "Acme",
    },
    subject: {
      characterName: "Bob",
      country: "UK",
      corporationName: "Beta",
    },
  });
  assert.equal(session.identity.provider, "discord");
  assert.equal(session.identity.id, "42");
  assert.equal(session.context.character.name, "Alice");
  assert.equal(session.context.corporation.name, "Acme");
  assert.deepEqual(session.context.selectedSubject, { name: "Bob", country: "UK", corporation: "Beta" });
  assert.equal(session.context.isModerator, false);
  assert.deepEqual(session.entitlement, { allowed: true, reason: "player", ...auth.PLAYER });
  const instructions = prompt.build({ context: session.context, game: games.resolve("ahd") });
  assert.match(instructions, /SELECTED PUBLIC SUBJECT: Bob in UK, associated with Beta/);
  assert.match(instructions, /Resolve "they", "them", or "this player"/);
});

test("a long Discord question is clamped at a word boundary, not rejected", () => {
  const discordAsk = require("./discord-ask");
  const long = "why does the bond market ".repeat(40); // ~1000 chars
  const out = discordAsk.normalizeDiscordAsk({ question: long, discordId: "1" });
  assert.ok(out.question.length <= discordAsk.MAX_QUESTION);
  assert.ok(out.question.length > 300);
  assert.doesNotMatch(out.question, / $/);
  // Short questions pass through untouched.
  assert.equal(discordAsk.normalizeDiscordAsk({ question: "how do tariffs work?" }).question, "how do tariffs work?");
});

test("a Discord report has the same consequences as a web downvote", () => {
  const server = require("node:fs").readFileSync(require.resolve("./server.js"), "utf8");
  const handler = server.slice(server.indexOf('"/api/discord-feedback"'), server.indexOf('"/api/discord-ask/check"'));
  assert.match(handler, /evictCacheByQuestion/);
  assert.match(handler, /corrections\.draft/);
  assert.match(handler, /discord report/);
  // The web owner-feedback path evicts too.
  const web = server.slice(server.indexOf('"/api/answer/feedback"'));
  assert.match(web.slice(0, 1500), /evictCacheByQuestion/);
});
