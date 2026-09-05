"use strict";

const visualization = require("./visualization");
const queryAliases = require("./query-aliases");

const BLOCK = /```(?:mermaid|mmd|ahd-map)\s*\n[\s\S]*?```\s*/gi;
const MAP_BLOCK = /```ahd-map\s*\n([\s\S]*?)```/i;

const MILITARY_INVENTORY = String.raw`(?:logistics? commands?|airlift wings?|commands?|units?|formations?|divisions?|brigades?|battalions?|regiments?|corps|squadrons?|wings?|fleets?|carrier groups?|task forces?|naval assets?|air assets?|troops?|personnel|equipment|readiness|deployments?|force strength|army strength|military strength|tanks?|aircraft|ships?|submarines?|missiles?|nuclear weapons?|warheads?|carriers?|destroyers?|cruisers?|frigates?|battleships?|corvettes?|warships?|bombers?|fighters?)`;
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
const POSSESSION_VERB = String.raw`(?:have|has|had|own|owns|field|fields|deploy|deploys|station|stations|operate|operates|maintain|maintains|lack|lacks|missing)`;
const FORCE_STATE = String.raw`(?:readiness|force strength|army strength|military strength|force composition|order of battle)`;
// Every alternative must name a military thing. An earlier version had a
// possession-shape alternative with no inventory term at all
// ("does|do|is|are ... have|deploy|operate"), which refused any question of the
// form "Does the Senate have a filibuster?" or "Are corporations able to
// operate overseas?" with the fog-of-war message, before generation and at zero
// cost, so it never even looked like a model failure (observed 2026-09-05).
const PRIVATE_MILITARY_QUESTION = new RegExp([
  // "How many battalions does Northland currently deploy?"
  String.raw`\bhow many\b[^?\n]{0,90}\b${MILITARY_INVENTORY}\b`,
  // "Which carrier groups does the UK have?"
  String.raw`\b(?:which|what)\b[^?\n]{0,45}\b${MILITARY_INVENTORY}\b[^?\n]{0,45}\b(?:does|do)\b[^?\n]{0,45}\b${POSSESSION_VERB}\b`,
  // "What is Northland's readiness?"
  String.raw`\bwhat(?:'?s| is)\b[^?\n]{0,75}\b${FORCE_STATE}\b`,
  // "Does Northland have a Logistics Command?", either word order.
  String.raw`\b(?:does|do|is|are)\b[^?\n]{0,60}\b${POSSESSION_VERB}\b[^?\n]{0,60}\b${MILITARY_INVENTORY}\b`,
  String.raw`\b(?:does|do|is|are)\b[^?\n]{0,60}\b${MILITARY_INVENTORY}\b[^?\n]{0,60}\b${POSSESSION_VERB}\b`,
  // "Is the US army at high readiness?"
  String.raw`\b(?:does|do|is|are)\b[^?\n]{0,80}\b${FORCE_STATE}\b`,
  // "What is on the current roster of the DDR's divisions?"
  String.raw`\b(?:current|live|roster|force composition|order of battle)\b[^?\n]{0,90}\b${MILITARY_INVENTORY}\b`,
  // "Compare the current militaries of the US, UK, and East Germany."
  String.raw`\b(?:compare|rank)\b[^?\n]{0,100}\b(?:current|live)\b[^?\n]{0,70}\b(?:militar(?:y|ies)|arm(?:y|ies)|armed forces?)\b`,
].join("|"), "i");
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
  // Classes of military thing. A sentence can open with any of these
  // ("Carriers project air power at range...") and still be pure mechanics:
  // they name a kind of asset, never a country or a player that holds one.
  "destroyer", "cruiser", "frigate", "battleship", "corvette", "escort", "screen", "screening",
  "convoy", "patrol", "blockade", "torpedo", "artillery", "infantry", "armor", "armour",
  "armored", "armoured", "mechanized", "mechanised", "fighter", "bomber", "interceptor",
  "helicopter", "warhead", "marine", "paratrooper", "garrison", "supply", "logistic",
  "front", "port", "base", "radar", "sonar", "warship", "vessel", "boat", "mission",
  "battle", "war", "conflict", "country", "nation", "state", "player", "turn", "game",
  "navy", "navies", "fleet", "army", "armies", "air", "sea", "land", "ground", "capital",
  // Ordinary sentence openers. The name scan reads a capitalized word as a
  // possible country or player, so every word a mechanics answer can legitimately
  // start a sentence with has to be listed as not-a-name.
  "it", "they", "them", "this", "that", "these", "those", "there", "here", "both", "all",
  "most", "some", "any", "none", "only", "after", "before", "once", "while", "unless",
  "because", "and", "but", "or", "so", "also", "then", "next", "first", "second", "third",
  "use", "using", "open", "go", "set", "move", "assign", "choose", "put", "keep", "select",
  "send", "fly", "order", "build", "buy", "place", "hold", "run", "add", "note", "remember",
  "supplied", "unsupplied", "supplies", "losses", "loss", "damage", "combat", "engage",
  "attack", "attacker", "defender", "defence", "defense", "cost", "costs", "price", "range",
  "group", "strike", "amphibious", "guided", "hull", "berth", "assault", "support",
  "reserve", "home", "allied", "neutral", "heavy", "light", "medium", "type", "role",
]);

