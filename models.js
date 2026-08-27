// Scored model registry.
//
// Every number here was measured against the real ask-site prompt (~25k chars of
// system prompt plus retrieved source) on 2026-08-23, not taken from a vendor
// page, against an internal bench harness kept out of this repo.
//
// score      composite of judged grounding/usefulness/brief-fit, the follow-up
//            marker contract, first-token latency, and success rate
// ttftP50Ms  median time to first visible token on that real prompt. Short
//            prompts are not representative: ox-alpha answers a 109-token
//            prompt in 2.3s and the real one in 45s.
const CATALOG = {
  "minimax/minimax-m3-free": {
    display: "MiniMax M3",
    provider: "commandcode", tier: "flash", score: null, ttftP50Ms: null,
    efforts: null,
    note: "MiniMax M3 via the Command Code provider API (GMICloud free lane, $0 through 2026-09-05, 1M context). No ZDR on this lane. Default chain lead from 2026-08-27; inert until COMMANDCODE_API_KEY is set, the chain skips it instantly without a key.",
  },
  "minimax/minimax-m2.7-free": {
    display: "MiniMax M2.7",
    provider: "commandcode", tier: "flash", score: null, ttftP50Ms: null,
    efforts: null,
    note: "MiniMax M2.7 on the same Command Code free lane (197K context). Named alternate to M3, not in any default chain.",
  },
  "nvidia/nemotron-3-ultra-550b-a55b:free": {
    display: "Nemotron Ultra",
    provider: "openrouter", tier: "pro", score: 79.0, ttftP50Ms: 6606,
    efforts: ["high", "medium"],
    note: "Best free model measured. Zero invented file paths, steady 4.7-10.5s first token.",
  },
  "stealth/ox-alpha": {
    display: "Ox Alpha",
    provider: "openrouter", tier: "deep", score: 74.4, ttftP50Ms: 45058,
    efforts: ["max", "high", "low"],
    note: "Best judged grounding (4.2/5) but the slowest to first token. Preview slug, can be withdrawn without notice.",
  },
  "nvidia/nemotron-3.5-lightning:free": {
    display: "Nemotron Lightning",
    provider: "openrouter", tier: "flash", score: 72.4, ttftP50Ms: 21332,
    efforts: null,
    note: "Out of the default chains since 2026-08-23: 25-58s to first token live, and it spends most of its budget on hidden reasoning (3222 completion tokens for 545 characters of answer). Kept for display of historic rows.",
  },
  "meta/muse-spark-1.2-contributor": {
    display: "Muse Spark",
    provider: "openrouter", tier: "flash", score: null, ttftP50Ms: 2200,
    // Reasoning is MANDATORY on this endpoint and cannot be disabled: "none"
    // returns a 400. At the default (unset) effort it burns 600-850 hidden
    // reasoning tokens and takes 5-26s to first visible token. "minimal" keeps it
    // to ~130 tokens and ~2s, which is why it is the only effort exposed here —
    // effortFor() maps the flash tier's wanted "none" to the nearest rung.
    efforts: ["minimal"],
    note: "Default answer model from 2026-08-25. 1M context, contributor (free) endpoint. Reasoning is mandatory; run at minimal effort for ~2s first token. Falls back to DeepSeek Flash if the endpoint is unavailable.",
  },
  "meta/muse-spark-1.2": {
    display: "Muse Spark",
    provider: "openrouter", tier: "flash", score: null, ttftP50Ms: 2200,
    efforts: ["minimal"],
    note: "Paid Muse Spark 1.2 ($1.25/M in, $4.25/M out). Reasoning mandatory; run at minimal effort. Named fallback for the contributor slug.",
  },
  "gemini-3.7-flash": {
    display: "Gemini 3.7 Flash",
    provider: "google", tier: "flash", score: null, ttftP50Ms: 3000,
    // Default from 2026-08-25. Newer than 3.6, same free Google endpoint, same
    // mandatory-reasoning constraint, so pinned to LOW effort like 3.6.
    efforts: ["low"],
    note: "Default answer model. Google free-tier API (OpenAI-compat). Newer than 3.6 Flash; reasoning mandatory, pinned to LOW effort (~3-5s first token). Falls back to DeepSeek Flash.",
  },
  "gemini-3.6-flash": {
    display: "Gemini Flash",
    provider: "google", tier: "flash", score: null, ttftP50Ms: 3000,
    // Reasoning is MANDATORY ("none" is a 400) and effort scales first-token time
    // HARD: at "high" a deep/live answer took 21-35s to first token (measured —
    // long enough to drop mobile connections). "low" keeps it to ~3-5s with no
    // quality loss on these grounded answers, so it is the ONLY effort exposed:
    // effortFor() maps every tier's wanted rung (including the deep tier's "high")
    // down to "low".
    efforts: ["low"],
    note: "Default answer model from 2026-08-25, via Google's free-tier API (OpenAI-compat endpoint). Best grounding of the tested set — refuses to answer past the evidence. 1M context. Pinned to LOW reasoning effort across all tiers (~3-5s first token); high effort caused 20-35s first-token stalls on deep/live questions. Falls back to DeepSeek Flash.",
  },
  "deepseek-v4-flash:cloud": {
    display: "DeepSeek Flash",
    provider: "ollama", tier: "flash", score: null, ttftP50Ms: 15000,
    efforts: null,
    note: "DeepSeek V4 Flash via the local Ollama cloud tag — FREE (Ollama grunt tier), routed over loopback. Primary free fallback since the OpenRouter key was rotated 2026-08-25. ttft re-measured 2026-08-27 on the REAL prompt across 7 runs: 5.1-18.8s, medians 12.9s and 17.5s on two passes, so ~15s with wide spread. The previous 900ms here was a short-prompt reading and understated it by an order of magnitude. Also narrated its own evidence bundle on 1 of 3 runs, which GLM 5.3 Flash never did in 4 — part of why pro leads with GLM.",
  },
  "glm-5.3-flash:cloud": {
    display: "GLM 5.3 Flash",
    provider: "ollama", tier: "pro", score: null, ttftP50Ms: 24195,
    efforts: null,
    // Measured 2026-08-27 on the real prompt over four cross-system questions:
    // ttft 13.6/23.9/24.5/48.1s, 1520-2076 chars, follow-up marker 4/4, cites a
    // real path 4/4, never narrated its evidence bundle, never truncated.
    note: "GLM 5.3 Flash via the Ollama cloud tag — FREE, loopback. Pro-tier lead from 2026-08-27 (owner call). Best contract compliance of the benched set (4/4 follow-up marker, 4/4 real path citation) and the slowest to first token: ~24s median, 48s worst. Fine for pro, which tolerates a 60s first-token leash; do NOT put it on flash. score is null pending a full judged bench, so it is set via ASK_CHAIN_PRO rather than the in-repo default.",
  },
  "gpt-oss:120b-cloud": {
    display: "GPT-OSS 120B",
    provider: "ollama", tier: "pro", score: null, ttftP50Ms: 6497,
    efforts: null,
    note: "GPT-OSS 120B via the Ollama cloud tag — FREE, loopback. Benched 2026-08-27: fastest of the pro candidates (6.5s ttft, very consistent), longest answers (2260 chars avg), follow-up marker 4/4. Not routed by default; the standing alternate if GLM 5.3 Flash's first-token latency proves too slow in production.",
  },
  "deepseek-v4-pro:cloud": {
    display: "DeepSeek Pro",
    provider: "ollama", tier: "pro", score: null, ttftP50Ms: 10661,
    efforts: null,
    note: "DeepSeek V4 Pro via the Ollama cloud tag — FREE, loopback. Benched 2026-08-27: 10.7s ttft, shortest answers of the pro candidates (1323 chars), follow-up marker 3/4. Beaten by both GLM 5.3 Flash and GPT-OSS 120B; kept visible so it is not re-tested expecting better.",
  },
  "mimo-v2.5-free": {
    display: "Mimo V2.5",
    provider: "opencode", tier: "pro", score: null, ttftP50Ms: 4800,
    efforts: null,
    note: "Mimo V2.5 via the OpenCode Zen gateway — FREE. Offered in the picker.",
  },
  "muse-spark-1.2-contributor-free": {
    display: "Muse Spark",
    provider: "opencode", tier: "flash", score: null, ttftP50Ms: 2200,
    efforts: null,
    note: "Muse Spark 1.2 via the OpenCode Zen gateway — FREE. The gateway 500s intermittently; the chain falls through when it does.",
  },
  "ox-alpha-free": {
    display: "Ox Alpha",
    provider: "opencodego", tier: "deep", score: null, ttftP50Ms: 3200,
    efforts: null,
    note: "Ox Alpha via the OpenCode 'go' gateway — FREE. Best-grounding preview model, restored here after the OpenRouter key was rotated.",
  },
  "nemotron-3-ultra:cloud": {
    display: "Nemotron Ultra",
    provider: "ollama", tier: "pro", score: null, ttftP50Ms: 2000,
    efforts: null,
    note: "Nemotron 3 Ultra via the local Ollama cloud tag — FREE. Stronger reasoning than DeepSeek Flash; offered in the picker.",
  },
  "deepseek-v4-flash": {
    display: "DeepSeek Flash",
    provider: "deepseek", tier: "flash", score: 80.8, ttftP50Ms: 1072,
    efforts: ["none", "medium"],
    note: "Fastest first token by a wide margin and never failed a request. Weakest grounding of the working set. The reliable PAID last-resort behind the free Ollama route.",
  },
  "deepseek-v4-pro": {
    display: "DeepSeek Pro",
    provider: "deepseek", tier: "pro", score: 70.4, ttftP50Ms: 1484,
    efforts: ["none", "medium"],
    note: "Emitted the follow-up marker on only 1 of 5 answers, so the suggestion chips mostly go missing.",
  },
};

