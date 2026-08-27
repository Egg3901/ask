// Public changelog: parses CHANGELOG.md into structured releases so the same
// source drives both the sidebar version chip and the /changelog page. No
// build step — the markdown file is the single source of truth.
"use strict";

const fs = require("fs");
const path = require("path");

const VERSION = require("./package.json").version;
const FILE = path.join(__dirname, "CHANGELOG.md");

// Parse the "## x.y.z — date" headings and their "### Section" / "- item"
// bodies. Kept deliberately small; the file format is our own convention.
function parse(md) {
  const releases = [];
  let release = null, section = null;
  for (const raw of String(md).split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const rel = line.match(/^##\s+(\S+)\s*[—–-]\s*(.+)$/);
    if (rel) { release = { version: rel[1], date: rel[2].trim(), sections: [] }; releases.push(release); section = null; continue; }
    if (!release) continue;
    const sec = line.match(/^###\s+(.+)$/);
    if (sec) { section = { title: sec[1].trim(), items: [] }; release.sections.push(section); continue; }
    const item = line.match(/^-\s+(.+)$/);
    if (item) {
      if (!section) { section = { title: "", items: [] }; release.sections.push(section); }
      section.items.push(item[1].trim());
    }
  }
  return releases;
}

let cache = null;
function releases() {
  if (cache) return cache;
  try { cache = parse(fs.readFileSync(FILE, "utf8")); }
  catch { cache = []; }
  return cache;
}

module.exports = { VERSION, releases };
