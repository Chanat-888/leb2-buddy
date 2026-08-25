// LEB2 scraper — step 3
// Compares a fresh (successful) scrape against what's already in the DB and
// returns announceable events. Never writes. Caller must run this BEFORE
// db.saveScrape(), since it reads the pre-overwrite state of `assignments`.
//
// Caller is responsible for checking scrape_runs.ok first — diff.js assumes
// freshResult is a good scrape. A failed scrape has no new data to diff
// against and should be handled separately (see HANDOFF: 3-consecutive-
// failures alert), not routed through here.

const HOUR_MS = 3600 * 1000;
const WINDOWS = [
  { type: 'due_soon_48h', ms: 48 * HOUR_MS },
  { type: 'due_soon_6h', ms: 6 * HOUR_MS },
];

function diffScrape(db, freshResult) {
  const events = [];

  const lastRun = db.prepare(
    `SELECT started_at FROM scrape_runs WHERE ok = 1 ORDER BY id DESC LIMIT 1`
  ).get();
  const isFirstScrape = !lastRun;
  const lastRunMs = lastRun ? new Date(lastRun.started_at).getTime() : null;
  const nowMs = new Date(freshResult.scrapedAt).getTime();

  const existingRows = db.prepare(
    `SELECT kind, item_id, submitted FROM assignments`
  ).all();
  const existing = new Map(
    existingRows.map((r) => [`${r.kind}:${r.item_id}`, r])
  );

  const classCodes = new Map(freshResult.classes.map((c) => [c.classId, c.code]));

  for (const a of freshResult.assignments) {
    const key = `${a.kind}:${a.itemId}`;
    const old = existing.get(key);
    const base = {
      kind: a.kind,
      itemId: a.itemId,
      classId: a.classId,
      classCode: classCodes.get(a.classId) || null,
      title: a.title,
      dueAt: a.dueAt,
      url: a.url,
    };

    if (!old) {
      events.push({ type: 'new', notify: true, ...base });
    }

    if (old && !old.submitted && a.submitted) {
      events.push({ type: 'submitted', notify: false, ...base });
    }

    if (a.dueAt && !a.submitted) {
      const dueMs = new Date(a.dueAt).getTime();
      for (const w of WINDOWS) {
        const inWindowNow = dueMs - nowMs < w.ms;
        const inWindowLastRun = lastRunMs !== null && dueMs - lastRunMs < w.ms;
        if (inWindowNow && !inWindowLastRun) {
          events.push({ type: w.type, notify: true, ...base });
        }
      }
    }
  }

  // First-ever scrape: still record every item as seen (via the events'
  // normal downstream effect of the caller running saveScrape), but don't
  // dump a wall of toasts on day one.
  if (isFirstScrape) {
    return events.map((e) => ({ ...e, notify: false }));
  }

  return events;
}

module.exports = { diffScrape };
