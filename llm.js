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
};
const URLS = {
  openrouter: () => process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions",
  deepseek: () => process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions",
};
const DEFAULT_MODEL = process.env.ASK_MODEL || models.CHAINS.flash[0];
const RETRIES_PER_MODEL = Number(process.env.ASK_LLM_RETRIES || 2);

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
async function attempt({ id, system, history, question, effort, maxTokens, onDelta, signal, emitted }) {
  const entry = models.CATALOG[id] || { provider: "openrouter" };
  const provider = entry.provider;
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

  const r = await fetch(URLS[provider](), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEYS[provider]()}`,
      // OpenRouter attributes usage to the app when these are present.
      ...(provider === "openrouter"
        ? { "HTTP-Referer": process.env.SELF_ORIGIN || "https://ask.lakesidegames.net", "X-Title": "Lakeside Ask" }
        : {}),
    },
    body: JSON.stringify(body),
    signal,
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
      if (piece) { text += piece; emitted.any = true; if (onDelta) onDelta(piece); }
    }
  }
  return { text, usage, finish, model: id, effort: resolved };
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

async function walk({ system, history = [], question, deep = false, chain, model, effort, onDelta, signal }) {
  const order = (chain && chain.length ? chain : [model || DEFAULT_MODEL]).filter(Boolean);
  const want = effort || (deep ? "high" : "low");
  // Reasoning tokens are billed against max_tokens, so a model that thinks hard
  // on a 7k-token prompt can exhaust the budget before writing anything.
  const maxTokens = deep ? Number(process.env.ASK_MAX_TOKENS_DEEP || 32000) : Number(process.env.ASK_MAX_TOKENS || 8000);
  const emitted = { any: false };
  const tried = [];
  let last = null;

  for (const id of order) {
    for (let a = 0; a <= RETRIES_PER_MODEL; a++) {
      try {
        const out = await attempt({ id, system, history, question, effort: want, maxTokens, onDelta, signal, emitted });
        if (out.text.trim()) return { ...out, tried };
        last = new Error(`${id} returned an empty answer (finish=${out.finish})`);
      } catch (e) {
        if (e?.name === "AbortError") throw e;
        last = e;
        // 4xx other than rate limiting and timeout will not fix themselves.
        const status = Number(e?.status);
        if (status >= 400 && status < 500 && status !== 429 && status !== 408) break;
      }
      if (emitted.any) return { text: "", usage: null, finish: "interrupted", model: id, tried, error: String(last?.message || last) };
      if (a < RETRIES_PER_MODEL) await sleep(1500 * (a + 1));
    }
    tried.push({ model: id, error: String(last?.message || last).slice(0, 160) });
    if (emitted.any) break;
    console.error(`[ask] ${id} failed, falling through:`, String(last?.message || last).slice(0, 160));
  }
  const err = new Error(`all models failed (${tried.map(t => t.model).join(", ")}): ${String(last?.message || last).slice(0, 160)}`);
  err.tried = tried;
  // Every model being busy is a capacity problem, not a bad question, and the
  // player should be told the difference.
  err.rateLimited = Number(last?.status) === 429 || /\b429\b/.test(String(last?.message || ""));
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
  const r = await fetch(URLS[provider](), {
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
  return d.choices?.[0]?.message || null;
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
  const msg = await helperChat({
    messages: [{ role: "system", content: system }, { role: "user", content: question }],
    temperature: 0, max_tokens: maxTokens,
  }, timeoutMs);
  return msg?.content || null;
}

// Raw chat turn for the investigator loop: full message list in, the model's
// message object out (which may carry tool_calls). Fail-open null.
async function chatRaw({ messages, tools = null, maxTokens = 900, timeoutMs = 20000 }) {
  const body = { messages, temperature: 0, max_tokens: maxTokens };
  if (tools && tools.length) body.tools = tools;
  return helperChat(body, timeoutMs);
}

module.exports = { stream, complete, chatRaw, MODEL: DEFAULT_MODEL, MAX_INFLIGHT, HELPER_CHAIN };
