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

test("deep answers and visualization requests both take the deep tier", () => {
  assert.equal(router.choose({ question: "How does inflation work?", length: "deep" }).tier, "deep");
  // A chart has to be built, not described, so it outranks the heuristic score.
  const viz = router.choose({ question: "Chart my GDP", length: "concise", visualizations: true });
  assert.equal(viz.tier, "deep");
  assert.ok(viz.reasons.includes("visualization"));
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
