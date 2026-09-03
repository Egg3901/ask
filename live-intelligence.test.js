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

test("a name registered in several countries is traced per country, not declared missing", async () => {
  const calls = [];
  const callTool = async (tool, args) => {
    calls.push([tool, args]);
    if (tool === "entity_search") return JSON.stringify({ results: [
      { type: "corporation", id: "it1", name: "Value Mart", score: 1, countryId: "IT", public: true },
      { type: "corporation", id: "fi1", name: "Value Mart", score: 1, countryId: "FI", public: true },
    ] });
    if (tool === "trace_corp") return JSON.stringify({ corporation: { name: "Value Mart", countryId: args.corporation === "it1" ? "IT" : "FI" } });
    return null;
  };
  const trace = await live.resolveCorporation("Value Mart", callTool);
  assert.equal(trace.ambiguous, undefined);
  assert.match(trace.resolved, /2 corporations of that name/);
  assert.match(trace.result, /Value Mart \(IT\)/);
  assert.match(trace.result, /Value Mart \(FI\)/);
  assert.equal(calls.filter(([tool]) => tool === "trace_corp").length, 2);
});

test("genuinely different tied names stay ambiguous and carry their countries", async () => {
  const callTool = async (tool) => tool === "entity_search" ? JSON.stringify({ results: [
    { type: "corporation", id: "a", name: "Prime Mart", score: 0.8, countryId: "US", public: true },
    { type: "corporation", id: "b", name: "Prima Mart", score: 0.79, countryId: "AT", public: true },
  ] }) : null;
  const trace = await live.resolveCorporation("Prim Mart", callTool);
  assert.deepEqual(trace.ambiguous, ["Prime Mart (US)", "Prima Mart (AT)"]);
});
