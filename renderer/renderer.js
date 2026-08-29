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
const settingsStatusEl = document.getElementById('settings-status');

function renderTodayItem(item) {
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
  return li;
}

function renderGroup(label, items, extraClass) {
  const group = document.createElement('div');
  group.className = extraClass ? `day-group ${extraClass}` : 'day-group';

  const header = document.createElement('h3');
  header.className = 'day-header';
  header.textContent = label;

  const list = document.createElement('ul');
  for (const item of items) {
    list.appendChild(renderTodayItem(item));
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

function render(data) {
  characterEl.className = `character state-${data.character.state}`;
  characterLabelEl.textContent = data.character.label;

  lastCheckedEl.textContent = data.lastRun
    ? `Last checked ${formatBangkok(data.lastRun.started_at)}`
    : 'Never checked yet';

  const lastRunFailed = data.lastRun && !data.lastRun.ok;
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
      todayListEl.appendChild(renderGroup('Missed', missed, 'missed-group'));
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
  if (opening) discordWebhookInput.value = (await window.leb2.getDiscordWebhookUrl()) || '';
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

window.addEventListener('focus', refresh);
setInterval(refresh, POLL_MS);
refresh();
