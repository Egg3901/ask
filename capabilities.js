"use strict";

const scenarioLab = require("./scenario-lab");

const VERIFY = /\b(?:verify|fact-check|fact check|audit|check)\b[\s\S]{0,100}\b(?:previous|prior|last|earlier|answer|claim|statement|mechanic|true|correct)\b|\b(?:is|was) (?:that|this|the previous answer) (?:true|correct|right)\b/i;
const CAUSAL = /\b(?:causal autopsy|root cause|causal chain|forensic explanation|trace the cause|trace why|why exactly)\b/i;
const ARMY_LOGISTICS = /\b(?:army|military|battle|front|war|conflict|formations?|troops?)\b[\s\S]{0,90}\b(?:logistics|supply(?: lines?)?)\b|\b(?:logistics|supply(?: lines?)?)\b[\s\S]{0,90}\b(?:army|military|battle|front|war|conflict|formations?|troops?)\b/i;

function classify(question) {
  const text = String(question || "");
  if (VERIFY.test(text)) return { id: "claim-verifier", intent: "claim_verification" };
  if (scenarioLab.parse(text)) return { id: "scenario-lab", intent: "scenario_lab" };
  if (CAUSAL.test(text)) return { id: "causal-autopsy", intent: "causal_autopsy" };
  if (ARMY_LOGISTICS.test(text)) return { id: "army-logistics", intent: "army_logistics" };
  return null;
}

function contract(plan) {
  switch (plan?.intent) {
    case "claim_verification":
      return `CLAIM VERIFIER MODE
- Split the claim or previous answer into its material factual claims.
- Mark each claim supported, contradicted, or unresolved from the evidence you actually have.
- For every verdict, give the decisive game rule, live value, or shipped change. Do not award "supported" from plausibility.
- End with a corrected answer that the player can use.`;
    case "causal_autopsy":
      return `CAUSAL AUTOPSY MODE
- Lead with the observed outcome and timestamp or turn.
- Build the causal chain from live state through the exact game formulas to the outcome. Every arrow needs evidence.
- Separate shipped code changes from ordinary world movement and player action.
- Name at least one plausible alternative cause that the evidence rejects, and why.
- End with the next observable value that would confirm or falsify the diagnosis.`;
    case "scenario_lab":
      return `SCENARIO LAB MODE
- Report the simulator's baseline, intervention, horizon, and outcome.
- Call this a directional projection calibrated to live prices, never an exact forecast or the canonical turn engine.
- Separate the isolated shock from policy feedback and player behavior the projection does not model.`;
    default:
      return "";
  }
}

module.exports = { classify, contract };
