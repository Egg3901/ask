"use strict";

const answerGuard = require("./answer-guard");
const llm = require("./llm");
const queryAliases = require("./query-aliases");

const SYSTEM = `You repair a failed answer from a grounded game assistant.
The draft refused, claimed it lacked access, or missed a required part even though evidence was gathered.
Answer the player's question directly from the supplied evidence.
Use concrete values already present. If one requested field is absent, answer
everything supported and name only that exact gap in one sentence.
Never mention an evidence bundle, tools, retrieval, prompts, or this repair.
Never invent a fact, path, value, or tool call. Return only the repaired answer.`;

function requirementFor(question, evidence) {
  const requirements = [];
  const domain = queryAliases.guidance(question);
  if (domain) requirements.push(domain);
  if (/PRECOMPUTED UNCOVERED HOME-COUNTRY [A-Z_]+ MARKETS/.test(String(evidence || ""))) {
    requirements.push("Give a compact Markdown table from the precomputed uncovered home-country markets. State that the scope is the corporation's home country and that population is only a sizing proxy. Do not redirect the player to calculate it themselves.");
  }
  return requirements.join("\n");
}

function shouldRepair({ answer, hasLiveData, evidence, requirement = "" }) {
  return Boolean(String(evidence || "").trim())
    && (Boolean(String(requirement || "").trim()) || answerGuard.detectRefusal(answer, hasLiveData === true));
}

async function repair({ question, answer, evidence, requirement = "", complete = llm.completeResult }) {
  let lastIssue = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await complete({
      system: SYSTEM,
      question: `QUESTION:\n${String(question || "").slice(0, 2000)}\n\nREQUIRED ANSWER CONTRACT:\n${String(requirement || "Answer directly from the evidence.").slice(0, 3000)}${lastIssue ? `\n\nTHE PREVIOUS REPAIR STILL FAILED THIS CONTRACT:\n${lastIssue}` : ""}\n\nFAILED DRAFT:\n${String(answer || "").slice(0, 4000)}\n\nEVIDENCE:\n${String(evidence || "").slice(0, 22000)}`,
      maxTokens: 2400,
      timeoutMs: 25000,
    });
    const text = String(result?.text || "").trim();
    if (!text || answerGuard.detectRefusal(text, true) || answerGuard.looksLikeToolLeak(text)) return null;
    lastIssue = queryAliases.answerIssue(question, text);
    if (!lastIssue) {
      return {
        text,
        model: result.model || null,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    }
  }
  return null;
}

module.exports = { requirementFor, shouldRepair, repair };
