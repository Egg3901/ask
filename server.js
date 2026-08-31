// ask.lakesidegames.net — player Q&A over the live A House Divided codebase.
//
// Sign-in required, supporters and staff only. This service holds no database
// handle and no JWT secret: identity comes from the Lakeside Auth broker and
// entitlement from ops-dash over loopback.
const http = require("node:http");
const crypto = require("node:crypto");

const auth = require("./auth");
const store = require("./store");
const cites = require("./citations");
const prompt = require("./prompt");
const page = require("./page");
const mcp = require("./mcp");
const retrieve = require("./retrieve");
const grounding = require("./grounding");
const investigate = require("./investigate");
const queryAliases = require("./query-aliases");
const answerRepair = require("./answer-repair");
const history = require("./history");
const navigation = require("./navigation");
const corrections = require("./corrections");
const llm = require("./llm");
const models = require("./models");
const router = require("./router");
const visualization = require("./visualization");
const mapVisualization = require("./map-visualization");
const askPlan = require("./ask-plan");
const answerGuard = require("./answer-guard");
const answerAudit = require("./answer-audit");
const ogImage = require("./og-image");
const games = require("./games");
const clarification = require("./clarification");
const discordAsk = require("./discord-ask");
const capabilities = require("./capabilities");
const playbooks = require("./playbooks");
const attribution = require("./attribution");

// Where the docs build writes its output. Ask reads only the per-game logo from
// it, so a missing docs build degrades to a 404 mark, never a broken page.
const DOCS_ROOT = process.env.DOCS_ROOT || "/srv/lakeside-docs";

const PORT = Number(process.env.PORT || 9749);
const UPSTREAM = process.env.UPSTREAM_URL || "http://127.0.0.1:9724/api/ask-public";
const ASK_SECRET = process.env.ASK_SECRET || "";
const MODEL_LABEL = process.env.MODEL_LABEL || require("./router").MODELS.flash;
// Deep-tier budgets. Ox Alpha leads that chain with a 1M context and a 131k
// completion ceiling, so the constraint is answer quality, not room.
const DEEP_TOP_K = Number(process.env.ASK_DEEP_TOP_K || 16);
const DEEP_MAX_CHARS = Number(process.env.ASK_DEEP_MAX_CHARS || 60000);
const DEEP_HISTORY_TURNS = Number(process.env.ASK_DEEP_HISTORY || 8);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 86400000);
const MAX_Q = 500;
// "generate/write/make ... report" or "report on/about X". Deliberately does
// NOT match "report a bug" / "how do I report", which are the support flow.
const REPORT_RE = /\b(?:generate|create|write(?:\s+up)?|make|build|compile|produce|prepare|give\s+me)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:full\s+|detailed\s+|deep\s+)?report\b|\breport\s+(?:on|about|covering)\b/i;
const SELF_ORIGIN = process.env.SELF_ORIGIN || "https://ask.lakesidegames.net";

// In-flight answer generations, keyed by an unguessable per-request id, so an
// explicit Stop from the client can abort exactly its own generation. A closed
// connection does NOT abort — the answer finishes and is recorded regardless.
const activeGenerations = new Map();

const json = (res, code, obj) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b),
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  });
  res.end(b);
};
const html = (res, code, body) => {
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  });
  res.end(body);
};
async function readJson(req, cap = 16384) {
  if (Object.hasOwn(req, "_askJson")) return req._askJson;
  let b = ""; req.on("data", c => { b += c; if (b.length > cap) req.destroy(); });
  await new Promise(r => req.on("end", r));
  try {
    req._askJson = JSON.parse(b || "{}");
    return req._askJson;
  } catch { return null; }
}
const norm = q => q.toLowerCase().replace(/\s+/g, " ").replace(/[?.!,]+$/, "").trim();

