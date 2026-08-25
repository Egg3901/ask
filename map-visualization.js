"use strict";

const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const topojson = require("topojson-client");

const WORLD_GEO_URL = "https://cdn.ahousedividedgame.com/static/maps/countries-110m.json";
const MAP_ROOT = process.env.GAME_MAP_ROOT || "/root/projects/a-house-divided/public";
const MAX_REGIONS = 100;
const svgCache = new Map();

const WORLD_IDS = {
  "840": "US", "826": "UK", "276": "DE", "392": "JP", "372": "IE",
  "076": "BR", "156": "CN", "566": "NG", "348": "HU", "616": "PL",
  "642": "RO", "890": "YU", "100": "BG", "112": "BLR", "804": "UKR",
  "200": "CS", "643": "RU", "250": "FR", "380": "IT", "724": "ES",
  "752": "SE", "792": "TR", "300": "GR", "040": "AT", "246": "FI",
  "278": "DD",
};

const COUNTRY_FILES = {
  US: "usa-regions.json", UK: "british-isles-regions.json", DE: "germany-regions.json",
  JP: "japan-regions.json", IE: "ie-regions.json", BR: "br-regions.json",
  CN: "cn-regions.json", NG: "ng-regions.json", HU: "hu-regions.json",
  PL: "pl-regions.json", RO: "ro-regions.json", YU: "yu-regions.json",
  BG: "bg-regions.json", BLR: "blr-regions.json", UKR: "ua-regions.json",
  CS: "cs-regions.json", RU: "ru-regions.json", FR: "fr-regions.json",
  IT: "it-regions.json", ES: "es-regions.json", SE: "se-regions.json",
  TR: "tr-regions.json", GR: "gr-regions.json", AT: "at-regions.json",
  FI: "fi-regions.json", DD: "dd-regions.json", BAL: "bal-regions.json",
};

const PALETTES = new Set(["good", "bad", "magnitude", "balance", "lean", "canonical"]);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function cleanText(value, max = 100) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function inferPalette(metric) {
  const value = String(metric || "").toLowerCase();
  if (/lean|ideolog|left|right/.test(value)) return "lean";
  if (/change|balance|surplus|deficit|gap|net /.test(value)) return "balance";
  if (/unemployment|inflation|poverty|shortage|debt|cost|risk|loss|mortality/.test(value)) return "bad";
  if (/approval|growth|income|profit|turnout|employment|literacy|health|share/.test(value)) return "good";
  return "magnitude";
}

function normalize(spec) {
  if (!spec || typeof spec !== "object") throw new Error("Map specification must be an object");
  const scope = spec.scope === "country" ? "country" : spec.scope === "world" ? "world" : null;
  if (!scope) throw new Error("Map scope must be world or country");
  const country = scope === "country" ? cleanText(spec.country, 3).toUpperCase() : null;
  if (scope === "country" && !COUNTRY_FILES[country]) throw new Error("Unsupported country map");
  const metric = cleanText(spec.metric || spec.title || "value", 80);
  const palette = PALETTES.has(spec.palette) ? spec.palette : inferPalette(metric);
  const regions = (Array.isArray(spec.regions) ? spec.regions : [])
    .map(row => ({
      id: cleanText(row?.id, 20).toUpperCase(),
      label: cleanText(row?.label || row?.id, 70),
      value: Number(row?.value),
      color: /^#[0-9a-f]{6}$/i.test(row?.color || "") ? row.color.toLowerCase() : null,
      detail: cleanText(row?.detail, 120),
    }))
    .filter(row => row.id && Number.isFinite(row.value))
    .slice(0, MAX_REGIONS);
  if (!regions.length) throw new Error("Map has no numeric regions");
  return {
    scope, country, metric, palette, regions,
    title: cleanText(spec.title || metric, 120),
    unit: cleanText(spec.unit, 30),
    source: cleanText(spec.source || "Live game data", 80),
    center: Number.isFinite(Number(spec.center)) ? Number(spec.center) : 0,
  };
}

