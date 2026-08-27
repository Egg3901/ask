// Turn the model's prose into linked sources — WHEN APPLICABLE.
//
// Three source classes, in descending authority:
//   code  -> github.com/Egg3901/AHDGame  (what the game actually does)
//   docs  -> docs.lakesidegames.net      (written reference)
//   wiki  -> in-game /wiki/<slug>        (player-maintained, may lag)
//
// Nothing is invented: a citation is only emitted when the path exists in the
// indexed tree, or the docs/wiki slug exists in a real index. A confident link
// to a 404 is worse than no link.
const fs = require("node:fs");
const path = require("node:path");

const REPO_DIR = process.env.RAG_REPO || "/root/projects/LSGD-ops-dash/ahd-sandbox";
const GH = process.env.GITHUB_BASE || "https://github.com/Egg3901/AHDGame/blob";
const GH_REF = process.env.GITHUB_REF || "main";
const DOCS_ROOT = process.env.DOCS_ROOT || "/srv/lakeside-docs";
const DOCS_BASE = process.env.DOCS_BASE || "https://docs.lakesidegames.net";
const WIKI_BASE = process.env.WIKI_BASE || "https://www.ahousedividedgame.com/wiki";

// src/... or a bare filename with a code-ish extension, optionally :123
const PATH_RE = /\b((?:src|scripts|docs)\/[A-Za-z0-9_./[\]@-]+?\.(?:ts|tsx|js|jsx|json|md))(?::(\d+))?\b/g;

// The exported index uses short keys: h=href, t=title, k=kind, s=section,
// d=description, tx=full text. It carries BOTH the engineering docs and the
// player wiki (k:"wiki", s:"Player Wiki"), so one file serves both citation
// classes and every link is guaranteed to resolve to a page that exists.
let _docIndex = null;
let _docIndexAt = 0;
function docIndex() {
  if (_docIndex && Date.now() - _docIndexAt < 600000) return _docIndex;
  const out = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DOCS_ROOT, "search-index.json"), "utf8"));
    for (const it of raw.items || []) {
      const href = it.h; const title = it.t;
      if (!href || !title) continue;
      out.push({
        title,
        kind: it.k === "wiki" ? "wiki" : "docs",
        section: it.s || "",
        url: href.startsWith("http") ? href : DOCS_BASE + (href.startsWith("/") ? "" : "/") + href,
        desc: String(it.d || it.hd || "").trim(),
        hay: `${title} ${it.hd || ""} ${it.d || ""}`.toLowerCase(),
      });
    }
  } catch { /* index is optional; absence just means no doc/wiki citations */ }
  _docIndex = out; _docIndexAt = Date.now();
  return _docIndex;
}

// Terms too generic to underline usefully (they would mark half an answer).
const JARGON_STOP = new Set(["news", "mail", "home", "overview", "getting started", "strategy guides",
  "faq", "glossary", "wiki", "changelog", "index", "guide", "guides", "tips", "help", "about", "tutorial",
  "walkthrough", "reference", "introduction", "basics", "core systems"]);

/**
 * A glossary for inline jargon annotation: one entry per doc/wiki page whose
 * title reads like a term, with a short blurb and the source link. Built from
 * the same index the citations use, so every link resolves.
 */
function glossary() {
  const byTerm = new Map();
  for (const p of docIndex()) {
    const term = String(p.title || "").trim();
    const key = term.toLowerCase();
    if (term.length < 4 || term.length > 40 || JARGON_STOP.has(key) || byTerm.has(key)) continue;
    // Strip a leading repeat of the title, collapse whitespace, cap length.
    let blurb = p.desc.replace(/\s+/g, " ").trim();
    if (blurb.toLowerCase().startsWith(key)) blurb = blurb.slice(term.length).replace(/^[\s:.\-–]+/, "");
    blurb = blurb.slice(0, 180);
    if (blurb.length < 12) continue; // no useful explainer -> skip
    byTerm.set(key, { term, blurb, url: p.url, kind: p.kind });
  }
  return [...byTerm.values()];
}

/** Score a page against the question + answer by title and description overlap. */
function scorePage(p, needle) {
  const t = p.title.toLowerCase();
  if (t.length >= 5 && needle.includes(t)) return 3;          // title named outright
  const words = t.split(/\W+/).filter(w => w.length > 4);
  if (!words.length) return 0;
  const hits = words.filter(w => needle.includes(w)).length;
  return hits / words.length >= 0.6 ? 1 + hits / words.length : 0;
}

function fileExists(rel) {
  try { return fs.existsSync(path.join(REPO_DIR, rel)); } catch { return false; }
}

/**
 * Extract citations and rewrite in-text paths as links.
 * Returns { text, citations:[{kind,label,url}] }.
 */
function apply(answer, opts = {}) {
  const cites = [];
  const seen = new Set();
  const push = c => { const k = c.kind + c.url; if (!seen.has(k)) { seen.add(k); cites.push(c); } };

  // 1. Code paths the model cited — verified against the indexed tree.
  const text = String(answer || "").replace(PATH_RE, (m, rel, line) => {
    if (!fileExists(rel)) return m;                      // don't link a guess
    const url = `${GH}/${GH_REF}/${rel}${line ? `#L${line}` : ""}`;
    push({ kind: "code", label: rel.split("/").pop() + (line ? `:${line}` : ""), url, path: rel });
    return m;
  });

  // 2/3. Docs and wiki pages the answer actually discusses. Scored against the
  // question as well as the answer so a page is cited for being on-topic rather
  // than for sharing a common word. Applicability is the whole point: a question
  // with no matching page simply gets no doc citation.
  const needle = `${opts.question || ""} ${text}`.toLowerCase();
  const ranked = docIndex()
    .map(p => ({ p, score: scorePage(p, needle) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  let wiki = 0, docs = 0;
  for (const { p } of ranked) {
    if (p.kind === "wiki" && wiki >= 2) continue;
    if (p.kind === "docs" && docs >= 2) continue;
    push({ kind: p.kind, label: p.title, url: p.url, section: p.section });
    if (p.kind === "wiki") wiki++; else docs++;
    if (wiki + docs >= 4) break;
  }

  return { text, citations: cites.slice(0, 8) };
}

/** Map indexed file paths to friendly player-facing areas. */
const AREAS = [
  [/\/(elections?|primary|ballot|vote|voting|turnout)/i, "Elections & voting"],
  [/\/(legislat|bill|senate|house|committee|filibuster|cloture)/i, "Legislature"],
  [/\/(corporation|corp|sector|market|commodity|trade|share)/i, "Business & markets"],
  [/\/(econom|inflation|tax|budget|treasury|bank|forex|bond)/i, "Economy"],
  [/\/(military|defence|defense|war|army|procurement)/i, "Military"],
  [/\/(part(y|ies)|coalition|campaign|fundrais|endorse)/i, "Parties & campaigning"],
  [/\/(cabinet|executive|president|governor|minister|prime)/i, "Government & cabinet"],
  [/\/(character|profile|account|player|stats)/i, "Characters & accounts"],
];
function areasFor(files) {
  const out = [];
  for (const f of files || []) {
    const hit = AREAS.find(([re]) => re.test(f));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
    if (out.length >= 4) break;
  }
  return out;
}

module.exports = { apply, areasFor, docIndex, glossary };
