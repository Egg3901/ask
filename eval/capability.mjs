// Capability probe over the graded question corpus.
//
// The corpus audit graded every question Ask has answered and labelled each
// failure with the capability a correct answer needed. This asserts those
// capabilities are actually reachable now — deterministically, with no model
// calls, so it can gate a deploy.
//
// It does NOT claim the answers are good. That needs the replay harness and a
// judge. What it proves is narrower and still worth having: the machinery a
// failed question needed is wired up, so the same question cannot fail the same
// structural way twice.
//
// The corpus holds real player questions and therefore lives outside this repo,
// exactly like ask.db. Point ASK_EVAL_CORPUS at it:
//
//   ASK_EVAL_CORPUS=/path/to/golden_corpus.json node eval/capability.mjs
//
// Exits non-zero if any capability regressed.

import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const guard = require("../answer-guard.js");
const navigation = require("../navigation.js");
const investigate = require("../investigate.js");
const mcp = require("../mcp.js");
const retrieve = require("../retrieve.js");

const CORPUS = process.env.ASK_EVAL_CORPUS
  || "/root/misc/ask-remediation/review/golden_corpus.json";

if (!fs.existsSync(CORPUS)) {
  console.error(`no corpus at ${CORPUS}; set ASK_EVAL_CORPUS`);
  process.exit(2);
}
const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8"));

// Each capability answers: is the machinery a failed question needed present?
// `null` means the check cannot run without a live model or session, and is
// reported as unproven rather than passed.
const CHECKS = {
  navigation: q => navigation.isNavigationQuestion(q.question) && navigation.block(q.question).length > 0,

  public_aggregate: () => ["analytics_catalog", "analytics_query", "corporation_rankings",
    "geo_aggregate", "map_snapshot"].every(t => investigate.LIVE_ALLOWLIST.has(t)),

  resolve_entity: () => investigate.LIVE_ALLOWLIST.has("entity_search"),

  identity_binding: () => investigate.SELF_ONLY_TOOLS.has("trace_character")
    && investigate.SELF_ONLY_TOOLS.has("character_balance_sheet")
    && [...investigate.SELF_ONLY_TOOLS].every(t => investigate.LIVE_ALLOWLIST.has(t)),

  clean_output: () => guard.looksLikeToolLeak("text<tool_call><function=search_code>") === true
    && guard.looksLikeToolLeak("a normal answer about inflation") === false,

  complete_output: () => guard.looksTruncated("x".repeat(300) + " ending mid") === true
    && guard.looksTruncated("x".repeat(300) + " ending properly.") === false,

  relevant_chart: () => guard.datasetMatchesQuestion(
    { metric: "gdp_growth", title: "Live country GDP growth comparison" },
    "Map GOP Senate 1 candidates Real players only") === false,

  // The guard that keeps a bundle-narrating answer out of the shared cache.
  deeper_retrieval: () => guard.detectBundleNarration("The supplied source does not cover that.") === true
    && guard.detectBundleNarration("The salvage fraction is 0.2, in src/lib/constants/corporations.ts.") === false
    && typeof retrieve.searchExact === "function"
    && typeof retrieve.readIndexedFile === "function",

  // Prompt-level contracts. Asserted against the built system prompt so a
  // rewrite that drops them fails here rather than in front of a player.
  compute_value: () => {
    const p = require("../prompt.js").build({ liveData: true });
    return /CALCULATE/.test(p) && /the answer is the number/i.test(p);
  },
  live_provenance: () => {
    const p = require("../prompt.js").build({ liveData: true });
    return /SEEDED CONFIGURATION IS NOT THE LIVE WORLD/.test(p) && /live NEGATIVE/.test(p);
  },

  // Owner ruled 2026-08-27 that recommending public-exchange buys is fair, since
  // any player can read the same figures off the stock market page.
  investment_allowed: () => {
    const p = require("../prompt.js").build({ liveData: true });
    const askPlan = require("../ask-plan.js");
    return /IN-GAME INVESTMENT SUGGESTIONS ARE ALLOWED/.test(p)
      && /only public, exchange-visible data/.test(p)
      && askPlan.create("what corporations should I buy").live === "required";
  },

  missing_data_plane: async () => {
    const tools = await mcp.listTools("gamestate");
    if (!Array.isArray(tools)) return null;
    const names = new Set(tools.map(tool => tool.name));
    return ["wars", "macro_history", "character_wealth_history"].every(name => names.has(name));
  },

  // Mixed bag with no single mechanism; only the replay harness can judge these.
  general: () => null,
};

const byCap = new Map();
for (const row of corpus) {
  if (!row.capability) continue;
  if (!byCap.has(row.capability)) byCap.set(row.capability, []);
  byCap.get(row.capability).push(row);
}

let failed = 0, unproven = 0, covered = 0;
const width = Math.max(...[...byCap.keys()].map(k => k.length));
console.log(`capability probe over ${corpus.length} graded questions\n`);

for (const [cap, rows] of [...byCap].sort((a, b) => b[1].length - a[1].length)) {
  const check = CHECKS[cap];
  let result;
  try { result = check ? await check(rows[0]) : null; } catch (err) { result = false; }
  const ids = rows.map(r => r.id).slice(0, 8).join(",");
  if (result === null) {
    unproven += rows.length;
    console.log(`  ?    ${cap.padEnd(width)}  ${String(rows.length).padStart(2)} questions  unproven here  [${ids}]`);
  } else if (result) {
    covered += rows.length;
    console.log(`  PASS ${cap.padEnd(width)}  ${String(rows.length).padStart(2)} questions  [${ids}]`);
  } else {
    failed += rows.length;
    console.log(`  FAIL ${cap.padEnd(width)}  ${String(rows.length).padStart(2)} questions  [${ids}]`);
  }
}

const graded = covered + failed + unproven;
console.log(`\n${covered}/${graded} failed questions have their capability wired; ${unproven} need the replay harness; ${failed} regressed.`);
process.exit(failed ? 1 : 0);
