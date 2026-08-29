"use strict";

// Git history as evidence.
//
// Retrieval answers "what does the code do". It cannot answer "why did my
// stocks fall this week", because the file reads exactly the same to the index
// whether the mechanic shipped two years ago or on Tuesday. The commit log is
// the only record of when behaviour changed, and for a public repo it is public
// information the player could read on GitHub themselves.
//
// Boundaries, deliberately hard:
// - PUBLIC REPOS ONLY. A game whose `githubBase` is null has no public history,
//   so its commit messages and diffs are not player-facing evidence and this
//   module reports itself unavailable for it.
// - THE DEPLOYED REF ONLY (`origin/main`, then `main`). Ask must never explain
//   the live game with a change that has not shipped. If neither ref exists,
//   the game gets no history rather than a guess from a working checkout that
//   might be sitting on a feature branch.
// - Read-only plumbing. Every call is execFile with an argument array — never a
//   shell, never a checkout, never a fetch. The clone this reads for A House
//   Divided is the retrieval sandbox, refreshed to origin/main by
//   rag-reindex.timer every 15 minutes; it is never /root/projects/AHDGame.
// - Fail open. Every function returns null/[] on any error, so a missing repo
//   or a slow git degrades the answer instead of breaking it.
const { execFile } = require("node:child_process");
const games = require("./games");

const SINCE_DAYS = Number(process.env.ASK_HISTORY_DAYS || 45);
const TIMEOUT_MS = Number(process.env.ASK_HISTORY_TIMEOUT_MS || 6000);
const MAX_DIFF_CHARS = Number(process.env.ASK_HISTORY_DIFF_CHARS || 7000);
const DEFAULT_LIMIT = Number(process.env.ASK_HISTORY_LIMIT || 8);
// Resolving the deployed ref costs a git call, so remember it briefly. Short
// enough that a repo appearing (or its ref changing) is picked up without a
// restart.
const REF_TTL_MS = 300000;

