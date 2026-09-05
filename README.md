# LEB2 Buddy

A small desktop app for KMUTT students. It checks LEB2 for your assignments and
reminds you before they are due.

It runs on your own computer, using your own LEB2 account. Nothing is sent to a
server.

---

## What it does

- Reads your assignment list from LEB2 every 3 hours
- Shows what is due in the next 7 days, grouped by day
- Sends a Windows notification when a new assignment appears, and again when
  something is due within 48 hours and within 6 hours
- Can also send those reminders to Discord (optional)
- Knows what you have already submitted, because LEB2 tracks that

It only reads. It never submits work, changes anything, or writes to LEB2.

---

## Install

1. Install [Google Chrome](https://www.google.com/chrome/) if you do not have it
2. Download `LEB2 Buddy Setup.exe` from
   [Releases](https://github.com/Chanat-888/leb2-buddy/releases/latest)
3. Run it

Windows will show a blue warning, because the app is not code-signed. Click
**More info**, then **Run anyway**.

### First time you open it

The app will ask you to sign in.

1. Click **Connect LEB2**
2. A browser window opens on the LEB2 sign-in page
3. Sign in with your KMUTT account as normal
4. The window closes by itself and your assignments appear

You sign in on Microsoft's real sign-in page. The app never sees your password.

You will need to sign in again every few weeks, when LEB2 ends the session. The
app shows a **Reconnect** button when that happens.

---

## Using it

The app stays in your system tray, near the clock. Close the window and it keeps
running in the background.

- **Click the tray icon** to open the window
- **Check now** looks for changes right away
- **Gear button** opens settings
- **×** on a missed assignment hides it

It starts automatically when you turn on your computer.

If your computer is off, it cannot check. When you turn it on again, it checks
straight away and catches up.

### Discord reminders (optional)

1. In Discord: pick a channel, then Edit Channel → Integrations → Webhooks →
   New Webhook → Copy URL
2. Paste the URL into the app's settings and press **Save**
3. Press **Send test message** to make sure it works

Use a private channel. Your assignment names will be posted there.

---

## How it works

LEB2 has no API, so the app reads the same web pages you would read yourself.

1. It opens LEB2 in a hidden browser, using the session from when you signed in
2. It reads your class list, then each class's activity page — 8 pages in total
3. It saves what it finds to a small database on your computer
4. It compares the new result against the last one
5. If something changed, it tells you

Because it compares, you only get told once. An assignment sitting in the
"due in 2 days" range for a week gives you one reminder, not fifty.

Built with Node.js, Playwright, SQLite, and Electron.

---

## Your data

Everything stays on your computer, in `C:\Users\<you>\.leb2-buddy\`:

- Your LEB2 browser session
- Your assignment history
- Your Discord webhook URL, if you set one

Nothing is uploaded. There is no server. If you uninstall the app and delete
that folder, nothing is left.

---

## If something breaks

**Nothing appears after installing** — check that Chrome is installed.

**The app says it cannot reach LEB2** — your session probably ended. Click
Reconnect.

**No notifications** — check Windows Focus Assist is off
(Settings → System → Notifications).

**Everything is empty but you know you have work** — LEB2 may have changed their
website, which breaks the reader. Please open an
[issue](https://github.com/Chanat-888/leb2-buddy/issues).

---

## Notes

This is a personal project, not an official KMUTT tool. It is not connected to
or endorsed by the LEB2 team.

Each person runs their own copy, signed in to their own account. Passwords and
sessions are never shared, and there is no way to see anyone else's work.

Built by a CPE student at KMUTT. If the LEB2 team would prefer this not exist,
please get in touch and I will take it down.
