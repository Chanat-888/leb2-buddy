// LEB2 scraper — step 5
// Headless test entry: runs one cycle and exits. No scheduling, no Electron.
//   node run-once.js

const { openDb } = require('./db.js');
const { runCycle } = require('./cycle.js');

(async () => {
  const db = openDb();
  const result = await runCycle(db);
  db.close();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
})();
