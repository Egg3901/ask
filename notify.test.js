"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-notify-test-"));
process.env.ASK_DB_PATH = path.join(tempDir, "ask.db");
process.env.ASK_GAME_NOTIFY_URL = "https://game.example/api/service/ask-events";
process.env.ASK_GAME_NOTIFY_TOKEN = "test-token";
const store = require("./store");
const notify = require("./notify");

test.after(() => {
  store.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function answerRow(userKey, question) {
  return store.record({
    user_key: userKey, username: "T", conv_id: "c1", question, answer: "a",
    areas: "[]", citations: "[]", used_mcp: 1, cached: 0, cost: 1, followup: 0,
    tokens_in: 1, tokens_out: 1, model: "m", ts: Date.now(),
  });
}

test("creditBack refunds once, restores usage, and queues one in-game notification", () => {
  const key = "ahd:player-9";
  const id = answerRow(key, "How do tariffs work?");
  const before = store.usage(key, { questions: 5, mcp: 2 });
  assert.equal(before.used, 1);
  assert.equal(notify.creditBack(id, "test flag", "refund"), true);
  const after = store.usage(key, { questions: 5, mcp: 2 });
  assert.equal(after.used, 0);
  assert.equal(after.mcpUsed, 0);
  // Idempotent: second credit neither refunds again nor double-notifies.
  assert.equal(notify.creditBack(id, "again", "refund"), false);
  const pending = store.pendingNotifies();
  assert.equal(pending.filter(row => row.user_key === key).length, 1);
  assert.match(pending[0].body, /tariffs/);
  assert.match(pending[0].body, /no longer counts/);
});

test("correction copy differs and a discord identity maps to discordId", () => {
  const id = answerRow("discord:555", "Do coupons compound?");
  assert.ok(notify.creditBack(id, "correction", "correction"));
  const row = store.pendingNotifies().find(r => r.user_key === "discord:555");
  assert.match(row.title, /corrected an answer/);
  const event = notify.eventFor(row);
  assert.equal(event.discordId, "555");
  assert.equal(event.userId, undefined);
  const ahdRow = store.pendingNotifies().find(r => r.user_key === "ahd:player-9");
  assert.equal(notify.eventFor(ahdRow).userId, "player-9");
});

test("deliverPending marks sent on ok, retires unknown users, retries failures", async () => {
  store.queueNotify({ userKey: "ahd:u1", kind: "ask_watch", title: "t1", body: "b1" });
  store.queueNotify({ userKey: "discord:nope", kind: "ask_watch", title: "t2", body: "b2" });
  const preexisting = store.pendingNotifies(50).length;
  const fetcher = async (url, opts) => {
    assert.match(url, /ask-events/);
    assert.equal(opts.headers.Authorization, "Bearer test-token");
    const events = JSON.parse(opts.body).events;
    return { ok: true, json: async () => ({ results: events.map(e => e.discordId === "nope" ? { error: "unknown_user" } : { ok: true }) }) };
  };
  const out = await notify.deliverPending({ fetcher });
  assert.equal(out.sent, preexisting - 1);
  assert.equal(store.pendingNotifies(50).length, 0);

  // A hard failure bumps attempts and keeps the row for retry.
  store.queueNotify({ userKey: "ahd:u2", kind: "ask_refund", title: "t3", body: "b3" });
  await notify.deliverPending({ fetcher: async () => { throw new Error("down"); }, log: () => {} });
  const retry = store.pendingNotifies(50);
  assert.equal(retry.length, 1);
  assert.equal(retry[0].attempts, 1);
});

test("watchFired queues game delivery with the event message", () => {
  notify.watchFired("ahd:u3", "USD/GBP crossed above 0.5: now 0.5010");
  const row = store.pendingNotifies(50).find(r => r.user_key === "ahd:u3");
  assert.match(row.title, /watch fired/);
  assert.match(row.body, /USD\/GBP crossed above 0\.5/);
});
