"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-conflicts-test-"));
process.env.ASK_DB_PATH = path.join(tempDir, "ask.db");
const store = require("./store");
const notifier = require("./doc-conflict-notifier");
const opsDiscord = require("./ops-discord");

test.after(() => {
  store.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;
function harness(start = 1_000_000_000_000) {
  let clock = start;
  const posts = [];
  let fail = false;
  const n = notifier.create({
    store,
    post: async content => { if (fail) throw new Error("channel down"); posts.push(content); },
    now: () => clock,
    log: () => {},
  });
  return { n, posts, advance: ms => { clock += ms; }, setFail: v => { fail = v; } };
}

test("new conflicts go out as one batched post with the claim and the actual behaviour, then are marked", async () => {
  store.recordConflicts([
    { source: "wiki", page: "Tariffs", claim: "tariffs are 5% flat", actual: "tariffs scale with the legislated rate", evidence: "src/lib/turn/tariffs.ts" },
    { source: "docs", page: "Elections", claim: "runoffs happen after two turns", actual: "runoffs happen the next turn" },
  ], { question: "how do tariffs work" });
  const h = harness();
  const first = await h.n.tick();
  assert.equal(first.posted, 2);
  assert.equal(h.posts.length, 1);
  assert.match(h.posts[0], /2 new doc conflicts/);
  assert.match(h.posts[0], /\[wiki Tariffs\] says "tariffs are 5% flat" but the code does "tariffs scale with the legislated rate" \(src\/lib\/turn\/tariffs\.ts\)/);
  assert.match(h.posts[0], /\[docs Elections\] says "runoffs happen after two turns"/);
  assert.equal(store.unnotifiedConflicts().length, 0);
  assert.equal(store.lastConflictNotifiedTs(), 1_000_000_000_000);
  // Nothing new: nothing posted.
  assert.deepEqual(await h.n.tick(), { posted: 0, pending: 0 });
});

test("a conflict found inside the hour waits; after the hour it goes out", async () => {
  const h = harness(store.lastConflictNotifiedTs());
  h.advance(10 * 60 * 1000);
  store.recordConflicts([{ source: "wiki", page: "Bonds", claim: "bonds pay yearly", actual: "bonds pay every turn" }]);
  const early = await h.n.tick();
  assert.equal(early.posted, 0);
  assert.equal(early.deferred, true);
  assert.equal(early.pending, 1);
  assert.equal(h.posts.length, 0);
  h.advance(51 * 60 * 1000);
  const later = await h.n.tick();
  assert.equal(later.posted, 1);
  assert.match(h.posts[0], /1 new doc conflict\b/);
  assert.match(h.posts[0], /bonds pay every turn/);
});

test("a failed post leaves the rows for the next tick instead of marking them", async () => {
  const h = harness(store.lastConflictNotifiedTs() + 2 * HOUR);
  store.recordConflicts([{ source: "docs", claim: "cloture needs 50", actual: "cloture needs 60" }]);
  h.setFail(true);
  const failed = await h.n.tick();
  assert.equal(failed.posted, 0);
  assert.match(failed.error, /channel down/);
  assert.equal(store.unnotifiedConflicts().length, 1);
  h.setFail(false);
  const ok = await h.n.tick();
  assert.equal(ok.posted, 1);
  assert.equal(store.unnotifiedConflicts().length, 0);
});

test("a flood is capped per post and the remainder waits for the next hour", async () => {
  const h = harness(store.lastConflictNotifiedTs() + 2 * HOUR);
  store.recordConflicts(Array.from({ length: 12 }, (_, i) => ({ source: "wiki", page: `Page ${i}`, claim: `claim ${i}`, actual: `actual ${i}` })));
  const first = await h.n.tick();
  assert.equal(first.posted, notifier.BATCH);
  assert.equal(store.unnotifiedConflicts(50).length, 2);
  assert.equal((await h.n.tick()).deferred, true);
  h.advance(HOUR);
  assert.equal((await h.n.tick()).posted, 2);
});

test("repeat sightings of a posted conflict do not re-post it", async () => {
  const h = harness(store.lastConflictNotifiedTs() + 2 * HOUR);
  store.recordConflicts([{ source: "wiki", page: "Bonds", claim: "bonds pay yearly", actual: "bonds pay every turn" }]);
  assert.deepEqual(await h.n.tick(), { posted: 0, pending: 0 });
  assert.equal(store.conflicts("open", 50).find(c => c.claim === "bonds pay yearly").seen, 2);
});

test("the staff-channel transport is the digest's: a discord_send tools/call, SSE or JSON reply", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"sent\"}]}}\n\n" };
  };
  const result = await opsDiscord.post("hello", { url: "https://mcp.example/mcp", token: "t", channel: "ops", fetcher });
  assert.equal(calls[0].url, "https://mcp.example/mcp");
  assert.equal(calls[0].init.headers.Authorization, "Bearer t");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "discord_send");
  assert.deepEqual(body.params.arguments, { channel: "ops", content: "hello" });
  assert.equal(result.content[0].text, "sent");

  const errFetcher = async () => ({ ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [] } }) });
  await assert.rejects(() => opsDiscord.post("x", { url: "https://mcp.example/mcp", fetcher: errFetcher }), /discord_send failed/);
  await assert.rejects(() => opsDiscord.post("x", { url: "", fetcher }), /not configured/);
});
