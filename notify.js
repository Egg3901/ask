"use strict";

// Credits and in-game delivery. Two ideas, deliberately joined:
//
// 1. A question that produced a flagged answer should not cost the player.
//    Inline defects (the player is looking at the caveat) zero the charge at
//    record time; LATER discoveries (async grounding audit, the answer
//    sampler, a staff verdict, an activated correction) refund the recorded
//    row and tell the player in-game, because they have no other way to learn
//    their question was made whole.
// 2. Delivery goes through the GAME's notification system, not another inbox:
//    a queued event posts to an authenticated AHD endpoint which resolves the
//    player (ahd userId or linked discordId) and creates a real in-game
//    notification. Fail-open with bounded retries; the game being down never
//    breaks answering.

const store = require("./store");

const GAME_NOTIFY_URL = process.env.ASK_GAME_NOTIFY_URL || "";
const GAME_NOTIFY_TOKEN = process.env.ASK_GAME_NOTIFY_TOKEN || "";
const ASK_URL = process.env.SELF_ORIGIN || "https://ask.lakesidegames.net";

const COPY = {
  refund: question => ({
    title: "Ask credited a question back",
    body: `A quality check flagged the answer to "${String(question).slice(0, 120)}". That question no longer counts against your daily limit; ask again for a better answer.`,
    url: ASK_URL,
  }),
  correction: question => ({
    title: "Ask corrected an answer",
    body: `An answer you received about "${String(question).slice(0, 120)}" was reviewed and corrected. Your question was credited back; ask again for the corrected version.`,
    url: ASK_URL,
  }),
  watch: message => ({
    title: "Your Ask watch fired",
    body: String(message).slice(0, 300),
    url: ASK_URL,
  }),
};

/**
 * Refund a recorded answer and queue an in-game notification for its owner.
 * Idempotent: a second call for the same answer does nothing. `kind` picks
 * the player-facing copy: "refund" or "correction".
 */
function creditBack(answerId, reason, kind = "refund") {
  const refunded = store.refundAnswer(answerId, reason);
  if (!refunded) return false;
  const owner = store.answerOwner(answerId);
  if (!owner) return true;
  const copy = (COPY[kind] || COPY.refund)(owner.question || "your question");
  store.queueNotify({ userKey: owner.user_key, kind: `ask_${kind}`, ...copy });
  return true;
}

/** Queue an in-game notification for a fired watch event. */
function watchFired(userKey, message) {
  const copy = COPY.watch(message);
  store.queueNotify({ userKey, kind: "ask_watch", ...copy });
}

function eventFor(row) {
  const [provider, id] = String(row.user_key).split(":");
  return {
    ...(provider === "ahd" ? { userId: id } : {}),
    ...(provider === "discord" ? { discordId: id } : {}),
    kind: row.kind,
    title: row.title,
    body: row.body,
    ...(row.url ? { url: row.url } : {}),
  };
}

/**
 * One sender tick: post pending events to the game, mark delivered, bump
 * attempts on failure (rows retire after 10). No-op when unconfigured.
 */
async function deliverPending({ fetcher = fetch, log = () => {} } = {}) {
  if (!GAME_NOTIFY_URL || !GAME_NOTIFY_TOKEN) return { sent: 0, skipped: true };
  const rows = store.pendingNotifies(20);
  if (!rows.length) return { sent: 0 };
  let sent = 0;
  try {
    const response = await fetcher(GAME_NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GAME_NOTIFY_TOKEN}` },
      body: JSON.stringify({ events: rows.map(eventFor) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`game notify ${response.status}`);
    const result = await response.json();
    const outcomes = Array.isArray(result?.results) ? result.results : [];
    rows.forEach((row, index) => {
      const outcome = outcomes[index];
      // "ok" delivered; "unknown_user" is permanent (no linked account), so
      // retire the row rather than retrying a player the game cannot resolve.
      if (outcome?.ok || outcome?.error === "unknown_user") { store.markNotifySent(row.id); if (outcome?.ok) sent++; }
      else store.bumpNotifyAttempt(row.id);
    });
  } catch (e) {
    for (const row of rows) store.bumpNotifyAttempt(row.id);
    log(`[notify] delivery failed for ${rows.length} event(s): ${String(e.message || e).slice(0, 140)}`);
  }
  return { sent };
}

module.exports = { creditBack, watchFired, deliverPending, eventFor, COPY };
