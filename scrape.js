// LEB2 scraper — step 1
//   node scrape.js --login   open a real window, sign in by hand (do this first)
//   node scrape.js           scrape silently, print JSON

const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const LOGIN_MODE = process.argv.includes('--login');
const BASE = 'https://app.leb2.org';
const TZ = 'Asia/Bangkok';

// Session lives outside the project folder so it never lands in git.
const PROFILE_DIR = path.join(os.homedir(), '.leb2-buddy', 'browser-profile');

const MONTHS = ['january','february','march','april','may','june',
                'july','august','september','october','november','december'];

// "August 17, 2026 at 23:59" -> ISO string in UTC.
// Bangkok is UTC+7 year round, no DST, so a fixed offset is safe here.
function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || /no due date|no end date/i.test(s)) return null;

  const m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*(?:at|At)\s*(\d{1,2}):(\d{2})$/);
  if (!m) {
    console.error(`  ! could not parse date: "${s}"`);
    return null;
  }
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month === -1) return null;

  const [, , day, year, hour, min] = m;
  const utcMs = Date.UTC(+year, month, +day, +hour, +min) - 7 * 3600 * 1000;
  return new Date(utcMs).toISOString();
}

async function getClasses(page) {
  await page.goto(`${BASE}/class`, { waitUntil: 'domcontentloaded' });

  if (!page.url().includes('/class')) {
    throw new Error('Not logged in — run: node scrape.js --login');
  }
  await page.waitForSelector('.class-card', { timeout: 15000 });

  return page.$$eval('.class-card', (cards) =>
    cards.map((c) => ({
      classId: (c.getAttribute('name') || '').replace('card-', ''),
      code: c.querySelector('[name=code]')?.textContent.trim() || '',
      name: c.querySelector('[name=name_ln]')?.textContent.trim() || '',
      section: c.querySelector('[name=section]')?.textContent.trim() || '',
    })).filter((c) => c.classId)
  );
}

async function getActivities(page, classId) {
  await page.goto(`${BASE}/class/${classId}/activity`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200); // table renders a beat after DOM ready

  const rows = await page.$$eval('tbody tr', (trs) =>
    trs.map((tr) => {
      const cells = [...tr.children].map((c) => c.innerText.trim().replace(/\s+/g, ' '));
      // Assignments link to /activity/{id}; quizzes link to /quiz/{id} instead.
      const href = tr.querySelector('a[href*="/activity/"], a[href*="/quiz/"]')
        ?.getAttribute('href') || '';
      return { href, cells };
    })
  );

  const seen = new Set();
  const out = [];

  for (const r of rows) {
    if (r.cells.length < 4) continue;

    let kind = null;
    if (r.href.includes('/quiz/')) kind = 'quiz';
    else if (r.href.includes('/activity/')) kind = 'activity';
    else continue;

    const itemId = r.href.split(`/${kind}/`)[1]?.split(/[?#/]/)[0];
    if (!itemId) continue;

    // Tabs (All / Assessment Activity / Quiz) repeat the same rows in separate tables.
    const key = `${kind}:${itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Column 0 packs title + instructor + attachments; the title is the first line.
    const title = r.cells[0].split(' by ')[0].trim();
    const status = r.cells[3] || '';

    out.push({
      classId,
      kind,
      itemId,
      title,
      publishAt: parseDate(r.cells[1]),
      dueAt: parseDate(r.cells[2]),
      statusRaw: status,
      submitted: /^submitted/i.test(status),
      url: r.href.startsWith('http') ? r.href : `${BASE}${r.href}`,
    });
  }
  return out;
}

(async () => {
  // Fresh machine: ~/.leb2-buddy/ exists (db.js creates it), but
  // browser-profile itself may not. Chromium usually creates a missing
  // user-data-dir on its own, but don't depend on that — create it
  // explicitly so a first-ever --login never errors on a missing directory.
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: !LOGIN_MODE,
      channel: 'chrome',        // use installed Chrome; drop this line if it errors
      viewport: { width: 1400, height: 900 },
    });
  } catch (err) {
    if (/chrome/i.test(err.message) && /not found|doesn't exist|distribution/i.test(err.message)) {
      throw new Error('Google Chrome is required but was not found on this PC. Install it from https://www.google.com/chrome/ and try again.');
    }
    throw err;
  }

  const page = ctx.pages()[0] || (await ctx.newPage());

  try {
    if (LOGIN_MODE) {
      console.error('Sign in to LEB2 in the window that opened.');
      console.error('Waiting for the class page...');
      await page.goto(`${BASE}/class`);
      await page.waitForSelector('.class-card', { timeout: 300000 });
      console.error('Logged in. Session saved. Now run: node scrape.js');
      await ctx.close();
      return;
    }

    const classes = await getClasses(page);
    console.error(`Found ${classes.length} classes`);

    const assignments = [];
    for (const c of classes) {
      const acts = await getActivities(page, c.classId);
      console.error(`  ${c.code.padEnd(9)} ${acts.length} items`);

      // Fail loud: a class that renders zero rows is usually broken selectors,
      // not an empty class. Better a noisy error than silent missed deadlines.
      if (acts.length === 0) console.error(`  ! ${c.code} returned 0 rows — check selectors`);

      assignments.push(...acts);
    }

    console.log(JSON.stringify({
      scrapedAt: new Date().toISOString(),
      timezone: TZ,
      classes,
      assignments,
    }, null, 2));
  } finally {
    await ctx.close();
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
