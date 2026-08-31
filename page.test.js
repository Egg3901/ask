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

test("question-library categories stay visible above the sample scroller", () => {
  const html = render();
  const tabs = html.match(/<div class="starter-tabs" id="starterTabs"[\s\S]*?<\/div>/)?.[0] || "";

  assert.match(tabs, /data-starter-category="for-you"/);
  assert.match(tabs, /data-starter-category="investigate"/);
  assert.match(html, /\.starter-tabs\{[^}]*flex:0 0 auto;[^}]*overflow-x:auto/);
  assert.match(html, /@media\(max-width:560px\)\{[\s\S]*?\.starter-tabs\{[^}]*width:100%;[^}]*overflow-x:auto/);
});

test("mobile library keeps named categories outside the scrolling question list", () => {
  const html = render();
  const panel = html.match(/<div class="sheet question-sheet"[\s\S]*?<\/div><\/div>/)?.[0] || "";

  const askTools = panel.match(/<button[^>]*data-starter-category="investigate"[^>]*>Ask tools<\/button>/)?.[0] || "";
  assert.match(askTools, /aria-selected="true"/);
  assert.match(panel, /<div class="starter-tabs"[^>]*>[\s\S]*?<\/div>\s*<div class="question-scroll" id="questionScroll">\s*<div class="ask-follow question-library"/);
  assert.match(html, /\.question-sheet \.sheet-body\{[^}]*overflow:hidden/);
  assert.match(html, /\.question-scroll\{[^}]*overflow-y:auto/);
  assert.match(html, /starterCategory='investigate'/);
});

test("visible specialist mode controls send an explicit validated mode", () => {
  const html = render();

  for (const mode of ["auto", "verify", "autopsy", "scenario"]) {
    assert.match(html, new RegExp(`data-ask-mode="${mode}"`));
  }
  assert.match(html, /mode:mode/);
  assert.match(html, /function setAskMode\(mode\)/);
});

test("selected Ask mode has a brief plain-language explanation", () => {
  const html = render();

  assert.match(html, /id="askModeHint"[^>]*>Choose the best answer path<\/p>/);
  assert.match(html, /data-ask-mode="verify"[^>]*data-mode-hint="Test each claim against game evidence"/);
  assert.match(html, /data-ask-mode="autopsy"[^>]*data-mode-hint="Trace a live result through rules and recent changes"/);
  assert.match(html, /data-ask-mode="scenario"[^>]*data-mode-hint="Project a bounded demand or supply shock"/);
  assert.match(html, /askModeHint\.textContent=button\.dataset\.modeHint/);
});

test("changelog bullets keep wrapped Markdown continuation lines", () => {
  const html = page.changelogPage();

  assert.match(html, /what a Logistics Command does and does not control\./);
  assert.match(html, /live state, game rules, and recently shipped changes/);
});

