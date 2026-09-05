"use strict";
// Hand curation of the real query pool.
//
// ask.db rows are keyed by their id in the local historical database; the
// replay feed by answerId; the committed eval files by their own ids. Skips are
// follow-ups that need an antecedent ("where in the UI"), test rows ("q0"),
// questions about other games (Grand Century, MetroForge have their own
// indexes), and templated duplicates that differ only by an entity name.
//
// The kind taxonomy: symbol (asks by identifier), mechanic (one rule or
// number), causal (systems interacting, why something happened), navigation
// (where to click), live (needs live game state or a visualization; retrieval
// is secondary), meta (about Ask itself, changelog, or opinion).

const ASK_DB_SKIP = new Set([2, 3, 4, 5, 6, 7, 9, 15, 22, 44, 48, 49, 62, 65, 73, 75, 84, 88, 91, 98, 99, 105, 106, 122, 124, 126, 130,
  154, 156, 167, 204, 205, 206, 215, 216, 219, 223, 224, 226, 227, 232, 234, 237]);

const ASK_DB_KIND = {};
for (const id of [1, 8, 10, 18, 19, 25, 27, 30, 36, 37, 46, 47, 50, 52, 53, 55, 58, 59, 71, 72, 74, 76, 77, 80, 81, 83, 85, 97, 103, 104, 112, 114,
  116, 119, 134, 136, 139, 148, 149, 150, 159, 171, 173, 174, 183, 185, 192, 196, 197, 198, 199, 203, 210, 212, 220, 222, 225, 243, 133, 153]) ASK_DB_KIND[id] = "live";
for (const id of [20, 24, 78, 86, 94, 108, 118, 128, 144, 162, 165, 166, 169, 170, 202, 229, 236]) ASK_DB_KIND[id] = "causal";
for (const id of [11, 12, 13, 17, 23, 35, 39, 43, 45, 57, 60, 61, 67, 68, 69, 70, 92, 93, 107, 109, 110, 117, 127, 129, 131, 132, 137, 138, 140, 141,
  143, 145, 151, 155, 160, 161, 163, 164, 168, 172, 177, 178, 180, 181, 184, 186, 189, 190, 200, 201, 208, 211, 218, 230, 238, 239, 240, 241, 244,
  194, 195, 221]) ASK_DB_KIND[id] = "mechanic";
for (const id of [79]) ASK_DB_KIND[id] = "symbol";
ASK_DB_KIND[90] = "mechanic"; ASK_DB_KIND[228] = "live";
for (const id of [63, 64, 66, 121, 123, 125]) ASK_DB_KIND[id] = "navigation";
for (const id of [38, 40, 41, 42, 101, 102, 142, 213, 214, 231]) ASK_DB_KIND[id] = "meta";
// Rows that dedupe into another source keep a kind so the survivor is tagged
// whichever copy wins: 133/153 (wealth history), 194/195 (war), 221 (worst player).
ASK_DB_KIND[194] = "live"; ASK_DB_KIND[195] = "live"; ASK_DB_KIND[221] = "live";

const REPLAY_SKIP = new Set([105, 89, 15, 4, 1]);
const REPLAY_KIND = {
  179: "mechanic", 167: "live", 163: "mechanic", 162: "mechanic", 161: "mechanic", 158: "mechanic", 154: "mechanic", 153: "mechanic",
  136: "live", 129: "live", 124: "mechanic", 113: "mechanic", 102: "live", 90: "meta", 85: "causal", 70: "live", 57: "causal",
  52: "mechanic", 35: "navigation", 32: "mechanic", 25: "mechanic", 23: "mechanic", 18: "mechanic", 6: "causal", 5: "live", 3: "mechanic",
};

const REPORTED_FAILURES_KIND = {
  "wealth-history-not-formula": "live", "logistics-unit-not-corporate-freight": "mechanic", "live-roster-fair-play-refusal": "live",
  "live-roster-no-false-absence": "live", "logistics-overextension-not-roster": "causal", "head-of-government-national-influence": "mechanic",
  "blockade-mechanics-direct-answer": "mechanic", "blockade-navigation-direct-answer": "navigation", "logistics-topic-pivot-after-cas": "mechanic",
};

const GENERAL_REPLAY_SKIP = new Set([14, 22, 48, 156, 215, "recent-followup-tool-leak"]);
const GENERAL_REPLAY_KIND = {
  13: "mechanic", 36: "live", 89: "mechanic", 92: "mechanic", 102: "meta", 177: "mechanic",
  "recent-player-ranking": "live", "recent-corporation-market-gaps": "live", "recent-german-air-system": "mechanic", "recent-state-corp-privatization": "mechanic",
};

const CORPUS_CANDIDATES_KIND = ["live", "live", "live", "mechanic"];

const TICKET_SKIP = new Set(["ticket-1234-air", "ticket-1234-navigation"]);
const TICKET_KIND = { "ticket-1234-blockade": "mechanic", "ticket-1234-role-save": "mechanic", "ticket-1234-front": "causal", "ticket-1234-nuclear": "mechanic" };

// The repo is public. Player and character names are replaced before a query
// is stored; corporation and country names are in-game entities and stay.
const ANONYMIZE = [
  [/Wise\s+[\s\S]*?Also question\s+/i, ""],
  [/<@\d+>\s*/g, ""],
  [/\bEgg's\b/g, "my"],
  [/\bfor Egg\b/g, "for my character"],
  [/\bNikolaus von Freiburg's\b/g, "my"],
  [/\bBakhyt Abdullayev's\b/g, "my"],
  [/\btweamonster\b/gi, "ExamplePlayer"],
  [/\s*Unlike poppy\?/i, ""],
  [/\s*[\u2014\u2013]\s*/g, ", "],
];

function anonymize(text) {
  let t = String(text || "");
  for (const [re, rep] of ANONYMIZE) t = t.replace(re, rep);
  return t.replace(/\s+/g, " ").trim();
}

function dedupeKey(text) {
  return anonymize(text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const KINDS = ["symbol", "mechanic", "causal", "navigation", "live", "meta"];

module.exports = {
  ASK_DB_SKIP, ASK_DB_KIND, REPLAY_SKIP, REPLAY_KIND, REPORTED_FAILURES_KIND, GENERAL_REPLAY_SKIP, GENERAL_REPLAY_KIND,
  CORPUS_CANDIDATES_KIND, TICKET_SKIP, TICKET_KIND, anonymize, dedupeKey, KINDS,
};
