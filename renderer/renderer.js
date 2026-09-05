// LEB2 scraper — step 6
// No routing/navigation — this is the entire renderer. Polls the DB
// (via main, through preload's IPC bridge) on load, on focus, and on a
// timer, so it reflects background scheduler runs without a restart.

const POLL_MS = 60000;

// Same approach as notify.js's formatBangkok, reimplemented here since the
// renderer can't require() main-process files.
function formatBangkok(iso) {
  if (!iso) return 'No due date';
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

const characterEl = document.getElementById('character');
const characterLabelEl = document.getElementById('character-label');
const lastCheckedEl = document.getElementById('last-checked');
const errorBannerEl = document.getElementById('error-banner');
const todayListEl = document.getElementById('today-list');
const refreshBtn = document.getElementById('refresh-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const discordWebhookInput = document.getElementById('discord-webhook-input');
const settingsSaveBtn = document.getElementById('settings-save-btn');
const settingsTestBtn = document.getElementById('settings-test-btn');
const settingsSendSummaryBtn = document.getElementById('settings-send-summary-btn');
const settingsStatusEl = document.getElementById('settings-status');

const connectViewEl = document.getElementById('connect-view');
const dashboardViewEl = document.getElementById('dashboard-view');
const connectBtn = document.getElementById('connect-btn');
const connectStatusEl = document.getElementById('connect-status');
const reconnectBanner = document.getElementById('reconnect-banner');
const reconnectBtn = document.getElementById('reconnect-btn');
const reconnectStatusEl = document.getElementById('reconnect-status');

function updateSendSummaryDisabled() {
  settingsSendSummaryBtn.disabled = discordWebhookInput.value.trim() === '';
}

discordWebhookInput.addEventListener('input', updateSendSummaryDisabled);
updateSendSummaryDisabled();

// Load the saved webhook URL as soon as the page starts, not just when the
// settings panel happens to be opened.
window.leb2.getDiscordWebhookUrl().then((url) => {
  discordWebhookInput.value = url || '';
  updateSendSummaryDisabled();
});

function renderTodayItem(item, dismissible) {
  const li = document.createElement('li');
  li.className = item.submitted ? 'submitted' : '';

  const check = document.createElement('span');
  check.className = 'check';
  check.textContent = item.submitted ? '✓' : '';

  const code = document.createElement('span');
  code.className = 'class-code';
  code.textContent = item.classCode;

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = item.title;

  const due = document.createElement('span');
  due.className = 'due';
  due.textContent = formatBangkok(item.dueAt);

  li.append(check, code, title, due);

  if (dismissible) {
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'dismiss-btn';
    dismiss.title = 'Dismiss';
    dismiss.textContent = '×';
    dismiss.addEventListener('click', async () => {
      await window.leb2.dismissAssignment(item.kind, item.itemId);
      refresh();
    });
    li.append(dismiss);
  }

  return li;
}

function renderGroup(label, items, extraClass, dismissible) {
  const group = document.createElement('div');
  group.className = extraClass ? `day-group ${extraClass}` : 'day-group';

  const header = document.createElement('h3');
  header.className = 'day-header';
  header.textContent = label;

  const list = document.createElement('ul');
  for (const item of items) {
    list.appendChild(renderTodayItem(item, dismissible));
  }

  group.append(header, list);
  return group;
}

// Persisted across launches (see renderer's localStorage) so the user's
// choice to check "Upcoming" sticks instead of re-collapsing every launch.
const UPCOMING_EXPANDED_KEY = 'leb2.upcomingExpanded';

function renderUpcoming(upcoming) {
  const count = upcoming.reduce((sum, group) => sum + group.items.length, 0);
  if (count === 0) return null;

  const section = document.createElement('div');
  section.className = 'day-group upcoming-group';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'day-header upcoming-header';

  const body = document.createElement('div');
  body.className = 'upcoming-body';
  for (const group of upcoming) {
    body.appendChild(renderGroup(group.label, group.items, 'date-group'));
  }

  function setExpanded(expanded) {
    body.hidden = !expanded;
    header.setAttribute('aria-expanded', String(expanded));
    header.textContent = `Upcoming (${count}) ${expanded ? '▾' : '▸'}`;
  }

  header.addEventListener('click', () => {
    const expanded = body.hidden;
    setExpanded(expanded);
    localStorage.setItem(UPCOMING_EXPANDED_KEY, expanded ? '1' : '0');
  });

  setExpanded(localStorage.getItem(UPCOMING_EXPANDED_KEY) === '1');

  section.append(header, body);
  return section;
}

// Renders an error message from the Connect/Reconnect flow into `el`. The
// Chrome-missing message (see scrape.js/step 8) gets a real clickable link
// instead of the raw sentence with a bare URL in it.
function renderConnectError(el, message) {
  el.innerHTML = '';
  if (message.includes('Google Chrome is required')) {
    el.append("Google Chrome is required but wasn't found on this PC. ");
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Download Chrome';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.leb2.openExternal('https://www.google.com/chrome/');
    });
    el.append(link);
  } else if (/context or browser has been closed|target closed/i.test(message)) {
    // The user closed the login window instead of signing in — Playwright's
    // own wording for this ("Target page, context or browser has been
    // closed") is internal jargon, not something to show someone.
    el.textContent = 'Sign-in was cancelled. Click the button above to try again.';
  } else {
    el.textContent = message;
  }
}