// Constant-time check of the shared machine secret (Discord bot, map PNG).
function askSecretOk(req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const supplied = Buffer.from(bearer), expected = Buffer.from(ASK_SECRET);
  return Boolean(ASK_SECRET) && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let p = url.pathname;

  try {
    if (req.method === "GET" && p === "/healthz") return json(res, 200, { ok: true });

    // Map SVGs are safe to render on shared, signed-out transcripts because the
    // specification is strictly validated and the server owns every geometry.
    // PNG conversion is reserved for the Discord bot's shared Ask secret.
    if (req.method === "POST" && p === "/api/map/render") {
      const format = url.searchParams.get("format") === "png" ? "png" : "svg";
      if (format === "png") {
        const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const supplied = Buffer.from(bearer), expected = Buffer.from(ASK_SECRET);
        if (!ASK_SECRET || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
          return json(res, 401, { error: "Not authorized." });
        }
      }
      const body = await readJson(req, 65536);
      if (!body) return json(res, 400, { error: "Invalid map specification." });
      try {
        const output = format === "png"
          ? await mapVisualization.renderPng(body)
          : Buffer.from(await mapVisualization.renderSvg(body));
        res.writeHead(200, {
          "Content-Type": format === "png" ? "image/png" : "image/svg+xml; charset=utf-8",
          "Content-Length": output.length,
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(output);
      } catch (error) {
        console.warn("[ask] map render rejected:", String(error?.message || error));
        return json(res, 400, { error: "This map could not be rendered." });
      }
    }

    // ── auth ────────────────────────────────────────────────────────────────
    if (req.method === "GET" && p === "/auth/login") {
      return auth.loginRedirect(res, url.searchParams.get("next") || "/");
    }
    if (req.method === "GET" && p === "/auth/callback") {
      const code = url.searchParams.get("code");
      if (!code) { res.writeHead(302, { Location: "/?auth=failed" }); return res.end(); }
      return auth.completeLogin(res, code, url.searchParams.get("next") || "/");
    }
    if (p === "/auth/logout") { auth.invalidate(req); return auth.logout(res); }

    // Brand mark. Public: it is the favicon and appears on signed-out pages.
    if (req.method === "GET" && p === "/ahd-logo.png") {
      try {
        const buf = require("node:fs").readFileSync(require("node:path").join(__dirname, "ahd-logo.png"));
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length,
          "Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff" });
        return res.end(buf);
      } catch { res.writeHead(404); return res.end(); }
    }

    // Game marks for the switcher, served same-origin from what the docs build
    // already produced. That build is also where the Lakeside-mark fallback is
    // applied, so a game without its own logo resolves correctly here with no
    // second copy of the rule.
    if (req.method === "GET" && /^\/game-logo\/[a-z0-9-]{2,32}\.png$/.test(p)) {
      const g = games.resolve(p.slice("/game-logo/".length, -4));
      try {
        const file = require("node:path").join(DOCS_ROOT, g.docsSubdir || "", "logo.png");
        const buf = require("node:fs").readFileSync(file);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length,
          "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
        return res.end(buf);
      } catch { res.writeHead(404); return res.end(); }
    }

    // Social-card images. Public and unauthenticated by design: an unfurl bot
    // (Discord, Slack, X) fetches these with no session. The unguessable token is
    // still the permission — an unknown token renders the generic card, never
    // another session's content.
    if (req.method === "GET" && (p === "/og-default.png" || /^\/[sr]\/[A-Za-z0-9_-]{8,32}\/og\.png$/.test(p))) {
      let card = { kind: "Ask", question: "How A House Divided actually works", footer: "ask.lakesidegames.net" };
      const m = p.match(/^\/([sr])\/([A-Za-z0-9_-]{8,32})\/og\.png$/);
      if (m && m[1] === "s") {
        const conv = store.shared(m[2]);
        if (conv) {
          const n = (conv.turns || []).length;
          card = { kind: "Shared answer", question: conv.title || (conv.turns?.[0]?.question) || "Shared conversation",
            footer: `${n} answer${n === 1 ? "" : "s"} · ask.lakesidegames.net` };
        }
      } else if (m && m[1] === "r") {
        const report = store.getReport(m[2]);
        if (report) card = { kind: "Report", question: report.title || report.question || "Report", footer: "ask.lakesidegames.net" };
      }
      try {
        const png = await ogImage.renderCard(card);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length,
          "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
        return res.end(png);
      } catch (e) {
        console.warn("[ask] og render failed:", String(e?.message || e));
        return json(res, 500, { error: "card render failed" });
      }
    }

    // Report pages: same token-is-the-permission model as shared transcripts.
    if (req.method === "GET" && p.startsWith("/r/")) {
      const tok = p.slice(3);
      const report = /^[A-Za-z0-9_-]{8,32}$/.test(tok) ? store.getReport(tok) : null;
      if (!report) return html(res, 404, page.signedOut({ notFound: true }));
      return html(res, 200, page.reportView(report));
    }

    // Shared transcripts are readable without signing in — the unguessable token
    // is the permission. Read-only, and revocable by the owner.
    if (req.method === "GET" && p.startsWith("/s/")) {
      const tok = p.slice(3);
      const conv = /^[A-Za-z0-9_-]{8,32}$/.test(tok) ? store.shared(tok) : null;
      if (!conv) return html(res, 404, page.signedOut({ notFound: true }));
      return html(res, 200, page.sharedView(conv));
    }
    if (req.method === "POST" && p === "/api/shared/feedback") {
      const body = await readJson(req);
      const token = String(body?.shareToken || "");
      const rating = body?.rating === "up" ? "up" : body?.rating === "down" ? "down" : null;
      if (!/^[A-Za-z0-9_-]{8,32}$/.test(token) || !rating) return json(res, 400, { error: "Invalid feedback." });
      const ok = store.feedback({
        answerId: Number(body?.answerId),
        shareToken: token,
        rating,
        reason: String(body?.reason || ""),
      });
      // Same consequences as an owner downvote: evict + queue for review.
      if (ok && rating === "down") {
        const brief = store.answerBrief(Number(body?.answerId));
        if (brief?.question) {
          store.evictCacheByQuestion(brief.question);
          corrections.draft({ question: brief.question, reason: `shared-page report${body?.reason ? `: ${String(body.reason).slice(0, 300)}` : ""}`, sourceAnswerId: Number(body?.answerId) }).catch(() => {});
        }
      }
      return json(res, ok ? 200 : 404, { ok });
    }
    if (req.method === "POST" && p === "/api/discord-feedback") {
      const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const supplied = Buffer.from(bearer), expected = Buffer.from(ASK_SECRET);
      if (!ASK_SECRET || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return json(res, 401, { error: "Not authorized." });
      }
      const body = await readJson(req, 65536);
      const rating = body?.rating === "up" ? "up" : body?.rating === "down" ? "down" : null;
      if (!rating || !body?.discordId || !body?.question || !body?.answer) return json(res, 400, { error: "Invalid feedback." });
      const answerId = store.recordDiscordFeedback({
        discordId: body.discordId, username: body.username, question: body.question,
        answer: body.answer, rating, reason: String(body.reason || "").slice(0, 500), usedMcp: body.usedMcp === true,
        answerId: body.answerId != null ? Number(body.answerId) : null,
      });
      // A Discord report must have the same consequences as a web downvote:
      // the answer stops being served from the shared cache and the report
      // seeds a staff-review correction draft. Without these, the bot's
      // "the issue is in the Ask review queue" confirmation was a lie — the
      // report landed in a row nothing ever read.
      let queued = false;
      if (answerId && rating === "down") {
        const brief = store.answerBrief(answerId);
        const question = brief?.question || String(body.question || "");
        if (question) {
          store.evictCacheByQuestion(question);
          corrections.draft({
            question,
            reason: `discord report${body.reason ? `: ${String(body.reason).slice(0, 300)}` : ""}`,
            sourceAnswerId: answerId,
          }).catch(() => {});
          queued = true;
        }
      }
      return json(res, answerId ? 200 : 400, { ok: Boolean(answerId), answerId, queued });
    }

    // Discord /ask quota. Non-staff bot callers get the same daily limits a web
    // player does (auth.PLAYER); staff are exempt and the bot never calls these
    // for them. `check` is a read-only pre-gate; `record` consumes one question.
    if (req.method === "POST" && p === "/api/discord-ask/check") {
      if (!askSecretOk(req)) return json(res, 401, { error: "Not authorized." });
      const body = await readJson(req);
      const id = String(body?.discordId || "");
      if (!id) return json(res, 400, { error: "discordId required." });
      const u = store.discordUsage(id);
      const live = body?.live === true;
      const allowed = u.remaining >= 1 && (!live || u.mcpRemaining >= 1);
      return json(res, 200, { allowed, usage: u, reason: allowed ? null : (u.remaining < 1 ? "daily" : "live") });
    }
    if (req.method === "POST" && p === "/api/discord-ask/record") {
      if (!askSecretOk(req)) return json(res, 401, { error: "Not authorized." });
      const body = await readJson(req, 65536);
      if (!body?.discordId || !body?.question) return json(res, 400, { error: "discordId and question required." });
      const answerId = store.recordDiscordAsk({
        discordId: body.discordId, username: body.username, question: body.question,
        answer: body.answer, usedMcp: body.usedMcp === true,
      });
      return json(res, answerId ? 200 : 400, { ok: Boolean(answerId), answerId, usage: store.discordUsage(body.discordId) });
    }

    // Discord enters through the same pipeline as the browser. The shared
    // secret authenticates the bot, then a synthetic public-player session
    // gives the existing handler the same quota, self-scope, retrieval, live
    // tools, guards, telemetry, and SSE events without a second answer engine.
    let internalSession = null;
    if (req.method === "POST" && p === "/api/discord-ask/answer") {
      if (!askSecretOk(req)) return json(res, 401, { error: "Not authorized." });
      const body = await readJson(req, 65536);
      if (!body) return json(res, 400, { error: "Bad request." });
      try {
        internalSession = discordAsk.discordSession(body);
        req._askJson = discordAsk.normalizeDiscordAsk(body);
        p = "/api/ask";
      } catch (error) {
        return json(res, 400, { error: String(error?.message || error) });
      }
    }

    const session = internalSession || await auth.resolve(req);

    // ── page ────────────────────────────────────────────────────────────────
    // Public, cacheable release notes. No session required — nothing here is
    // user-specific, so a short shared cache is safe.
    if (req.method === "GET" && p === "/changelog") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
      });
      return res.end(page.changelogPage());
    }

    // Public legal pages. Deliberately reachable without a session: someone
    // deciding whether to sign in needs to read what Ask sends to AI providers
    // BEFORE they hand it a question, not after.
    if (req.method === "GET" && (p === "/privacy" || p === "/terms")) {
      const body = page.legalPage(p.slice(1));
      if (body) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
        });
        return res.end(body);
      }
    }

    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      if (!session) {
        return html(res, 200, page.signedOut({ failed: url.searchParams.get("auth") === "failed" }));
      }
      const ent = session.entitlement;
      if (!ent.allowed) {
        return html(res, 200, page.notEntitled({ identity: session.identity, context: session.context, reason: ent.reason }));
      }
      const key = store.userKey(session.identity);
      store.touchUser(key, session.identity, session.context);
      // ?game= selects which game the page renders for (starters, hero copy,
      // brand). The switcher navigates here rather than swapping it client-side,
      // so everything server-rendered agrees with the selection.
      return html(res, 200, page.app({
        identity: session.identity, context: session.context, entitlement: ent,
        usage: store.usage(key, ent), conversations: store.conversations(key), model: MODEL_LABEL,
        styles: prompt.STYLES, lengths: prompt.LENGTHS,
        // The reasoning control only renders for staff; everyone else is on auto
        // and has no dial to misread.
        efforts: ent.staff ? router.EFFORTS : null,
        game: games.resolve(url.searchParams.get("game")),
      }));
    }

    if (req.method === "GET" && p === "/console") {
      if (!session || session.context?.isAdmin !== true) return html(res, session ? 403 : 401, page.signedOut({ notFound: true }));
      const key = store.userKey(session.identity);
      store.touchUser(key, session.identity, session.context);
      const selectedKey = url.searchParams.get("user") || "";
      if (selectedKey.startsWith("ahd:")) {
        const selectedContext = await auth.playerContextForUserId(selectedKey.slice(4));
        // Refresh their profile facts but do NOT log presence: staff reading a
        // profile is not that player being active, and counting it would let the
        // console inflate its own active-user numbers.
        if (selectedContext) store.touchUser(selectedKey,
          { provider: "ahd", id: selectedKey.slice(4), username: selectedContext.username }, selectedContext,
          { activity: false });
      }
      const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 7), 365);
      return html(res, 200, page.consolePage({
        identity: session.identity,
            context: session.context,
            users: store.adminUsers(),
            selected: selectedKey ? store.adminUser(selectedKey) : null,
            reports: store.reportClusters(),
            modelStats: store.adminModelStats(),
            correctionRows: corrections.list(),
            health: store.digest(Date.now() - 7 * 864e5),
            activity: store.activity({ days }),
            days,
            tab: url.searchParams.get("tab") || "overview",
          }));
    }

    // Automated answer-audit log: the free-model QA sampler's verdicts, newest
    // first, plus a 7-day rollup. Staff-only, read-only telemetry.
    if (req.method === "GET" && p === "/console/audits.json") {
      if (!session || session.context?.isAdmin !== true) return json(res, session ? 403 : 401, { error: "Staff only." });
      const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
      return json(res, 200, {
        sampleRate: answerAudit.SAMPLE_RATE,
        summary7d: store.auditSummary(Date.now() - 7 * 864e5),
        audits: store.recentAudits(limit),
      });
    }

    // Health rollup over a window (default 7 days): serving stats per model,
    // guard-trip counts, the retrieval-miss work queue, and the correction
    // pipeline state. Staff sessions or the internal digest secret (the weekly
    // Discord digest runs from cron, which has no browser session).
    if (req.method === "GET" && p === "/console/health.json") {
      const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const supplied = Buffer.from(bearer), expected = Buffer.from(ASK_SECRET);
      const internal = Boolean(ASK_SECRET) && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
      if (!internal && (!session || session.context?.isAdmin !== true)) return json(res, session ? 403 : 401, { error: "Staff only." });
      const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
      return json(res, 200, store.digest(Date.now() - days * 864e5));
    }

    // Replay-candidate feed: every downvoted or guard-flagged answer, shaped
    // for curation into eval/reported-failures.json (scripts/pull-replay-cases
    // fetches this). Same auth as health.json. The loop this closes: a report
    // lands in telemetry, becomes a frozen replay case, and the same failure
    // can never ship twice unnoticed.
    if (req.method === "GET" && p === "/console/replay.json") {
      const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const supplied = Buffer.from(bearer), expected = Buffer.from(ASK_SECRET);
      const internal = Boolean(ASK_SECRET) && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
      if (!internal && (!session || session.context?.isAdmin !== true)) return json(res, session ? 403 : 401, { error: "Staff only." });
      const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 14, 1), 90);
      return json(res, 200, { candidates: store.replayCandidates(Date.now() - days * 864e5) });
    }

    // Staff answer review: one card at a time over everything nobody has judged.
    // The queue itself is built in the store; this only serves it.
    if (req.method === "GET" && p === "/console/review") {
      if (!session || session.context?.isAdmin !== true) return html(res, session ? 403 : 401, page.signedOut({ notFound: true }));
      const oldestFirst = url.searchParams.get("order") === "oldest";
      return html(res, 200, page.reviewPage({
        identity: session.identity, context: session.context,
        cards: store.reviewQueue({ limit: 25, oldestFirst }),
        counts: store.reviewCounts(),
        oldestFirst,
      }));
    }

    // Next batch, so the card deck refills without a page load.
    if (req.method === "GET" && p === "/console/review.json") {
      if (!session || session.context?.isAdmin !== true) return json(res, session ? 403 : 401, { error: "Staff only." });
      return json(res, 200, {
        cards: store.reviewQueue({ limit: Number(url.searchParams.get("limit")) || 25, oldestFirst: url.searchParams.get("order") === "oldest" }),
        counts: store.reviewCounts(),
      });
    }

    // Every question, most recent first — the screen that hides nothing, as
    // opposed to the review queue which hides everything already judged.
    if (req.method === "GET" && p === "/console/questions") {
      if (!session || session.context?.isAdmin !== true) return html(res, session ? 403 : 401, page.signedOut({ notFound: true }));
      const perPage = 50;
      const pageNum = Math.max(Number(url.searchParams.get("page")) || 1, 1);
      const search = String(url.searchParams.get("q") || "").slice(0, 100);
      const state = String(url.searchParams.get("state") || "all");
      return html(res, 200, page.questionsPage({
        identity: session.identity, context: session.context,
        feed: store.recentQuestions({ limit: perPage, offset: (pageNum - 1) * perPage, search, state }),
        counts: store.reviewCounts(), pageNum, search, state,
      }));
    }

    // Day-by-day audience and volume: active users (a login or a question inside
    // the trailing week) and questions per day. Same auth as health.json — a
    // staff session, or the internal secret so cron jobs can read it.
    if (req.method === "GET" && p === "/console/activity.json") {
      const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const supplied = Buffer.from(bearer), expected = Buffer.from(ASK_SECRET);
      const internal = Boolean(ASK_SECRET) && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
      if (!internal && (!session || session.context?.isAdmin !== true)) return json(res, session ? 403 : 401, { error: "Staff only." });
      const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
      const out = store.activity({ days });
      // The key list is only there to badge rows in the console's own user
      // table; it has no business travelling in a JSON export.
      return json(res, 200, { ...out, active: { ...out.active, keys: undefined } });
    }

    // The switcher's contents. Public: it names games and their public URLs and
    // nothing else, and the signed-out lander renders the switcher too.
    if (req.method === "GET" && p === "/api/games") {
      return json(res, 200, { games: games.publicList(), default: games.DEFAULT_ID });
    }

    // Everything below requires a signed-in, entitled user.
    if (p.startsWith("/api/")) {
      if (!session) return json(res, 401, { error: "Please sign in.", signedOut: true });
      const ent = session.entitlement;
      const key = store.userKey(session.identity);
      const moderatorAccess = session.context?.isAdmin === true || session.context?.isModerator === true;

      if (req.method === "GET" && p === "/api/me") {
        return json(res, 200, {
          identity: session.identity, context: session.context, entitlement: ent,
          usage: ent.allowed ? store.usage(key, ent) : null,
        });
      }
      if (!ent.allowed) return json(res, 403, { error: "Ask is available to signed-in players.", reason: ent.reason });

      // Corrections: staff-curated memory. Add from the console after fixing a
      // reported answer; disable instead of delete so the audit trail stays.
      if (p === "/api/corrections") {
        if (session.context?.isAdmin !== true) return json(res, 403, { error: "Staff only." });
        if (req.method === "GET") return json(res, 200, { corrections: corrections.list() });
        if (req.method === "POST") {
          const body = await readJson(req);
          if (!body) return json(res, 400, { error: "Bad JSON." });
          try {
            const added = await corrections.add({
              question: body.question, correction: body.correction,
              sourceAnswerId: Number(body.sourceAnswerId) || null, addedBy: session.identity.username || key,
            });
            return json(res, 200, added);
          } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
        }
      }
      if (req.method === "POST" && p === "/api/corrections/toggle") {
        if (session.context?.isAdmin !== true) return json(res, 403, { error: "Staff only." });
        const body = await readJson(req);
        if (!body?.id) return json(res, 400, { error: "id required." });
        corrections.setActive(body.id, body.active !== false);
        return json(res, 200, { ok: true });
      }
      // Turn an auto-drafted correction into a live one: staff writes the
      // verified truth and it activates in a single step.
      if (req.method === "POST" && p === "/api/corrections/resolve") {
        if (session.context?.isAdmin !== true) return json(res, 403, { error: "Staff only." });
        const body = await readJson(req);
        if (!body?.id) return json(res, 400, { error: "id required." });
        try {
          const out = corrections.resolve(body.id, body.correction, session.identity.username || key);
          return json(res, out.updated ? 200 : 404, { ok: Boolean(out.updated) });
        } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
      }

      if (req.method === "GET" && p === "/api/nextcost") {
        return json(res, 200, store.nextCost(url.searchParams.get("convId") || "", key));
      }
      if (req.method === "GET" && p === "/api/conversations") {
        return json(res, 200, { conversations: store.conversations(key), usage: store.usage(key, ent) });
      }
      if (req.method === "GET" && p === "/api/conversation") {
        const id = url.searchParams.get("id") || "";
        return json(res, 200, { id, turns: store.turns(id, key) });
      }
      if (req.method === "POST" && p === "/api/conversation/delete") {
        const body = await readJson(req);
        if (body?.id) store.removeConv(String(body.id), key);
        return json(res, 200, { ok: true, conversations: store.conversations(key) });
      }
      if (req.method === "POST" && p === "/api/conversation/share") {
        const b = await readJson(req);
        const id = String(b?.id || "");
        if (b?.revoke) { store.unshare(id, key); return json(res, 200, { ok: true, url: null }); }
        if (moderatorAccess || store.isPrivate(id, key)) return json(res, 403, { error: "Private moderator conversations cannot be shared." });
        const tok = store.share(id, key);
        return json(res, 200, tok ? { ok: true, url: `${SELF_ORIGIN}/s/${tok}` } : { ok: false });
      }
      if (req.method === "POST" && p === "/api/answer/feedback") {
        const b = await readJson(req);
        const rating = b?.rating === "up" ? "up" : b?.rating === "down" ? "down" : null;
        if (!rating) return json(res, 400, { error: "Choose helpful or report." });
        const reason = String(b?.reason || "");
        const ok = store.feedback({
          answerId: Number(b?.answerId),
          userKey: key,
          rating,
          reason,
        });
        // A downvote is the strongest wrong-answer signal there is. Seed a
        // staff-review draft correction from it (dedup'd, fire-and-forget),
        // and stop serving the reported answer from the shared cache — until
        // now a cached wrong answer kept serving every asker for 24h after
        // the report.
        if (ok && rating === "down") {
          const brief = store.answerBrief(Number(b?.answerId));
          if (brief?.question) {
            store.evictCacheByQuestion(brief.question);
            corrections.draft({ question: brief.question, reason: `downvote${reason ? `: ${reason}` : ""}`, sourceAnswerId: Number(b?.answerId) })
              .catch(() => {});
          }
        }
        return json(res, ok ? 200 : 404, { ok });
      }
      // A staff verdict on one answer. 'good' | 'bad' | null (a skip, which
      // still counts as looked-at). A 'bad' seeds a correction draft, exactly
      // as a player downvote does — the point of reviewing is to teach.
      if (req.method === "POST" && p === "/api/console/review") {
        if (session.context?.isAdmin !== true) return json(res, 403, { error: "Staff only." });
        const b = await readJson(req);
        const rating = b?.rating === "good" ? "good" : b?.rating === "bad" ? "bad" : null;
        if (b?.rating != null && rating === null) return json(res, 400, { error: "Rating must be good, bad, or omitted to skip." });
        const note = String(b?.reason || "");
        const saved = store.saveReview({
          answerId: Number(b?.answerId), rating, note,
          by: session.identity?.username || key,
        });
        if (!saved) return json(res, 404, { ok: false, error: "No such answer." });
        if (rating === "bad" && saved.question) {
          corrections.draft({ question: saved.question, reason: `staff review${note ? `: ${note}` : ""}`, sourceAnswerId: saved.id })
            .catch(() => {});
        }
        return json(res, 200, { ok: true, counts: store.reviewCounts() });
      }

      // Undo the last card, so a misfired keystroke is not a permanent verdict.
      if (req.method === "POST" && p === "/api/console/review/undo") {
        if (session.context?.isAdmin !== true) return json(res, 403, { error: "Staff only." });
        const b = await readJson(req);
        const ok = store.clearReview(Number(b?.answerId));
        return json(res, ok ? 200 : 404, { ok, counts: store.reviewCounts() });
      }

      if (req.method === "GET" && p === "/api/conflicts" && ent.staff) {
        return json(res, 200, { conflicts: store.conflicts(url.searchParams.get("status") || "open", 100) });
      }

      // Deliberate cancel. Aborts the caller's own in-flight generation (matched
      // by the reqId handed out in the ask stream's meta event) and records
      // nothing, so a stopped answer costs the player no quota. Closing the tab
      // is NOT this — that lets the answer finish and be saved.
      if (req.method === "POST" && p === "/api/ask/stop") {
        const b = await readJson(req);
        const g = activeGenerations.get(String(b?.reqId || ""));
        if (g && g.key === key) { try { g.ac.abort(); } catch {} return json(res, 200, { ok: true }); }
        return json(res, 200, { ok: false });
      }

      if (req.method === "POST" && p === "/api/ask") {
        const body = await readJson(req);
        if (!body) return json(res, 400, { error: "Bad request." });
        const question = String(body.question || "").trim();
        if (question.length < 5) return json(res, 400, { error: "Please ask a slightly longer question." });
        if (question.length > MAX_Q) return json(res, 400, { error: `Keep questions under ${MAX_Q} characters.` });
        const askMode = capabilities.normalizeMode(body.mode);
        const askModeIssue = capabilities.modeIssue(askMode, question);
        if (askModeIssue) return json(res, 400, { error: askModeIssue });

        // Which game this question is about. The picker decides unless the
        // question names a different game outright (see games.forQuestion).
        const game = games.forQuestion(question, body.game);
        // The asker's own timezone, as their browser reports it. Validated
        // against the runtime's zone database and dropped if it is anything
        // else — this is the difference between "shipped today" and a confident
        // "yesterday" that is off by a day for everyone west of UTC.
        const tz = history.validZone(body.tz);

        const style = prompt.STYLES[body.style] ? body.style : "standard";
        // A report request is a product mode, not a phrasing: deep tier, live
        // data (it spends one live-data question), the house report format, and
        // a standalone shareable page at the end.
        const reportRequested = REPORT_RE.test(question);
        const length = reportRequested ? "deep" : (prompt.LENGTHS[body.length] ? body.length : "standard");
        // Visualizations are metered, not gated: every tier has some, and running
        // out is a daily allowance rather than a locked feature. A player who asks
        // for one past their allowance still gets a real prose answer, and the
        // model is told to say why the chart is missing.
        const vizQuota = store.usage(key, ent);
        const vizEntitled = ent.visualizations === true && Number(ent.viz || 0) > 0;
        const vizAllowed = vizEntitled && vizQuota.vizRemaining >= 1;
        const vizWanted = visualization.requested(question) || body.visualizations === true;
        const vizBlocked = vizWanted && !vizAllowed;
        // Why it is missing, in the two cases that differ for the player. Only
        // set when they actually wanted one, so an ordinary question never picks
        // up an irrelevant apology.
        const vizLimitReason = !vizWanted ? null
          : vizAllowed ? null
          : vizEntitled ? "quota" : "tier";

        let plan = askPlan.create(question, session.context, askMode);
        if (!vizAllowed && plan.visual !== "none") {
          // The plan drives answer-guard, which injects a canonical map for a map
          // plan regardless of the request toggle. Downgrade it here or the guard
          // hands out the very thing the tier does not include. The id changes too,
          // so a prose answer never lands in an entitled player's cache slot.
          plan = { ...plan, id: `${plan.id}-prose`, display: { ...plan.display, kind: "prose", canonical: false }, visual: "none" };
        }
        const visualizationRequested = vizAllowed && visualization.requested(question);
        const visualizations = vizAllowed && (visualizationRequested || (body.visualizations === true && plan.visual !== "none"));
        const convId = /^[A-Za-z0-9_-]{6,40}$/.test(body.convId || "") ? body.convId : crypto.randomUUID().slice(0, 18);
        // A previously public conversation must become private before any
        // moderator-only turn can be appended to it.
        if (moderatorAccess) store.markPrivate(convId, key);
        // Refuse explicit fog-of-war requests before opening the token stream.
        // A post-generation guard can correct the final answer, but it cannot
        // retract sensitive text that was already delivered as SSE deltas.
        if (!moderatorAccess && answerGuard.asksForPrivateMilitaryIntelligence(question)) {
          return json(res, 200, {
            convId,
            answer: answerGuard.protectPublicAnswer("", question),
            areas: [], citations: [], cached: false, usedMcp: false, cost: 0,
            followup: 0, followupsLeft: 0, followups: [], vizBlocked: false,
            reportUrl: null, liveSources: [], model: "Ask", modelId: "ask-privacy",
            modelName: "Ask", provider: "lakeside", providerName: "Lakeside", conflicts: [], usage: store.usage(key, ent),
            liveHint: null,
          });
        }
        // Live game state exists only for A House Divided: it is the one game
        // with a running shared world. For the others there is nothing to query,
        // so the request never becomes a live one and never spends live quota.
        // Two different things, and they used to be one.
        //
        // REQUIRED: the question cannot be answered honestly without reading the
        // running world. PREFERRED: live mode is simply switched on, which is now
        // the default, so it says nothing about whether this question needs it.
        //
        // Conflating them meant that once live mode defaulted on, every question
        // would hit the live gate and a spent live allowance would 429 questions
        // that never wanted live data in the first place.
        const moderatorPrivateQuestion = moderatorAccess && answerGuard.asksForPrivateMilitaryIntelligence(question);
        const liveRequired = game.live && (plan.live === "required" || mcp.requiresLive(question) || reportRequested || moderatorPrivateQuestion);
        const liveWanted = game.live && plan.live !== "none" && (liveRequired || body.useMcp === true);
        const wantMcp = liveWanted;

        // Follow-ups depend on the conversation's prior turns, so the shared
        // answer cache (keyed only on question text) must not touch them: a
        // "what about the UK?" cached from one thread would otherwise be served
        // verbatim into an unrelated one. Only a fresh first turn is cacheable.
        const isFollowup = store.nextCost(convId, key).followup > 0;
        // A later turn is not necessarily a follow-up. A complete new question
        // is a topic pivot and must not inherit mechanics from the old thread.
        const contextualFollowup = isFollowup && grounding.needsConversationContext(question);
        // Reasoning effort is staff-only. Everyone else is routed from the
        // question, which is a better signal than a dropdown the asker has no
        // basis to set, and it keeps the slow tier from being chosen by habit.
        const effortChoice = ent.staff && router.EFFORTS[body.effort] ? body.effort : "auto";
        const specialist = plan.intent === "claim_verification" || plan.intent === "causal_autopsy";
        let route = router.choose({ question, length, style, useMcp: wantMcp, isFollowup, visualizations, report: reportRequested, effort: effortChoice, specialist });
        // A player can pin the answer model in Settings. Only the whitelist is
        // honoured (never DeepSeek — that stays the invisible backstop), and it
        // keeps the tier's effort/token budget; just the lead model changes, with
        // DeepSeek still behind it. An explicit pick bypasses the shared cache so
        // the player actually gets the model they chose.
        // The model picker is gone: every request rides the tier chain, which
        // rotates the verified free pool before the paid backstop.
        // A change answer is never cached. It carries dates and ages measured
        // against the asker's own clock ("shipped about five hours ago"), and
        // the history itself moves every time something ships — so replaying it
        // to the next player is wrong twice over.
        const cacheable = !moderatorAccess && !wantMcp && !isFollowup && !history.changeish(question);

        // Cache is checked BEFORE quota so re-reading an answer is always free.
        // The plan is part of cache identity. A pre-planner answer must never
        // bypass a newer evidence or visualization guard for the same wording.
        const ckey = `game:${game.id}|plan:${plan.id}|${style}|${length}|viz:${visualizations ? 1 : 0}|${norm(question)}`;
        let hit = cacheable ? store.S.getCache.get(ckey) : null;
        if (hit) {
          const cachedAnswer = String(hit.answer || "").trim();
          const protectedAnswer = answerGuard.protectPublicAnswer(hit.answer, question);
          if (protectedAnswer !== cachedAnswer) {
            store.S.evictCache.run(ckey);
            hit = null;
          } else {
            hit.answer = protectedAnswer;
          }
        }
        if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
          const cachedModel = hit.model || router.MODELS.flash;
          const answerId = store.record({ user_key: key, username: session.identity.username || null, conv_id: convId,
            question, answer: hit.answer, areas: hit.areas, citations: hit.citations,
            used_mcp: 0, cached: 1, cost: 0, followup: 0, tokens_in: 0, tokens_out: 0,
            model: cachedModel, ts: Date.now() });
          const u = store.usage(key, ent);
          return json(res, 200, {
            convId, answerId, answer: hit.answer, areas: store.safeJson(hit.areas),
            citations: store.safeJson(hit.citations), cached: true, usedMcp: false, vizBlocked, vizLimit: vizLimitReason === "quota" ? Number(ent.viz || 0) : 0,
            model: router.label(cachedModel),
            modelId: cachedModel,
            modelName: models.displayFor(cachedModel), provider: models.providerOf(cachedModel), providerName: models.providerDisplayFor(cachedModel),
            usage: u,
            // A "why is MY x so high" question answered from code alone: offer to
            // re-run it against live game state, if the player has live quota left.
            liveHint: u.mcpRemaining > 0 ? mcp.liveHintFor(plan, question) : null,
          });
        }

        const usage = store.usage(key, ent);
        const { cost, followup, followupsLeft } = store.nextCost(convId, key);
        if (usage.remaining < cost) {
          return json(res, 429, {
            error: usage.remaining > 0
              ? `You have ${usage.remaining} of ${usage.limit} left today — not enough for this question.`
              : `You've used all ${usage.limit} questions for today.`,
            usage, quota: true,
          });
        }
        const useMcp = wantMcp && usage.mcpRemaining > 0;
        // Only refuse when the question genuinely needs live data. If the toggle
        // is merely on, answer from code and docs instead of failing: the player
        // asked a question, not for a specific data source.
        if (liveRequired && !useMcp) {
          return json(res, 429, {
            error: `You've used all ${usage.mcpLimit} live-data questions for today. This one needs live game state, so try again tomorrow.`,
            usage, quota: true,
          });
        }

        // Open the stream NOW, before retrieval, the live pass and the scout —
        // each of which can run for seconds. Bytes reach the browser in well
        // under a second, and every phase below narrates itself with a `status`
        // event so the spinner says what it is actually doing instead of cycling
        // canned guesses. Status codes are fixed the instant we write this head,
        // but cache, quota and auth already returned above, so every failure
        // past this point is reported in-band as an SSE `error` event.
        res.writeHead(200, {
          "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive", "X-Accel-Buffering": "no",
        });
        const send = (event, data) => {
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        };
        const status = label => send("status", { label });
        // Live action log: each tool call, streamed as it fires. The client keeps
        // the last few and reveals them when the player taps the status text. Args
        // are compacted to the first meaningful string value (a corp/country name,
        // a search query) so a call reads as e.g. trace_corp(Tinky Winky).
        const actionLabel = (name, args) => {
          let a = "";
          if (args && typeof args === "object") {
            const v = Object.values(args).find(x => typeof x === "string" && x.trim());
            if (v) a = String(v).slice(0, 48);
          }
          return a ? `${name}(${a})` : String(name || "tool");
        };
        const onAction = (name, args) => send("action", { label: actionLabel(name, args), name: String(name || "") });
        const ac = new AbortController();
        // Closing the tab used to abort generation here, which threw the answer
        // away before it was ever recorded — so a player who navigated away lost
        // the answer and it was not there when they came back. A disconnect now
        // only stops the streaming (writes no-op), while generation runs to
        // completion and the row is persisted below, so the answer is waiting on
        // reopen. A deliberate Stop is a separate, explicit signal: the client
        // POSTs /api/ask/stop with this reqId, which aborts and records nothing.
        const reqId = crypto.randomUUID().slice(0, 18);
        let clientGone = false;
        activeGenerations.set(reqId, { ac, key });
        // Ping every 5s (not 15s): Gemini can think for 10-15s before its first
        // visible token, and a frequent heartbeat keeps the proxy and browser
        // from treating that quiet gap as a stalled connection.
        const ping = setInterval(() => { try { res.write(": keepalive\n\n"); } catch {} }, 5000);
        req.on("close", () => { clientGone = true; activeGenerations.delete(reqId); });

        send("meta", { convId, reqId, cost, followup, followupsLeft, usedMcp: useMcp, model: route.label, vizBlocked, vizLimit: vizLimitReason === "quota" ? Number(ent.viz || 0) : 0,
          modelId: route.chain[0], modelName: models.displayFor(route.chain[0]), provider: models.providerOf(route.chain[0]), providerName: models.providerDisplayFor(route.chain[0]), status: plan.status });

        // A first-turn pronoun has no antecedent to retrieve. Letting semantic
        // search guess one produced a confident answer about an unrelated
        // privatization vote. Clarification is deterministic, free, and saved
        // in the thread so the player's next turn has real context.
        const clarificationAnswer = clarification.answer(question, isFollowup);
        if (clarificationAnswer) {
          clearInterval(ping);
          send("delta", clarificationAnswer);
          const validation = { plan: plan.id, issues: [], grounding: [], inventedPaths: [], missedPaths: [] };
          const answerId = store.record({
            user_key: key, username: session.identity.username || null, conv_id: convId,
            question, answer: clarificationAnswer, areas: "[]", citations: "[]",
            used_mcp: 0, cached: 0, cost: 0, followup,
            tokens_in: 0, tokens_out: 0, model: "ask-clarification",
            plan: JSON.stringify(plan), validation: JSON.stringify(validation), evidence: "{}",
            ttft_ms: 0, total_ms: 0, fell_through: null, ts: Date.now(),
            private: moderatorAccess,
          });
          send("done", {
            convId, answerId, answer: clarificationAnswer, areas: [], citations: [], cached: false,
            usedMcp: false, cost: 0, followup, followupsLeft, followups: [], vizBlocked,
            vizLimit: vizLimitReason === "quota" ? Number(ent.viz || 0) : 0,
            reportUrl: null, liveSources: [], model: "Ask", modelId: "ask-clarification",
            modelName: "Ask", provider: "lakeside", providerName: "Lakeside", conflicts: [], usage: store.usage(key, ent), liveHint: null, validation,
          });
          try { res.end(); } catch {}
          return;
        }

        // Actual source text for this question. The old path sent only a file
        // listing, which is why answers said "I wasn't given the contents".
        let hits = null;
        // Deep questions get a wider evidence window. Every model scored 1-2 on
        // grounding for the benched "inflation, bonds and deficit" question, and
        // that was retrieval covering three systems with four chunks, not the
        // models failing. Ox Alpha holds a 1M context, so the room is there.
        const deepAnswer = route.tier === "deep";
        // A follow-up embeds uselessly on its own ("what about the UK?"), so
        // retrieval runs on a standalone rewrite fused with the thread. The
        // model still receives the player's literal question.
        let retrievalQuestion = question;
        if (contextualFollowup) {
          status("Condensing the thread into a standalone query…");
          try { retrievalQuestion = (await grounding.condense(store.history(convId, key, 3), question)) || question; } catch {}
        }
        // Delivery contracts use the player's literal turn after a topic pivot.
        // The standalone rewrite is safe only when the turn truly needs context.
        const contractQuestion = contextualFollowup ? retrievalQuestion : question;
        status(deepAnswer ? "Decomposing into sub-queries, searching code, docs & wiki…" : "Vector-searching code & docs…");
        try {
          const retrieveOpts = deepAnswer ? { topK: DEEP_TOP_K, maxChars: DEEP_MAX_CHARS } : {};
          // Pro and deep questions get model-written sub-queries so retrieval
          // covers every system the question spans, not just the one the single
          // embedding lands nearest. decompose() fails open to [] and
          // searchMulti with no sub-queries is a plain search.
          const aliases = queryAliases.expand(retrievalQuestion);
          const generatedQueries = route.tier === "flash" ? [] : await grounding.decompose(retrievalQuestion);
          const subQueries = [...new Set([...generatedQueries, ...aliases])];
          hits = await retrieve.searchMulti(retrievalQuestion, subQueries, { ...retrieveOpts, game });
          // Alias evidence answers a known player-language to code-language
          // mismatch. Merge literal hits too, so top-K scoring for the original
          // wording cannot evict the canonical neighboring subsystem.
          for (const alias of aliases) {
            hits = retrieve.mergeEvidence(hits, retrieve.searchExact(alias, { limit: 5, maxChars: 8000, game }));
          }
          if (investigate.needsMechanicEvidence(retrievalQuestion)) {
            const exact = retrieve.searchExact(retrievalQuestion, { limit: 8, maxChars: 14000, game });
            hits = retrieve.mergeEvidence(hits, exact);
          }
        } catch { hits = null; }
        if (hits?.files?.length) status(`Matched ${hits.files.length} source${hits.files.length === 1 ? "" : "s"} — reading…`);

        // What recently CHANGED, when the question is about a change.
        //
        // Retrieval hands the model the current code, which reads identically
        // whether a mechanic shipped last year or on Tuesday — so "why did my
        // stocks fall this week" was structurally unanswerable: the one piece
        // of evidence that could answer it (the commit that shipped) was in no
        // index. This runs on the files retrieval just matched, which is what
        // bridges player vocabulary to commit vocabulary: the player says
        // "stocks fell", the commit says "bounded equity liquidity facility",
        // and the equity files are what connect them.
        let historyBlock = "";
        const changeQuestion = (history.changeish(question) || plan.intent === "causal_autopsy") && await history.available(game);
        if (changeQuestion) {
          status("Checking what shipped recently…");
          try {
            const recent = await history.evidence({
              game, question: retrievalQuestion, paths: hits?.files || [], code: hits?.context || "", tz,
              sinceDays: history.sinceDaysFor(question),
            });
            if (recent) {
              historyBlock = recent.text;
              if (onAction) onAction("recent_changes", { q: `${recent.commits.length} shipped changes` });
            }
          } catch { historyBlock = ""; }
        }

        // Staff-verified lessons from past wrong answers, matched semantically.
        let matchedCorrections = [];
        try { matchedCorrections = await corrections.match(retrievalQuestion); } catch {}
        if (matchedCorrections.length) status(`Injecting ${matchedCorrections.length} verified correction${matchedCorrections.length === 1 ? "" : "s"}…`);

        // Live game state, only when asked for and only read-only.
        let liveBlock = "", liveVisualizations = [], liveAnswerContract = null, liveEvidence = { tools: [], visualizations: [] };
        let liveTargeted = false;
        if (useMcp) {
          status(plan.status || "Querying live game state (read-only)…");
          try {
            const intelligence = await mcp.liveIntelligence(question, session.context, null, plan, onAction);
            liveBlock = intelligence.text;
            liveAnswerContract = intelligence.answerContract || null;
            liveTargeted = intelligence.targeted === true;
            liveVisualizations = intelligence.visualizations || [];
            liveEvidence = {
              tools: intelligence.usedTools || [],
              visualizations: liveVisualizations.map(data => ({
                recommended: data.recommended || null, metric: data.metric || null, title: data.title || null,
              })),
            };
          } catch {
            liveBlock = "";
            liveVisualizations = [];
            liveAnswerContract = null;
          }
        }

        // Agentic evidence pass. A cheap scout model chases what the one-shot
        // retrieval and the heuristic live pass cannot: follow-up code searches
        // when an excerpt references something unseen, and targeted live
        // lookups the heuristics did not anticipate. Flash-tier questions skip
        // it; they are lookups, and the scout would double their latency.
        // Flash used to skip the scout outright, on the reasoning that flash
        // questions are lookups and the scout would double their latency. True
        // when the heuristics found what the question needed. But 81% of real
        // traffic lands on flash, and when the heuristics match nothing all the
        // answer gets is the generic world snapshot — which is exactly the state
        // that produced "I don't have that data" on questions the tools could
        // answer. So flash now runs the scout only in that case: the fast path
        // stays fast, and a question that was heading for a non-answer gets the
        // one pass that can rescue it.
        const liveMissedTarget = useMcp && !liveTargeted;
        // Post-evidence escalation. The pre-retrieval score routed on wording
        // alone; now the searches have actually run, revisit it the way an
        // operator would. Thin code evidence on a real question, or a live
        // question the heuristics could not target, means the cheap chain is
        // about to answer from almost nothing — exactly where flash invents.
        // Escalating here also hands the scout the pro budget below.
        const thinRetrieval = question.trim().length >= 40
          && (!hits || String(hits.context || "").length < 2000);
        if (route.tier === "flash" && (thinRetrieval || liveMissedTarget)) {
          const escalated = router.escalate(route, thinRetrieval ? "retrieval came back thin" : "live heuristics missed the target");
          if (escalated !== route) {
            route = escalated;
            status("Evidence is thin — escalating to the reasoning tier…");
            console.log(`[ask] escalated flash->pro reason=${JSON.stringify(route.escalated)} q=${JSON.stringify(question.slice(0, 80))}`);
          }
        }
        // Trend questions get the scout even when the live heuristics hit:
        // the heuristic pass serves snapshots, and a "how has X changed"
        // answer built on a snapshot is exactly the failure the history
        // tools exist to prevent (measured: California unemployment answered
        // "not in this snapshot" while macro_history sat one call away).
        const trendish = /\b(trend|history|over (?:the )?(?:last|past|recent)|chang(?:e|ed|es|ing)|since (?:19|20)\d\d|turn.by.turn|evolv)/i.test(question);
        // A change question the fast path could not answer gets the scout on any
        // tier, live or not. It is the only thing that can bridge a player
        // describing a screen ("my portfolio dropped") to a change living in a
        // system ("equity liquidity facility") — a path match cannot, and the
        // deterministic pass returning nothing is exactly that mismatch.
        // Gated on the block being EMPTY: the scout costs ~25s, and when the
        // commits are already in hand a flash answer should not pay it.
        const chaseChange = changeQuestion && (historyBlock === "" || history.broadChangeQuestion(question));
        // A live snapshot can answer "what is inflation" but not "what would
        // lower it fastest". Formula, cause, and counterfactual questions need
        // the code scout even when the heuristic live pass found a country.
        const needsMechanicEvidence = investigate.needsMechanicEvidence(question);
        const needsCapabilityInventory = investigate.needsCapabilityInventory(question);
        const needsSpecialistEvidence = plan.intent === "causal_autopsy" || plan.intent === "claim_verification" || plan.intent === "election_debrief" || plan.intent === "away_briefing";
        let investigation = null;
        if ((game.live && (deepAnswer || (useMcp && route.tier !== "flash") || liveMissedTarget || (useMcp && trendish) || needsMechanicEvidence || needsCapabilityInventory || needsSpecialistEvidence || moderatorPrivateQuestion)) || chaseChange) {
          status(chaseChange && !useMcp ? "Scout: reading what changed…" : (useMcp ? "Scout: pulling targeted live data…" : "Scout: following code references…"));
          try {
            investigation = await investigate.run({ question, context: session.context, useLive: useMcp, deep: deepAnswer, tier: route.tier, seenPaths: hits?.files || null, onAction, game, changeQuestion });
          } catch { investigation = null; }
          if (investigation?.tools?.length) liveEvidence.tools = [...liveEvidence.tools, ...investigation.tools.map(t => `investigate:${t}`)];
        }
        // The scout naming what it could NOT establish is the second
        // escalation signal: a writer about to bridge a named unknown on the
        // cheap chain is the measured failure mode.
        if (route.tier === "flash" && investigation?.assessment && /UNKNOWN:\s*(?!nothing\b)\S/i.test(investigation.assessment)) {
          const escalated = router.escalate(route, "scout left a named unknown");
          if (escalated !== route) {
            route = escalated;
            status("Key facts are still open — escalating to the reasoning tier…");
            console.log(`[ask] escalated flash->pro reason="scout unknown" q=${JSON.stringify(question.slice(0, 80))}`);
          }
        }

        // Sufficient-context gate (pro/deep): a cheap judge reads the gathered
        // evidence BEFORE generation and names what it does not contain.
        // Models given insufficient context answer plausibly from parametric
        // memory instead of abstaining (measured 35-62% of the time in the
        // literature), which here means invented mechanics. The gate cannot
        // block an answer — it injects an explicit do-not-improvise directive
        // and keeps the result out of the shared cache. Fails open.
        let insufficiency = null;
        if ((route.tier === "pro" || route.tier === "deep") && (hits?.context || liveBlock || investigation?.text)) {
          try {
            const preEvidence = [hits?.context, liveBlock, investigation?.text].filter(Boolean).join("\n\n");
            const verdict = await grounding.sufficiency(contractQuestion, preEvidence);
            if (!verdict.sufficient) {
              insufficiency = verdict.missing;
              status("The evidence looks incomplete — answering only what it supports…");
              console.log(`[ask] insufficient evidence: ${JSON.stringify(insufficiency)} q=${JSON.stringify(question.slice(0, 80))}`);
            }
          } catch { insufficiency = null; }
        }

        // Evidence is assembled; the answer model is about to start streaming.
        // Name the model so the wait reads as work, not a hang (Gemini can think
        // for 10s+ before its first token).
        status(`Drafting with ${models.displayFor(route.chain[0])}…`);

        const navBlock = game.multiplayer ? navigation.block(retrievalQuestion) : "";
        let raw = "", failed = null, failedBusy = false, llmUsage = {}, servedModel = route.model;
        let finishReason = null, fellThrough = null;
        const genStart = Date.now();
        let firstTokenMs = null;
        const mechanicsAnswerContract = queryAliases.deliveryContract(question, retrievalQuestion, { contextual: contextualFollowup });
        const domainGuidance = queryAliases.guidance(contractQuestion);
        const methodBrief = playbooks.writerBrief(question);
        const capabilityContract = capabilities.contract(plan);
        try {
          if (mechanicsAnswerContract) {
            raw = mechanicsAnswerContract;
            servedModel = "ask-mechanics-contract";
            firstTokenMs = Date.now() - genStart;
            send("delta", raw);
          } else {
            const out = await llm.stream({
              system: prompt.build({ style, length, context: session.context, indexContext: "", visualizations, visualizationRequested, visualizationLimit: vizLimitReason ? { reason: vizLimitReason, limit: Number(ent.viz || 0), used: vizQuota.vizUsed } : null, liveData: useMcp, report: reportRequested, game, changeHistory: historyBlock !== "", tz, privateAccess: moderatorAccess })
                + (matchedCorrections.length ? `\n\n${corrections.block(matchedCorrections)}` : "")
                + (hits ? `\n\n${hits.context}` : "")
                + (historyBlock ? `\n\n${historyBlock}` : "")
                + (liveBlock ? `\n\n${liveBlock}` : "")
                + (investigation ? `\n\n${investigation.text}` : "")
                + (domainGuidance ? `\n\nDOMAIN RESOLUTION FOR THIS QUESTION:\n${domainGuidance}` : "")
                + (methodBrief ? `\n\n${methodBrief}` : "")
                + (insufficiency ? `\n\nEVIDENCE SUFFICIENCY AUDIT: a pre-check found the gathered evidence likely does NOT contain: ${insufficiency}\nDo not improvise that part. State plainly what the game's code and data do not show, and answer everything the evidence DOES support with its real values.` : "")
                + (capabilityContract ? `\n\n${capabilityContract}` : "")
                // "Where do I find this" is answered from the real menu map, not guessed.
                + (navBlock ? `\n\n${navBlock}` : ""),
              // Deep answers are for exploring a system across several turns, so
              // they carry more of the thread than a one-shot lookup needs.
              history: store.history(convId, key, deepAnswer ? DEEP_HISTORY_TURNS : 3),
              question,
              // Length sets the token ceiling; the tier sets how hard it thinks.
              longAnswer: length === "deep",
              tier: route.tier,
              chain: route.chain,
              effort: route.effort,
              signal: ac.signal,
              onDelta: piece => { if (firstTokenMs === null) firstTokenMs = Date.now() - genStart; send("delta", piece); },
            });
            raw = out.text || "";
            llmUsage = out.usage || {};
            finishReason = out.finish || null;
            // The chain may have fallen through to a lower-scored model, so record
            // what actually answered rather than what routing first asked for.
            servedModel = out.model || route.model;
            if (out.tried?.length) {
              fellThrough = out.tried.map(t => t.model).join(",");
              console.error("[ask] fell through:", out.tried.map(t => `${t.model}(${t.error})`).join(" | "), "->", servedModel);
            }
            // One concise line per answer so slow models, fall-throughs and client
            // disconnects are visible without turning on verbose logging.
            console.log(`[ask] served=${servedModel} tier=${route.tier} live=${useMcp ? 1 : 0} firstTokenMs=${firstTokenMs} totalMs=${Date.now() - genStart} outTok=${llmUsage.completion_tokens || 0} clientGone=${clientGone ? 1 : 0}`);
          }
        } catch (e) {
          failed = e?.name === "AbortError" ? "aborted" : String(e.message || e).slice(0, 160);
          if (failed !== "aborted") console.error(`[ask] gen failed tier=${route.tier} live=${useMcp ? 1 : 0} after ${Date.now() - genStart}ms:`, failed);
          failedBusy = e?.rateLimited === true;
        }
        clearInterval(ping);

        // A picker model that text-emits tool calls (<tool_call>/<function=…>)
        // never produced a real answer — the markup just streamed as content.
        // Discard it so it fails into the standard retry error and costs no quota.
        if (!failed && raw.trim() && answerGuard.looksLikeToolLeak(raw)) {
          console.error(`[ask] tool-call markup leaked from ${servedModel}; discarding answer`);
          failed = "tool_call_leak"; raw = "";
        }

        if (failed === "aborted") { try { res.end(); } catch {} return; }
        if (failed || !raw.trim()) {
          // Nothing is recorded on this path, so no quota was spent. Say that
          // plainly rather than leaving the player guessing what it cost them.
          send("error", failedBusy
            ? { error: "Every answer model is busy right now. Try again in a moment — this did not use any of your daily questions.", busy: true }
            : { error: "I couldn't produce an answer for that one. Try rephrasing." });
          if (failed) console.error("[ask] stream failed:", failed);
          try { res.end(); } catch {}
          return;
        }

        let { text: noFu, followups } = prompt.extractFollowups(raw);
        const { text: noConflict, conflicts } = prompt.extractConflicts(noFu);
        // The old pipeline only logged a refusal despite already holding live
        // evidence. Repair that response while the request is still open, then
        // let the normal citation and safety guards inspect the repaired answer.
        // The web client replaces streamed draft text with the canonical done
        // payload, while Discord only consumes that final payload.
        let evidenceForCheck = [
          matchedCorrections.length ? corrections.block(matchedCorrections) : "",
          hits?.context, historyBlock, liveBlock, investigation?.text,
          domainGuidance, capabilityContract,
        ].filter(Boolean).join("\n\n");
        let answerRepaired = false;
        let canonicalContractApplied = false;
        let mechanicsContractApplied = false;
        if (liveAnswerContract) {
          noFu = liveAnswerContract;
          servedModel = "ask-live-contract";
          canonicalContractApplied = true;
          answerRepaired = true;
        }
        if (!canonicalContractApplied && mechanicsAnswerContract) {
          noFu = mechanicsAnswerContract;
          servedModel = "ask-mechanics-contract";
          canonicalContractApplied = true;
          mechanicsContractApplied = true;
          answerRepaired = true;
        }
        // Detect the draft's defects BEFORE deciding whether to repair. The
        // old order computed truncation, bundle narration and missed paths
        // after the repair decision, so the one closed loop in the pipeline
        // ignored three defect classes it could have fixed.
        const draftTruncated = finishReason === "length" || answerGuard.looksTruncated(noConflict);
        const draftNarrated = answerGuard.detectBundleNarration(noConflict);
        // Retrieval-miss self-heal: the draft cited a real, indexed file that
        // retrieval never supplied. The pipeline used to log a MISS and staple
        // an apology under the answer; the file is one call away. Read it, hand
        // it to the repair pass, and let the answer be checked against the real
        // contents instead of recall.
        let healedPaths = [];
        if (!canonicalContractApplied) {
          try {
            const draftSplit = grounding.classifyPaths(noConflict, evidenceForCheck, retrieve.hasPath);
            for (const missPath of draftSplit.missed.slice(0, 2)) {
              const found = retrieve.readIndexedFile(missPath, { maxChars: 9000, game });
              if (found?.context) {
                evidenceForCheck += `\n\nHEALED EVIDENCE — the draft cited ${missPath} without reading it; here are its actual indexed contents:\n${found.context}`;
                healedPaths.push(missPath);
              }
            }
            if (healedPaths.length) status("Reading the files the draft cited but never saw…");
          } catch { healedPaths = []; }
        }
        const answerRequirement = answerRepair.requirementFor(contractQuestion, evidenceForCheck);
        if (!canonicalContractApplied && answerRepair.shouldRepair({ answer: noConflict, hasLiveData: useMcp, evidence: evidenceForCheck, requirement: answerRequirement, truncated: draftTruncated, narrated: draftNarrated, healedPaths })) {
          status("Rechecking the answer against the evidence…");
          try {
            const issues = answerRepair.issuesFor({ answer: noConflict, hasLiveData: useMcp, truncated: draftTruncated, narrated: draftNarrated, healedPaths });
            const repaired = await answerRepair.repair({ question: contractQuestion, answer: noConflict, evidence: evidenceForCheck, requirement: answerRequirement, issues });
            if (repaired?.text) {
              noFu = repaired.text;
              answerRepaired = true;
              if (repaired.model) servedModel = repaired.model;
              if (repaired.usage) {
                llmUsage = {
                  prompt_tokens: Number(llmUsage.prompt_tokens || 0) + Number(repaired.usage.prompt_tokens || 0),
                  completion_tokens: Number(llmUsage.completion_tokens || 0) + Number(repaired.usage.completion_tokens || 0),
                };
              }
            }
          } catch { /* the original answer remains visible and auditable */ }
        }
        const finalConflictExtraction = answerRepaired ? prompt.extractConflicts(noFu) : { text: noConflict, conflicts: [] };
        if (finalConflictExtraction.conflicts.length) conflicts.push(...finalConflictExtraction.conflicts);
        if (conflicts.length) store.recordConflicts(conflicts, { question, user_key: key });
        const cited = cites.apply(finalConflictExtraction.text, { question, game });
        const citations = cited.citations;
        const guarded = answerGuard.enforce({
          answer: cited.text, datasets: liveVisualizations, plan,
          visualizationsEnabled: visualizations, question, privacyQuestion: contractQuestion,
          privacyGuardEnabled: !moderatorAccess,
          trustedStaticAnswer: mechanicsContractApplied,
        });
        let answer = visualization.ensure(guarded.answer, liveVisualizations, { required: guarded.required, question });
        // Deep answers are where models invent connective tissue between systems
        // (measured on the bench: plausible macroeconomics the code does not
        // show, even with the wide retrieval window). A cheap second model lists
        // game-mechanic claims the excerpts do not support and the answer gets
        // an honest note. The note lands in the done payload and the stored row;
        // the client re-renders from d.answer on done, so it is visible. Fails
        // open: an empty list or a dead helper changes nothing.
        let groundingNotes = [];
        // Judge against EVERYTHING the answer model saw. Checking against the
        // retrieval context alone would flag claims grounded in live data or
        // investigation evidence.
        // Deep AND pro: deep is where bridging invention was measured, but pro
        // exists for exactly the multi-system questions that invite it, and a
        // check that only runs on ~5% of traffic protects nobody. Flash gets
        // the async variant below instead of a synchronous wait.
        let groundingRevised = false;
        if (!canonicalContractApplied && (deepAnswer || route.tier === "pro") && evidenceForCheck) {
          try {
            groundingNotes = await grounding.check(answer, evidenceForCheck);
            // Act on the audit instead of stapling it under the answer: one
            // corrective rewrite, then re-audit. Only a revision that comes
            // back clean replaces the answer; anything else keeps the original
            // with the honest caveat, so this can only remove invention.
            if (groundingNotes.length) {
              status("Removing claims the code does not support…");
              const revised = await grounding.revise({ question: contractQuestion, answer, claims: groundingNotes, evidence: evidenceForCheck });
              if (revised?.text) {
                const recheck = await grounding.check(revised.text, evidenceForCheck);
                if (!recheck.length) {
                  answer = revised.text;
                  groundingNotes = [];
                  groundingRevised = true;
                  if (revised.usage) {
                    llmUsage = {
                      prompt_tokens: Number(llmUsage.prompt_tokens || 0) + Number(revised.usage.prompt_tokens || 0),
                      completion_tokens: Number(llmUsage.completion_tokens || 0) + Number(revised.usage.completion_tokens || 0),
                    };
                  }
                }
              }
            }
            answer += grounding.note(groundingNotes);
          } catch { groundingNotes = []; }
        }
        // Mechanical check, every tier: a file path cited in the answer that was
        // never in the evidence is an invention, no model call needed to prove
        // it. The answer is annotated, and below it is barred from the shared
        // cache so one hallucination is one player's, not everyone's.
        // Two very different causes, and they must not share a note. A path the
        // corpus does not contain is an invention. A path it DOES contain is a
        // retrieval miss: the model named the right file and we failed to hand
        // it over. Measured over the shipped corpus, 19 of 22 were the latter,
        // so one shared warning was telling players to distrust correct work.
        let inventedPaths = [], missedPaths = [];
        try {
          const split = grounding.classifyPaths(answer, evidenceForCheck, retrieve.hasPath);
          inventedPaths = split.invented;
          missedPaths = split.missed;
          answer += grounding.pathNote(inventedPaths);
          answer += grounding.missedPathNote(missedPaths);
        } catch { inventedPaths = []; missedPaths = []; }
        // A retrieval miss is a work queue entry, not a model failure: the file
        // is real and indexed, so the query that should have found it did not.
        if (missedPaths.length) {
          console.warn(`[ask] RETRIEVAL MISS paths=${JSON.stringify(missedPaths)} q=${JSON.stringify(question.slice(0, 80))}`);
        }
        // Inline refusal guard: the model declined on a question that had live
        // evidence. Record it and, below, keep it out of the shared cache — a
        // refusal must never be served to everyone.
        const refusedWithEvidence = answerGuard.detectRefusal(answer, useMcp) && useMcp;
        if (refusedWithEvidence) console.warn(`[ask] refusal WITH live evidence plan=${plan.id} q=${JSON.stringify(question.slice(0, 80))}`);
        // The model hit the token ceiling mid-sentence. Reasoning tokens bill
        // against the same budget, so a model that thinks hard on a long prompt
        // can spend the lot before finishing. The player already saw the partial
        // text, but it must never be cached and it must show up in the audit.
        const truncated = finishReason === "length" || answerGuard.looksTruncated(answer);
        if (truncated) console.warn(`[ask] TRUNCATED answer model=${servedModel} finish=${finishReason} outTok=${llmUsage.completion_tokens || 0} q=${JSON.stringify(question.slice(0, 80))}`);
        // The model narrated its own retrieval bundle to the player ("the
        // supplied source does not include…"). That is an implementation detail
        // leaking as an answer, and it is the single most common failure shape.
        const narratedEvidence = answerGuard.detectBundleNarration(answer);
        if (narratedEvidence) console.warn(`[ask] evidence-bundle narration plan=${plan.id} q=${JSON.stringify(question.slice(0, 80))}`);
        // Deterministic per-sentence attribution: which evidence chunk supports
        // each prose sentence, from one batch embedding call plus arithmetic.
        // Live and investigation blocks join as lexical-only pseudo-chunks so a
        // sentence grounded in live data is not miscounted as unsupported.
        // Telemetry-first: recorded on the row and surfaced to the console; the
        // only player-visible effect is a cautious note on flash answers with
        // very low coverage, the tier that gets no synchronous claim audit.
        let attributionReport = null;
        if (!canonicalContractApplied) {
          try {
            const pseudo = [];
            for (const [name, block] of [["live-data", liveBlock], ["investigation", investigation?.text || ""]]) {
              for (let i = 0; i * 4000 < block.length && i < 8; i++) pseudo.push({ path: name, ord: i, text: block.slice(i * 4000, i * 4000 + 4000) });
            }
            const chunks = [...(hits?.hits || []).filter(h => h.text), ...pseudo];
            if (chunks.length) {
              // Semantic scoring gets a hard overall budget: attribution sits
              // between the last delta and `done`, so a slow embedder must
              // degrade to the fast lexical fallback, never stall delivery.
              // The failure reason is logged because this exact path failed
              // silently in production (semantic=false on every long answer)
              // and the catch-all hid why.
              attributionReport = await attribution.attribute(answer, chunks, {
                chunkVectors: retrieve.vectorsFor(hits?.hits || [], game),
                embedSentences: async texts => {
                  try {
                    return await retrieve.embedBatch(texts, { timeoutMs: 12000, slice: 8, deadlineMs: 12000 });
                  } catch (e) {
                    console.warn(`[ask] attribution embed failed (${texts.length} sentences): ${String(e.message || e).slice(0, 160)}`);
                    throw e;
                  }
                },
              });
            }
          } catch { attributionReport = null; }
          if (attributionReport && attributionReport.total >= 4 && attributionReport.coverage < 0.35
              && route.tier === "flash" && !groundingNotes.length && !answerRepaired) {
            answer += `\n\n> **Support check:** I could not match much of this answer to the sources I actually read, so treat the specifics as unverified.`;
          }
        }
        const validation = { plan: plan.id, issues: [...guarded.issues, ...answerGuard.inspect(answer, plan), ...(canonicalContractApplied ? ["canonical_answer_contract"] : answerRepaired ? ["answer_contract_repaired"] : []), ...(refusedWithEvidence ? ["refused_with_live_evidence"] : []), ...(truncated ? ["truncated"] : []), ...(narratedEvidence ? ["narrated_evidence_bundle"] : []), ...(healedPaths.length ? ["retrieval_miss_healed"] : []), ...(groundingRevised ? ["grounding_revised"] : []), ...(route.escalated ? ["escalated_tier"] : []), ...(insufficiency ? ["insufficient_evidence"] : [])], grounding: groundingNotes, inventedPaths, missedPaths, ...(insufficiency ? { insufficiency } : {}), ...(attributionReport ? { attribution: { coverage: attributionReport.coverage, supported: attributionReport.supported, total: attributionReport.total, semantic: attributionReport.semantic, weak: attributionReport.weak.slice(0, 4), sentences: attributionReport.sentences.slice(0, 40).map(s => ({ score: s.score, cites: s.cites })) } } : {}) };
        const areas = cites.areasFor(hits?.files || []);

        if (cacheable && !inventedPaths.length && !missedPaths.length && !groundingNotes.length && !refusedWithEvidence && !truncated && !narratedEvidence && !insufficiency) {
          store.S.putCache.run(ckey, answer, JSON.stringify(areas), JSON.stringify(citations), servedModel, Date.now());
        }
        // Did this answer actually read the running world? liveEvidence.tools is
        // appended to by the heuristic live pass and by the scout, and holds
        // code-search calls too, so the live-read test is the cleaned list.
        const liveSourcesUsed = mcp.liveSources(liveEvidence.tools);
        const liveDataRead = useMcp && liveSourcesUsed.length > 0;

        const answerId = store.record({
          user_key: key, username: session.identity.username || null, conv_id: convId,
          question, answer, areas: JSON.stringify(areas), citations: JSON.stringify(citations),
          // Charge the live-data allowance only if live data was actually READ.
          // Enabling live mode and then answering entirely from code costs the
          // player nothing, and this also makes used_mcp mean what the console
          // has always claimed it means: answers that really hit the game.
          used_mcp: liveDataRead ? 1 : 0, cached: 0, cost, followup,
          tokens_in: Number(llmUsage.prompt_tokens || 0), tokens_out: Number(llmUsage.completion_tokens || 0), model: servedModel,
          plan: JSON.stringify(plan), validation: JSON.stringify(validation), evidence: JSON.stringify(liveEvidence),
          ttft_ms: firstTokenMs, total_ms: Date.now() - genStart, fell_through: fellThrough, ts: Date.now(),
          private: moderatorAccess,
        });
        // Charge a visualization slot only if one actually reached the player.
        // Enabling visualizations does not mean the model drew anything, and an
        // allowance that bills for prose is an allowance players learn to distrust.
        const deliveredViz = visualization.contains(answer);
        if (deliveredViz) store.markVizUsed(answerId);

        // A refusal despite live evidence is a confident failure — seed a
        // staff-review draft now rather than waiting for the sampler to catch
        // it. Dedup lives in corrections.draft(); fire-and-forget.
        if (refusedWithEvidence) {
          corrections.draft({ question, reason: "refused despite live evidence being available", sourceAnswerId: answerId }).catch(() => {});
        } else if (narratedEvidence) {
          corrections.draft({ question, reason: "described its own evidence to the player instead of answering", sourceAnswerId: answerId }).catch(() => {});
        } else if (truncated) {
          corrections.draft({ question, reason: "answer stopped mid-sentence", sourceAnswerId: answerId }).catch(() => {});
        }

        // Flash gets the claim audit too, off the request path: the helper can
        // take 10s+ and a flash player already has the whole answer on screen.
        // The streamed text can no longer be annotated, so a flagged claim
        // instead patches the stored row, evicts the shared cache entry (a
        // code-only flash answer is exactly the kind that gets cached, so one
        // hallucination would serve every future asker), and seeds a draft.
        if (!deepAnswer && route.tier !== "pro" && evidenceForCheck) {
          Promise.resolve().then(async () => {
            const claims = await grounding.check(answer, evidenceForCheck);
            if (!claims?.length) return;
            store.updateGrounding(answerId, claims);
            store.evictCache(ckey);
            console.warn(`[ask] async grounding flags answerId=${answerId} claims=${JSON.stringify(claims)}`);
            return corrections.draft({ question, reason: `ungrounded claims: ${claims.join("; ")}`, sourceAnswerId: answerId });
          }).catch(() => { /* advisory only */ });
        }

        // A report gets its own page. Title comes from the model's own H1, with
        // the question as fallback if it ignored the format.
        let reportUrl = null;
        if (reportRequested && !moderatorAccess) {
          try {
            const token = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
            const title = (answer.match(/^#\s+(.+)$/m)?.[1] || question).replace(/[*`]/g, "").trim().slice(0, 160);
            store.putReport({
              token, userKey: key, username: session.identity.username || null,
              answerId, title, question, body: answer, model: servedModel,
            });
            reportUrl = `/r/${token}`;
          } catch (e) { console.error("[ask] report save failed:", String(e.message || e)); }
        }

        send("done", {
          convId, answerId, answer, areas, citations, cached: false, usedMcp: liveDataRead,
          cost, followup, followupsLeft, followups, vizBlocked, vizLimit: vizLimitReason === "quota" ? Number(ent.viz || 0) : 0, reportUrl,
          // What live game state this answer actually read, named for a player.
          liveSources: liveSourcesUsed,
          model: router.label(servedModel),
          modelId: servedModel,
          modelName: models.displayFor(servedModel),
          provider: models.providerOf(servedModel),
          providerName: models.providerDisplayFor(servedModel),
          conflicts: conflicts.map(c => ({ source: c.source, page: c.page, claim: c.claim, actual: c.actual })),
          usage: store.usage(key, ent),
          // Answered from code but the question reads like a live-state one, and
          // the player didn't ask for live data and still has some left.
          liveHint: (!useMcp && usage.mcpRemaining > 0) ? mcp.liveHintFor(plan, question) : null,
          validation,
        });
        // Random-sample QA: a free model re-reads this answer and logs whether
        // it actually answered. Fire-and-forget — must not delay res.end().
        answerAudit.maybeAudit({ answerId, question, answer, hadLive: liveDataRead, issues: validation.issues });

        try { res.end(); } catch {}
        return;
      }
      return json(res, 404, { error: "Not found" });
    }

    return json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error("[ask] unhandled:", e?.stack || e);
    try { return json(res, 500, { error: "Something went wrong." }); } catch { return; }
  }
});

