"use strict";

// Watchlists: "tell me when X" over public game state. The companion's
// initiative feature: players stop refreshing pages to catch windows.
//
// v1 deliberately ships with zero UI and zero proactive delivery. Watches are
// created, listed, and deleted conversationally through deterministic parsers
// (no model call, no quota), a bounded in-process checker polls the same
// public read-only tools every answer already uses, and fired events are
// delivered as a section prepended to the player's NEXT answer. Discord DM
// delivery can bolt on later without touching this core.
//
// Fair play: every kind reads public state only (fx rates, the public war
// record, the public bill list). Nothing here can watch another player.

const MAX_WATCHES_PLAYER = 5;
const MAX_WATCHES_STAFF = 20;
const CHECK_CALL_BUDGET = 60;       // tool calls per checker tick, across all users

const COUNTRY_NAMES = {
  us: "US", usa: "US", america: "US", "united states": "US",
  uk: "UK", britain: "UK", "united kingdom": "UK",
  ussr: "RU", russia: "RU", "soviet union": "RU",
  "east germany": "DD", ddr: "DD", "west germany": "WG",
  france: "FR", poland: "PL", japan: "JP", china: "CN",
};

function countryFrom(text) {
  const lower = String(text || "").toLowerCase();
  for (const [name, id] of Object.entries(COUNTRY_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return id;
  }
  const code = String(text || "").match(/\b([A-Z]{2})\b/);
  return code ? code[1] : null;
}

const CREATE_RE = /\b(?:watch|alert me|notify me|tell me|let me know|ping me)\b[\s\S]{0,80}\b(?:when|if|once)\b|\b(?:set|create|add)\b[\s\S]{0,20}\b(?:a\s+)?watch\b/i;
const LIST_RE = /\b(?:my|list|show|view)\b[\s\S]{0,25}\bwatch(?:es|list)?\b|\bwhat am i watching\b|\bactive watches\b/i;
const DELETE_RE = /\b(?:stop|remove|delete|cancel|clear)\b[\s\S]{0,30}\bwatch(?:es|ing|list)?\b|\bstop watching\b/i;

const FX_PAIR_RE = /\b([A-Z]{3})\s*(?:\/|-|\s+(?:to|vs\.?|against)\s+)\s*([A-Z]{3})\b/;
const FX_DIR_RE = /\b(?:crosses?|goes?|rises?|climbs?|moves?)?\s*(?:above|over|past)\s*([0-9]+(?:\.[0-9]+)?)|\b(?:drops?|falls?|goes?|sinks?)?\s*(?:below|under)\s*([0-9]+(?:\.[0-9]+)?)/i;

/** Parse a watch command out of a question. Returns null when it is not one. */
function command(question) {
  const text = String(question || "").trim();
  if (LIST_RE.test(text) && !CREATE_RE.test(text)) return { action: "list" };
  if (DELETE_RE.test(text)) {
    const id = text.match(/#?\s*(\d{1,6})\b/);
    const all = /\b(?:all|every)\b/i.test(text);
    return { action: "delete", id: id ? Number(id[1]) : null, all };
  }
  if (!CREATE_RE.test(text)) return null;
  // "What should I watch out for when investing?" is a question, not a
  // subscription. Idiomatic "watch out" never creates or rejects.
  if (/\bwatch(?:ing)? out\b/i.test(text) && !/\b(?:alert me|notify me|ping me)\b/i.test(text)) return null;

  const pair = text.match(FX_PAIR_RE);
  if (pair) {
    const dir = text.match(FX_DIR_RE);
    if (!dir) return { action: "reject", reason: `An exchange-rate watch needs a threshold, like "watch ${pair[1]}/${pair[2]} and tell me when it crosses above 0.5".` };
    const above = dir[1] != null ? Number(dir[1]) : null;
    const below = dir[2] != null ? Number(dir[2]) : null;
    return { action: "create", kind: "fx", params: { base: pair[1], quote: pair[2], ...(above != null ? { above } : {}), ...(below != null ? { below } : {}) } };
  }
  if (/\b(?:wars?|battles?|conflicts?|invasions?|fronts?)\b/i.test(text)) {
    const country = countryFrom(text);
    return { action: "create", kind: "war", params: country ? { country } : {} };
  }
  if (/\b(?:bills?|legislation|laws?|floor votes?)\b/i.test(text)) {
    const country = countryFrom(text);
    if (!country) return { action: "reject", reason: 'A legislation watch needs a country, like "watch for new US bills".' };
    return { action: "create", kind: "legislation", params: { country } };
  }
  // No recognizable target. Only reply with the capability list when the
  // phrasing is unmistakably a subscription request; anything softer falls
  // through to the normal answer pipeline.
  if (/\b(?:alert me|notify me|ping me|let me know when|tell me when|(?:set|create|add)\b[\s\S]{0,20}\bwatch)\b/i.test(text)) {
    return { action: "reject", reason: 'I can watch exchange rates ("watch USD/GBP, tell me when it crosses above 0.5"), wars ("watch for new battles involving the US"), and legislation ("watch for new US bills").' };
  }
  return null;
}

function describe(watch) {
  const params = typeof watch.params === "string" ? JSON.parse(watch.params) : watch.params;
  if (watch.kind === "fx") {
    const bound = params.above != null ? `crosses above ${params.above}` : `drops below ${params.below}`;
    return `${params.base}/${params.quote} ${bound}`;
  }
  if (watch.kind === "war") return params.country ? `new war activity involving ${params.country}` : "new war activity anywhere";
  if (watch.kind === "legislation") return `new active bills in ${params.country}`;
  return watch.kind;
}

function renderList(watches) {
  if (!watches.length) return 'You have no active watches. Try "watch USD/GBP and tell me when it crosses above 0.5".';
  const lines = watches.map(w => `- **#${w.id}** ${describe(w)}${w.last_fired ? ` (last fired ${new Date(w.last_fired).toISOString().slice(0, 10)})` : ""}`);
  return `**Your watches** (checked about every 10 minutes; results arrive with your next answer):\n${lines.join("\n")}\n\nRemove one with "delete watch #id".`;
}

function renderEvents(events) {
  if (!events.length) return "";
  return `> **Your watches fired:**\n${events.map(e => `> - ${e.message}`).join("\n")}\n\n`;
}

// ── Checking ────────────────────────────────────────────────────────────────

async function checkFx(watch, params, state, call) {
  const quote = await call("fx_quote", { base: params.base, quote: params.quote, historyTurns: 2 }, 15000);
  const data = typeof quote === "string" ? JSON.parse(quote) : quote;
  const value = data?.current?.quotePerBase;
  if (typeof value !== "number") return { state };
  const previous = state.lastValue;
  const fired = [];
  if (previous != null) {
    if (params.above != null && previous < params.above && value >= params.above) {
      fired.push(`${params.base}/${params.quote} crossed above ${params.above}: now ${value.toFixed(4)}`);
    }
    if (params.below != null && previous > params.below && value <= params.below) {
      fired.push(`${params.base}/${params.quote} dropped below ${params.below}: now ${value.toFixed(4)}`);
    }
  }
  return { state: { lastValue: value }, fired };
}

async function checkWar(watch, params, state, call) {
  const raw = await call("wars", { status: "active", battles: 3 }, 20000);
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const wars = Array.isArray(data?.wars) ? data.wars : Array.isArray(data) ? data : [];
  const relevant = params.country
    ? wars.filter(w => JSON.stringify(w).toUpperCase().includes(String(params.country).toUpperCase()))
    : wars;
  const keys = [];
  for (const war of relevant) {
    const name = war.name || war.id || war.goal || "war";
    keys.push(`w:${name}`);
    for (const battle of war.battles || []) keys.push(`b:${name}:${battle.turn ?? battle.id ?? JSON.stringify(battle).slice(0, 40)}`);
  }
  const seen = new Set(state.keys || []);
  const fresh = keys.filter(k => !seen.has(k));
  const fired = [];
  // Only report once a baseline exists; the first check just learns the world.
  if (state.keys && fresh.length) {
    const newWars = fresh.filter(k => k.startsWith("w:")).length;
    const newBattles = fresh.filter(k => k.startsWith("b:")).length;
    const scope = params.country ? ` involving ${params.country}` : "";
    if (newWars) fired.push(`${newWars} new war${newWars === 1 ? "" : "s"}${scope} on the public record`);
    if (newBattles) fired.push(`${newBattles} new battle report${newBattles === 1 ? "" : "s"}${scope}`);
  }
  return { state: { keys: keys.slice(0, 400) }, fired };
}

async function checkLegislation(watch, params, state, call) {
  const raw = await call("legislation_catalog", { country: params.country, status: "active", limit: 30 }, 15000);
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const bills = Array.isArray(data?.bills) ? data.bills : [];
  const keys = bills.map(b => String(b.id ?? b.title ?? "").slice(0, 120)).filter(Boolean);
  const seen = new Set(state.keys || []);
  const fresh = bills.filter(b => !seen.has(String(b.id ?? b.title ?? "").slice(0, 120)));
  const fired = [];
  if (state.keys && fresh.length) {
    const named = fresh.slice(0, 3).map(b => `"${String(b.title || b.id).slice(0, 80)}"`).join(", ");
    fired.push(`${fresh.length} new active bill${fresh.length === 1 ? "" : "s"} in ${params.country}: ${named}`);
  }
  return { state: { keys: keys.slice(0, 200) }, fired };
}

const CHECKERS = { fx: checkFx, war: checkWar, legislation: checkLegislation };

/**
 * One checker tick over every active watch, bounded and fail-open per watch.
 * `store` provides activeWatches/updateWatchState/addWatchEvent; `call` is the
 * gamestate tool caller. Identical tool queries within a tick are deduped so
 * ten USD/GBP watches cost one call.
 */
async function checkAll({ store, call, log = () => {} }) {
  const active = store.activeWatches(CHECK_CALL_BUDGET);
  const cache = new Map();
  const cachedCall = (name, args, timeout) => {
    const key = name + JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, call(name, args, timeout));
    return cache.get(key);
  };
  let fired = 0;
  for (const watch of active) {
    try {
      const params = JSON.parse(watch.params || "{}");
      const state = JSON.parse(watch.state || "{}");
      const checker = CHECKERS[watch.kind];
      if (!checker) continue;
      const result = await checker(watch, params, state, cachedCall);
      store.updateWatchState(watch.id, JSON.stringify(result.state || {}), (result.fired || []).length > 0);
      for (const message of result.fired || []) {
        store.addWatchEvent(watch.id, watch.user_key, message);
        fired++;
      }
    } catch (e) {
      log(`[watch] check failed id=${watch.id} kind=${watch.kind}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  return { checked: active.length, fired };
}

module.exports = {
  command, describe, renderList, renderEvents, checkAll,
  MAX_WATCHES_PLAYER, MAX_WATCHES_STAFF,
};
