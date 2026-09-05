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
// "Go over each one", "every type of X", "list them all". The question is asking
// for coverage of a set, and a set cannot be covered in the standard 220-word
// target: the answer names two members and stops, which reads to the player as
// not answering. Three reports on 2026-09-05 said exactly that ("Too concise
// didn't answer fully", "Didn't explain what they do", "Should've answered").
const COVERAGE = /\b(?:each one|each type|each kind|every type|every kind|all (?:the )?(?:types?|kinds?|options?)|go over|walk me through|run through|rundown|break ?down|one by one|for each|list (?:them|all|each|every|the))\b|\b(?:types|kinds|sorts) of\b|\b(?:different|various) (?:types?|kinds?|sorts?)\b|\b(?:vs\.?|versus)\b/i;

const SPECIALIST = /\b(?:causal autopsy|causal chain|root cause|forensic explanation|fact-check|fact check|verify (?:the )?(?:previous|prior|last|earlier) answer|audit (?:the )?(?:previous|prior|last|earlier) answer)\b/i;

// How hard to think, as a control separate from how much to write.
//
// These are two different questions and used to be one. "Deep" length used to
// add 6 to the routing score, so asking for a long answer forced the slow
// reasoning model, and asking for a short one made a genuinely hard question
// cheap. A player can now ask the fast model for a long answer, or the thorough
// model for three sentences, because length only sets the word target and the
// token ceiling while effort alone picks the tier.
//
// `auto` is the only value non-staff ever get: routing from the question is
// better than routing from a dropdown the asker has no basis to set.
const EFFORTS = {
  auto:     { label: "Auto", hint: "Picked from the question", tier: null },
  quick:    { label: "Quick", hint: "Fastest model, least reasoning", tier: "flash" },
  balanced: { label: "Balanced", hint: "More reasoning, slower", tier: "pro" },
  thorough: { label: "Thorough", hint: "Most reasoning, slowest", tier: "deep" },
};

function choose({ question = "", length = "standard", style = "standard", useMcp = false, isFollowup = false, visualizations = false, report = false, effort = "auto", specialist = false, deepReasoning = false } = {}) {
  const text = String(question).trim();
  let score = 0;
  const reasons = [];

  // Length deliberately does NOT score. See EFFORTS above.
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
  if (deepReasoning) { tier = "deep"; reasons.push("deep evidence synthesis"); }
  else if (multiPart || report) { tier = "deep"; if (report) reasons.push("report"); }
  else if (wantsCoverage(text)) { tier = "pro"; reasons.push("enumeration"); }
  else if (visualizations) { tier = "pro"; reasons.push("visualization"); }
  else if (specialist || SPECIALIST.test(text)) { tier = "pro"; reasons.push("specialist evidence synthesis"); }
  else tier = score >= 4 ? "pro" : "flash";

  // An explicit effort wins outright. A report still forces deep: it is a
  // multi-section deliverable, and "quick" cannot produce one.
  const forced = EFFORTS[effort]?.tier;
  if (forced && !report && !deepReasoning) { tier = forced; reasons.push(`${effort} requested`); }

  return {
    tier,
    effortChoice: EFFORTS[effort] ? effort : "auto",
    label: models.TIER_LABELS[tier],
    chain: models.CHAINS[tier],
    model: models.CHAINS[tier][0],
    effort: models.EFFORT[tier],
    score,
    reasons,
  };
}

/** Does the question ask for a set to be covered rather than a point answered? */
function wantsCoverage(question) {
  return COVERAGE.test(String(question || ""));
}

/** Display label for a stored model id, including ids no longer in the catalog. */
function label(model) {
  return models.TIER_LABELS[models.tierOf(model)] || "Flash";
}

/**
 * Escalate a flash route to pro AFTER the evidence came back thin. The
 * pre-retrieval score only sees the question's wording; this is the routing
 * decision an operator would revisit once the searches actually ran. A route
 * that is already pro or deep is returned unchanged, and a staff-forced
 * effort choice is respected.
 */
function escalate(route, reason) {
  if (!route || route.tier !== "flash" || route.effortChoice !== "auto") return route;
  return {
    ...route,
    tier: "pro",
    label: models.TIER_LABELS.pro,
    chain: models.CHAINS.pro,
    model: models.CHAINS.pro[0],
    effort: models.EFFORT.pro,
    reasons: [...(route.reasons || []), `escalated: ${reason}`],
    escalated: reason,
  };
}

module.exports = { choose, wantsCoverage, label, escalate, MODELS, EFFORTS, CHAINS: models.CHAINS, TIERS: Object.keys(models.CHAINS) };
