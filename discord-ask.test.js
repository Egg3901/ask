"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("./auth");
const prompt = require("./prompt");
const games = require("./games");
const { normalizeDiscordAsk, discordSession, elevate } = require("./discord-ask");

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
  // Consequences are routed through one shared helper; either the helper or
  // the two direct calls it replaced satisfy the contract.
  assert.match(handler, /downvoteConsequences\(|evictCacheByQuestion/);
  assert.match(handler, /downvoteConsequences\(|corrections\.draft/);
  assert.match(handler, /discord report/);
  // The web owner-feedback path evicts too.
  const web = server.slice(server.indexOf('"/api/answer/feedback"'));
  assert.match(web.slice(0, 1500), /downvoteConsequences\(|evictCacheByQuestion/);
});

test("a moderator asking from Discord is a moderator", () => {
  const session = discordSession({ discordId: "42", discordUsername: "mod" });
  assert.equal(session.context.isModerator, false);

  const elevated = elevate(session, { role: "moderator", isAdmin: false, isModerator: true });
  assert.equal(elevated.context.isModerator, true);
  assert.equal(elevated.entitlement.staff, true);
  // Identity is untouched: elevation grants a role, it does not change who asked.
  assert.deepEqual(elevated.identity, session.identity);
  assert.equal(elevated.context.username, session.context.username);

  const admin = elevate(session, { role: "admin", isAdmin: true, isModerator: false });
  assert.equal(admin.context.isAdmin, true);
});

test("elevation is refused to everyone who is not staff", () => {
  const session = discordSession({ discordId: "42", discordUsername: "player" });
  for (const context of [
    null,
    undefined,
    { role: "player", isAdmin: false, isModerator: false },
    { role: "admin", isAdmin: true, isBanned: true },          // banned wins
    { isAdmin: "true", isModerator: "yes" },                    // strings are not true
  ]) {
    assert.equal(elevate(session, context), session, JSON.stringify(context));
  }
});
