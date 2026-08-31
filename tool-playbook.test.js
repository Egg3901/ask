const test = require("node:test");
const assert = require("node:assert/strict");

const toolPlaybook = require("./tool-playbook");

test("renders one when-to-use line per offered tool it knows", () => {
  const block = toolPlaybook.block(["search_code", "macro_history", "wars", "fx_quote"]);
  assert.match(block, /^WHEN TO USE EACH TOOL:\n/);
  assert.match(block, /- search_code: /);
  // The trap travels with the tool: the line carries the judgment, not just a label.
  assert.match(block, /- macro_history: .*STATE or REGION, not country/);
  assert.match(block, /- wars: .*no rosters or strength rankings/i);
  assert.match(block, /- fx_quote: .*pair direction/);
  assert.equal(block.split("\n").length, 5);
});

test("skips unknown tool names and collapses repeats", () => {
  const block = toolPlaybook.block(["search_code", "some_future_tool", "search_code"]);
  assert.doesNotMatch(block, /some_future_tool/);
  assert.equal(block.split("\n").filter(line => line.startsWith("- ")).length, 1);
  assert.equal(toolPlaybook.block(["some_future_tool"]), "");
  assert.equal(toolPlaybook.block([]), "");
  assert.equal(toolPlaybook.block(null), "");
});

test("covers the full offered surface with compact lines", () => {
  const expected = [
    "search_code", "grep_code", "read_file", "calculate", "search_history",
    "show_change", "list_capabilities", "game_overview", "entity_search",
    "countries", "macro_history", "character_wealth_history",
    "character_balance_sheet", "wars", "trace_corp", "trace_sector",
    "trace_race", "trace_election", "trace_approval", "corporation_rankings",
    "analytics_catalog", "analytics_query", "fx_quote", "map_snapshot",
    "geo_aggregate", "country_fiscal", "legislation_catalog", "elections",
    "top_players", "parties", "community_search",
  ];
  for (const name of expected) assert.ok(toolPlaybook.LINES[name], `missing line for ${name}`);
  // Under 140 chars rendered keeps the whole block around 30 readable lines.
  for (const [name, line] of Object.entries(toolPlaybook.LINES)) {
    assert.ok(`- ${name}: ${line}`.length < 140, `${name} line too long`);
  }
  // Authority ordering is method, not fact: the low tiers name their better source.
  assert.match(toolPlaybook.LINES.character_balance_sheet, /character_wealth_history/);
  assert.match(toolPlaybook.LINES.analytics_catalog, /before analytics_query/);
});

test("the investigator appends the block for the tools it actually offered", () => {
  const source = require("node:fs").readFileSync(require.resolve("./investigate.js"), "utf8");
  assert.match(source, /require\("\.\/tool-playbook"\)/);
  // Built from the offered defs, then appended to the system prompt.
  assert.match(source, /toolPlaybook\.block\(defs\.map\(def => def\.function\.name\)\)/);
  assert.match(source, /content: SYSTEM \+ \(toolGuide \? `\\n\\n\$\{toolGuide\}` : ""\)/);
});
