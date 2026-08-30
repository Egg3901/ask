"use strict";

// Player vocabulary and code vocabulary are not always the same. These are
// domain aliases, not answer facts: they widen retrieval so the model sees the
// canonical subsystem before it decides that a feature does not exist.
function normalizePlayerWording(question) {
  return String(question || "")
    .replace(/\bincra+ase\b/gi, "increase")
    .replace(/\bair\s+s[a-z]*(?:prior|prio|rior|ority|oryt)[a-z]*\b/gi, "air superiority");
}

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
    match: /\bblockad(?:e|ing|ed)\b/i,
    queries: [
      "src/lib/navair/blockade.ts blockadeClosureFor tradeApproaches blockadeAffinityMultiplier",
      "src/lib/navair/frontSupport.ts INTERDICTION fromSeaControl carrierPresent",
      "src/lib/navair/config.ts NAVAL_MISSIONS BLOCKADE SEA_CONTROL",
      "src/app/country/[code]/navair/page.tsx Naval and air command defense officeholder",
      "src/app/country/[code]/navair/NavairCommandClient.tsx standing orders next turn",
    ],
    guidance: "Treat sea control, front interdiction, and economic blockade as separate mechanics. Explain that the conflict panel's 20 percent enemy supply cut is the front-interdiction value from total adjacent sea control when a carrier can reach inland; it is not the country's trade-blockade percentage. A trade blockade requires the defense officeholder to open Naval and air command, station naval formations on a target trade approach, and give them the Blockade standing order, which applies on the next turn. Partial closure raises trade friction; literal closure requires blockade pressure at least nine times that approach's port defence. Never infer or reveal the side's live fleet composition.",
    answerIssue(answer) {
      const text = String(answer || "");
      if (!/naval and air command|\/country\/[a-z]{2,3}\/navair/i.test(text) || !/defen[cs]e/i.test(text)) return "The answer must say that the defense officeholder issues the order from Naval and air command.";
      if (!/blockade/i.test(text) || !/standing order|posture|mission/i.test(text) || !/station|approach|region/i.test(text)) return "The answer must explain that naval formations must be stationed on a target trade approach with the Blockade standing order.";
      if (!/20\s*%|20 percent/i.test(text) || !/interdiction|front supply|enemy supply/i.test(text) || !/separate|not (?:a |the )?(?:trade )?blockade/i.test(text)) return "The answer must distinguish the panel's 20 percent front-supply interdiction from the separate economic blockade mechanic.";
      if (!/next turn|following turn/i.test(text)) return "The answer must state that new standing orders take effect on the next turn.";
      return "";
    },
  },
  {
    match: /\bregime change\b[\s\S]{0,180}\b(?:coalition|join|player|rerun|run again|regain|election|government)\b|\b(?:coalition|join|player|rerun|run again|regain|election|government)\b[\s\S]{0,180}\bregime change\b/i,
    queries: [
      "src/lib/military/applyPeaceTerm.ts FORCED_ELECTION_DELAY_TURNS regime_change",
      "src/lib/onePartyState/systemConversion.ts FORCED_LEGACY_RESERVATION FORCED_VOTE_SHARE_PENALTY",
      "src/lib/turn/postConversionElections.ts regime-change snap election",
      "src/app/api/elections/[id]/enter/route.ts Block cross-country election entry",
      "src/app/api/character/relocate/route.ts enabledForPlayers country change cooldown",
      "src/lib/character/performRelocation.ts countryChanged independent leave party",
      "src/lib/constants/blocList.ts blocListQuotaForGovernment BLOC_LIST_QUOTAS governmentType",
    ],
    guidance: "Answer post-war participation as separate implemented steps. Distinguish the treaty's selectable target systems from the country's internal-collapse default. Verify when a democratic conversion's snap election begins, what advantage or penalty the former ruling party carries, whether a foreign character may file without relocating, and what relocation does to party membership. Then inspect whether any country-specific seat-allocation rule is active under the new runtime government type.",
    answerIssue(answer) {
      const text = String(answer || "");
      if (!/cross-country|relocat/i.test(text)) return "The answer must explain that foreign characters cannot file directly and must use the relocation mechanic first.";
      if (!/independent/i.test(text)) return "The answer must explain that a cross-country relocation clears the old party and makes the character independent.";
      if (!/parliamentary republic/i.test(text) || !/presidential/i.test(text) || !/one-party|one party/i.test(text)) return "The answer must distinguish the treaty's three selectable systems from DDR's internal-collapse default.";
      if (!/12\s+turn/i.test(text) || !/snap|fresh election/i.test(text)) return "The answer must state that a forced democratic regime change schedules the post-conversion snap election after 12 turns.";
      if (!/(?:five|5)[ -]seat/i.test(text) || !/(?:20\s*%|20 percent|0\.2)/i.test(text)) return "The answer must state the former ruling party's first-election five-seat reservation and 20 percent vote-share penalty.";
      if (!/55\s*%|55 percent/i.test(text) || !/one-party|one party/i.test(text) || !/ordinary|competitive|disabled|no longer/i.test(text)) return "The answer must explain that DDR's 55 percent bloc-list quota is active only under one-party government and no longer controls a democratic post-conversion election.";
      return "";
    },
  },
  {
    match: /(?=[\s\S]*\b(?:voting age|franchise|registration access|electoral (?:law|change))\b)(?=[\s\S]*\b(?:verify|tell|check|work|worked|working|effect|took effect)\b)/i,
    queries: [
      "src/lib/elections/electoralLaws.ts votingAgeEligibleByCountry registrationAccessBiasByCountry",
      "src/lib/demographics/phase.ts votingAgeFor votingEligiblePopulation",
      "src/lib/constants/votingAge.ts resolveVotingAgeEligible countryId",
      "src/lib/turn/partyOrg/regDriftDecay.ts registrationDriftMultiplier registrationDecayMultiplier orgRegLedger",
      "electoral law enacted bill provisions status registration influence UI",
    ],
    guidance: "Explain verification at three boundaries: the bill must be enacted with the expected electoral-law provision; the enacting country's stored voting-age and registration-access values must match; then the following turn must show the derived effects. For registration access +50, name the exact 1.5x upward Org-to-Reg drift and 0.5x decay rates and point to registration changes or ledger rows. For voting age, point to votingEligiblePopulation derived from the country's cohort vector. Do not claim a live value changed unless live evidence contains the before and after values. In a bloc-list chamber, fixed party seat shares are not a valid test of these laws.",
    answerIssue(answer) {
      const text = String(answer || "");
      if (!/enacted|passed|bill status/i.test(text) || !/provision/i.test(text)) return "The answer must first verify that the electoral-law provision was enacted, not merely proposed.";
      if (!/votingEligiblePopulation|eligible population/i.test(text)) return "The answer must identify the country-scoped eligible-population readout as the voting-age effect.";
      if (!/1\.5\s*(?:x|times)|one and a half/i.test(text) || !/0\.5\s*(?:x|times)|half/i.test(text)) return "The answer must give registration +50's exact effects: 1.5x registration drift and 0.5x decay.";
      if (!/fixed|bloc-list|bloc list/i.test(text) || !/seat/i.test(text)) return "The answer must warn that DDR's fixed party seat shares are not a test of voting-age or registration changes.";
      return "";
    },
  },
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
  const text = normalizePlayerWording(question);
  return [...new Set(RULES.filter(rule => rule.match.test(text) && !rule.exclude?.test(text)).flatMap(rule => rule.queries))];
}

function guidance(question) {
  const text = normalizePlayerWording(question);
  return RULES.filter(rule => rule.match.test(text) && !rule.exclude?.test(text)).map(rule => rule.guidance).filter(Boolean).join("\n");
}

function answerIssue(question, answer) {
  const text = normalizePlayerWording(question);
  for (const rule of RULES) {
    if (!rule.match.test(text) || rule.exclude?.test(text) || typeof rule.answerIssue !== "function") continue;
    const issue = rule.answerIssue(answer);
    if (issue) return issue;
  }
  return "";
}

module.exports = { expand, guidance, answerIssue, normalizePlayerWording };
