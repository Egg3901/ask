"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const scenarioLab = require("./scenario-lab");

test("compiles a natural-language commodity shock into bounded simulator arguments", () => {
  assert.deepEqual(
    scenarioLab.parse("What happens to iron prices if demand rises 5% per turn for 12 turns?"),
    { turns: 12, demandPct: 5, supplyPct: 0, commodity: "iron" },
  );
  assert.deepEqual(
    scenarioLab.parse("Project an economy-wide 3% supply drop for the next 8 turns"),
    { turns: 8, demandPct: 0, supplyPct: -3 },
  );
});

test("does not pretend unsupported policy questions are simulator-ready", () => {
  assert.equal(scenarioLab.parse("What if I raise taxes?"), null);
  assert.equal(scenarioLab.parse("What happens to iron next turn?"), null);
});

test("explicit Scenario mode removes the need for trigger wording", () => {
  assert.deepEqual(
    scenarioLab.parse("Iron demand rises 5% per turn for 12 turns", { forced: true }),
    { turns: 12, demandPct: 5, supplyPct: 0, commodity: "iron" },
  );
});

test("formats simulator output as a deterministic answer and chart dataset", () => {
  const raw = JSON.stringify({
    scenario: { turns: 12, demandPct: 5, supplyPct: 0, commodity: "iron" },
    startInflation: 1,
    endInflation: 1.12,
    inflationTrajectory: [{ turn: 1, inflationIndex: 1.01 }, { turn: 12, inflationIndex: 1.12 }],
    commodities: [{ commodity: "iron", startPrice: 2, endPrice: 3, changePct: 50, elasticity: 0.15 }],
    note: "Directional projection calibrated to live prices; not the canonical turn engine.",
  });
  const out = scenarioLab.fromToolResult(raw);
  assert.match(out.answer, /Iron.*2.*3.*50%/is);
  assert.match(out.answer, /directional projection/i);
  assert.equal(out.visualization.recommended, "line");
  assert.deepEqual(out.visualization.rows, [
    { label: "T1", value: 1.01 },
    { label: "T12", value: 1.12 },
  ]);
});
