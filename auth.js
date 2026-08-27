// Auth + entitlement for ask.lakesidegames.net.
//
// Two hops, deliberately:
//   1. Lakeside Auth broker  -> WHO you are (opaque session, identity only)
//   2. ops-dash player-context -> WHAT you're entitled to (tier, role, character)
//
// The broker is an identity service and does not know about supporter tiers, and
// ops-dash owns the Mongo connection. Keeping them separate means this public
// service holds neither a JWT secret nor a database handle.
const crypto = require("node:crypto");

const AUTH_ORIGIN = process.env.AUTH_ORIGIN || "https://auth.ahousedividedgame.com";
const AUTH_INTERNAL = process.env.AUTH_INTERNAL_URL || "http://127.0.0.1:3600";
const INTERNAL_TOKEN = process.env.AUTH_INTERNAL_TOKEN || "";
const OPS_INTERNAL = process.env.OPS_INTERNAL_URL || "http://127.0.0.1:9724";
const ASK_SECRET = process.env.ASK_SECRET || "";
// Temporary lock: when set, only staff (admin/moderator) may use the service.
const ASK_PRIVATE = /^(1|true|yes|on)$/i.test(process.env.ASK_PRIVATE || "");
const SELF_ORIGIN = process.env.SELF_ORIGIN || "https://ask.lakesidegames.net";
const COOKIE = "ask_session";

