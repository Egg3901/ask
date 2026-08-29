"use strict";

// Git-history evidence. The parsing and gating run against a real throwaway
// repo rather than fixtures: the whole module is git's output format, and a
// fixture would only prove the fixture still parses.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const history = require("./history");

test("uses explicit player time windows for change searches", () => {
  assert.equal(history.sinceDaysFor("What changed with Econ in the last 48 hours?"), 2);
  assert.equal(history.sinceDaysFor("What shipped in the past week?"), 7);
  assert.equal(history.sinceDaysFor("Did this change recently?"), history.SINCE_DAYS);
});

test("recognises broad change audits that need a scout after the first match", () => {
  assert.equal(history.broadChangeQuestion("What changed with Econ mechanics in the last 48 hours?"), true);
  assert.equal(history.broadChangeQuestion("Did the prime rate change?"), false);
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" };
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { env: ENV, encoding: "utf8" });

function buildRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-history-"));
  git(dir, "init", "--quiet", "-b", "main");
  fs.mkdirSync(path.join(dir, "src/lib/economy"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/lib/economy/equity.ts"), "export const DIVIDEND_RATE = 0.6;\n");
  git(dir, "add", "-A"); git(dir, "commit", "--quiet", "-m", "feat(economy): seed the exchange (#100)");
  fs.writeFileSync(path.join(dir, "src/lib/economy/equity.ts"), "export const DIVIDEND_RATE = 0.4;\n");
  fs.writeFileSync(path.join(dir, "package-lock.json"), "{}\n");
  git(dir, "add", "-A"); git(dir, "commit", "--quiet", "-m", "fix(economy): cut dividend payout rate (#412)\n\nPayouts outran earnings.");
  // A second branch merged in, so ancestry-path has something real to find.
  git(dir, "checkout", "--quiet", "-b", "side");
  fs.mkdirSync(path.join(dir, "src/lib/elections"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/lib/elections/turnout.ts"), "export const BASE = 0.5;\n");
  git(dir, "add", "-A"); git(dir, "commit", "--quiet", "-m", "feat(elections): turnout model (#500)");
  git(dir, "checkout", "--quiet", "main");
  git(dir, "merge", "--quiet", "--no-ff", "side", "-m", "Merge pull request #501 from side");
  return dir;
}

const REPO = buildRepo();
const GAME = { id: "test-history", repoDir: REPO, githubBase: "https://github.com/Egg3901/AHDGame/blob" };
const PRIVATE_GAME = { id: "test-private", repoDir: REPO, githubBase: null };

test.after(() => { try { fs.rmSync(REPO, { recursive: true, force: true }); } catch {} });

test("changeish catches change questions and movement questions", () => {
  for (const q of [
    "why did my stocks fall this week",
    "was corporate tax nerfed?",
    "my income used to be higher, what happened",
    "did something change with elections recently",
    "what changed in the last update",
    "is this a bug or intended",
    "why is my approval suddenly dropping",
  ]) assert.equal(history.changeish(q), true, q);
});

test("changeish ignores ordinary mechanics questions", () => {
  for (const q of [
    "how does cloture work",
    "what is the formula for corporate tax",
    "which states have the most house seats",
    "how do I found a corporation",
  ]) assert.equal(history.changeish(q), false, q);
});

test("a game with no public repo has no history", async () => {
  assert.equal(await history.available(PRIVATE_GAME), false);
  assert.deepEqual(await history.search({ game: PRIVATE_GAME, query: "dividend" }), []);
  assert.equal(await history.show({ game: PRIVATE_GAME, sha: "HEAD" }), null);
});

test("search finds commits by the files the question retrieved", async () => {
  const found = await history.search({ game: GAME, paths: ["src/lib/economy/equity.ts"], query: "" });
  assert.ok(found.length >= 2, "both equity commits");
  assert.match(found[0].subject, /cut dividend payout rate/);
  assert.equal(found[0].pr, 412);
  assert.equal(found[0].matched, "files");
  assert.ok(found[0].files.some(f => f.path === "src/lib/economy/equity.ts"));
});

test("search finds commits by keyword when no path is known", async () => {
  const found = await history.search({ game: GAME, query: "why did the dividend change" });
  assert.ok(found.some(c => c.pr === 412), "dividend commit by subject match");
});

test("search skips merge commits and honours the limit", async () => {
  const found = await history.search({ game: GAME, query: "", paths: [], limit: 2 });
  assert.ok(found.length <= 2);
  assert.ok(!found.some(c => /^Merge pull request/.test(c.subject)), "merges are promotion noise");
});

test("path arguments that could escape the repo are rejected", () => {
  assert.equal(history.safePath("../../etc/passwd"), null);
  assert.equal(history.safePath("/etc/passwd"), null);
  assert.equal(history.safePath("--output=/tmp/x"), null);
  assert.equal(history.safePath("src/lib/economy/equity.ts"), "src/lib/economy/equity.ts");
});

test("show returns the message, stat and diff, and skips lockfiles", async () => {
  const [head] = await history.search({ game: GAME, paths: ["src/lib/economy/equity.ts"] });
  const c = await history.show({ game: GAME, sha: head.sha });
  assert.match(c.subject, /cut dividend payout rate/);
  assert.match(c.body, /Payouts outran earnings/);
  assert.match(c.diff, /DIVIDEND_RATE = 0\.4/);
  assert.ok(!c.diff.includes("package-lock.json"), "lockfile diff excluded");
  assert.equal(c.skipped, 1);
  assert.match(c.url, /\/commit\/[0-9a-f]{40}$/);
});

test("show refuses a commit that never reached the deployed branch", async () => {
  const dir = REPO;
  git(dir, "checkout", "--quiet", "-b", "unshipped");
  fs.writeFileSync(path.join(dir, "src/lib/economy/equity.ts"), "export const DIVIDEND_RATE = 0.9;\n");
  git(dir, "add", "-A"); git(dir, "commit", "--quiet", "-m", "feat(economy): unreleased payout buff (#999)");
  const sha = git(dir, "rev-parse", "HEAD").trim();
  git(dir, "checkout", "--quiet", "main");
  assert.equal(await history.show({ game: GAME, sha }), null);
  const found = await history.search({ game: GAME, query: "payout buff unreleased" });
  assert.ok(!found.some(c => c.sha === sha), "unshipped work never appears as evidence");
});

test("show rejects malformed shas without touching git", async () => {
  for (const bad of ["", "HEAD; rm -rf /", "--upload-pack=evil", "zzzz"]) {
    assert.equal(await history.show({ game: GAME, sha: bad }), null, bad);
  }
});

test("deploy dates come from the merge that carried the commit", async () => {
  const found = await history.search({ game: GAME, paths: ["src/lib/elections/turnout.ts"] });
  const dated = await history.withDeployDates(GAME, found);
  assert.ok(dated[0].deployed, "merged commit has a landing date");
  assert.match(dated[0].deployed.subject, /Merge pull request #501/);
});

test("the block states the rule that stops a coincidence being a cause", async () => {
  const found = await history.search({ game: GAME, paths: ["src/lib/economy/equity.ts"] });
  const text = await history.block({ game: GAME, commits: await history.withDeployDates(GAME, found) });
  assert.match(text, /PR #412/);
  assert.match(text, /cut dividend payout rate/);
  assert.match(text, /Only blame a change/i);
  assert.match(text, /the cause is the running world/i);
  assert.equal(await history.block({ game: GAME, commits: [] }), "");
});

test("evidence returns null when nothing matched, so the pipeline is unchanged", async () => {
  const out = await history.evidence({ game: GAME, question: "how does zzzqqq work", paths: ["src/does/not/exist.ts"], sinceDays: 1 });
  assert.equal(out, null);
});

test("numstat parsing handles binary files and renames", () => {
  const rec = `\x1eabc1234def5678abc1234def5678abc1234def5\x1f2026-08-01T10:00:00Z\x1ffeat: thing (#7)\x1f\n0\t0\tsrc/a.ts\n-\t-\tpublic/logo.png\n3\t1\tsrc/{old => new}/b.ts\n`;
  const [c] = history.parseLog(rec);
  assert.equal(c.pr, 7);
  assert.equal(c.files.length, 3);
  assert.equal(c.files[1].added, 0, "binary counts as zero, not NaN");
  assert.equal(c.files[2].path, "src/new/b.ts");
  assert.equal(c.insertions, 3);
});

test("ago counts hours, and never claims a calendar day", () => {
  const now = Date.parse("2026-08-28T12:00:00Z");
  assert.equal(history.ago("2026-08-28T09:00:00Z", now), "3 hours ago");
  assert.equal(history.ago("2026-08-27T09:00:00Z", now), "27 hours ago");
  assert.equal(history.ago("2026-08-24T09:00:00Z", now), "4 days ago");
  assert.equal(history.ago("2026-08-01T09:00:00Z", now), "3 weeks ago");
  for (const iso of ["2026-08-28T09:00:00Z", "2026-08-27T09:00:00Z", "2026-08-01T09:00:00Z"]) {
    assert.ok(!/today|yesterday/i.test(history.ago(iso, now)), "no timezone claim: " + iso);
  }
});

// The failure this replaced: asked at 21:20 Eastern (01:20 UTC the next day),
// a full day of shipped work was labelled "yesterday" and the answer told the
// player nothing had changed today.
test("work from the asker's evening is not aged into yesterday", async () => {
  const now = Date.parse("2026-08-29T01:20:00Z");
  const commits = [{
    sha: "c".repeat(40), date: "2026-08-28T20:17:38Z", subject: "feat(navair): naval and air layer as a turn phase",
    files: [{ path: "src/lib/military/navair.ts", added: 10, removed: 0 }], pr: null, matched: "files", terms: [],
  }];
  const text = await history.block({ game: GAME, commits, now });
  assert.match(text, /5 hours ago/);
  assert.ok(!/yesterday/i.test(text.split("How to use this:")[0]), "the commit line makes no day claim");
  assert.match(text, /THEY MEAN THEIR OWN DAY/);
  assert.match(text, /timezone is unknown/);
  assert.match(text, /It is 2026-08-29 01:20 UTC/);
});

test("identifiers come from the game's logic, not the UI or the bundle preamble", () => {
  const bundle = [
    "RETRIEVED EVIDENCE (general question). For current mechanics, executable code wins.",
    "--- SOURCE code @ abc | src/components/charts/PortfolioChart.tsx (part 1, relevance 1.0) ---",
    "const visibleSeries = seriesByPoint(data); const visibleSeries2 = visibleSeries;",
    "--- SOURCE code @ abc | src/lib/corporations/sharePriceFormula.ts (part 1, relevance 0.9) ---",
    "export function sharePrice(x) { return sharePrice * dividendYield; } // sharePrice",
  ].join("\n");
  const found = history.identifiers(bundle, 3);
  assert.ok(found.includes("sharePrice"), "logic identifier kept");
  assert.ok(!found.includes("visibleSeries"), "component identifier dropped");
  assert.ok(!found.some(w => /^(RETRIEVED|EVIDENCE)$/.test(w)), "preamble words are not identifiers");
});

test("weak matches are labelled as weak in the block", async () => {
  const commits = [
    { sha: "a".repeat(40), date: "2026-08-27T10:00:00Z", subject: "feat(economy): thing", files: [{ path: "src/x.ts", added: 1, removed: 0 }], pr: 1, matched: "files", terms: [] },
    { sha: "b".repeat(40), date: "2026-08-26T10:00:00Z", subject: "fix(ui): other", files: [{ path: "src/y.ts", added: 1, removed: 0 }], pr: 2, matched: "keyword", terms: ["dividend"] },
  ];
  const text = await history.block({ game: GAME, commits });
  assert.match(text, /changed the code behind this/);
  assert.match(text, /its description says it changed dividend/);
  assert.match(text, /never build an answer on one of those/i);
});

// A question about war mechanics was answered with the week's freight-billing
// work, because every gated feature touches gameConfig.ts and the path arm
// counted that as "changed the code behind this".
test("commits matched only through a hub file are demoted", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-hub-"));
  git(dir, "init", "--quiet", "-b", "main");
  fs.mkdirSync(path.join(dir, "src/lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/lib/gameConfig.ts"), "export const flags = {};\n");
  fs.writeFileSync(path.join(dir, "src/lib/war.ts"), "export const FRONT = 1;\n");
  git(dir, "add", "-A"); git(dir, "commit", "--quiet", "-m", "feat: seed");
  for (const n of [1, 2, 3, 4, 5]) {
    fs.appendFileSync(path.join(dir, "src/lib/gameConfig.ts"), `export const flag${n} = ${n};\n`);
    git(dir, "add", "-A"); git(dir, "commit", "--quiet", "-m", `feat(economy): freight step ${n}`);
  }
  fs.appendFileSync(path.join(dir, "src/lib/war.ts"), "export const FRONT2 = 2;\n");
  fs.appendFileSync(path.join(dir, "src/lib/gameConfig.ts"), "export const flag6 = 6;\n");
  git(dir, "add", "-A"); git(dir, "commit", "--quiet", "-m", "feat(military): naval layer");

  const game = { id: "test-hub", repoDir: dir, githubBase: "https://github.com/x/y/blob" };
  const found = await history.search({ game, paths: ["src/lib/gameConfig.ts", "src/lib/war.ts"] });
  const naval = found.find(c => /naval layer/.test(c.subject));
  const freight = found.find(c => /freight step 5/.test(c.subject));
  assert.equal(naval.matched, "files", "a commit that touched a real file keeps its strength");
  assert.equal(freight.matched, "hub", "gameConfig-only commits are demoted");
  const text = await history.block({ game, commits: [freight] });
  assert.match(text, /probably unrelated/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a known timezone makes the clock the player's own", async () => {
  const now = Date.parse("2026-08-29T01:20:00Z");
  const commits = [{
    sha: "d".repeat(40), date: "2026-08-28T20:17:38Z", subject: "feat(navair): naval and air layer as a turn phase",
    files: [{ path: "src/lib/military/navair.ts", added: 10, removed: 0 }], pr: null, matched: "files", terms: [],
  }];
  const text = await history.block({ game: GAME, commits, now, tz: "America/New_York" });
  // 20:17 UTC is 16:17 the same afternoon in New York, and "now" is still the 28th there.
  assert.match(text, /2026-08-28 16:17/);
  assert.match(text, /where the player is \(America\/New_York\)/);
  assert.match(text, /"today" means 2026-08-28/);
  assert.match(text, /5 hours ago/);
});

test("an unknown or bogus timezone falls back to UTC dates and hours", async () => {
  const now = Date.parse("2026-08-29T01:20:00Z");
  const commits = [{
    sha: "e".repeat(40), date: "2026-08-28T20:17:38Z", subject: "feat(navair): naval layer",
    files: [{ path: "src/lib/military/navair.ts", added: 1, removed: 0 }], pr: null, matched: "files", terms: [],
  }];
  for (const bad of [null, "", "Mars/Olympus", "../../etc/passwd", "A".repeat(80)]) {
    const text = await history.block({ game: GAME, commits, now, tz: bad });
    assert.match(text, /2026-08-28 \(5 hours ago\)/, String(bad));
    assert.match(text, /timezone is unknown/, String(bad));
  }
});

test("validZone accepts real zones and refuses everything else", () => {
  assert.equal(history.validZone("America/New_York"), "America/New_York");
  assert.equal(history.validZone("UTC"), "UTC");
  assert.equal(history.validZone("Europe/London"), "Europe/London");
  for (const bad of ["Mars/Olympus", "'; DROP TABLE", "../etc", "", null, undefined, 42, "x".repeat(100)]) {
    assert.equal(history.validZone(bad), null, String(bad));
  }
});
