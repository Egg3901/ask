"use strict";

const answerGuard = require("./answer-guard");
const llm = require("./llm");
const queryAliases = require("./query-aliases");

const SYSTEM = `You repair a flawed answer from a grounded game assistant.
The draft may have refused despite having evidence, stopped mid-sentence,
described its own evidence bundle instead of answering, cited a file it never
read, or missed a required part of the question.
Answer the player's question directly from the supplied evidence.
Use concrete values already present. If one requested field is absent, answer
everything supported and name only that exact gap in one sentence.
If the draft was cut off, complete it; keep the good part intact.
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

/**
 * Names the defects the pipeline already detected, so the repair model fixes
 * what is actually wrong instead of guessing. Empty array = nothing detected
 * beyond what shouldRepair itself checks.
 */
function issuesFor({ answer, hasLiveData, truncated = false, narrated = false, healedPaths = [] }) {
  const issues = [];
  if (answerGuard.detectRefusal(answer, hasLiveData === true)) issues.push("The draft refused or claimed it lacked access even though the evidence answers the question.");
  if (truncated) issues.push("The draft stopped mid-sentence before finishing. Complete it.");
  if (narrated) issues.push("The draft described its own evidence bundle to the player ('the supplied source...', 'the live snapshot only covers...'). Answer the question instead.");
  if (healedPaths.length) issues.push(`The draft cited ${healedPaths.join(", ")} without having read ${healedPaths.length === 1 ? "it" : "them"}. The real contents are now in the evidence below — verify every claim attributed to ${healedPaths.length === 1 ? "that file" : "those files"} and correct any that do not match.`);
  return issues;
}

function shouldRepair({ answer, hasLiveData, evidence, requirement = "", truncated = false, narrated = false, healedPaths = [] }) {
  return Boolean(String(evidence || "").trim())
    && (Boolean(String(requirement || "").trim())
      || truncated || narrated || healedPaths.length > 0
      || answerGuard.detectRefusal(answer, hasLiveData === true));
}

async function repair({ question, answer, evidence, requirement = "", issues = [], complete = llm.completeResult }) {
  let lastIssue = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await complete({
      system: SYSTEM,
      question: `QUESTION:\n${String(question || "").slice(0, 2000)}${issues.length ? `\n\nDETECTED DEFECTS TO FIX:\n${issues.map(i => `- ${i}`).join("\n")}` : ""}\n\nREQUIRED ANSWER CONTRACT:\n${String(requirement || "Answer directly from the evidence.").slice(0, 3000)}${lastIssue ? `\n\nTHE PREVIOUS REPAIR STILL FAILED THIS CONTRACT:\n${lastIssue}` : ""}\n\nFAILED DRAFT:\n${String(answer || "").slice(0, 8000)}\n\nEVIDENCE:\n${String(evidence || "").slice(0, 30000)}`,
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

module.exports = { requirementFor, shouldRepair, repair, issuesFor };
