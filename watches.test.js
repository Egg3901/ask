"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const watches = require("./watches");

test("watch commands parse deterministically", () => {
  const fx = watches.command("Watch USD/GBP and tell me when it crosses above 0.5");
  assert.deepEqual(fx, { action: "create", kind: "fx", params: { base: "USD", quote: "GBP", above: 0.5 } });
  const fxBelow = watches.command("alert me if GBP to USD drops below 1.9");
  assert.deepEqual(fxBelow.params, { base: "GBP", quote: "USD", below: 1.9 });
  const war = watches.command("let me know when there are new battles involving the US");
  assert.deepEqual(war, { action: "create", kind: "war", params: { country: "US" } });
  const bills = watches.command("watch for new bills in the United States and ping me when one appears");
  assert.deepEqual(bills, { action: "create", kind: "legislation", params: { country: "US" } });
  assert.deepEqual(watches.command("show my watches"), { action: "list" });
  assert.deepEqual(watches.command("delete watch #12"), { action: "delete", id: 12, all: false });
  assert.equal(watches.command("stop watching everything, remove all watches").all, true);
  // Not watch commands at all:
  assert.equal(watches.command("How does cloture work?"), null);
  assert.equal(watches.command("Who should I watch out for in the senate race?"), null);
  // A watch without a parsable target explains itself:
  assert.equal(watches.command("watch the economy and tell me when something happens").action, "reject");
  // FX without a threshold asks for one:
  assert.equal(watches.command("watch USD/GBP and tell me when it moves").action, "reject");
});

function fakeStore(rows) {
  const events = [];
  return {
    events,
    activeWatches: () => rows,
    updateWatchState: (id, state, fired) => { const r = rows.find(x => x.id === id); r.state = state; if (fired) r.last_fired = Date.now(); },
    addWatchEvent: (id, user, message) => events.push({ id, user, message }),
  };
}

test("fx watches fire exactly on a crossing", async () => {
  const row = { id: 1, user_key: "ahd:u1", kind: "fx", params: JSON.stringify({ base: "USD", quote: "GBP", above: 0.49 }), state: JSON.stringify({ lastValue: 0.485 }) };
  const store = fakeStore([row]);
  const call = async () => JSON.stringify({ current: { quotePerBase: 0.491 } });
  const out = await watches.checkAll({ store, call });
  assert.equal(out.fired, 1);
  assert.match(store.events[0].message, /crossed above 0\.49/);
  // Second tick above the line: no re-fire.
  const again = await watches.checkAll({ store, call });
  assert.equal(again.fired, 0);
});

test("war and legislation watches baseline first, then report only new items", async () => {
  const warRow = { id: 2, user_key: "ahd:u1", kind: "war", params: JSON.stringify({ country: "US" }), state: "{}" };
  const billRow = { id: 3, user_key: "ahd:u1", kind: "legislation", params: JSON.stringify({ country: "US" }), state: "{}" };
  const store = fakeStore([warRow, billRow]);
  let battles = [{ turn: 500 }];
  let bills = [{ id: "b1", title: "Tariff Act" }];
  const call = async (name) => name === "wars"
    ? JSON.stringify({ wars: [{ name: "German War", battles, goal: "US front" }] })
    : JSON.stringify({ bills });
  // First tick: learn the world, fire nothing.
  assert.equal((await watches.checkAll({ store, call })).fired, 0);
  battles = [{ turn: 500 }, { turn: 501 }];
  bills = [{ id: "b1", title: "Tariff Act" }, { id: "b2", title: "Grain Subsidy Act" }];
  const second = await watches.checkAll({ store, call });
  assert.equal(second.fired, 2);
  assert.match(store.events.find(e => e.id === 2).message, /1 new battle report involving US/);
  assert.match(store.events.find(e => e.id === 3).message, /Grain Subsidy Act/);
});

test("a failing tool never breaks the tick for other watches", async () => {
  const rows = [
    { id: 4, user_key: "ahd:u1", kind: "fx", params: JSON.stringify({ base: "AAA", quote: "BBB", above: 1 }), state: "{}" },
    { id: 5, user_key: "ahd:u1", kind: "legislation", params: JSON.stringify({ country: "US" }), state: JSON.stringify({ keys: [] }) },
  ];
  const store = fakeStore(rows);
  const call = async (name) => { if (name === "fx_quote") throw new Error("tool down"); return JSON.stringify({ bills: [{ id: "b9", title: "New Act" }] }); };
  const out = await watches.checkAll({ store, call, log: () => {} });
  assert.equal(out.checked, 2);
  assert.equal(out.fired, 1);
});

test("rendering reads like a product, not a debug dump", () => {
  const list = watches.renderList([{ id: 7, kind: "fx", params: JSON.stringify({ base: "USD", quote: "GBP", above: 0.5 }), last_fired: null }]);
  assert.match(list, /#7.*USD\/GBP crosses above 0\.5/);
  const events = watches.renderEvents([{ message: "USD/GBP crossed above 0.5: now 0.5010" }]);
  assert.match(events, /Your watches fired/);
  assert.equal(watches.renderEvents([]), "");
});

test("idiomatic and soft watch phrasings fall through to the normal pipeline", () => {
  assert.equal(watches.command("What should I watch out for when investing in corporations?"), null);
  assert.equal(watches.command("Which sectors should I watch if inflation rises?"), null);
  // Unmistakable subscriptions without a parsable target still get the capability list.
  assert.equal(watches.command("alert me when something big happens").action, "reject");
});
