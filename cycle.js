// LEB2 scraper — step 5
// The full cycle: scrape -> record -> diff-or-failure-check -> notify.
// Shared by run-once.js (headless) and scheduler.js (Electron timer).

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { diffScrape } = require('./diff.js');
const { saveScrape, recordFailedScrape } = require('./db.js');
const { notifyEvents, checkFailureStreak } = require('./notify.js');

// require('electron') resolves to a path string (not the module) when not
// actually running inside Electron, so `.app` is safely undefined under
// plain Node (run-once.js) and only set inside Electron's main process.
const electronApp = require('electron').app;

const SCRAPE_TIMEOUT_MS = 120000;

// A packaged app has no scrape.js inside app.asar (Playwright can't launch
// from the asar virtual FS — see package.json's asarUnpack) and no `node`
// binary either. Both are resolved here instead of at each call site.
function resolveScrapePath() {
  if (electronApp && electronApp.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'scrape.js');
  }
  return path.join(__dirname, 'scrape.js');
}

// Spawns scrape.js rather than requiring it — scrape.js is a CLI (JSON on
// stdout, non-zero exit + stderr message on failure) and stays untouched.
// execFile rejects on non-zero exit regardless of what was printed to
// stdout, so a crash mid-write can't be mistaken for success.
//
// Uses process.execPath (the Electron binary itself when running inside
// Electron) with ELECTRON_RUN_AS_NODE=1 instead of a bare `node` — a
// packaged app has no `node` on PATH. Under plain Node (run-once.js),
// process.execPath is just the node binary and the env var is a no-op.
async function runScrape() {
  const scrapePath = resolveScrapePath();
  try {
    const { stdout } = await execFileAsync(process.execPath, [scrapePath], {
      cwd: path.dirname(scrapePath),
      maxBuffer: 10 * 1024 * 1024,
      timeout: SCRAPE_TIMEOUT_MS,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
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
    notifyEvents(events, db);
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
