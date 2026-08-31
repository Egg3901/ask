#!/usr/bin/env node
// Pull downvoted and guard-flagged production answers into a local curation
// file. Each entry is a replay-case CANDIDATE: it carries the question, what
// went wrong, and the observed plan, but not the expected behavior, which by
// definition is what the failed answer did not do. Curate the good ones into
// eval/reported-failures.json (anonymized) and delete the file.
//
// Usage: ASK_SECRET=... node scripts/pull-replay-cases.mjs [days]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = process.env.ASK_INTERNAL_ORIGIN || "https://ask.lakesidegames.net";
const SECRET = process.env.ASK_SECRET || "";
const DAYS = Math.min(Math.max(parseInt(process.argv[2] || "14", 10) || 14, 1), 90);
if (!SECRET) { console.error("ASK_SECRET required"); process.exit(1); }

const response = await fetch(`${ORIGIN}/console/replay.json?days=${DAYS}`, {
  headers: { Authorization: `Bearer ${SECRET}` },
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) { console.error(`replay.json ${response.status}`); process.exit(1); }
const { candidates } = await response.json();

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "eval", "replay-candidates-pulled.json");
fs.writeFileSync(outPath, JSON.stringify(candidates, null, 2) + "\n");
console.log(`[replay] wrote ${candidates.length} candidate(s) from the last ${DAYS} days to ${outPath}`);
for (const candidate of candidates.slice(0, 10)) {
  console.log(`· ${candidate.rating === "down" ? "DOWNVOTE" : candidate.issues.join(",") || "flagged"}: ${candidate.question.slice(0, 90)}`);
}
