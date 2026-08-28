"use strict";

// Weekly ops digest: the serving-health rollup posted where it gets read.
// Runs from ask-digest.timer as a oneshot; everything here is read-only
// except the single Discord post. Exits nonzero on failure so a broken
// digest shows up in systemd instead of silently not arriving.
//
// The numbers come from /console/health.json (same rollup the console
// renders), so the digest can never disagree with what staff see there.

const ASK_ORIGIN = process.env.ASK_INTERNAL_ORIGIN || "http://127.0.0.1:9749";
const ASK_SECRET = process.env.ASK_SECRET || "";
const DISCORD_MCP = process.env.DISCORD_MCP_URL || "http://127.0.0.1:9727/mcp";
const MCP_TOKEN = process.env.MCP_TOKEN || "";
const CHANNEL = process.env.ASK_DIGEST_CHANNEL || "operations";

function ms(v) { return v == null ? "n/a" : `${(v / 1000).toFixed(1)}s`; }

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
  lines.push(`Answers: ${h.answers.total} (${h.answers.live} live) · verdicts ${h.answers.up} up / ${h.answers.down} down`);
  const a = h.audits || {};
  lines.push(`QA sampler: ${a.total || 0} graded, ${a.not_answered || 0} judged unanswered, ${a.refused || 0} refusals`);
  const c = h.corrections || {};
  lines.push(`Corrections: ${c.active || 0} active, **${c.draftsPending || 0} drafts waiting for review**`);
  if (h.docConflictsOpen) lines.push(`Doc conflicts open: ${h.docConflictsOpen}`);
  const issues = (h.issues || []).slice(0, 4).map(i => `${i.issue} ×${i.n}`).join(", ");
  if (issues) lines.push(`Guard trips: ${issues}`);
  const misses = (h.retrievalMisses || []).slice(0, 5);
  if (misses.length) {
    lines.push("Retrieval misses (files answers needed but never got):");
    for (const m of misses) lines.push(`· \`${m.path}\` ×${m.misses}`);
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
  const r = await fetch(DISCORD_MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(MCP_TOKEN ? { Authorization: `Bearer ${MCP_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "discord_send", arguments: { channel: CHANNEL, content } },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await r.text();
  const frame = raw.split("\n").find(l => l.startsWith("data:"));
  const parsed = JSON.parse(frame ? frame.slice(5).trim() : raw);
  if (!r.ok || parsed?.error || parsed?.result?.isError) {
    throw new Error(`discord_send failed: ${JSON.stringify(parsed?.error || parsed?.result || r.status).slice(0, 300)}`);
  }
}

(async () => {
  const health = await fetchHealth();
  const body = format(health);
  if (process.argv.includes("--dry-run")) { console.log(body); return; }
  await post(body);
  console.log(`[digest] posted to #${CHANNEL} (${body.length} chars)`);
})().catch(e => { console.error("[digest] failed:", e.message); process.exit(1); });
