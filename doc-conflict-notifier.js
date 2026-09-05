"use strict";

// doc_conflicts was a write-only table: answers caught the wiki contradicting
// the code, the row landed, and nobody was told. This posts new open conflicts
// to the staff Discord channel, batched, at most one post an hour, with the
// claim and what the code actually does so the fix can start from the message.
//
// The hour gate reads doc_conflicts.notified_ts rather than process memory, so
// a restart cannot post twice inside the hour. Rows are marked only after the
// post succeeds; a failed post leaves them for the next tick.

const MIN_INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 10;

function format(rows) {
  const lines = [`**Ask found ${rows.length} new doc conflict${rows.length === 1 ? "" : "s"}** (the wiki or docs say one thing, the code does another)`];
  for (const c of rows) {
    const where = `${c.source}${c.page ? ` ${c.page}` : ""}`;
    lines.push(`· [${where}] says "${String(c.claim || "").slice(0, 160)}" but the code does "${String(c.actual || "").slice(0, 160)}"${c.evidence ? ` (${String(c.evidence).slice(0, 80)})` : ""}${Number(c.seen) > 1 ? ` seen x${c.seen}` : ""}`);
  }
  return lines.join("\n").slice(0, 1900);
}

/**
 * Build a notifier bound to a store and a post function. `now` is injectable
 * so the hour gate can be tested without waiting an hour.
 */
function create({ store, post, now = Date.now, minIntervalMs = MIN_INTERVAL_MS, batch = BATCH, log = () => {} }) {
  async function tick() {
    const rows = store.unnotifiedConflicts(batch);
    if (!rows.length) return { posted: 0, pending: 0 };
    const last = store.lastConflictNotifiedTs();
    if (last && now() - last < minIntervalMs) return { posted: 0, pending: rows.length, deferred: true };
    try {
      await post(format(rows));
    } catch (e) {
      log(`[conflicts] notify failed for ${rows.length} row(s): ${String(e?.message || e).slice(0, 160)}`);
      return { posted: 0, pending: rows.length, error: String(e?.message || e).slice(0, 160) };
    }
    store.markConflictsNotified(rows.map(r => r.id), now());
    return { posted: rows.length, pending: 0 };
  }
  return { tick, format };
}

module.exports = { create, format, MIN_INTERVAL_MS, BATCH };
