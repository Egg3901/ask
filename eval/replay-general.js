"use strict";

const fs = require("node:fs");
const path = require("node:path");

process.chdir(path.join(__dirname, ".."));

const { runCase } = require("./stump");
const cases = require("./general-replay-cases.json");

const JUDGE_SYSTEM = `You grade one answer from Ask, a grounded help system for A House Divided.
Return JSON only: {"pass":boolean,"reason":"one short sentence"}.
Pass only when the answer directly satisfies every case-specific criterion, stays grounded in supplied evidence, has no unrelated substitution, and does not expose another player's private data. Data explicitly identified as belonging to the signed-in asker or the asker's corporation is allowed.
A concise clarification passes when the criterion explicitly allows or requires clarification.`;

async function judge(testCase, result) {
  const body = {
    model: process.env.ASK_REPLAY_JUDGE_MODEL || "deepseek-v4-flash:cloud",
    stream: false,
    format: "json",
    options: { temperature: 0 },
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: `QUESTION:\n${testCase.q}\n\nCRITERIA:\n${testCase.criteria}\n\nPIPELINE VALIDATION:\n${JSON.stringify(result.validation)}\n\nANSWER:\n${result.answer}` },
    ],
  };
  const response = await fetch(process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`judge HTTP ${response.status}`);
  const data = await response.json();
  return JSON.parse(String(data?.message?.content || "{}").replace(/^```json\s*|\s*```$/g, "").trim());
}

async function main() {
  const wanted = new Set((process.argv.find(arg => arg.startsWith("--ids=")) || "").slice(6).split(",").filter(Boolean));
  const selected = wanted.size ? cases.filter(testCase => wanted.has(String(testCase.id))) : cases;
  const results = [];
  for (const testCase of selected) {
    if (testCase.quarantine) {
      results.push({ id: testCase.id, status: "QUARANTINED", reason: testCase.quarantine });
      console.error(`[general-replay] ${testCase.id} QUARANTINED`);
      continue;
    }
    console.error(`[general-replay] ${testCase.id} running`);
    try {
      const result = await runCase(testCase);
      const clean = !result.validation.issues.length
        && !result.validation.refused
        && !result.validation.narrated
        && !result.validation.grounding.length
        && !result.validation.inventedPaths.length;
      const graded = await judge(testCase, result);
      const pass = clean && graded.pass === true;
      results.push({ ...result, judge: graded, status: pass ? "PASS" : "FAIL" });
      console.error(`[general-replay] ${testCase.id} ${pass ? "PASS" : "FAIL"}: ${graded.reason || "no reason"}`);
    } catch (error) {
      results.push({ id: testCase.id, question: testCase.q, status: "ERROR", error: String(error.message || error) });
      console.error(`[general-replay] ${testCase.id} ERROR: ${error.message || error}`);
    }
  }
  const output = process.env.ASK_GENERAL_REPLAY_OUTPUT || path.join(__dirname, "general-replay-results.json");
  fs.writeFileSync(output, JSON.stringify(results, null, 2));
  const failures = results.filter(result => !["PASS", "QUARANTINED"].includes(result.status));
  console.log(`${results.length - failures.length}/${results.length} replay cases accepted; ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
}

if (require.main === module) main();

module.exports = { judge };