// Benched, then excluded. Kept visible so the next person does not re-test them
// expecting a different answer.
const EXCLUDED = {
  "z-ai/glm-5.2:free": "0 of 5 requests succeeded — provider returned 429 through three backed-off retries. Note the Ollama cloud tag glm-5.3-flash:cloud is a different route to a newer model and DOES work; this exclusion is about the OpenRouter free lane only.",
  "google/gemma-4-31b-it:free": "0 of 5 requests succeeded — provider returned 429 through three backed-off retries.",
  "qwen3-coder:480b-cloud": "HTTP 410 Gone on all 4 attempts 2026-08-27 — the Ollama cloud tag has been withdrawn. Kept here as the reminder that :cloud tags can vanish without notice, which is why every chain that leads with one needs a fallback behind it.",
};

// Three tiers.
//
//   flash  DeepSeek Flash      everyday lookups. The proven built-in default;
//                              Nemotron Ultra backs it up. Production overrides
//                              this via ASK_CHAIN_FLASH to lead with Gemini 3.6
//                              Flash (Google free-tier API, 1M context, low
//                              reasoning effort, ~3s first token, best grounding
//                              of the tested set) and fall back to DeepSeek Flash.
//                              Gemini is kept out of the in-repo default until it
//                              carries a full bench score — the router test
//                              requires every default-chain model to be scored.
//   pro    Nemotron Ultra      best measured grounding and usefulness of the free set
//   deep   Ox Alpha            visualization requests and deep-reasoning answers
//
// The deep tier keeps one free step (Ultra) before the paid fallback: Ox Alpha is
// a preview slug that can vanish, and dropping straight to Flash would take
// judged grounding from 4.2 to 3.2 on exactly the questions that need it most.
// Verified free endpoints, in fallback order: every chain (including a
// player-pinned model) degrades through ALL of these before the paid backstop.
// llm.js cooldowns make the rotation dynamic: a rate-limited endpoint is benched
// for 60s and requests route around it automatically.
const FREE_POOL = (process.env.ASK_FREE_POOL ||
  "minimax/minimax-m3-free,deepseek-v4-flash:cloud,gemini-3.7-flash,mimo-v2.5-free")
  .split(",").map(s => s.trim()).filter(Boolean);

