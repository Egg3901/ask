"use strict";

// The first corpus pass used `general` as a temporary holding bucket. Keeping
// those rows there makes the deterministic audit permanently unprovable, even
// after the underlying failure has a concrete regression check. This mapping
// records the actual capability each historical failure exercises.
const GENERAL_CAPABILITIES = new Map([
  [13, "output_reliability"],
  [14, "output_reliability"],
  [22, "context_reference"],
  [36, "relevant_chart"],
  [48, "evaluation_integrity"],
  [89, "mechanic_evidence"],
  [92, "mechanic_evidence"],
  [102, "capability_inventory"],
  [156, "context_reference"],
  [177, "war_mechanics"],
]);

function capabilityFor(row) {
  if (row?.capability !== "general") return row?.capability || null;
  return GENERAL_CAPABILITIES.get(Number(row.id)) || "general";
}

// This row was inserted by a store test, not asked by a player. It has no
// antecedent and its recorded answer is literally "An answer". Covering it
// means keeping it out of semantic quality claims, not inventing a cause.
function isInvalidFixture(row) {
  return Number(row?.id) === 48
    && String(row?.question || "").trim() === "Why did this happen?"
    && Number(row?.baseline_answer_len) === 9;
}

module.exports = { GENERAL_CAPABILITIES, capabilityFor, isInvalidFixture };