// Startup self-check. The client script lives inside a template literal, so an
// unescaped sequence turns into a real newline and silently breaks the whole
// page while the server still returns a healthy 200. Fail loudly at boot instead.
try {
  const probe = page.app({
    identity: { provider: "ahd", id: "0", username: "probe" },
    context: { username: "probe", character: null, corporation: null },
    entitlement: { allowed: true, label: "probe", questions: 1, mcp: 1 },
    usage: { used: 0, limit: 1, remaining: 1, mcpUsed: 0, mcpLimit: 1, mcpRemaining: 1, resetAt: Date.now() },
    conversations: [], model: "probe", styles: prompt.STYLES, lengths: prompt.LENGTHS,
  });
  const reportProbe = page.reportView({
    token: "probe", question: "probe", body: "# Probe\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    model: "deepseek-v4-flash", created: Date.now(),
  });
  // The review deck is keyboard-driven and entirely client-rendered, so a
  // broken script there is a blank screen behind a healthy 200 — exactly what
  // this self-check exists to catch.
  const reviewProbe = page.reviewPage({
    identity: { provider: "ahd", id: "0", username: "probe" }, context: { isAdmin: true },
    cards: [{ id: 1, question: "probe", answer: "probe answer", user_key: "ahd:0", username: "probe", ts: Date.now(), plan: {}, validation: {}, evidence: {} }],
    counts: { pending: 1, reviewed: 0, good: 0, bad: 0, skipped: 0, playerJudged: 0, modelJudged: 0 },
  });
  const scripts = [...probe.matchAll(/<script>([\s\S]*?)<\/script>/g), ...reportProbe.matchAll(/<script>([\s\S]*?)<\/script>/g),
    ...reviewProbe.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!scripts.length) throw new Error("client script block missing");
  for (const [, source] of scripts) new Function(source);
  console.log("[ask] client scripts OK (" + scripts.length + " blocks)");
} catch (e) {
  console.error("[ask] FATAL: client script is broken —", e.message);
  process.exit(1);
}