function hexToRgb(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function mix(a, b, t) {
  const left = hexToRgb(a), right = hexToRgb(b);
  const parts = left.map((value, index) => Math.round(value + (right[index] - value) * Math.max(0, Math.min(1, t))));
  return `#${parts.map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

function scaleInfo(spec) {
  const values = spec.regions.map(row => row.value);
  const min = Math.min(...values), max = Math.max(...values);
  const bound = Math.max(Math.abs(min - spec.center), Math.abs(max - spec.center), 1e-9);
  return { min, max, bound };
}

function regionColor(spec, row, info = scaleInfo(spec)) {
  if (spec.palette === "canonical" && row.color) return row.color;
  if (spec.palette === "balance" || spec.palette === "lean") {
    const relative = Math.max(-1, Math.min(1, (row.value - spec.center) / info.bound));
    const low = spec.palette === "lean" ? "#dc2626" : "#dc2626";
    const high = spec.palette === "lean" ? "#2563eb" : "#16a34a";
    return relative < 0 ? mix("#e5e7eb", low, -relative) : mix("#e5e7eb", high, relative);
  }
  const t = info.max === info.min ? 0.65 : (row.value - info.min) / (info.max - info.min);
  if (spec.palette === "good") return mix("#fee2e2", "#16a34a", t);
  if (spec.palette === "bad") return mix("#dcfce7", "#dc2626", t);
  return mix("#e2e8f0", "#7c3aed", t);
}

function legendWords(palette) {
  if (palette === "good") return ["Lower", "Higher is better"];
  if (palette === "bad") return ["Lower is better", "Higher"];
  if (palette === "balance") return ["Negative", "Positive"];
  if (palette === "lean") return ["Left / liberal", "Right / traditional"];
  if (palette === "canonical") return ["Game-defined colors", ""];
  return ["Lower", "Higher"];
}

function legendColors(palette) {
  const endpoints = palette === "good" ? ["#fee2e2", "#16a34a"]
    : palette === "bad" ? ["#dcfce7", "#dc2626"]
      : palette === "balance" ? ["#dc2626", "#e5e7eb", "#16a34a"]
        : palette === "lean" ? ["#dc2626", "#e5e7eb", "#2563eb"]
          : ["#e2e8f0", "#7c3aed"];
  return Array.from({ length: 9 }, (_unused, index) => {
    const t = index / 8;
    if (endpoints.length === 2) return mix(endpoints[0], endpoints[1], t);
    return t <= 0.5 ? mix(endpoints[0], endpoints[1], t * 2) : mix(endpoints[1], endpoints[2], (t - 0.5) * 2);
  });
}

function canonicalLabel(row) {
  const detail = String(row.detail || "");
  const sector = detail.match(/\bPrimary:\s*([^·(]+)/i)?.[1]?.trim();
  if (sector) return sector;
  const first = detail.split("·").map(part => part.trim()).find(part => part && part !== row.label);
  return (first ? first.split(":")[0] : row.label).slice(0, 24);
}

function canonicalLegend(spec, info) {
  if (/approval|lean/i.test(spec.metric)) {
    return `<text x="60" y="690" class="legend-label">Live game color scale · ${formatNumber(info.min)}${esc(spec.unit ? ` ${spec.unit}` : "")} to ${formatNumber(info.max)}${esc(spec.unit ? ` ${spec.unit}` : "")}</text>`;
  }
  const seen = new Set();
  const items = spec.regions.filter(row => row.color).map(row => ({ color: row.color, label: canonicalLabel(row) }))
    .filter(item => { const key = `${item.color}|${item.label}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 8);
  if (!items.length) return `<text x="60" y="700" class="legend-label">Colors come from the live game map mode</text>`;
  return items.map((item, index) => {
    const x = 60 + (index % 4) * 275, y = 680 + Math.floor(index / 4) * 32;
    return `<rect x="${x}" y="${y}" width="18" height="18" rx="4" fill="${item.color}"/><text x="${x + 27}" y="${y + 14}" class="legend-label">${esc(item.label)}</text>`;
  }).join("");
}

async function geometry(spec) {
  if (spec.scope === "world") {
    const response = await fetch(WORLD_GEO_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`World geometry returned ${response.status}`);
    const topology = await response.json();
    const object = topology.objects?.countries || Object.values(topology.objects || {})[0];
    return topojson.feature(topology, object).features;
  }
  const raw = await fs.readFile(`${MAP_ROOT}/${COUNTRY_FILES[spec.country]}`, "utf8");
  return JSON.parse(raw).features || [];
}

