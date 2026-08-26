// LEB2 scraper — step 5
// Electron-side timer. Not auto-executing on require — main.js (step 6)
// calls startScheduler(db) once the app is ready.

const { runCycle } = require('./cycle.js');

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

// setInterval doesn't fire during OS sleep and doesn't queue up missed
// ticks, so a closed laptop lid drifts the schedule to whenever the timer
// happens to land after waking. Anchoring "is it time yet" to the DB's own
// record of the last attempt (rather than trusting the timer's cadence)
// keeps the 3-hour cycle honest across sleep/wake.
function isDue(db, intervalMs) {
  const last = db.prepare(
    `SELECT started_at FROM scrape_runs ORDER BY id DESC LIMIT 1`
  ).get();
  if (!last) return true; // never run before
  return Date.now() - new Date(last.started_at).getTime() >= intervalMs;
}

function startScheduler(db, { intervalMs = THREE_HOURS_MS, cycleFn = runCycle } = {}) {
  let running = false;

  // Shared by the timer and any manual trigger (e.g. a UI "check now"
  // button), so the two can never spawn overlapping scrapes against the
  // same persistent Chrome profile. Returns null if a cycle was already
  // in flight rather than queuing — the caller just missed this one.
  const runNow = async () => {
    if (running) return null;
    running = true;
    try {
      return await cycleFn(db);
    } finally {
      running = false;
    }
  };

  const tick = async () => {
    if (!isDue(db, intervalMs)) return;
    await runNow();
  };

  tick(); // launch check — runs immediately only if actually due
  const timer = setInterval(tick, intervalMs);
  return { stop: () => clearInterval(timer), triggerNow: runNow };
}

module.exports = { startScheduler };
