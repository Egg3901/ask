"use strict";

/**
 * Ask's own privacy notice and terms.
 *
 * These exist because the studio policies at lakesidegames.net are scoped to
 * "our website and our three games" and describe data sharing as limited to
 * Stripe and the login providers. Neither is true of Ask: it forwards the text
 * you type to third-party model providers, and on a self-lookup it forwards
 * your own game records too. Rather than stretch the studio policy to cover a
 * product it never described, Ask states its own specifics and defers to the
 * studio policy for everything about your account.
 *
 * Every factual claim below is checked against the code, not assumed:
 *   - provider list: PROVIDER_URLS in llm.js, gated on the *_API_KEY set in .env
 *   - payload shape: llm.js builds {system, history, question}; no identity field
 *   - self lookups: SELF_ONLY_TOOLS in investigate.js, results pushed back as
 *     role:"tool" messages, so they do reach the provider
 *   - stored tables: the CREATE TABLE statements in store.js
 *   - sharing: convs.share_token, an unguessable token, revocable
 *   - retention: there is no scheduled purge, so the copy must not imply one
 * If any of those change, this file changes in the same commit.
 */

const SUPPORT_EMAIL = "contact@lakesidegames.net";
const STUDIO_PRIVACY = "https://lakesidegames.net/privacy/";
const STUDIO_TERMS = "https://lakesidegames.net/terms/";

/**
 * The model providers a question can reach. Kept in the same order as the
 * routing catalog so this list can be diffed against models.js by eye.
 */
const PROVIDERS = [
  { name: "DeepSeek", host: "api.deepseek.com", note: "operated from China" },
  { name: "Google Gemini", host: "generativelanguage.googleapis.com", note: "" },
  {
    name: "OpenRouter",
    host: "openrouter.ai",
    note: "a router that passes the request on to further model providers",
  },
  { name: "OpenCode Zen", host: "opencode.ai", note: "" },
  { name: "CommandCode", host: "api.commandcode.ai", note: "" },
];

const PRIVACY = {
  slug: "privacy",
  title: "Privacy",
  lead: "What Ask sends to AI providers, and what it keeps.",
  sections: [
    {
      h: "This page is an addition, not a replacement",
      p: [
        `Ask is part of Lakeside Games. The <a href="${STUDIO_PRIVACY}">Lakeside privacy policy</a> covers your account, your login, and your supporter status, and it still applies here.`,
        "This page covers the part that is specific to Ask: it sends the text you type to AI providers run by other companies. The studio policy does not describe that, so it is described here.",
      ],
    },
    {
      h: "What Ask sends to an AI provider",
      p: ["Every time you ask a question, Ask sends:"],
      ul: [
        "your question, as you typed it",
        "the earlier turns of that same conversation, so follow-ups make sense",
        "excerpts of the game's code and documentation that Ask pulled in to answer you",
      ],
      after: [
        "If you ask about your own character, Ask can look up your own game records, such as your character, your balance sheet, or your wealth history, and the results of that lookup are sent to the provider as part of answering. Ask only ever looks up your own records this way. It cannot do it for another player.",
        "Ask does not send your username, your email address, your Lakeside account ID, or your Discord ID to any AI provider. The request carries the question and its context, not who is asking.",
      ],
    },
    {
      h: "Which providers",
      p: [
        "Ask chooses a model automatically, based on which service is healthy and what the question needs. Depending on that choice, your question goes to one of:",
      ],
      list: PROVIDERS.map(
        (pr) => `<b>${pr.name}</b> (${pr.host})${pr.note ? `, ${pr.note}` : ""}`
      ),
      after: [
        "Each of these is a separate company with its own terms and its own data handling, which we do not control. If you would rather a question never left our servers, do not ask it here.",
      ],
    },
    {
      h: "What Ask stores",
      ul: [
        "your questions and the answers Ask gave",
        "your conversations and their titles",
        "a profile record, used to apply your daily budget and supporter status",
        "a cache of answers, so a question someone already asked is cheaper to answer again",
        "any feedback, correction, or report you submit",
      ],
      after: [
        "We keep conversations until you delete them. There is no automatic expiry.",
      ],
    },
    {
      h: "Sharing a conversation",
      p: [
        "Conversations are private to you unless you share one. Sharing creates a long, unguessable link, and anyone who has that link can read that one conversation without signing in. You can revoke the link at any time, which stops it working.",
      ],
    },
    {
      h: "Deleting your data",
      p: [
        `You can delete any conversation from the sidebar, which removes its questions and answers. To have everything removed, including your profile record, email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`,
      ],
    },
  ],
};

const TERMS = {
  slug: "terms",
  title: "Terms",
  lead: "The rules for using Ask, and what an answer is worth.",
  sections: [
    {
      h: "This page is an addition, not a replacement",
      p: [
        `Ask is part of Lakeside Games and the <a href="${STUDIO_TERMS}">Lakeside terms of service</a> apply, including the rules about your account and acceptable behaviour. This page adds the parts specific to Ask.`,
      ],
    },
    {
      h: "Ask can be wrong",
      p: [
        "Answers are produced by an AI model reading the game's code and documentation. Ask cites what it used and it is built to say when the code does not show something, but it can still be wrong, out of date, or incomplete.",
        "Treat an answer as a strong hint, not as a rule. If Ask and the game disagree, the game is right. Do not rely on an answer for anything you cannot afford to have wrong.",
      ],
    },
    {
      h: "Who can use it",
      p: [
        "Ask is free for every player with a game account. Supporters get a larger daily budget and access to charts and maps. Budgets reset daily and exist so one person cannot exhaust the service for everyone.",
      ],
    },
    {
      h: "Fair use",
      p: ["While using Ask, do not:"],
      ul: [
        "automate it, script it, or put it behind another service",
        "work around the daily budget, including by using more than one account",
        "use it to try to extract credentials, private player data, or anything the game does not show you",
        "resell answers or present them as an official statement from Lakeside Games",
      ],
      after: [
        "We may suspend access to Ask for any of the above, without affecting your game account.",
      ],
    },
    {
      h: "Availability",
      p: [
        "Ask is provided as-is and as-available. It is built alongside the games by a small team, and it can change, break, or stop. We do not promise a particular uptime, model, or answer quality.",
      ],
    },
    {
      h: "Questions",
      p: [
        `Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`,
      ],
    },
  ],
};

const DOCS = { privacy: PRIVACY, terms: TERMS };

function has(slug) {
  return Object.prototype.hasOwnProperty.call(DOCS, slug);
}

function get(slug) {
  return DOCS[slug] || null;
}

module.exports = { DOCS, PROVIDERS, get, has, STUDIO_PRIVACY, STUDIO_TERMS, SUPPORT_EMAIL };
