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

test("visualizations are a supporter feature, not a player one", () => {
  assert.equal(auth.entitlementFor({}).visualizations, false);
  assert.equal(auth.entitlementFor({ tierActive: true, tier: "supporter" }).visualizations, true);
  assert.equal(auth.entitlementFor({ isAdmin: true }).visualizations, true);
  // A lapsed supporter drops to the player tier, visualizations included.
  const lapsed = auth.entitlementFor({ tierActive: false, tier: "supporter-plus-plus" });
  assert.equal(lapsed.reason, "player");
  assert.equal(lapsed.visualizations, false);
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
