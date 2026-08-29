const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const path = require("node:path");

const legal = require("./legal");
const page = require("./page");

// The privacy copy makes specific claims about where a question goes. These
// tests exist so the copy fails loudly when the code stops matching it, rather
// than quietly becoming a false statement on a public page.

test("both documents exist and render", () => {
  for (const slug of ["privacy", "terms"]) {
    assert.ok(legal.has(slug), `${slug} missing from DOCS`);
    const html = page.legalPage(slug);
    assert.ok(html && html.length > 1000, `${slug} did not render`);
    assert.match(html, /<h1>/);
  }
});

test("an unknown document renders nothing rather than an empty shell", () => {
  assert.equal(page.legalPage("nope"), null);
  assert.equal(legal.get("nope"), null);
  assert.equal(legal.has("constructor"), false);
});

test("privacy names every provider the code can actually call", () => {
  const html = page.legalPage("privacy");
  for (const provider of legal.PROVIDERS) {
    assert.ok(html.includes(provider.name), `privacy page omits ${provider.name}`);
    assert.ok(html.includes(provider.host), `privacy page omits host ${provider.host}`);
  }
});

test("the provider list matches the endpoints defined in llm.js", () => {
  // If a provider is added to llm.js without being added here, the privacy
  // page silently understates where questions go. That is the failure this
  // catches. Ollama is excluded on purpose: it resolves to localhost, so it
  // is not a third party.
  const src = fs.readFileSync(path.join(__dirname, "llm.js"), "utf8");
  const documented = legal.PROVIDERS.map((p) => p.host);
  const endpoints = [...src.matchAll(/https:\/\/([a-z0-9.-]+)\/[a-z0-9/._-]*/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((h) => h !== "ask.lakesidegames.net");
  for (const host of new Set(endpoints)) {
    const covered = documented.some((d) => host === d || host.endsWith(d) || d.endsWith(host));
    assert.ok(covered, `llm.js calls ${host} but the privacy page never names it`);
  }
});

test("privacy discloses that a self-lookup sends your own game records", () => {
  // SELF_ONLY_TOOLS results are pushed back as role:"tool" messages, so they do
  // reach the provider. The copy has to say so.
  const investigate = require("./investigate");
  assert.ok(investigate.SELF_ONLY_TOOLS.size > 0, "no self-only tools, copy may be stale");
  const html = page.legalPage("privacy");
  assert.match(html, /your own game records/i);
  assert.match(html, /balance sheet/i);
});

test("privacy states identity is not forwarded, and llm.js still honours that", () => {
  const src = fs.readFileSync(path.join(__dirname, "llm.js"), "utf8");
  assert.ok(
    !/\b(identity|username|user_key|userKey)\b/.test(src),
    "llm.js now references identity: the 'we do not send who is asking' claim needs re-checking"
  );
  assert.match(page.legalPage("privacy"), /does not send your username/i);
});

test("each document points at the studio policy it supplements", () => {
  assert.match(page.legalPage("privacy"), /lakesidegames\.net\/privacy/);
  assert.match(page.legalPage("terms"), /lakesidegames\.net\/terms/);
});

test("the signed-out lander links both documents before sign-in", () => {
  // Someone deciding whether to hand Ask a question must be able to read this
  // without signing in first.
  const lander = page.signedOut({});
  assert.match(lander, /href="\/privacy"/);
  assert.match(lander, /href="\/terms"/);
});

test("copy carries no em or en dashes", () => {
  const src = fs.readFileSync(path.join(__dirname, "legal.js"), "utf8");
  assert.ok(!/[—–]/.test(src), "legal.js contains an em or en dash");
});

test("document pages scroll, the chat shell stays locked", () => {
  // ASK_CSS sets body{height:100dvh;overflow:hidden} for the chat layout, and
  // it is the last style block, so it beats anything a page passes via head.
  // Every page that is a document rather than the chat has to opt into
  // body.doc or its content below the fold is unreachable.
  const prompt = require("./prompt");
  const bodyTag = (h) => (h.match(/<body[^>]*>/) || [""])[0];

  const documents = {
    lander: page.signedOut({}),
    notFound: page.signedOut({ notFound: true }),
    notEntitled: page.notEntitled({
      identity: { username: "x" },
      context: { username: "x" },
      reason: "banned",
    }),
    changelog: page.changelogPage(),
    privacy: page.legalPage("privacy"),
    terms: page.legalPage("terms"),
  };
  for (const [name, html] of Object.entries(documents)) {
    assert.match(bodyTag(html), /class="[^"]*\bdoc\b/, `${name} cannot scroll`);
  }

  const chat = page.app({
    identity: { provider: "ahd", id: "p", username: "p" },
    context: { username: "p" },
    entitlement: { allowed: true, label: "S", questions: 10, mcp: 5, visualizations: true },
    usage: {
      used: 0, limit: 10, remaining: 10,
      mcpUsed: 0, mcpLimit: 5, mcpRemaining: 5, resetAt: Date.now() + 1e6,
    },
    conversations: [], model: "m", styles: prompt.STYLES, lengths: prompt.LENGTHS,
  });
  assert.doesNotMatch(bodyTag(chat), /\bdoc\b/, "the chat shell must keep its locked layout");
  assert.match(chat, /body\.doc\{/, "the doc-mode rule is missing from the stylesheet");
});
