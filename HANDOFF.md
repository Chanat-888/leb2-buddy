# LEB2 Buddy — project handoff

## What this is

A desktop app for a KMUTT student that scrapes their own assignments from LEB2
(the university learning platform) and reminds them what is due. A 2D character
UI sits on top. Built to be shared with a handful of friends later.

**Not an AI product.** Extraction must be deterministic. A local LLM may be added
later, only for summarising long assignment briefs — never for reading dates or
submission status off a page.

## Current state

Steps 1–6 are done — scrape, store, diff, notify, schedule, and a working
Electron UI, wired end to end:

- `scrape.js` — logs in via a persistent Chrome profile, pulls the class list
  and every assignment row, prints JSON. `--login` opens a headed window for
  the one-time manual SSO sign-in.
- `db.js` — SQLite storage (`~/.leb2-buddy/leb2.db`), keyed on `(kind, item_id)`.
  Never deletes rows.
- `diff.js` — compares a fresh scrape against the DB and returns announceable
  events (`new`, `submitted`, `due_soon_48h`, `due_soon_6h`), silenced on the
  very first scrape so day one isn't a wall of toasts.
- `notify.js` — turns those events into Windows toast notifications (grouped
  by type), plus a separate 3-consecutive-failure check.
- `cycle.js` / `run-once.js` — the full scrape → save → diff → notify cycle;
  `run-once.js` runs it headless from the CLI for testing.
- `scheduler.js` — runs the cycle every 3 hours inside Electron, anchored to
  `scrape_runs.started_at` (not a bare `setInterval`) so a slept laptop
  doesn't drift the cadence.
- `main.js` / `preload.js` / `renderer/` — the Electron UI: a single window
  over the same SQLite file, a tray icon so the scheduler survives the window
  being closed, and `app.setLoginItemSettings({ openAtLogin: true, args:
  ['--hidden'] })` so it starts on login without popping a window (the
  `--hidden` arg makes `main.js` create the window with `show: false`; the
  tray is still there to open it).

Nothing else is built yet — see "Build order" below for what's left (7–9).

## Findings from investigating LEB2 (already verified — do not re-investigate)

LEB2 is **server-rendered**. There is no JSON API. The only XHR traffic on any
page is analytics (New Relic, Microsoft Clarity, Sentry, Amplitude, Google
Analytics). Everything must be parsed out of HTML. Do not go looking for
`/api/` endpoints; there aren't any.

Auth is **Microsoft SSO** (`msal.js` on the page). Never script the login and
never store a password. Use `chromium.launchPersistentContext` and let the user
sign in by hand. Sessions last 14–30 days.

### Endpoints

| Purpose | URL |
|---|---|
| Class list | `GET /class` (`?semester_id=46` for other terms) |
| Assignments | `GET /class/{classId}/activity` |
| Lecture materials | `GET /class/{classId}/learning-activities` |
| Grades | `GET /class/{classId}/gradebook` |
| Attendance | `GET /class/{classId}/class_attendance?page=all` |

Base URL: `https://app.leb2.org`

### Class list DOM

`div.class-card`, with `name="card-{classId}"`. Inside:
`[name=code]`, `[name=name_ln]`, `[name=section]`.

### Assignment DOM (`/activity`)

Plain `<tbody><tr>`, five cells:

| idx | contents |
|---|---|
| 0 | title + " by " + instructor + attachment count + Individual/Group |
| 1 | publish date |
| 2 | due date, or "No Due Date" |
| 3 | **"Submitted" / "Not Submitted"** |
| 4 | action buttons |

Activity id: `tr a[href*="/activity/"]` → split on `/activity/`.

The page renders the same rows in several tables (All / Assessment Activity /
Quiz tabs). **Deduplicate by activityId.**

Column 3 is the whole reason this project works — LEB2 already tracks
submission state, so the app never has to ask the user what they have done.

### Date format

`"August 17, 2026 at 23:59"` — human strings, no timezone. Times are
Asia/Bangkok (UTC+7, no DST). Store UTC, display Bangkok. `"No Due Date"` and
`"No End Date"` both mean null.

## Architecture

```
Playwright (persistent Chrome profile)
   └─> scrape /class + /class/{id}/activity
         └─> SQLite: classes(class_id, code, name, section,
                      first_seen, last_seen)
                      assignments(kind, item_id, class_id, title,
                      publish_at, due_at, status_raw, prev_status_raw,
                      submitted, url, first_seen, last_seen)
                      scrape_runs(id, started_at, ok, class_count,
                      row_count, error)
               ├─> diff vs last run ──> notification
               └─> Electron UI reads DB ──> character + 7-day agenda
```

`assignments` is keyed on `(kind, item_id)` — `kind` is `'activity'` or
`'quiz'`, `item_id` is LEB2's own id. Never title; instructors rename
assignments.

### UI (dashboard.js + renderer/)

The window shows a character (colored by state) and an agenda list, read
from `dashboard.getDashboardData(db)`:

- **Character state** — `ok` / `warning` / `urgent` / `error`. Driven by the
  soonest not-submitted due date (`< 6h` urgent, `< 48h` warning) and by
  overdue-not-submitted items, but only while they're overdue by **less than
  7 days** — older than that is a lost cause and shouldn't make the character
  panic. Three consecutive failed scrapes forces `error` ("CAN'T REACH LEB2"),
  regardless of due dates.
- **7-day agenda** — grouped by day (`Today` / `Tomorrow` / weekday name).
  Today's group also folds in not-submitted items overdue by less than 7 days,
  so a missed item doesn't just vanish the day after. Future days show only
  not-submitted items.