// Commits that cannot be the answer to "why did this change".
//
// A bulk import or a tree-wide rename touches every file, so it matches every
// path query and would sit at the top of the evidence for every question — the
// repo's own "Initial public release" commit did exactly that. Documentation,
// chore, test and CI commits change no behaviour by definition of the
// convention, so they are never the cause of something a player noticed.
const BULK_FILE_COUNT = Number(process.env.ASK_HISTORY_BULK_FILES || 60);
// Matches on the conventional-commit type OR the scope, so `fix(ci): green the
// verify typecheck` is dropped alongside `ci: …`. A CI fix has never been the
// reason a player's numbers moved.
const NO_BEHAVIOUR_RE = /^(?:docs|chore|test|ci|style|build|deps)[(:]|^\w+\((?:ci|deps|test|tests|docs|lint|format|typecheck)\)/i;

const REC = "\x1e";
const FIELD = "\x1f";
const FORMAT = `${REC}%H${FIELD}%cI${FIELD}%s${FIELD}%b`;

// Files whose diffs are noise or hazard. Lockfiles and snapshots swamp a diff
// with nothing a player cares about; the secret-shaped names are belt and
// braces — a public repo should contain none, and if one ever does, it is not
// getting read out to players through here.
const SKIP_DIFF = [
  /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/i,
  /\.(?:snap|lock|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|mp3|wav|pdf)$/i,
  /(?:^|\/)\.env/i,
  /(?:^|\/)[^/]*(?:secret|credential|private[-_]?key)[^/]*$/i,
  /\.(?:pem|key|p12|pfx)$/i,
];

// Words that make a question about the code CHANGING rather than about what the
// code does. The evidence is cheap (one git log) but not free, and a history
// block on every question would be noise the model has to ignore.
const CHANGE_RE = new RegExp([
  "\\b(?:patch(?:ed|es)?|hotfix(?:ed|es)?|changelog|nerf(?:ed|s|ing)?|buff(?:ed|s|ing)?)\\b",
  "\\b(?:rework(?:ed|s)?|regress(?:ion|ed)?|revert(?:ed|s)?)\\b",
  "\\bwas (?:this|that|it) (?:changed|patched|fixed|intended)\\b",
  "\\b(?:suddenly|overnight|out of nowhere|all of a sudden)\\b",
  "\\bused to (?:be|work|cost|give|get|have|make|earn)\\b",
  "\\b(?:no longer|stopped) (?:work|working|works|happen|happening)\\b",
  "\\bsince (?:the |a |last )?(?:update|patch|deploy(?:ment)?|release|merge)\\b",
  "\\b(?:recent|latest|last|new(?:est)?|this week'?s) (?:change|changes|update|updates|patch|release|version|build|deploy)\\b",
  "\\bwhat(?:'s| has| have)? (?:changed|shipped|been (?:changed|shipped|added|removed))\\b",
  "\\b(?:did|has|have) (?:something|anything|somebody|someone|they|you|the devs?|the developers?) (?:change|changed|break|broken|broke|patch|patched)\\b",
  "\\bcode change\\b|\\bdev(?:eloper)?s? chang",
  "\\bis (?:this|that|it) (?:a )?(?:bug|intended|intentional|working as intended)\\b",
].join("|"), "i");

// "Why did my stocks fall" carries no recency word at all, and it is exactly the
// question a shipped change is the answer to. A why-question about a movement is
// worth one git log; the prompt rules then forbid attributing it to a commit
// unless the dates and the mechanic actually line up.
const MOVEMENT_RE = /\b(?:why|how come)\b[^?]{0,80}\b(?:fell|fall|falling|drop(?:ped|ping)?|crash(?:ed|ing)?|tank(?:ed|ing)?|plunge[ds]?|collaps(?:ed|ing)|sank|slump(?:ed)?|spike[ds]?|surg(?:ed|ing)|jump(?:ed)?|soar(?:ed)?|doubl(?:ed)|halv(?:ed)|stopped|broke|broken|changed|different|worse|better|slower|faster|cheaper|expensive)\b/i;

/** Does this question want the change history, not just the current code? */
function changeish(question) {
  const q = String(question || "");
  return CHANGE_RE.test(q) || MOVEMENT_RE.test(q);
}

function run(dir, args) {
  return new Promise(resolve => {
    execFile("git", ["-C", dir, "--no-pager", "--literal-pathspecs", ...args], {
      timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    }, (err, stdout) => resolve(err ? null : String(stdout || "")));
  });
}

const _refs = new Map();

/**
 * The repo and deployed ref for a game, or null when it has no public history.
 *
 * `origin/main` is preferred over `main`: on a working checkout the local branch
 * can sit behind or ahead of what actually shipped. HEAD is never used — a
 * checkout parked on a feature branch would present unreleased work as live.
 */
async function repoFor(game) {
  const g = game && game.id ? game : games.fallback();
  if (!g.repoDir || !g.githubBase) return null;
  const cached = _refs.get(g.id);
  if (cached && Date.now() - cached.at < REF_TTL_MS) return cached.value;
  let value = null;
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    const out = await run(g.repoDir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (out && out.trim()) {
      value = { dir: g.repoDir, ref, commitBase: String(g.githubBase).replace(/\/blob\/?$/, "") + "/commit" };
      break;
    }
  }
  _refs.set(g.id, { value, at: Date.now() });
  return value;
}

/** Is git-history evidence available for this game at all? */
async function available(game) {
  return (await repoFor(game)) !== null;
}

function safePath(p) {
  const s = String(p || "").trim();
  if (!s || s.length > 200) return null;
  if (s.startsWith("-") || s.includes("..") || s.startsWith("/")) return null;
  return /^[A-Za-z0-9_@./[\]()+-]+$/.test(s) ? s : null;
}

function prNumber(subject) {
  const m = String(subject || "").match(/\(#(\d{1,6})\)\s*$/);
  return m ? Number(m[1]) : null;
}

/**
 * An IANA zone name the runtime actually knows, or null.
 *
 * The browser reports this (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
 * and it is passed through with the question. It is never inferred from an IP,
 * a locale, or a guess: a wrong zone is worse than none, because it turns an
 * honest "5 hours ago" into a confident "yesterday" that is off by a day.
 */
function validZone(tz) {
  const name = String(tz || "").trim();
  if (!name || name.length > 60 || !/^[A-Za-z0-9_+\-\/]+$/.test(name)) return null;
  try { new Intl.DateTimeFormat("sv-SE", { timeZone: name }).format(0); return name; }
  catch { return null; }
}

/** A timestamp as the player's own wall clock reads it: "2026-08-28 16:17". */
function localStamp(iso, tz, withTime = true) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const zone = validZone(tz);
  if (!zone) return String(iso).slice(0, 10);
  try {
    // sv-SE is the one common locale that formats as YYYY-MM-DD HH:mm.
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    }).format(new Date(t));
  } catch { return String(iso).slice(0, 10); }
}

/**
 * Age, in hours while that is the useful unit.
 *
 * NEVER the words "today" or "yesterday" from HERE. Those are claims about a
 * calendar day in somebody's timezone; when the player's zone is known the
 * block states their local date outright and the model can say "today" safely,
 * and when it is not, hours are true everywhere. Counting UTC days produced a
 * real wrong answer: at 21:20 Eastern a player asked what changed today, and a
 * full day of shipped work — the entire naval/air layer — was labelled
 * "yesterday" because it was already past midnight in UTC, so the answer told
 * them nothing had changed.
 */