// The paid model every chain ends on.
const PAID_BACKSTOP = "deepseek-v4-flash";

/** lead -> full chain: lead, then the rest of the free pool, then paid. */
function chainFrom(lead) {
  return [lead, ...FREE_POOL.filter(m => m !== lead), PAID_BACKSTOP];
}

const CHAINS = {
  flash: (process.env.ASK_CHAIN_FLASH || "deepseek-v4-flash,nvidia/nemotron-3-ultra-550b-a55b:free").split(",").map(s => s.trim()).filter(Boolean),
  pro: (process.env.ASK_CHAIN_PRO || "nvidia/nemotron-3-ultra-550b-a55b:free,deepseek-v4-flash").split(",").map(s => s.trim()).filter(Boolean),
  deep: (process.env.ASK_CHAIN_DEEP || "stealth/ox-alpha,nvidia/nemotron-3-ultra-550b-a55b:free,deepseek-v4-flash").split(",").map(s => s.trim()).filter(Boolean),
};

// What to ask each tier for. Models publish different reasoning vocabularies and
// reject the rest, so this is the wanted rung and effortFor() maps it per model.
const EFFORT = { flash: "none", pro: "medium", deep: "high" };

// Each model publishes its own reasoning vocabulary and rejects the rest, so ask
// for the nearest rung to what the tier wants instead of a fixed string.
const LADDER = ["none", "minimal", "low", "medium", "high", "max", "xhigh"];
function effortFor(id, want) {
  const efforts = CATALOG[id]?.efforts;
  if (!efforts || !efforts.length) return null;
  if (efforts.includes(want)) return want;
  const wi = LADDER.indexOf(want);
  let best = null, bestDistance = Infinity;
  for (const e of efforts) {
    const d = Math.abs(LADDER.indexOf(e) - wi);
    if (d < bestDistance) { bestDistance = d; best = e; }
  }
  return best;
}

