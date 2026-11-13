'use strict';
importScripts('shared.js');

const { sections } = Cleaner;
const MAX_PASSES = 4;
const STORAGE = 'job';
const MAX_ITEM_ATTEMPTS = 2;
let queue = Promise.resolve();

function serial(operation) {
  const response = queue.then(operation);
  queue = response.catch(() => {});
  return response;
}

async function read() {
  return (await chrome.storage.session.get(STORAGE))[STORAGE];
}

async function report(job, includeCheckpoint = false) {
  if (job) return job;
  const saved = await chrome.storage.local.get(['report', 'checkpoint']);
  if (!saved.report) return null;
  return includeCheckpoint ? { ...saved.report, ...saved.checkpoint } : saved.report;
}

function itemKey(item) {
  return item.kind + ':' + item.url.split('/').at(-1);
}

function addEvent(job, text) {
  (job.events ||= []).push({ time: Date.now(), text });
  job.events = job.events.slice(-15);
}

function rememberFailure(job, item) {
  const failed = job.itemFailures ||= {};
  const key = itemKey(item);
  failed[key] = (failed[key] || 0) + 1;
}

async function write(job) {
  job.revision = (job.revision || 0) + 1;
  await chrome.storage.session.set({ [STORAGE]: job });
  const { documentId, pending, itemFailures, ...snapshot } = job;
  await chrome.storage.local.set({ report: snapshot, checkpoint: { pending, itemFailures } });
}

async function pause(job, reason, rateLimited = false) {
  if (job.pending) {
    rememberFailure(job, job.pending);
    reason += ` Check the last attempted item: ${job.pending.url}`;
  }
  job.status = 'paused';
  job.waitUntil = rateLimited ? Date.now() + Cleaner.rateRest : 0;
  job.ratePaused = rateLimited;
  job.message = reason;
  addEvent(job, reason);
  job.documentId = null;
  job.pending = null;
  await write(job);
  return job;
}

function atSection(job, url) {
  return Cleaner.atSection(job.section, url, job.handle, job.history);
}

async function navigate(job, { refresh = false } = {}) {
  const target = Cleaner.sectionTarget(job.section, job.handle, job.history);
  job.documentId = null;
  await write(job);
  try {
    const tab = await chrome.tabs.get(job.tabId);
    if (refresh && atSection(job, tab.url) && (!tab.pendingUrl || atSection(job, tab.pendingUrl))) {
      await chrome.tabs.reload(job.tabId);
    } else {
      await chrome.tabs.update(job.tabId, { url: target });
    }
  } catch {
    await pause(job, 'The cleanup tab is unavailable. Continue cleanup to reopen it.');
  }
}

async function openSection(job) {
  job.history = false;
  job.skippedHere = 0;
  job.batchActions = 0;
  job.recoveries = 0;
  job.redirects = 0;
  job.refreshPending = false;
  job.waitUntil = 0;
  job.message = `Opening ${sections[job.section].name}…`;
  addEvent(job, `Pass ${job.pass} · ${job.message}`);
  await navigate(job);
}

function recordInterruptedAction(job, text) {
  if (!job.pending) return;
  job.totals.errors++;
  rememberFailure(job, job.pending);
  job.problem = { text, url: job.pending.url };
  job.nextActionAt = Math.max(job.nextActionAt, Date.now() + (job.pace ?? Cleaner.defaultPace));
  job.pending = null;
}

async function openHistory(job) {
  job.history = true;
  job.redirects = 0;
  job.message = `Looking for ${sections[job.section].name} in History…`;
  await navigate(job);
}

async function recoverRoute(job, url) {
  const path = Cleaner.route(url);
  const name = sections[job.section].name;
  const destination = path === '/home' || path === '' ? 'Home' : path;
  if (job.status === 'stopping') {
    await pause(job, 'Stopped while the X page was changing.');
    return;
  }
  if (path === null || /^\/(?:login|logout|account\/(?:access|suspended)|i\/flow\/(?:challenge|verify|login|signup))(?:\/|$)/.test(path)) {
    await pause(job, path === null ? 'The cleanup tab left x.com. Continue cleanup to reopen your profile.'
      : 'X requires sign-in or an account check. Resolve it on X, then continue.');
    return;
  }

  const detail = `X opened ${destination} while loading ${name}.`;
  addEvent(job, detail);
  if (job.pending) {
    recordInterruptedAction(job, detail + ' The last action could not be verified.');
  } else if (!job.problem?.url) {
    job.problem = { text: detail };
  }
  if ((job.redirects || 0) < 2) {
    job.redirects = (job.redirects || 0) + 1;
    job.message = `${detail} Reopening ${name} (${job.redirects}/2)…`;
    await navigate(job);
    return;
  }
  if ((job.section === 3 || job.section === 4) && !job.history) {
    await openHistory(job);
    return;
  }
  await finishSection(job, { result: 'review', detail: detail + ' The redirect persisted after two retries.' });
}

