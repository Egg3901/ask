"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const maps = require("./map-visualization");

const italy = {
  scope: "country",
  country: "IT",
  title: "Regional unemployment",
  metric: "unemployment rate",
  unit: "%",
  regions: [
    { id: "IT_LAZ", label: "Lazio", value: 8.2 },
    { id: "IT_LOM", label: "Lombardy", value: 4.1 },
  ],
};

test("normalizes a country map and infers a harmful-high palette", () => {
  const spec = maps.normalize(italy);
  assert.equal(spec.scope, "country");
  assert.equal(spec.country, "IT");
  assert.equal(spec.palette, "bad");
  assert.equal(spec.regions.length, 2);
});

test("rejects invalid map scopes and unsupported country maps", () => {
  assert.throws(() => maps.normalize({ scope: "planet", regions: [{ id: "IT", value: 1 }] }));
  assert.throws(() => maps.normalize({ scope: "country", country: "ZZ", regions: [{ id: "X", value: 1 }] }));
  assert.throws(() => maps.normalize({ scope: "world", regions: [] }));
});

test("infers semantic palettes from metric meaning", () => {
  assert.equal(maps.inferPalette("approval rating"), "good");
  assert.equal(maps.inferPalette("budget deficit change"), "balance");
  assert.equal(maps.inferPalette("economic lean"), "lean");
  assert.equal(maps.inferPalette("population"), "magnitude");
});

test("colors higher values according to whether high is good or bad", () => {
  const bad = maps.normalize(italy);
  const good = maps.normalize({ ...italy, metric: "approval", palette: "good" });
  assert.equal(maps.regionColor(bad, bad.regions[0]), "#dc2626");
  assert.equal(maps.regionColor(good, good.regions[0]), "#16a34a");
});

test("canonical palette preserves validated game colors", () => {
  const spec = maps.normalize({
    ...italy,
    palette: "canonical",
    regions: [{ id: "IT_LAZ", value: 1, color: "#123ABC" }],
  });
  assert.equal(maps.regionColor(spec, spec.regions[0]), "#123abc");
});

test("renders a responsive SVG from the game's country geometry", async () => {
  const svg = await maps.renderSvg(italy);
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 1200 760"/);
  assert.match(svg, /Regional unemployment/);
  assert.match(svg, /Lazio: 8\.2 %/);
  assert.match(svg, /Higher · 8\.2 %/);
  assert.ok((svg.match(/<path /g) || []).length > 5);
});

test("renders a bounded PNG suitable for Discord", async () => {
  const png = await maps.renderPng(italy);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length < 8 * 1024 * 1024);
});

test("renders a readable categorical legend for canonical game colors", async () => {
  const svg = await maps.renderSvg({
    scope: "country", country: "IT", title: "Sector specialization",
    metric: "sector specialization", unit: "sector", palette: "canonical",
    regions: [
      { id: "IT_LAZ", label: "Lazio", value: 1, color: "#06b6d4", detail: "Lazio · Primary: Technology (+10pp)" },
      { id: "IT_LOM", label: "Lombardy", value: 2, color: "#3b82f6", detail: "Lombardy · Primary: Media (+10pp)" },
    ],
  });
  assert.match(svg, />Technology<\/text>/);
  assert.match(svg, />Media<\/text>/);
});
