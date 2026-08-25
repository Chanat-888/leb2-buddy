// LEB2 scraper — step 2
// SQLite storage. Doesn't scrape, doesn't diff — just persists what scrape.js found.

const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

// Same convention as PROFILE_DIR in scrape.js: lives outside the project folder.
const DEFAULT_DB_PATH = path.join(os.homedir(), '.leb2-buddy', 'leb2.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS classes (
  class_id   TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  section    TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  kind            TEXT NOT NULL CHECK (kind IN ('activity','quiz')),
  item_id         TEXT NOT NULL,
  class_id        TEXT NOT NULL REFERENCES classes(class_id),
  title           TEXT NOT NULL,
  publish_at      TEXT,
  due_at          TEXT,
  status_raw      TEXT NOT NULL,
  prev_status_raw TEXT,
  submitted       INTEGER NOT NULL,
  url             TEXT NOT NULL,
  first_seen      TEXT NOT NULL,
  last_seen       TEXT NOT NULL,
  PRIMARY KEY (kind, item_id)
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id          INTEGER PRIMARY KEY,
  started_at  TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  class_count INTEGER,
  row_count   INTEGER,
  error       TEXT
);
`;

function openDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

const upsertClass = (db) => db.prepare(`
  INSERT INTO classes (class_id, code, name, section, first_seen, last_seen)
  VALUES (@class_id, @code, @name, @section, @now, @now)
  ON CONFLICT(class_id) DO UPDATE SET
    code = excluded.code,
    name = excluded.name,
    section = excluded.section,
    last_seen = excluded.last_seen
`);

const upsertAssignment = (db) => db.prepare(`
  INSERT INTO assignments
    (kind, item_id, class_id, title, publish_at, due_at, status_raw, prev_status_raw, submitted, url, first_seen, last_seen)
  VALUES
    (@kind, @item_id, @class_id, @title, @publish_at, @due_at, @status_raw, NULL, @submitted, @url, @now, @now)
  ON CONFLICT(kind, item_id) DO UPDATE SET
    class_id = excluded.class_id,
    title = excluded.title,
    publish_at = excluded.publish_at,
    due_at = excluded.due_at,
    prev_status_raw = CASE
      WHEN status_raw != excluded.status_raw THEN status_raw
      ELSE prev_status_raw
    END,
    status_raw = excluded.status_raw,
    submitted = excluded.submitted,
    url = excluded.url,
    last_seen = excluded.last_seen
`);

const insertRun = (db) => db.prepare(`
  INSERT INTO scrape_runs (started_at, ok, class_count, row_count, error)
  VALUES (@started_at, @ok, @class_count, @row_count, @error)
`);

// Persists a successful scrape.js result (its exact printed JSON shape).
// Never deletes rows — a class/assignment missing from this scrape just
// doesn't get its last_seen bumped; that's diff.js's concern, not db.js's.
function saveScrape(db, result) {
  const now = new Date().toISOString();
  const runClass = upsertClass(db);
  const runAssignment = upsertAssignment(db);
  const runInsert = insertRun(db);

  const tx = db.transaction(() => {
    for (const c of result.classes) {
      runClass.run({
        class_id: c.classId,
        code: c.code,
        name: c.name,
        section: c.section,
        now,
      });
    }
    for (const a of result.assignments) {
      runAssignment.run({
        kind: a.kind,
        item_id: a.itemId,
        class_id: a.classId,
        title: a.title,
        publish_at: a.publishAt,
        due_at: a.dueAt,
        status_raw: a.statusRaw,
        submitted: a.submitted ? 1 : 0,
        url: a.url,
        now,
      });
    }
    runInsert.run({
      started_at: result.scrapedAt,
      ok: 1,
      class_count: result.classes.length,
      row_count: result.assignments.length,
      error: null,
    });
  });
  tx();
}

// Records a scrape attempt that failed before producing a result, so
// diff.js can tell "no assignments due" apart from "the scraper broke".
function recordFailedScrape(db, startedAt, error) {
  insertRun(db).run({
    started_at: startedAt,
    ok: 0,
    class_count: null,
    row_count: null,
    error: String(error && error.message || error),
  });
}

module.exports = { openDb, saveScrape, recordFailedScrape, DEFAULT_DB_PATH };
