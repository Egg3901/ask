"use strict";

const auth = require("./auth");
const capabilities = require("./capabilities");

const LENGTHS = { concise: "concise", standard: "standard", detailed: "deep", deep: "deep" };

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeDiscordAsk(body = {}) {
  const question = clean(body.question, 2000);
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

module.exports = { normalizeDiscordAsk, discordSession };
