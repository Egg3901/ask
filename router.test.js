"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const router = require("./router");

test("routes simple lookups to Flash", () => {
  const route = router.choose({ question: "How does cloture work?", length: "concise" });
  assert.equal(route.tier, "flash");
  assert.equal(route.label, "Flash");
  assert.equal(route.model, router.CHAINS.flash[0]);
});

test("every tier offers a fallback beyond its first choice", () => {
  for (const tier of router.TIERS) {
    assert.ok(router.CHAINS[tier].length >= 2, `${tier} chain needs a fallback`);
    assert.equal(new Set(router.CHAINS[tier]).size, router.CHAINS[tier].length, `${tier} chain repeats a model`);
  }
});

test("production overrides cannot replace the paid last-resort model", () => {
  const models = require("./models");
  assert.deepEqual(
    models.ensureBackstop(["deepseek-v4-flash:cloud", "minimax/minimax-m3-free"]),
    ["deepseek-v4-flash:cloud", "minimax/minimax-m3-free", "deepseek-v4-flash"],
  );
});

test("a chain never ends on a model that failed every bench request", () => {
  const models = require("./models");
  for (const tier of router.TIERS) {
    for (const id of router.CHAINS[tier]) {
      assert.ok(!models.EXCLUDED[id], `${id} is excluded but still routed`);
      assert.ok(models.CATALOG[id], `${id} is routed but unscored`);
    }
    // Every link has to have actually answered in the bench. With no paid
    // backstop in the default chain, an unscored or 429-dead entry here is the
    // difference between a slow answer and no answer at all.
    for (const id of router.CHAINS[tier]) {
      assert.ok(models.CATALOG[id].score > 0, `${id} is routed but scored 0`);
    }
    // DeepSeek Flash is the only paid model left in the defaults.
    const paid = router.CHAINS[tier].filter(id => models.CATALOG[id].provider === "deepseek");
    assert.deepEqual(paid, ["deepseek-v4-flash"], `${tier} must fall back to DeepSeek Flash only`);
  }
});

test("routes cross-system analysis to Pro", () => {
  assert.equal(router.choose({
    question: "Why did tariffs affect my corporation and the wider economy this turn?",
    length: "standard", useMcp: true,
  }).tier, "pro");
});

test("routes verification and causal autopsy through a reasoning model", () => {
  for (const question of [
    "Verify the previous answer",
    "Run a causal autopsy on my inflation spike",
    "What is the root cause of this price collapse?",
  ]) {
    assert.equal(router.choose({ question, useMcp: true }).tier, "pro", question);
  }
});

test("length does not touch routing: it says how much to write, not how hard to think", () => {
  // These were one control and are now two. Asking for a long answer used to add
  // 6 to the score and drag a simple lookup onto a reasoning model; asking for a
  // short one made a genuinely hard question cheap.
  const q = "How do actions work?";
  const base = router.choose({ question: q }).tier;
  for (const length of ["concise", "standard", "deep"]) {
    assert.equal(router.choose({ question: q, length }).tier, base, `${length} must not change the tier`);
  }
  // The same holds for a question that genuinely earns a reasoning tier.
  const hard = "Why does inflation interact with the central bank prime rate across turns?";
  const hardBase = router.choose({ question: hard }).tier;
  assert.equal(router.choose({ question: hard, length: "concise" }).tier, hardBase,
    "a concise answer to a hard question is still the hard question");
});

test("an explicit effort overrides routing, and only staff ever send one", () => {
  const q = "How do actions work?";
  assert.equal(router.choose({ question: q, effort: "quick" }).tier, "flash");
  assert.equal(router.choose({ question: q, effort: "balanced" }).tier, "pro");
  assert.equal(router.choose({ question: q, effort: "thorough" }).tier, "deep");
  assert.ok(router.choose({ question: q, effort: "thorough" }).reasons.includes("thorough requested"));
  // Auto and an unknown value both fall back to routing from the question.
  const auto = router.choose({ question: q }).tier;
  assert.equal(router.choose({ question: q, effort: "auto" }).tier, auto);
  assert.equal(router.choose({ question: q, effort: "nonsense" }).tier, auto);
  assert.equal(router.choose({ question: q, effort: "nonsense" }).effortChoice, "auto");
  // A report is a multi-section deliverable; "quick" cannot produce one.
  assert.equal(router.choose({ question: "Generate a report on the economy", report: true, effort: "quick" }).tier, "deep");
});

test("deep tier is reserved for multi-part responses and reports; nothing else", () => {
  // A genuine multi-part question takes deep (Ox Alpha).
  const multi = router.choose({ question: "1. How is inflation calculated? 2. What is the current rate?" });
  assert.equal(multi.tier, "deep");
  assert.ok(multi.reasons.includes("multi-part"));
  // An explicit report is a multi-section deliverable -> deep.
  const rep = router.choose({ question: "Generate a report on the economy", report: true });
  assert.equal(rep.tier, "deep");
  // A single visualization request goes to pro (Mimo), not the slow deep tier.
  const viz = router.choose({ question: "Chart my GDP", length: "concise", visualizations: true });
  assert.equal(viz.tier, "pro");
  assert.ok(viz.reasons.includes("visualization"));
});

