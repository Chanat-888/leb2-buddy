// LEB2 scraper — step 5
// The full cycle: scrape -> record -> diff-or-failure-check -> notify.
// Shared by run-once.js (headless) and scheduler.js (Electron timer).

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { diffScrape } = require('./diff.js');
const { saveScrape, recordFailedScrape } = require('./db.js');
const { notifyEvents, checkFailureStreak } = require('./notify.js');

const SCRAPE_TIMEOUT_MS = 120000;

// Spawns `node scrape.js` rather than requiring it — scrape.js is a CLI
// (JSON on stdout, non-zero exit + stderr message on failure) and stays
// untouched. execFile rejects on non-zero exit regardless of what was
// printed to stdout, so a crash mid-write can't be mistaken for success.
async function runScrape() {
  try {
    const { stdout } = await execFileAsync('node', ['scrape.js'], {
      cwd: __dirname,
      maxBuffer: 10 * 1024 * 1024,
      timeout: SCRAPE_TIMEOUT_MS,
    });
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error((err.stderr || err.message || String(err)).trim());
  }
}

async function runCycle(db, scrapeFn = runScrape) {
  const startedAt = new Date().toISOString();
  try {
    const result = await scrapeFn();
    const events = diffScrape(db, result); // read old state before saving
    saveScrape(db, result);
    notifyEvents(events);
    return {
      ok: true,
      startedAt,
      classCount: result.classes.length,
      rowCount: result.assignments.length,
      eventCount: events.length,
      notifiedCount: events.filter((e) => e.notify).length,
    };
  } catch (err) {
    recordFailedScrape(db, startedAt, err);
    checkFailureStreak(db);
    return { ok: false, startedAt, error: err.message };
  }
}

module.exports = { runCycle };
