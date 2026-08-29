// ─── AHD OPS DESIGN SYSTEM ───────────────────────────────────────────
// Single source of truth for the dashboard's look & feel. Every page composes
// its <style> from these so the whole app stays visually consistent.
//
// Direction: a calm, neutral "platform utility" aesthetic. Neutral surfaces,
// ONE interactive accent (indigo, identical in both themes), color reserved for
// meaning (status), and the AHD brand red kept for genuine alerts/wordmark only.
//
// Variable names are intentionally backwards-compatible with the previous
// BASE_CSS tokens (--bg-0, --accent, --text, --green/amber/red, --shadow*, etc.)
// so existing pages re-skin automatically. New tokens (--surface*, --ok/--warn/
// --danger/--info, --brand, --e1/2/3, --fs-*) layer on top.

const TOKENS_CSS = `
:root{
  /* Neutral platform palette (dark, default) — lifted off pure-black with clear
     surface separation so cards read as elevated (depth, not flat). */
  --bg-0:#0a0f14;--bg-1:#111b26;
  --surface:#111b26;--surface-2:#16222e;--surface-3:#1d2b3a;
  --glass-1:rgba(255,255,255,.025);--glass-2:rgba(255,255,255,.05);--glass-3:rgba(255,255,255,.085);
  --glass-hover:rgba(255,255,255,.06);
  --border:rgba(234,240,246,.08);--border-2:rgba(234,240,246,.16);
  --text:#eaf0f6;--text-2:rgba(234,240,246,.64);--text-3:rgba(234,240,246,.38);
  /* One interactive accent — same hue in both themes (no more red/blue flip) */
  --accent:#38bdf8;--accent-2:#21c8a0;--accent-soft:rgba(56,189,248,.14);--accent-hover:#5cc9f9;--on-accent:#06222f;
  /* Semantic status (meaning only) */
  --green:#22c55e;--green-soft:rgba(34,197,94,.13);
  --amber:#eab308;--amber-soft:rgba(234,179,8,.14);
  --red:#ef4444;--red-soft:rgba(239,68,68,.14);
  --ok:#22c55e;--warn:#eab308;--danger:#ef4444;--info:#38bdf8;--info-soft:rgba(56,189,248,.14);
  /* AHD brand red — alerts / wordmark only */
  --brand:#dc2626;--brand-soft:rgba(220,38,38,.14);
  --cyan:#22d3ee;--pink:#f472b6;--gold:#d4af37;--gold-soft:rgba(212,175,55,.14);
  --field-bg:rgba(255,255,255,.03);
  --r-xs:8px;--r-sm:10px;--r-md:14px;--r-lg:18px;--r-xl:24px;--r-full:999px;
  --s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:20px;--s-6:24px;--s-8:32px;--s-10:40px;--s-12:48px;--s-16:64px;
  /* Present-but-soft elevation + a hairline top highlight for depth */
  --shadow-sm:0 1px 2px rgba(0,0,0,.35);
  --shadow:0 10px 28px -10px rgba(0,0,0,.55);
  --shadow-lg:0 22px 50px -14px rgba(0,0,0,.62);
  --e1:0 1px 3px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.25);
  --e2:0 10px 28px -10px rgba(0,0,0,.55);
  --e3:0 22px 50px -14px rgba(0,0,0,.62);
  --hi:inset 0 1px 0 rgba(255,255,255,.04);
  --ring:0 0 0 3px var(--accent-soft);
  --blur:blur(16px) saturate(130%);
  --scroll:rgba(255,255,255,.13);--scroll-h:rgba(255,255,255,.24);
  --font:'Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;
  /* Formal type scale */
  --fs-display:1.75rem;--fs-h1:1.375rem;--fs-h2:1.125rem;--fs-h3:.9375rem;--fs-body:.875rem;--fs-sm:.8125rem;--fs-xs:.75rem;--fs-2xs:.6875rem;
  --ease:cubic-bezier(.2,0,0,1);--t:.14s var(--ease);--t-slow:.24s var(--ease)
}
/* ── Light theme ────────────────────────────────────────────────── */
:root[data-theme="light"]{
  --bg-0:#f7f8fa;--bg-1:#ffffff;
  --surface:#ffffff;--surface-2:#f1f3f6;--surface-3:#e9ecf1;
  --glass-1:rgba(17,21,33,.012);--glass-2:rgba(17,21,33,.03);--glass-3:rgba(17,21,33,.055);
  --glass-hover:rgba(17,21,33,.045);
  --border:rgba(17,21,33,.09);--border-2:rgba(17,21,33,.16);
  --text:#1a1d24;--text-2:rgba(26,29,36,.62);--text-3:rgba(26,29,36,.42);
  --accent:#0284c7;--accent-2:#0d9488;--accent-soft:rgba(2,132,199,.12);--accent-hover:#0369a1;--on-accent:#fff;
  --green:#15935f;--green-soft:rgba(21,147,95,.12);
  --amber:#b07700;--amber-soft:rgba(176,119,0,.12);
  --red:#dc4444;--red-soft:rgba(220,68,68,.10);
  --ok:#15935f;--warn:#b07700;--danger:#dc4444;--info:#0284c7;--info-soft:rgba(2,132,199,.12);
  --brand:#c8262d;--brand-soft:rgba(200,38,45,.10);
  --cyan:#0891b2;--pink:#db2777;--gold:#9a7b1e;--gold-soft:rgba(154,123,30,.12);
  --field-bg:#ffffff;
  --shadow-sm:0 1px 2px rgba(17,21,33,.06);
  --shadow:0 6px 20px -8px rgba(17,21,33,.14);
  --shadow-lg:0 16px 40px -14px rgba(17,21,33,.18);
  --e1:0 1px 2px rgba(17,21,33,.07);--e2:0 8px 24px -10px rgba(17,21,33,.16);--e3:0 18px 44px -14px rgba(17,21,33,.2);
  --hi:none;
  --blur:blur(14px) saturate(120%);
  --scroll:rgba(17,21,33,.16);--scroll-h:rgba(17,21,33,.3)
}`;

module.exports = { TOKENS_CSS };