// Shared by the Connect screen's button and the Reconnect banner's button —
// both run the exact same scrape.js --login flow, then a normal cycle.
async function runConnectFlow(button, statusEl) {
  button.disabled = true;
  statusEl.textContent = '';
  statusEl.textContent = 'Sign in to LEB2 in the window that opened…';
  const result = await window.leb2.connectLeb2();
  if (result.ok) {
    statusEl.textContent = 'Connected! Checking for assignments…';
    await window.leb2.runCycle();
    await refresh();
  } else {
    renderConnectError(statusEl, result.error);
    button.disabled = false;
  }
}

connectBtn.addEventListener('click', () => runConnectFlow(connectBtn, connectStatusEl));
reconnectBtn.addEventListener('click', () => runConnectFlow(reconnectBtn, reconnectStatusEl));

function render(data) {
  const connected = data.auth.connected;
  connectViewEl.hidden = connected;
  dashboardViewEl.hidden = !connected;
  if (!connected) return; // nothing else to render until they've connected

  characterEl.className = `character state-${data.character.state}`;
  characterLabelEl.textContent = data.character.label;

  lastCheckedEl.textContent = data.lastRun
    ? `Last checked ${formatBangkok(data.lastRun.started_at)}`
    : 'Never checked yet';

  reconnectBanner.hidden = !data.auth.needsReconnect;

  // The generic error banner doesn't apply to an expired session — that
  // gets the distinct Reconnect banner above instead (see step 7).
  const lastRunFailed = data.lastRun && !data.lastRun.ok && !data.auth.needsReconnect;
  errorBannerEl.hidden = !lastRunFailed;
  if (lastRunFailed) {
    errorBannerEl.textContent = `Last check failed: ${data.lastRun.error || 'unknown error'}`;
  }

  const { days, missed, upcoming } = data.week;
  todayListEl.innerHTML = '';

  const nonEmptyDays = days.filter((day) => day.items.length > 0);
  const upcomingCount = upcoming.reduce((sum, group) => sum + group.items.length, 0);

  if (nonEmptyDays.length === 0 && missed.length === 0 && upcomingCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nothing due this week.';
    todayListEl.appendChild(empty);
  } else {
    for (const day of nonEmptyDays) {
      todayListEl.appendChild(renderGroup(day.label, day.items));
    }
    if (missed.length > 0) {
      todayListEl.appendChild(renderGroup('Missed', missed, 'missed-group', true));
    }
    const upcomingEl = renderUpcoming(upcoming);
    if (upcomingEl) todayListEl.appendChild(upcomingEl);
  }
}

async function refresh() {
  render(await window.leb2.getDashboard());
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Checking…';
  try {
    await window.leb2.runCycle();
  } finally {
    await refresh();
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Check now';
  }
});

settingsBtn.addEventListener('click', async () => {
  const opening = settingsPanel.hidden;
  settingsPanel.hidden = !opening;
  if (opening) {
    discordWebhookInput.value = (await window.leb2.getDiscordWebhookUrl()) || '';
    updateSendSummaryDisabled();
  }
});

settingsSaveBtn.addEventListener('click', async () => {
  await window.leb2.setDiscordWebhookUrl(discordWebhookInput.value.trim());
  settingsStatusEl.textContent = 'Saved';
  setTimeout(() => { settingsStatusEl.textContent = ''; }, 2000);
});

settingsTestBtn.addEventListener('click', async () => {
  const url = discordWebhookInput.value.trim();
  if (!url) {
    settingsStatusEl.textContent = 'Enter a webhook URL first';
    return;
  }
  settingsStatusEl.textContent = 'Sending…';
  const result = await window.leb2.sendTestDiscordMessage(url);
  settingsStatusEl.textContent = result.ok ? 'Test message sent' : `Failed: ${result.error}`;
  setTimeout(() => { settingsStatusEl.textContent = ''; }, 3000);
});

settingsSendSummaryBtn.addEventListener('click', async () => {
  await window.leb2.sendDashboardSummary();
  settingsStatusEl.textContent = 'Summary sent';
  setTimeout(() => { settingsStatusEl.textContent = ''; }, 2000);
});

window.addEventListener('focus', refresh);
setInterval(refresh, POLL_MS);
refresh();