function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const hours = Math.floor((now - t) / 3600000);
  if (hours < 1) return "in the last hour";
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/**
 * Parse `git log --numstat` output written with our record format.
 * Numstat marks binary files with "-", which parses to 0 rather than NaN.
 */
function parseLog(out) {
  const commits = [];
  for (const record of String(out || "").split(REC)) {
    if (!record.trim()) continue;
    const nl = record.indexOf("\n");
    const header = nl === -1 ? record : record.slice(0, nl);
    const [sha, date, subject, bodyHead] = header.split(FIELD);
    if (!sha || !/^[0-9a-f]{7,40}$/.test(sha.trim())) continue;
    const files = [];
    let insertions = 0, deletions = 0;
    const rest = nl === -1 ? "" : record.slice(nl + 1);
    // The body (%b) runs until the numstat rows start, and numstat rows are the
    // only lines shaped "<n>\t<n>\t<path>".
    const bodyLines = [bodyHead || ""];
    for (const line of rest.split("\n")) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) { if (!files.length) bodyLines.push(line); continue; }
      const added = m[1] === "-" ? 0 : Number(m[1]);
      const removed = m[2] === "-" ? 0 : Number(m[2]);
      // Renames arrive as "old => new" or "dir/{a => b}/file"; keep the new path.
      const path = m[3].includes(" => ") ? m[3].replace(/\{[^}]*=> ([^}]*)\}/, "$1").replace(/^.* => /, "") : m[3];
      insertions += added; deletions += removed;
      files.push({ path: path.trim(), added, removed });
    }
    commits.push({
      sha: sha.trim(), date: (date || "").trim(), subject: (subject || "").trim(),
      body: bodyLines.join("\n").trim(), files, insertions, deletions,
      pr: prNumber(subject),
    });
  }
  return commits;
}

// Question words that would match half the log if handed to --grep.
const STOP = new Set(["the", "and", "for", "with", "that", "this", "what", "why", "how", "did", "does",
  "was", "are", "is", "it", "my", "our", "their", "some", "any", "get", "got", "has", "have", "had",
  "recently", "recent", "lately", "change", "changed", "changes", "update", "updated", "game", "player",
  "players", "now", "suddenly", "happen", "happened", "happening", "from", "into", "about", "when",
  "there", "here", "just", "still", "been", "being", "than", "then", "them", "they", "you", "your",
  "week", "weeks", "month", "months", "day", "days", "today", "yesterday", "turn", "turns", "time",
  "much", "many", "more", "less", "most", "least", "because", "after", "before", "since", "last",
  "thing", "things", "stuff", "really", "very", "like", "look", "looks", "seem", "seems", "make",
  "makes", "made", "went", "going", "keep", "keeps", "everything", "anything", "something"]);

// "stocks" in the question, "stock" in the commit. Crude, and deliberately so:
// anything cleverer starts matching "election" to "elect".
const stem = w => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

const _subjects = new Map();

/** Every subject on the deployed branch. One cached read; used to spot terms
 * so common in this repo that grepping for them means nothing. */
async function subjectIndex(repo) {
  const cached = _subjects.get(repo.dir + repo.ref);
  if (cached && Date.now() - cached.at < REF_TTL_MS) return cached.list;
  const out = await run(repo.dir, ["log", "--no-merges", "--format=%s", repo.ref]);
  const list = String(out || "").split("\n").filter(Boolean);
  _subjects.set(repo.dir + repo.ref, { list, at: Date.now() });
  return list;
}

