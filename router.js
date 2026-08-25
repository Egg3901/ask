// Cheap, deterministic request routing. The question and the player's chosen
// answer depth decide the tier before retrieval or quota spending begins.
//
// A tier no longer names one model. It names an ordered fallback chain from
// models.js and the reasoning effort to ask for, so a rate-limited or withdrawn
// provider degrades to the next best scored model instead of failing the player.
const models = require("./models");

const MODELS = {
  flash: models.CHAINS.flash[0],
  pro: models.CHAINS.pro[0],
  deep: models.CHAINS.deep[0],
};

const COMPLEX = /\b(?:why|compare|contrast|tradeoffs?|trade-offs?|interact|interaction|relationship|across|trace|diagnose|root cause|what caused|step by step|edge cases?|all the ways|combined effect|consequences?)\b/i;
const CROSS_SYSTEM = /\b(?:affect|impact|feed into|depend on|change).{0,50}\b(?:economy|election|government|corporation|company|party|country|market|budget|inflation|growth|turn)\b/i;

function choose({ question = "", length = "standard", style = "standard", useMcp = false, isFollowup = false, visualizations = false } = {}) {
  const text = String(question).trim();
  let score = 0;
  const reasons = [];

  if (length === "deep") { score += 6; reasons.push("deep answer"); }
  else if (length === "standard") score += 1;
  if (style === "technical") { score += 1; reasons.push("technical detail"); }
  if (text.length >= 140) { score += 2; reasons.push("long question"); }
  else if (text.length >= 80) score += 1;
  if (COMPLEX.test(text)) { score += 2; reasons.push("analysis request"); }
  if (CROSS_SYSTEM.test(text)) { score += 2; reasons.push("cross-system request"); }
  if ((text.match(/[?;]/g) || []).length > 1) { score += 1; reasons.push("multi-part question"); }
  if (useMcp) { score += 1; reasons.push("live state"); }
  if (isFollowup) score += 1;

  // A chart has to be built, not just described, and a deep answer is the one
  // place the slowest model earns its latency. Both go to the deep tier outright
  // rather than competing on the heuristic score.
  let tier;
  if (visualizations) { tier = "deep"; reasons.push("visualization"); }
  else if (length === "deep") tier = "deep";
  else tier = score >= 4 ? "pro" : "flash";

  return {
    tier,
    label: models.TIER_LABELS[tier],
    chain: models.CHAINS[tier],
    model: models.CHAINS[tier][0],
    effort: models.EFFORT[tier],
    score,
    reasons,
  };
}

/** Display label for a stored model id, including ids no longer in the catalog. */
function label(model) {
  return models.TIER_LABELS[models.tierOf(model)] || "Flash";
}

module.exports = { choose, label, MODELS, CHAINS: models.CHAINS, TIERS: Object.keys(models.CHAINS) };
