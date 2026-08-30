// Streaming client with a scored fallback chain.
//
// ask-site builds its own prompt and does its own retrieval, so routing through
// ops-dash added a hop that could not stream. Answers took up to a minute with
// nothing on screen. Streaming puts the first words up quickly, which is the
// difference between "thinking" and "broken".
//
// Models are tried in the order router.js supplies, which is scored order from
// models.js. Free OpenRouter capacity leads; DeepSeek is the paid backstop that
// has never failed a bench request.
const models = require("./models");

const KEYS = {
  openrouter: () => process.env.OPENROUTER_API_KEY || "",
  deepseek: () => process.env.DEEPSEEK_API_KEY || "",
  // Google's OpenAI-compatible endpoint takes the API key as a bearer token.
  google: () => process.env.GEMINI_API_KEY || "",
  // Local Ollama proxy (free cloud tags). Any bearer works on loopback.
  ollama: () => process.env.OLLAMA_API_KEY || "ollama",
  // OpenCode gateway — free community models. Zen route (Mimo, Muse Spark) and
  // the "go" route (Ox Alpha) share one key but live at different URLs.
  opencode: () => process.env.OPENCODE_API_KEY || "",
  opencodego: () => process.env.OPENCODE_API_KEY || "",
  // Command Code provider API (OpenAI-compat). Carries the free MiniMax lane
  // (GMICloud) through 2026-09-05.
  commandcode: () => process.env.COMMANDCODE_API_KEY || "",
};
const URLS = {
  openrouter: () => process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions",
  deepseek: () => process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions",
  google: () => process.env.GEMINI_URL || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  ollama: () => process.env.OLLAMA_URL || "http://localhost:11434/v1/chat/completions",
  opencode: () => process.env.OPENCODE_URL || "https://opencode.ai/zen/v1/chat/completions",
  opencodego: () => process.env.OPENCODE_GO_URL || "https://opencode.ai/zen/go/v1/chat/completions",
  commandcode: () => process.env.COMMANDCODE_URL || "https://api.commandcode.ai/provider/v1/chat/completions",
};