// GENERIC_NAME_WORDS is written in the singular where a plural reads oddly, so
// look a word up both ways. Without this "Carriers" is an unknown proper noun
// while "carrier" is ordinary vocabulary, which is how a naval mechanics answer
// ends up classified as somebody's roster.
function isGenericNameWord(word) {
  const raw = String(word).toLowerCase().replace(/['\u2019]s$/, "");
  if (GENERIC_NAME_WORDS.has(raw)) return true;
  return GENERIC_NAME_WORDS.has(raw.replace(/ies$/, "y").replace(/(?:es|s)$/, ""));
}
const PRIVATE_MILITARY_REFUSAL = "This answer is public, so I can't publish live military rosters, unit or command composition, readiness, deployments, or force strength. I can explain the mechanics or summarize the public war record instead.";

// "What is the benefit of aircraft carriers vs screening ships and submarines?"
// asks how a class of asset works. It names no country, asks for nothing live,
// and its answer is rules, not a roster. Both of the two most recent player
// reports (2026-09-05, "Refusal" and "Answer shut down due to pulling from live
// data") were this shape and got the fog-of-war message.
// A country code is a holder even though it is written in capitals, unlike the
// mission acronyms (CAP, PATROL, SOE) the name scan deliberately ignores.
const HOLDER_CODE = /\b(?:US|USA|UK|GB|GBR|RU|USSR|SU|DD|DDR|GDR|BRD|FRG|FR|DE|GER|PRC|CN|JP|IT|ES|CA|AU|IN|PL|CS|HU|RO|BG|YU|KP|KR|VN|EG|IL|IR|TR|BR|MX|AR|ZA|NL|BE|SE|NO|DK|FI|CH|AT|PT|GR|IE|NATO)\b/;
// "Currently", "right now", "as of turn 540": a claim about the running world
// rather than about the rules. Mechanics answers do not need one.
const LIVE_CLAIM = /\b(?:currently|right now|at present|as of|this turn|at the moment)\b|\b(?:current|live)\s+(?:roster|deployment|force|forces|strength|composition|readiness)\b/i;
const LIVE_QUESTION_MARKER = /\b(?:current|currently|live|right now|today|at the moment|as of|this turn|now)\b/i;

// Words a player capitalizes because they started a sentence or wrote "I", not
// because they named anybody. Only the question scan uses these: the sentence
// scan on the answer stays strict.
const QUESTION_FILLER = new Set([
  "i", "we", "my", "our", "you", "your", "it", "its", "they", "their", "he", "she",
  "what", "whats", "how", "why", "when", "where", "which", "who", "whose",
  "do", "does", "did", "is", "are", "was", "were", "can", "could", "should", "would", "will",
  "if", "in", "on", "at", "for", "and", "or", "but", "so", "also", "the", "a", "an", "as",
  "explain", "tell", "give", "show", "list", "compare", "help", "please", "hi", "hey", "ok",
  "im", "ive", "id", "dont", "doesnt", "cant", "need", "want", "just", "any", "some",
]);

function isClassMechanicsQuestion(question) {
  const text = String(question || "");
  if (!text.trim()) return false;
  if (LIVE_QUESTION_MARKER.test(text)) return false;
  if (FORCE_INVENTORY.test(text) || PRIVATE_MILITARY_QUESTION.test(text)) return false;
  // Any proper noun or country code in the question can be a holder, and an
  // acronym is a country far more often than it is a game term here.
  return ![...text.matchAll(CAPITALIZED_ANYWHERE)].some((match) => !isGenericNameWord(match[0])
    && !QUESTION_FILLER.has(match[0].toLowerCase().replace(/['\u2019]/g, "")));
}

// Under a class question the only thing that can leak is force attributed to a
// holder, so look for the attribution rather than for capital letters. An
// unknown capitalized word is a holder when it acts ("Northland maintains",
// "East has"), when it owns ("Northland's fleet"), or when it qualifies a force
// ("The German army"). It is not a holder when it is part of a unit type name,
// which is why a table row like "| Carrier Strike Group | 3 |" was being read
// as somebody's order of battle (observed live 2026-09-05).
const HOLDER_VERB = /^(?:has|have|had|is|are|was|were|operates?|maintains?|fields?|deploys?|stations?|lacks?|keeps?|holds?|runs?|consists?|includes?|contains?|currently|now|still)$/i;
const HOLDER_FORCE_NOUN = /^(?:forces?|army|armies|navy|navies|militar(?:y|ies)|fleets?|troops?|divisions?|brigades?|regiments?|battalions?|squadrons?)$/i;
const TABLE_ROW = /^\s*\|/;

// "Guided-Missile Destroyer" is two ordinary words joined, not a proper noun.
function isKnownWord(word) {
  return String(word).split("-").filter(Boolean).every((part) => isGenericNameWord(part));
}

function namesHolder(sentence) {
  const words = String(sentence).split(/[\s/]+/).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z'\u2019-]+$/g, ""));
  let unknownNames = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!word || !/^[A-Z]/.test(word)) continue;
    if (isKnownWord(word)) continue;
    if (/^[A-Z0-9_]{2,}$/.test(word)) continue;          // CAP, PATROL, SOE: mission acronyms
    if (/['\u2019]s$/.test(word)) return true;              // "Northland's fleet"
    unknownNames += 1;
    const next = words[i + 1] || "";
    if (HOLDER_VERB.test(next) || HOLDER_FORCE_NOUN.test(next)) return true;
  }
  // Nothing in a rules table is a name. A name in one is a roster.
  return TABLE_ROW.test(sentence) && unknownNames > 0;
}

function isGenericMilitaryMechanicSentence(sentence, question) {
  const text = sentence.trim();
  if (PUBLIC_NUCLEAR_RECORD.test(text) && PUBLIC_NUCLEAR_RECORD.test(question)) return true;
  if (GENERIC_MILITARY_MECHANIC.test(text)) return true;
  const normalizedQuestion = queryAliases.normalizePlayerWording(question);
  const classQuestion = isClassMechanicsQuestion(question);
  if (!classQuestion && !GENERIC_MECHANICS_QUESTION.test(normalizedQuestion)) return false;
  if (GENERIC_MECHANIC_INSTRUCTION.test(text) && !LIVE_INSTRUCTION_TARGET.test(text)) return true;
  const hasUnknownName = [...text.matchAll(CAPITALIZED_ANYWHERE)]
    .some((match) => !/^[A-Z0-9_]{2,}$/.test(match[0]) && !isGenericNameWord(match[0]));
  if (GENERIC_HYPOTHETICAL.test(text) && !hasUnknownName) return true;
  // Nothing in a class question points at a holder, so the answer can only leak
  // by naming one itself or by dating itself to the live world.
  if (classQuestion) return !namesHolder(text) && !HOLDER_CODE.test(text) && !LIVE_CLAIM.test(text);
  if (/\b(?:your|their|our|its|this|that)\s+(?:country|nation|force|forces|army|military)\b/i.test(text)) return false;
  const subject = text.match(CAPITALIZED_WORD)?.[0];
  if (subject && !isGenericNameWord(subject)) return false;
  return ![...text.matchAll(CAPITALIZED_LOCATION)].some((match) => !isGenericNameWord(match[1]));
}

// Inventory words that also live in civilian vocabulary. "The market includes
// 500,000 units" tripped FORCE_POSSESSION and replaced a stock-price answer
// with the military refusal (observed live 2026-08-31). These only count as
// military when the sentence or the question carries military context; the
// unambiguous inventory (divisions, fleets, warheads, carrier groups...)
// still triggers on its own.
const AMBIGUOUS_INVENTORY = /\b(?:units?|equipment|personnel|commands?|wings?|ships?|aircraft|corps)\b/i;
const UNAMBIGUOUS_INVENTORY = /\b(?:logistics? commands?|airlift wings?|formations?|divisions?|brigades?|battalions?|regiments?|squadrons?|fleets?|carrier groups?|task forces?|naval assets?|air assets?|troops?|readiness|deployments?|force strength|army strength|military strength|tanks?|submarines?|missiles?|nuclear weapons?|warheads?|destroyers?|cruisers?|frigates?|battleships?|corvettes?|warships?|bombers?|carriers?|fighters?)\b/i;
const MILITARY_CONTEXT = /\b(?:militar\w*|arm(?:y|ies)|nav(?:y|ies)|naval|air force|war|wars|combat|battle|front|deploy\w*|garrison\w*|invasion|offensive|defen[cs]e|troops?|soldiers?|roster|readiness|conflict|armou?red|infantry|mechani[sz]ed|artillery|fighters?|bombers?|warships?|station\w*)\b/i;

function sentenceHasMilitaryMeaning(sentence, question) {
  if (UNAMBIGUOUS_INVENTORY.test(sentence)) return true;
  if (!AMBIGUOUS_INVENTORY.test(sentence)) return true;
  return MILITARY_CONTEXT.test(sentence) || MILITARY_CONTEXT.test(String(question || ""));
}

// A markdown table is one statement split over lines: the header holds the
// inventory word and the rows hold the numbers, so splitting on newlines hides
// "| Carriers |" over "| Northland | 3 |" from every quantity pattern.
function statements(answer) {
  const out = [];
  let table = [];
  for (const line of String(answer || "").split(/\n/)) {
    if (TABLE_ROW.test(line)) { table.push(line.trim()); continue; }
    if (table.length) { out.push(table.join(" ")); table = []; }
    for (const part of line.split(/(?<=[.!?])\s+/)) if (part.trim()) out.push(part);
  }
  if (table.length) out.push(table.join(" "));
  return out;
}

function containsPrivateMilitaryIntelligence(answer, question = "") {
  return statements(answer).some((sentence) => {
    if (isGenericMilitaryMechanicSentence(sentence, question)) return false;
    const tripped = FORCE_INVENTORY.test(sentence) || FORCE_POSSESSION.test(sentence)
      || FORCE_QUANTITY.test(sentence) || FORCE_ABSENCE.test(sentence) || FORCE_OPERATION.test(sentence);
    if (!tripped) return false;
    return sentenceHasMilitaryMeaning(sentence, question);
  });
}

// The same civilian-vocabulary problem the answer side already solves: a
// question about "units of oil" or "shipping equipment" trips the inventory
// list without being about the military at all. Ambiguous words only count as
// military when the question carries military context.
function questionHasMilitaryMeaning(question) {
  const text = String(question || "");
  if (UNAMBIGUOUS_INVENTORY.test(text)) return true;
  if (!AMBIGUOUS_INVENTORY.test(text)) return true;
  return MILITARY_CONTEXT.test(text);
}

function asksForPrivateMilitaryIntelligence(question) {
  const text = String(question || "");
  if (PUBLIC_NUCLEAR_RECORD.test(text)) return false;
  if (!FORCE_INVENTORY.test(text) && !PRIVATE_MILITARY_QUESTION.test(text)) return false;
  return questionHasMilitaryMeaning(text);
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
