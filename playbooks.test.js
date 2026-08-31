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

test("post-race debriefs get the decompose-the-margin method", () => {
  const hit = playbooks.matches("why did I lose my senate race, what cost me the election?");
  assert.ok(hit.some(p => p.id === "election_debrief"));
  const brief = playbooks.scoutBrief("debrief my presidential race");
  assert.match(brief, /trace_race/);
  assert.match(brief, /off limits/);
  const writer = playbooks.writerBrief("post-mortem my house election please");
  assert.match(writer, /structural versus playable/);
  assert.match(writer, /never predict an unresolved race/i);
});

test("away briefings get the personal-anchors method", () => {
  const brief = playbooks.scoutBrief("what did I miss while I was away?");
  assert.match(brief, /game_overview/);
  assert.match(brief, /Public data only for everyone else/);
  const writer = playbooks.writerBrief("catch me up, been gone a week");
  assert.match(writer, /most consequential change/);
  assert.match(writer, /suggested next action/);
});
