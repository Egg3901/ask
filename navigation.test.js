"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nav = require("./navigation");

test("recognises the question shapes that got invented UI answers", () => {
  // Every one of these was asked by a real player and answered with a guess.
  for (const q of [
    "Where do I find these buttons",
    "which category is the state redistricting authority bill in",
    "I don't see the governance category",
    "where in the UI",
    "How do i set my constituency in the UK again",
    "i see no bill called us state redistricting authority",
  ]) {
    assert.equal(nav.isNavigationQuestion(q), true, q);
  }
});

test("leaves mechanics questions alone", () => {
  for (const q of [
    "How is GDP growth calculated each turn?",
    "What is driving inflation in US right now?",
    "What is the current DISSOLUTION_SECTOR_SALVAGE_FRACTION value?",
    "Why did my corporation lose money?",
  ]) {
    assert.equal(nav.isNavigationQuestion(q), false, q);
    assert.equal(nav.block(q), "");
  }
});

test("extracts label and route pairs in either declaration order", () => {
  const forward = nav.extract('{ label: "Active legislation", labelKey: "x", href: "/congress?tab=legislation" }');
  assert.deepEqual(forward, [{ label: "Active legislation", href: "/congress?tab=legislation" }]);
  const reversed = nav.extract('{ href: "/world/crises", label: "Crises" }');
  assert.deepEqual(reversed, [{ label: "Crises", href: "/world/crises" }]);
});

test("never emits a raw template interpolation to a player", () => {
  const built = nav.extract("{ label: \"My Corporation\", href: `/corporation/${myCorporationId}` }");
  assert.deepEqual(built, [{ label: "My Corporation", href: "/corporation/:id" }]);
});

test("drops entries whose route is not a real path", () => {
  assert.deepEqual(nav.extract('{ label: "Computed", href: someVariable }'), []);
  assert.deepEqual(nav.extract('{ label: "Relative", href: "elections" }'), []);
});