// Railway service references are normally configured as a base URL. Ollama's
// OpenAI-compatible request contract lives at /v1/chat/completions, so posting
// the same body to the service root produces a 405. Preserve explicit paths,
// but make a bare host safe in every environment.
function completionUrl(provider, configured = URLS[provider]?.()) {
  const raw = String(configured || "").trim();
  if (provider !== "ollama" || !raw) return raw;
  try {
    const url = new URL(raw);
    if (url.pathname === "/" || url.pathname === "/v1" || url.pathname === "/v1/") {
      url.pathname = "/v1/chat/completions";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}
const DEFAULT_MODEL = process.env.ASK_MODEL || models.CHAINS.flash[0];
const RETRIES_PER_MODEL = Number(process.env.ASK_LLM_RETRIES || 2);

// Circuit breaker. A model that rate-limits, errors, or stalls before its first
// token is put in cooldown and skipped on subsequent requests, so the chain
// dynamically routes around a dead or throttled endpoint instead of paying its
// latency every time. Cooldowns self-expire, which re-tests the endpoint on the
// next request — no separate health-probe traffic (that would burn free quota).
const RATE_COOLDOWN_MS = Number(process.env.ASK_RATE_COOLDOWN_MS || 60000);
const FAIL_COOLDOWN_MS = Number(process.env.ASK_FAIL_COOLDOWN_MS || 20000);
// Abandon a non-deep model that produces no visible token in this long and fall
// through (the observed Gemini free-tier stall was ~29s). Deep answers legitimately
// think longer, so they are not time-gated here — only rate-limits move them.
const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.ASK_FIRST_TOKEN_TIMEOUT_MS || 18000);
const cooldowns = new Map(); // id -> { until, reason }
function isCoolingDown(id) {
  const c = cooldowns.get(id);
  if (!c) return false;
  if (Date.now() >= c.until) { cooldowns.delete(id); return false; }
  return true;
}
function markCooldown(id, ms, reason) {
  cooldowns.set(id, { until: Date.now() + ms, reason });
  console.error(`[ask] ${id} cooldown ${Math.round(ms / 1000)}s (${reason})`);
}
/** Live view of which models are currently benched, for the console/health. */
function cooldownState() {
  const out = {};
  for (const [id, c] of cooldowns) if (Date.now() < c.until) out[id] = { reason: c.reason, msLeft: c.until - Date.now() };
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ask is open to every player, so a burst is now normal traffic. Free endpoints
// answer a burst with 429s, which the chain would then walk one model at a time
// per request. Capping our own concurrency turns a self-inflicted rate-limit
// storm into a short queue instead.
const MAX_INFLIGHT = Number(process.env.ASK_MAX_INFLIGHT || 4);
let inflight = 0;
const waiting = [];
function acquire() {
  if (inflight < MAX_INFLIGHT) { inflight++; return Promise.resolve(); }
  return new Promise(resolve => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else inflight = Math.max(0, inflight - 1);
}

/** One streamed attempt against one model. Throws on transport or HTTP failure. */
async function attempt({ id, system, history, question, effort, maxTokens, onDelta, signal, emitted, firstTokenTimeoutMs = 0 }) {
  const entry = models.CATALOG[id] || { provider: "openrouter" };
  const provider = entry.provider;
  // A provider with no key configured can never answer: fail without a network
  // round-trip so the chain moves on instantly. Lets a chain lead with a model
  // whose key is not on the box yet (it activates the moment the key is set).
  if (provider !== "ollama" && !KEYS[provider]?.()) {
    const err = new Error(`${provider} has no API key configured`);
    err.status = 401;
    throw err;
  }
  const body = {
    model: id,
    messages: [{ role: "system", content: system }, ...history, { role: "user", content: question }],
    temperature: 1,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  const resolved = models.effortFor(id, effort);
  if (resolved) body.reasoning_effort = resolved;

  // One controller relays the caller's abort AND enforces the first-token
  // deadline, so a model that never speaks is dropped instead of hanging.
  const inner = new AbortController();
  const relay = () => inner.abort();
  if (signal) { if (signal.aborted) inner.abort(); else signal.addEventListener("abort", relay, { once: true }); }
  let gotFirst = false, timedOut = false;
  const timer = firstTokenTimeoutMs > 0
    ? setTimeout(() => { if (!gotFirst) { timedOut = true; inner.abort(); } }, firstTokenTimeoutMs)
    : null;

  try {
    // Google's OpenAI-compat STREAMING endpoint truncates mid-answer — the stream
    // ends with no finish_reason after a partial (reproduced across every option
    // combination). Non-streaming returns the complete answer, so fetch it whole
    // and replay it as deltas: the client still gets a progressive reveal, and the
    // saved answer is no longer cut off.
    if (provider === "google") {
      const r = await fetch(URLS.google(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.google()}` },
        body: JSON.stringify({ ...body, stream: false, stream_options: undefined }),
        signal: inner.signal,
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        const err = new Error(`google ${r.status} ${t.slice(0, 200)}`); err.status = r.status; throw err;
      }
      const j = await r.json();
      const msg = j.choices?.[0]?.message?.content || "";
      const finish = j.choices?.[0]?.finish_reason || null;
      if (msg && onDelta) {
        for (const chunk of (msg.match(/[\s\S]{1,64}(?:\s|$)/g) || [msg])) {
          if (!gotFirst) { gotFirst = true; if (timer) clearTimeout(timer); }
          emitted.any = true; onDelta(chunk);
        }
      }
      return { text: msg, usage: j.usage || null, finish, model: id, effort: resolved };
    }

    const r = await fetch(completionUrl(provider), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEYS[provider]()}`,
        // OpenRouter attributes usage to the app when these are present.
        ...(provider === "openrouter"
          ? { "HTTP-Referer": process.env.SELF_ORIGIN || "https://ask.lakesidegames.net", "X-Title": "Lakeside Ask" }
          : {}),
        ...(provider === "opencode" || provider === "opencodego" ? { "User-Agent": "opencode" } : {}),
      },
      body: JSON.stringify(body),
      signal: inner.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      const err = new Error(`${provider} ${r.status} ${text.slice(0, 200)}`);
      err.status = r.status;
      throw err;
    }

    let text = "", usage = null, finish = null, buf = "";
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let j; try { j = JSON.parse(payload); } catch { continue; }
        if (j.usage) usage = j.usage;
        // OpenRouter reports mid-stream provider faults in-band rather than by
        // status code, so a 200 that dies halfway still has to be caught.
        if (j.error) {
          const err = new Error(`${provider} stream ${JSON.stringify(j.error).slice(0, 200)}`);
          err.status = j.error.code;
          throw err;
        }
        const ch = j.choices?.[0];
        if (!ch) continue;
        if (ch.finish_reason) finish = ch.finish_reason;
        const piece = ch.delta?.content;
        if (piece) { if (!gotFirst) { gotFirst = true; if (timer) clearTimeout(timer); } text += piece; emitted.any = true; if (onDelta) onDelta(piece); }
      }
    }
    return { text, usage, finish, model: id, effort: resolved };
  } catch (e) {
    // A first-token timeout surfaces as an abort; retag it as a transient
    // endpoint failure so the chain cools it down and falls through, rather than
    // the caller mistaking it for the user cancelling.
    if (timedOut) { const err = new Error(`${id} produced no token in ${firstTokenTimeoutMs}ms`); err.ttftTimeout = true; throw err; }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", relay);
  }
}

/**
 * Stream a completion, walking the chain until one model answers.
 * `onDelta(text)` fires per token chunk. Resolves to { text, usage, finish, model }.
 *
 * A model is only abandoned while the player has seen nothing. Once any token has
 * been written to the response there is no way to retract it, so a mid-stream
 * failure after first output is returned as-is rather than restarted underneath
 * a half-rendered answer.
 */
async function stream(opts) {
  await acquire();
  try { return await walk(opts); } finally { release(); }
}

function isRateLimit(e) {
  return Number(e?.status) === 429 || /\b429\b/.test(String(e?.message || "")) || e?.rateLimited === true;
}

async function walk({ system, history = [], question, longAnswer = false, tier = null, chain, model, effort, onDelta, signal }) {
  const rawOrder = (chain && chain.length ? chain : [model || DEFAULT_MODEL]).filter(Boolean);
  // Skip models currently benched by the circuit breaker. If that would skip the
  // whole chain, keep the last one (the reliable paid backstop) — better a slow
  // answer than none.
  let order = rawOrder.filter(id => !isCoolingDown(id));
  if (!order.length) order = rawOrder.slice(-1);
  // Reasoning effort follows the tier, never the requested length: asking for a
  // longer answer is not asking the model to think harder.
  const want = effort || (tier === "deep" ? "high" : tier === "pro" ? "medium" : "low");
  // Reasoning tokens are billed against max_tokens, so a model that thinks hard
  // on a 7k-token prompt can exhaust the budget before writing anything.
  //
  // 8000 was not enough: the corpus audit found answers cut off mid-sentence on
  // the standard tier, all of them reasoning models that had spent most of the
  // ceiling thinking. This is a cap and not a spend, and the LENGTH rules still
  // bound how much prose the model writes, so raising it costs nothing on the
  // answers that were already finishing cleanly.
  // Token ceiling follows the requested LENGTH, so the fast model can be asked
  // for a long answer. It is a cap and not a spend: the prompt's length rules
  // still bound how much prose gets written.
  const maxTokens = longAnswer ? Number(process.env.ASK_MAX_TOKENS_DEEP || 32000) : Number(process.env.ASK_MAX_TOKENS || 16000);
  // First-token deadline follows the TIER, and nothing else. A long answer from
  // the fast model is still the fast model, and it must not inherit the deep
  // tier's unlimited leash just because the player asked for more words.
  const ttft = tier === "deep" ? 0
    : tier === "pro" ? Number(process.env.ASK_TTFT_PRO_MS || 60000)
    : FIRST_TOKEN_TIMEOUT_MS;
  const emitted = { any: false };
  const tried = [];
  let last = null;

  for (const id of order) {
    let rateLimited = false;
    for (let a = 0; a <= RETRIES_PER_MODEL; a++) {
      try {
        const out = await attempt({ id, system, history, question, effort: want, maxTokens, onDelta, signal, emitted, firstTokenTimeoutMs: ttft });
        if (out.text.trim()) { cooldowns.delete(id); return { ...out, tried }; }
        last = new Error(`${id} returned an empty answer (finish=${out.finish})`);
      } catch (e) {
        if (e?.name === "AbortError") throw e; // genuine user cancel
        last = e;
        // A rate limit won't clear on a retry of the same model, and a stall
        // before the first token means this endpoint is unhealthy right now —
        // both fall straight through instead of burning retries.
        if (isRateLimit(e)) { rateLimited = true; break; }
        if (e?.ttftTimeout) break;
        const status = Number(e?.status);
        if (status >= 400 && status < 500 && status !== 408) break;
      }
      if (emitted.any) return { text: "", usage: null, finish: "interrupted", model: id, tried, error: String(last?.message || last) };
      if (a < RETRIES_PER_MODEL) await sleep(1500 * (a + 1));
    }
    // Bench this endpoint: a rate limit cools longer than a transient error so
    // the next requests route past it (ultimately to DeepSeek) automatically.
    markCooldown(id, rateLimited ? RATE_COOLDOWN_MS : FAIL_COOLDOWN_MS, rateLimited ? "rate-limit" : "error");
    tried.push({ model: id, error: String(last?.message || last).slice(0, 160) });
    if (emitted.any) break;
    console.error(`[ask] ${id} failed, falling through:`, String(last?.message || last).slice(0, 160));
  }
  const err = new Error(`all models failed (${tried.map(t => t.model).join(", ")}): ${String(last?.message || last).slice(0, 160)}`);
  err.tried = tried;
  // Every model being busy is a capacity problem, not a bad question, and the
  // player should be told the difference.
  err.rateLimited = isRateLimit(last);
  throw err;
}

// Internal helper completions: query decomposition, the scout loop, grounding
// checks, follow-up condensation. Free OpenRouter capacity first, DeepSeek as
// the backstop that has never failed a request (owner call 2026-08-24: route
// everything through free where possible). The free attempt gets a short
// timeout so a congested free endpoint costs a couple of seconds, not the
// answer; deliberately outside the inflight semaphore — these run while no
// player stream holds a slot, and gating them could stall the answer path
// they serve. Every caller must treat null as "skip the enhancement", never
// as an error the player sees.
const HELPER_CHAIN = (process.env.ASK_HELPER_CHAIN || "nvidia/nemotron-3-ultra-550b-a55b:free,deepseek-v4-flash")
  .split(",").map(s => s.trim()).filter(Boolean);
const HELPER_FREE_TIMEOUT_MS = Number(process.env.ASK_HELPER_FREE_TIMEOUT_MS || 10000);

async function helperAttempt(id, body, timeoutMs) {
  const provider = models.CATALOG[id]?.provider || (id.includes("/") ? "openrouter" : "deepseek");
  const r = await fetch(completionUrl(provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEYS[provider]()}`,
      ...(provider === "openrouter"
        ? { "HTTP-Referer": process.env.SELF_ORIGIN || "https://ask.lakesidegames.net", "X-Title": "Lakeside Ask" }
        : {}),
    },
    body: JSON.stringify({ ...body, model: id }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) return null;
  const d = await r.json();
  const message = d.choices?.[0]?.message || null;
  if (message) {
    message._askModel = id;
    message._askUsage = d.usage || null;
  }
  return message;
}

async function helperChat(body, timeoutMs) {
  for (const id of HELPER_CHAIN) {
    const isFree = (models.CATALOG[id]?.provider || "openrouter") === "openrouter";
    try {
      const msg = await helperAttempt(id, body, isFree ? Math.min(timeoutMs, HELPER_FREE_TIMEOUT_MS) : timeoutMs);
      // A free model that answers without honoring the tool contract (content
      // but no tool_calls when tools were offered) is still a valid answer —
      // the callers all handle a plain message.
      if (msg && (msg.content || msg.tool_calls?.length)) return msg;
    } catch { /* next model */ }
  }
  return null;
}

async function complete({ system, question, maxTokens = 600, timeoutMs = 12000 }) {
  const result = await completeResult({ system, question, maxTokens, timeoutMs });
  return result?.text || null;
}

async function completeResult({ system, question, maxTokens = 600, timeoutMs = 12000 }) {
  const msg = await helperChat({
    messages: [{ role: "system", content: system }, { role: "user", content: question }],
    temperature: 0, max_tokens: maxTokens,
  }, timeoutMs);
  if (!msg?.content) return null;
  return { text: msg.content, model: msg._askModel || null, usage: msg._askUsage || null };
}

// Raw chat turn for the investigator loop: full message list in, the model's
// message object out (which may carry tool_calls). Fail-open null.
async function chatRaw({ messages, tools = null, maxTokens = 900, timeoutMs = 20000 }) {
  const body = { messages, temperature: 0, max_tokens: maxTokens };
  if (tools && tools.length) body.tools = tools;
  return helperChat(body, timeoutMs);
}

module.exports = { stream, complete, completeResult, chatRaw, cooldownState, completionUrl, MODEL: DEFAULT_MODEL, MAX_INFLIGHT, HELPER_CHAIN };
