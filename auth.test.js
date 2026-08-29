"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("./auth");

test("every signed-in player gets what the Supporter tier used to be", () => {
  const player = auth.entitlementFor({ username: "someone" });
  assert.equal(player.allowed, true);
  assert.equal(player.reason, "player");
  // The old Supporter budget, verbatim.
  assert.equal(player.questions, 5);
  assert.equal(player.mcp, 2);
});

test("supporting still buys the same multiple over the default", () => {
  const player = auth.entitlementFor({});
  for (const [tier, factor] of [["supporter", 2], ["supporter-plus", 4], ["supporter-plus-plus", 8]]) {
    const ent = auth.entitlementFor({ tierActive: true, tier });
    assert.equal(ent.allowed, true);
    assert.equal(ent.questions, player.questions * factor, `${tier} questions`);
    assert.ok(ent.mcp > player.mcp, `${tier} live budget must beat the default`);
  }
});

test("live data and visualizations are metered for every tier, not gated", () => {
  // They used to be a supporter flag. Every allowed tier now has some of each,
  // and supporting buys more rather than unlocking the feature at all.
  for (const ctx of [{}, { tierActive: true, tier: "supporter" }, { isAdmin: true }]) {
    const ent = auth.entitlementFor(ctx);
    assert.equal(ent.visualizations, true, `${ent.label} should be able to get a chart`);
    assert.ok(ent.viz > 0, `${ent.label} should have a visualization allowance`);
    assert.ok(ent.mcp > 0, `${ent.label} should have a live-data allowance`);
  }
  // A lapsed supporter drops to the player tier — with the player allowance,
  // not with the feature switched off.
  const lapsed = auth.entitlementFor({ tierActive: false, tier: "supporter-plus-plus" });
  assert.equal(lapsed.reason, "player");
  assert.equal(lapsed.viz, auth.PLAYER.viz);
  assert.equal(lapsed.visualizations, true);
});

test("supporting buys a strictly bigger allowance at every step", () => {
  const ladder = [auth.PLAYER, auth.TIERS.supporter, auth.TIERS["supporter-plus"], auth.TIERS["supporter-plus-plus"]];
  for (let i = 1; i < ladder.length; i++) {
    for (const k of ["questions", "mcp", "viz"]) {
      assert.ok(ladder[i][k] > ladder[i - 1][k], `${k} must increase from ${ladder[i - 1].label} to ${ladder[i].label}`);
    }
  }
  // Charts are the slowest, least reliable path, so they stay the tightest budget.
  for (const t of ladder) assert.ok(t.viz <= t.questions, `${t.label} viz allowance must not exceed its questions`);
});

test("a blocked account gets no allowance of any kind", () => {
  for (const ctx of [null, { isBanned: true }]) {
    const ent = auth.entitlementFor(ctx);
    assert.equal(ent.allowed, false);
    assert.equal(ent.viz, 0);
    assert.equal(ent.mcp, 0);
    assert.equal(ent.visualizations, false);
  }
});

test("opening access does not open it to banned accounts or unverified callers", () => {
  assert.equal(auth.entitlementFor({ isBanned: true }).allowed, false);
  // No context is also what an ops-dash outage looks like, so it must fail closed.
  assert.equal(auth.entitlementFor(null).allowed, false);
  assert.equal(auth.entitlementFor(null).reason, "no-context");
});

test("the server downgrades the plan itself, not just the request flag", () => {
  const fs = require("node:fs");
  const server = fs.readFileSync(require.resolve("./server"), "utf8");
  // answer-guard injects a canonical map for a map plan regardless of the toggle,
  // so gating only the toggle would still hand out the withheld feature.
  assert.match(server, /if \(!vizAllowed && plan\.visual !== "none"\)/);
  assert.match(server, /visual: "none"/);
  assert.match(server, /id: `\$\{plan\.id\}-prose`/);
});
