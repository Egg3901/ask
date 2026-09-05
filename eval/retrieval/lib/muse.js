"use strict";
// The only bulk LLM lane on this box: the muse CLI on the owner's
// subscription. Every call is appended to a ledger so the total spend is
// auditable, and callers cache by content hash so a rerun costs nothing.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const MODEL = process.env.EVAL_LLM_MODEL || "muse-spark-1.3-contributor";
const EFFORT = process.env.EVAL_LLM_EFFORT || "minimal";
const LEDGER = path.join(__dirname, "..", "cache", "llm-calls.jsonl");

function sha1(s) { return crypto.createHash("sha1").update(s).digest("hex"); }

function appendLedger(entry) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

function ledgerCount(purpose = null) {
  if (!fs.existsSync(LEDGER)) return 0;
  return fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean)
    .map(l => JSON.parse(l)).filter(e => !purpose || e.purpose === purpose).length;
}

/** One headless muse call. Resolves { ok, text, ms, error }. Never throws. */
function museCall(prompt, { purpose = "unspecified", timeoutMs = 180000 } = {}) {
  const dir = path.join(os.tmpdir(), "ask-retrieval-eval");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${process.pid}-${sha1(prompt).slice(0, 12)}.txt`);
  fs.writeFileSync(file, prompt);
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn("muse", [
      "exec", "--json", "--model", MODEL, "--reasoning-effort", EFFORT, "--prompt-file", file,
    ], { cwd: os.tmpdir(), env: { ...process.env, HOME: "/root" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeoutMs);
    child.on("close", code => {
      clearTimeout(timer);
      try { fs.unlinkSync(file); } catch {}
      const ms = Date.now() - started;
      let text = null, terminal = null, error = null;
      for (const line of out.split("\n")) {
        if (!line.startsWith("{")) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (String(ev.payload_type || "").startsWith("run.terminal")) {
          terminal = ev.payload?.terminal || ev.payload_type;
          if (typeof ev.payload?.text === "string") text = ev.payload.text;
          if (ev.payload?.reason) error = String(ev.payload.reason);
        }
      }
      const ok = code === 0 && terminal === "completed" && typeof text === "string" && text.length > 0;
      if (!ok && !error) error = `exit=${code} terminal=${terminal} stderr=${err.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`;
      appendLedger({ purpose, model: MODEL, effort: EFFORT, ms, ok, promptChars: prompt.length, outChars: text ? text.length : 0, error: ok ? null : error });
      resolve({ ok, text, ms, error: ok ? null : error });
    });
  });
}

/** Extract the first JSON object or array from model output, tolerating fences and prose. */
function parseJsonLoose(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const starts = [s.indexOf("{"), s.indexOf("[")].filter(i => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const closer = s[start] === "{" ? "}" : "]";
  const end = s.lastIndexOf(closer);
  if (end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/** Bounded-concurrency map preserving order. fn may reject; rejections become { error }. */
async function pMap(items, fn, concurrency = 3) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); } catch (e) { out[i] = { error: String(e && e.message || e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = { museCall, parseJsonLoose, pMap, sha1, ledgerCount, LEDGER, MODEL, EFFORT };