async function renderSvg(input) {
  const spec = normalize(input);
  const key = crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex");
  if (svgCache.has(key)) return svgCache.get(key);
  const d3 = await import("d3-geo");
  const features = await geometry(spec);
  const W = 1200, H = 760, mapTop = 94, mapBottom = 650;
  const featureCollection = { type: "FeatureCollection", features };
  const projection = spec.scope === "world" ? d3.geoEqualEarth() : spec.country === "US" ? d3.geoAlbersUsa() : d3.geoMercator();
  projection.fitExtent([[46, mapTop], [W - 46, mapBottom]], featureCollection);
  const path = d3.geoPath(projection);
  const rows = new Map(spec.regions.map(row => [row.id, row]));
  const info = scaleInfo(spec);
  const rendered = [];
  const labelRows = [];
  for (const feature of features) {
    const rawId = spec.scope === "world"
      ? WORLD_IDS[String(feature.id).padStart(3, "0")]
      : String(feature.properties?.regionCode || feature.properties?.id || feature.id || "").toUpperCase();
    if (!rawId) continue;
    const row = rows.get(rawId);
    const d = path(feature);
    if (!d) continue;
    const color = row ? regionColor(spec, row, info) : "#1f2937";
    const tooltip = row ? `${row.label}: ${formatNumber(row.value)}${spec.unit ? ` ${spec.unit}` : ""}${row.detail ? ` — ${row.detail}` : ""}` : `${rawId}: no data`;
    rendered.push(`<path d="${esc(d)}" fill="${color}" stroke="#0f172a" stroke-width="0.8"><title>${esc(tooltip)}</title></path>`);
    if (row && spec.scope === "country" && spec.regions.length <= 20) {
      const [x, y] = path.centroid(feature);
      if (Number.isFinite(x) && Number.isFinite(y)) labelRows.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="region-label">${esc(shortId(rawId, spec.country))}</text>`);
    }
  }
  const [leftWord, rightWord] = legendWords(spec.palette);
  const legend = spec.palette === "canonical"
    ? canonicalLegend(spec, info)
    : `${legendColors(spec.palette).map((color, index) => `<rect x="${60 + index * 40}" y="680" width="41" height="18" fill="${color}"/>`).join("")}<text x="60" y="720" class="legend-label">${esc(leftWord)} · ${formatNumber(info.min)}${esc(spec.unit ? ` ${spec.unit}` : "")}</text><text x="420" y="720" text-anchor="end" class="legend-label">${esc(rightWord)} · ${formatNumber(info.max)}${esc(spec.unit ? ` ${spec.unit}` : "")}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}"><style>text{font-family:DejaVu Sans,Arial,sans-serif}.title{font-size:30px;font-weight:700;fill:#f8fafc}.subtitle{font-size:16px;fill:#94a3b8}.legend-label{font-size:14px;fill:#cbd5e1}.region-label{font-size:12px;font-weight:700;fill:#fff;paint-order:stroke;stroke:#0f172a;stroke-width:3px;stroke-linejoin:round}</style><rect width="1200" height="760" rx="24" fill="#111827"/><text x="48" y="48" class="title">${esc(spec.title)}</text><text x="48" y="76" class="subtitle">${esc(spec.metric)}${spec.unit ? ` · ${esc(spec.unit)}` : ""} · ${esc(spec.source)}</text><g>${rendered.join("")}${labelRows.join("")}</g>${legend}</svg>`;
  if (svgCache.size >= 100) svgCache.delete(svgCache.keys().next().value);
  svgCache.set(key, svg);
  return svg;
}

function shortId(id, country) {
  return id.replace(new RegExp(`^${country}_`), "").slice(0, 5);
}

function formatNumber(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Number(value.toFixed(abs < 10 ? 2 : 1)).toLocaleString("en-US");
}

async function renderPng(spec) {
  const svg = await renderSvg(spec);
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/magick", ["svg:-", "-resize", "1200x760", "png:-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill(), 20_000);
    const output = [], errors = [];
    let size = 0;
    child.stdout.on("data", chunk => { size += chunk.length; if (size <= 8 * 1024 * 1024) output.push(chunk); else child.kill(); });
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timer);
      return code === 0 && size > 0 && size <= 8 * 1024 * 1024
        ? resolve(Buffer.concat(output))
        : reject(new Error(Buffer.concat(errors).toString("utf8").slice(0, 300) || "Map conversion failed"));
    });
    child.stdin.end(svg);
  });
}

module.exports = { normalize, inferPalette, regionColor, renderSvg, renderPng, COUNTRY_FILES };
