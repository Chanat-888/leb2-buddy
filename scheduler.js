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

  const tick = async () => {
    if (running) return; // previous cycle still in flight
    if (!isDue(db, intervalMs)) return;
    running = true;
    try {
      await cycleFn(db);
    } finally {
      running = false;
    }
  };

  tick(); // launch check — runs immediately only if actually due
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { startScheduler };
