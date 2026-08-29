"use strict";

// Adversarial stump harness. Drives the REAL pipeline — router, decompose,
// searchMulti, corrections, live intelligence, scout, prompt.build, the
// production chain via llm.stream, then the same guards the server runs —
// WITHOUT recording anything into asks or touching quota. Results land in
// eval/stump-results.json for grading.
//
// Usage: node eval/stump.js [--only=3,5] (1-based indices)
const path = require("node:path");
const fs = require("node:fs");
process.chdir(path.join(__dirname, ".."));

const router = require("../router");
const retrieve = require("../retrieve");
const grounding = require("../grounding");
const corrections = require("../corrections");
const investigate = require("../investigate");
const mcp = require("../mcp");
const prompt = require("../prompt");
const llm = require("../llm");
const answerGuard = require("../answer-guard");
const askPlan = require("../ask-plan");
const games = require("../games");
const navigation = require("../navigation");
const history = require("../history");

// A believable non-staff player context, so self-pinned tools exercise the
// real privacy path instead of a staff bypass.
const CONTEXT = {
  username: "egg3901",
  character: { name: "Egg", country: "US", party: "Republican Party" },
  corporation: { name: "Tinky Winky Corporation", role: "ceo" },
  isAdmin: false, isModerator: false,
};

const CASES = [
  { id: "wealth-trend", live: true, q: "Show how my own savings and wealth changed over recent turns. Visualize the largest change." },
  { id: "war-winner", live: true, q: "Who is winning the war in Germany right now, and what has it cost both sides so far?" },
  { id: "war-bridge", live: true, q: "If the US wins the war for Germany, what happens to my defense corporations' contracts and revenue afterwards?" },
  { id: "mercenaries", live: false, q: "How do I recruit mercenaries to fight for my country?" },
  { id: "strongest-military", live: true, q: "What is the strongest military in the game right now?" },
  { id: "ca-unemployment", live: true, q: "How has unemployment in California changed over the last year, and what explains the move?" },
  { id: "us-inflation-series", live: true, q: "Show me the trend of US national inflation over the past 50 turns." },
  { id: "cloture", live: false, q: "Does cloture need 60 votes in the Senate?" },
  { id: "corp-compare", live: true, q: "Tinky corp vs meyer corp: which is the better buy right now?" },
  { id: "division-cost", live: true, q: "How much would it cost me to raise 3 armored divisions at tech tier 2, and how long until they are combat ready?" },
  { id: "spy-savings", live: true, q: "Show me exactly how much money the richest player in Germany has in savings." },
  { id: "cross-game", live: false, q: "In Grand Century, how does the economy simulation differ from A House Divided's?" },
  { id: "change-elections", live: false, q: "Did something change with elections recently? My snap election fired at a different time than I expected." },
  { id: "change-stocks", live: true, q: "Why did my stocks fall this week? Was it a code change?" },
  { id: "change-none", live: false, q: "Why did my approval suddenly drop after I passed a popular bill?" },
];

async function runCase(c) {
  const started = Date.now();
  const game = games.resolve("ahd");
  const plan = askPlan.create(c.q, CONTEXT);
  const route = router.choose({ question: c.q, length: "standard", style: "standard", useMcp: c.live, isFollowup: false, visualizations: false, report: false });

  const subQueries = route.tier === "flash" ? [] : await grounding.decompose(c.q).catch(() => []);
  const hits = await retrieve.searchMulti(c.q, subQueries, { game }).catch(() => null);
  const matched = await corrections.match(c.q).catch(() => []);

  // Change questions: the deterministic git-history pass, then the scout only
  // when it found nothing — same gating as the server.
  let historyBlock = "";
  const changeQuestion = history.changeish(c.q) && await history.available(game);
  if (changeQuestion) {
    const recent = await history.evidence({ game, question: c.q, paths: hits?.files || [], code: hits?.context || "" }).catch(() => null);
    historyBlock = recent ? recent.text : "";
  }

  let liveBlock = "", liveTargeted = false;
  if (c.live) {
    try {
      const intel = await mcp.liveIntelligence(c.q, CONTEXT, null, plan, null);
      liveBlock = intel.text || "";
      liveTargeted = intel.targeted === true;
    } catch {}
  }
  // Mirror server: flash runs the scout when live heuristics missed, and any
  // live trend question scouts so the history tools are reachable.
  let investigation = null;
  const liveMissedTarget = c.live && !liveTargeted;
  const trendish = /\b(trend|history|over (?:the )?(?:last|past|recent)|chang(?:e|ed|es|ing)|since (?:19|20)\d\d|turn.by.turn|evolv)/i.test(c.q);
  const chaseChange = changeQuestion && historyBlock === "";
  if (route.tier !== "flash" || liveMissedTarget || (c.live && trendish) || chaseChange) {
    investigation = await investigate.run({ question: c.q, context: CONTEXT, useLive: c.live, deep: false, game, changeQuestion }).catch(() => null);
  }
  const navBlock = navigation.block(c.q);

  const system = prompt.build({ style: "standard", length: "standard", context: CONTEXT, indexContext: "", visualizations: false, visualizationRequested: false, liveData: c.live, report: false, game, changeHistory: historyBlock !== "" })
    + (matched.length ? `\n\n${corrections.block(matched)}` : "")
    + (hits ? `\n\n${hits.context}` : "")
    + (historyBlock ? `\n\n${historyBlock}` : "")
    + (liveBlock ? `\n\n${liveBlock}` : "")
    + (investigation ? `\n\n${investigation.text}` : "")
    + (navBlock ? `\n\n${navBlock}` : "");

  const out = await llm.stream({ system, history: [], question: c.q, deep: false, tier: route.tier, chain: route.chain, effort: route.effort, onDelta: () => {} });
  const raw = out.text || "";
  const { text: answer } = prompt.extractFollowups(raw);

  const evidence = [matched.length ? corrections.block(matched) : "", hits?.context, historyBlock, liveBlock, investigation?.text].filter(Boolean).join("\n\n");
  const claims = await grounding.check(answer, evidence).catch(() => []);
  const split = grounding.classifyPaths(answer, evidence, retrieve.hasPath);
  const issues = answerGuard.inspect(answer, plan);
  const refused = answerGuard.detectRefusal(answer, c.live) && c.live;
  const narrated = answerGuard.detectBundleNarration(answer);

  return {
    id: c.id, question: c.q, tier: route.tier, model: out.model, seconds: Math.round((Date.now() - started) / 1000),
    correctionsInjected: matched.map(m => m.question),
    scoutTools: investigation?.tools || [],
    liveTargeted,
    validation: { issues, refused, narrated, grounding: claims, inventedPaths: split.invented, missedPaths: split.missed },
    answer,
  };
}

(async () => {
  const only = (process.argv.find(a => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean).map(Number);
  const cases = only.length ? CASES.filter((_, i) => only.includes(i + 1)) : CASES;
  const results = [];
  for (const c of cases) {
    process.stderr.write(`[stump] ${c.id}…\n`);
    try {
      const r = await runCase(c);
      process.stderr.write(`[stump] ${c.id} done in ${r.seconds}s model=${r.model} issues=${JSON.stringify(r.validation.issues)} grounding=${r.validation.grounding.length}\n`);
      results.push(r);
    } catch (e) {
      process.stderr.write(`[stump] ${c.id} FAILED: ${e.message}\n`);
      results.push({ id: c.id, question: c.q, error: String(e.message || e) });
    }
    const file = path.join(__dirname, "stump-results.json");
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
  }
  console.log(`wrote ${results.length} results`);
  process.exit(0);
})();
