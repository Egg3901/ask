"use strict";

// The games Ask can answer about.
//
// A House Divided is the default and the only one with live data: it is the only
// multiplayer game with a running world, and the gamestate/engine MCPs are wired
// to that world specifically. Every other game is answered from its code and docs
// alone — there is no live state to read, and pretending otherwise would produce
// confident answers about a world that does not exist.
//
// Each game gets its own retrieval index rather than a shared one with a filter.
// A House Divided's index is 19k chunks and its whole vector matrix is held in
// memory for scoring; mixing a second game into that table would grow the hot
// path for the 95% of questions that never leave A House Divided.

const GAMES = [
  {
    id: "ahd",
    name: "A House Divided",
    short: "A House Divided",
    // How the answer model introduces itself and what it treats as its subject.
    subject: "a multiplayer political and economic strategy game",
    ragDb: process.env.RAG_DB || "/root/projects/LSGD-ops-dash/rag/index.db",
    live: true,
    // Only A House Divided has other players, a stock market and opponents, so
    // it is the only game the fair-play rules are meaningful for.
    multiplayer: true,
    // A representative source path, used to show the model how to cite a file in
    // THIS game's tree. A TypeScript path is wrong advice for a Rust codebase.
    pathExample: "src/lib/military/defenceLotEconomics.ts",
    // Where citations verify a cited path, and where they link it. A game with
    // no public repo gets githubBase null: the path is still named in the prose,
    // it just is not turned into a link nobody can open.
    repoDir: process.env.RAG_REPO || "/root/projects/LSGD-ops-dash/ahd-sandbox",
    githubBase: process.env.GITHUB_BASE || "https://github.com/Egg3901/AHDGame/blob",
    docsSubdir: "",
    site: "https://www.ahousedividedgame.com",
    docs: "https://docs.lakesidegames.net",
    // Words that make a question unambiguously about this game.
    hints: ["a house divided", "ahd", "ahousedivided"],
  },
  {
    id: "grand-century",
    name: "Grand Century",
    short: "Grand Century",
    subject: "a single-player browser grand strategy game set in the long nineteenth century, starting in 1820",
    ragDb: "/root/projects/LSGD-ops-dash/rag/index-grand-century.db",
    live: false,
    multiplayer: false,
    pathExample: "src/sim/economy.ts",
    repoDir: "/root/projects/grand-century",
    githubBase: null,
    docsSubdir: "g/grand-century",
    site: "https://lakesidegames.net/games/grand-century/",
    docs: "https://docs.lakesidegames.net/g/grand-century/",
    hints: ["grand century", "grandcentury", "1820", "long nineteenth century"],
  },
  {
    id: "metroforge",
    name: "MetroForge",
    short: "MetroForge",
    subject: "a native 3D transit builder about laying track, running services, and reshaping a city around the network",
    ragDb: "/root/projects/LSGD-ops-dash/rag/index-metroforge.db",
    live: false,
    multiplayer: false,
    pathExample: "crates/mf-sim/src/demand.rs",
    repoDir: "/root/projects/metroforge-native",
    githubBase: "https://github.com/Egg3901/metroforge-native/blob",
    docsSubdir: "g/metroforge",
    site: "https://lakesidegames.net/games/metroforge/",
    docs: "https://docs.lakesidegames.net/g/metroforge/",
    hints: ["metroforge", "metro forge", "transit builder"],
  },
  {
    id: "electioneer",
    name: "Electioneer",
    short: "Electioneer",
    subject: "a single-player, turn-based election campaign simulator covering 20 historical elections across six countries between 1974 and 2027",
    ragDb: "/root/projects/LSGD-ops-dash/rag/index-electioneer.db",
    live: false,
    multiplayer: false,
    pathExample: "src/lib/campaign/polling.ts",
    repoDir: "/root/projects/ahd-sim",
    githubBase: null,
    docsSubdir: "g/electioneer",
    site: "https://sim.ahousedividedgame.com",
    docs: "https://docs.lakesidegames.net/g/electioneer/",
    hints: ["electioneer", "ahd-sim", "campaign simulator"],
  },
];

const BY_ID = new Map(GAMES.map(g => [g.id, g]));
const DEFAULT_ID = "ahd";

/** The default game. Never returns undefined. */
const fallback = () => BY_ID.get(DEFAULT_ID);

/** Resolve an explicit game id from the client. Unknown ids fall back to AHD. */
function resolve(id) {
  return BY_ID.get(String(id || "").trim().toLowerCase()) || fallback();
}

/**
 * Infer the game from the question's wording.
 *
 * Deliberately conservative: it only fires on a name that belongs to exactly one
 * game, and returns null otherwise. "How does the economy work" is a question
 * about whichever game the player is currently looking at, and guessing at it
 * would answer confidently about the wrong one. The caller keeps the explicit
 * selection when this returns null.
 */
function detect(question) {
  const q = ` ${String(question || "").toLowerCase()} `;
  const matched = GAMES.filter(g => g.hints.some(h => q.includes(` ${h} `) || q.includes(` ${h},`) || q.includes(` ${h}?`) || q.includes(` ${h}.`)));
  return matched.length === 1 ? matched[0] : null;
}

/**
 * The game a question should be answered about.
 *
 * An explicit selection wins unless the question names a different game outright
 * — a player with the picker on A House Divided who asks "how does culture work
 * in Grand Century" means Grand Century.
 */
function forQuestion(question, selectedId) {
  const selected = resolve(selectedId);
  const named = detect(question);
  return named && named.id !== selected.id ? named : selected;
}

/** What the client needs to render the switcher. */
const publicList = () => GAMES.map(g => ({
  id: g.id, name: g.name, short: g.short, live: g.live, site: g.site, docs: g.docs,
}));

module.exports = { GAMES, DEFAULT_ID, resolve, detect, forQuestion, publicList, fallback };
