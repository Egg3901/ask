const test = require("node:test");
const assert = require("node:assert/strict");

const page = require("./page");
const prompt = require("./prompt");

function render(overrides = {}) {
  return page.app({
    identity: { provider: "ahd", id: "probe", username: "probe" },
    context: {
      username: "probe",
      character: { name: "Ada", country: "United Kingdom", party: "Liberal" },
      corporation: { name: "Lakeside" },
    },
    entitlement: { allowed: true, label: "Staff", questions: 200, mcp: 50, visualizations: true },
    usage: {
      used: 0, limit: 100, remaining: 100,
      mcpUsed: 0, mcpLimit: 25, mcpRemaining: 25,
      resetAt: Date.now() + 86400000,
    },
    conversations: [], model: "probe",
    styles: prompt.STYLES, lengths: prompt.LENGTHS,
    ...overrides,
  });
}

test("keeps every output and display preference in one settings sheet", () => {
  const html = render();
  const panel = html.match(/<div class="sheet" id="settingsPanel"[\s\S]*?<!-- settings:end -->/)?.[0] || "";

  assert.match(html, /id="settings"/);
  assert.match(panel, /data-theme-value="light"/);
  assert.match(panel, /data-theme-value="dark"/);
  assert.match(panel, />White<\/button>/);
  assert.match(panel, />OLED black<\/button>/);
  assert.match(panel, /id="live"/);
  assert.match(panel, /id="visualizations"/);
  assert.match(panel, /Allow a diagram, chart, or game map when it makes the answer clearer/);
  assert.match(panel, /data-opt="style"/);
  assert.match(panel, /data-opt="length"/);
});

test("visualizations are opt-in and constrained by the prompt", () => {
  const html = render();
  const off = prompt.build();
  const on = prompt.build({ visualizations: true });

  assert.match(html, /localStorage\.getItem\('ask\.visualizations'\)==='true'/);
  assert.match(off, /Do not include Mermaid diagrams/);
  assert.match(on, /Use at most one visualization/);
  assert.match(on, /AHD map/);
  assert.match(on, /at most six labeled categories or series/);
  assert.match(on, /prefer that display-ready dataset/);
  assert.match(on, /Never compare unconverted local-currency values/);
  assert.match(on, /Never substitute a different available metric/);
  assert.match(on, /Current snapshot or mixed units/);
  assert.match(on, /One comparable metric across entities/);
  assert.match(on, /One metric across turns/);
  assert.match(on, /Two or more incompatible units/);
  assert.match(on, /one outlier makes every other label or bar unreadable/);
  assert.match(on, /only when it makes .* materially easier/);
});

test("explicit visualization requests lead with the chart and concise interpretation", () => {
  const on = prompt.build({ visualizations: true, visualizationRequested: true });

  assert.match(on, /put the visualization before the prose/i);
  assert.match(on, /one-sentence takeaway and at most three short bullets/i);
  assert.match(on, /Do not narrate every value already visible in the chart/i);
  assert.match(on, /translate internal state identifiers into player-facing names/i);
});

test("transports Mermaid source as text instead of a quoted HTML attribute", () => {
  const html = render();

  assert.match(html, /<pre class="mermaid-source">/);
  assert.match(html, /var src=block\.textContent/);
  assert.doesNotMatch(html, /data-src/);
});

test("Mermaid charts override the icon size and fit their mobile card", () => {
  const html = render();

  assert.match(html, /\.mermaid-wrap svg\{[^}]*width:100%;[^}]*min-width:0;[^}]*height:auto;[^}]*max-width:100%/);
  assert.match(html, /\.mermaid-wrap\{[^}]*overflow-x:auto/);
});

test("tapping a chart opens a mobile full-screen viewer with complete labels", () => {
  const html = render();

  assert.match(html, /id="chartViewer"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="chartStage"/);
  assert.match(html, /data-chart-zoom="in"/);
  assert.match(html, /data-chart-zoom="out"/);
  assert.match(html, /data-chart-zoom="reset"/);
  assert.match(html, /function expandMermaidViewBox\(svg,done\)/);
  assert.match(html, /svg\.getBBox\(\)/);
  assert.match(html, /openChartViewer\(wrap\)/);
  assert.match(html, /\.chart-viewer\.open\{display:flex/);
  assert.match(html, /\.chart-stage\{[^}]*overflow:auto;[^}]*touch-action:pan-x pan-y pinch-zoom/);
  assert.match(html, /\.chart-canvas svg\{[^}]*max-width:none/);
});

