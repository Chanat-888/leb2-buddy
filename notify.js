// LEB2 scraper — step 4
// Turns diff.js events into OS notifications, and separately checks the
// 3-consecutive-failure streak (scoped out of diff.js — a failed scrape has
// no new data to diff against).
//
// `send` is injectable so this can be unit-tested with plain `node`, without
// an Electron app process to host the real Notification API. The default
// implementation is the only place electron.Notification / electron.shell
// are touched.

const { Notification, shell, BrowserWindow } = require('electron');

// Same show/restore/focus sequence as main.js's showWindow — duplicated
// rather than imported so notify.js stays usable outside a full app (e.g.
// run-once.js, test-notify.js), where there's no window and this is a no-op.
function focusAppWindow() {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function defaultSend(title, body, { url, focusApp } = {}) {
  // require('electron') outside an Electron app process (e.g. run-once.js
  // under plain `node`) doesn't give a real Notification class. Fall back to
  // logging instead of throwing, so headless runs stay headless.
  if (typeof Notification !== 'function' || !Notification.isSupported()) {
    console.log(`[notify] ${title} — ${body}`);
    return;
  }
  const n = new Notification({ title, body });
  if (url) n.on('click', () => shell.openExternal(url));
  else if (focusApp) n.on('click', focusAppWindow);
  n.show();
}

// "2026-08-30T16:59:00.000Z" -> "Aug 30, 23:59" (Asia/Bangkok, per HANDOFF).
function formatBangkok(iso) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')}`;
}

const TYPE_CONFIG = {
  new: {
    single: (e) => ({
      title: `New — ${e.classCode}`,
      body: e.dueAt ? `${e.title} — due ${formatBangkok(e.dueAt)}` : `${e.title} — No due date`,
    }),
    batchTitle: (n) => `${n} new assignments`,
  },
  due_soon_48h: {
    single: (e) => ({
      title: `Due in 2 days — ${e.classCode}`,
      body: `${e.title} — due ${formatBangkok(e.dueAt)}`,
    }),
    batchTitle: (n) => `${n} assignments due in 2 days`,
  },
  due_soon_6h: {
    single: (e) => ({
      title: `Due soon — ${e.classCode}`,
      body: `${e.title} — due ${formatBangkok(e.dueAt)}`,
    }),
    batchTitle: (n) => `${n} assignments due soon`,
  },
};

// Groups notify:true events by type and emits one notification per group —
// one event gets the detailed single-item copy, 2+ get a summary line.
function notifyEvents(events, send = defaultSend) {
  const groups = new Map();
  for (const e of events) {
    if (!e.notify) continue;
    const config = TYPE_CONFIG[e.type];
    if (!config) continue; // unknown event type - skip rather than guess copy
    if (!groups.has(e.type)) groups.set(e.type, []);
    groups.get(e.type).push(e);
  }

  for (const [type, group] of groups) {
    const config = TYPE_CONFIG[type];
    if (group.length === 1) {
      const e = group[0];
      const { title, body } = config.single(e);
      send(title, body, { url: e.url });
    } else {
      const title = config.batchTitle(group.length);
      const body = group.map((e) => `${e.classCode} ${e.title}`).join(', ');
      send(title, body, { focusApp: true });
    }
  }
}

function currentFailureStreak(db) {
  const rows = db.prepare(`SELECT ok FROM scrape_runs ORDER BY id DESC LIMIT 20`).all();
  let streak = 0;
  for (const r of rows) {
    if (r.ok) break;
    streak++;
  }
  return streak;
}

// Call after db.recordFailedScrape(). Fires exactly once per failure streak:
// silent until the 3rd consecutive failure, silent again on the 4th, 5th...,
// re-armed only once a successful run breaks the streak.
function checkFailureStreak(db, send = defaultSend) {
  if (currentFailureStreak(db) !== 3) return false;

  const lastFailure = db.prepare(
    `SELECT error FROM scrape_runs WHERE ok = 0 ORDER BY id DESC LIMIT 1`
  ).get();

  send('LEB2 Buddy', `Couldn't reach LEB2 for 3 scrapes in a row. Last error: ${lastFailure?.error || 'unknown'}`);
  return true;
}

module.exports = { notifyEvents, checkFailureStreak, currentFailureStreak };
