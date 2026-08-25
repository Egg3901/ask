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
const corrections = require("./corrections");
const llm = require("./llm");
const models = require("./models");
const router = require("./router");
const visualization = require("./visualization");
const mapVisualization = require("./map-visualization");
const askPlan = require("./ask-plan");
const answerGuard = require("./answer-guard");

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
  let b = ""; req.on("data", c => { b += c; if (b.length > cap) req.destroy(); });
  await new Promise(r => req.on("end", r));
  try { return JSON.parse(b || "{}"); } catch { return null; }
}
const norm = q => q.toLowerCase().replace(/\s+/g, " ").replace(/[?.!,]+$/, "").trim();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

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
      });
      return json(res, answerId ? 200 : 400, { ok: Boolean(answerId), answerId });
    }

    const session = await auth.resolve(req);

    // ── page ────────────────────────────────────────────────────────────────
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
      return html(res, 200, page.app({
        identity: session.identity, context: session.context, entitlement: ent,
        usage: store.usage(key, ent), conversations: store.conversations(key), model: MODEL_LABEL,
        styles: prompt.STYLES, lengths: prompt.LENGTHS,
      }));
    }

    if (req.method === "GET" && p === "/console") {
      if (!session || session.context?.isAdmin !== true) return html(res, session ? 403 : 401, page.signedOut({ notFound: true }));
      const key = store.userKey(session.identity);
      store.touchUser(key, session.identity, session.context);
      const selectedKey = url.searchParams.get("user") || "";
      if (selectedKey.startsWith("ahd:")) {
        const selectedContext = await auth.playerContextForUserId(selectedKey.slice(4));
        if (selectedContext) store.touchUser(selectedKey,
          { provider: "ahd", id: selectedKey.slice(4), username: selectedContext.username }, selectedContext);
      }
      return html(res, 200, page.consolePage({
        identity: session.identity,
            context: session.context,
            users: store.adminUsers(),
            selected: selectedKey ? store.adminUser(selectedKey) : null,
            reports: store.reportClusters(),
            correctionRows: corrections.list(),
          }));
    }

    // Everything below requires a signed-in, entitled user.
    if (p.startsWith("/api/")) {
      if (!session) return json(res, 401, { error: "Please sign in.", signedOut: true });
      const ent = session.entitlement;
      const key = store.userKey(session.identity);

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
        const tok = store.share(id, key);
        return json(res, 200, tok ? { ok: true, url: `${SELF_ORIGIN}/s/${tok}` } : { ok: false });
      }
      if (req.method === "POST" && p === "/api/answer/feedback") {
        const b = await readJson(req);
        const rating = b?.rating === "up" ? "up" : b?.rating === "down" ? "down" : null;
        if (!rating) return json(res, 400, { error: "Choose helpful or report." });
        const ok = store.feedback({
          answerId: Number(b?.answerId),
          userKey: key,
          rating,
          reason: String(b?.reason || ""),
        });
        return json(res, ok ? 200 : 404, { ok });
      }
      if (req.method === "GET" && p === "/api/conflicts" && ent.staff) {
        return json(res, 200, { conflicts: store.conflicts(url.searchParams.get("status") || "open", 100) });
      }

      if (req.method === "POST" && p === "/api/ask") {
        const body = await readJson(req);
        if (!body) return json(res, 400, { error: "Bad request." });
        const question = String(body.question || "").trim();
        if (question.length < 5) return json(res, 400, { error: "Please ask a slightly longer question." });
        if (question.length > MAX_Q) return json(res, 400, { error: `Keep questions under ${MAX_Q} characters.` });

        const style = prompt.STYLES[body.style] ? body.style : "standard";
        // A report request is a product mode, not a phrasing: deep tier, live
        // data (it spends one live-data question), the house report format, and
        // a standalone shareable page at the end.
        const reportRequested = REPORT_RE.test(question);
        const length = reportRequested ? "deep" : (prompt.LENGTHS[body.length] ? body.length : "standard");
        // Visualizations are a supporter feature. A player who asks for one still
        // gets a real prose answer, plus a note saying where the chart went.
        const vizAllowed = ent.visualizations === true;
        const vizWanted = visualization.requested(question) || body.visualizations === true;
        const vizBlocked = vizWanted && !vizAllowed;

        let plan = askPlan.create(question, session.context);
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
        const wantMcp = body.useMcp === true || plan.live === "required" || mcp.requiresLive(question) || reportRequested;

        // Follow-ups depend on the conversation's prior turns, so the shared
        // answer cache (keyed only on question text) must not touch them: a
        // "what about the UK?" cached from one thread would otherwise be served
        // verbatim into an unrelated one. Only a fresh first turn is cacheable.
        const isFollowup = store.nextCost(convId, key).followup > 0;
        const cacheable = !wantMcp && !isFollowup;
        const route = router.choose({ question, length, style, useMcp: wantMcp, isFollowup, visualizations });

        // Cache is checked BEFORE quota so re-reading an answer is always free.
        // The plan is part of cache identity. A pre-planner answer must never
        // bypass a newer evidence or visualization guard for the same wording.
        const ckey = `plan:${plan.id}|${style}|${length}|viz:${visualizations ? 1 : 0}|${norm(question)}`;
        const hit = cacheable ? store.S.getCache.get(ckey) : null;
        if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
          const cachedModel = hit.model || router.MODELS.flash;
          const answerId = store.record({ user_key: key, username: session.identity.username || null, conv_id: convId,
            question, answer: hit.answer, areas: hit.areas, citations: hit.citations,
            used_mcp: 0, cached: 1, cost: 0, followup: 0, tokens_in: 0, tokens_out: 0,
            model: cachedModel, ts: Date.now() });
          const u = store.usage(key, ent);
          return json(res, 200, {
            convId, answerId, answer: hit.answer, areas: store.safeJson(hit.areas),
            citations: store.safeJson(hit.citations), cached: true, usedMcp: false, vizBlocked,
            model: router.label(cachedModel),
            modelId: cachedModel,
            modelName: models.displayFor(cachedModel),
            usage: u,
            // A "why is MY x so high" question answered from code alone: offer to
            // re-run it against live game state, if the player has live quota left.
            liveHint: u.mcpRemaining > 0 && mcp.looksLive(question),
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
        if (wantMcp && !useMcp) {
          return json(res, 429, {
            error: `You've used all ${usage.mcpLimit} live-data questions for today. Ask without live data, or try tomorrow.`,
            usage, quota: true,
          });
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
        if (isFollowup) {
          try { retrievalQuestion = (await grounding.condense(store.history(convId, key, 3), question)) || question; } catch {}
        }
        try {
          const retrieveOpts = deepAnswer ? { topK: DEEP_TOP_K, maxChars: DEEP_MAX_CHARS } : {};
          // Pro and deep questions get model-written sub-queries so retrieval
          // covers every system the question spans, not just the one the single
          // embedding lands nearest. decompose() fails open to [] and
          // searchMulti with no sub-queries is a plain search.
          const subQueries = route.tier === "flash" ? [] : await grounding.decompose(retrievalQuestion);
          hits = await retrieve.searchMulti(retrievalQuestion, subQueries, retrieveOpts);
        } catch { hits = null; }

        // Staff-verified lessons from past wrong answers, matched semantically.
        let matchedCorrections = [];
        try { matchedCorrections = await corrections.match(retrievalQuestion); } catch {}

        // Live game state, only when asked for and only read-only.
        let liveBlock = "", liveVisualizations = [], liveEvidence = { tools: [], visualizations: [] };
        if (useMcp) {
          try {
            const intelligence = await mcp.liveIntelligence(question, session.context, null, plan);
            liveBlock = intelligence.text;
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
          }
        }

        // Agentic evidence pass. A cheap scout model chases what the one-shot
        // retrieval and the heuristic live pass cannot: follow-up code searches
        // when an excerpt references something unseen, and targeted live
        // lookups the heuristics did not anticipate. Flash-tier questions skip
        // it; they are lookups, and the scout would double their latency.
        let investigation = null;
        if (deepAnswer || (useMcp && route.tier !== "flash")) {
          try {
            investigation = await investigate.run({ question, context: session.context, useLive: useMcp, deep: deepAnswer });
          } catch { investigation = null; }
          if (investigation?.tools?.length) liveEvidence.tools = [...liveEvidence.tools, ...investigation.tools.map(t => `investigate:${t}`)];
        }

        // Stream. The client shows text as it arrives, then a final event
        // carries citations, conflicts and quota — all of which need the whole
        // answer before they can be computed.
        res.writeHead(200, {
          "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive", "X-Accel-Buffering": "no",
        });
        const send = (event, data) => {
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        };
        send("meta", { convId, cost, followup, followupsLeft, usedMcp: useMcp, model: route.label, vizBlocked,
          modelId: route.chain[0], modelName: models.displayFor(route.chain[0]), status: plan.status });

        const ac = new AbortController();
        req.on("close", () => ac.abort());
        const ping = setInterval(() => { try { res.write(": keepalive\n\n"); } catch {} }, 15000);

        let raw = "", failed = null, failedBusy = false, llmUsage = {}, servedModel = route.model;
        try {
          const out = await llm.stream({
            system: prompt.build({ style, length, context: session.context, indexContext: "", visualizations, visualizationRequested, liveData: useMcp, report: reportRequested })
              + (matchedCorrections.length ? `\n\n${corrections.block(matchedCorrections)}` : "")
              + (hits ? `\n\n${hits.context}` : "")
              + (liveBlock ? `\n\n${liveBlock}` : "")
              + (investigation ? `\n\n${investigation.text}` : ""),
            // Deep answers are for exploring a system across several turns, so
            // they carry more of the thread than a one-shot lookup needs.
            history: store.history(convId, key, deepAnswer ? DEEP_HISTORY_TURNS : 3),
            question,
            deep: length === "deep",
            chain: route.chain,
            effort: route.effort,
            signal: ac.signal,
            onDelta: piece => send("delta", piece),
          });
          raw = out.text || "";
          llmUsage = out.usage || {};
          // The chain may have fallen through to a lower-scored model, so record
          // what actually answered rather than what routing first asked for.
          servedModel = out.model || route.model;
          if (out.tried?.length) console.error("[ask] fell through:", out.tried.map(t => t.model).join(", "), "->", servedModel);
        } catch (e) {
          failed = e?.name === "AbortError" ? "aborted" : String(e.message || e).slice(0, 160);
          failedBusy = e?.rateLimited === true;
        }
        clearInterval(ping);

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

        const { text: noFu, followups } = prompt.extractFollowups(raw);
        const { text: noConflict, conflicts } = prompt.extractConflicts(noFu);
        if (conflicts.length) store.recordConflicts(conflicts, { question, user_key: key });
        const cited = cites.apply(noConflict, { question });
        const citations = cited.citations;
        const guarded = answerGuard.enforce({
          answer: cited.text, datasets: liveVisualizations, plan,
          visualizationsEnabled: visualizations, question,
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
        const evidenceForCheck = [
          matchedCorrections.length ? corrections.block(matchedCorrections) : "",
          hits?.context, liveBlock, investigation?.text,
        ].filter(Boolean).join("\n\n");
        if (deepAnswer && evidenceForCheck) {
          try {
            groundingNotes = await grounding.check(answer, evidenceForCheck);
            answer += grounding.note(groundingNotes);
          } catch { groundingNotes = []; }
        }
        // Mechanical check, every tier: a file path cited in the answer that was
        // never in the evidence is an invention, no model call needed to prove
        // it. The answer is annotated, and below it is barred from the shared
        // cache so one hallucination is one player's, not everyone's.
        let inventedPaths = [];
        try {
          inventedPaths = grounding.inventedPaths(answer, evidenceForCheck);
          answer += grounding.pathNote(inventedPaths);
        } catch { inventedPaths = []; }
        const validation = { plan: plan.id, issues: [...guarded.issues, ...answerGuard.inspect(answer, plan)], grounding: groundingNotes, inventedPaths };
        const areas = cites.areasFor(hits?.files || []);

        if (cacheable && !inventedPaths.length && !groundingNotes.length) {
          store.S.putCache.run(ckey, answer, JSON.stringify(areas), JSON.stringify(citations), servedModel, Date.now());
        }
        const answerId = store.record({
          user_key: key, username: session.identity.username || null, conv_id: convId,
          question, answer, areas: JSON.stringify(areas), citations: JSON.stringify(citations),
          used_mcp: useMcp ? 1 : 0, cached: 0, cost, followup,
          tokens_in: Number(llmUsage.prompt_tokens || 0), tokens_out: Number(llmUsage.completion_tokens || 0), model: servedModel,
          plan: JSON.stringify(plan), validation: JSON.stringify(validation), evidence: JSON.stringify(liveEvidence), ts: Date.now(),
        });

        // A report gets its own page. Title comes from the model's own H1, with
        // the question as fallback if it ignored the format.
        let reportUrl = null;
        if (reportRequested) {
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
          convId, answerId, answer, areas, citations, cached: false, usedMcp: useMcp,
          cost, followup, followupsLeft, followups, vizBlocked, reportUrl,
          model: router.label(servedModel),
          modelId: servedModel,
          modelName: models.displayFor(servedModel),
          conflicts: conflicts.map(c => ({ source: c.source, page: c.page, claim: c.claim, actual: c.actual })),
          usage: store.usage(key, ent),
          // Answered from code but the question reads like a live-state one, and
          // the player didn't ask for live data and still has some left.
          liveHint: !useMcp && usage.mcpRemaining > 0 && mcp.looksLive(question),
          validation,
        });
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
  const scripts = [...probe.matchAll(/<script>([\s\S]*?)<\/script>/g), ...reportProbe.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!scripts.length) throw new Error("client script block missing");
  for (const [, source] of scripts) new Function(source);
  console.log("[ask] client scripts OK (" + scripts.length + " blocks)");
} catch (e) {
  console.error("[ask] FATAL: client script is broken —", e.message);
  process.exit(1);
}

server.listen(PORT, "127.0.0.1", () => console.log(`ask-site listening on 127.0.0.1:${PORT}`));
