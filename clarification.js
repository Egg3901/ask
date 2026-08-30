"use strict";

const MISSING_REFERENCE = /\bthe last part\b|^(?:is|was)\s+(?:this|that)\s+(?:true|correct|right)\b|^(?:why|how)\s+did\s+(?:this|that|it)\s+happen\b|^what about (?:this|that|it)\b/i;

function missingReference(question, hasHistory = false) {
  if (hasHistory) return false;
  const q = String(question || "").trim();
  return q.length < 140 && MISSING_REFERENCE.test(q);
}

function answer(question, hasHistory = false) {
  if (!missingReference(question, hasHistory)) return null;
  return "I’m missing what this refers to. Paste or identify the specific passage, result, or event you want checked, and I’ll verify it against the game’s code and live data.";
}

module.exports = { missingReference, answer };
