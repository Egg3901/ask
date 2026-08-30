"use strict";

// Player vocabulary and code vocabulary are not always the same. These are
// domain aliases, not answer facts: they widen retrieval so the model sees the
// canonical subsystem before it decides that a feature does not exist.
function airSuperiorityIssue(answer, { requireCrisis = false } = {}) {
  const text = String(answer || "");
  if (!/\bCAP\b/i.test(text) || !/\bPATROL\b/i.test(text)) return "The answer must name both air missions that count toward the contest: CAP and PATROL.";
  if (!/station|region/i.test(text) || /\b(?:adjacent|near(?:by)?)\b/i.test(text)) return "The answer must explain that the wings need to be stationed in the contested region, not merely in or near an adjacent region.";
  if (/two turns? of rebuild/i.test(text)) return "The answer repeats a comment about rejected tuning instead of the current build and decay behavior.";
  if (!/build/i.test(text) || !/decay/i.test(text) || !/\b12\b/.test(text) || !/\b15\b/.test(text)) return "The answer must give the current channel rates: build by 12 and decay by 15 per turn toward the contested target.";
  if (requireCrisis && !/crisis|diplom/i.test(text)) return "The answer must distinguish the war-layer channel from the diplomatic crisis board.";
  return "";
}

const RULES = [
  {
    match: /\b(?:spin[\s-]?off|sell off|float)\b[\s\S]{0,60}\b(?:state|national|public)\s+(?:corp|corporation|enterprise)|\b(?:state|national)\s+(?:corp|corporation|enterprise)\b[\s\S]{0,60}\b(?:spin[\s-]?off|sell off|float)\b/i,
    queries: [
      "privatize national corporation treasury authority IPO auction",
      "state enterprise privatization finance minister national corporation route",
      "command economy SOE director appointment Gosplan head of government planTarget directorId",
    ],
    guidance: "This question has two required parts. Treat the player's phrase spin off state corps as the product action named privatization, not as a reason to deny the capability. Lead with the capability and its canonical name. Verify both (1) treasury-authorized privatization of a national corporation and (2) who appoints and operates command-economy SOE directors, including Gosplan or head-of-government authority and the director's enterprise controls.",
    answerIssue(answer) {
      const text = String(answer || "");
      if (/^\s*no\b/i.test(text)) return "The answer opens by denying the capability even though the evidence establishes the same player action under the canonical name privatization.";
      if (!/privati[sz]/i.test(text) || !/treasury|finance minister|secretary of the treasury/i.test(text)) return "The answer must explain treasury-authorized privatization.";
      if (!/director/i.test(text) || !/gosplan|head of government|premier/i.test(text)) return "The answer must also explain who appoints or controls SOE directors.";
      return "";
    },
  },
  {
    // Match the mechanic itself, not one incident's wording. Players ask this
    // as "which missions", "how do I build it", or "why is it decaying".
    match: /\bair superiority\b[\s\S]{0,140}\b(?:build|decay|mission|station|count|increase|improve|higher)\b|\b(?:build|decay|mission|station|count|increase|improve|higher)\b[\s\S]{0,140}\bair superiority\b/i,
    exclude: /\bgerman question\b/i,
    queries: [
      "CHANNEL_RATES airSuperiority",
      "src/lib/navair/config.ts EMBARGO",
      "src/lib/navair/turn.ts stationOf",
      "air superiority navair channels CAP PATROL build decay",
      "war theater regional air superiority build decay",
      "stationOf air conflict theater region",
      "authorizeBattleAction navair mission stationSetByPlayer",
    ],
    guidance: "Resolve air-superiority mechanics through the regional naval-air channel. Verify which missions count, where formations must be stationed, who may issue the standing orders, and the current channel build and decay rates. Do not infer mechanics from an old comment or from the diplomatic crisis system.",
    answerIssue(answer) {
      return airSuperiorityIssue(answer);
    },
  },
  {
    match: /\bgerman question\b[\s\S]{0,100}\bair superiority\b|\bair superiority\b[\s\S]{0,100}\bgerman question\b/i,
    queries: [
      "CHANNEL_RATES airSuperiority",
      "src/lib/navair/config.ts EMBARGO",
      "src/lib/navair/turn.ts stationOf",
      "German conflict war air superiority navair channels NATO",
      "war theater regional air superiority build decay",
      "stationOf air conflict theater region",
      "authorizeBattleAction navair mission stationSetByPlayer",
    ],
    guidance: "The tracked phrase air superiority resolves this question to the active German conflict's regional naval-air channel, not to the diplomatic German Question crisis ladder. Verify which air missions count toward the contest, where the formations must be stationed, who may issue those standing orders, and how the channel builds and decays. Use the current rates, not comments describing rejected tuning. Then briefly distinguish the crisis board.",
    answerIssue(answer) {
      return airSuperiorityIssue(answer, { requireCrisis: true });
    },
  },
];

function expand(question) {
  const text = String(question || "");
  return [...new Set(RULES.filter(rule => rule.match.test(text) && !rule.exclude?.test(text)).flatMap(rule => rule.queries))];
}

function guidance(question) {
  const text = String(question || "");
  return RULES.filter(rule => rule.match.test(text) && !rule.exclude?.test(text)).map(rule => rule.guidance).filter(Boolean).join("\n");
}

function answerIssue(question, answer) {
  const text = String(question || "");
  for (const rule of RULES) {
    if (!rule.match.test(text) || rule.exclude?.test(text) || typeof rule.answerIssue !== "function") continue;
    const issue = rule.answerIssue(answer);
    if (issue) return issue;
  }
  return "";
}

module.exports = { expand, guidance, answerIssue };
