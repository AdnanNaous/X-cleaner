'use strict';

const get = id => document.getElementById(id);
const options = [...document.querySelectorAll('#options input[type="checkbox"]')];
const categories = { posts: 0, replies: 1, reposts: 2, bookmarks: 3, likes: 4 };
const paceInput = get('pace');
const countKeys = ['deleted', 'reposts', 'bookmarks', 'likes', 'skipped', 'errors'];
const statuses = { running: 'Running', stopping: 'Stopping', paused: 'Paused', review: 'Needs review', finished: 'Complete', previewed: 'Preview ready' };
let current;
let detection;
let busy = false;
let changed = false;
let paceChanged = false;
let reportReceived = false;

async function request(type, fields) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (response?.error) throw new Error(response.error);
  return response?.result;
}

function selection() {
  return options.filter(box => box.checked).map(box => categories[box.value]);
}

function enteredPace() {
  const milliseconds = Math.round(paceInput.valueAsNumber * 1000);
  return paceInput.validity.valid && Cleaner.validPace(milliseconds) ? milliseconds : null;
}

function renderCountdown() {
  const seconds = Math.ceil(((current?.waitUntil || 0) - Date.now()) / 1000);
  const timer = get('countdown');
  timer.hidden = seconds <= 0 || (current?.status === 'paused' && detection?.handle && current.handle !== detection.handle);
  if (seconds > 0) {
    timer.textContent = `Wait remaining: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const pausedForX = current?.status === 'paused' && current?.pausedAt && ['x', 'rate-limit'].includes(current.pauseKind) &&
    (!detection?.handle || current.handle === detection.handle);
  const elapsed = get('elapsed');
  elapsed.hidden = !pausedForX;
  elapsed.textContent = pausedForX ? 'Paused for ' + Cleaner.elapsedSince(current.pausedAt) : '';
  const rateHold = Boolean(current?.handle === detection?.handle && current?.ratePaused && seconds > 0);
  const disabled = busy || !detection?.handle || !selection().length || rateHold || Boolean(current?.alertPending);
  get('start').disabled = disabled || enteredPace() === null;
  get('preview').disabled = disabled;
}

function render() {
  const active = ['running', 'stopping'].includes(current?.status);
  const selected = selection();
  const same = Cleaner.sameSections(selected, current?.selected);
  const sameAccount = Boolean(detection?.handle && current?.handle === detection.handle);
  const report = active || sameAccount || current?.alertPending || (!detection?.handle && current?.status === 'paused') ? current : null;
  get('account').textContent = active && current.handle ? '@' + current.handle
    : detection?.handle ? '@' + detection.handle : 'Account not detected';
  get('open-x').hidden = active || !detection || Boolean(detection.handle) ||
    !detection.reason?.startsWith('Open');
  const resume = same && sameAccount && !current?.preview && ['paused', 'review'].includes(current?.status);
  const resumePreview = same && sameAccount && current?.preview && ['paused', 'review'].includes(current.status);
  get('status').textContent = active && current.preview ? 'Previewing' : statuses[report?.status] || 'Ready';
  get('options').disabled = active || busy;
  const invalidPace = enteredPace() === null;
  paceInput.setAttribute('aria-invalid', String(invalidPace));
  get('pace-error').hidden = !invalidPace;
  get('start').hidden = active;
  renderCountdown();
  get('start').textContent = resume ? (current.status === 'review' ? 'Retry cleanup' : 'Continue cleanup') : selected.length === 5 ? 'Clean everything' : 'Clean selected';
  get('preview').hidden = active;
  get('preview').textContent = resumePreview ? (current.status === 'review' ? 'Retry preview' : 'Continue preview') : 'Preview route';
  get('stop').hidden = !active;
  get('stop').textContent = current?.preview ? 'Stop preview' : 'Stop cleanup';
  get('stop').disabled = busy || current?.status === 'stopping';
  get('warning').textContent = active ? 'Keep the cleanup tab open.' : 'Permanently removes the selected activity.';
  document.querySelector('.stats').hidden = Boolean(report?.preview);
  get('achievement').hidden = report?.status !== 'finished';

  const messageText = report?.message;
  const [message, link] = (messageText || detection?.reason || 'Ready to scan your X account.').split(' Check the last attempted item: ');
  get('message').textContent = message;
  get('interruption').hidden = !report?.alertPending;
  get('interrupt-title').textContent = report?.preview ? 'Preview stopped' : 'Cleanup stopped';
  get('interrupt-reason').textContent = report?.alertPending ? message : '';
  get('acknowledge').disabled = busy;
  get('message').hidden = Boolean(report?.alertPending);
  const problem = get('problem');
  const latestIssue = report?.problem;
  problem.hidden = !latestIssue?.text;
  problem.textContent = latestIssue?.text ? `Last issue: ${latestIssue.text}` : '';
  const lastItem = get('last-item');
  const lastUrl = link || latestIssue?.url || '';
  lastItem.hidden = !/^https:\/\/x\.com\/[a-z0-9_]{1,15}\/status\/\d+$/i.test(lastUrl);
  if (!lastItem.hidden) lastItem.href = lastUrl;
  for (const key of countKeys) get(key).textContent = (report?.totals?.[key] || 0).toLocaleString();
  if (report?.bookmarksCleared) get('bookmarks').textContent = 'All';
  renderRoute(same ? report : null, selected);
  renderEvents(report?.events || []);
}

function renderRoute(state, selected) {
  const list = get('route-list');
  list.replaceChildren();
  get('route-pass').textContent = state ? 'Pass ' + state.pass : '';
  for (const index of selected) {
    const name = Cleaner.sections[index].name;
    const result = state?.results?.find(entry => entry.section === index || entry.name === name);
    const active = state?.section === index && ['running', 'stopping', 'paused'].includes(state.status);
    const item = document.createElement('li');
    if (active) item.setAttribute('aria-current', 'step');
    const title = document.createElement('strong');
    const label = document.createElement('span');
    title.textContent = name;
    label.textContent = active ? (state.status === 'paused' ? 'Paused here' : 'Current')
      : result?.status === 'clear' ? (state.preview ? result.found.toLocaleString() + ' found' : 'Scanned')
        : result ? 'Needs review' : 'Queued';
    item.append(title, label);
    if (result?.status === 'review') {
      const detail = document.createElement('p');
      detail.textContent = result.detail;
      item.append(detail);
    }
    list.append(item);
  }
  if (!selected.length) {
    const item = document.createElement('li');
    item.textContent = 'Select a category to plan the route.';
    list.append(item);
  }
}

function renderEvents(events) {
  get('events').hidden = !events.length;
  const list = get('event-list');
  list.replaceChildren();
  for (const event of events.slice().reverse()) {
    const item = document.createElement('li');
    const time = new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.textContent = time + ' · ' + event.text;
    list.append(item);
  }
}

function setState(state) {
  if (current && (!state || (state.id === current.id && (state.revision || 0) < (current.revision || 0)))) return;
  current = state;
  syncOptions();
  render();
}

function syncOptions() {
  const state = current;
  if (!state || (state.handle !== detection?.handle && !['running', 'stopping'].includes(state.status))) return;
  if (state.selected && !changed) {
    for (const box of options) box.checked = state.selected.includes(categories[box.value]);
  }
  if (Cleaner.validPace(state.pace) && !paceChanged) paceInput.value = String(state.pace / 1000);
}

paceInput.addEventListener('input', () => {
  paceChanged = true;
  render();
});
setInterval(renderCountdown, 1000);

for (const box of options) box.addEventListener('change', () => {
  changed = true;
  render();
});

async function action(type, preview = false) {
  const pace = enteredPace();
  if (type === 'start' && (current?.alertPending || (!preview && pace === null))) return;
  busy = true;
  render();
  try {
    const fields = type === 'start' ? { selection: selection(), pace: pace ?? undefined, preview, expectedHandle: detection?.handle } : type === 'acknowledge' ? { id: current?.id } : {};
    setState(await request(type, fields));
    busy = false;
    render();
  } catch (error) {
    busy = false;
    render();
    get(current?.alertPending ? 'interrupt-reason' : 'message').textContent = error.message || 'Reopen X Cleaner and try again.';
  }
}

get('open-x').addEventListener('click', () => request('openX').catch(error => {
  get('message').textContent = error.message;
}));
get('start').addEventListener('click', () => action('start'));
get('preview').addEventListener('click', () => action('start', true));
get('stop').addEventListener('click', () => action('stop'));
get('acknowledge').addEventListener('click', () => action('acknowledge'));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.report?.newValue) {
    reportReceived = true;
    setState(changes.report.newValue);
  }
});
request('detect').then(result => { detection = result; syncOptions(); render(); }).catch(error => {
  detection = { reason: error.message };
  render();
});
request('status').then(state => {
  if (!reportReceived) setState(state);
}).catch(error => {
  if (!reportReceived) get('message').textContent = error.message;
});
