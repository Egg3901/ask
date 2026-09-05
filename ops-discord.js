"use strict";

// The one place Ask posts to the staff Discord channel. The weekly digest and
// the doc-conflict notifier both go through here, so they cannot disagree
// about the transport: a tools/call to the Discord MCP's discord_send, with
// the channel name from the environment.
//
// Unconfigured (no DISCORD_MCP_URL) means every caller skips silently. The
// server runs in places that cannot reach the ops MCP, and a notifier that
// throws on every tick there is noise, not signal.

const DEFAULTS = {
  url: process.env.DISCORD_MCP_URL || "",
  token: process.env.MCP_TOKEN || "",
  channel: process.env.ASK_DIGEST_CHANNEL || "operations",
};

function configured() { return Boolean(DEFAULTS.url); }

function requestFor(content, { channel = DEFAULTS.channel, token = DEFAULTS.token } = {}) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "discord_send", arguments: { channel, content: String(content).slice(0, 1900) } },
    }),
  };
}

/** Parse an MCP reply that may arrive as plain JSON or as an SSE frame. */
function parseReply(raw) {
  const frame = String(raw || "").split("\n").find(l => l.startsWith("data:"));
  return JSON.parse(frame ? frame.slice(5).trim() : raw);
}

async function post(content, { url = DEFAULTS.url, token = DEFAULTS.token, channel = DEFAULTS.channel, fetcher = fetch, timeoutMs = 15000 } = {}) {
  if (!url) throw new Error("discord ops channel not configured");
  const r = await fetcher(url, { ...requestFor(content, { channel, token }), signal: AbortSignal.timeout(timeoutMs) });
  const parsed = parseReply(await r.text());
  if (!r.ok || parsed?.error || parsed?.result?.isError) {
    throw new Error(`discord_send failed: ${JSON.stringify(parsed?.error || parsed?.result || r.status).slice(0, 300)}`);
  }
  return parsed?.result ?? null;
}

module.exports = { post, configured, requestFor, parseReply, DEFAULTS };