async function start(old, selection, pace, preview, accountHandle) {
  if (old?.status === 'running' || old?.status === 'stopping' ||
      (old?.handle === accountHandle && old.ratePaused && old.waitUntil > Date.now())) return old;
  const selected = Cleaner.sectionOrder.filter(index => Array.isArray(selection) && selection.includes(index));
  if (!selected.length) {
    throw new Error('Select at least one category.');
  }
  if (!Cleaner.validPace(pace)) throw new Error('Enter a delay from 0 to 3600 seconds.');
  let tab;
  if (old?.handle === accountHandle && ['paused', 'review', 'finished', 'previewed'].includes(old.status)) {
    try {
      const candidate = await chrome.tabs.get(old.tabId);
      if (Cleaner.route(candidate.url) !== null) {
        tab = await chrome.tabs.update(candidate.id, { active: true, url: 'about:blank' });
      }
    } catch {
      // The previous cleanup tab no longer exists.
    }
  }
  if (!tab) tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  const keep = old?.handle === accountHandle && ['paused', 'review'].includes(old.status) && Cleaner.sameSections(old.selected, selected) &&
    Boolean(old.preview) === preview;
  const resume = keep && old.status === 'paused' && String(old.selected) === String(selected) && selected.includes(old.section);
  if (keep && old.pending) recordInterruptedAction(old, 'Chrome closed before the last action could be verified.');
  const job = {
    id: crypto.randomUUID(), tabId: tab.id, status: 'running', selected, preview, handle: accountHandle,
    itemFailures: keep && old.status === 'paused' ? old.itemFailures || {} : {},
    bookmarkBulkTried: keep && Boolean(old.bookmarkBulkTried),
    bookmarksCleared: keep && Boolean(old.bookmarksCleared),
    events: keep ? old.events || [] : [],
    section: resume ? old.section : selected[0], pass: resume ? old.pass : 1,
    documentId: null, pending: null, nextActionAt: old?.handle === accountHandle ? old.nextActionAt || 0 : 0,
    pace,
    changes: resume ? old.changes : 0, results: resume ? old.results : [],
    totals: keep ? old.totals : { deleted: 0, reposts: 0, bookmarks: 0, likes: 0, skipped: 0, errors: 0 },
    message: '', problem: keep ? old.problem : null
  };
  await openSection(job);
  return job;
}

async function finishSection(job, message) {
  job.results.push({
    section: job.section,
    name: sections[job.section].name,
    status: message.result === 'clear' ? 'clear' : 'review',
    detail: String(message.detail || '').slice(0, 250),
    found: job.preview ? Math.max(0, Number(message.found) || 0) : undefined
  });
  addEvent(job, `${sections[job.section].name} · ${message.result === 'clear' ? 'Scanned' : 'Needs review'}`);
  const next = job.selected[job.selected.indexOf(job.section) + 1];
  if (next !== undefined) {
    job.section = next;
    await openSection(job);
    return;
  }
  if (!job.preview && (job.pass === 1 || (job.changes > 0 && job.pass < MAX_PASSES))) {
    job.pass++;
    job.section = job.selected[0];
    job.changes = 0;
    job.results = [];
    await openSection(job);
    return;
  }
  const unresolved = job.changes > 0 || job.results.some(result => result.status !== 'clear');
  job.status = job.preview ? 'previewed' : unresolved ? 'review' : 'finished';
  job.waitUntil = 0;
  if (!unresolved) job.problem = null;
  job.documentId = null;
  job.message = job.preview
    ? 'Preview complete. Counts reflect the items X exposed during this scan.'
    : unresolved
    ? 'The route finished with items or sections to review.'
    : 'No more eligible items surfaced in the selected sections.';
  await write(job);
}

async function refreshSection(job, message) {
  const mode = message.mode;
  if (mode === 'tail' && !job.batchActions) return null;
  if (mode === 'recovery' && job.recoveries >= 2) return { exhausted: true };
  if (!['tail', 'recovery'].includes(mode)) return null;

  const reason = String(message.reason || '').slice(0, 180);
  if (mode === 'recovery') {
    job.recoveries++;
    job.nextActionAt = Math.max(job.nextActionAt, Date.now() + 30000 * job.recoveries);
    job.problem ||= { text: reason };
    addEvent(job, `${sections[job.section].name} · Retry ${job.recoveries}/2 · ${reason}`);
  }
  job.batchActions = 0;
  job.refreshPending = false;
  job.skippedHere = 0;
  job.waitUntil = job.nextActionAt;
  job.message = mode === 'recovery' ? `Retrying ${sections[job.section].name} after an X page issue.`
    : `Taking a break, then checking for more ${sections[job.section].name.toLowerCase()}.`;
  await navigate(job, { refresh: true });
  return { reloading: job.status === 'running' };
}