test("a mode-selected evidence synthesis gets the pro reasoning tier", () => {
  const route = router.choose({ question: "Check the timing", specialist: true });
  assert.equal(route.tier, "pro");
  assert.ok(route.reasons.includes("specialist evidence synthesis"));
});

test("exposes a stable display label for stored model ids", () => {
  assert.equal(router.label("deepseek-v4-flash"), "Flash");
  assert.equal(router.label("deepseek-v4-pro"), "Pro");
  assert.equal(router.label(null), "Flash");
  // Routed ids carry no "pro"/"flash" substring, so the label comes from the catalog.
  assert.equal(router.label("nvidia/nemotron-3-ultra-550b-a55b:free"), "Pro");
  assert.equal(router.label("nvidia/nemotron-3.5-lightning:free"), "Flash");
  assert.equal(router.label("stealth/ox-alpha"), "Deep");
});

test("threads the selected model through streaming metadata and persistence", () => {
  const server = fs.readFileSync(require.resolve("./server"), "utf8");
  const llm = fs.readFileSync(require.resolve("./llm"), "utf8");

  assert.match(server, /chain: route\.chain/);
  assert.match(server, /model: route\.label/);
  assert.match(server, /model: cachedModel/);
  // What actually answered is persisted, not what routing first asked for.
  assert.match(server, /model: servedModel/);
  assert.match(llm, /model: id,/);
  // A fallback must never restart underneath tokens the player has already seen.
  assert.match(llm, /if \(emitted\.any\) break;/);
});

test("server cannot route an explicit candidate map request through code-only mode", () => {
  const server = fs.readFileSync(require.resolve("./server"), "utf8");
  assert.match(server, /plan\.live === "required" \|\| mcp\.requiresLive\(question\)/);
});

test("server validates and preserves the selected Ask mode", () => {
  const server = fs.readFileSync(require.resolve("./server"), "utf8");
  assert.match(server, /capabilities\.normalizeMode\(body\.mode\)/);
  assert.match(server, /capabilities\.modeIssue\(askMode, question\)/);
  assert.match(server, /askPlan\.create\(question, session\.context, askMode\)/);
});

test("deep answers get a wider evidence window and more of the thread", () => {
  const fs = require("node:fs");
  const server = fs.readFileSync(require.resolve("./server"), "utf8");
  // Every benched model scored 1-2 on grounding for the deep cross-system
  // question because four chunks could not cover three systems.
  assert.match(server, /const deepAnswer = route\.tier === "deep"/);
  assert.match(server, /deepAnswer \? \{ topK: DEEP_TOP_K, maxChars: DEEP_MAX_CHARS \} : \{\}/);
  assert.match(server, /deepAnswer \? DEEP_HISTORY_TURNS : 3/);

  const retrieve = fs.readFileSync(require.resolve("./retrieve"), "utf8");
  assert.match(retrieve, /maxChars = MAX_CHARS/);
  assert.match(retrieve, /let budget = maxChars;/);
});

test("escalate lifts an auto flash route to pro exactly once", () => {
  const flash = router.choose({ question: "what is a tariff?" });
  assert.equal(flash.tier, "flash");
  const up = router.escalate(flash, "retrieval came back thin");
  assert.equal(up.tier, "pro");
  assert.equal(up.escalated, "retrieval came back thin");
  assert.deepEqual(up.chain, router.CHAINS.pro);
  assert.ok(up.reasons.some(r => r.includes("escalated")));
  // Already pro: unchanged, same object.
  assert.equal(router.escalate(up, "again"), up);
});

test("escalate respects a staff-forced quick effort", () => {
  const forced = router.choose({ question: "why is the economy collapsing across every market?", effort: "quick" });
  assert.equal(forced.tier, "flash");
  assert.equal(router.escalate(forced, "thin"), forced);
});

test("a question that asks for a set routes up and is not answered in 220 words", () => {
  // The 2026-09-05 reports: "Too concise didn't answer fully", "Didn't explain
  // what they do", "Should've answered". All three asked for every member of a
  // set and got a flash answer that covered the first two.
  const coverage = [
    "what do different naval vessels actually do in game? Go over each one",
    "describe what different types of ships do in navies in game",
    "what does every type of naval vessel do in game and how do they differ?",
    "what is the benefit to aircraft carriers vs screening ships + submarines?",
    "list all the ways a bill can die",
  ];
  for (const question of coverage) {
    assert.equal(router.wantsCoverage(question), true, question);
    assert.equal(router.choose({ question }).tier === "flash", false, question);
  }
  // A point question is still a point question.
  for (const question of ["how does inflation work?", "what is the prime rate", "what type of bill is a budget?"]) {
    assert.equal(router.wantsCoverage(question), false, question);
  }
});