// Compiled once per term: this runs over every subject in the repo, and building
// the regex inside the loop cost more than every git call in the pass combined.
const _termRe = new Map();
function termRe(term) {
  let re = _termRe.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Plurals only. Gerunds are usually a different sense: "stocks" must not
    // match "auto-stocking the Fed board", which is how a payout question got
    // answered with a central-bank change.
    re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:e?s)?(?![a-z0-9])`, "i");
    _termRe.set(term, re);
  }
  return re;
}

/** Does the commit subject use this term as a word, not as a fragment? */
function subjectHas(subject, term) {
  return termRe(term).test(String(subject || ""));
}

// Identifiers that say nothing about the game: framework, language and test
// scaffolding appear in every file and would pickaxe to every commit.
const NOISE_IDENT = /^(?:use[A-Z]|set[A-Z]|get[A-Z]|handle[A-Z]|on[A-Z]|is[A-Z]|has[A-Z])|^(?:className|children|interface|function|constant|require|module|export|default|return|string|number|boolean|Promise|Record|Partial|readonly|describe|expect|beforeEach|afterEach|toEqual|toBe)/;

/**
 * The game's own words for what the question is about, taken from the code that
 * retrieval matched.
 *
 * This is the sharpest bridge available between a player's vocabulary and the
 * repo's: a player asking why their stocks fell retrieves files full of
 * `sharePrice`, and a diff search for `sharePrice` finds the change that moved
 * it. The question's own words never would.
 */
function identifiers(text, max = 3) {
  const counts = new Map();
  // Only from the game's logic. A React component's identifiers describe how a
  // screen renders, not what the game does: the portfolio chart yields
  // `visibleSeries` and `seriesByPoint`, which pickaxe to whatever UI work
  // shipped that day and blame it for the player's losses.
  // Starts false: everything before the first file header is the bundle's own
  // preamble, and "RETRIEVED EVIDENCE" reads as two identifiers otherwise.
  let logic = false;
  for (const line of String(text || "").split("\n")) {
    const header = line.match(/^---\s+(?:SOURCE\s+\w+\s+@\s+\S+\s+\|\s+)?(\S+?)\s+\(part/);
    if (header) { const p = header[1]; logic = !/\.(?:tsx|jsx|css|md|mdx)$/i.test(p) && !/(?:^|\/)(?:components|app)\//i.test(p); continue; }
    if (!logic) continue;
    for (const m of line.matchAll(/\b[a-z][a-zA-Z0-9]{5,28}\b|\b[A-Z][A-Z0-9_]{5,28}\b/g)) {
      const w = m[0];
      if (NOISE_IDENT.test(w)) continue;
      // Mixed case or an underscore means it is an identifier, not English prose.
      if (!/[A-Z_]/.test(w.slice(1))) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(e => e[0]);
}

/** Search terms from a player question: nouns worth grepping a commit log for. */
function terms(question) {
  const raw = String(question || "").toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) || [];
  const out = [];
  for (const w of raw) {
    if (STOP.has(w)) continue;
    const s = stem(w);
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Recent commits on the deployed ref, by keyword and/or by the files the
 * question's evidence came from.
 *
 * The path arm is the one that carries player vocabulary: a player says "stocks
 * fell", the commit says "bounded equity liquidity facility", and no keyword
 * match connects them — but retrieval already found the equity files, and the
 * log of those files does.
 */
async function search({ game = null, query = "", paths = [], code = "", sinceDays = SINCE_DAYS, limit = DEFAULT_LIMIT } = {}) {
  const repo = await repoFor(game);
  if (!repo) return [];
  const since = `--since=${Math.max(1, Math.min(400, Number(sinceDays) || SINCE_DAYS))}.days`;
  const base = ["log", repo.ref, "--no-merges", since, "--numstat", "--date-order",
    `--max-count=${Math.max(1, Math.min(40, limit * 3))}`, `--format=${FORMAT}`];

  const jobs = [];
  const clean = safePaths(paths);
  if (clean.length) jobs.push(run(repo.dir, [...base, "--", ...clean]));
  // Drop terms this repo says nothing with. "run", "real", "make" appear in a
  // tenth of all subjects, so grepping for them returns the newest commits
  // rather than the relevant ones — measured, not assumed: the filter is the
  // repo's own subject frequencies, so it needs no English word list and
  // adapts to whatever a given game's commits talk about.
  const subjects = await subjectIndex(repo);
  // 15%, not 5%. A tighter ceiling drops the repo's own subject matter: with 744
  // subjects, "military" (64) and "economy" (60) were being discarded as
  // uninformative on exactly the questions they answer, while "fix" (412) is
  // what the ceiling is actually for.
  const ceiling = Math.max(3, Math.floor(subjects.length * 0.15));
  const counted = terms(query).map(w => ({ w, n: subjects.reduce((acc, s) => acc + (subjectHas(s, w) ? 1 : 0), 0) }));
  // Two lists, because the two arms fail differently. A term no subject uses is
  // useless to --grep but is exactly what the diff search wants: "stock" appears
  // in no commit subject in this repo and in plenty of diffs.
  const words = counted.filter(t => t.n > 0 && t.n <= ceiling).map(t => t.w);
  const diffWords = counted.filter(t => t.n <= ceiling).map(t => t.w);
  if (words.length) {
    jobs.push(run(repo.dir, [...base, "--regexp-ignore-case", ...words.map(w => `--grep=${w}`)]));
  }
  if (!jobs.length) jobs.push(run(repo.dir, base));

  const byShaSeen = new Map();
  const results = await Promise.all(jobs);
  results.forEach((out, i) => {
    const fromFiles = i === 0 && clean.length > 0;
    for (const c of parseLog(out)) {
      if (NO_BEHAVIOUR_RE.test(c.subject)) continue;
      // --grep searches the whole message, and every AHD commit body carries a
      // changelog entry, so a body match drags in commits about nothing to do
      // with the question. Require the term in the SUBJECT: that is the line
      // that says what the commit is. On a word boundary, or "stocks" matches
      // "auto-stocking the Fed board" and the answer blames the wrong change.
      const hits = words.filter(w => subjectHas(c.subject, w));
      if (!fromFiles && !hits.length) continue;
      const hit = byShaSeen.get(c.sha);
      // A commit found by both arms is the strongest signal there is: it touches
      // the files the question is about AND says so in its subject.
      if (hit) { hit.matched = "files+keyword"; hit.termHits = Math.max(hit.termHits, hits.length); continue; }
      byShaSeen.set(c.sha, { ...c, matched: fromFiles ? "files" : "keyword", termHits: hits.length, terms: hits });
    }
  });
  let candidates = demoteHubMatches(await dropBulkCommits(repo, [...byShaSeen.values()]));

  // Thin result: search what the changes actually TOUCHED, not what they were
  // called. This is the arm that bridges player words to code words — a player
  // says "stocks", the commit says "bounded equity liquidity facility", and
  // neither the subject nor the retrieved UI files connect them, but the diff
  // does, because it edits `sharePrice`. Pickaxe over the whole tree, ~200ms.
  // Prefer the code's own names over the player's words: "sharePrice" finds the
  // change that moved it, "stock|fall" finds whatever diff happened to contain
  // the word "fall".
  const pickaxe = [...identifiers(code), ...diffWords].slice(0, 3);
  if (candidates.filter(c => c.matched !== "keyword").length < 2 && pickaxe.length) {
    // Match the word, its plural, or the head of a camelCase identifier
    // (`stockValue`) — but not a different word that merely starts the same way
    // (`stocking`). Written in POSIX ERE with the alternation spelled out:
    // this git rejects lookahead in `-G` even under --perl-regexp.
    const rx = pickaxe
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .map(w => `\\b(${w}s?[A-Z_]|${w}s?\\b)`)
      .join("|");
    const out = await run(repo.dir, [...base, "--regexp-ignore-case", `-G${rx}`]);
    const coded = parseLog(out)
      .filter(c => !NO_BEHAVIOUR_RE.test(c.subject) && !byShaSeen.has(c.sha))
      // The word may have matched in a changelog entry or a doc rather than in
      // anything that runs. A commit that touched no code changed no behaviour.
      .filter(c => c.files.some(f => !/\.(?:md|mdx|txt)$/i.test(f.path)))
      .map(c => ({ ...c, matched: "code", termHits: 0, terms: pickaxe }));
    if (coded.length) candidates = [...candidates, ...await dropBulkCommits(repo, coded)];
  }
  // Nothing survived: widen the path arm to the directories those files live in.
  // Retrieval often lands on the screen a player is looking at rather than the
  // system behind it ("my stocks fell" matches the portfolio page), and the
  // neighbouring files in that directory are the next best thing to the exact
  // file nobody retrieved. Runs after the bulk drop, or the tree-wide import
  // commit counts as a hit and suppresses the very fallback it should trigger.
  if (!candidates.length && clean.length) {
    const dirs = [...new Set(clean.map(p => p.split("/").slice(0, -1).join("/")).filter(d => d.includes("/")))].slice(0, 4);
    if (dirs.length) {
      const nearby = parseLog(await run(repo.dir, [...base, "--", ...dirs]))
        .filter(c => !NO_BEHAVIOUR_RE.test(c.subject))
        .map(c => ({ ...c, matched: "nearby", termHits: 0 }));
      candidates = await dropBulkCommits(repo, nearby);
    }
  }
  // Path matches are evidence; keyword-only matches are a guess at vocabulary,
  // and a long tail of them is how a coincidence gets presented as a cause. Keep
  // the few that match the most of the question, and let the scout chase the
  // rest if it wants them.
  const newestFirst = (a, b) => (b.date || "").localeCompare(a.date || "");
  const isWeak = c => c.matched === "keyword" || c.matched === "code" || c.matched === "hub";
  const strong = candidates.filter(c => !isWeak(c)).sort(newestFirst);
  const weak = candidates.filter(isWeak)
    // A diff-level match beats a subject-word match: it proves the change
    // touched the thing, where the subject only mentions a word.
    .sort((a, b) => rank(b) - rank(a) || b.termHits - a.termHits || newestFirst(a, b))
    .slice(0, Math.max(0, Math.min(4, limit - strong.length)));
  return [...strong, ...weak].sort(newestFirst).slice(0, limit);
}

/**
 * Demote commits that matched only through a hub file.
 *
 * Under a pathspec, `--numstat` lists exactly the files that matched, so a file
 * showing up in most of the results is a hub, not a lead: `gameConfig.ts` is
 * touched by every gated feature, and matching it made a question about war
 * mechanics return the week's freight-billing work. Found from the results
 * themselves, so it costs nothing and needs no list of file names.
 */
function demoteHubMatches(commits) {
  const fromFiles = commits.filter(c => c.matched === "files" || c.matched === "files+keyword");
  if (fromFiles.length < 4) return commits;
  const seen = new Map();
  for (const c of fromFiles) for (const p of new Set(c.files.map(f => f.path))) seen.set(p, (seen.get(p) || 0) + 1);
  const hubs = new Set([...seen.entries()].filter(([, n]) => n > fromFiles.length * 0.5).map(([p]) => p));
  if (!hubs.size) return commits;
  return commits.map(c => (c.matched === "files" && c.files.every(f => hubs.has(f.path))
    ? { ...c, matched: "hub" }
    : c));
}

/**
 * Drop tree-wide commits.
 *
 * A bulk import or a mass rename touches every file, so it matches every path
 * query — the repo's own "Initial public release" sat at the top of the evidence
 * for every question asked. It cannot be checked from the log output, because a
 * path-filtered `--numstat` reports only the matching files (three, for a commit
 * that touched three thousand). One batched shortstat over the candidates gives
 * the real size.
 */
async function dropBulkCommits(repo, commits) {
  if (!commits.length) return commits;
  const out = await run(repo.dir, ["log", "--no-walk", "--shortstat", "--format=%H", ...commits.map(c => c.sha)]);
  if (!out) return commits;
  const sizes = new Map();
  let current = null;
  for (const line of out.split("\n")) {
    if (/^[0-9a-f]{40}$/.test(line.trim())) { current = line.trim(); continue; }
    const m = line.match(/(\d+) files? changed/);
    if (m && current) sizes.set(current, Number(m[1]));
  }
  return commits.filter(c => (sizes.get(c.sha) ?? 0) <= BULK_FILE_COUNT);
}

function safePaths(paths) {
  return [...new Set((Array.isArray(paths) ? paths : []).map(safePath).filter(Boolean))].slice(0, 12);
}

const _lines = new Map();

/** The deployed branch's own commits, newest first. Cached: it is one read. */
async function firstParentLine(repo) {
  const cached = _lines.get(repo.dir + repo.ref);
  if (cached && Date.now() - cached.at < REF_TTL_MS) return cached.list;
  const out = await run(repo.dir, ["log", "--first-parent", `--format=%H${FIELD}%cI${FIELD}%s`, repo.ref]);
  const list = String(out || "").split("\n").filter(Boolean).map(l => {
    const [sha, date, subject] = l.split(FIELD);
    return { sha, date, subject: subject || "" };
  }).filter(c => c.sha);
  _lines.set(repo.dir + repo.ref, { list, at: Date.now() });
  return list;
}

/**
 * When a commit actually reached the deployed branch.
 *
 * A feature commit's own date is when it landed on `development`. It reaches
 * players at the promote merge, a day or two later — and "a day or two" is
 * exactly the resolution a "did this cause what I saw on Tuesday" question turns
 * on. So: the OLDEST commit on the deployed branch's own first-parent line that
 * contains it. Binary search, because containment is monotone along that line —
 * about eleven cheap merge-base calls over a 1200-commit branch.
 *
 * The obvious one-liner (newest merge on the ancestry path) is wrong and looks
 * right: for any commit already on the branch it returns today's promote, so
 * every change ever made appears to have shipped this afternoon.
 */
async function deployedAt(repo, sha, commitDate = null) {
  const all = await firstParentLine(repo);
  // A commit cannot land before it exists, so the search space is the branch's
  // own commits from that date on — for anything recent, a handful rather than
  // the whole branch, and each step is a process spawn.
  const line = commitDate ? all.filter(c => (c.date || "") >= commitDate) : all;
  if (!line.length) return null;
  let lo = 0, hi = line.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const contains = await run(repo.dir, ["merge-base", "--is-ancestor", sha, line[mid].sha]) !== null;
    if (contains) { best = line[mid]; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best ? { date: best.date, subject: best.subject } : null;
}

// A commit that ships a changelog entry has already had its effect written out
// in the player's language, by the person who made the change. That is strictly
// better evidence than a conventional-commit subject or a diff, and it is the
// difference between "corporate dividend logic was adjusted" and "dividends now
// pay 40% of net income, so your payout dropped".
const CHANGELOG_ENTRY = /(?:^|\/)(?:content\/)?changelog\/.*\.mdx?$/i;

/** title + summary from a changelog entry's front matter, as one line. */
function entrySummary(md) {
  const fm = String(md || "").match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const title = fm[1].match(/^title:\s*(?:"([^"]*)"|'([^']*)'|(.+))$/m);
  const summary = fm[1].match(/^summary:\s*>-?\s*\n([\s\S]*?)(?=\n[a-z_]+:|\n*$)/m) || fm[1].match(/^summary:\s*(?:"([^"]*)"|'([^']*)'|(.+))$/m);
  const t = title ? (title[1] || title[2] || title[3] || "").trim() : "";
  const s = summary ? (summary[1] || summary[2] || summary[3] || "").replace(/\s+/g, " ").trim() : "";
  const out = [t, s].filter(Boolean).join(" — ");
  return out ? out.slice(0, 600) : null;
}

async function changelogFor(repo, commit) {
  const entry = commit.files.find(f => CHANGELOG_ENTRY.test(f.path));
  if (!entry) return null;
  const md = await run(repo.dir, ["show", `${commit.sha}:${entry.path}`]);
  return md ? entrySummary(md) : null;
}

/**
 * Enrich the first few commits — the ones the answer will actually be built on —
 * with when they reached players and how the change was described to them.
 */
async function withDeployDates(game, commits, max = 5) {
  const repo = await repoFor(game);
  if (!repo) return commits;
  const head = commits.slice(0, max);
  const extra = await Promise.all(head.map(async c => ({
    // The promote lag only matters while it is inside the window a player is
    // asking about. For a change from three weeks ago, "which day it reached
    // prod" answers nothing and costs a binary search.
    deployed: ago(c.date).endsWith("weeks ago") ? null : await deployedAt(repo, c.sha, c.date),
    changelog: await changelogFor(repo, c),
  })));
  return commits.map((c, i) => (i < head.length ? { ...c, ...extra[i] } : c));
}

/**
 * One commit in full: message, file stat, and the diff.
 *
 * Refuses anything not reachable from the deployed ref, so an answer can never
 * be built on work that has not shipped.
 */
async function show({ game = null, sha = "", path = null, maxChars = MAX_DIFF_CHARS } = {}) {
  const repo = await repoFor(game);
  if (!repo) return null;
  const id = String(sha || "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(id)) return null;
  const reachable = await run(repo.dir, ["merge-base", "--is-ancestor", id, repo.ref]);
  if (reachable === null) return null;

  const meta = parseLog(await run(repo.dir, ["show", "--no-patch", "--numstat", `--format=${FORMAT}`, id]))[0];
  if (!meta) return null;

  const only = safePath(path);
  const wanted = meta.files.filter(f => !SKIP_DIFF.some(re => re.test(f.path)) && (!only || f.path === only || f.path.startsWith(only)));
  // Tests are real evidence of intended behaviour, but they are verbose. Read
  // the implementation first and let tests fill whatever budget is left.
  const ordered = [...wanted].sort((a, b) => Number(/\.(?:test|spec)\./.test(a.path)) - Number(/\.(?:test|spec)\./.test(b.path)));
  let diff = "", budget = Math.max(500, maxChars);
  for (const f of ordered.slice(0, 8)) {
    const out = await run(repo.dir, ["show", "--no-color", "--format=", "--unified=3", id, "--", f.path]);
    if (!out) continue;
    if (out.length > budget) { diff += out.slice(0, budget) + "\n[diff truncated]\n"; break; }
    diff += out; budget -= out.length;
  }
  const skipped = meta.files.length - wanted.length;
  return {
    ...meta,
    deployed: await deployedAt(repo, id),
    url: `${repo.commitBase}/${meta.sha}`,
    diff: diff.trim(),
    skipped: skipped > 0 ? skipped : 0,
  };
}

// Why this commit is in front of the model. A path match means the change
// touched the code the question is about; a diff or subject match only means a
// word lined up, and an answer must not present the two as equally causal.
function selectionNote(c) {
  const words = (c.terms || []).slice(0, 3).join(", ");
  if (c.matched === "files+keyword") return "changed the code behind this, and says so";
  if (c.matched === "files") return "changed the code behind this";
  if (c.matched === "keyword") return `its description says it changed ${words || "this topic"} — check that is the same thing the player means`;
  if (c.matched === "code") return `edited code mentioning ${words || "this topic"} — weaker link, may be unrelated`;
  if (c.matched === "nearby") return "changed code alongside it — may be unrelated";
  if (c.matched === "hub") return "only touched a shared config or type file that most changes touch — probably unrelated";
  return "";
}

// Subject matches outrank diff matches, which outrank a shared-file match.
const rank = c => (c.matched === "keyword" ? 2 : c.matched === "code" ? 1 : 0);

function commitLine(c, repo, now = Date.now(), tz = null) {
  const day = localStamp(c.date, tz);
  const landed = c.deployed?.date ? localStamp(c.deployed.date, tz) : null;
  const sameDay = landed && landed.slice(0, 10) === day.slice(0, 10);
  const when = landed && !sameDay
    ? `${day}, live in the game from ${landed} (${ago(c.deployed.date, now)})`
    : `${day} (${ago(c.date, now)})`;
  const files = c.files.slice(0, 4).map(f => `${f.path} +${f.added}/-${f.removed}`).join(", ");
  const more = c.files.length > 4 ? `, +${c.files.length - 4} more files` : "";
  const pr = c.pr ? ` [PR #${c.pr}]` : "";
  const link = repo ? ` ${repo.commitBase}/${c.sha}` : "";
  const note = c.changelog ? `\n    told to players as: ${c.changelog}` : "";
  const why = selectionNote(c);
  return `- ${c.sha.slice(0, 9)} ${when}${pr}: ${c.subject}${note}\n    touched: ${files}${more}${why ? `\n    why it is here: ${why}` : ""}\n    commit:${link}`;
}

