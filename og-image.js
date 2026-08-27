"use strict";

// Per-session social card. When a shared conversation or a report is posted to
// Discord, Slack, X or iMessage, the unfurl shows this 1200x630 image built from
// that session's own question — not a generic logo. SVG is rasterised by the same
// ImageMagick + librsvg path the maps use, so no new dependency.
const { spawn } = require("node:child_process");

const W = 1200, H = 630;

function escapeXml(s) {
  return String(s == null ? "" : s).replace(/[<>&'"]/g, c =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

// SVG <text> does not wrap. Split into lines on word boundaries, sized to an
// approximate glyph width for the given font size, capped at maxLines with an
// ellipsis so a long question never overflows the card.
function wrap(text, fontSize, maxWidth, maxLines) {
  const perChar = fontSize * 0.54;
  const maxChars = Math.max(8, Math.floor(maxWidth / perChar));
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) { lines.push(line); line = w; }
    else line = next;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    const consumed = lines.join(" ").length;
    if (consumed < String(text || "").replace(/\s+/g, " ").trim().length) {
      lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:\s]+$/, "") + "…";
    }
  }
  return lines;
}

/**
 * Build the card SVG. `kind` is "Shared answer" | "Report"; `question` is the
 * headline; `footer` is the small meta line (model, turns, host).
 */
function cardSvg({ kind = "Shared answer", question = "", footer = "" }) {
  const lines = wrap(question, 56, W - 160, 4);
  const startY = 300 - (lines.length - 1) * 34;
  const body = lines.map((l, i) =>
    `<text x="80" y="${startY + i * 72}" font-family="DejaVu Sans, sans-serif" font-size="56" font-weight="700" fill="#f4f6fb">${escapeXml(l)}</text>`
  ).join("");
  // Monochrome, matching Ask's deliberate white-on-OLED-black brand.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="0.14" cy="0.08" r="0.95">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#000000"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="#ffffff"/>
  <g>
    <rect x="80" y="70" width="46" height="46" rx="12" fill="#ffffff"/>
    <text x="103" y="102" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="800" fill="#000000">A</text>
    <text x="142" y="103" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="700" fill="#ffffff">Ask</text>
    <text x="205" y="103" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="500" fill="rgba(255,255,255,0.42)">· A House Divided</text>
  </g>
  <text x="80" y="185" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="600" letter-spacing="2" fill="rgba(255,255,255,0.55)">${escapeXml(kind.toUpperCase())}</text>
  ${body}
  <text x="80" y="560" font-family="DejaVu Sans, sans-serif" font-size="24" fill="rgba(255,255,255,0.4)">${escapeXml(footer)}</text>
</svg>`;
}

function svgToPng(svg) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/magick", ["svg:-", "-resize", `${W}x${H}`, "png:-"], { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(), 15000);
    const out = [], err = [];
    let size = 0;
    child.stdout.on("data", c => { size += c.length; if (size <= 4 * 1024 * 1024) out.push(c); else child.kill(); });
    child.stderr.on("data", c => err.push(c));
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timer);
      return code === 0 && size > 0
        ? resolve(Buffer.concat(out))
        : reject(new Error(Buffer.concat(err).toString("utf8").slice(0, 200) || "card render failed"));
    });
    child.stdin.end(svg);
  });
}

async function renderCard(opts) { return svgToPng(cardSvg(opts)); }

module.exports = { renderCard, cardSvg, wrap };
