// LEB2 scraper — step 6
// Read-only view over the DB for the Electron UI: character state + 7-day
// agenda. No Electron import here — same testable-with-plain-node style as
// diff.js/db.js.

const { currentFailureStreak } = require('./notify.js');
const { hasSucceededOnce } = require('./db.js');

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BANGKOK_OFFSET_MS = 7 * HOUR_MS;
// Mirrors the threshold notify.js's checkFailureStreak alerts at — same
// "3 in a row" means the same thing here (character shows trouble) and
// there (a toast fires).
const FAILURE_ALERT_THRESHOLD = 3;
// Beyond this, an overdue item is a lost cause, not an emergency — it stops
// driving the character state and moves to the dimmed "Missed" section.
const MISSED_THRESHOLD_MS = 7 * DAY_MS;
// "Upcoming" window: far enough out that it's not actionable yet, so it's
// collapsed by default rather than cluttering the agenda.
const UPCOMING_MIN_DAYS = 8;
const UPCOMING_MAX_DAYS = 60;

// Bangkok is UTC+7 year round (see scrape.js), so today's Bangkok calendar
// day boundaries can be computed with fixed-offset math.
function bangkokDayBoundsUtc(nowMs) {
  const shifted = new Date(nowMs + BANGKOK_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const startUtcMs = Date.UTC(y, m, d) - BANGKOK_OFFSET_MS;
  return { startUtcMs, endUtcMs: startUtcMs + 24 * HOUR_MS };
}

// Scans every not-submitted assignment (not just today's) — something due
// in 5 hours can fall on tomorrow's Bangkok calendar date and still needs
// to read as urgent.
function getCharacterState(db, assignments, nowMs) {
  if (currentFailureStreak(db) >= FAILURE_ALERT_THRESHOLD) {
    return { state: 'error', label: "CAN'T REACH LEB2" };
  }

  let hasOverdue = false;
  let hasUrgent = false;
  let hasWarning = false;
  for (const a of assignments) {
    if (a.submitted || !a.due_at) continue;
    const untilDueMs = new Date(a.due_at).getTime() - nowMs;
    // Overdue by 7+ days is a lost cause (see MISSED_THRESHOLD_MS) — it
    // doesn't make the character urgent, it just sits in "Missed".
    if (untilDueMs < 0) { if (-untilDueMs < MISSED_THRESHOLD_MS) hasOverdue = true; }
    else if (untilDueMs < 6 * HOUR_MS) hasUrgent = true;
    else if (untilDueMs < 48 * HOUR_MS) hasWarning = true;
  }

  if (hasOverdue) return { state: 'urgent', label: 'OVERDUE' };
  if (hasUrgent) return { state: 'urgent', label: 'DUE VERY SOON' };
  if (hasWarning) return { state: 'warning', label: 'DUE SOON' };
  return { state: 'ok', label: 'ALL CLEAR' };
}

function toListItem(a) {
  return {
    kind: a.kind,
    itemId: a.item_id,
    classCode: a.code,
    title: a.title,
    dueAt: a.due_at,
    submitted: !!a.submitted,
    url: a.url,
  };
}

// startUtcMs is the UTC instant of Bangkok midnight for that day (see
// bangkokDayBoundsUtc) — format it back in Asia/Bangkok, not UTC, or it
// reads one calendar day early.
function weekdayName(startUtcMs) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bangkok' })
    .format(new Date(startUtcMs));
}

function dateLabel(startUtcMs) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })
    .format(new Date(startUtcMs));
}

// Not-submitted items due 8-60 calendar days out, grouped by date. Far
// enough out to not be actionable yet — kept out of the 7-day agenda and
// the Missed section, and left for the UI to show collapsed by default.
function getUpcoming(assignments, nowMs) {
  const { startUtcMs: todayStartUtcMs } = bangkokDayBoundsUtc(nowMs);
  const groups = new Map();

  for (const a of assignments) {
    if (a.submitted || !a.due_at) continue;
    const dueMs = new Date(a.due_at).getTime();
    const { startUtcMs } = bangkokDayBoundsUtc(dueMs);
    const offsetDays = Math.round((startUtcMs - todayStartUtcMs) / DAY_MS);
    if (offsetDays < UPCOMING_MIN_DAYS || offsetDays > UPCOMING_MAX_DAYS) continue;
    if (!groups.has(startUtcMs)) groups.set(startUtcMs, []);
    groups.get(startUtcMs).push(a);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startUtcMs, items]) => ({
      label: dateLabel(startUtcMs),
      items: items
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
        .map(toListItem),
    }));
}

// 7-day agenda, grouped by day (today first): each day shows everything due
// that day, not-submitted items only except for today (which also shows
// submitted items due today, for context). Overdue-unsubmitted items that
// are still within the "urgent" window (< MISSED_THRESHOLD_MS) are folded
// into Today so they don't silently disappear the day after they're missed.
// Anything overdue past that window is a lost cause — it goes in `missed`
// instead, kept out of the day grouping and out of the character state.
function getWeekView(assignments, nowMs) {
  const days = [];
  for (let offset = 0; offset < 7; offset++) {
    const { startUtcMs, endUtcMs } = bangkokDayBoundsUtc(nowMs + offset * DAY_MS);
    const items = assignments.filter((a) => {
      if (!a.due_at) return false;
      const dueMs = new Date(a.due_at).getTime();
      if (dueMs < startUtcMs || dueMs >= endUtcMs) return false;
      return offset === 0 || !a.submitted;
    });

    if (offset === 0) {
      for (const a of assignments) {
        if (a.submitted || !a.due_at) continue;
        const overdueMs = nowMs - new Date(a.due_at).getTime();
        if (overdueMs > 0 && overdueMs < MISSED_THRESHOLD_MS) items.push(a);
      }
    }

    items.sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    days.push({
      label: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : weekdayName(startUtcMs),
      items: items.map(toListItem),
    });
  }

  const missed = assignments
    .filter((a) => {
      if (a.submitted || !a.due_at || a.dismissed_at) return false;
      return nowMs - new Date(a.due_at).getTime() >= MISSED_THRESHOLD_MS;
    })
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .map(toListItem);

  return { days, missed, upcoming: getUpcoming(assignments, nowMs) };
}

function getDashboardData(db, nowMs = Date.now()) {
  const assignments = db.prepare(`
    SELECT a.*, c.code, c.name
    FROM assignments a
    JOIN classes c ON a.class_id = c.class_id
  `).all();

  const lastRun = db.prepare(
    `SELECT started_at, ok, error FROM scrape_runs ORDER BY id DESC LIMIT 1`
  ).get() || null;

  // "Not logged in" is the exact string scrape.js's getClasses() throws when
  // the session is missing/expired — see step 7's Connect/Reconnect flow.
  const needsReconnect = !!lastRun && !lastRun.ok && /Not logged in/.test(lastRun.error || '');

  return {
    character: getCharacterState(db, assignments, nowMs),
    week: getWeekView(assignments, nowMs),
    lastRun,
    auth: { connected: hasSucceededOnce(db), needsReconnect },
  };
}

module.exports = { getDashboardData };
