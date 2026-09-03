"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const live = require("./live-intelligence");

// A player's peer-comparison question names the company first as often as
// last. Both shapes must resolve to the same corporation, or the live pass
// never looks it up and the answer becomes "I don't have that data".
test("peer comparisons name the corporation whichever side of the verb it sits", () => {
  const cases = [
    ["How does Value Mart compare with its closest public peers right now?", "Value Mart"],
    ["how does Tinky Winky Corporation stack up against its peers", "Tinky Winky"],
    ["Where does Lockheed Commerce stand relative to its main rivals?", "Lockheed Commerce"],
    ["Compare Value Mart with its closest public peers", "Value Mart"],
    ["compare Prime Mart to its peers", "Prime Mart"],
  ];
  for (const [question, expected] of cases) {
    const names = live.namedCorporations(question);
    assert.ok(names.includes(expected), `${question} -> ${JSON.stringify(names)}`);
  }
});

test("a generic peer question without a name still names nothing", () => {
  assert.deepEqual(live.namedCorporations("How do public peers compare on market cap?"), []);
});