test("renders game maps responsively and opens them in the same full-screen viewer", () => {
  const html = render();

  assert.match(html, /lang==='ahd-map'/);
  assert.match(html, /class="map-source"/);
  assert.match(html, /function renderMapsIn\(el\)/);
  assert.match(html, /fetch\('\/api\/map\/render'/);
  assert.match(html, /wrap\.className='map-wrap'/);
  assert.match(html, /prepareMermaidWrap\(wrap\)/);
  assert.match(html, /\.map-wrap svg\{[^}]*width:100%;[^}]*height:auto;[^}]*max-width:100%/);
});

test("the prompt refuses exploit abuse and unfair player targeting", () => {
  const text = prompt.build();

  assert.match(text, /exact best position against a named opponent/);
  assert.match(text, /opponent's weakest group/);
  assert.match(text, /unfair automation/);
  assert.match(text, /help reporting a suspected exploit are allowed/);
});

test("the prompt allows public market analysis and protects private corporation data", () => {
  const text = prompt.build();

  assert.match(text, /why a publicly traded corporation is performing or valued highly/);
  assert.match(text, /aggregate economic data for any country/);
  assert.match(text, /Refuse private-corporation balance sheets/);
  assert.match(text, /If public status or visibility is not established/);
});

test("live mode prefers fresh safe game data when it can ground the answer", () => {
  const text = prompt.build({ liveData: true });

  assert.match(text, /Prefer the fresh live game data supplied below/);
  assert.match(text, /public corporations, country economies, markets, elections/);
  assert.match(text, /Never claim comparison data is absent when a sector benchmark is supplied/);
  assert.match(text, /installed capacity, utilization, sell-through, market clearing, input availability, growth, and state specialization/);
  assert.match(text, /Do not infer a cause from ranking alone/);
  assert.match(text, /Apply the public\/private and fair-play rules/);
  assert.match(text, /focused foreign-exchange pair/);
  assert.doesNotMatch(prompt.build(), /LIVE GROUNDING/);
});

test("only admins get the Ask console link", () => {
  const adminHtml = page.app({
    identity: { provider: "ahd", id: "probe", username: "probe" },
    context: { username: "probe", isAdmin: true },
    entitlement: { allowed: true, label: "Staff", questions: 200, mcp: 50, visualizations: true },
    usage: { used: 0, limit: 100, remaining: 100, mcpUsed: 0, mcpLimit: 25, mcpRemaining: 25, resetAt: Date.now() + 86400000 },
    conversations: [], model: "probe", styles: prompt.STYLES, lengths: prompt.LENGTHS,
  });
  assert.match(adminHtml, /href="\/console"/);
  assert.doesNotMatch(render(), /href="\/console"/);
});

test("answers expose helpful and report actions", () => {
  const html = render();

  assert.match(html, /data-feedback="up"/);
  assert.match(html, /data-feedback="down"/);
  assert.match(html, /\/api\/answer\/feedback/);
  // Reporting opens a real dialog (reason chips + detail), not window.prompt.
  assert.match(html, /id="fbPanel"/);
  assert.match(html, /Report this answer/);
  assert.doesNotMatch(html, /window\.prompt\('What was wrong with this answer/);
});

test("shared answers can be reported with their share token", () => {
  const html = page.sharedView({
    title: "Shared",
    shareToken: "share1234",
    turns: [{ id: 42, question: "Question", answer: "Answer", citations: [] }],
  });

  assert.match(html, /data-shared-report="42"/);
  assert.match(html, /\/api\/shared\/feedback/);
  assert.match(html, /share1234/);
});

test("the admin console surfaces reported answers and reasons", () => {
  const html = page.consolePage({
    users: [{ user_key: "ahd:1", username: "Tester", question_count: 1, report_count: 1 }],
    selected: {
      profile: { user_key: "ahd:1", username: "Tester", first_seen: Date.now(), last_seen: Date.now() },
      questions: [{ question: "Bad answer?", answer: "Wrong", feedback_rating: "down", feedback_reason: "Wrong live metric", feedback_source: "owner", ts: Date.now() }],
      estimated_cost: 0,
    },
  });

  assert.match(html, /Reports/);
  assert.match(html, /Wrong live metric/);
  assert.match(html, /Reported by owner/);
});

test("the admin console clusters reports and offers a safe replay link", () => {
  const html = page.consolePage({
    identity: {}, context: {}, users: [],
    reports: [{ category: "live-data retrieval", count: 1, reports: [{
      user_key: "ahd:1", username: "Tester", question: "Why is the market moving?",
      feedback_reason: "No live data", ts: Date.now(), plan: { id: "general" },
    }] }],
  });
  assert.match(html, /Reported-answer queue/);
  assert.match(html, /live-data retrieval/);
  assert.match(html, /Open replay/);
  assert.match(html, /\?replay=/);
});

test("keeps the first view calm and moves the full question catalog into a library", () => {
  const html = render();
  const composer = html.match(/<div class="ask-composer">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)?.[1] || "";

  assert.doesNotMatch(composer, /data-opt=|id="live"/);
  assert.match(html, /@media\(max-width:560px\)[\s\S]*?\.ask-follow\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.equal((html.match(/<button class="fchip starter-card"/g) || []).length, 3);
  assert.match(html, /id="starterBrowse"/);
  assert.match(html, /id="questionPanel"/);
  assert.match(html, /id="starterTabs"/);
  assert.doesNotMatch(html, /id="starterRefresh"/);
});

test("overrides the dashboard palette with white and OLED black", () => {
  const html = render();
  const inheritedBlue = html.indexOf("--accent:#38bdf8");
  const oledOverride = html.indexOf("--bg-0:#000");
  const whiteOverride = html.indexOf(':root[data-theme="light"]{\n  --bg-0:#fff');

  assert.ok(inheritedBlue > -1 && oledOverride > inheritedBlue);
  assert.ok(whiteOverride > oledOverride);
  assert.doesNotMatch(html, /radial-gradient/);
  assert.doesNotMatch(html, /linear-gradient\(135deg/);
});

test("surfaces live-data mode beside the composer and labels corporation context", () => {
  const html = render();

  assert.match(html, /id="liveMode"/);
  assert.match(html, /Code sources/);
  assert.match(html, /CEO of Lakeside/);
  assert.match(html, /Compare Lakeside with its public peers/);
  assert.match(html, /function modelBadge/);
  assert.match(html, /\.flag:empty\{display:none\}/);
});

test("keeps CEO and shareholder context distinct in the answer prompt", () => {
  const base = { character: { name: "Ada" }, corporation: { name: "Lakeside", ticker: "LAKE" } };
  const ceo = prompt.build({ context: { ...base, corporation: { ...base.corporation, role: "ceo" } } });
  const shareholder = prompt.build({ context: { ...base, corporation: { ...base.corporation, role: "shareholder" } } });

  assert.match(ceo, /CEO of Lakeside \(LAKE\)/);
  assert.match(shareholder, /a shareholder in Lakeside \(LAKE\)/);
  assert.doesNotMatch(shareholder, /CEO of Lakeside/);
});

test("strips a follow-up marker even when the model closes it with a Unicode dash", () => {
  const raw = 'Answer text.\n\n<!--FU ["First question?","Second question?"]—>';
  const parsed = prompt.extractFollowups(raw);

  assert.equal(parsed.text, "Answer text.");
  assert.deepEqual(parsed.followups, ["First question?", "Second question?"]);
});

test("the client bundle names the answering model without leaking a vendor slug", () => {
  const html = render();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length, "no client script block");
  // The client script lives in a template literal, where an escaped slash inside
  // a regex literal collapses to a bare slash and silently ends the regex. This
  // shipped once; parsing every block is what catches it.
  for (const src of scripts) new Function(src);

  const all = scripts.join("\n");
  const names = all.match(/var MODEL_NAMES=(\{.*?\});/);
  assert.ok(names, "MODEL_NAMES not injected into the client");
  assert.ok(/var MODEL_TIERS=\{/.test(all), "MODEL_TIERS not injected into the client");
  const map = JSON.parse(names[1]);
  const models = require("./models");
  for (const id of Object.values(models.CHAINS).flat()) {
    assert.ok(map[id], `${id} is routable but has no display name`);
    assert.ok(!map[id].includes("/"), `${id} display name leaks a vendor slug`);
  }

  const badge = new Function(names[0] + all.match(/var MODEL_TIERS=\{.*?\};/)[0]
    + all.match(/function modelBadge[\s\S]*?\n/)[0] + "return modelBadge;")();
  assert.equal(badge("nvidia/nemotron-3-ultra-550b-a55b:free"), "Pro");
  assert.equal(badge("nvidia/nemotron-3.5-lightning:free"), "Flash");
  assert.equal(badge("stealth/ox-alpha"), "Deep");
  assert.equal(badge("deepseek-v4-pro"), "Pro");
  for (const lbl of ["Flash", "Pro", "Deep"]) {
    assert.equal(badge(lbl), lbl, "server-sent tier labels must still render");
  }
  assert.ok(html.includes("flag flag-model"), "model chip markup missing");
});

test("visualizations are locked off for a tier that does not include them", () => {
  const player = { allowed: true, label: "Player", questions: 5, mcp: 2, visualizations: false };
  const html = render({ entitlement: player });
  const panel = html.match(/<div class="sheet" id="settingsPanel"[\s\S]*?<!-- settings:end -->/)?.[0] || "";

  assert.match(panel, /id="visualizations" disabled/);
  assert.match(panel, /setting-locked/);
  assert.match(panel, /supporter feature/i);
  // A stale localStorage "on" from a lapsed tier must not re-enable the toggle.
  assert.match(html, /var VIZ_ALLOWED=false;/);
  assert.match(html, /visualizations\.checked=VIZ_ALLOWED&&/);

  const staff = render();
  assert.doesNotMatch(staff, /id="visualizations" disabled/);
  assert.match(staff, /var VIZ_ALLOWED=true;/);
  assert.match(staff, /Allow a diagram, chart, or game map/);
});

test("a withheld chart is explained rather than silently dropped", () => {
  const html = render();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  assert.match(scripts, /d\.vizBlocked/);
  assert.match(scripts, /ask-viz-note/);
  assert.match(html, /\.ask-viz-note\{/);
});

test("the gate quotes the real tier table rather than hardcoded copy", () => {
  const auth = require("./auth");
  const html = page.signedOut();
  // The old copy said "Available to supporters, moderators and admins" and quoted
  // 5/10/20. It went stale the moment the budgets moved, so it is generated now.
  assert.doesNotMatch(html, /Available to supporters, moderators and admins/);
  assert.match(html, new RegExp(`Every player</b> ${auth.PLAYER.questions} questions a day`));
  for (const tier of Object.values(auth.TIERS)) {
    assert.ok(html.includes(`<b>${tier.label}</b> ${tier.questions} a day`), `${tier.label} budget missing or stale`);
  }
});

test("the only ways past the gate are a ban or an unconfirmable account", () => {
  assert.match(page.notEntitled({ identity: { username: "ada" }, reason: "banned" }), /Account restricted/);
  const unknown = page.notEntitled({ identity: { username: "ada" }, reason: "no-context" });
  assert.match(unknown, /Can't confirm your game account/);
  assert.doesNotMatch(unknown, /Supporters only/);
  assert.doesNotMatch(unknown, /Become a supporter/);
});

test("the model chip links to the model it names", () => {
  const html = render();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  const urls = JSON.parse(scripts.match(/var MODEL_URLS=(\{.*?\});/)[1]);
  const models = require("./models");
  for (const id of Object.values(models.CHAINS).flat()) {
    assert.ok(urls[id], `${id} is routable but has no model page`);
  }
  assert.equal(urls["stealth/ox-alpha"], "https://openrouter.ai/stealth/ox-alpha");
  assert.match(scripts, /rel="noopener"/);
});
