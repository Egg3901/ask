"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const playbooks = require("./playbooks");

test("wealth trend questions get the portfolio-series method", () => {
  const hit = playbooks.matches("why has my net worth dropped over the last 20 turns?");
  assert.ok(hit.some(p => p.id === "wealth_trend"));
});

test("country macro questions get the state-keyed-series method", () => {
  const hit = playbooks.matches("what is unemployment in France right now?");
  assert.ok(hit.some(p => p.id === "regional_macro"));
});

test("market share questions get the denominator method", () => {
  const hit = playbooks.matches("what market share could I get selling steel?");
  assert.ok(hit.some(p => p.id === "market_share"));
});

test("war strength questions get the fog-of-war method", () => {
  const hit = playbooks.matches("who is winning the war between Germany and Poland?");
  assert.ok(hit.some(p => p.id === "war_status"));
});

test("disputed election questions get the trace-the-race method", () => {
  const hit = playbooks.matches("why did I lose my senate seat, this election was wrong");
  assert.ok(hit.some(p => p.id === "election_result"));
});

test("causal economy questions get the timeline-first method", () => {
  const hit = playbooks.matches("why is inflation spiking in my country?");
  assert.ok(hit.some(p => p.id === "economy_causal"));
});

test("plain mechanics lookups match nothing", () => {
  assert.strictEqual(playbooks.matches("how do I create a party?").length, 0);
  assert.strictEqual(playbooks.scoutBrief("how do I create a party?"), "");
  assert.strictEqual(playbooks.writerBrief("how do I create a party?"), "");
});

test("briefs render one line per matched playbook", () => {
  const brief = playbooks.scoutBrief("why has my portfolio wealth changed since the election?");
  assert.ok(brief.startsWith("INVESTIGATION METHOD"));
  const writer = playbooks.writerBrief("why has my portfolio wealth changed since the election?");
  assert.ok(writer.startsWith("ANSWER METHOD"));
});
