const test = require("node:test");
const assert = require("node:assert");
const grounding = require("./grounding");
const investigate = require("./investigate");

test("causal and formula questions require a mechanic evidence pass", () => {
  assert.equal(investigate.needsMechanicEvidence("What would lower US inflation fastest?"), true);
  assert.equal(investigate.needsMechanicEvidence("How is GDP growth calculated each turn?"), true);
  assert.equal(investigate.needsMechanicEvidence("What is the US inflation rate?"), false);
  assert.equal(investigate.needsMechanicEvidence("How do I solve input limits for my corp?"), true);
  assert.equal(investigate.needsMechanicEvidence("Where do tech LC prices come from?"), true);
});

test("preserves named stats when condensing a vague follow-up", () => {
  const history = [
    { role: "user", content: "How do I increase Readiness, Logistics, Mandate, and Intelligence?" },
    { role: "assistant", content: "Those are national capacity scores." },
  ];
  const terms = grounding.namedContextTerms(history, "How can I increase the scores?");
  assert.deepEqual(terms, ["Readiness", "Logistics", "Mandate", "Intelligence"]);
  assert.equal(
    grounding.restoreContextTerms(null, history, "How can I increase the scores?"),
    "How can I increase the scores?: Readiness, Logistics, Mandate, Intelligence",
  );
});

test("no ungrounded claims means no note at all", () => {
  assert.equal(grounding.note([]), "");
  assert.equal(grounding.note(null), "");
});

test("the note names every claim and drops trailing periods", () => {
  const n = grounding.note(["inflation drives the prime rate.", "credit ratings decay on spreads"]);
  assert.match(n, /Grounding check/);
  assert.match(n, /inflation drives the prime rate; credit ratings decay on spreads\./);
  assert.ok(!n.includes(".."));
});

test("the investigator live allowlist excludes forensic and moderation tools", () => {
  for (const banned of ["trace_account", "alt_ring_audit", "alt_rank", "audit_query", "trace_actions", "trace_ledger", "trace_bonds", "election_sim_results"]) {
    assert.ok(!investigate.LIVE_ALLOWLIST.has(banned), `${banned} must not be reachable`);
  }
  assert.ok(investigate.LIVE_ALLOWLIST.has("trace_corp"));
});

test("the investigator can reach the public aggregate and map tools", () => {
  // Their absence is why Ask told players that rankings, counts, distributions
  // and candidate maps "are not available in the source" while the tools to
  // compute them sat one call away.
  for (const needed of [
    "analytics_catalog", "analytics_query", "corporation_rankings",
    "map_snapshot", "geo_aggregate", "country_fiscal", "legislation_catalog",
  ]) {
    assert.ok(investigate.LIVE_ALLOWLIST.has(needed), `${needed} must be reachable`);
  }
});

test("every character-scoped tool is pinned to the asker, not just trace_character", () => {
  for (const scoped of investigate.SELF_ONLY_TOOLS) {
    assert.ok(investigate.LIVE_ALLOWLIST.has(scoped), `${scoped} is pinned but unreachable`);
  }
  assert.ok(investigate.SELF_ONLY_TOOLS.has("trace_character"));
  assert.ok(investigate.SELF_ONLY_TOOLS.has("character_balance_sheet"));
});

test("a path never shown to the model is flagged, cited evidence paths are not", () => {
  const evidence = "--- SOURCE code @ abc | src/lib/turn/bondTurn.ts (part 1) ---\nstuff\n--- src/lib/constants/bonds.ts ---\nmore";
  const answer = "Coupons come from src/lib/turn/bondTurn.ts and inflation from src/lib/turn/inflationTurn.ts.";
  const flagged = require("./grounding").inventedPaths(answer, evidence);
  assert.deepEqual(flagged, ["src/lib/turn/inflationTurn.ts"]);
  assert.match(require("./grounding").pathNote(flagged), /Source check/);
  assert.equal(require("./grounding").pathNote([]), "");
});

test("corrections block names the lesson and asserts precedence", () => {
  const corrections = require("./corrections");
  const b = corrections.block([{ question: "How does cloture work?", correction: "Cloture needs 3/5 of votes cast, not 60 votes." }]);
  assert.match(b, /CURATED CORRECTIONS/);
  assert.match(b, /3\/5 of votes cast/);
  assert.match(b, /correction wins/);
  assert.equal(corrections.block([]), "");
});