test("visualizations are on by default and constrained by the prompt", () => {
  const html = render();
  const off = prompt.build();
  const on = prompt.build({ visualizations: true });

  // On unless explicitly turned off. The prompt constraints below are what keep
  // that safe: the model still only draws one when it genuinely helps.
  assert.match(html, /localStorage\.getItem\('ask\.visualizations'\)!=='false'/);
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

test("the prompt permits generic military mechanics without live force claims", () => {
  const text = require("./prompt").build({});
  assert.match(text, /General military mechanics are allowed/);
  assert.match(text, /What does a Logistics Command do/);
});

test("the moderator prompt permits private investigations without weakening abuse safeguards", () => {
  const text = prompt.build({ privateAccess: true });
  assert.match(text, /PRIVATE MODERATOR ACCESS/);
  assert.match(text, /private player and corporation data/i);
  assert.match(text, /live force composition, rosters, readiness, and deployments/i);
  assert.doesNotMatch(text, /never confirm the presence or absence of a specific military asset/i);
  assert.match(text, /Refuse actionable help exploiting bugs/i);
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
  // Depth comes from monochrome gradients only: the accent stays pure white on
  // black (dark) and pure black on white (light), never a dashboard hue.
  assert.match(html, /--accent:#fff/);
  assert.match(html, /--accent:#050505/);
  const gradients = html.match(/(?:radial|linear)-gradient\([^)]*\)/g) || [];
  for (const g of gradients) {
    for (const hex of g.match(/#[0-9a-f]{3,8}\b/gi) || []) {
      const h = hex.slice(1);
      const [r, gg, b] = h.length < 6
        ? [h[0] + h[0], h[1] + h[1], h[2] + h[2]]
        : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
      assert.ok(r === gg && gg === b, `colored gradient stop ${hex} in ${g}`);
    }
  }
});

test("surfaces live-data mode beside the composer and labels corporation context", () => {
  const html = render();

  assert.match(html, /id="liveMode"/);
  assert.match(html, /Code sources/);
  assert.match(html, /CEO of Lakeside/);
  assert.match(html, /Compare Lakeside with its public peers/);
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
  const map = JSON.parse(names[1]);
  const providers = all.match(/var MODEL_PROVIDERS=(\{.*?\});/);
  assert.ok(providers, "MODEL_PROVIDERS not injected into the client");
  const providerMap = JSON.parse(providers[1]);
  const models = require("./models");
  for (const id of Object.values(models.CHAINS).flat()) {
    assert.ok(map[id], `${id} is routable but has no display name`);
    assert.ok(!map[id].includes("/"), `${id} display name leaks a vendor slug`);
    assert.ok(providerMap[id], `${id} is routable but has no provider name`);
  }

  // The tier badge is gone: the header shows model and provider provenance.
  assert.ok(!/function modelBadge/.test(all), "tier badge machinery should be removed");
  assert.ok(html.includes("flag flag-model"), "model chip markup missing");
  assert.ok(!html.includes('<span class="flag"></span>'), "empty tier badge span should be gone");
});

test("the visualization toggle is open to every tier and names the allowance", () => {
  // It used to be disabled with a "supporter feature" note. Visualizations are
  // metered now, so the control is live for everyone and says how many they get.
  const player = { allowed: true, label: "Player", questions: 5, mcp: 2, viz: 2, visualizations: true };
  const html = render({
    entitlement: player,
    usage: { used: 0, limit: 5, remaining: 5, mcpUsed: 0, mcpLimit: 2, mcpRemaining: 2,
      vizUsed: 0, vizLimit: 2, vizRemaining: 2, resetAt: Date.now() + 86400000 },
  });
  const panel = html.match(/<div class="sheet" id="settingsPanel"[\s\S]*?<!-- settings:end -->/)?.[0] || "";

  assert.doesNotMatch(panel, /id="visualizations" disabled/);
  assert.doesNotMatch(panel, /setting-locked/);
  assert.doesNotMatch(panel, /supporter feature/i);
  assert.match(panel, /2 a day on your plan/);
  assert.match(html, /var VIZ_ALLOWED=true;/);
});

test("running out of charts is explained as a daily allowance, not a locked tier", () => {
  const html = render();
  assert.match(html, /charts and maps for today, so this one is answered in prose/);
  assert.match(html, /allowance resets at midnight UTC/);
  assert.doesNotMatch(html, /Charts, diagrams, and game maps are a supporter feature/);
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
    assert.ok(html.includes(`<b>${tier.label}</b> ${tier.questions} questions a day`), `${tier.label} budget missing or stale`);
    assert.ok(html.includes(`${tier.viz} with a chart or map`), `${tier.label} chart allowance missing`);
  }
  // Charts are advertised as an allowance every tier has, not a locked feature.
  assert.ok(html.includes(`${auth.PLAYER.viz} with a chart or map`));
  assert.doesNotMatch(html, /charts and maps<\/div>/);
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

test("another game's page never shows the asker's AHD character or corporation", () => {
  const games = require("./games");
  // Unique names: "Lakeside"/"Ada" would collide with the site's own copy.
  const persona = {
    username: "probe",
    character: { name: "Zzada Kestrel", country: "United Kingdom", party: "Liberal" },
    corporation: { name: "Zzcorp Holdings" },
  };
  const html = render({ game: games.resolve("grand-century"), context: persona });
  assert.ok(!html.includes("Zzada"), "character name leaked onto another game's page");
  assert.ok(!html.includes("Zzcorp"), "corporation name leaked onto another game's page");
  const ahd = render({ game: games.resolve("ahd"), context: persona });
  assert.ok(ahd.includes("Zzada"), "AHD page still shows the persona");
});

// ── Console: audience and volume ────────────────────────────────────────────
function activityFixture() {
  const series = [
    { day: "2026-08-24", questions: 4, live: 2, cached: 0, askers: 2, up: 1, down: 0, cost: 0.01, dau: 3, wau: 5, newUsers: 1, tokensIn: 8000, tokensOut: 2000, tokens: 10000, tokensCumulative: 1060000 },
    { day: "2026-08-25", questions: 44, live: 21, cached: 1, askers: 7, up: 2, down: 1, cost: 0.2, dau: 10, wau: 14, newUsers: 6, tokensIn: 70000, tokensOut: 20000, tokens: 90000, tokensCumulative: 1150000 },
    { day: "2026-08-26", questions: 9, live: 5, cached: 0, askers: 3, up: 0, down: 0, cost: 0.01, dau: 4, wau: 15, newUsers: 0, tokensIn: 40000, tokensOut: 10000, tokens: 50000, tokensCumulative: 1200000 },
  ];
  return {
    windowDays: 7, days: 3, series,
    totals: { questions: 57, live: 28, cached: 1, cost: 0.22, up: 3, down: 1, newUsers: 7, tokensIn: 118000, tokensOut: 32000, tokens: 150000 },
    active: { wau: 15, prevWau: 5, dau: 4, windowActive: 15, byProvider: { ahd: 14, discord: 1 }, keys: ["ahd:1"] },
    questionsToday: 9, perDay: 19,
    tokens: { perDay: 50000, today: 50000, beforeWindow: 1050000, allTime: 1200000 },
  };
}

test("the console leads with active users and questions per day", () => {
  const html = page.consolePage({
    users: [{ user_key: "ahd:1", username: "Tester", question_count: 3 }],
    activity: activityFixture(), days: 30,
  });
  assert.match(html, /Active users \(7d\)/);
  assert.match(html, />15</, "the weekly-active count is shown");
  assert.match(html, /14 ahd · 1 discord/, "and where those people came from");
  assert.match(html, /\+200% vs previous 7d/, "with the change against the previous week");
  assert.match(html, /Questions per day/);
  assert.match(html, /Questions today/);
  assert.match(html, /Active today/);
});

test("each measure gets its own chart rather than a second y-axis", () => {
  const html = page.consolePage({ users: [], activity: activityFixture() });
  const charts = html.match(/<svg class="viz"/g) || [];
  assert.equal(charts.length, 4, "questions, users, tokens/day and the running total are four charts");
  assert.match(html, /aria-label="Questions: 57 across 3 days, peak 44 on Aug 25\./);
  assert.match(html, /aria-label="Active that day: 17 across 3 days, peak 10 on Aug 25\./);
  assert.match(html, /aria-label="Tokens: 150K across 3 days, peak 90K on Aug 25\./);
  assert.match(html, /aria-label="Running total reaching 1\.2M tokens on Aug 26\./);
});

test("chart values stay reachable without reading the picture", () => {
  const html = page.consolePage({ users: [], activity: activityFixture() });
  assert.match(html, /View the numbers/, "a table view backs every chart");
  assert.match(html, /<title>Aug 25: 44 questions · Used live game data 21<\/title>/, "and each column names its own value");
});

test("the console flags which users are still active", () => {
  const html = page.consolePage({
    users: [
      { user_key: "ahd:1", username: "Present", question_count: 3 },
      { user_key: "ahd:2", username: "Gone", question_count: 1 },
    ],
    activity: activityFixture(),
  });
  const present = html.match(/Present[\s\S]{0,220}?<\/td>/)[0];
  const gone = html.match(/Gone[\s\S]{0,220}?<\/td>/)[0];
  assert.match(present, /badge-active/);
  assert.doesNotMatch(gone, /badge-active/);
});

test("the console splits into tabs so one screen is not four dashboards", () => {
  const html = page.consolePage({ users: [], activity: activityFixture(), tab: "users" });
  for (const label of ["Overview", "Users", "Quality", "Corrections"]) {
    assert.match(html, new RegExp(`data-tab="[a-z]+"[^>]*>${label}`), `${label} tab is present`);
  }
  assert.match(html, /<div data-panel="users">/, "the requested tab is the open one");
  assert.match(html, /<div data-panel="overview" hidden>/, "the others render hidden, not absent");
});

test("an empty range says so instead of drawing an empty grid", () => {
  const html = page.consolePage({
    users: [],
    activity: { windowDays: 7, days: 7, series: [], totals: {}, active: {}, questionsToday: 0, perDay: 0 },
  });
  assert.match(html, /Nothing recorded in this range yet/);
  assert.doesNotMatch(html, /<svg class="viz"/);
});

test("the console reports tokens per day and the lifetime total", () => {
  const html = page.consolePage({ users: [], activity: activityFixture(), days: 30 });
  assert.match(html, /Tokens per day<\/small><b>50K<\/b>/, "a daily rate, compacted to stay readable");
  assert.match(html, /Tokens all time<\/small><b>1\.2M<\/b>/);
  assert.match(html, /Tokens \(30d\)<\/small><b>150K<\/b>/);
  assert.match(html, /118K in · 32K out/, "split by direction, since output is the expensive half");
  assert.match(html, /Total tokens served/);
  assert.match(html, /carries forward the 1\.1M tokens served before this range/, "the running total is lifetime, not per-range");
});

test("the token stack separates prompt from generated without relying on colour", () => {
  const html = page.consolePage({ users: [], activity: activityFixture() });
  const legend = html.match(/<div class="viz-legend">(?:(?!<\/div>).)*seg-out(?:(?!<\/div>).)*<\/div>/)[0];
  assert.match(legend, /Generated \(out\)/);
  assert.match(legend, /Prompt \(in\)/, "both segments are named in the legend");
  assert.match(html, /<title>Aug 25: 90K tokens · Prompt \(in\) 70K · Generated \(out\) 20K<\/title>/);

  // The 2px surface gap belongs BETWEEN the segments, not under the stack: the
  // bottom segment must still sit on the baseline. Both paths open "M x bottom
  // V top", so the two edges either side of the gap are directly comparable.
  const col = html.match(/<title>Aug 25: 90K tokens[\s\S]*?<\/g>/)[0];
  const inSeg = col.match(/d="M[\d.]+ ([\d.]+)V([\d.]+)[^"]*" class="viz-bar seg-in"/);
  const outSeg = col.match(/d="M[\d.]+ ([\d.]+)V([\d.]+)[^"]*" class="viz-bar seg-out"/);
  assert.ok(inSeg && outSeg, "both segments are drawn");
  const [inBottom, inTop] = [Number(inSeg[1]), Number(inSeg[2])];
  const outBottom = Number(outSeg[1]);
  assert.equal(inTop - outBottom, 2, "exactly 2px of surface separates the segments");
  assert.equal(inBottom, 224, "and the stack still rests on the baseline");
});

// ── Review + questions screens ──────────────────────────────────────────────
function card(over = {}) {
  return {
    id: 7, question: "How is inflation recalculated?", answer: "## Inputs\n\nIt runs in the `inflationRecalc` phase.",
    user_key: "ahd:1", username: "Tester", role: "player", country: "US", ts: 1787000000000,
    used_mcp: 1, cached: 0, model: "deepseek-v4-flash", plan: { id: "general" },
    validation: { issues: ["truncated"] }, evidence: { tools: ["country_fiscal"] },
    tokens_in: 100, tokens_out: 50, estimated_cost: 0.001, ttft_ms: 2600, ...over,
  };
}
const COUNTS = { total: 229, pending: 194, reviewed: 12, good: 8, bad: 3, skipped: 1, playerJudged: 20, modelJudged: 6, emptyAnswers: 9 };

test("the review deck ships its cards to the client and names what is left", () => {
  const html = page.reviewPage({ identity: {}, context: { isAdmin: true }, cards: [card()], counts: COUNTS });
  assert.match(html, /Left to judge<\/small><b>194<\/b>/);
  assert.match(html, /never seen by us or the sampler/);
  assert.match(html, /Already covered<\/small><b>26<\/b>/, "20 player-rated plus 6 sampler-graded");
  assert.match(html, /20 rated by players · 6 by the sampler/);
  assert.match(html, /var DECK = \[\{/, "the deck is embedded, so judging a card costs no page load");
  assert.match(html, /"question":"How is inflation recalculated\?"/);
});

test("the review screen is keyboard-first", () => {
  const html = page.reviewPage({ identity: {}, context: { isAdmin: true }, cards: [card()], counts: COUNTS });
  assert.match(html, /e\.key==='ArrowRight'/);
  assert.match(html, /e\.key==='ArrowLeft'/);
  assert.match(html, /e\.key===' '\|\|e\.key==='ArrowDown'/);
  assert.match(html, /e\.key==='z'\|\|e\.key==='Z'/);
  assert.match(html, /<kbd>←<\/kbd>/);
});

test("a bad verdict asks why, because it seeds a correction", () => {
  const html = page.reviewPage({ identity: {}, context: { isAdmin: true }, cards: [card()], counts: COUNTS });
  assert.match(html, /Why was it bad\?/);
  assert.match(html, /This seeds a correction draft/);
  assert.match(html, /data-reason="Wrong facts"/);
  assert.match(html, /File without a reason/, "but it never blocks on one");
  assert.match(html, /if\(btn\.dataset\.verdict==='bad'\) openReason\(\);/);
});

test("the review card renders the answer as the player saw it", () => {
  const html = page.reviewPage({ identity: {}, context: { isAdmin: true }, cards: [card()], counts: COUNTS });
  assert.match(html, /<div class="rev-a" data-md><\/div>/, "the body is empty in the HTML");
  assert.match(html, /body\.textContent = DECK\[0\]\.answer/, "and filled as text, so an answer cannot inject");
  assert.match(html, /window\.__hydrateShared/);
  assert.doesNotMatch(html, /## Inputs<\/div>/, "raw markdown never reaches the card body");
});

test("an empty deck says the queue is clear rather than showing a blank card", () => {
  const html = page.reviewPage({ identity: {}, context: { isAdmin: true }, cards: [], counts: { ...COUNTS, pending: 0 } });
  assert.match(html, /Queue clear/);
  assert.match(html, /var DECK = \[\]/);
});

test("the questions screen lists newest first and hides nothing", () => {
  const rows = [
    { ...card({ id: 9, question: "Newest", ts: 1787000002000 }), review_rating: "good", review_by: "egg" },
    { ...card({ id: 8, question: "Middle", ts: 1787000001000 }), feedback_rating: "down", feedback_reason: "wrong" },
    { ...card({ id: 7, question: "Oldest", ts: 1787000000000 }) },
  ];
  const html = page.questionsPage({
    identity: {}, context: { isAdmin: true },
    feed: { rows, total: 229, limit: 50, offset: 0 }, counts: COUNTS, pageNum: 1,
  });
  assert.ok(html.indexOf("Newest") < html.indexOf("Middle"), "order is preserved as given");
  assert.ok(html.indexOf("Middle") < html.indexOf("Oldest"));
  assert.match(html, /judged by egg/);
  assert.match(html, /player said “wrong”/);
  assert.match(html, /Review the 194 unjudged/);
  assert.match(html, /Page 1 of 5 · 229 questions/);
});

test("the questions screen filters by review state without losing the search", () => {
  const html = page.questionsPage({
    identity: {}, context: { isAdmin: true }, feed: { rows: [], total: 0, limit: 50, offset: 0 },
    counts: COUNTS, pageNum: 1, search: "inflation", state: "bad",
  });
  assert.match(html, /href="\/console\/questions\?q=inflation&amp;state=good"/, "switching state keeps the query");
  assert.match(html, /<input type="hidden" name="state" value="bad">/, "and searching keeps the state");
  assert.match(html, /value="inflation"/);
  assert.match(html, /No questions match that filter/);
});

test("every console screen carries the same nav", () => {
  const review = page.reviewPage({ identity: {}, context: { isAdmin: true }, cards: [], counts: COUNTS });
  const questions = page.questionsPage({ identity: {}, context: { isAdmin: true }, feed: { rows: [], total: 0, limit: 50, offset: 0 }, counts: COUNTS });
  for (const html of [review, questions]) {
    assert.match(html, /href="\/console"[^>]*>Dashboard/);
    assert.match(html, /href="\/console\/review"[^>]*>Review/);
    assert.match(html, /href="\/console\/questions"[^>]*>Questions/);
  }
  assert.match(review, /href="\/console\/review" aria-current="page"/);
  assert.match(questions, /href="\/console\/questions" aria-current="page"/);
});

test("an answer cannot break out of the embedded deck", () => {
  const html = page.reviewPage({
    identity: {}, context: { isAdmin: true }, counts: COUNTS,
    cards: [card({ answer: "</script><script>alert(1)</script>", question: "<img src=x onerror=alert(1)>" })],
  });
  const block = html.match(/var DECK = ([\s\S]*?);\n/)[1];
  assert.doesNotMatch(block, /<\/script>/i, "the closing tag is escaped inside the JSON");
  assert.match(block, /\\u003c\/script\\u003e/);
  assert.match(block, /\\u003cimg src=x onerror=alert\(1\)\\u003e/, "and so is the question");
});

test("a chart the player cannot have is explained BY the model, not just the chrome", () => {
  const quota = prompt.build({ visualizations: false, visualizationLimit: { reason: "quota", limit: 2, used: 2 } });
  assert.match(quota, /Do not include Mermaid diagrams/);
  assert.match(quota, /used all 2 of today's visualizations/);
  assert.match(quota, /resets at 00:00 UTC/);
  assert.match(quota, /close with ONE short sentence saying the chart was left out and why/i);
  assert.match(quota, /a table is fine and is not a visualization/);
  assert.match(quota, /Never pretend you drew a chart/);

  // No request, no apology: an ordinary prose question must not pick one up.
  const plain = prompt.build({ visualizations: false });
  assert.doesNotMatch(plain, /left out and why/);
  assert.doesNotMatch(plain, /visualizations \(the allowance/);
});

test("the thumbs on the questions list file the same verdict the review deck does", () => {
  const rows = [
    { id: 9, question: "Rated good", answer: "body", ts: 1, user_key: "a:1", username: "u", plan: {}, validation: {}, evidence: {}, review_rating: "good" },
    { id: 8, question: "Unjudged", answer: "body", ts: 1, user_key: "a:1", username: "u", plan: {}, validation: {}, evidence: {} },
  ];
  const html = page.questionsPage({
    identity: {}, context: { isAdmin: true },
    feed: { rows, total: 2, limit: 50, offset: 0 }, counts: { pending: 1 }, pageNum: 1,
  });
  assert.match(html, /data-rate="good"/);
  assert.match(html, /data-rate="bad"/);
  assert.match(html, /<span class="q-thumbs" data-id="9" data-rating="good">/);
  assert.match(html, /<span class="q-thumbs" data-id="8" data-rating="">/);
  assert.match(html, /class="q-thumb up on"[^>]*aria-pressed="true"/);
  assert.match(html, /fetch\(url,\{method:'POST'/);
  assert.match(html, /'\/api\/console\/review\/undo'/, "clicking a lit thumb clears the verdict");
  // The thumbs sit inside <summary>; without this every click also opens the row.
  assert.match(html, /e\.preventDefault\(\); e\.stopPropagation\(\);/);
});

test("a staff thumb is never rendered as a player verdict", () => {
  const html = page.questionsPage({
    identity: {}, context: { isAdmin: true }, counts: {}, pageNum: 1,
    feed: { total: 1, limit: 50, offset: 0, rows: [
      { id: 9, question: "Staff said bad, player said nothing", answer: "b", ts: 1, user_key: "a:1",
        plan: {}, validation: {}, evidence: {}, review_rating: "bad" },
    ] },
  });
  assert.doesNotMatch(html, /player reported/);
  assert.doesNotMatch(html, /player liked/);
  assert.match(html, /data-rating="bad"/);
});

test("an answer says which live game data it read, separately from its file citations", () => {
  const html = render();
  assert.match(html, /var lv=\(d\.liveSources\|\|\[\]\)/);
  assert.match(html, /Live game data read/);
  assert.match(html, /livechip/);
  // Distinct from the file citation list, which is a different kind of evidence.
  assert.match(html, /Sources used \('\+cs\.length\+'\)/);
  assert.match(html, /\.livesrc\{[^}]*display:flex/);
});

test("reasoning effort is a staff control and length is everyone's", () => {
  const router = require("./router");
  const staff = render({ efforts: router.EFFORTS });
  const player = render();
  const panelOf = h => h.match(/<div class="sheet" id="settingsPanel"[\s\S]*?<!-- settings:end -->/)?.[0] || "";

  assert.match(panelOf(staff), /Reasoning effort/);
  assert.match(panelOf(staff), /data-opt="effort"/);
  assert.doesNotMatch(panelOf(player), /Reasoning effort/, "players get no dial they have no basis to set");
  // Length is a separate control for everyone, and says so.
  for (const html of [staff, player]) {
    assert.match(panelOf(html), /Response length/);
    assert.match(panelOf(html), /Independent of how hard the model thinks/);
  }
  // Whatever is chosen has to actually reach the server.
  assert.match(staff, /effort:S\.effort/);
});

test("live data and visualizations are on by default, and an explicit off still wins", () => {
  const html = render();
  // Defaulting off meant the two most interesting things Ask does were invisible
  // until a player went looking in Settings for them.
  assert.match(html, /live\.checked=localStorage\.getItem\('ask\.live'\)!=='false'/);
  assert.match(html, /visualizations\.checked=VIZ_ALLOWED&&localStorage\.getItem\('ask\.visualizations'\)!=='false'/);
  // Not simply forced on: someone who turned them off keeps them off.
  assert.doesNotMatch(html, /live\.checked=true;\s*$/m);
});