function validPending(item, accountHandle) {
  if (item?.kind === 'bookmark-bulk') return item.url === Cleaner.sectionUrl(3);
  return item && /^(delete|repost|bookmark|like)$/.test(item.kind) &&
    /^https:\/\/x\.com\/[a-z0-9_]{1,15}\/status\/\d{1,22}$/i.test(item.url) &&
    (item.kind !== 'delete' || new URL(item.url).pathname.split('/')[1].toLowerCase() === accountHandle);
}

async function detectAccount() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (Cleaner.route(tab?.url) === null) return { reason: 'Open a signed-in x.com tab to start.' };
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'detectAccount' }, { frameId: 0 });
    const handle = Cleaner.normalizeHandle(response?.handle);
    return handle ? { handle } : { reason: 'Sign in to X and wait for the page to load.' };
  } catch {
    return { reason: 'Reload this X tab so X Cleaner can detect your account.' };
  }
}

async function handle(message, sender) {
  const job = await read();
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
  if (fromPopup && message.type === 'status') {
    const saved = await report(job);
    if (!saved?.handle) return null;
    if (!job && ['running', 'stopping'].includes(saved?.status)) {
      return { ...saved, status: 'paused', message: 'Cleanup was interrupted. Continue to resume the section.' };
    }
    return saved;
  }
  if (fromPopup && message.type === 'detect') return detectAccount();
  if (fromPopup && message.type === 'openX') {
    await chrome.tabs.create({ url: Cleaner.origin, active: true });
    return null;
  }
  if (fromPopup && message.type === 'start') {
    if (job?.handle && ['running', 'stopping'].includes(job.status)) return job;
    const detected = await detectAccount();
    if (!detected.handle) throw new Error(detected.reason);
    if (detected.handle !== message.expectedHandle) {
      throw new Error('The active account changed. Reopen X Cleaner and check the account shown.');
    }
    const old = await report(job, true);
    const previous = !job && ['running', 'stopping'].includes(old?.status)
      ? { ...old, status: 'paused' } : old;
    const pace = message.pace === undefined ? (previous?.handle === detected.handle
      ? previous.pace ?? Cleaner.defaultPace : Cleaner.defaultPace) : message.pace;
    return start(previous, message.selection, pace, message.preview === true, detected.handle);
  }
  if (!job?.handle || !['running', 'stopping'].includes(job.status)) return null;
  const fromTab = sender.tab?.id === job.tabId && sender.frameId === 0;

  if (message.type === 'stop' && (fromPopup || (fromTab && sender.documentId === job.documentId))) {
    if (!job.pending) return pause(job, 'Stopped. Continue cleanup to rescan.');
    job.status = 'stopping';
    job.message = 'Stopping after the current request…';
    await write(job);
    return job;
  }
  if (!fromTab) return null;
  if (message.type === 'hello' && job.status === 'running' && atSection(job, sender.url)) {
    if (job.documentId && job.documentId !== sender.documentId) {
      recordInterruptedAction(job, 'X reloaded the page before the last action could be verified. Rescanning this section.');
      job.message = `Rechecking ${sections[job.section].name} after a page reload…`;
    }
    job.documentId = sender.documentId;
    await write(job);
    return job;
  }
  if (message.id !== job.id || message.section !== job.section || message.pass !== job.pass ||
      sender.documentId !== job.documentId) return null;

  if (message.type === 'routeLost') {
    const tab = await chrome.tabs.get(job.tabId);
    if (!tab.pendingUrl && !atSection(job, tab.url)) await recoverRoute(job, tab.url);
    return job;
  }
  if (!atSection(job, sender.url)) return null;

  if (message.type === 'settled' && job.pending?.url === message.url) {
    if (message.ok) {
      const kind = job.pending.kind;
      if (kind === 'bookmark-bulk') {
        job.bookmarksCleared = true;
        addEvent(job, 'Bookmarks · X confirmed an empty list after clearing all.');
      } else {
        const key = { delete: 'deleted', repost: 'reposts', bookmark: 'bookmarks', like: 'likes' }[kind];
        job.totals[key]++;
        if (kind === 'delete') job.message = `Delete confirmed · ${job.totals.deleted} deleted this run.`;
      }
      job.changes++;
      job.recoveries = 0;
      if (job.itemFailures) delete job.itemFailures[itemKey(job.pending)];
    } else if (!message.cancelled) {
      job.totals.errors++;
      rememberFailure(job, job.pending);
      job.problem = { text: String(message.issue || 'X did not verify the action.').slice(0, 220), url: message.url };
    }
    if (message.sent || message.ok) job.batchActions++;
    if (job.pending.kind === 'bookmark-bulk' && message.ok) job.batchActions = 1;
    job.nextActionAt = Date.now() + (job.pace ?? Cleaner.defaultPace);
    if (!job.refreshPending && job.batchActions >= Cleaner.batchSize) {
      job.refreshPending = true;
      addEvent(job, `${sections[job.section].name} · Break after six actions`);
      job.nextActionAt = Math.max(job.nextActionAt, Date.now() + Cleaner.batchRest);
    }
    job.pending = null;
    if (job.status === 'stopping') {
      return pause(job, message.ok ? 'Stopped.' : `Stopped. Check the last attempted item: ${message.url}`);
    }
    await write(job);
    return job;
  }
  if (message.type === 'pause') return pause(job, String(message.reason).slice(0, 350), message.rateLimited === true);
  if (job.status !== 'running') return null;

  if (message.type === 'progress') {
    if (Number.isSafeInteger(message.skipped) && message.skipped >= job.skippedHere) {
      job.totals.skipped += message.skipped - job.skippedHere;
      job.skippedHere = message.skipped;
    }
    job.message = String(message.text).slice(0, 150);
    job.waitUntil = message.waiting ? job.nextActionAt : 0;
    await write(job);
    return job;
  }
  if (message.type === 'begin' && !job.preview && !job.pending && validPending(message.item, job.handle)) {
    const target = message.item.kind;
    const permitted = (target === 'delete' && job.section <= 1 && job.selected.includes(job.section)) ||
      (target === 'repost' && job.section === 2) ||
      (target === 'bookmark' && job.section === 3) ||
      (target === 'bookmark-bulk' && job.section === 3 && !job.bookmarkBulkTried &&
        Cleaner.route(sender.url) === Cleaner.route(Cleaner.sectionUrl(3))) || (target === 'like' && job.section === 4);
    if (!permitted) return null;
    const remaining = job.nextActionAt - Date.now();
    if (remaining > 0) return { wait: remaining };
    if ((job.itemFailures?.[itemKey(message.item)] || 0) >= MAX_ITEM_ATTEMPTS) return { skipped: true };
    if (job.refreshPending) {
      job.refreshPending = false;
      job.batchActions = 0;
    }
    if (target === 'bookmark-bulk') job.bookmarkBulkTried = true;
    job.pending = message.item;
    job.waitUntil = 0;
    await write(job);
    return { allowed: true };
  }
  if (message.type === 'check' && job.pending?.url === message.url) {
    const tab = await chrome.tabs.get(job.tabId);
    return { allowed: atSection(job, tab.url) && !tab.pendingUrl };
  }
  if (message.type === 'refresh' && !job.pending) return refreshSection(job, message);
  if (message.type === 'sectionIssue') {
    if (job.pending) recordInterruptedAction(job, 'The last action could not be verified.');
    const reason = String(message.reason || 'X could not load this section.').slice(0, 180);
    const outcome = await refreshSection(job, { mode: 'recovery', reason });
    if (outcome.exhausted) {
      await finishSection(job, { result: 'review', detail: reason });
    }
    return job;
  }
  if (message.type === 'sectionEnd' && !job.pending) {
    if ((job.section === 3 || job.section === 4) && !job.history && message.fallback) {
      await openHistory(job);
      return job;
    }
    await finishSection(job, message);
    return job;
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(() => handle(message, sender)).then(
    result => respond({ result }),
    error => respond({ error: error.message })
  );
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  serial(async () => {
    const job = await read();
    if (job?.tabId === tabId && ['running', 'stopping'].includes(job.status)) {
      await pause(job, 'The cleanup tab closed. Continue cleanup to rescan.');
    }
  }).catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, change, eventTab) => {
  if (change.status !== 'complete' && !change.url) return;
  serial(async () => {
    const job = await read();
    if (!job?.handle || job.tabId !== tabId || !['running', 'stopping'].includes(job.status) ||
        eventTab.url === 'about:blank' || atSection(job, eventTab.url)) return;
    const tab = await chrome.tabs.get(tabId);
    if (tab.pendingUrl || tab.status === 'loading' || tab.url !== eventTab.url) return;
    await recoverRoute(job, tab.url);
  }).catch(console.error);
});