test("the investigator scales its caps with question depth", () => {
  const source = require("node:fs").readFileSync(require.resolve("./investigate.js"), "utf8");
  assert.match(source, /deep \? CAPS\.deep : CAPS\.standard/);
  assert.match(source, /SEARCHED AND NOT FOUND/);
});

test("report detection catches generation asks and skips the support flow", () => {
  const server = require("node:fs").readFileSync(require.resolve("./server.js"), "utf8");
  const re = new RegExp(server.match(/const REPORT_RE = \/(.+)\/i;/)[1], "i");
  for (const yes of [
    "generate a report on the steel market",
    "Write up a detailed report about the 1953 economy",
    "give me a report covering my corporation's sector",
    "make a full report on inflation and bonds",
  ]) assert.ok(re.test(yes), `should match: ${yes}`);
  for (const no of [
    "how do I report a bug",
    "I want to report a player for cheating",
    "where do I report exploits",
    "what does the quarterly report screen show",
  ]) assert.ok(!re.test(no), `should NOT match: ${no}`);
});

test("a report answer uses the report format instead of the length brief", () => {
  const prompt = require("./prompt");
  const report = prompt.build({ report: true });
  assert.match(report, /REPORT FORMAT/);
  assert.ok(!report.includes("Aim for roughly"));
  const normal = prompt.build({});
  assert.match(normal, /Aim for roughly/);
  assert.ok(!normal.includes("REPORT FORMAT"));
});

test("helper chain leads with a free OpenRouter model and keeps the DeepSeek backstop", () => {
  const llm = require("./llm");
  assert.ok(llm.HELPER_CHAIN[0].endsWith(":free"), "free model must lead");
  assert.ok(llm.HELPER_CHAIN.includes("deepseek-v4-flash"), "paid backstop must remain");
});

test("report pages round-trip through the store", () => {
  const store = require("./store");
  const token = "testtoken" + Math.floor(Date.now() % 1e9);
  store.putReport({ token, userKey: "test:probe", username: "probe", answerId: null, title: "T", question: "Q", body: "# T\n\nBody", model: "deepseek-v4-flash" });
  const back = store.getReport(token);
  assert.equal(back.title, "T");
  assert.match(require("./page").reportView(back), /report-body/);
  store.db.prepare("DELETE FROM reports WHERE token=?").run(token);
});

test("the investigation prompt block is wired into the answer prompt", () => {
  const server = require("node:fs").readFileSync(require.resolve("./server.js"), "utf8");
  assert.match(server, /investigation \? `\\n\\n\$\{investigation\.text\}` : ""/);
  assert.match(server, /grounding\.check\(answer, evidenceForCheck\)/);
});

test("a cited file that really exists is a retrieval miss, not an invention", () => {
  const grounding = require("./grounding");
  const evidence = "--- src/lib/turn/bondTurn.ts ---\nstuff";
  const answer = "Coupons: src/lib/turn/bondTurn.ts. Influence: src/lib/influence/constants.ts. Metrics: src/lib/madeUp.ts.";
  const exists = p => p === "src/lib/influence/constants.ts";
  const { missed, invented } = grounding.classifyPaths(answer, evidence, exists);
  assert.deepEqual(missed, ["src/lib/influence/constants.ts"]);
  assert.deepEqual(invented, ["src/lib/madeUp.ts"]);
});

test("the two path notes say different things and neither calls a real file bogus", () => {
  const grounding = require("./grounding");
  const invented = grounding.pathNote(["src/lib/madeUp.ts"]);
  const missed = grounding.missedPathNote(["src/lib/influence/constants.ts"]);
  assert.match(invented, /does not exist/);
  assert.match(missed, /is a real file/);
  // The old wording told players a correct citation was "not among the files I
  // actually read", which reads as though the path itself were made up.
  assert.doesNotMatch(missed, /not among the files/);
  assert.equal(grounding.pathNote([]), "");
  assert.equal(grounding.missedPathNote([]), "");
});

test("with no index available nothing is called a retrieval miss", () => {
  const grounding = require("./grounding");
  const { missed, invented } = grounding.classifyPaths(
    "See src/lib/anything.ts.", "no evidence here", undefined);
  assert.deepEqual(missed, []);
  assert.deepEqual(invented, ["src/lib/anything.ts"]);
});