// Tier -> daily budgets. Staff are not supporters but must never be locked out.
//
// Opened to every signed-in player 2026-08-23. Free OpenRouter capacity carries
// the answers, so the cost of a question no longer scales with who asks it. Every
// supporter budget doubled at the same time, so supporting still buys the same
// multiple it always did over the default.
//
// Visualizations stay a supporter feature. They are the slowest and least
// reliable path (the deep tier, 30s+ to first token) and every reported answer
// to date has been a visualization failure, so they are not what a first-time
// player should meet.
const TIERS = {
  "supporter-plus-plus": { label: "Supporter++", questions: 40, mcp: 10, visualizations: true },
  "supporter-plus":      { label: "Supporter+",  questions: 20, mcp: 6,  visualizations: true },
  "supporter":           { label: "Supporter",   questions: 10, mcp: 4,  visualizations: true },
};
// What the Supporter tier used to be, now the floor for any signed-in player.
const PLAYER = { label: "Player", questions: 5, mcp: 2, visualizations: false };
const STAFF = { label: "Staff", questions: 200, mcp: 50, visualizations: true };

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, value, maxAgeSec) {
  const bits = [`${COOKIE}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  bits.push(maxAgeSec > 0 ? `Max-Age=${maxAgeSec}` : "Max-Age=0");
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, bits.join("; ")) : bits.join("; "));
}

async function postJson(url, body, headers = {}, timeoutMs = 15000) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, data };
}

/** Step 1: bounce the browser to the broker, which reads the AHD game cookie. */
function loginRedirect(res, returnTo = "/") {
  const cb = new URL("/auth/callback", SELF_ORIGIN);
  if (returnTo && returnTo.startsWith("/")) cb.searchParams.set("next", returnTo);
  const u = new URL("/auth/ahd", AUTH_ORIGIN);
  u.searchParams.set("return", cb.toString());
  res.writeHead(302, { Location: u.toString(), "Cache-Control": "no-store" });
  res.end();
}

/** Step 2: exchange the single-use handoff code for an opaque session. */
async function completeLogin(res, code, next = "/") {
  if (!INTERNAL_TOKEN) { res.writeHead(500).end("auth not configured"); return; }
  const { ok, data } = await postJson(`${AUTH_INTERNAL}/internal/redeem`, { code },
    { Authorization: `Bearer ${INTERNAL_TOKEN}` });
  if (!ok || !data?.sessionToken) {
    res.writeHead(302, { Location: "/?auth=failed", "Cache-Control": "no-store" });
    return res.end();
  }
  const ttl = data.expiresAt ? Math.max(60, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000)) : 86400;
  setCookie(res, data.sessionToken, ttl);
  const dest = typeof next === "string" && next.startsWith("/") ? next : "/";
  res.writeHead(302, { Location: dest, "Cache-Control": "no-store" });
  res.end();
}

function logout(res) {
  setCookie(res, "", 0);
  res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
  res.end();
}

// Entitlement lookups are chatty and change rarely; cache briefly so a burst of
// questions does not hammer Mongo through ops-dash.
const _ctxCache = new Map();
const CTX_TTL = 120000;

/**
 * Resolve the caller to { identity, context, entitlement } or null when signed out.
 * Never throws — a broker or ops-dash outage degrades to signed-out rather than 500.
 */
async function resolve(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;

  const hit = _ctxCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.value;

  let identity = null;
  try {
    const { ok, data } = await postJson(`${AUTH_INTERNAL}/internal/verify`, { sessionToken: token },
      { Authorization: `Bearer ${INTERNAL_TOKEN}` });
    if (!ok || !data?.identity) return null;
    identity = data.identity;
  } catch { return null; }

  // Discord identities have no AHD userId, so no tier can be resolved for them.
  let context = null;
  if (identity.provider === "ahd" && identity.id) {
    // The player-context lookup goes ops-dash -> a remote (Railway-proxied) Mongo
    // that blips under load. Retry once before giving up, so a single slow query
    // does not lock a real, entitled player out of Ask.
    for (let attempt = 0; attempt < 2 && !context; attempt++) {
      try {
        const { ok, data } = await postJson(`${OPS_INTERNAL}/internal/player-context`,
          { userId: identity.id }, { "x-ask-secret": ASK_SECRET }, 20000);
        if (ok) context = data;
      } catch {}
      if (!context && attempt === 0) await new Promise(r => setTimeout(r, 300));
    }
  }

  const value = { identity, context, entitlement: entitlementFor(context) };
  // Cache a good resolution for the normal window; cache a FAILED one only
  // briefly. A transient ops-dash/Mongo blip must not stick "can't confirm your
  // account" to a real player for two minutes — "Try again" then actually retries.
  _ctxCache.set(token, { value, exp: Date.now() + (context ? CTX_TTL : 8000) });
  if (_ctxCache.size > 5000) _ctxCache.clear();
  return value;
}

/** Who may use the service at all, and how much. */
function entitlementFor(context) {
  // No context means ops-dash could not confirm this is a player account, which
  // is also what an ops-dash outage looks like. Fail closed either way.
  if (!context) return { allowed: false, reason: "no-context", label: null, questions: 0, mcp: 0, visualizations: false };
  if (context.isBanned) return { allowed: false, reason: "banned", label: null, questions: 0, mcp: 0, visualizations: false };
  if (ASK_PRIVATE && !(context.isAdmin || context.isModerator)) {
    return { allowed: false, reason: "private", label: null, questions: 0, mcp: 0, visualizations: false };
  }
  if (context.isAdmin || context.isModerator) {
    return { allowed: true, reason: "staff", label: STAFF.label, questions: STAFF.questions, mcp: STAFF.mcp,
      visualizations: STAFF.visualizations, staff: true };
  }
  const tier = context.tierActive ? context.tier : null;
  const t = tier && TIERS[tier];
  if (!t) {
    return { allowed: true, reason: "player", label: PLAYER.label, questions: PLAYER.questions, mcp: PLAYER.mcp,
      visualizations: PLAYER.visualizations };
  }
  return { allowed: true, reason: "supporter", tier, label: t.label, questions: t.questions, mcp: t.mcp,
    visualizations: t.visualizations };
}

function invalidate(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) _ctxCache.delete(token);
}

async function playerContextForUserId(userId) {
  if (!userId) return null;
  try {
    const { ok, data } = await postJson(`${OPS_INTERNAL}/internal/player-context`,
      { userId }, { "x-ask-secret": ASK_SECRET }, 20000);
    return ok ? data : null;
  } catch { return null; }
}

module.exports = { loginRedirect, completeLogin, logout, resolve, entitlementFor, parseCookies, TIERS, PLAYER, STAFF, COOKIE, invalidate, playerContextForUserId };
