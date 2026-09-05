"use strict";

// Weekly ops digest: the serving-health rollup posted where it gets read.
// Runs from ask-digest.timer as a oneshot; everything here is read-only
// except the single Discord post. Exits nonzero on failure so a broken
// digest shows up in systemd instead of silently not arriving.
//
// The numbers come from /console/health.json (same rollup the console
// renders), so the digest can never disagree with what staff see there.

const opsDiscord = require("../ops-discord");

const ASK_ORIGIN = process.env.ASK_INTERNAL_ORIGIN || "http://127.0.0.1:9749";
const ASK_SECRET = process.env.ASK_SECRET || "";
const DISCORD_MCP = process.env.DISCORD_MCP_URL || "http://127.0.0.1:9727/mcp";
const MCP_TOKEN = process.env.MCP_TOKEN || "";
const CHANNEL = process.env.ASK_DIGEST_CHANNEL || "operations";

function ms(v) { return v == null ? "n/a" : `${(v / 1000).toFixed(1)}s`; }
function num(v, places = 2) { return v == null || !Number.isFinite(Number(v)) ? "n/a" : Number(v).toFixed(places); }
function pct(v) { return v == null || !Number.isFinite(Number(v)) ? "n/a" : `${Math.round(Number(v) * 100)}%`; }

async function fetchHealth() {
  const r = await fetch(`${ASK_ORIGIN}/console/health.json?days=7`, {
    headers: { Authorization: `Bearer ${ASK_SECRET}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`health.json ${r.status}`);
  return r.json();
}

function format(h) {
  const lines = [];
  lines.push("**Ask weekly digest** (last 7 days)");
  const aud = h.audience;
  if (aud) {
    const split = Object.entries(aud.byProvider || {}).map(([p, n]) => `${n} ${p}`).join(", ");
    const move = aud.previousActive ? ` (${aud.active - aud.previousActive >= 0 ? "+" : ""}${aud.active - aud.previousActive} vs previous week)` : "";
    lines.push(`Active users: **${aud.active}**${move}${split ? ` · ${split}` : ""} · ${aud.activeToday} today · ${aud.newUsers} new`);
    lines.push(`Questions: ${aud.questionsPerDay}/day`);
  }
  lines.push(`Answers: ${h.answers.total} (${h.answers.live} live) · verdicts ${h.answers.up} up / ${h.answers.down} down`);
  const a = h.audits || {};
  lines.push(`QA sampler: ${a.total || 0} graded, ${a.not_answered || 0} judged unanswered, ${a.refused || 0} refusals`);
  const c = h.corrections || {};
  lines.push(`Corrections: ${c.active || 0} active, **${c.draftsPending || 0} drafts waiting for review**`);
  for (const d of (c.drafts || []).slice(0, 3)) {
    lines.push(`· draft #${d.id}: "${String(d.question || "").slice(0, 90)}"${d.proposed ? " (proposal ready)" : ""}`);
  }
  // Retrieval confidence, recorded on every answer: the one signal dense
  // enough to move week to week at this traffic level.
  const r = h.retrieval;
  if (r && r.n) {
    lines.push(`Retrieval confidence (${r.n} answers): top hit p50 ${num(r.top1.p50)} (p10 ${num(r.top1.p10)}) · gap to fifth p50 ${num(r.gap15.p50)} · ${r.nHits.p50 ?? "n/a"} chunks · budget used p50 ${pct(r.budgetUsed.p50)}`);
  }
  // One line per failure bucket that had anything in it.
  const t = h.taxonomy;
  if (t && t.total) {
    lines.push(`Failures by bucket (${t.total} flagged or reported, ${t.unknown} unplaced):`);
    for (const [name, b] of Object.entries(t.buckets || {})) {
      if (!b.count || name === "unknown") continue;
      const example = (b.examples || [])[0];
      lines.push(`· ${name} ×${b.count}${b.downvoted ? ` (${b.downvoted} reported)` : ""}${example ? `: "${String(example).slice(0, 70)}"` : ""}`);
    }
  }
  // Judge calibration: does the automated verdict agree with the humans?
  const k = h.calibration;
  if (k && k.n) {
    const m = k.matrix || {};
    const prev = (k.history || []).find(row => row.kappa != null && row.since !== k.since);
    lines.push(`Judge vs humans: kappa ${num(k.kappa)} over ${k.n} answers (rated only ${num(k.kappaRated)} over ${k.nRated}) · caught ${m.flaggedAndReported || 0} of ${(m.flaggedAndReported || 0) + (m.cleanButReported || 0)} reports · ${m.flaggedNotReported || 0} flags unconfirmed${prev ? ` · ${prev.week} was ${num(prev.kappa)}` : ""}`);
  }
  if (h.embedding && h.embedding.ok === false) {
    lines.push(`**EMBEDDING DEAD** (${h.embedding.error || "unknown"}): vector retrieval degraded to keyword-only`);
  }
  if (h.docConflictsOpen) {
    lines.push(`**Doc conflicts open: ${h.docConflictsOpen}** (wiki/docs contradicting the code)`);
    for (const conflict of (h.docConflicts || []).slice(0, 3)) {
      lines.push(`· [${conflict.source}${conflict.page ? ` ${conflict.page}` : ""}] says "${conflict.claim}" but code says "${conflict.actual}" (seen ×${conflict.seen})`);
    }
  }
  const issues = (h.issues || []).slice(0, 4).map(i => `${i.issue} ×${i.n}`).join(", ");
  if (issues) lines.push(`Guard trips: ${issues}`);
  const misses = (h.retrievalMisses || []).slice(0, 5);
  if (misses.length) {
    lines.push("Retrieval misses (files answers needed but never got), by priority:");
    for (const m of misses) {
      lines.push(`· \`${m.path}\` ×${m.misses}${m.downvotes ? `, ${m.downvotes} reported` : ""}${m.meanCoverage != null ? `, coverage ${num(m.meanCoverage)}` : ""}${m.priority != null ? `, priority ${num(m.priority, 1)}` : ""}`);
    }
  }
  const models = (h.models || []).filter(m => m.sampled > 0).slice(0, 4);
  if (models.length) {
    lines.push("Serving (models with latency telemetry):");
    for (const m of models) {
      lines.push(`· ${m.model}: ${m.served} answers, first token p50 ${ms(m.ttftP50)} / p90 ${ms(m.ttftP90)}${m.viaFallthrough ? `, ${m.viaFallthrough} via fall-through` : ""}${m.flagged ? `, ${m.flagged} guard-flagged` : ""}`);
    }
  }
  lines.push("Console: https://ask.lakesidegames.net/console");
  return lines.join("\n").slice(0, 1900);
}

async function post(content) {
  await opsDiscord.post(content, { url: DISCORD_MCP, token: MCP_TOKEN, channel: CHANNEL });
}

async function main() {
  const health = await fetchHealth();
  const body = format(health);
  if (process.argv.includes("--dry-run")) { console.log(body); return; }
  await post(body);
  console.log(`[digest] posted to #${CHANNEL} (${body.length} chars)`);
}

if (require.main === module) {
  main().catch(e => { console.error("[digest] failed:", e.message); process.exit(1); });
}

module.exports = { format, fetchHealth, post };
