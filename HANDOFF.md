# LEB2 Buddy — project handoff

## What this is

A desktop app for a KMUTT student that scrapes their own assignments from LEB2
(the university learning platform) and reminds them what is due. A 2D character
UI sits on top. Built to be shared with a handful of friends later.

**Not an AI product.** Extraction must be deterministic. A local LLM may be added
later, only for summarising long assignment briefs — never for reading dates or
submission status off a page.

## Current state

`scrape.js` exists and works: logs in via a persistent Chrome profile, pulls the
class list and every assignment row, prints JSON. Nothing else is built yet.

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
         └─> SQLite: assignments(class_id, activity_id, title,
                     due_at_utc, status, first_seen, last_seen)
               ├─> diff vs last run ──> notification
               └─> Electron UI reads DB ──> character + today's list
```

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
- **`better-sqlite3`** for storage. No database server.
- **Windows toast notifications for v1**, not Discord. Discord means every user
  pastes a webhook URL — the worst step in any setup flow. Discord becomes an
  optional toggle later.
- **`channel: 'chrome'`** in Playwright to reuse installed Chrome and save ~150MB.
  Fall back to bundled Chromium if absent.
- Runs on the user's own PC. Not a VPS — SSO login cannot be automated, and a
  session cookie should not live on someone else's hardware.

## Build order

1. ~~`scrape.js` — standalone, prints JSON~~ **done**
2. `db.js` — SQLite schema, keyed on activityId, dates UTC
3. `diff.js` — compare runs, return announceable changes
4. `notify.js` — Electron `new Notification()`
5. Scheduler — `setInterval` + run-on-launch + `app.setLoginItemSettings({openAtLogin:true})`
6. UI — Electron window on the same SQLite file: character, today's list, nothing more
7. First-run screen — "Connect LEB2" → headed Playwright → wait for `.class-card` → close
8. `electron-builder --win` → NSIS installer
9. `electron-updater` → GitHub Releases (needed *before* distributing; when LEB2
   changes their HTML, every copy breaks the same day)

## Security — non-negotiable

- Session state goes in `app.getPath('userData')`, never the project folder.
- `.gitignore` the profile directory **before the first commit**. It holds a live
  KMUTT session, and the LEB2 password is the university intranet password.
- Never collect other users' credentials. If shared, each person runs their own
  copy against their own browser profile.
- Handle "session expired" as a visible UI state with a Reconnect button. Users
  hit this monthly; silent failure means they think it works while it shows nothing.

## Open questions for the user

- Has KMUTT's acceptable use policy been checked? Suggested: email
  `leb2@mail.kmutt.ac.th`, explain it is a personal deadline reminder, ask
  whether a low-rate personal scraper is acceptable. Answer determines whether
  this can be published openly.
- Does `scrape.js` return rows for all seven classes, or do GEN/PRE courses lay
  out differently from CPE?

## Suggested skills

- `project-intake` — if scope shifts or the character/UI direction needs pinning down
- `frontend-design` — for step 6, the Electron UI and character screen
- `handoff` — when compacting this session for the next one