/**
 * The prompt block. Says what these commits are, what they are not, and the one
 * rule that keeps a coincidence from being reported as a cause.
 */
async function block({ game = null, commits = [], question = "", sinceDays = SINCE_DAYS, now = Date.now(), tz = null } = {}) {
  if (!commits.length) return "";
  const repo = await repoFor(game);
  const zone = validZone(tz);
  const lines = commits.map(c => commitLine(c, repo, now, zone)).join("\n");
  const clock = zone
    ? `It is ${localStamp(new Date(now).toISOString(), zone)} where the player is (${zone}), so "today" means ${localStamp(new Date(now).toISOString(), zone, false)} to them. Every date below is on that same clock, and every age is counted from now.`
    : `It is ${new Date(now).toISOString().replace("T", " ").slice(0, 16)} UTC. Every age below is counted from that moment. The player's timezone is unknown here, so their calendar day may be up to a day off UTC: answer with the age ("about five hours ago") and treat anything within the last 24 hours as their today.`;
  return `RECENT CODE CHANGES (real commits on the branch the live game runs from, last ${sinceDays} days, newest first).
These were selected because they touch the code this question is about, or name it in their description. They are the record of what changed and when — retrieval above shows only what the code currently says, which is identical whether a mechanic shipped last year or on Tuesday.

${clock}

${lines}

How to use this:
- WHEN THE PLAYER SAYS "TODAY", THEY MEAN THEIR OWN DAY. Use the clock line above to decide what that covers, and give the age alongside the date ("about five hours ago, on the 28th") so they can check it against when they noticed.
- A commit here changed the live game on the date shown. Say what changed, when, and what it does to the player, in the player's terms.
- Only blame a change for something the player noticed if BOTH hold: it went live before they saw it, and it actually touches that mechanic. Otherwise the cause is the running world — markets move, elections turn, other players act — and you should say that instead of reaching for a commit.
- Read "why it is here" before you use a line. Anything marked "may be unrelated" or "probably unrelated" is here because a word matched, not because it touches the mechanic — never build an answer on one of those, and if that is all there is, the honest answer is that nothing shipped which explains it.
- Never present a commit that is merely nearby in time as the cause, never guess at a change that is not listed here, and never describe work as "coming soon": this is shipped history only.
- Cite a change as its PR number and date, and link the commit URL if you reference it. Never quote or reproduce the diff, and never discuss the code as code — the player wants the effect on their game.`;
}

/**
 * The whole deterministic pass: find the changes behind a question and render
 * the block. Returns { text, commits } or null.
 */
async function evidence({ game = null, question = "", paths = [], code = "", sinceDays = SINCE_DAYS, limit = DEFAULT_LIMIT, tz = null } = {}) {
  try {
    const found = await search({ game, query: question, paths, code, sinceDays, limit });
    if (!found.length) return null;
    const dated = await withDeployDates(game, found);
    const text = await block({ game, commits: dated, question, sinceDays, tz });
    return text ? { text, commits: dated } : null;
  } catch { return null; }
}

/** The same commit lines without the surrounding instructions, for the scout. */
async function lines({ game = null, commits = [], tz = null } = {}) {
  const repo = await repoFor(game);
  const now = Date.now();
  return commits.map(c => commitLine(c, repo, now, validZone(tz))).join("\n");
}

module.exports = {
  changeish, available, repoFor, search, show, evidence, block, lines, withDeployDates,
  parseLog, terms, identifiers, ago, safePath, commitLine, validZone, localStamp, SINCE_DAYS,
};
