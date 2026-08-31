"use strict";

const visualization = require("./visualization");
const queryAliases = require("./query-aliases");

const BLOCK = /```(?:mermaid|mmd|ahd-map)\s*\n[\s\S]*?```\s*/gi;
const MAP_BLOCK = /```ahd-map\s*\n([\s\S]*?)```/i;

const MILITARY_INVENTORY = String.raw`(?:logistics? commands?|airlift wings?|commands?|units?|formations?|divisions?|brigades?|battalions?|regiments?|corps|squadrons?|wings?|fleets?|carrier groups?|task forces?|naval assets?|air assets?|troops?|personnel|equipment|readiness|deployments?|force strength|army strength|military strength|tanks?|aircraft|ships?|submarines?|missiles?|nuclear weapons?|warheads?)`;
// Unlike conventional rosters, national warhead totals are deliberately published
// on World > Conflicts. Do not turn that designed public record into a privacy refusal.
const PUBLIC_NUCLEAR_RECORD = /\b(?:warheads?|nuclear (?:weapon )?stockpile|nuclear powers? strip)\b/i;
const FORCE_POSSESSION = new RegExp(
  String.raw`\b(?:has|have|had|lacks?|without|no|zero|fields?|fielded|deploys?|deployed|stations?|stationed|includes?|contains?)\b[^.!?\n]{0,90}\b${MILITARY_INVENTORY}\b|\b${MILITARY_INVENTORY}\b[^.!?\n]{0,60}\b(?:on (?:its|their|the) roster|in (?:its|their|the) forces?|available|deployed|stationed)\b`,
  "i",
);
const FORCE_INVENTORY = /\b(?:live (?:military )?roster|current (?:military )?roster|force composition|order of battle|current deployments?|live readiness|live force strength)\b/i;
const FORCE_QUANTITY = new RegExp(
  String.raw`\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|\d+(?:\.\d+)?%?)\b[^.!?\n]{0,35}\b${MILITARY_INVENTORY}\b|\b${MILITARY_INVENTORY}\b[^.!?\n]{0,35}\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|\d+(?:\.\d+)?%?)\b`,
  "i",
);
const FORCE_ABSENCE = new RegExp(
  String.raw`\b(?:lacks?|missing|without|no|zero)\b[^.!?\n]{0,70}\b${MILITARY_INVENTORY}\b|\b${MILITARY_INVENTORY}\b[^.!?\n]{0,45}\b(?:absent|missing|unavailable)\b`,
  "i",
);
const FORCE_OPERATION = new RegExp(
  String.raw`\b(?:operates?|maintains?|fields?|deploys?|stations?|consists? of)\b[^.!?\n]{0,70}\b${MILITARY_INVENTORY}\b`,
  "i",
);
const PRIVATE_MILITARY_QUESTION = new RegExp(
  String.raw`\bhow many\b[^?\n]{0,90}\b${MILITARY_INVENTORY}\b|\b(?:which|what)\b[^?\n]{0,45}\b${MILITARY_INVENTORY}\b[^?\n]{0,45}\b(?:does|do)\b[^?\n]{0,45}\b(?:have|field|deploy|station|operate|maintain|lack)\b|\bwhat is\b[^?\n]{0,75}\b(?:readiness|force strength|army strength|military strength|force composition|order of battle)\b|\b(?:does|do|is|are)\b[^?\n]{0,90}\b(?:have|field|deploy|station|operate|maintain|lack|missing|readiness)\b|\b(?:current|live|roster|force composition|order of battle)\b[^?\n]{0,90}\b${MILITARY_INVENTORY}\b|\b(?:compare|rank)\b[^?\n]{0,100}\b(?:current|live)\b[^?\n]{0,70}\b(?:militar(?:y|ies)|arm(?:y|ies)|armed forces?)\b`,
  "i",
);
const GENERIC_MILITARY_MECHANIC = new RegExp(
  String.raw`^(?:a|an|each|every)\s+${MILITARY_INVENTORY}\b[^.!?\n]{0,50}\b(?:adds?|provides?|consumes?|requires?|contains?|consists? of|can|may|moves?|supplies|supports?|costs?|takes?)\b`,
  "i",
);
const GENERIC_MECHANICS_QUESTION = /\b(?:how|what|why|when|where|can)\b[^?\n]{0,100}\b(?:work|works|do|mechanics?|composed?|formed?|assigned?|supply|supplied|throughput|save|saved|persist|revert|reset|change)\b|\bwhich\b[^?\n]{0,70}\b(?:missions?|formations?|units?)\b[^?\n]{0,50}\b(?:build|count|contribute|add|provide|affect)\b/i;
const GENERIC_MECHANIC_INSTRUCTION = /^(?:open|go|set|move|assign|choose|use|put|keep|select|station|send|fly|order)\b/i;
const LIVE_INSTRUCTION_TARGET = /\b(?:[A-Z][A-Za-z'-]+|[A-Z]{2,3})['’]s\b|\b(?:current|currently|live|existing|available|deployed|stationed)\b/i;
const CAPITALIZED_WORD = /^[A-Z][A-Za-z'-]*/;
const CAPITALIZED_LOCATION = /\b(?:from|in|near|for|within|of)\s+([A-Z][A-Za-z'-]+)\b/g;
const CAPITALIZED_ANYWHERE = /\b[A-Z][A-Za-z'-]*\b/g;
const GENERIC_HYPOTHETICAL = /^(?:if|when|unless|without|with|to)\b|\b(?:must|needs? to|has to|can|may|should)\b/i;
const GENERIC_NAME_WORDS = new Set([
  "a", "an", "the", "each", "every", "you", "to", "in", "under", "when", "if", "for", "with", "without",
  "logistics", "airlift", "command", "commands", "unit", "units", "formation", "formations",
  "division", "divisions", "brigade", "brigades", "battalion", "battalions", "regiment", "regiments",
  "corps", "squadron", "squadrons", "wing", "wings", "fleet", "fleets", "carrier", "task", "naval",
  "air", "troop", "troops", "personnel", "equipment", "readiness", "deployment", "deployments", "force",
  "forces", "army", "military", "tank", "tanks", "aircraft", "ship", "ships", "submarine", "submarines",
  "missile", "missiles", "nuclear", "house", "divided",
]);
const PRIVATE_MILITARY_REFUSAL = "This answer is public, so I can't publish live military rosters, unit or command composition, readiness, deployments, or force strength. I can explain the mechanics or summarize the public war record instead.";

function isGenericMilitaryMechanicSentence(sentence, question) {
  const text = sentence.trim();
  if (PUBLIC_NUCLEAR_RECORD.test(text) && PUBLIC_NUCLEAR_RECORD.test(question)) return true;
  if (GENERIC_MILITARY_MECHANIC.test(text)) return true;
  const normalizedQuestion = queryAliases.normalizePlayerWording(question);
  if (!GENERIC_MECHANICS_QUESTION.test(normalizedQuestion)) return false;
  if (GENERIC_MECHANIC_INSTRUCTION.test(text) && !LIVE_INSTRUCTION_TARGET.test(text)) return true;
  const hasUnknownName = [...text.matchAll(CAPITALIZED_ANYWHERE)]
    .some((match) => !/^[A-Z0-9_]{2,}$/.test(match[0])
      && !GENERIC_NAME_WORDS.has(match[0].toLowerCase().replace(/'s$/, "")));
  if (GENERIC_HYPOTHETICAL.test(text) && !hasUnknownName) return true;
  if (/\b(?:your|their|our|its|this|that)\s+(?:country|nation|force|forces|army|military)\b/i.test(text)) return false;
  const subject = text.match(CAPITALIZED_WORD)?.[0]?.toLowerCase().replace(/'s$/, "");
  if (subject && !GENERIC_NAME_WORDS.has(subject)) return false;
  return ![...text.matchAll(CAPITALIZED_LOCATION)]
    .some((match) => !GENERIC_NAME_WORDS.has(match[1].toLowerCase().replace(/'s$/, "")));
}

// Inventory words that also live in civilian vocabulary. "The market includes
// 500,000 units" tripped FORCE_POSSESSION and replaced a stock-price answer
// with the military refusal (observed live 2026-08-31). These only count as
// military when the sentence or the question carries military context; the
// unambiguous inventory (divisions, fleets, warheads, carrier groups...)
// still triggers on its own.
const AMBIGUOUS_INVENTORY = /\b(?:units?|equipment|personnel|commands?|wings?|ships?|aircraft|corps)\b/i;
const UNAMBIGUOUS_INVENTORY = /\b(?:logistics? commands?|airlift wings?|formations?|divisions?|brigades?|battalions?|regiments?|squadrons?|fleets?|carrier groups?|task forces?|naval assets?|air assets?|troops?|readiness|deployments?|force strength|army strength|military strength|tanks?|submarines?|missiles?|nuclear weapons?|warheads?)\b/i;
const MILITARY_CONTEXT = /\b(?:militar\w*|arm(?:y|ies)|nav(?:y|ies)|naval|air force|war|wars|combat|battle|front|deploy\w*|garrison\w*|invasion|offensive|defen[cs]e|troops?|soldiers?|roster|readiness|conflict|armou?red|infantry|mechani[sz]ed|artillery|fighters?|bombers?|warships?|station\w*)\b/i;

function sentenceHasMilitaryMeaning(sentence, question) {
  if (UNAMBIGUOUS_INVENTORY.test(sentence)) return true;
  if (!AMBIGUOUS_INVENTORY.test(sentence)) return true;
  return MILITARY_CONTEXT.test(sentence) || MILITARY_CONTEXT.test(String(question || ""));
}

function containsPrivateMilitaryIntelligence(answer, question = "") {
  return String(answer || "").split(/(?<=[.!?])\s+|\n+/).some((sentence) => {
    if (isGenericMilitaryMechanicSentence(sentence, question)) return false;
    const tripped = FORCE_INVENTORY.test(sentence) || FORCE_POSSESSION.test(sentence)
      || FORCE_QUANTITY.test(sentence) || FORCE_ABSENCE.test(sentence) || FORCE_OPERATION.test(sentence);
    if (!tripped) return false;
    return sentenceHasMilitaryMeaning(sentence, question);
  });
}

function asksForPrivateMilitaryIntelligence(question) {
  const text = String(question || "");
  if (PUBLIC_NUCLEAR_RECORD.test(text)) return false;
  return FORCE_INVENTORY.test(text) || PRIVATE_MILITARY_QUESTION.test(text);
}

function protectPublicAnswer(answer, question = "") {
  const text = String(answer || "").trim();
  if (!asksForPrivateMilitaryIntelligence(question) && !containsPrivateMilitaryIntelligence(text, question)) return text;
  return PRIVATE_MILITARY_REFUSAL;
}

function stripVisuals(answer) {
  return String(answer || "").replace(BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Some picker models (e.g. Mimo via the OpenCode Zen gateway) don't honor the
// native tool_calls contract — they emit tool invocations as XML text inside the
// content: <tool_call><function=search_code><parameter=query>…. The harness never
// parses these, so the raw markup would stream straight to the player as the
// "answer". Detect that shape so the caller can fail the generation (no quota,
// standard retry error) instead of shipping tool-call soup.
const TOOL_LEAK = /<\/?tool_call\b|<function\s*=|<parameter\s*=|<\|(?:tool_call|tool_calls|python_tag)\|>/i;
// The same failure in JSON clothing, and the one that actually reached a player:
// MiniMax answered a follow-up with "Let me re-verify…" and three fenced blocks
// of {"name":"bash","arguments":{"command":"git -C /home/user/AHD log …"}} — a
// tool it does not have, on a machine that does not exist. The XML detector saw
// nothing wrong with it. Requires the name+arguments pair so a legitimate JSON
// example in an answer is not mistaken for a tool call.
const TOOL_LEAK_JSON = /\{\s*"(?:name|tool|function|recipient_name)"\s*:\s*"[\w.-]+"\s*,\s*"(?:arguments|parameters|args|tool_input)"\s*:\s*[{[]/i;
function looksLikeToolLeak(answer) {
  const text = String(answer || "");
  return TOOL_LEAK.test(text) || TOOL_LEAK_JSON.test(text);
}

// Deterministic refusal detector — the inline, no-model-call counterpart to the
// sampled model grader. When the answer model declines ("I can't", "I don't have
// access", "I do not know") but live evidence WAS injected, that is the #1
// failure pattern: a refusal on a question the system could answer. We flag it,
// never rewrite it — the streamed text already reached the player, and a
// heavy-handed strip risks mangling a legitimately hedged answer.
//
// Conservative on purpose: the refusal phrase must appear near the START of a
// SHORT answer. A long answer that merely contains "cannot determine" mid-way is
// making a scoped caveat, not refusing.
const REFUSAL = /\b(?:i (?:can'?t|cannot|am unable to|do not|don'?t) (?:help|answer|access|determine|find|provide|tell|see|know)|i (?:do not|don'?t) have (?:access|the data|that information|that data)|i (?:wasn'?t|was not) (?:given|provided)|(?:that'?s |this is )?not (?:available|something i can|accessible) (?:to me)?|no (?:access|data) (?:to|for|available)|unable to (?:determine|answer|access))\b/i;
// A refusal that is correct behavior: declining to expose private/opponent data.
const LEGIT_REFUSAL = /\b(?:private|fair.?play|opponent|another player'?s|confidential|not allowed to (?:share|reveal))\b/i;

function detectRefusal(answer, hasLiveData) {
  const text = String(answer || "").trim();
  if (!text) return false;
  const head = text.slice(0, 240);
  if (!REFUSAL.test(head)) return false;
  if (LEGIT_REFUSAL.test(text)) return false;      // correct fair-play refusal
  if (!hasLiveData && text.length > 600) return false; // long code answer with a caveat, no live data
  return true;
}

// The answer describes its own retrieval bundle to the player: "the supplied
// source", "the evidence provided", "the live snapshot only covers", "the files
// I haven't been given". This was the single most common failure shape in the
// corpus audit — 43 of 195 answers, 38 of which HAD live data fetched and still
// told the player the bundle was the limit of the game.
//
// The player asked about the game, not about what Ask was handed. Flagged, never
// rewritten: the text already streamed, and the value here is keeping it out of
// the shared cache and into the audit queue.
const BUNDLE_NARRATION = /\b(?:the\s+)?(?:supplied|provided|retrieved|given|available)\s+(?:source|sources|evidence|material|data|excerpts?|context|snapshot|documents?|files?)\b|\b(?:evidence|sources?|material|excerpts?|context)\s+(?:supplied|provided|given|retrieved)\b|\b(?:source|sources|evidence|material|data|excerpts?|context|snapshot|files?)\s+(?:you|I)\s*(?:'ve|have|was|were)?\s*(?:supplied|provided|given|shown|been given)\b|\bin (?:the |what )?(?:evidence|material|source|sources|excerpts?|snapshot)\s+(?:I|you)\b|\b(?:live\s+)?(?:world\s+)?snapshot\s+(?:only|does not|doesn'?t)\b|\bwhat (?:you'?ve|I'?ve|you have|I have)\s+(?:shown|given|provided)\s+me\b|\bnot (?:in|present in|included in|part of)\s+(?:the\s+)?(?:supplied|provided|retrieved|given)\b|\bfiles?\s+I\s+(?:haven'?t|have not)\s+been\s+given\b/i;

function detectBundleNarration(answer) {
  return BUNDLE_NARRATION.test(String(answer || ""));
}

// The generation hit the token ceiling mid-thought. `finish_reason` is the
// authority when the provider sends one; this is the textual backstop for the
// providers that do not. Deliberately narrow: a real answer ends on terminal
// punctuation, a closing fence, or a table row.
const ENDS_CLEANLY = /[.!?:)\]`"'’”*]\s*$|```\s*$|\|\s*$|-->\s*$/;

function looksTruncated(answer) {
  const text = String(answer || "").trimEnd();
  if (text.length < 200) return false;      // short answers are not worth guessing about
  return !ENDS_CLEANLY.test(text);
}

// A dataset that has nothing to do with the question must never be charted just
// because the live layer happened to return one. The audit found a country
// GDP-growth bar chart attached to "Map GOP Senate 1 candidates", immediately
// above the answer refusing that very request.
//
// Matching is deliberately lexical and generous: the cost of dropping a
// borderline-relevant chart is a plainer answer, while the cost of keeping an
// irrelevant one is an answer that visibly contradicts itself.
const CHART_STOPWORDS = new Set([
  "the", "a", "an", "of", "by", "in", "on", "for", "and", "or", "to", "with",
  "live", "current", "recent", "show", "me", "what", "which", "is", "are", "how",
  "my", "your", "their", "its", "this", "that", "chart", "graph", "map", "plot",
  "visualize", "visualise", "visualization", "visualisation", "compare",
  "comparison", "data", "value", "values", "total", "world", "game", "please",
]);

function contentWords(text) {
  return new Set(String(text || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !CHART_STOPWORDS.has(w))
    .map(w => w.replace(/(?:ies|es|s)$/, "")));   // crude stem so "candidates" meets "candidate"
}

function datasetMatchesQuestion(dataset, question) {
  const subject = contentWords([dataset?.metric, dataset?.title, dataset?.unit].filter(Boolean).join(" "));
  const asked = contentWords(question);
  if (!subject.size || !asked.size) return true;   // nothing to judge on: don't block
  for (const word of asked) if (subject.has(word)) return true;
  return false;
}

function matchingMap(datasets, metric) {
  return (datasets || []).find(data => data?.recommended === "map" && (!metric || data.metric === metric)) || null;
}

function matchingDataset(datasets, metric) {
  return (datasets || []).find(data => data?.recommended !== "map" && (!metric || data.metric === metric)) || null;
}

// Prevent a model from presenting a plausible-looking but unsupported chart.
// Canonical maps and chart data are produced by the live adapters, never copied
// from a model response.
function enforce({ answer, datasets = [], plan, visualizationsEnabled = false, question = "", privacyQuestion = question, privacyGuardEnabled = true, trustedStaticAnswer = false }) {
  let text = String(answer || "").trim();
  const issues = [];
  // Canonical contracts are static source-controlled prose. They cannot contain
  // retrieved live roster data, so reclassifying them as model output only creates
  // false refusals when several safe mechanics are answered together.
  if (privacyGuardEnabled && !trustedStaticAnswer) {
    const protectedAnswer = protectPublicAnswer(text, privacyQuestion);
    if (protectedAnswer !== text) {
      text = protectedAnswer;
      issues.push("private_military_intelligence_removed");
    }
  }
  const expected = plan?.display || { kind: "prose" };
  const map = expected.kind === "map" ? matchingMap(datasets, expected.metric) : null;

  if (expected.kind === "map") {
    const prose = stripVisuals(text);
    if (!map) {
      issues.push("required_live_map_unavailable");
      return { answer: prose, issues, required: false };
    }
    const block = visualization.chart(map, question);
    return { answer: `${block}\n\n${prose}`.trim(), issues, required: false };
  }

  if (expected.kind === "comparison" && expected.canonical) {
    const prose = stripVisuals(text);
    const dataset = matchingDataset(datasets, expected.metric);
    if (!dataset) {
      issues.push("required_live_dataset_unavailable");
      return { answer: prose, issues, required: false };
    }
    if (visualizationsEnabled || plan?.visual === "required") {
      const block = visualization.chart(dataset, question);
      if (block) return { answer: `${block}\n\n${prose}`.trim(), issues, required: false };
    }
    return { answer: prose, issues, required: false };
  }

  // Rule/mechanics answers must stay prose even if an account-wide optional
  // visualization toggle is enabled. This stops words such as “state” from
  // turning an election question into an unrelated economy chart.
  if (plan?.visual === "none") {
    if (BLOCK.test(text)) issues.push("unsupported_visualization_removed");
    BLOCK.lastIndex = 0;
    return { answer: stripVisuals(text), issues, required: false };
  }

  if (visualizationsEnabled && datasets.length) {
    // Opportunistic chart: nothing planned it, the live layer just returned one.
    // It only ships if it is actually about what was asked.
    const relevant = datasets.find(d => datasetMatchesQuestion(d, question));
    if (!relevant) {
      if (datasets.length) issues.push("irrelevant_visualization_withheld");
    } else {
      const canonical = visualization.chart(relevant, question);
      if (canonical) {
        const prose = stripVisuals(text);
        return { answer: `${canonical}\n\n${prose}`.trim(), issues, required: false };
      }
    }
  }

  return { answer: text, issues, required: false };
}

function inspect(answer, plan) {
  const hasMap = MAP_BLOCK.test(String(answer || ""));
  if (plan?.display?.kind === "map" && !hasMap) return ["required_live_map_missing"];
  return [];
}

module.exports = {
  enforce, inspect, stripVisuals, looksLikeToolLeak, detectRefusal,
  detectBundleNarration, looksTruncated, datasetMatchesQuestion,
  containsPrivateMilitaryIntelligence, asksForPrivateMilitaryIntelligence,
  protectPublicAnswer,
};
