"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-store-test-"));
process.env.ASK_DB_PATH = path.join(tempDir, "ask.db");
const store = require("./store");
store.touchUser("ahd:user-1", { provider: "ahd", id: "user-1", username: "Tester" }, { username: "Tester" });

test.after(() => {
  store.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function recordAnswer(overrides = {}) {
  return store.record({
    user_key: "ahd:user-1",
    username: "Tester",
    conv_id: "conv-1",
    question: "Why did this happen?",
    answer: "An answer",
    areas: "[]",
    citations: "[]",
    used_mcp: 1,
    cached: 0,
    tokens_in: 10,
    tokens_out: 20,
    cost: 1,
    followup: 0,
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    ts: Date.now(),
    ...overrides,
  });
}

test("records owner feedback with an optional reason", () => {
  const answerId = recordAnswer();

  assert.equal(store.feedback({ answerId, userKey: "ahd:user-1", rating: "down", reason: "Used the wrong live metric" }), true);
  const question = store.adminUser("ahd:user-1").questions[0];
  assert.equal(question.feedback_rating, "down");
  assert.equal(question.feedback_reason, "Used the wrong live metric");
  assert.equal(question.feedback_source, "owner");
});

test("accepts a report from a valid shared conversation but not another token", () => {
  const answerId = recordAnswer({ conv_id: "conv-shared", question: "Shared question" });
  const token = store.share("conv-shared", "ahd:user-1");

  assert.equal(store.feedback({ answerId, shareToken: "wrongtoken", rating: "down", reason: "No live data" }), false);
  assert.equal(store.feedback({ answerId, shareToken: token, rating: "down", reason: "No live data" }), true);
  const sharedTurn = store.shared(token).turns.find(turn => turn.id === answerId);
  assert.equal(sharedTurn.feedback_rating, "down");
  assert.equal(sharedTurn.feedback_source, "shared");
});

test("clusters reported answers into a replayable regression queue", () => {
  const answerId = recordAnswer({ question: "Can two people hold a House seat?" });
  assert.equal(store.feedback({ answerId, userKey: "ahd:user-1", rating: "down", reason: "Wrong chart and live metric" }), true);
  const cluster = store.reportClusters().find(entry => entry.category === "visualization or evidence mismatch");
  assert.ok(cluster);
  assert.ok(cluster.reports.some(report => report.id === answerId));
});

test("persists the request plan, validation, and live retrieval evidence", () => {
  const answerId = recordAnswer({
    plan: JSON.stringify({ id: "public-corporation" }),
    validation: JSON.stringify({ issues: [] }),
    evidence: JSON.stringify({ tools: ["gamestate:trace_corp"], visualizations: [{ metric: "revenueAnchor" }] }),
  });
  const question = store.adminUser("ahd:user-1").questions.find(entry => entry.id === answerId);
  assert.equal(question.plan.id, "public-corporation");
  assert.deepEqual(question.evidence.tools, ["gamestate:trace_corp"]);
});

test("records Discord helpful and report actions in the admin review queue", () => {
  const answerId = store.recordDiscordFeedback({
    discordId: "42", username: "Discord tester", question: "What happened?", answer: "A concise answer",
    rating: "down", reason: "Wrong live source", usedMcp: true,
  });
  const question = store.adminUser("discord:42").questions.find(entry => entry.id === answerId);
  assert.equal(question.feedback_rating, "down");
  assert.equal(question.used_mcp, 1);
  assert.equal(question.feedback_reason, "Wrong live source");
});