// Embedding health, checked at boot and kept fresh for the health rollup. The
// embedder failing does not break Ask (FTS and exact search carry retrieval),
// which is exactly why it went unnoticed for two days when the model vanished
// from the serving instance: every /api/embed 404'd and nothing said so.
// Silence is not success; this makes the degradation loud and visible.
const embedHealth = { ok: null, checkedAt: 0, error: null };
async function checkEmbedding(tag) {
  try {
    await retrieve.embedQuery("embedding health check");
    if (embedHealth.ok === false) console.log(`[ask] embedding RECOVERED (${tag})`);
    embedHealth.ok = true; embedHealth.error = null;
  } catch (e) {
    const reason = String(e.message || e).slice(0, 120);
    if (embedHealth.ok !== false) console.error(`[ask] EMBEDDING DEAD (${tag}): ${reason} — vector retrieval degraded to keyword-only`);
    embedHealth.ok = false; embedHealth.error = reason;
  }
  embedHealth.checkedAt = Date.now();
}
checkEmbedding("boot");
// Four minutes, deliberately inside ollama's five-minute keep_alive: the
// check doubles as a keep-warm, so attribution's sentence batches never pay
// a cold CPU model load (measured: a cold first batch blew its whole budget).
setInterval(() => checkEmbedding("periodic"), 4 * 60 * 1000).unref();
store.setEmbedHealth?.(embedHealth);

// Default to loopback so the box stays behind Caddy; Railway sets HOST=0.0.0.0 for public ingress.
const BIND_HOST = process.env.HOST || "127.0.0.1";
server.listen(PORT, BIND_HOST, () => console.log(`ask-site listening on ${BIND_HOST}:${PORT}`));
