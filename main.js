// LEB2 scraper — step 6
// Electron entry point: single window over the SQLite DB, plus a tray icon
// so the 3h scheduler keeps running after the window is closed.

const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');

const { openDb, getSetting, setSetting, dismissAssignment } = require('./db.js');
const { startScheduler } = require('./scheduler.js');
const { getDashboardData } = require('./dashboard.js');
const { sendTestMessage, postSummaryToDiscord } = require('./notify.js');

// Placeholder tray icon: a solid colored square, same "colored box" spirit
// as the in-window character. Built as a raw BGRA bitmap so no icon asset
// file is needed.
const TRAY_ICON_COLOR = { r: 0x4c, g: 0x6f, b: 0xff };

function createTrayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const { r, g, b } = TRAY_ICON_COLOR;
  for (let i = 0; i < size * size; i++) {
    buffer[i * 4 + 0] = b;
    buffer[i * 4 + 1] = g;
    buffer[i * 4 + 2] = r;
    buffer[i * 4 + 3] = 0xff;
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

if (!app.requestSingleInstanceLock()) {
  // Another copy is already running — two schedulers must never scrape the
  // same persistent Chrome profile at once.
  app.quit();
} else {
  // Windows groups toasts by this id and uses it to pick the sender name
  // shown on them — without it they show up as "Electron". Must match
  // package.json's build.appId once electron-builder is wired up.
  app.setAppUserModelId('com.pan.leb2buddy');

  let win = null;
  let db = null;
  let isQuitting = false;
  let triggerNow = async () => null;

  function showWindow() {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function createWindow(hidden) {
    win = new BrowserWindow({
      width: 420,
      height: 640,
      resizable: false,
      show: !hidden,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    Menu.setApplicationMenu(null);
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Closing the window must not kill the scheduler — hide instead, the
    // tray is the only way to actually quit.
    win.on('close', (e) => {
      if (isQuitting) return;
      e.preventDefault();
      win.hide();
    });
  }

  function createTray() {
    const tray = new Tray(createTrayIcon());
    tray.setToolTip('LEB2 Buddy');
    tray.on('click', showWindow);

    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { label: 'Check now', click: () => triggerNow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  }

  app.whenReady().then(() => {
    // Launch on login, but hidden — the tray is enough, a window popping up
    // at every boot would be annoying. The scheduler runs either way.
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'],
    });

    db = openDb();
    createWindow(process.argv.includes('--hidden'));
    createTray();
    ({ triggerNow } = startScheduler(db));

    ipcMain.handle('dashboard:get', () => getDashboardData(db));
    ipcMain.handle('cycle:run', () => triggerNow());
    ipcMain.handle('assignments:dismiss', (e, kind, itemId) => dismissAssignment(db, kind, itemId));
    ipcMain.handle('settings:getDiscordWebhookUrl', () => getSetting(db, 'discordWebhookUrl'));
    ipcMain.handle('settings:setDiscordWebhookUrl', (e, url) => setSetting(db, 'discordWebhookUrl', url));
    ipcMain.handle('settings:sendTestDiscordMessage', (e, url) => sendTestMessage(url));
    ipcMain.handle('settings:sendDashboardSummary', () => {
      const webhookUrl = getSetting(db, 'discordWebhookUrl');
      if (!webhookUrl) return;
      postSummaryToDiscord(webhookUrl, getDashboardData(db).week);
    });
  });

  // A second launch attempt reaches here instead of starting its own app —
  // surface the existing (possibly tray-hidden) window rather than no-op.
  app.on('second-instance', showWindow);

  app.on('before-quit', () => {
    isQuitting = true;
    if (db) db.close();
  });
}
