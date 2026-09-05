#!/usr/bin/env node
// Weekly judge calibration. Cross-tabulates the automated grounding verdict
// (guard trips, grounding notes, invented paths, low attribution coverage)
// against the human one (a player downvote or a staff "bad") over the window,
// prints the confusion matrix and Cohen's kappa, and stores the week's value
// in the calibration table so drift is a series rather than a memory.
//
//   node scripts/judge-calibration.mjs [--days=7] [--dry-run]
//
// Reads the same database the server does (ASK_DB_PATH). Read-only apart
// from the one calibration row, which --dry-run skips.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("../store");
const { weekOf } = require("../judge-calibration");

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1];
const days = Math.min(Math.max(Number(arg("days")) || 7, 1), 90);
const since = Date.now() - days * 864e5;

function table(m) {
  const w = 12;
  const cell = v => String(v ?? 0).padStart(w);
  return [
    `${"".padEnd(18)}${"human: bad".padStart(w)}${"human: ok".padStart(w)}`,
    `${"judge: flagged".padEnd(18)}${cell(m.flaggedAndReported)}${cell(m.flaggedNotReported)}`,
    `${"judge: clean".padEnd(18)}${cell(m.cleanButReported)}${cell(m.cleanNotReported)}`,
  ].join("\n");
}

try {
  const result = store.judgeCalibration(since);
  const week = weekOf();
  console.log(`Judge calibration, last ${days} day(s), ISO week ${week}`);
  console.log(`Answers: ${result.n} (${result.nRated} carry a human verdict)`);
  console.log("");
  console.log("All answers (unrated counts as human: ok)");
  console.log(table(result.matrix));
  console.log(`kappa ${result.kappa ?? "n/a"} · recall of reports ${result.recall ?? "n/a"} · precision of flags ${result.precision ?? "n/a"}`);
  console.log("");
  console.log("Rated answers only");
  console.log(table(result.matrixRated));
  console.log(`kappa ${result.kappaRated ?? "n/a"}`);
  const history = store.calibrationHistory(8).filter(row => row.week !== week);
  if (history.length) {
    console.log("");
    console.log("Previous weeks: " + history.map(row => `${row.week} ${row.kappa ?? "n/a"} (n=${row.n})`).join(", "));
  }
  if (process.argv.includes("--dry-run")) {
    console.log("\n(dry run, nothing stored)");
  } else {
    store.saveCalibration(result, { week });
    console.log(`\nStored as calibration week ${week}`);
  }
} finally {
  store.db.close();
}