- **Missed** — not-submitted items overdue by 7+ days, dimmed, kept out of
  the day grouping and out of the character state.
- **Upcoming** — not-submitted items due 8–60 days out, grouped by date,
  collapsed by default behind an "Upcoming (N)" toggle. Expanded/collapsed
  state persists across launches via the renderer's `localStorage`.

Rules:
- The scraper only writes. A separate diff step decides what is worth announcing.
- Key on `activityId`, never title — instructors rename assignments.
- Never delete rows; mark `last_seen`. A failed scrape must not empty the UI.
- Notify on: new assignment appeared / due <48h and not submitted / due <6h and
  not submitted.
- Run every 3 hours.
- Fail loud: a class returning 0 rows when it previously had some is a broken
  selector, not an empty class. Alert, do not stay quiet.

## Stack decisions (settled — do not relitigate)

- **Node, not Python.** Bundling Python into a desktop installer is not worth it.
- **Electron + electron-builder.** Fat but produces a working `.exe` in one command.
  (`electron-builder` itself isn't wired up yet — see step 8.)
- **`better-sqlite3`** for storage. No database server.
- **Windows toast notifications for v1**, not Discord. Discord means every user
  pastes a webhook URL — the worst step in any setup flow. Discord becomes an
  optional toggle later.
- **`channel: 'chrome'`** in Playwright to reuse installed Chrome and save ~150MB.
  No bundled-Chromium fallback — if Chrome isn't installed, `scrape.js` throws
  a plain-English error telling the user to install it (see step 8).
- Runs on the user's own PC. Not a VPS — SSO login cannot be automated, and a
  session cookie should not live on someone else's hardware.

## Build order

1. ~~`scrape.js` — standalone, prints JSON~~ **done**
2. ~~`db.js` — SQLite schema, keyed on activityId, dates UTC~~ **done**
3. ~~`diff.js` — compare runs, return announceable changes~~ **done**
4. ~~`notify.js` — Electron `new Notification()`~~ **done**
5. ~~Scheduler — `setInterval` + run-on-launch + `app.setLoginItemSettings`~~ **done**
6. ~~UI — Electron window on the same SQLite file: character, 7-day agenda,
   Missed, Upcoming~~ **done**
7. First-run screen — "Connect LEB2" → headed Playwright → wait for
   `.class-card` → close. **Not built.** Right now a missing/expired session
   just surfaces as the generic 3-failures error state (see Security below) —
   there's no in-app way to re-run `scrape.js --login` yet.
8. ~~`electron-builder --win` → NSIS installer~~ **done.** Three packaging
   problems solved:
   - `cycle.js` spawned `node scrape.js`, but a packaged app has no `node`
     binary — now spawns `process.execPath` with `ELECTRON_RUN_AS_NODE=1`.
   - `scrape.js` can't run from inside `app.asar` (Playwright needs a real
     path to spawn a browser) — unpacked via `asarUnpack`, alongside
     `playwright`/`playwright-core`; `cycle.js` resolves its path from
     `process.resourcesPath` when `app.isPackaged`.
   - `better-sqlite3` needed no rebuild — it ships true N-API prebuilds
     (`NAPI_VERSION=10`, no per-Node-version binary), so `npmRebuild: false`
     is both correct and necessary (this dev machine has no MSVC toolchain
     to rebuild anything with anyway).
   - NSIS target, `perMachine: false` (per-user install, no admin prompt).
   - Check the notification sender name after installing — in dev mode
     toasts show "Electron" because there's no Start Menu shortcut registered
     with the `com.pan.leb2buddy` AppUserModelID yet (`setAppUserModelId`
     alone isn't enough; Windows resolves the toast's display name from a
     shortcut). Should self-resolve once the NSIS installer creates that
     shortcut — **verify this on the first real install.**
9. `electron-updater` → GitHub Releases (needed *before* distributing; when LEB2
   changes their HTML, every copy breaks the same day). **Not built.**

## Security — non-negotiable

- Session state goes in `app.getPath('userData')`, never the project folder.
  (Currently the Playwright profile and the SQLite DB both live under
  `~/.leb2-buddy/`, outside the repo — same idea, done before `userData` was
  wired up. Fine as-is, just note the actual path if this gets revisited.)
- `.gitignore` the profile directory **before the first commit**. It holds a live
  KMUTT session, and the LEB2 password is the university intranet password.
  (`*.db` and `node_modules/` are gitignored; the browser profile lives outside
  the repo entirely, so it was never a git risk to begin with.)
- Never collect other users' credentials. If shared, each person runs their own
  copy against their own browser profile.
- Handle "session expired" as a visible UI state with a Reconnect button. Users
  hit this monthly; silent failure means they think it works while it shows
  nothing. **Still open** — `scrape.js` already distinguishes "not logged in"
  in its error message, but the UI doesn't surface it distinctly from any
  other failure yet. This is step 7's job.

## Open questions for the user

- Has KMUTT's acceptable use policy been checked? Suggested: email
  `leb2@mail.kmutt.ac.th`, explain it is a personal deadline reminder, ask
  whether a low-rate personal scraper is acceptable. Answer determines whether
  this can be published openly.
- Does `scrape.js` return rows for all seven classes, or do GEN/PRE courses lay
  out differently from CPE?

## Suggested skills

- `project-intake` — if scope shifts or the character/UI direction needs pinning down
- `frontend-design` — for step 7, the first-run "Connect LEB2" screen
- `handoff` — when compacting this session for the next one