// Names retired from the catalog still appear in stored history, so they need a
// readable name too rather than falling back to a raw slug in the UI.
const RETIRED = {
  "deepseek-v3-flash": "DeepSeek Flash",
  "discord-ask": "Discord",
};

// The model picker was removed 2026-08-27: every request rides the tier chain
// (free pool rotation + paid backstop). Auto is the only behavior.

const PROVIDER_HOME = { deepseek: "https://www.deepseek.com", openrouter: "https://openrouter.ai", google: "https://ai.google.dev", commandcode: "https://commandcode.ai" };

/** Where a player can read about the model that answered them. */
function urlFor(id) {
  const entry = CATALOG[String(id || "")];
  if (!entry) return null;
  if (entry.provider === "openrouter") return `https://openrouter.ai/${id}`;
  return PROVIDER_HOME[entry.provider] || null;
}

/** id -> model page, as a plain map for the client. */
function urlMap() {
  const out = {};
  for (const id of Object.keys(CATALOG)) {
    const url = urlFor(id);
    if (url) out[id] = url;
  }
  return out;
}

/** Short human name for a stored model id. Never returns a raw vendor slug. */
function displayFor(id) {
  const s = String(id || "");
  if (CATALOG[s]) return CATALOG[s].display;
  if (RETIRED[s]) return RETIRED[s];
  if (!s) return "";
  // Unknown id: strip the vendor prefix and the :free suffix so the chip stays
  // readable if a chain is pointed at something not yet benched.
  const bare = s.split("/").pop().replace(/:free$/, "").replace(/[-_]/g, " ");
  return bare.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 24);
}

/** Every id the UI might have to name, as a plain id -> name map for the client. */
function displayMap() {
  const out = {};
  for (const [id, e] of Object.entries(CATALOG)) out[id] = e.display;
  for (const [id, name] of Object.entries(RETIRED)) out[id] = name;
  return out;
}

/** Provider for a stored model id, for cost/usage grouping in the console. */
function providerOf(id) {
  const s = String(id || "");
  if (CATALOG[s]) return CATALOG[s].provider;
  if (/:free$/.test(s) || s.startsWith("stealth/")) return "openrouter";
  if (/^gemini|google/i.test(s)) return "google";
  if (/:cloud$/.test(s)) return "ollama";
  if (/^ox-alpha/i.test(s)) return "opencodego";
  if (/^minimax/i.test(s)) return "commandcode";
  if (/-free$/.test(s) || /^(mimo|muse-spark|hy3|laguna|nemotron-3)/i.test(s)) return "opencode";
  if (s === "discord-ask") return "discord";
  return s.includes("/") ? "openrouter" : "deepseek";
}

/** Display tier for a stored model id, including ids retired from the catalog. */
function tierOf(id) {
  const s = String(id || "");
  if (CATALOG[s]) return CATALOG[s].tier;
  // Pre-catalog rows only ever came from the two DeepSeek ids.
  return /pro/i.test(s) ? "pro" : "flash";
}

const TIER_LABELS = { flash: "Flash", pro: "Pro", deep: "Deep" };

/** Every id the UI might have to tier, as a plain id -> label map for the client. */
function tierMap() {
  const out = {};
  for (const id of Object.keys(CATALOG)) out[id] = TIER_LABELS[tierOf(id)];
  for (const id of Object.keys(RETIRED)) out[id] = TIER_LABELS[tierOf(id)];
  return out;
}

module.exports = { CATALOG, EXCLUDED, CHAINS, EFFORT, TIER_LABELS, FREE_POOL, PAID_BACKSTOP, chainFrom, effortFor, tierOf, providerOf, displayFor, displayMap, tierMap, urlFor, urlMap };
