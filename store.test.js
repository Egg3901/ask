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

test("a private moderator turn durably revokes sharing", () => {
  recordAnswer({ conv_id: "conv-private", question: "Public setup" });
  const token = store.share("conv-private", "ahd:user-1");
  assert.ok(token);
  recordAnswer({
    conv_id: "conv-private",
    question: "Private moderator investigation",
    private: true,
  });
  assert.equal(store.shared(token), null);
  assert.equal(store.isPrivate("conv-private", "ahd:user-1"), true);
  assert.equal(store.share("conv-private", "ahd:user-1"), null);
  // Privacy follows the conversation even if authorization changes later.
  recordAnswer({ conv_id: "conv-private", question: "Later public question", private: false });
  assert.equal(store.isPrivate("conv-private", "ahd:user-1"), true);
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

test("persists serving telemetry and rolls it into per-model stats", () => {
  const ts = Date.now();
  recordAnswer({ model: "model-a", ttft_ms: 1000, total_ms: 5000, fell_through: null, ts });
  recordAnswer({ model: "model-a", ttft_ms: 3000, total_ms: 9000, fell_through: "model-b", ts });
  const stats = store.servingStats(ts - 1000).find(m => m.model === "model-a");
  assert.equal(stats.served, 2);
  assert.equal(stats.viaFallthrough, 1);
  assert.equal(stats.sampled, 2);
  assert.equal(stats.ttftP50, 3000);
  assert.equal(stats.ttftP90, 3000);
});

test("aggregates missed retrieval paths into a ranked work queue", () => {
  const ts = Date.now();
  const validation = JSON.stringify({ issues: [], grounding: [], inventedPaths: [], missedPaths: ["src/lib/turn/bondTurn.ts"] });
  recordAnswer({ validation, ts });
  recordAnswer({ validation, ts });
  recordAnswer({ validation: JSON.stringify({ issues: ["truncated"], missedPaths: ["src/lib/x.ts"] }), ts });
  const misses = store.retrievalMisses(ts - 1000);
  assert.equal(misses[0].path, "src/lib/turn/bondTurn.ts");
  assert.equal(misses[0].misses, 2);
  const issues = store.issueCounts(ts - 1000);
  assert.deepEqual(issues.find(i => i.issue === "truncated"), { issue: "truncated", n: 1 });
});

test("patches grounding flags into a stored row and evicts the cache entry", () => {
  const id = recordAnswer({ validation: JSON.stringify({ issues: [], grounding: [] }) });
  store.updateGrounding(id, ["invented a Phillips curve"]);
  const row = store.db.prepare("SELECT validation FROM asks WHERE id=?").get(id);
  assert.deepEqual(JSON.parse(row.validation).grounding, ["invented a Phillips curve"]);
  store.S.putCache.run("cache-key", "answer", "[]", "[]", "model-a", Date.now());
  store.evictCache("cache-key");
  assert.equal(store.S.getCache.get("cache-key"), undefined);
});

test("digest reports answers, corrections pipeline, and audit rollup in one shape", () => {
  const digest = store.digest(Date.now() - 60000);
  assert.ok(digest.answers.total >= 1);
  assert.ok(Array.isArray(digest.retrievalMisses));
  assert.ok(Array.isArray(digest.models));
  assert.equal(typeof digest.corrections.draftsPending, "number");
  assert.equal(typeof digest.audits.total, "number");
});

// ── Activity ────────────────────────────────────────────────────────────────
// "Active" is one sign-in or one question inside the trailing week. Both halves
// have to hold: a Discord player never loads a page, and a signed-in player
// re-reading old threads never records a question.

test("a sign-in with no question still counts the user as active", () => {
  store.touchUser("ahd:lurker", { provider: "ahd", id: "lurker", username: "Lurker" }, { username: "Lurker" });
  const act = store.activity({ days: 7 });
  assert.ok(act.active.keys.includes("ahd:lurker"));
  assert.ok(act.active.dau >= 1);
});

test("a Discord question counts as activity without any page load", () => {
  const id = store.recordDiscordAsk({ discordId: "d-77", username: "DiscordPlayer", question: "Who runs Steel?" });
  assert.ok(id);
  const act = store.activity({ days: 7 });
  assert.ok(act.active.keys.includes("discord:d-77"));
  assert.equal(act.active.byProvider.discord >= 1, true);
});

test("staff opening a profile does not manufacture an active user", () => {
  const key = "ahd:never-here";
  store.touchUser(key, { provider: "ahd", id: "never-here", username: "Absent" }, { username: "Absent" }, { activity: false });
  const act = store.activity({ days: 7 });
  assert.equal(act.active.keys.includes(key), false);
  const rows = store.db.prepare("SELECT COUNT(*) n FROM user_days WHERE user_key=?").get(key);
  assert.equal(rows.n, 0);
});

test("a quiet profile refresh leaves last_seen where it was", () => {
  const key = "ahd:stale";
  store.touchUser(key, { provider: "ahd", id: "stale", username: "Stale" }, { username: "Stale" });
  const before = store.db.prepare("SELECT last_seen FROM user_profiles WHERE user_key=?").get(key).last_seen;
  store.db.prepare("UPDATE user_profiles SET last_seen=? WHERE user_key=?").run(before - 30 * 86400000, key);
  store.touchUser(key, { provider: "ahd", id: "stale", username: "Stale" }, { username: "Stale", character: { country: "USA" } }, { activity: false });
  const row = store.db.prepare("SELECT last_seen, country FROM user_profiles WHERE user_key=?").get(key);
  assert.equal(row.last_seen, before - 30 * 86400000, "last_seen must not move");
  assert.equal(row.country, "USA", "profile facts must still refresh");
});

test("questions per day buckets by UTC day and covers every day in the range", () => {
  const act = store.activity({ days: 14 });
  assert.equal(act.series.length, 14);
  assert.equal(act.series[13].day, store.dayKey(Date.now()));
  assert.ok(act.series[13].questions >= 1);
  assert.equal(act.totals.questions, act.series.reduce((n, d) => n + d.questions, 0));
  assert.equal(Number(act.perDay.toFixed(4)), Number((act.totals.questions / 14).toFixed(4)));
});

test("weekly-active spans the window while daily-active does not", () => {
  const key = "ahd:eight-days-ago";
  const eightDaysAgo = Date.now() - 8 * 86400000;
  store.markActive(key, "visit", eightDaysAgo);
  const act = store.activity({ days: 14 });
  const then = act.series.find(d => d.day === store.dayKey(eightDaysAgo));
  assert.ok(then.dau >= 1, "active on the day it happened");
  assert.equal(act.active.keys.includes(key), false, "but outside the trailing week");
  // It should still be inside the 7-day rolling count on the days right after.
  const twoDaysLater = act.series.find(d => d.day === store.dayKey(eightDaysAgo + 2 * 86400000));
  assert.ok(twoDaysLater.wau >= then.dau);
});

test("presence is recorded once per user per day, however many questions they ask", () => {
  const key = "ahd:chatty";
  store.markActive(key, "visit");
  store.markActive(key, "ask");
  store.markActive(key, "ask");
  const n = store.db.prepare("SELECT COUNT(*) n FROM user_days WHERE user_key=?").get(key).n;
  assert.equal(n, 1);
  assert.equal(store.db.prepare("SELECT source FROM user_days WHERE user_key=?").get(key).source, "visit");
});

test("the digest carries the audience numbers the weekly post needs", () => {
  const d = store.digest(Date.now() - 7 * 86400000);
  assert.equal(typeof d.audience.active, "number");
  assert.equal(typeof d.audience.questionsPerDay, "number");
  assert.equal(typeof d.audience.activeToday, "number");
  assert.ok(d.audience.active >= d.audience.activeToday);
});

test("tokens are counted per day and carried into a running lifetime total", () => {
  const ts = Date.now();
  recordAnswer({ ts, tokens_in: 1200, tokens_out: 400, cached: 0 });
  recordAnswer({ ts, tokens_in: 800, tokens_out: 100, cached: 0 });
  const act = store.activity({ days: 3 });
  const today = act.series[act.series.length - 1];
  assert.ok(today.tokensIn >= 2000 && today.tokensOut >= 500);
  assert.equal(today.tokens, today.tokensIn + today.tokensOut);
  assert.equal(today.tokensCumulative, act.tokens.allTime, "the last day of the range IS the lifetime total");
  assert.equal(act.tokens.allTime, act.tokens.beforeWindow + act.totals.tokens);
  // The running total never goes backwards.
  for (let i = 1; i < act.series.length; i++) assert.ok(act.series[i].tokensCumulative >= act.series[i - 1].tokensCumulative);
});

test("a cached answer bills no tokens", () => {
  const before = store.activity({ days: 1 }).tokens.allTime;
  recordAnswer({ ts: Date.now(), tokens_in: 9999, tokens_out: 9999, cached: 1 });
  assert.equal(store.activity({ days: 1 }).tokens.allTime, before);
});

// ── Staff review queue ──────────────────────────────────────────────────────
// "Already looked at" is three separate things and the queue must exclude all
// three, or reviewers re-judge work the sampler or a player already did.
// Every fixture carries a real answer body: with a stub body the row is
// excluded for being empty, and the exclusion under test never runs.
const BODY = "Inflation is recomputed every turn in the inflationRecalc phase, after the metric engine has run.";

function reviewable(overrides = {}) {
  return recordAnswer({ answer: BODY, ts: Date.now(), ...overrides });
}
const inQueue = id => store.reviewQueue({ limit: 500 }).some(c => c.id === id);

test("an unjudged answer with a real body is in the queue", () => {
  assert.ok(inQueue(reviewable({ question: "Plain unjudged answer" })));
});

test("the queue skips anything a player already rated", () => {
  const id = reviewable({ question: "Player rated this" });
  assert.ok(inQueue(id), "in the queue until the player speaks");
  store.feedback({ answerId: id, userKey: "ahd:user-1", rating: "up" });
  assert.equal(inQueue(id), false);
});

test("the queue skips anything the QA sampler already graded", () => {
  const id = reviewable({ question: "Sampler graded this" });
  assert.ok(inQueue(id), "in the queue until the sampler grades it");
  store.recordAudit({ answerId: id, question: "Sampler graded this", answered: 1, model: "judge" });
  assert.equal(inQueue(id), false);
});

test("the queue skips answers with no body to judge", () => {
  const id = recordAnswer({ question: "Generation failed", answer: "", ts: Date.now() });
  assert.equal(inQueue(id), false);
  assert.ok(store.reviewCounts().emptyAnswers >= 1, "but they are still counted, not hidden");
});

test("a skip counts as looked-at without becoming a verdict", () => {
  const id = reviewable({ question: "Skip me" });
  assert.ok(inQueue(id));
  const before = store.reviewCounts();
  store.saveReview({ answerId: id, rating: null, by: "staff" });
  const after = store.reviewCounts();
  assert.equal(inQueue(id), false, "it does not come back around");
  assert.equal(after.skipped, before.skipped + 1);
  assert.equal(after.good, before.good);
  assert.equal(after.bad, before.bad);
  assert.equal(after.pending, before.pending - 1);
});

test("undo puts a card back exactly where it was", () => {
  const id = reviewable({ question: "Misfire" });
  store.saveReview({ answerId: id, rating: "bad", note: "wrong", by: "staff" });
  assert.equal(inQueue(id), false);
  assert.ok(store.clearReview(id));
  const back = store.reviewQueue({ limit: 500 }).find(c => c.id === id);
  assert.ok(back, "it is back in the queue");
  assert.equal(back.review_rating, null);
  assert.equal(back.review_note, null);
});

test("a staff verdict never contaminates the player-feedback signal", () => {
  const id = reviewable({ question: "Staff judged only" });
  store.saveReview({ answerId: id, rating: "bad", note: "wrong numbers", by: "staff" });
  const row = store.reviewRow(id);
  assert.equal(row.review_rating, "bad");
  assert.equal(row.review_by, "staff");
  assert.equal(row.feedback_rating, null, "the player never said anything, and the row must not pretend otherwise");
});

test("a rating that is neither good nor bad is refused", () => {
  const id = reviewable({ question: "Bad input" });
  assert.equal(store.saveReview({ answerId: id, rating: "terrible" }), null);
  assert.equal(store.saveReview({ answerId: "not-a-number", rating: "good" }), null);
  assert.ok(inQueue(id), "a refused verdict leaves the card alone");
});

test("the queue can be worked oldest-first for a backlog", () => {
  const newest = store.reviewQueue({ limit: 5 });
  const oldest = store.reviewQueue({ limit: 5, oldestFirst: true });
  assert.ok(newest.length && oldest.length);
  assert.ok(newest[0].ts >= oldest[0].ts);
  for (let i = 1; i < oldest.length; i++) assert.ok(oldest[i].ts >= oldest[i - 1].ts);
});

test("the linear feed is newest first and filterable", () => {
  const older = reviewable({ question: "Older question", ts: Date.now() - 60000 });
  const newer = reviewable({ question: "Newer question" });
  const feed = store.recentQuestions({ limit: 500 });
  assert.ok(feed.rows.findIndex(r => r.id === newer) < feed.rows.findIndex(r => r.id === older), "newest first");
  for (let i = 1; i < feed.rows.length; i++) assert.ok(feed.rows[i - 1].ts >= feed.rows[i].ts, "monotonically older");

  store.saveReview({ answerId: newer, rating: "good", by: "staff" });
  assert.ok(store.recentQuestions({ limit: 500, state: "good" }).rows.some(r => r.id === newer));
  assert.equal(store.recentQuestions({ limit: 500, state: "pending" }).rows.some(r => r.id === newer), false);
  assert.ok(store.recentQuestions({ limit: 500, search: "Older question" }).rows.some(r => r.id === older));
  assert.equal(store.recentQuestions({ limit: 500, search: "no-such-text-anywhere" }).total, 0);
});

test("the feed pages without dropping or repeating a row", () => {
  const all = store.recentQuestions({ limit: 500 });
  const first = store.recentQuestions({ limit: 3, offset: 0 });
  const second = store.recentQuestions({ limit: 3, offset: 3 });
  assert.equal(first.total, all.total, "the total is the whole set, not the page");
  assert.equal(first.rows.length, 3);
  const ids = new Set(first.rows.map(r => r.id));
  assert.equal(second.rows.some(r => ids.has(r.id)), false, "page two does not repeat page one");
  assert.deepEqual(second.rows.map(r => r.id), all.rows.slice(3, 6).map(r => r.id));
});

test("the feed shows everything the review queue deliberately hides", () => {
  const id = reviewable({ question: "Judged and therefore hidden from review" });
  store.saveReview({ answerId: id, rating: "good", by: "staff" });
  assert.equal(inQueue(id), false);
  assert.ok(store.recentQuestions({ limit: 500 }).rows.some(r => r.id === id), "but the linear screen still has it");
});

// ── Visualization allowance ─────────────────────────────────────────────────

test("the visualization allowance is only charged when a chart was delivered", () => {
  const ent = { questions: 10, mcp: 4, viz: 2 };
  const before = store.usage("ahd:user-1", ent).vizUsed;
  const asked = recordAnswer({ question: "Chart me", answer: BODY, ts: Date.now() });
  assert.equal(store.usage("ahd:user-1", ent).vizUsed, before, "asking is not charging");
  store.markVizUsed(asked);
  const after = store.usage("ahd:user-1", ent);
  assert.equal(after.vizUsed, before + 1);
  assert.equal(after.vizLimit, 2);
  assert.equal(after.vizRemaining, Math.max(0, 2 - after.vizUsed));
});

test("the visualization allowance never reports a negative remainder", () => {
  const tiny = { questions: 10, mcp: 4, viz: 1 };
  for (let i = 0; i < 3; i++) store.markVizUsed(recordAnswer({ answer: BODY, ts: Date.now() }));
  const u = store.usage("ahd:user-1", tiny);
  assert.ok(u.vizUsed >= 3);
  assert.equal(u.vizRemaining, 0);
});

test("an answer that never read live data does not spend the live allowance", () => {
  const ent = { questions: 10, mcp: 4, viz: 2 };
  const before = store.usage("ahd:user-1", ent).mcpUsed;
  // Live mode on, but the answer came entirely from code: used_mcp stays 0.
  recordAnswer({ question: "Answered from code", answer: BODY, used_mcp: 0, ts: Date.now() });
  assert.equal(store.usage("ahd:user-1", ent).mcpUsed, before);
  // An answer that really read the world does spend one.
  recordAnswer({ question: "Answered from live state", answer: BODY, used_mcp: 1, ts: Date.now() });
  assert.equal(store.usage("ahd:user-1", ent).mcpUsed, before + 1);
});

test("a downvote can evict every cached variant of the question", () => {
  const now = Date.now();
  store.S.putCache.run("game:ahd|plan:general|standard|standard|viz:0|how does cloture work", "a", "[]", "[]", "m", now);
  store.S.putCache.run("game:ahd|plan:general|technical|deep|viz:1|how does cloture work", "b", "[]", "[]", "m", now);
  store.S.putCache.run("game:ahd|plan:general|standard|standard|viz:0|how do tariffs work", "c", "[]", "[]", "m", now);
  const evicted = store.evictCacheByQuestion("How does cloture work?");
  assert.equal(evicted, 2);
  assert.equal(store.S.getCache.get("game:ahd|plan:general|standard|standard|viz:0|how do tariffs work").answer, "c");
  // LIKE metacharacters in a question must not widen the delete.
  store.S.putCache.run("game:ahd|plan:general|standard|standard|viz:0|what is 100% mobilization", "d", "[]", "[]", "m", now);
  assert.equal(store.evictCacheByQuestion("what is 100_ mobilization"), 0);
  assert.equal(store.evictCacheByQuestion("What is 100% mobilization?"), 1);
});

test("the health digest names open doc conflicts instead of only counting them", () => {
  store.recordConflicts([{ source: "wiki", page: "Cloture", claim: "needs 60 votes", actual: "3/5 of votes cast", evidence: "billLifecycle.ts" }], { question: "q", user_key: "ahd:user-1" });
  const digest = store.digest(Date.now() - 86400000);
  assert.ok(digest.docConflictsOpen >= 1);
  const named = digest.docConflicts.find(c => c.claim.includes("60 votes"));
  assert.ok(named);
  assert.equal(named.actual, "3/5 of votes cast");
  assert.equal(named.source, "wiki");
});

test("replay candidates capture downvoted and flagged answers with their defects", () => {
  const flaggedId = recordAnswer({
    question: "Why did my approval crash after the tariff bill?",
    validation: JSON.stringify({ issues: ["truncated"], grounding: [] }),
    plan: JSON.stringify({ id: "general", intent: "general" }),
  });
  const downId = recordAnswer({
    question: "How do bond coupons pay out?",
    validation: JSON.stringify({ issues: [] }),
  });
  store.feedback({ answerId: downId, userKey: "ahd:user-1", rating: "down", reason: "wrong payout schedule" });
  const candidates = store.replayCandidates(Date.now() - 60000);
  const flagged = candidates.find(c => c.answerId === flaggedId);
  assert.ok(flagged);
  assert.deepEqual(flagged.issues, ["truncated"]);
  assert.equal(flagged.observedIntent, "general");
  const down = candidates.find(c => c.answerId === downId);
  assert.ok(down);
  assert.equal(down.rating, "down");
  assert.equal(down.reason, "wrong payout schedule");
  assert.match(down.name, /^how-do-bond-coupons/);
  // A clean, unrated answer is not a candidate.
  const cleanId = recordAnswer({ question: "clean answer", validation: JSON.stringify({ issues: [] }) });
  assert.ok(!store.replayCandidates(Date.now() - 60000).some(c => c.answerId === cleanId));
  // The pipeline WORKING is not a defect: escalation, revision, healing and
  // canonical contracts must not flood the curation queue.
  const workingId = recordAnswer({ question: "escalated fine answer", validation: JSON.stringify({ issues: ["escalated_tier", "grounding_revised", "canonical_answer_contract"] }) });
  assert.ok(!store.replayCandidates(Date.now() - 60000).some(c => c.answerId === workingId));
  // An invented path is a defect even with no issue codes.
  const inventedId = recordAnswer({ question: "invented path answer", validation: JSON.stringify({ issues: [], inventedPaths: ["src/lib/madeUp.ts"] }) });
  assert.ok(store.replayCandidates(Date.now() - 60000).some(c => c.answerId === inventedId));
});

test("the digest carries embedding health when the server injects it", () => {
  const health = { ok: false, error: "embed 404", checkedAt: Date.now() };
  store.setEmbedHealth(health);
  const digest = store.digest(Date.now() - 60000);
  assert.equal(digest.embedding.ok, false);
  assert.equal(digest.embedding.error, "embed 404");
  store.setEmbedHealth(null);
  assert.equal(store.digest(Date.now() - 60000).embedding, null);
});

test("watch CRUD enforces the cap and delivers events exactly once", () => {
  for (let i = 0; i < 5; i++) {
    assert.ok(store.createWatch("ahd:watcher", "fx", { base: "USD", quote: "GBP", above: 1 }, 5).id);
  }
  assert.match(store.createWatch("ahd:watcher", "fx", {}, 5).error, /limit 5/);
  const list = store.listWatches("ahd:watcher");
  assert.equal(list.length, 5);
  store.addWatchEvent(list[0].id, "ahd:watcher", "USD/GBP crossed above 1");
  const events = store.takeWatchEvents("ahd:watcher");
  assert.equal(events.length, 1);
  assert.equal(store.takeWatchEvents("ahd:watcher").length, 0);
  assert.ok(store.deleteWatch("ahd:watcher", list[0].id));
  assert.equal(store.deleteAllWatches("ahd:watcher"), 4);
  assert.equal(store.listWatches("ahd:watcher").length, 0);
});

// ── Retrieval feedback loop ─────────────────────────────────────────────────

const validationWith = (extra = {}) => JSON.stringify({ plan: "general", issues: [], grounding: [], inventedPaths: [], missedPaths: [], ...extra });
const attributionOf = (coverage, total = 8) => ({ attribution: { coverage, total, supported: Math.round(coverage * total), semantic: true, weak: [], sentences: [] } });

test("retrieval misses rank by misses x (1 + reports) x (1 - coverage), with the raw count still available", () => {
  const since = Date.now() - 1;
  // Three well-supported, unreported misses of one path...
  for (let i = 0; i < 3; i++) recordAnswer({ question: `well supported miss ${i}`, validation: validationWith({ missedPaths: ["src/lib/turn/quiet.ts"], ...attributionOf(0.9) }) });
  // ...against one poorly supported miss of another path that a player reported.
  const loud = recordAnswer({ question: "poorly supported miss", validation: validationWith({ missedPaths: ["src/lib/turn/loud.ts"], ...attributionOf(0.2) }) });
  store.feedback({ answerId: loud, userKey: "ahd:user-1", rating: "down", reason: "wrong" });
  // And one with no attribution at all, which sits at the neutral 0.5.
  recordAnswer({ question: "unmeasured miss", validation: validationWith({ missedPaths: ["src/lib/turn/unmeasured.ts"] }) });

  const byPriority = store.retrievalMisses(since, 10);
  assert.deepEqual(byPriority.map(r => r.path), ["src/lib/turn/loud.ts", "src/lib/turn/unmeasured.ts", "src/lib/turn/quiet.ts"]);
  assert.equal(byPriority[0].priority, 1.6);
  assert.equal(byPriority[0].downvotes, 1);
  assert.equal(byPriority[0].meanCoverage, 0.2);
  assert.equal(byPriority[1].priority, 0.5);
  assert.equal(byPriority[1].meanCoverage, null);
  assert.equal(byPriority[2].priority, 0.3);
  assert.equal(byPriority[2].misses, 3);

  const byCount = store.retrievalMisses(since, 10, { order: "count" });
  assert.equal(byCount[0].path, "src/lib/turn/quiet.ts");
  assert.equal(byCount[0].misses, 3);
  assert.equal(store.digest(since, { missOrder: "count" }).missOrder, "count");
  assert.equal(store.digest(since).retrievalMisses[0].path, "src/lib/turn/loud.ts");
});

test("retrieval confidence recorded on each answer rolls up as percentiles", () => {
  const since = Date.now() - 1;
  for (let i = 1; i <= 5; i++) {
    recordAnswer({ question: `confidence ${i}`, validation: validationWith({ retrieval: { top1: i / 10, gap15: 0.05, overlap: null, nHits: i, budgetUsed: 0.5, chunkLenP50: 1000 } }) });
  }
  recordAnswer({ question: "no retrieval block", validation: validationWith() });
  const d = store.retrievalDistribution(since);
  assert.equal(d.n, 5);
  assert.equal(d.top1.n, 5);
  assert.equal(d.top1.p50, 0.3);
  assert.equal(d.nHits.p90, 5);
  assert.equal(d.overlap.n, 0);
  assert.equal(store.digest(since).retrieval.n, 5);
});

test("the taxonomy buckets flagged and reported answers, and caches helper verdicts per answer id", () => {
  const since = Date.now() - 1;
  recordAnswer({ question: "clean answer", validation: validationWith({ issues: ["escalated_tier"] }) });
  recordAnswer({ question: "path never supplied", validation: validationWith({ missedPaths: ["src/lib/turn/x.ts"] }) });
  const bare = recordAnswer({ question: "reported with no other signal", validation: validationWith() });
  store.feedback({ answerId: bare, userKey: "ahd:user-1", rating: "down", reason: "just wrong" });
  recordAnswer({ question: "discord row is excluded", model: "discord-ask", validation: validationWith({ issues: ["truncated"] }) });

  let t = store.taxonomy(since);
  assert.equal(t.total, 2);
  assert.equal(t.buckets.retrieval_miss.count, 1);
  assert.equal(t.buckets.unknown.count, 1);
  assert.equal(t.buckets.unknown.questions[0].answerId, bare);

  assert.equal(store.putAnswerBucket({ answerId: bare, bucket: "synthesis_miss", method: "helper", model: "helper-chain", note: "misread" }), true);
  assert.equal(store.putAnswerBucket({ answerId: bare, bucket: "not_a_bucket" }), false);
  assert.equal(store.answerBuckets([bare]).get(bare).bucket, "synthesis_miss");
  assert.equal(store.answerBuckets([]).size, 0);
  t = store.taxonomy(since);
  assert.equal(t.buckets.unknown.count, 0);
  assert.equal(t.buckets.synthesis_miss.count, 1);
  assert.equal(t.byHelper, 1);
  const summary = store.digest(since).taxonomy;
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.buckets.synthesis_miss.examples, ["reported with no other signal"]);
});

test("judge calibration cross-tabulates the automated verdict against human verdicts and stores the week", () => {
  const since = Date.now() - 1;
  const a = recordAnswer({ question: "flagged and reported", validation: validationWith({ issues: ["truncated"] }) });
  store.feedback({ answerId: a, userKey: "ahd:user-1", rating: "down" });
  recordAnswer({ question: "flagged, nobody minded", validation: validationWith({ grounding: ["x"] }) });
  const c = recordAnswer({ question: "clean but reported", validation: validationWith() });
  store.feedback({ answerId: c, userKey: "ahd:user-1", rating: "down" });
  const d = recordAnswer({ question: "clean and liked", validation: validationWith() });
  store.feedback({ answerId: d, userKey: "ahd:user-1", rating: "up" });
  recordAnswer({ question: "clean, unrated", validation: validationWith() });

  const cal = store.judgeCalibration(since);
  assert.equal(cal.n, 5);
  assert.deepEqual(cal.matrix, { flaggedAndReported: 1, flaggedNotReported: 1, cleanButReported: 1, cleanNotReported: 2 });
  assert.equal(cal.nRated, 3);
  assert.equal(cal.recall, 0.5);
  assert.equal(cal.precision, 0.5);
  assert.equal(store.saveCalibration(cal, { week: "2026-W36" }), true);
  assert.equal(store.saveCalibration({ ...cal, kappa: 0.5 }, { week: "2026-W35" }), true);
  const history = store.calibrationHistory(8);
  assert.deepEqual(history.map(h => h.week), ["2026-W36", "2026-W35"]);
  assert.equal(history[1].kappa, 0.5);
  assert.deepEqual(history[0].matrix.all, cal.matrix);
  // Re-running a week replaces its row rather than adding one.
  store.saveCalibration({ ...cal, kappa: 0.1 }, { week: "2026-W36" });
  assert.equal(store.calibrationHistory(8).length, 2);
  assert.equal(store.calibrationHistory(1)[0].kappa, 0.1);
  assert.equal(store.digest(since).calibration.history.length, 2);
});

test("pending correction drafts are counted and named in the digest", () => {
  store.db.exec("DELETE FROM corrections");
  const ins = store.db.prepare("INSERT INTO corrections(question,correction,source_answer_id,added_by,active,created) VALUES(?,?,?,?,?,?)");
  ins.run("first draft", "[DRAFT] Needs staff review", 1, "auto", 0, 1000);
  ins.run("second draft", "[DRAFT] Proposed (auto, unverified): x", 2, "auto", 0, 2000);
  ins.run("active lesson", "truth", null, "staff", 1, 3000);
  const d = store.digest(Date.now() - 864e5);
  assert.equal(d.corrections.draftsPending, 2);
  assert.equal(d.corrections.active, 1);
  assert.deepEqual(d.corrections.drafts.map(x => [x.question, x.proposed]), [["first draft", false], ["second draft", true]]);
});

test("cache rows carry a vector once set and can be evicted by key", () => {
  store.db.exec("DELETE FROM answer_cache");
  store.S.putCache.run("game:ahd|plan:general|plain|standard|viz:0|q one", "a", "[]", "[]", "m", Date.now());
  store.S.putCache.run("game:ahd|plan:general|plain|standard|viz:0|q two", "a", "[]", "[]", "m", Date.now());
  assert.deepEqual(store.cacheRows().map(r => r.vec), [null, null]);
  store.setCacheVec("game:ahd|plan:general|plain|standard|viz:0|q one", Float32Array.from([1, 0]));
  const row = store.cacheRows().find(r => r.q.endsWith("q one"));
  assert.equal(new Float32Array(row.vec.buffer, row.vec.byteOffset, 2)[0], 1);
  assert.equal(store.evictCacheKeys(["game:ahd|plan:general|plain|standard|viz:0|q two", "missing"]), 1);
  assert.equal(store.cacheRows().length, 1);
});
