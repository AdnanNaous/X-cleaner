const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function harness() {
  const callbacks = {};
  const stores = { session: {}, local: {} };
  const navigations = [];
  const reloads = [];
  const badges = [];
  const origin = 'chrome-extension://test/';
  const tabs = new Map();
  let nextTabId = 10;
  let activeAccount = 'sample_user';
  let activeUrl = 'https://x.com/home';
  let now = 10000;
  const hook = name => ({ addListener: listener => { callbacks[name] = listener; } });
  const storage = Object.fromEntries(Object.entries(stores).map(([name, state]) => [name, {
    get: async keys => Object.fromEntries([keys].flat().map(key => [key, structuredClone(state[key])])),
    set: async fields => Object.assign(state, structuredClone(fields))
  }]));
  const chrome = {
    runtime: { getURL: name => origin + name, onMessage: hook('message') },
    storage,
    action: { setBadgeText: async ({ text }) => { badges.push(text); } },
    tabs: {
      query: async () => [{ id: 5, url: activeUrl }],
      sendMessage: async () => ({ handle: activeAccount }),
      create: async details => {
        const tab = { id: ++nextTabId, url: details.url, status: 'complete' };
        tabs.set(tab.id, tab);
        return { ...tab };
      },
      get: async id => ({ ...tabs.get(id) }),
      update: async (id, details) => {
        const tab = tabs.get(id);
        if (details.url) {
          navigations.push(details.url);
          tab.url = details.url;
        }
        delete tab.pendingUrl;
        tab.status = 'complete';
        return { ...tab };
      },
      reload: async (id, options) => { reloads.push({ id, options }); },
      onRemoved: hook('removed'), onUpdated: hook('updated')
    }
  };
  const context = vm.createContext({
    chrome, URL, console, crypto: { randomUUID }, Date: { now: () => now },
    importScripts: file => vm.runInContext(fs.readFileSync('extension/' + file, 'utf8'), context)
  });
  vm.runInContext(fs.readFileSync('extension/worker.js', 'utf8'), context);
  const send = (message, sender) => new Promise((resolve, reject) =>
    callbacks.message(message, sender, response => response.error ? reject(Error(response.error)) : resolve(response.result)));
  return {
    stores, navigations, reloads, badges,
    setAccount: (account, url = 'https://x.com/home') => { activeAccount = account; activeUrl = url; },
    setTab: (job, details) => Object.assign(tabs.get(job.tabId), details),
    change: (job, details, eventTab = details) => {
      Object.assign(tabs.get(job.tabId), details);
      callbacks.updated(job.tabId, { status: 'complete' }, { ...eventTab });
      return send({ type: 'status' }, { url: origin + 'popup.html' });
    },
    tick: ms => { now += ms; },
    popup: (type, args) => send({ type, expectedHandle: 'sample_user', ...args }, { url: origin + 'popup.html' }),
    tab: (job, type, args, over = {}) => send({ type, id: job.id, section: job.section, pass: job.pass, ...args },
      { documentId: 'doc-' + job.pass + '-' + job.section, frameId: 0, tab: { id: job.tabId },
        url: navigations.at(-1), ...over })
  };
}
const candidate = (kind, id = 10, author = 'sample_user') =>
  ({ kind, url: 'https://x.com/' + author + '/status/' + id });
const transfer = async (h, job, kind, id) => {
  await h.tab(job, 'hello');
  const item = candidate(kind, id);
  const permission = await h.tab(job, 'begin', { item });
  assert.ok(permission.allowed);
  assert.ok((await h.tab(job, 'check', { url: item.url })).allowed);
  await h.tab(job, 'settled', { url: item.url, ok: true });
  h.tick(15000);
};
const end = async (h, job, result = 'clear') => {
  await h.tab(job, 'hello');
  return h.tab(job, 'sectionEnd', { result, detail: result });
};

