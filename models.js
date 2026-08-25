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
  "deepseek-v4-flash": {
    display: "DeepSeek Flash",
    provider: "deepseek", tier: "flash", score: 80.8, ttftP50Ms: 1072,
    efforts: ["none", "medium"],
    note: "Fastest first token by a wide margin and never failed a request. Weakest grounding of the working set.",
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
  "z-ai/glm-5.2:free": "0 of 5 requests succeeded — provider returned 429 through three backed-off retries.",
  "google/gemma-4-31b-it:free": "0 of 5 requests succeeded — provider returned 429 through three backed-off retries.",
};

// Three tiers.
//
//   flash  DeepSeek Flash      everyday lookups. Led here by Nemotron Lightning
//                              until 2026-08-23, but free capacity made the
//                              everyday tier the slowest (25-58s to first token
//                              vs a steady ~850ms), so the paid model leads and
//                              the best free model backs it up.
//   pro    Nemotron Ultra      best measured grounding and usefulness of the free set
//   deep   Ox Alpha            visualization requests and deep-reasoning answers
//
// The deep tier keeps one free step (Ultra) before the paid fallback: Ox Alpha is
// a preview slug that can vanish, and dropping straight to Flash would take
// judged grounding from 4.2 to 3.2 on exactly the questions that need it most.
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

const PROVIDER_HOME = { deepseek: "https://www.deepseek.com", openrouter: "https://openrouter.ai" };

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

module.exports = { CATALOG, EXCLUDED, CHAINS, EFFORT, TIER_LABELS, effortFor, tierOf, displayFor, displayMap, tierMap, urlFor, urlMap };
