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
