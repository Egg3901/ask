// Per-user persistence: quota accounting, conversation history, answer cache.
// Keyed by "<provider>:<id>" so a Discord and an AHD login are never conflated
// (the broker deliberately refuses to merge them by email).
const path = require("node:path");
const Database = require("better-sqlite3");

const db = new Database(process.env.ASK_DB_PATH || path.join(__dirname, "ask.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS asks(
  id INTEGER PRIMARY KEY,
  user_key TEXT NOT NULL,
  username TEXT,
  conv_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  areas TEXT,
  citations TEXT,
  used_mcp INTEGER DEFAULT 0,
  cached INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_asks_user ON asks(user_key, ts);
CREATE INDEX IF NOT EXISTS idx_asks_conv ON asks(conv_id, ts);

CREATE TABLE IF NOT EXISTS convs(
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  title TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_convs_user ON convs(user_key, updated DESC);

CREATE TABLE IF NOT EXISTS user_profiles(
  user_key TEXT PRIMARY KEY,
  username TEXT,
  provider TEXT,
  role TEXT,
  tier TEXT,
  character_name TEXT,
  country TEXT,
  party TEXT,
  corporation_name TEXT,
  corporation_role TEXT,
  is_admin INTEGER DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS answer_cache(
  q TEXT PRIMARY KEY, answer TEXT, areas TEXT, citations TEXT, ts INTEGER);

-- Code is authoritative; the wiki and docs are written by humans and lag it.
-- When an answer notices the two disagree, the discrepancy is recorded here so
-- stale documentation becomes a work queue instead of an invisible failure.
CREATE TABLE IF NOT EXISTS doc_conflicts(
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,          -- 'wiki' | 'docs'
  page TEXT,                     -- title or url of the stale page
  claim TEXT NOT NULL,           -- what the doc says
  actual TEXT NOT NULL,          -- what the code does
  evidence TEXT,                 -- file path / line backing the 'actual' column
  question TEXT,
  user_key TEXT,
  status TEXT DEFAULT 'open',    -- open | confirmed | dismissed | fixed
  seen INTEGER DEFAULT 1,
  first_ts INTEGER NOT NULL,
  last_ts INTEGER NOT NULL,
  UNIQUE(source, claim, actual));
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON doc_conflicts(status, last_ts DESC);

-- Staff-verified corrections: the system's long-term memory. Each row is a
-- lesson from a wrong or reported answer, embedded at insert time and injected
-- into future prompts when a semantically similar question arrives.
CREATE TABLE IF NOT EXISTS corrections(
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,        -- the question class this lesson applies to
  correction TEXT NOT NULL,      -- the verified truth, written for the model
  vec BLOB,                      -- nomic embedding of the question
  source_answer_id INTEGER,      -- the reported answer that taught the lesson
  added_by TEXT,
  active INTEGER DEFAULT 1,
  created INTEGER NOT NULL);

-- Generated report pages. A report is a deep, live-data answer given a
-- standalone shareable page; the unguessable token is the permission, same
-- model as shared conversations.
CREATE TABLE IF NOT EXISTS reports(
  token TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  username TEXT,
  answer_id INTEGER,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  body TEXT NOT NULL,
  model TEXT,
  created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_key, created DESC);

-- Automated answer audits: a free model re-reads a random sample of shipped
-- answers and judges whether they actually answered the question. Advisory
-- only — it never blocks or rewrites a response, it just gives staff a signal
-- for where the system is refusing or dodging.
CREATE TABLE IF NOT EXISTS answer_audits(
  id INTEGER PRIMARY KEY,
  answer_id INTEGER,
  question TEXT NOT NULL,
  answered INTEGER,              -- 1 answered, 0 did not, NULL undecided
  refused INTEGER,               -- 1 if the answer refused/deflected
  had_live INTEGER,              -- was live data available on this answer
  confidence REAL,
  note TEXT,
  model TEXT,                    -- the judge model
  created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audits_created ON answer_audits(created DESC);
CREATE INDEX IF NOT EXISTS idx_audits_flagged ON answer_audits(answered, created DESC);

-- Presence log, one row per user per UTC day. user_profiles.last_seen only ever
-- holds the LATEST visit, so it can answer "is this person active now" but never
-- "how many people were active in March" — the history is overwritten. This
-- table keeps the day, so weekly-active is measured rather than inferred.
-- 'visit' is a signed-in page load, 'ask' is a question (web or Discord); the
-- first source of the day wins, which is all the console distinguishes.
CREATE TABLE IF NOT EXISTS user_days(
  user_key TEXT NOT NULL,
  day TEXT NOT NULL,             -- 'YYYY-MM-DD', UTC, same day boundary as the quota window
  source TEXT,                   -- 'visit' | 'ask'
  ts INTEGER NOT NULL,
  PRIMARY KEY(user_key, day));
CREATE INDEX IF NOT EXISTS idx_user_days_day ON user_days(day);
`);

// Backfill the presence log from the history that does survive: every recorded
// question proves activity on its day, and each profile's first/last seen prove
// two more. Days between a user's first and last visit are unrecoverable and are
// deliberately NOT invented — early WAU reads low rather than fabricated.
db.exec(`INSERT OR IGNORE INTO user_days(user_key,day,source,ts)
  SELECT user_key, date(ts/1000,'unixepoch'), 'ask', MIN(ts) FROM asks GROUP BY 1,2`);
db.exec(`INSERT OR IGNORE INTO user_days(user_key,day,source,ts)
  SELECT user_key, date(first_seen/1000,'unixepoch'), 'visit', first_seen FROM user_profiles WHERE first_seen>0`);
db.exec(`INSERT OR IGNORE INTO user_days(user_key,day,source,ts)
  SELECT user_key, date(last_seen/1000,'unixepoch'), 'visit', last_seen FROM user_profiles WHERE last_seen>0`);

// Follow-ups are half price, so the budget is spent in fractions and must be
// summed rather than counted.
try { db.exec("ALTER TABLE asks ADD COLUMN cost REAL DEFAULT 1.0"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN followup INTEGER DEFAULT 0"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN model TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN feedback_rating TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN feedback_reason TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN feedback_ts INTEGER"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN feedback_source TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN plan TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN validation TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN evidence TEXT"); } catch { /* already migrated */ }
// Serving telemetry. These numbers were computed on every answer and logged to
// journalctl, which meant model quality questions got answered by hand-run
// benches instead of the production traffic that already contained the answer.
try { db.exec("ALTER TABLE asks ADD COLUMN ttft_ms INTEGER"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN total_ms INTEGER"); } catch { /* already migrated */ }
// The models that errored before the one that answered, comma-joined. NULL
// means the first model in the chain served.
try { db.exec("ALTER TABLE asks ADD COLUMN fell_through TEXT"); } catch { /* already migrated */ }
// Staff review. Kept separate from feedback_rating on purpose: that column is
// the PLAYER's verdict and feeds the "rated helpful" figure, so folding staff
// judgements into it would quietly corrupt the only signal about what players
// actually think. review_ts is set for every judged answer including skips, so
// "already looked at" is one NULL check rather than three.
// Visualizations became a metered allowance rather than a supporter flag
// (2026-08-29). Charged only when a chart actually reached the player: asking
// for one and getting prose back because the model declined must not cost the
// asker a slot they never got the benefit of.
try { db.exec("ALTER TABLE asks ADD COLUMN used_viz INTEGER DEFAULT 0"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN review_rating TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN review_note TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN review_by TEXT"); } catch { /* already migrated */ }
try { db.exec("ALTER TABLE asks ADD COLUMN review_ts INTEGER"); } catch { /* already migrated */ }
try { db.exec("CREATE INDEX IF NOT EXISTS idx_asks_review ON asks(review_ts, ts DESC)"); } catch {}
try { db.exec("ALTER TABLE answer_cache ADD COLUMN model TEXT"); } catch { /* already migrated */ }
// Every answer predating request routing was produced by the single Flash
// model, so backfilling is factual rather than inferred.
db.exec("UPDATE asks SET model='deepseek-v4-flash' WHERE model IS NULL");
db.exec("UPDATE answer_cache SET model='deepseek-v4-flash' WHERE model IS NULL");
// Sharing is opt-in per conversation: a random token, revocable, never the
// conversation id itself (ids appear in the owner's own URLs).
try { db.exec("ALTER TABLE convs ADD COLUMN share_token TEXT"); } catch { /* already migrated */ }
// Once a conversation has carried moderator-only data it stays private even if
// the owner later loses that role. This is durable classification, not a UI
// check, and cannot be reversed by asking a public question later.
try { db.exec("ALTER TABLE convs ADD COLUMN private INTEGER DEFAULT 0"); } catch { /* already migrated */ }
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_convs_share ON convs(share_token)"); } catch {}
// Preserve the history that existed before profile snapshots were introduced.
// Rich character context fills in the next time each person signs in.
db.exec(`INSERT OR IGNORE INTO user_profiles(user_key,username,provider,first_seen,last_seen)
  SELECT user_key,MAX(username),substr(user_key,1,instr(user_key,':')-1),MIN(ts),MAX(ts)
  FROM asks GROUP BY user_key`);

const S = {
  insertAsk: db.prepare(`INSERT INTO asks(user_key,username,conv_id,question,answer,areas,citations,used_mcp,cached,tokens_in,tokens_out,cost,followup,model,plan,validation,evidence,ttft_ms,total_ms,fell_through,ts)
    VALUES(@user_key,@username,@conv_id,@question,@answer,@areas,@citations,@used_mcp,@cached,@tokens_in,@tokens_out,@cost,@followup,@model,@plan,@validation,@evidence,@ttft_ms,@total_ms,@fell_through,@ts)`),
  countToday: db.prepare("SELECT COALESCE(SUM(cost),0) c FROM asks WHERE user_key=? AND ts>? AND cached=0"),
  convTurnCount: db.prepare("SELECT COUNT(*) c FROM asks WHERE conv_id=? AND user_key=?"),
  convHistory: db.prepare("SELECT question,answer FROM asks WHERE conv_id=? AND user_key=? ORDER BY ts DESC LIMIT ?"),
  countMcpToday: db.prepare("SELECT COUNT(*) c FROM asks WHERE user_key=? AND ts>? AND used_mcp=1"),
  countVizToday: db.prepare("SELECT COUNT(*) c FROM asks WHERE user_key=? AND ts>? AND used_viz=1"),
  markViz: db.prepare("UPDATE asks SET used_viz=1 WHERE id=?"),
  upsertConv: db.prepare(`INSERT INTO convs(id,user_key,title,created,updated,private) VALUES(@id,@user_key,@title,@ts,@ts,@private)
    ON CONFLICT(id) DO UPDATE SET updated=@ts, title=COALESCE(convs.title,@title),
      private=MAX(convs.private,excluded.private),
      share_token=CASE WHEN convs.private=1 OR excluded.private=1 THEN NULL ELSE convs.share_token END`),
  listConvs: db.prepare("SELECT id,title,created,updated,private FROM convs WHERE user_key=? ORDER BY updated DESC LIMIT 40"),
  convTurns: db.prepare("SELECT id,question,answer,areas,citations,used_mcp,cached,model,plan,validation,evidence,feedback_rating,feedback_reason,feedback_ts,feedback_source,ts FROM asks WHERE conv_id=? AND user_key=? ORDER BY ts ASC LIMIT 100"),
  deleteConv: db.prepare("DELETE FROM convs WHERE id=? AND user_key=?"),
  deleteConvAsks: db.prepare("DELETE FROM asks WHERE conv_id=? AND user_key=?"),
  getCache: db.prepare("SELECT answer,areas,citations,model,ts FROM answer_cache WHERE q=?"),
  putCache: db.prepare(`INSERT INTO answer_cache(q,answer,areas,citations,model,ts) VALUES(?,?,?,?,?,?)
    ON CONFLICT(q) DO UPDATE SET answer=excluded.answer,areas=excluded.areas,citations=excluded.citations,model=excluded.model,ts=excluded.ts`),
  upsertProfile: db.prepare(`INSERT INTO user_profiles(user_key,username,provider,role,tier,character_name,country,party,corporation_name,corporation_role,is_admin,first_seen,last_seen)
    VALUES(@user_key,@username,@provider,@role,@tier,@character_name,@country,@party,@corporation_name,@corporation_role,@is_admin,@ts,@ts)
    ON CONFLICT(user_key) DO UPDATE SET username=excluded.username,provider=excluded.provider,role=excluded.role,tier=excluded.tier,
      character_name=excluded.character_name,country=excluded.country,party=excluded.party,corporation_name=excluded.corporation_name,
      corporation_role=excluded.corporation_role,is_admin=excluded.is_admin,last_seen=excluded.last_seen`),
  adminUserList: db.prepare(`SELECT p.*, COUNT(a.id) question_count,
      COALESCE(SUM(a.used_mcp),0) live_count,
      COALESCE(SUM(CASE WHEN a.feedback_rating='down' THEN 1 ELSE 0 END),0) report_count,
      COALESCE(SUM(a.tokens_in),0) tokens_in,
      COALESCE(SUM(a.tokens_out),0) tokens_out,
      COALESCE(SUM(CASE WHEN a.cached=1 THEN 0
        WHEN a.model LIKE '%:free' OR a.model LIKE 'stealth/%' THEN 0
        WHEN lower(a.model) LIKE '%pro%' THEN
        (a.tokens_in*1.32+a.tokens_out*3.96)/1000000.0 ELSE
        (a.tokens_in*0.44+a.tokens_out*1.32)/1000000.0 END),0) estimated_cost,
      MIN(a.ts) first_question, MAX(a.ts) last_question
    FROM user_profiles p LEFT JOIN asks a ON a.user_key=p.user_key
    GROUP BY p.user_key ORDER BY COALESCE(MAX(a.ts),p.last_seen) DESC`),
  adminProfile: db.prepare("SELECT * FROM user_profiles WHERE user_key=?"),
  adminQuestions: db.prepare(`SELECT id,conv_id,question,answer,used_mcp,cached,tokens_in,tokens_out,model,plan,validation,evidence,feedback_rating,feedback_reason,feedback_ts,feedback_source,ts
    FROM asks WHERE user_key=? ORDER BY ts DESC LIMIT 500`),
  adminReports: db.prepare(`SELECT a.id,a.user_key,a.question,a.answer,a.used_mcp,a.model,a.plan,a.validation,a.evidence,a.feedback_reason,a.feedback_source,a.feedback_ts,a.ts,p.username
    FROM asks a LEFT JOIN user_profiles p ON p.user_key=a.user_key
    WHERE a.feedback_rating='down' ORDER BY COALESCE(a.feedback_ts,a.ts) DESC LIMIT ?`),
  feedbackByOwner: db.prepare(`UPDATE asks SET feedback_rating=?,feedback_reason=?,feedback_ts=?,feedback_source='owner'
    WHERE id=? AND user_key=?`),
  feedbackByShare: db.prepare(`UPDATE asks SET feedback_rating=?,feedback_reason=?,feedback_ts=?,feedback_source='shared'
    WHERE id=? AND conv_id=(SELECT id FROM convs WHERE share_token=?)`),
  insertAudit: db.prepare(`INSERT INTO answer_audits(answer_id,question,answered,refused,had_live,confidence,note,model,created)
    VALUES(@answer_id,@question,@answered,@refused,@had_live,@confidence,@note,@model,@created)`),
  recentAudits: db.prepare(`SELECT id,answer_id,question,answered,refused,had_live,confidence,note,model,created
    FROM answer_audits ORDER BY created DESC LIMIT ?`),
  auditSummary: db.prepare(`SELECT
      COUNT(*) total,
      COALESCE(SUM(CASE WHEN answered=0 THEN 1 ELSE 0 END),0) not_answered,
      COALESCE(SUM(CASE WHEN refused=1 THEN 1 ELSE 0 END),0) refused
    FROM answer_audits WHERE created>?`),
};

// Persist one automated audit verdict. Advisory telemetry: never throws into
// the request path, always returns silently.
function recordAudit(row) {
  try {
    S.insertAudit.run({
      answer_id: row.answerId ?? null,
      question: String(row.question || "").slice(0, 1000),
      answered: row.answered == null ? null : (row.answered ? 1 : 0),
      refused: row.refused == null ? null : (row.refused ? 1 : 0),
      had_live: row.hadLive ? 1 : 0,
      confidence: row.confidence == null ? null : Number(row.confidence),
      note: String(row.note || "").slice(0, 500),
      model: row.model || null,
      created: Date.now(),
    });
  } catch (e) { console.error("[ask] recordAudit failed:", String(e?.message || e)); }
}

function answerBrief(answerId) {
  try { return db.prepare("SELECT id,question,answer,used_mcp FROM asks WHERE id=?").get(Number(answerId)) || null; }
  catch { return null; }
}

function recentAudits(limit = 100) {
  try { return S.recentAudits.all(Math.min(Number(limit) || 100, 500)); } catch { return []; }
}

function auditSummary(sinceMs) {
  try { return S.auditSummary.get(Number(sinceMs) || 0) || { total: 0, not_answered: 0, refused: 0 }; }
  catch { return { total: 0, not_answered: 0, refused: 0 }; }
}

// Post-hoc grounding: the async claim audit on flash answers finishes after
// the row is stored, so its findings are patched in rather than recorded.
S.updateGrounding = db.prepare("UPDATE asks SET validation=json_set(COALESCE(validation,'{}'),'$.grounding',json(?)) WHERE id=?");
function updateGrounding(answerId, claims) {
  try { S.updateGrounding.run(JSON.stringify(claims || []), Number(answerId)); } catch {}
}
S.evictCache = db.prepare("DELETE FROM answer_cache WHERE q=?");
function evictCache(q) { try { if (q) S.evictCache.run(String(q)); } catch {} }

// Downvote consequence: a reported answer must stop being served from the
// shared cache. The cache key is `game:…|plan:…|style|length|viz:…|<normalized
// question>`, and the reporter's style/length/viz flags are not stored with
// the answer row, so evict every variant of that question rather than trying
// to reconstruct one exact key.
S.evictCacheByQuestion = db.prepare("DELETE FROM answer_cache WHERE q LIKE '%|' || ? ESCAPE '\\'");
function evictCacheByQuestion(question) {
  const normalized = String(question || "").toLowerCase().replace(/\s+/g, " ").replace(/[?.!,]+$/, "").trim();
  if (!normalized) return 0;
  const escaped = normalized.replace(/[\\%_]/g, ch => `\\${ch}`);
  try { return S.evictCacheByQuestion.run(escaped).changes || 0; } catch { return 0; }
}

// The retrieval work queue. Every answer that cited a real, indexed file the
// evidence never contained recorded that path in validation.missedPaths; this
// rolls those up so the files retrieval repeatedly fails to hand over become a
// ranked chunking/embedding fix list instead of scattered journalctl warnings.
S.retrievalMisses = db.prepare(`SELECT je.value path, COUNT(*) misses, MAX(asks.ts) last_ts
  FROM asks, json_each(json_extract(asks.validation,'$.missedPaths')) je
  WHERE asks.ts>? AND json_valid(asks.validation)
  GROUP BY je.value ORDER BY misses DESC, last_ts DESC LIMIT ?`);
function retrievalMisses(sinceMs, limit = 30) {
  try { return S.retrievalMisses.all(Number(sinceMs) || 0, limit); } catch { return []; }
}

// Validation issue counts over a window: how often each guard tripped.
S.issueCounts = db.prepare(`SELECT je.value issue, COUNT(*) n
  FROM asks, json_each(json_extract(asks.validation,'$.issues')) je
  WHERE asks.ts>? AND json_valid(asks.validation)
  GROUP BY je.value ORDER BY n DESC`);
function issueCounts(sinceMs) {
  try { return S.issueCounts.all(Number(sinceMs) || 0); } catch { return []; }
}

// Per-model serving stats from recorded traffic: median first-token latency,
// how often the model only served because something above it fell through, and
// the player verdicts. This is the table that replaces hand-run model benches.
S.servingRows = db.prepare(`SELECT model, ttft_ms, total_ms, fell_through, feedback_rating,
    CASE WHEN json_valid(validation) AND json_array_length(json_extract(validation,'$.issues'))>0 THEN 1 ELSE 0 END flagged
  FROM asks WHERE ts>? AND cached=0 AND model IS NOT NULL AND model!='discord-ask'`);
function servingStats(sinceMs) {
  let rows;
  try { rows = S.servingRows.all(Number(sinceMs) || 0); } catch { return []; }
  const byModel = new Map();
  for (const r of rows) {
    const m = byModel.get(r.model) || { model: r.model, served: 0, viaFallthrough: 0, flagged: 0, up: 0, down: 0, ttfts: [] };
    m.served++;
    if (r.fell_through) m.viaFallthrough++;
    if (r.flagged) m.flagged++;
    if (r.feedback_rating === "up") m.up++;
    if (r.feedback_rating === "down") m.down++;
    if (Number.isFinite(r.ttft_ms)) m.ttfts.push(r.ttft_ms);
    byModel.set(r.model, m);
  }
  return [...byModel.values()].map(m => {
    m.ttfts.sort((a, b) => a - b);
    const p = q => m.ttfts.length ? m.ttfts[Math.min(m.ttfts.length - 1, Math.floor(q * m.ttfts.length))] : null;
    const { ttfts, ...rest } = m;
    return { ...rest, sampled: ttfts.length, ttftP50: p(0.5), ttftP90: p(0.9) };
  }).sort((a, b) => b.served - a.served);
}

// One self-contained health snapshot, consumed by the console and the weekly
// Discord digest. Reads the corrections table directly (this module owns the
// db handle) to avoid a circular require with corrections.js.
// Server-injected embedding health; the digest reports it so a dead embedder
// shows up in the console and the weekly Discord digest instead of hiding
// behind the keyword fallback.
let _embedHealth = null;
function setEmbedHealth(ref) { _embedHealth = ref; }

function digest(sinceMs) {
  const since = Number(sinceMs) || 0;
  let answers = { total: 0, live: 0, down: 0, up: 0 };
  try {
    answers = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(used_mcp),0) live,
        COALESCE(SUM(CASE WHEN feedback_rating='down' THEN 1 ELSE 0 END),0) down,
        COALESCE(SUM(CASE WHEN feedback_rating='up' THEN 1 ELSE 0 END),0) up
      FROM asks WHERE ts>? AND cached=0`).get(since);
  } catch {}
  let drafts = 0, activeCorrections = 0;
  try {
    drafts = db.prepare("SELECT COUNT(*) n FROM corrections WHERE active=0").get().n;
    activeCorrections = db.prepare("SELECT COUNT(*) n FROM corrections WHERE active=1").get().n;
  } catch {}
  let conflictsOpen = 0;
  try { conflictsOpen = db.prepare("SELECT COUNT(*) n FROM doc_conflicts WHERE status='open'").get().n; } catch {}
  // Audience, on the same window as everything else in the rollup, so the
  // digest can say who is still here alongside how well it served them.
  const windowDays = Math.max(1, Math.round((Date.now() - since) / DAY_MS));
  const act = activity({ days: windowDays });
  return {
    since,
    answers,
    audience: {
      windowDays: act.windowDays,
      active: act.active.wau,
      previousActive: act.active.prevWau,
      activeToday: act.active.dau,
      byProvider: act.active.byProvider,
      newUsers: act.totals.newUsers,
      questionsPerDay: Number(act.perDay.toFixed(1)),
    },
    audits: auditSummary(since),
    issues: issueCounts(since),
    retrievalMisses: retrievalMisses(since, 10),
    models: servingStats(since),
    corrections: { active: activeCorrections, draftsPending: drafts },
    embedding: _embedHealth ? { ok: _embedHealth.ok, error: _embedHealth.error, checkedAt: _embedHealth.checkedAt } : null,
    docConflictsOpen: conflictsOpen,
    // The actual open conflicts, not just the count. This table spent weeks as
    // a write-only find pipeline: answers caught genuine wiki errors and
    // nothing ever read them. Compact rows so the digest can name them.
    docConflicts: conflicts("open", 5).map(c => ({
      source: c.source, page: c.page || null,
      claim: String(c.claim || "").slice(0, 140),
      actual: String(c.actual || "").slice(0, 140),
      seen: c.seen,
    })),
  };
}

// Replay candidates: every downvoted or guard-flagged answer, shaped for the
// eval/reported-failures.json curation flow. The conversion cannot be fully
// automatic (the expected behavior is what the failed answer did NOT do), so
// this feeds a curated queue rather than writing test cases directly. The
// point is that no reported failure silently drops out of the loop between
// the telemetry row and the committed replay suite.
// Only DEFECT codes qualify. escalated_tier, grounding_revised,
// retrieval_miss_healed, answer_contract_repaired and
// canonical_answer_contract are the pipeline WORKING (actions taken or
// contracts served), and letting them in drowned the real failures 5:1 on
// the first live pull.
const REPLAY_DEFECTS = new Set([
  "truncated", "narrated_evidence_bundle", "refused_with_live_evidence",
  "insufficient_evidence", "irrelevant_visualization_withheld",
]);
function replayCandidates(sinceMs, limit = 40) {
  try {
    const rows = db.prepare(`SELECT id, question, feedback_rating, feedback_reason, validation, plan, model, ts
      FROM asks WHERE ts>? AND cached=0 AND (
        feedback_rating='down'
        OR json_array_length(COALESCE(json_extract(validation,'$.issues'),'[]')) > 0
        OR json_array_length(COALESCE(json_extract(validation,'$.inventedPaths'),'[]')) > 0
      ) ORDER BY ts DESC LIMIT ?`).all(Number(sinceMs) || 0, Math.min(Number(limit) || 40, 200) * 5);
    return rows.filter(row => {
      if (row.feedback_rating === "down") return true;
      const validation = safeJson(row.validation) || {};
      const issues = Array.isArray(validation.issues) ? validation.issues : [];
      return issues.some(code => REPLAY_DEFECTS.has(code))
        || (Array.isArray(validation.inventedPaths) && validation.inventedPaths.length > 0);
    }).slice(0, Math.min(Number(limit) || 40, 200)).map(row => {
      const validation = safeJson(row.validation) || {};
      const plan = safeJson(row.plan) || {};
      return {
        answerId: row.id,
        name: String(row.question || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `answer-${row.id}`,
        question: String(row.question || "").slice(0, 500),
        rating: row.feedback_rating || null,
        reason: row.feedback_reason || null,
        issues: Array.isArray(validation.issues) ? validation.issues : [],
        grounding: Array.isArray(validation.grounding) ? validation.grounding : [],
        observedIntent: plan.intent || null,
        model: row.model || null,
        ts: row.ts,
      };
    });
  } catch { return []; }
}

// ── Activity: who is still here, and how much are they asking ───────────────
// An ACTIVE user is one who signed in or asked a question inside the trailing
// window (7 days by default). Both halves matter: Discord users never load a
// page, and a signed-in player who reads old threads never records an ask.
const DAY_MS = 86400000;
const ACTIVE_WINDOW_DAYS = 7;

S.dayCounts = db.prepare(`SELECT date(ts/1000,'unixepoch') day,
    COUNT(*) questions,
    COALESCE(SUM(used_mcp),0) live,
    COALESCE(SUM(cached),0) cached,
    COUNT(DISTINCT user_key) askers,
    COALESCE(SUM(CASE WHEN feedback_rating='up' THEN 1 ELSE 0 END),0) up,
    COALESCE(SUM(CASE WHEN feedback_rating='down' THEN 1 ELSE 0 END),0) down
  FROM asks WHERE ts>=? GROUP BY day`);
S.dayModelTokens = db.prepare(`SELECT date(ts/1000,'unixepoch') day, model,
    COALESCE(SUM(CASE WHEN cached=1 THEN 0 ELSE tokens_in END),0) tin,
    COALESCE(SUM(CASE WHEN cached=1 THEN 0 ELSE tokens_out END),0) tout
  FROM asks WHERE ts>=? GROUP BY day, model`);
S.presenceSince = db.prepare("SELECT user_key, day, source FROM user_days WHERE day>=?");
// Everything served before the window, so the cumulative curve starts from the
// real all-time total rather than resetting to zero at the left edge.
S.tokensBefore = db.prepare(`SELECT COALESCE(SUM(CASE WHEN cached=1 THEN 0 ELSE tokens_in END),0) tin,
    COALESCE(SUM(CASE WHEN cached=1 THEN 0 ELSE tokens_out END),0) tout
  FROM asks WHERE ts<?`);
S.newUsersSince = db.prepare(`SELECT date(first_seen/1000,'unixepoch') day, COUNT(*) n
  FROM user_profiles WHERE first_seen>=? GROUP BY day`);

/** The user_keys active in the trailing window, as a Set. Drives the console's badges. */
function activeKeys(windowDays = ACTIVE_WINDOW_DAYS, now = Date.now()) {
  const from = dayKey(now - (windowDays - 1) * DAY_MS);
  try { return new Set(S.presenceSince.all(from).map(r => r.user_key)); }
  catch { return new Set(); }
}

/**
 * Day-by-day activity over a window, plus the headline active-user counts.
 * `dau` is presence on that day; `wau` is the rolling count over that day and
 * the six before it, which is the "one login or question per week" measure.
 */
function activity({ days = 30, now = Date.now(), windowDays = ACTIVE_WINDOW_DAYS } = {}) {
  const span = Math.min(Math.max(Number(days) || 30, 1), 365);
  // Days are labelled from the UTC calendar day, so the series must start at a
  // day boundary or the first bucket is a partial day masquerading as a full one.
  const todayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const firstDayStart = todayStart - (span - 1) * DAY_MS;
  const labels = Array.from({ length: span }, (_, i) => dayKey(firstDayStart + i * DAY_MS));

  const byDay = new Map(labels.map(d => [d, {
    day: d, questions: 0, live: 0, cached: 0, askers: 0, up: 0, down: 0,
    cost: 0, dau: 0, wau: 0, newUsers: 0,
    tokensIn: 0, tokensOut: 0, tokens: 0, tokensCumulative: 0,
  }]));

  try {
    for (const r of S.dayCounts.all(firstDayStart)) {
      const d = byDay.get(r.day);
      if (d) Object.assign(d, { questions: r.questions, live: r.live, cached: r.cached, askers: r.askers, up: r.up, down: r.down });
    }
  } catch { /* an empty chart beats a 500 on the admin page */ }
  try {
    for (const r of S.dayModelTokens.all(firstDayStart)) {
      const d = byDay.get(r.day);
      if (!d) continue;
      const rate = rateFor(r.model);
      d.cost += (Number(r.tin) * rate.input + Number(r.tout) * rate.output) / 1_000_000;
      d.tokensIn += Number(r.tin); d.tokensOut += Number(r.tout);
      d.tokens = d.tokensIn + d.tokensOut;
    }
  } catch {}
  try {
    for (const r of S.newUsersSince.all(firstDayStart)) {
      const d = byDay.get(r.day);
      if (d) d.newUsers = r.n;
    }
  } catch {}

  // Presence has to reach `windowDays - 1` further back than the chart, or the
  // first buckets would report a rolling count computed from a truncated window.
  let presence = [];
  try { presence = S.presenceSince.all(dayKey(firstDayStart - (windowDays - 1) * DAY_MS)); } catch {}
  const usersOnDay = new Map();
  for (const r of presence) {
    if (!usersOnDay.has(r.day)) usersOnDay.set(r.day, new Set());
    usersOnDay.get(r.day).add(r.user_key);
  }
  for (let i = 0; i < span; i++) {
    const dayStart = firstDayStart + i * DAY_MS;
    const bucket = byDay.get(labels[i]);
    bucket.dau = (usersOnDay.get(labels[i]) || new Set()).size;
    const rolling = new Set();
    for (let back = 0; back < windowDays; back++) {
      for (const k of usersOnDay.get(dayKey(dayStart - back * DAY_MS)) || []) rolling.add(k);
    }
    bucket.wau = rolling.size;
  }

  const series = labels.map(d => byDay.get(d));
  // Running total, carried forward from everything served before the window so
  // the curve reads as the real lifetime total, not a per-range restart.
  let before = { tin: 0, tout: 0 };
  try { before = S.tokensBefore.get(firstDayStart) || before; } catch {}
  const tokensBefore = Number(before.tin || 0) + Number(before.tout || 0);
  let running = tokensBefore;
  for (const d of series) { running += d.tokens; d.tokensCumulative = running; }

  const current = activeKeys(windowDays, now);
  const previous = new Set();
  for (let back = windowDays; back < windowDays * 2; back++) {
    for (const k of usersOnDay.get(dayKey(todayStart - back * DAY_MS)) || []) previous.add(k);
  }
  // Only the charted range. `presence` deliberately reaches further back to feed
  // the rolling window, and counting those rows here would overstate the range.
  const inRange = new Set();
  const firstLabel = labels[0], lastLabel = labels[span - 1];
  for (const r of presence) if (r.day >= firstLabel && r.day <= lastLabel) inRange.add(r.user_key);

  const providerOf = k => String(k || "").split(":")[0] || "unknown";
  const byProvider = {};
  for (const k of current) byProvider[providerOf(k)] = (byProvider[providerOf(k)] || 0) + 1;

  const totals = series.reduce((acc, d) => ({
    questions: acc.questions + d.questions, live: acc.live + d.live, cached: acc.cached + d.cached,
    cost: acc.cost + d.cost, up: acc.up + d.up, down: acc.down + d.down, newUsers: acc.newUsers + d.newUsers,
    tokensIn: acc.tokensIn + d.tokensIn, tokensOut: acc.tokensOut + d.tokensOut, tokens: acc.tokens + d.tokens,
  }), { questions: 0, live: 0, cached: 0, cost: 0, up: 0, down: 0, newUsers: 0, tokensIn: 0, tokensOut: 0, tokens: 0 });

  const today = series[series.length - 1] || { questions: 0, dau: 0 };
  return {
    windowDays, days: span, since: firstDayStart, series, totals,
    active: {
      wau: current.size,
      prevWau: previous.size,
      dau: today.dau,
      windowActive: inRange.size,        // anyone seen at all inside the charted range
      byProvider,
      keys: [...current],
    },
    questionsToday: today.questions,
    perDay: span ? totals.questions / span : 0,
    tokens: {
      perDay: span ? totals.tokens / span : 0,
      today: today.tokens || 0,
      beforeWindow: tokensBefore,
      allTime: tokensBefore + totals.tokens,
    },
  };
}

// ── Staff answer review ─────────────────────────────────────────────────────
// A card-at-a-time queue over answers nobody has judged yet. "Already looked
// at" means any of three things, and all three are excluded: a staff verdict
// (review_ts), a player verdict (feedback_rating), or the automated QA sampler
// having graded it (an answer_audits row). An answer with no body is dropped
// too — a generation that failed is an incident, not something to rate.
const REVIEWABLE = `a.review_ts IS NULL
  AND a.feedback_rating IS NULL
  AND NOT EXISTS(SELECT 1 FROM answer_audits x WHERE x.answer_id=a.id)
  AND length(trim(COALESCE(a.answer,''))) >= 40`;
const REVIEW_COLUMNS = `a.id,a.user_key,a.username,a.conv_id,a.question,a.answer,a.used_mcp,a.cached,a.model,
  a.plan,a.validation,a.evidence,a.tokens_in,a.tokens_out,a.ttft_ms,a.total_ms,
  a.feedback_rating,a.feedback_reason,a.feedback_source,
  a.review_rating,a.review_note,a.review_by,a.review_ts,a.ts,p.role,p.country,p.party`;

S.reviewQueue = db.prepare(`SELECT ${REVIEW_COLUMNS}
  FROM asks a LEFT JOIN user_profiles p ON p.user_key=a.user_key
  WHERE ${REVIEWABLE} ORDER BY a.ts DESC LIMIT ?`);
S.reviewQueueOldest = db.prepare(`SELECT ${REVIEW_COLUMNS}
  FROM asks a LEFT JOIN user_profiles p ON p.user_key=a.user_key
  WHERE ${REVIEWABLE} ORDER BY a.ts ASC LIMIT ?`);
S.reviewCounts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM asks) total,
    (SELECT COUNT(*) FROM asks a WHERE ${REVIEWABLE}) pending,
    (SELECT COUNT(*) FROM asks WHERE review_ts IS NOT NULL) reviewed,
    (SELECT COUNT(*) FROM asks WHERE review_rating='good') good,
    (SELECT COUNT(*) FROM asks WHERE review_rating='bad') bad,
    (SELECT COUNT(*) FROM asks WHERE review_ts IS NOT NULL AND review_rating IS NULL) skipped,
    (SELECT COUNT(*) FROM asks WHERE feedback_rating IS NOT NULL) playerJudged,
    (SELECT COUNT(DISTINCT answer_id) FROM answer_audits WHERE answer_id IS NOT NULL) modelJudged,
    (SELECT COUNT(*) FROM asks WHERE length(trim(COALESCE(answer,'')))<40) emptyAnswers`);
S.saveReview = db.prepare("UPDATE asks SET review_rating=?,review_note=?,review_by=?,review_ts=? WHERE id=?");
S.clearReview = db.prepare("UPDATE asks SET review_rating=NULL,review_note=NULL,review_by=NULL,review_ts=NULL WHERE id=?");
S.reviewRow = db.prepare(`SELECT ${REVIEW_COLUMNS} FROM asks a LEFT JOIN user_profiles p ON p.user_key=a.user_key WHERE a.id=?`);

const hydrate = row => row && ({
  ...row, plan: safeJson(row.plan), validation: safeJson(row.validation), evidence: safeJson(row.evidence),
  estimated_cost: estimateCost(row),
});

/** The next unjudged answers, newest first by default. */
function reviewQueue({ limit = 25, oldestFirst = false } = {}) {
  const n = Math.min(Math.max(Number(limit) || 25, 1), 100);
  try { return (oldestFirst ? S.reviewQueueOldest : S.reviewQueue).all(n).map(hydrate); }
  catch { return []; }
}

function reviewCounts() {
  try { return S.reviewCounts.get(); }
  catch { return { total: 0, pending: 0, reviewed: 0, good: 0, bad: 0, skipped: 0, playerJudged: 0, modelJudged: 0, emptyAnswers: 0 }; }
}

/**
 * Record a staff verdict. `rating` is 'good', 'bad', or null for a skip — a
 * skip still stamps review_ts so the card does not come back around.
 */
function saveReview({ answerId, rating = null, note = "", by = null }) {
  const id = Number(answerId);
  if (!Number.isInteger(id)) return null;
  if (![null, "good", "bad"].includes(rating)) return null;
  const result = S.saveReview.run(rating, String(note || "").trim().slice(0, 500) || null, by || null, Date.now(), id);
  return result.changes ? S.reviewRow.get(id) : null;
}

/** Undo: put the card back in the queue exactly as it was. */
function clearReview(answerId) {
  const id = Number(answerId);
  if (!Number.isInteger(id)) return false;
  return Boolean(S.clearReview.run(id).changes);
}

function reviewRow(answerId) { try { return hydrate(S.reviewRow.get(Number(answerId))); } catch { return null; } }

// ── The linear feed ─────────────────────────────────────────────────────────
// Every question, most recent first. The review queue deliberately hides
// anything already judged; this is the screen that hides nothing.
function recentQuestions({ limit = 50, offset = 0, search = "", state = "all" } = {}) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const where = [];
  const args = [];
  if (state === "pending") where.push(REVIEWABLE);
  else if (state === "reviewed") where.push("a.review_ts IS NOT NULL");
  else if (state === "good") where.push("a.review_rating='good'");
  else if (state === "bad") where.push("a.review_rating='bad'");
  else if (state === "reported") where.push("a.feedback_rating='down'");
  else if (state === "live") where.push("a.used_mcp=1");
  const q = String(search || "").trim();
  if (q) { where.push("(a.question LIKE ? OR a.username LIKE ? OR a.model LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const total = db.prepare(`SELECT COUNT(*) n FROM asks a ${clause}`).get(...args).n;
    const rows = db.prepare(`SELECT ${REVIEW_COLUMNS} FROM asks a LEFT JOIN user_profiles p ON p.user_key=a.user_key
      ${clause} ORDER BY a.ts DESC LIMIT ? OFFSET ?`).all(...args, n, off).map(hydrate);
    return { rows, total, limit: n, offset: off };
  } catch { return { rows: [], total: 0, limit: n, offset: off }; }
}

// Repeat sightings bump `seen` rather than creating duplicates, so the review
// queue ranks by how often players actually hit the stale page.
S.upsertConflict = db.prepare(`INSERT INTO doc_conflicts(source,page,claim,actual,evidence,question,user_key,first_ts,last_ts)
  VALUES(@source,@page,@claim,@actual,@evidence,@question,@user_key,@ts,@ts)
  ON CONFLICT(source,claim,actual) DO UPDATE SET seen=doc_conflicts.seen+1, last_ts=@ts,
    evidence=COALESCE(excluded.evidence,doc_conflicts.evidence)`);
S.listConflicts = db.prepare(`SELECT source,page,claim,actual,evidence,seen,status,first_ts,last_ts
  FROM doc_conflicts WHERE status=? ORDER BY seen DESC, last_ts DESC LIMIT ?`);

function recordConflicts(list, meta = {}) {
  const ts = Date.now();
  for (const c of list || []) {
    if (!c || !c.claim || !c.actual) continue;
    try {
      S.upsertConflict.run({
        source: c.source === "docs" ? "docs" : "wiki",
        page: c.page || null,
        claim: String(c.claim).slice(0, 400),
        actual: String(c.actual).slice(0, 400),
        evidence: c.evidence ? String(c.evidence).slice(0, 300) : null,
        question: (meta.question || "").slice(0, 300),
        user_key: meta.user_key || null,
        ts,
      });
    } catch { /* a malformed conflict must never fail the answer */ }
  }
}
function conflicts(status = "open", limit = 50) { return S.listConflicts.all(status, limit); }

const userKey = id => `${id.provider}:${id.id}`;

/** Quota window resets at 00:00 UTC, so "resets in" is a real wall-clock answer. */
function windowStart() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function resetAt() { return windowStart() + 86400000; }

// A thread gets up to MAX_FOLLOWUPS cheap follow-ups; past that a question is
// a fresh line of enquiry and costs full price again.
const MAX_FOLLOWUPS = 3;
const FOLLOWUP_COST = 0.5;

/** Cost of the next question in this conversation, and how many cheap ones remain. */
function nextCost(convId, key) {
  if (!convId) return { cost: 1, followup: 0, followupsLeft: MAX_FOLLOWUPS };
  const prior = S.convTurnCount.get(convId, key).c;
  if (prior === 0) return { cost: 1, followup: 0, followupsLeft: MAX_FOLLOWUPS };
  const idx = prior;                                  // 1-based position among follow-ups
  if (idx <= MAX_FOLLOWUPS) {
    return { cost: FOLLOWUP_COST, followup: idx, followupsLeft: MAX_FOLLOWUPS - idx };
  }
  return { cost: 1, followup: 0, followupsLeft: MAX_FOLLOWUPS };
}

/** Prior turns as chat messages, oldest first, for follow-up continuity. */
function history(convId, key, turns = 3) {
  if (!convId) return [];
  const rows = S.convHistory.all(convId, key, turns).reverse();
  const out = [];
  for (const r of rows) {
    out.push({ role: "user", content: r.question });
    if (r.answer) out.push({ role: "assistant", content: r.answer });
  }
  return out;
}

function usage(key, ent) {
  const since = windowStart();
  const used = S.countToday.get(key, since).c;
  const mcpUsed = S.countMcpToday.get(key, since).c;
  const vizUsed = S.countVizToday.get(key, since).c;
  const vizLimit = Number(ent.viz || 0);
  const r = n => Math.round(n * 2) / 2;
  return {
    used: r(used), limit: ent.questions, remaining: r(Math.max(0, ent.questions - used)),
    mcpUsed, mcpLimit: ent.mcp, mcpRemaining: Math.max(0, ent.mcp - mcpUsed),
    vizUsed, vizLimit, vizRemaining: Math.max(0, vizLimit - vizUsed),
    resetAt: resetAt(), tier: ent.label, maxFollowups: MAX_FOLLOWUPS, followupCost: FOLLOWUP_COST,
  };
}

/**
 * Charge a visualization slot, after the fact. Called only when the delivered
 * answer actually carried a chart or map — the allowance buys a rendered
 * visualization, not an attempt at one.
 */
function markVizUsed(answerId) {
  try { if (Number.isInteger(Number(answerId))) S.markViz.run(Number(answerId)); } catch {}
}

function record(row) {
  row.plan = row.plan || null;
  row.validation = row.validation || null;
  row.evidence = row.evidence || null;
  row.ttft_ms = row.ttft_ms ?? null;
  row.total_ms = row.total_ms ?? null;
  row.fell_through = row.fell_through || null;
  const inserted = S.insertAsk.run(row);
  S.upsertConv.run({ id: row.conv_id, user_key: row.user_key, title: row.question.slice(0, 70), ts: row.ts, private: row.private ? 1 : 0 });
  // A question counts as activity on its own. Discord users never load a page,
  // so an ask is the only presence signal they ever produce.
  markActive(row.user_key, "ask", row.ts);
  return Number(inserted.lastInsertRowid);
}

function feedback({ answerId, userKey = null, shareToken = null, rating, reason = "" }) {
  if (!Number.isInteger(Number(answerId))) return false;
  if (!["up", "down", null].includes(rating)) return false;
  const cleanReason = String(reason || "").trim().slice(0, 500) || null;
  const args = [rating, cleanReason, Date.now(), Number(answerId)];
  const result = userKey
    ? S.feedbackByOwner.run(...args, userKey)
    : shareToken ? S.feedbackByShare.run(...args, String(shareToken)) : null;
  return Boolean(result?.changes);
}

// Discord bot answers are not normal browser turns, but they belong in the
// same review queue. Recording them as a zero-cost Discord turn makes the
// admin console, report clustering, and replay flow work without a second
// analytics silo.
function recordDiscordFeedback({ discordId, username, question, answer, rating, reason = "", usedMcp = false, answerId = null }) {
  const id = String(discordId || "").slice(0, 100);
  if (!id || !["up", "down"].includes(rating)) return null;
  const key = `discord:${id}`;
  // If the ask was already recorded at answer time (via recordDiscordAsk), link
  // the feedback to that row instead of creating a duplicate — otherwise the
  // question would be counted twice against the daily quota.
  if (answerId != null && Number.isInteger(Number(answerId))) {
    return feedback({ answerId: Number(answerId), userKey: key, rating, reason }) ? Number(answerId) : null;
  }
  touchUser(key, { provider: "discord", id, username }, { username });
  const newId = record({
    user_key: key, username: String(username || "Discord user").slice(0, 100),
    conv_id: `discord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    question: String(question || "").slice(0, 2000), answer: String(answer || "").slice(0, 30000),
    areas: "[]", citations: "[]", used_mcp: usedMcp ? 1 : 0, cached: 0,
    tokens_in: 0, tokens_out: 0, cost: 0, followup: 0, model: "discord-ask",
    plan: JSON.stringify({ id: "discord-ask" }), validation: JSON.stringify({ issues: [] }),
    evidence: JSON.stringify({ tools: [], visualizations: [] }), ts: Date.now(),
  });
  feedback({ answerId: newId, userKey: key, rating, reason });
  return newId;
}

// Discord /ask quota. Discord logins carry no AHD userId, so no supporter tier
// resolves for them — they get the base signed-in-player limits, the same
// numbers the web enforces (auth.PLAYER). Staff calls never reach here: the bot
// only meters non-staff.
const authMod = require("./auth");
function discordEnt() { return { questions: authMod.PLAYER.questions, mcp: authMod.PLAYER.mcp, label: "Discord" }; }
function discordUsage(discordId) {
  const key = `discord:${String(discordId || "").slice(0, 100)}`;
  return usage(key, discordEnt());
}
// Record a Discord ask that CONSUMES quota (cost 1), distinct from the zero-cost
// feedback row. Returns the answerId so feedback can link to it later.
function recordDiscordAsk({ discordId, username, question, answer = "", usedMcp = false }) {
  const id = String(discordId || "").slice(0, 100);
  if (!id) return null;
  const key = `discord:${id}`;
  touchUser(key, { provider: "discord", id, username }, { username });
  return record({
    user_key: key, username: String(username || "Discord user").slice(0, 100),
    conv_id: `discord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    question: String(question || "").slice(0, 2000), answer: String(answer || "").slice(0, 30000),
    areas: "[]", citations: "[]", used_mcp: usedMcp ? 1 : 0, cached: 0,
    tokens_in: 0, tokens_out: 0, cost: 1, followup: 0, model: "discord-ask",
    plan: JSON.stringify({ id: "discord-ask" }), validation: JSON.stringify({ issues: [] }),
    evidence: JSON.stringify({ tools: [], visualizations: [] }), ts: Date.now(),
  });
}

/** 'YYYY-MM-DD' in UTC — the same day boundary the quota window resets on. */
const dayKey = ts => new Date(Number(ts) || Date.now()).toISOString().slice(0, 10);

S.markActive = db.prepare("INSERT OR IGNORE INTO user_days(user_key,day,source,ts) VALUES(?,?,?,?)");
/**
 * Record that this user was present today. Idempotent per day, so it can sit on
 * the hot path of every page load. Never throws into a request.
 */
function markActive(key, source = "visit", ts = Date.now()) {
  if (!key) return;
  try { S.markActive.run(String(key), dayKey(ts), source, Number(ts)); } catch { /* telemetry must not break the request */ }
}

// Refreshing a profile without claiming the person was here. Staff opening a
// player's profile in the console re-reads their AHD context to fill in
// character/country/party; counting that as a login would let the console
// manufacture its own active users.
S.upsertProfileQuiet = db.prepare(`INSERT INTO user_profiles(user_key,username,provider,role,tier,character_name,country,party,corporation_name,corporation_role,is_admin,first_seen,last_seen)
  VALUES(@user_key,@username,@provider,@role,@tier,@character_name,@country,@party,@corporation_name,@corporation_role,@is_admin,@ts,@ts)
  ON CONFLICT(user_key) DO UPDATE SET username=excluded.username,provider=excluded.provider,role=excluded.role,tier=excluded.tier,
    character_name=excluded.character_name,country=excluded.country,party=excluded.party,corporation_name=excluded.corporation_name,
    corporation_role=excluded.corporation_role,is_admin=excluded.is_admin`);

function touchUser(key, identity, context, { activity = true } = {}) {
  const c = context?.character || {};
  const corp = context?.corporation || {};
  const row = {
    user_key: key,
    username: context?.username || identity?.username || null,
    provider: identity?.provider || null,
    role: context?.role || null,
    tier: context?.tierActive ? context?.tier || null : null,
    character_name: c.name || null,
    country: c.country || null,
    party: c.party || null,
    corporation_name: corp.name || null,
    corporation_role: corp.role || null,
    is_admin: context?.isAdmin === true ? 1 : 0,
    ts: Date.now(),
  };
  if (!activity) return void S.upsertProfileQuiet.run(row);
  S.upsertProfile.run(row);
  markActive(key, "visit", row.ts);
}

const PRICE = {
  flash: { input: 0.44, output: 1.32 },
  pro: { input: 1.32, output: 3.96 },
  free: { input: 0, output: 0 },
};
// OpenRouter free/stealth slugs, Google's free-tier Gemini, and the internal
// discord-ask marker all bill nothing, so they must not inherit the DeepSeek
// list rate. Anything else keeps the old estimate, which is what every historic
// row was priced at.
function rateFor(model) {
  const m = String(model || "");
  if (/:free$/.test(m) || /-free$/.test(m) || /:cloud$/.test(m) || m.startsWith("stealth/") || /^gemini|google/i.test(m) || m === "discord-ask") return PRICE.free;
  return /pro/i.test(m) ? PRICE.pro : PRICE.flash;
}
function estimateCost(row) {
  if (row.cached) return 0;
  const rate = rateFor(row.model);
  return (Number(row.tokens_in || 0) * rate.input + Number(row.tokens_out || 0) * rate.output) / 1_000_000;
}
function adminUsers() {
  return S.adminUserList.all();
}
// Per-model usage: real token totals, real cost (free providers = $0), and the
// helpful/unhelpful counts, straight from the recorded rows. Cached reads carry
// no tokens or cost, so they are excluded from the money and token columns.
const S_modelStats = db.prepare(`SELECT model,
    COUNT(*) questions,
    COALESCE(SUM(CASE WHEN cached=1 THEN 0 ELSE tokens_in END),0) tokens_in,
    COALESCE(SUM(CASE WHEN cached=1 THEN 0 ELSE tokens_out END),0) tokens_out,
    COALESCE(SUM(CASE WHEN feedback_rating='up' THEN 1 ELSE 0 END),0) up,
    COALESCE(SUM(CASE WHEN feedback_rating='down' THEN 1 ELSE 0 END),0) down
  FROM asks GROUP BY model ORDER BY questions DESC`);
function adminModelStats() {
  return S_modelStats.all().map(r => {
    const rate = rateFor(r.model);
    return { ...r, cost: (Number(r.tokens_in) * rate.input + Number(r.tokens_out) * rate.output) / 1_000_000 };
  });
}
function adminUser(key) {
  const profile = S.adminProfile.get(key);
  if (!profile) return null;
  const questions = S.adminQuestions.all(key).map(row => ({
    ...row, plan: safeJson(row.plan), validation: safeJson(row.validation), evidence: safeJson(row.evidence),
    estimated_cost: estimateCost(row),
  }));
  return { profile, questions, estimated_cost: questions.reduce((sum, row) => sum + row.estimated_cost, 0) };
}
function reportCategory(row) {
  const text = `${row.feedback_reason || ""} ${row.question || ""} ${row.answer || ""}`.toLowerCase();
  if (/chart|graph|visual|map|gdp|metric|render|label|fit/.test(text)) return "visualization or evidence mismatch";
  if (/live|current|fresh|lookup|mcp|state/.test(text)) return "live-data retrieval";
  if (/name|named|found|entity|corporation|player|match/.test(text)) return "entity resolution";
  if (/private|exploit|unfair|opponent|hidden/.test(text)) return "fair-play boundary";
  if (/wrong|not answer|irrelevant|unsatisfactory|trash/.test(text)) return "answer relevance";
  return "uncategorized";
}
function reportClusters(limit = 100) {
  const groups = new Map();
  for (const row of S.adminReports.all(limit)) {
    const category = reportCategory(row);
    const group = groups.get(category) || { category, count: 0, reports: [] };
    group.count += 1;
    if (group.reports.length < 5) group.reports.push({
      ...row, plan: safeJson(row.plan), validation: safeJson(row.validation), evidence: safeJson(row.evidence),
    });
    groups.set(category, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
function conversations(key) { return S.listConvs.all(key); }
function turns(convId, key) {
  return S.convTurns.all(convId, key).map(t => ({
    ...t, areas: safeJson(t.areas), citations: safeJson(t.citations), plan: safeJson(t.plan),
    validation: safeJson(t.validation), evidence: safeJson(t.evidence),
  }));
}
function removeConv(convId, key) { S.deleteConvAsks.run(convId, key); S.deleteConv.run(convId, key); }

const crypto = require("node:crypto");
S.setShare = db.prepare("UPDATE convs SET share_token=? WHERE id=? AND user_key=?");
S.getShare = db.prepare("SELECT share_token,private FROM convs WHERE id=? AND user_key=?");
S.byShare  = db.prepare("SELECT id, user_key, title, updated FROM convs WHERE share_token=?");
S.markPrivate = db.prepare("UPDATE convs SET private=1,share_token=NULL WHERE id=? AND user_key=?");

/** Create (or return) a share token. Idempotent so re-clicking Share is safe. */
function share(convId, key) {
  const cur = S.getShare.get(convId, key);
  if (!cur || cur.private) return null;
  if (cur.share_token) return cur.share_token;
  const tok = crypto.randomBytes(9).toString("base64url");
  S.setShare.run(tok, convId, key);
  return tok;
}
function unshare(convId, key) { S.setShare.run(null, convId, key); }
function markPrivate(convId, key) { S.markPrivate.run(convId, key); }
function isPrivate(convId, key) { return S.getShare.get(convId, key)?.private === 1; }

/** Read-only view of a shared conversation, for anyone holding the link. */
function shared(token) {
  const c = S.byShare.get(token);
  if (!c) return null;
  return { title: c.title, updated: c.updated, shareToken: token, turns: turns(c.id, c.user_key) };
}
function safeJson(s) { try { return JSON.parse(s || "[]"); } catch { return []; } }

S.putReport = db.prepare("INSERT INTO reports(token,user_key,username,answer_id,title,question,body,model,created) VALUES(?,?,?,?,?,?,?,?,?)");
S.getReport = db.prepare("SELECT * FROM reports WHERE token=?");
S.userReports = db.prepare("SELECT token,title,created FROM reports WHERE user_key=? ORDER BY created DESC LIMIT 40");
function putReport({ token, userKey, username, answerId, title, question, body, model }) {
  S.putReport.run(token, userKey, username || null, answerId || null, title, question, body, model || null, Date.now());
}
function getReport(token) { return S.getReport.get(token) || null; }
function userReports(key) { return S.userReports.all(key); }

module.exports = { db, S, userKey, usage, record, feedback, recordDiscordFeedback, recordDiscordAsk, discordUsage, conversations, turns, removeConv, resetAt, windowStart, safeJson, recordConflicts, conflicts, nextCost, history, MAX_FOLLOWUPS, FOLLOWUP_COST, share, unshare, markPrivate, isPrivate, shared, touchUser, adminUsers, adminUser, adminModelStats, reportClusters, estimateCost, putReport, getReport, userReports, recordAudit, recentAudits, auditSummary, answerBrief, evictCacheByQuestion, replayCandidates, setEmbedHealth, retrievalMisses, issueCounts, servingStats, digest, updateGrounding, evictCache,
  activity, activeKeys, markActive, dayKey, ACTIVE_WINDOW_DAYS,
  reviewQueue, reviewCounts, saveReview, clearReview, reviewRow, recentQuestions, markVizUsed };
