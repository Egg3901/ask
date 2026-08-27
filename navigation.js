"use strict";

// A navigation evidence class.
//
// Ask cites .tsx paths but had no model of the game's actual UI, so questions
// like "where do I find these buttons", "which category is that bill in" and
// "where in the UI" were answered by guessing: "it might say something like
// State Redistricting Authority Law", "it's a dropdown or button group". Seven
// answers in the corpus audit invented navigation, and a player followed one
// through four turns without ever finding the screen.
//
// Semantic retrieval cannot fix this on its own. The nav definitions are spread
// over ~30 single-chunk files, so a question phrased in player language ("where
// is the redistricting bill") does not reliably pull the file that holds the
// answer. Instead we precompute one compact label -> route map from the nav
// sources and inject it verbatim when a question is navigational.
//
// Read-only, built from the same prod checkout the retrieval index is built
// from, and refreshed on the same cadence.

const fs = require("node:fs");
const path = require("node:path");

const REPO = process.env.ASK_GAME_CHECKOUT || "/root/projects/LSGD-ops-dash/ahd-sandbox";
const TTL_MS = Number(process.env.ASK_NAV_TTL_MS || 900000); // 15 min, matches the reindex timer

// Files that declare player-facing navigation entries.
const NAV_SOURCES = [
  "src/components/navbar/experimentalNavMenus.ts",
  "src/components/navbar/worldNavItems.ts",
  "src/components/navbar/profileNavItems.ts",
  "src/components/navbar/staffNavItems.ts",
  "src/components/navbar/nationDetailsSections.ts",
  "src/components/nav/SuperTabNav.tsx",
];

// A question is navigational when the player is asking WHERE something is
// rather than how it works. These are the shapes that failed in the audit.
const NAV_QUESTION = /\b(?:where(?:'s| is| are| do| can| would)?\b|how (?:do|can) i (?:find|get to|open|reach|access|set|change|update|edit|submit|propose)|which (?:tab|page|screen|menu|category|section)|what (?:tab|page|screen|menu|category|section)|i (?:can'?t|cannot|don'?t) (?:find|see)|i see no\b|there'?s no\b|navigate to|in the ui\b|on (?:which|what) (?:page|screen|tab))/i;

function isNavigationQuestion(question) {
  return NAV_QUESTION.test(String(question || ""));
}

// `label: "House of Representatives", ... href: "/congress"` across a few
// formatting styles. Deliberately simple: this reads declarative config, and a
// pair it cannot parse is simply absent rather than wrong.
const ENTRY = /label:\s*["'`]([^"'`]{2,60})["'`][\s\S]{0,220}?href:\s*["'`]([^"'`]{1,120})["'`]/g;
const REVERSED = /href:\s*["'`]([^"'`]{1,120})["'`][\s\S]{0,220}?label:\s*["'`]([^"'`]{2,60})["'`]/g;

// Routes are built with template literals, e.g. /corporation/ plus an
// interpolated id. Showing that raw to a player is worse than showing nothing,
// so interpolations become a readable placeholder.
function readableHref(href) {
  return String(href).replace(/\$\{[^}]*\}/g, ":id").trim();
}

function extract(text) {
  const found = new Map();
  const add = (label, href) => {
    const clean = readableHref(href);
    if (!clean.startsWith("/")) return;   // computed or relative paths help nobody
    found.set(`${label} ${clean}`, { label: String(label).trim(), href: clean });
  };
  let m;
  ENTRY.lastIndex = 0;
  while ((m = ENTRY.exec(text))) add(m[1], m[2]);
  REVERSED.lastIndex = 0;
  while ((m = REVERSED.exec(text))) add(m[2], m[1]);
  return [...found.values()];
}

// Top-level app routes, so "where is X" can be answered for a page that has no
// nav entry. API routes and dynamic segments are not player-visible navigation.
function topLevelRoutes(root) {
  const appDir = path.join(root, "src/app");
  let names = [];
  try { names = fs.readdirSync(appDir, { withFileTypes: true }); } catch { return []; }
  return names
    .filter(d => d.isDirectory() && d.name !== "api" && !d.name.startsWith("[") && !d.name.startsWith("_") && !d.name.startsWith("("))
    .filter(d => fs.existsSync(path.join(appDir, d.name, "page.tsx")))
    .map(d => `/${d.name}`)
    .sort();
}

let cache = null;
let cachedAt = 0;

/** Build (or return cached) navigation map. Never throws; returns null if unbuildable. */
function map() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const entries = new Map();
  for (const rel of NAV_SOURCES) {
    let text = "";
    try { text = fs.readFileSync(path.join(REPO, rel), "utf8"); } catch { continue; }
    for (const e of extract(text)) {
      // Keep the first spelling of a label; later files are more specialised.
      if (!entries.has(e.label)) entries.set(e.label, e.href);
    }
  }
  const routes = topLevelRoutes(REPO);
  if (!entries.size && !routes.length) return null;
  cache = { entries: [...entries].map(([label, href]) => ({ label, href })), routes, builtAt: Date.now() };
  cachedAt = Date.now();
  return cache;
}

/**
 * Prompt-ready navigation evidence, or "" when the question is not navigational
 * or the map could not be built. Injected alongside retrieved source.
 */
function block(question) {
  if (!isNavigationQuestion(question)) return "";
  const built = map();
  if (!built) return "";
  const items = built.entries.map(e => `  ${e.label} -> ${e.href}`).join("\n");
  return `GAME NAVIGATION (the real menu labels and routes, read from the running build — use these exact player-facing names)
${items}

Other top-level pages: ${built.routes.join(", ")}

Answer a "where do I find X" question from this list and nothing else. Use the exact label as written here.
If what the player wants is not in this list, say plainly that you cannot see where it lives in the UI
and name the closest page above. Never guess at a menu name, never say a label "might say something
like", and never describe a control you cannot see here.`;
}

module.exports = { block, map, isNavigationQuestion, extract };