(async () => {
  const h = harness();
  let job = await h.popup('start', { selection: [0, 1, 2, 3, 4] });
  assert.equal((await h.popup('start', { selection: [4] })).id, job.id);
  assert.equal(await h.tab(job, 'hello', {}, { tab: { id: 99 } }), null);
  await h.tab(job, 'hello');
  assert.equal(await h.tab(job, 'begin', { item: candidate('delete', 20, 'someone') }), null);
  assert.equal(await h.tab(job, 'begin', { item: candidate('like') }), null);
  assert.equal(job.pace, 15000);
  assert.equal(await h.tab(job, 'begin', { item: candidate('repost') }), null);
  await transfer(h, job, 'delete', 100);
  job = await end(h, job);
  await transfer(h, job, 'repost', 102);
  job = await end(h, job);
  await transfer(h, job, 'delete', 101);
  job = await end(h, job);
  await transfer(h, job, 'bookmark', 103);
  job = await end(h, job);
  await transfer(h, job, 'like', 104);
  job = await end(h, job);
  assert.equal(job.pass, 2);
  for (let i = 0; i < 5; i++) job = await end(h, job);
  assert.equal(job.status, 'finished');
  assert.deepEqual(job.totals, { deleted: 2, reposts: 1, bookmarks: 1, likes: 1, skipped: 0, errors: 0 });
  assert.deepEqual(h.navigations.map(link => new URL(link).pathname), [
    '/sample_user/with_replies', '/sample_user/reposts', '/sample_user', '/i/bookmarks', '/sample_user/likes',
    '/sample_user/with_replies', '/sample_user/reposts', '/sample_user', '/i/bookmarks', '/sample_user/likes'
  ]);
  console.log('PASS all routes, ownership and tab binding, exact per-action counts, second pass');

  for (const [section, pace, path] of [[1, 2000, '/sample_user/with_replies'], [0, 500, '/sample_user'], [0, 0, '/sample_user']]) {
    const custom = harness();
    job = await custom.popup('start', { selection: [section], pace });
    assert.deepEqual(Array.from(job.selected), [section]);
    assert.equal(new URL(custom.navigations.at(-1)).pathname, path);
    await custom.tab(job, 'hello');
    const first = candidate('delete', 50);
    assert.ok((await custom.tab(job, 'begin', { item: first })).allowed);
    await custom.tab(job, 'settled', { url: first.url, ok: true });
    const next = candidate('delete', 51);
    if (pace) {
      assert.equal((await custom.tab(job, 'begin', { item: next })).wait, pace);
      custom.tick(pace);
    }
    assert.ok((await custom.tab(job, 'begin', { item: next })).allowed);
    await custom.popup('stop');
    await custom.tab(job, 'settled', { url: next.url, cancelled: true });
    const resumed = await custom.popup('start', { selection: [section] });
    assert.equal(resumed.pace, pace);
    assert.equal(resumed.totals.deleted, 1);
  }
  const invalid = harness();
  for (const pace of [-1, 3600001, 0.5, Infinity, '2000', null]) {
    await assert.rejects(invalid.popup('start', { selection: [1], pace }), /delay/);
  }
  assert.equal(invalid.navigations.length, 0);
  const upgraded = harness();
  const old = await upgraded.popup('start', { selection: [0, 1, 2] });
  await upgraded.tab(old, 'hello');
  await transfer(upgraded, old, 'delete', 58);
  await upgraded.popup('stop');
  upgraded.stores.session.job.selected = [0, 1, 2];
  upgraded.stores.session.job.section = 0;
  const migrated = await upgraded.popup('start', { selection: [0, 1, 2] });
  assert.deepEqual(Array.from(migrated.selected), [1, 2, 0]);
  assert.equal(migrated.section, 1);
  assert.equal(migrated.totals.deleted, 1);
  console.log('PASS Replies and Posts can run independently, short delays and zero survive resume, and old routes migrate');

  const p = harness();
  job = await p.popup('start', { selection: [4] });
  await p.tab(job, 'hello');
  const item = candidate('like');
  assert.ok((await p.tab(job, 'begin', { item })).allowed);
  await p.tab(job, 'settled', { url: item.url, ok: true });
  assert.ok((await p.tab(job, 'begin', { item })).wait > 0);
  p.tick(15000);
  await p.tab(job, 'begin', { item });
  assert.equal((await p.popup('stop')).status, 'stopping');
  assert.equal(await p.tab(job, 'check', { url: item.url }), null);
  assert.equal((await p.tab(job, 'settled', { url: item.url, ok: false, cancelled: true })).status, 'paused');
  job = await p.popup('start', { selection: [4] });
  assert.equal(job.totals.likes, 1);
  await p.tab(job, 'hello');
  p.tick(15000);
  assert.ok((await p.tab(job, 'begin', { item })).allowed);
  assert.equal((await p.tab(job, 'hello', {}, { documentId: 'different' })).status, 'running');
  assert.equal(await p.tab(job, 'check', { url: item.url }), null);
  const afterReload = await p.popup('status');
  assert.equal(afterReload.totals.errors, 1);
  assert.equal(afterReload.problem.url, item.url);
  delete p.stores.session.job;
  assert.equal((await p.popup('status')).status, 'paused');
  console.log('PASS category-only start, fixed pacing, Stop blocks the next click, restart and reload recovery');

  const f = harness();
  job = await f.popup('start', { selection: [4] });
  await f.tab(job, 'hello');
  job = await f.tab(job, 'sectionEnd', { result: 'review', fallback: true });
  assert.equal(job.history, true);
  assert.match(f.navigations.at(-1), /\/i\/history$/);
  job = await end(f, job, 'review');
  assert.equal(job.pass, 2);
  job = await end(f, job, 'review');
  assert.equal(job.status, 'review');
  console.log('PASS Likes History fallback and unresolved report cannot earn achievement');

  const batch = harness();
  job = await batch.popup('start', { selection: [0, 1], pace: 30000 });
  await batch.tab(job, 'hello');
  for (let index = 0; index < 13; index++) {
    const item = candidate('delete', 200 + index);
    assert.ok((await batch.tab(job, 'begin', { item })).allowed);
    assert.ok((await batch.tab(job, 'check', { url: item.url })).allowed);
    const state = await batch.tab(job, 'settled', { url: item.url, ok: true, sent: true });
    const next = candidate('delete', 500);
    const pace = await batch.tab(job, 'begin', { item: next });
    assert.equal(pace.wait, (index + 1) % 6 === 0 ? 45000 : 30000);
    batch.tick(pace.wait);
    if (state.refreshPending) {
      const samePage = await batch.popup('status');
      assert.equal(samePage.section, 1);
      assert.equal(samePage.totals.deleted, index + 1);
    }
  }
  const batchReport = await batch.popup('status');
  assert.equal(batchReport.totals.deleted, 13);
  assert.equal(batchReport.events.filter(event => event.text.includes('Break after six actions')).length, 2);
  assert.equal(batch.reloads.length, 0);
  assert.equal(batch.navigations.length, 1);
  console.log('PASS thirteen deletions through two cooldowns without leaving the timeline');

  const recover = harness();
  job = await recover.popup('start', { selection: [0, 1] });
  job = await end(recover, job);
  await recover.tab(job, 'hello');
  for (const seconds of [30, 60]) {
    assert.ok((await recover.tab(job, 'refresh', { mode: 'recovery', reason: 'X stalled' })).reloading);
    await recover.tab(job, 'hello');
    assert.equal((await recover.tab(job, 'begin', { item: candidate('delete') })).wait, seconds * 1000);
    recover.tick(seconds * 1000);
  }
  assert.ok((await recover.tab(job, 'refresh', { mode: 'recovery', reason: 'X stalled' })).exhausted);
  assert.equal((await recover.tab(job, 'pause', { reason: 'X rate limit', rateLimited: true })).status, 'paused');
  assert.equal((await recover.popup('start', { selection: [0, 1] })).status, 'paused');
  const paused = await recover.popup('status');
  assert.equal(paused.alertPending, true);
  assert.equal(recover.badges.at(-1), '!');
  assert.equal(paused.waitUntil - paused.pausedAt, 300000);
  assert.equal(await recover.tab(paused, 'refresh', { mode: 'periodic' }), null);
  recover.tick(300000);
  assert.equal((await recover.popup('start', { selection: [0, 1] })).status, 'paused');
  assert.equal((await recover.popup('acknowledge', { id: paused.id })).status, 'paused');
  assert.equal(recover.badges.at(-1), '');
  const continued = await recover.popup('start', { selection: [0, 1] });
  assert.equal(continued.section, 0);
  assert.equal(continued.status, 'running');
  assert.equal(continued.results.length, 1);
  console.log('PASS bounded timeline recovery, rate-limit hold, and resume from current section');


  const route = harness();
  job = await route.popup('start', { selection: [0, 1, 2, 3, 4] });
  assert.equal(job.section, 1);
  const replies = 'https://x.com/sample_user/with_replies';
  const home = 'https://x.com/home';
  let status = await route.change(job, { url: replies }, { url: home });
  assert.equal(status.redirects, 0);
  status = await route.change(job, { url: home, pendingUrl: replies });
  assert.equal(status.redirects, 0);
  route.setTab(job, { url: replies, pendingUrl: undefined });
  await route.tab(job, 'hello');
  const reply = candidate('delete', 880);
  assert.ok((await route.tab(job, 'begin', { item: reply })).allowed);
  route.setTab(job, { url: home });
  assert.equal((await route.tab(job, 'check', { url: reply.url })).allowed, false);
  assert.equal(await route.tab(job, 'hello', {}, { url: home, documentId: 'home-doc' }), null);

  status = await route.tab(job, 'routeLost', {}, { url: home });
  assert.equal(status.redirects, 1);
  assert.equal(status.totals.errors, 1);
  assert.equal(status.problem.url, reply.url);
  assert.equal(route.navigations.at(-1), replies);
  status = await route.change(job, { url: home });
  assert.equal(status.redirects, 2);
  status = await route.change(job, { url: home });
  assert.equal(status.status, 'paused');
  assert.equal(status.section, 1);
  assert.equal(status.alertPending, true);
  await route.popup('acknowledge', { id: status.id });
  job = await route.popup('start', { selection: [3, 4] });
  assert.equal(job.section, 3);
  for (let retry = 0; retry < 3; retry++) status = await route.change(job, { url: home });
  assert.equal(status.history, true);
  assert.match(route.navigations.at(-1), /\/i\/history$/);
  assert.equal(await route.tab(status, 'hello', {}, { url: 'https://x.com/i/history/likes' }), null);
  job = await end(route, status);
  status = await route.change(job, { url: 'https://x.com/i/flow/login' });
  assert.equal(status.status, 'paused');
  assert.equal(status.section, 4);
  console.log('PASS Home redirect recovery and bounded pause, History fallback, auth pause, and stale events');

  const refresh = harness();
  job = await refresh.popup('start', { selection: [0, 1, 2] });
  await refresh.tab(job, 'hello');
  refresh.setTab(job, { url: home });
  assert.equal((await refresh.tab(job, 'refresh', { mode: 'recovery', reason: 'Page issue' })).reloading, true);
  assert.equal(refresh.reloads.length, 0);
  assert.equal(refresh.navigations.at(-1), replies);
  for (let issue = 0; issue < 2; issue++) {
    await refresh.tab(job, 'hello');
    status = await refresh.tab(job, 'sectionIssue', { reason: 'Page issue' });
  }
  assert.equal(status.status, 'paused');
  assert.equal(status.section, 1);
  assert.equal(status.alertPending, true);
  console.log('PASS refresh targets Replies and exhausted page recovery shows a persistent alert');

  const preview = harness();
  job = await preview.popup('start', { selection: [0, 1, 3], preview: true });
  await preview.tab(job, 'hello');
  assert.equal(await preview.tab(job, 'begin', { item: candidate('delete') }), null);
  for (const found of [12, 5, 22]) {
    await preview.tab(job, 'hello');
    job = await preview.tab(job, 'sectionEnd', { result: 'clear', found });
  }
  assert.equal(job.status, 'previewed');
  assert.equal(job.pass, 1);
  assert.deepEqual(job.results.map(result => result.found), [12, 5, 22]);
  assert.equal(job.totals.deleted, 0);
  job = await preview.popup('start', { selection: [3] });
  await preview.tab(job, 'hello');
  const bulk = { kind: 'bookmark-bulk', url: 'https://x.com/i/bookmarks' };
  assert.ok((await preview.tab(job, 'begin', { item: bulk })).allowed);
  assert.ok((await preview.tab(job, 'check', { url: bulk.url })).allowed);
  const cleared = await preview.tab(job, 'settled', { url: bulk.url, ok: true, sent: true });
  assert.equal(cleared.bookmarksCleared, true);
  assert.equal(cleared.totals.bookmarks, 0);
  preview.tick(15000);
  assert.equal(await preview.tab(job, 'begin', { item: bulk }), null);
  console.log('PASS scan-only route and bookmark bulk action without inventing a count');

  const checkpoint = harness();
  job = await checkpoint.popup('start', { selection: [0, 1, 2] });
  const bad = candidate('delete', 700);
  await checkpoint.tab(job, 'hello');
  assert.ok((await checkpoint.tab(job, 'begin', { item: bad })).allowed);
  await checkpoint.tab(job, 'settled', { url: bad.url, ok: false });
  checkpoint.tick(15000);
  assert.ok((await checkpoint.tab(job, 'begin', { item: bad })).retry);
  checkpoint.tick(15000);
  assert.ok((await checkpoint.tab(job, 'begin', { item: bad })).allowed);
  delete checkpoint.stores.session.job;
  const interrupted = await checkpoint.popup('start', { selection: [0, 1, 2] });
  assert.equal(interrupted.alertPending, true);
  await checkpoint.popup('acknowledge', { id: interrupted.id });
  job = await checkpoint.popup('start', { selection: [0, 1, 2] });
  await checkpoint.tab(job, 'hello');
  checkpoint.tick(15000);
  assert.ok((await checkpoint.tab(job, 'begin', { item: bad })).skipped);
  const good = candidate('delete', 701);
  assert.ok((await checkpoint.tab(job, 'begin', { item: good })).allowed);
  assert.equal((await checkpoint.tab(job, 'settled', { url: good.url, ok: true })).totals.deleted, 1);
  assert.equal((await checkpoint.popup('status')).totals.errors, 2);
  console.log('PASS failure checkpoint across browser restart; an unrelated item still succeeds');
  const counters = harness();
  job = await counters.popup('start', { selection: [0, 1] });
  await counters.tab(job, 'hello');
  const pending = candidate('delete', 501);
  assert.ok((await counters.tab(job, 'begin', { item: pending })).allowed);
  counters.setTab(job, { status: 'loading' });
  assert.ok((await counters.tab(job, 'check', { url: pending.url })).allowed);
  const beforeConfirmation = await counters.tab(job, 'progress', { text: 'Delete sent · Waiting for X to confirm…' });
  assert.equal(beforeConfirmation.totals.deleted, 0);
  const confirmed = await counters.tab(job, 'settled', { url: pending.url, ok: true, sent: true });
  assert.equal(confirmed.totals.deleted, 1);
  assert.ok(confirmed.revision > beforeConfirmation.revision);
  assert.match(confirmed.message, /Delete confirmed/);
  assert.equal(await counters.tab(job, 'settled', { url: pending.url, ok: true, sent: true }), null);
  assert.equal((await counters.popup('status')).totals.deleted, 1);
  console.log('PASS confirmation survives same-route loading and increments the published total exactly once');

  const scheduled = harness();
  job = await scheduled.popup('start', { selection: [0], pace: 15000 });
  await scheduled.tab(job, 'hello');
  const repeated = candidate('delete', 992);
  assert.equal(await scheduled.tab(job, 'refresh', { mode: 'periodic' }), null);
  assert.ok((await scheduled.tab(job, 'begin', { item: repeated })).allowed);
  scheduled.tick(600000);
  assert.equal(await scheduled.tab(job, 'refresh', { mode: 'periodic' }), null);
  assert.equal(scheduled.reloads.length, 0);
  await scheduled.tab(job, 'settled', { url: repeated.url, ok: true, sent: true });
  assert.ok((await scheduled.tab(job, 'refresh', { mode: 'periodic' })).reloading);
  assert.equal(scheduled.reloads.at(-1).options.bypassCache, true);
  const after = await scheduled.tab(job, 'hello');
  assert.equal(after.id, job.id);
  assert.equal(after.section, 0);
  assert.equal(after.totals.deleted, 1);
  assert.equal((await scheduled.tab(job, 'begin', { item: repeated })).wait, 15000);
  scheduled.tick(15000);
  assert.ok((await scheduled.tab(job, 'begin', { item: repeated })).allowed);
  assert.equal((await scheduled.tab(job, 'settled', { url: repeated.url, ok: true, sent: true })).totals.deleted, 1);
  scheduled.tick(15000);
  assert.ok((await scheduled.tab(job, 'begin', { item: repeated })).skipped);
  assert.equal(scheduled.reloads.length, 1);
  console.log('PASS 10-minute refresh waits for settlement, bypasses cache, preserves cooldown and avoids duplicate counts');

  const retry = harness();
  job = await retry.popup('start', { selection: [1], pace: 0 });
  await retry.tab(job, 'hello');
  const deferred = candidate('delete', 888);
  assert.ok((await retry.tab(job, 'begin', { item: deferred })).allowed);
  await retry.tab(job, 'settled', { url: deferred.url, issue: 'Button moved' });
  assert.ok((await retry.tab(job, 'begin', { item: deferred })).retry);
  assert.ok((await retry.tab(job, 'refresh', { mode: 'items' })).reloading);
  await retry.tab(job, 'hello');
  assert.equal((await retry.tab(job, 'begin', { item: deferred })).wait, 30000);
  retry.tick(30000);
  assert.ok((await retry.tab(job, 'begin', { item: deferred })).allowed);
  assert.equal((await retry.tab(job, 'settled', { url: deferred.url, ok: true })).totals.deleted, 1);
  assert.ok((await retry.tab(job, 'refresh', { mode: 'items' })).exhausted);
  console.log('PASS temporary failure is retried after a bounded cooldown');

  const identity = harness();
  assert.equal((await identity.popup('detect')).handle, 'sample_user');
  identity.setAccount(null);
  await assert.rejects(identity.popup('start', { selection: [0, 1] }), /Sign in/);
  identity.setAccount('Second_User', 'https://x.com/some_other_profile');
  assert.equal((await identity.popup('detect')).handle, 'second_user');
  await assert.rejects(identity.popup('start', { selection: [0, 1] }), /active account changed/i);
  job = await identity.popup('start', { selection: [0, 1], expectedHandle: 'second_user' });
  assert.equal(job.handle, 'second_user');
  assert.equal(identity.navigations.at(-1), 'https://x.com/second_user/with_replies');
  await identity.tab(job, 'hello');
  assert.equal(await identity.tab(job, 'begin', { item: candidate('delete') }), null);
  assert.ok((await identity.tab(job, 'begin', { item: candidate('delete', 5, 'second_user') })).allowed);
  await identity.popup('stop');
  await identity.tab(job, 'settled', { url: 'https://x.com/second_user/status/5', ok: true });
  identity.setAccount('sample_user');
  job = await identity.popup('start', { selection: [0, 1] });
  assert.equal(job.handle, 'sample_user');
  assert.equal(job.totals.deleted, 0);
  console.log('PASS detection from another profile, account-switch rejection, account-bound deletion and separate totals');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
