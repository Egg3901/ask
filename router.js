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

function choose({ question = "", length = "standard", style = "standard", useMcp = false, isFollowup = false, visualizations = false, report = false } = {}) {
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

  // The deep tier (Ox Alpha) is slow, so it is reserved for genuinely multi-part
  // responses — a question that asks two or more distinct things, an explicit
  // numbered/lettered list of asks, or the explicit "deep" length. Everything
  // else that needs reasoning (including visualizations and single-topic analysis)
  // goes to pro (Mimo); simple lookups go to flash (DeepSeek).
  const questionMarks = (text.match(/\?/g) || []).length;
  const multiPart = questionMarks > 1
    || (text.match(/;/g) || []).length >= 1 && questionMarks >= 1
    || /(?:^|\s)\d[.)]\s+\S[\s\S]*(?:^|\s)\d[.)]\s+\S/.test(text)               // "1. ... 2. ..."
    || /\b(?:and also|as well as|on top of that|two things|both\b[\s\S]*\band\b)\b/i.test(text)
    || /\bfirst\b[\s\S]*\b(?:second|then|next|also)\b/i.test(text);
  if (multiPart) reasons.push("multi-part");

  // Ox Alpha (deep) is ONLY for multi-part responses: a question with 2+ distinct
  // asks, or an explicit report (a multi-section deliverable). The plain "deep"
  // length toggle just makes the answer longer — it still scores up to pro (Mimo)
  // rather than dragging every long answer onto the slow model.
  let tier;
  if (multiPart || report) { tier = "deep"; if (report) reasons.push("report"); }
  else if (visualizations) { tier = "pro"; reasons.push("visualization"); }
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
