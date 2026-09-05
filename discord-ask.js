"use strict";

const auth = require("./auth");
const capabilities = require("./capabilities");

const LENGTHS = { concise: "concise", standard: "standard", detailed: "deep", deep: "deep" };

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

// The web form enforces 500 chars client-side, but the Discord command allows
// 2000 — and the ask handler 400s anything over its limit, so a long Discord
// question used to fail outright after the player typed it all out. Clamp at
// a word boundary instead: a trimmed question gets an answer, a 400 gets nothing.
const MAX_QUESTION = 500;

function clampQuestion(text) {
  const s = String(text || "").trim();
  if (s.length <= MAX_QUESTION) return s;
  const cut = s.slice(0, MAX_QUESTION);
  const boundary = cut.lastIndexOf(" ");
  return boundary > MAX_QUESTION * 0.6 ? cut.slice(0, boundary) : cut;
}

function normalizeDiscordAsk(body = {}) {
  const question = clampQuestion(clean(body.question, 2000));
  if (!question) throw new Error("question required");
  const responseLength = clean(body.responseLength, 20).toLowerCase();
  const convId = /^[A-Za-z0-9_-]{6,40}$/.test(String(body.convId || ""))
    ? String(body.convId)
    : undefined;
  const out = {
    question,
    style: "standard",
    length: LENGTHS[responseLength] || "standard",
    effort: "auto",
    useMcp: true,
    visualizations: true,
    mode: capabilities.normalizeMode(body.mode),
  };
  if (convId) out.convId = convId;
  return out;
}

function discordSession(body = {}) {
  const requester = body.requester && typeof body.requester === "object" ? body.requester : {};
  const id = clean(body.discordId || requester.discordUserId, 100);
  if (!id) throw new Error("discordId required");
  const username = clean(body.discordUsername || requester.discordUsername || "Discord user", 100);
  const characterName = clean(requester.characterName, 120);
  const corporationName = clean(requester.corporationName, 160);
  const country = clean(requester.country, 40);
  const context = {
    username,
    role: "player",
    isAdmin: false,
    isModerator: false,
    character: characterName ? {
      id: clean(requester.characterId, 100) || null,
      name: characterName,
      country: country || null,
    } : null,
    corporation: corporationName ? { name: corporationName, role: "ceo" } : null,
  };
  const subject = body.subject && typeof body.subject === "object" ? body.subject : {};
  const subjectName = clean(subject.characterName, 120);
  if (subjectName) {
    context.selectedSubject = {
      name: subjectName,
      country: clean(subject.country, 40) || null,
      corporation: clean(subject.corporationName, 160) || null,
    };
  }
  return {
    identity: { provider: "discord", id, username },
    context,
    entitlement: { allowed: true, reason: "player", ...auth.PLAYER },
  };
}

/**
 * Give a Discord session the role its owner already has in the game.
 *
 * The bot cannot assert this: a claim carried over a shared secret is not a
 * check, and the bot is one compromised token away from minting moderators. The
 * role therefore comes from the AHD account linked to the Discord id, read
 * server-side. Only the role and the entitlement it earns are taken; everything
 * else about the session is left exactly as the public path built it, so an
 * ordinary player's Discord session is byte-for-byte unchanged.
 *
 * A banned account is not elevated and not otherwise touched here.
 */
function elevate(session, playerContext) {
  if (!session || !playerContext || playerContext.isBanned === true) return session;
  const isAdmin = playerContext.isAdmin === true;
  const isModerator = playerContext.isModerator === true;
  if (!isAdmin && !isModerator) return session;
  return {
    ...session,
    context: {
      ...session.context,
      isAdmin,
      isModerator,
      role: playerContext.role || (isAdmin ? "admin" : "moderator"),
    },
    entitlement: auth.entitlementFor(playerContext),
  };
}

module.exports = { normalizeDiscordAsk, discordSession, elevate, clampQuestion, MAX_QUESTION };
