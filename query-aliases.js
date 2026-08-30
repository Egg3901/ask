"use strict";

// Player vocabulary and code vocabulary are not always the same. These are
// domain aliases, not answer facts: they widen retrieval so the model sees the
// canonical subsystem before it decides that a feature does not exist.
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
    match: /\bgerman question\b[\s\S]{0,100}\bair superiority\b|\bair superiority\b[\s\S]{0,100}\bgerman question\b/i,
    queries: [
      "German conflict war air superiority navair channels NATO",
      "war theater regional air superiority build decay",
      "stationOf air conflict theater region",
      "authorizeBattleAction navair mission stationSetByPlayer",
    ],
    guidance: "The tracked phrase air superiority resolves this question to the active German conflict's regional naval-air channel, not to the diplomatic German Question crisis ladder. Verify which air missions count toward the contest, where the formations must be stationed, who may issue those standing orders, and how the channel builds and decays. Use the current rates, not comments describing rejected tuning. Then briefly distinguish the crisis board.",
    answerIssue(answer) {
      const text = String(answer || "");
      if (!/\bCAP\b/i.test(text) || !/\bPATROL\b/i.test(text)) return "The answer must name both air missions that count toward the contest: CAP and PATROL.";
      if (!/station|region/i.test(text) || /\badjacent\b/i.test(text)) return "The answer must explain that the wings need to be stationed in the contested region, not merely an adjacent one.";
      if (/two turns? of rebuild/i.test(text)) return "The answer repeats a comment about rejected tuning instead of the current build and decay behavior.";
      if (!/build/i.test(text) || !/decay/i.test(text)) return "The answer must explain channel build and decay.";
      if (!/crisis|diplom/i.test(text)) return "The answer must distinguish the war-layer channel from the diplomatic crisis board.";
      return "";
    },
  },
];

function expand(question) {
  const text = String(question || "");
  return [...new Set(RULES.filter(rule => rule.match.test(text)).flatMap(rule => rule.queries))];
}

function guidance(question) {
  const text = String(question || "");
  return RULES.filter(rule => rule.match.test(text)).map(rule => rule.guidance).filter(Boolean).join("\n");
}

function answerIssue(question, answer) {
  const text = String(question || "");
  for (const rule of RULES) {
    if (!rule.match.test(text) || typeof rule.answerIssue !== "function") continue;
    const issue = rule.answerIssue(answer);
    if (issue) return issue;
  }
  return "";
}

module.exports = { expand, guidance, answerIssue };
