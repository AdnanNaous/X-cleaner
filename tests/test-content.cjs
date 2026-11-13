const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ARTICLE = 'article[data-testid="tweet"]';
const PROFILE = [
  'a[data-testid="AppTabBar_Profile_Link"]',
  'header nav a[aria-label="Profile"]',
  'header nav a[aria-label="الملف الشخصي"]'
].join(', ');
const DROPDOWN = '[data-testid="Dropdown"], [role="menu"]';
const DIALOG = '[role="dialog"], [aria-modal="true"]';
const SHEET = '[data-testid="confirmationSheetDialog"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
const CONFIRM = '[data-testid="confirmationSheetConfirm"]';
const CANCEL = '[data-testid="confirmationSheetCancel"]';
const RESULT_NOTICES = '[data-testid="toast"], [role="status"], [role="alert"]';
const EMPTY = '[data-testid="emptyState"], [data-testid="empty_state_header_text"]';
const NOTICES = '[data-testid="toast"], [data-testid="emptyState"], [role="alert"], [role="alertdialog"]';

class Element {
  constructor(innerText = '', href = '') {
    this.innerText = innerText;
    this.href = href;
    this.isConnected = true;
    this.attributes = new Map();
    this.find = new Map();
    this.ancestors = new Map();
  }
  querySelectorAll(selector) { return this.find.get(selector) || []; }
  closest(selector) { return this.ancestors.get(selector) || null; }
  getAttribute(key) { return this.attributes.get(key) || null; }
  getClientRects() { return [{}]; }
  contains(node) { return [...node.ancestors.values()].includes(this); }
  scrollIntoView() {}
  click() { this.onclick?.(); }
}

function harness() {
  const document = new Element();
  const location = { href: 'https://x.com/sample_user' };
  const primary = new Element();
  const profile = new Element('Profile', location.href);
  document.find.set(PROFILE, [profile]);
  document.find.set('[data-testid="primaryColumn"]', [primary]);
  const calls = [];
  let now = 0;
  const chrome = { runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
    calls.push(message);
    return { result: ['begin', 'check'].includes(message.type) ? { allowed: true } : null };
  } } };
  const sandbox = { URL, chrome, document, location, Date: { now: () => now },
    setTimeout: (resolve, ms) => { now += ms; resolve(); } };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('extension/shared.js', 'utf8'), context);
  const source = fs.readFileSync('extension/cleaner.js', 'utf8').split('  run().catch')[0];
  vm.runInContext(source + 'globalThis.fixture = { account, signedInHandle, apply, clearBookmarks, identify, parseCard, rateLimited, setJob(value) {job = value;} }; })();', context);
  const api = context.fixture;
  const job = (section, selected = [0, 1, 2, 3, 4], preview = false) => {
    location.href = context.Cleaner.sectionUrl(section, 'sample_user');
    api.setJob({ section, handle: 'sample_user', selected, preview, id: 'run', pass: 1 });
  };
  function card(author, id, control, contextLabel = '') {
    const article = new Element();
    const time = new Element('Today');
    const anchor = new Element('', `https://x.com/${author}/status/${id}`);
    const button = new Element('Control');
    time.ancestors.set(ARTICLE, article);
    time.ancestors.set('a[href]', anchor);
    article.find.set('time', [time]);
    button.ancestors.set(ARTICLE, article);
    article.find.set(`[data-testid="${control}"]`, [button]);
    if (contextLabel) {
      const context = new Element(contextLabel);
      context.ancestors.set(ARTICLE, article);
      article.find.set('[data-testid="socialContext"]', [context]);
    }
    primary.find.set(ARTICLE, [article]);
    return { article, button };
  }
  return { api, document, primary, profile, calls, job, card };
}

(async () => {
  const h = harness();
  h.job(1);
  assert.equal(h.api.account(), 'verified');
  assert.equal(h.api.signedInHandle(), 'sample_user');
  const foreign = h.card('Other', 1, 'caret');
  assert.equal(h.api.identify(foreign.article), null);
  const owned = h.card('sample_user', 2, 'caret');
  assert.equal(h.api.identify(owned.article), 'delete');
  h.profile.href = 'https://x.com/Other';
  assert.equal(h.api.account(), 'mismatch');
  assert.equal(await h.api.apply({ ...h.api.parseCard(owned.article), kind: 'delete' }), 'deferred');
  assert.equal(h.calls.length, 0);
  h.profile.href = 'https://x.com/sample_user';

  owned.button.onclick = () => {
    const menu = new Element();
    const action = new Element('Delete');
    menu.find.set('[role="menuitem"], [data-testid="delete"]', [action]);
    h.document.find.set(DROPDOWN, [menu]);
    action.onclick = () => {
      const dialog = new Element();
      const confirm = new Element('Delete');
      confirm.ancestors.set(SHEET, dialog);
      h.document.find.set(DROPDOWN, []);
      h.document.find.set(CONFIRM, [confirm]);
      confirm.onclick = () => {
        owned.article.isConnected = false;
        h.document.find.set(CONFIRM, []);
        h.primary.find.set(EMPTY, [new Element('No replies yet')]);
      };
    };
  };
  assert.equal(await h.api.apply({ ...h.api.parseCard(owned.article), kind: 'delete' }), 'changed');
  assert.equal(h.calls.at(-1).ok, true);

  h.job(2);
  const repost = h.card('Other', 3, 'unretweet', 'You reposted');
  assert.equal(h.api.identify(repost.article), 'repost');
  repost.button.onclick = () => {
    const confirm = new Element('Undo repost');
    h.document.find.set('[data-testid="unretweetConfirm"]', [confirm]);
    confirm.onclick = () => {
      repost.article.isConnected = false;
      h.primary.find.set(EMPTY, [new Element('No reposts yet')]);
    };
  };
  assert.equal(await h.api.apply({ ...h.api.parseCard(repost.article), kind: 'repost' }), 'changed');
  for (const [section, kind, selector] of [[3, 'bookmark', 'removeBookmark'], [4, 'like', 'unlike']]) {
    h.job(section);
    const target = h.card('Other', section, selector);
    assert.equal(h.api.identify(target.article), kind);
    target.button.onclick = () => {
      target.article.isConnected = false;
      h.primary.find.set(EMPTY, [new Element(section === 3 ? 'No bookmarks yet' : 'No likes yet')]);
    };
    assert.equal(await h.api.apply({ ...h.api.parseCard(target.article), kind }), 'changed');
  }
  const alternate = h.card('sample_user', 42, 'caret');
  const header = new Element();
  header.ancestors.set(ARTICLE, alternate.article);
  alternate.article.find.delete('time');
  alternate.article.find.set('[data-testid="User-Name"], [data-testid="UserName"]', [header]);
  const headerLinks = 'a[href*="/status/"]';
  header.find.set(headerLinks, [new Element('', 'https://x.com/sample_user/status/42')]);
  assert.equal(h.api.parseCard(alternate.article).url, 'https://x.com/sample_user/status/42');
  header.find.get(headerLinks).push(new Element('', 'https://x.com/other/status/43'));
  assert.equal(h.api.parseCard(alternate.article), null);

  const b = harness();
  b.job(3, [3], true);
  b.card('Other', 55, 'removeBookmark');
  const overflow = new Element('More');
  b.primary.find.set('[data-testid="bookmarkOverflowButton"]', [overflow]);
  let opened = 0;
  let cleared = 0;
  overflow.onclick = () => {
    opened++;
    const menu = new Element();
    const command = new Element('Clear all Bookmarks');
    menu.find.set('[role="menuitem"], [data-testid="clearAllBookmarks"], [data-testid="clearBookmarks"]', [command]);
    b.document.find.set(DROPDOWN, [menu]);
    command.onclick = () => {
      const dialog = new Element('Clear all Bookmarks?');
      const confirm = new Element('Clear');
      confirm.ancestors.set(DIALOG, dialog);
      b.document.find.set(DROPDOWN, []);
      b.document.find.set('[data-testid="confirmationSheetConfirm"]', [confirm]);
      confirm.onclick = () => {
        cleared++;
        b.primary.find.set(ARTICLE, []);
        b.primary.find.set('[data-testid="emptyState"], [data-testid="empty_state_header_text"]', [new Element('Save posts for later')]);
        b.document.find.set('[data-testid="confirmationSheetConfirm"]', []);
      };
    };
  };
  await b.api.clearBookmarks();
  assert.equal(opened, 0);
  b.job(3, [3]);
  await b.api.clearBookmarks();
  assert.equal(opened, 1);
  assert.equal(cleared, 1);
  assert.equal(b.calls.at(-1).ok, true);
  console.log('PASS optional permalink fallback rejects ambiguous links, and bulk bookmark DOM flow verifies an empty list');
  for (const scenario of ['remount', 'unknown-label', 'stale-notice', 'no-response']) {
    const regression = harness();
    regression.job(0);
    const target = regression.card('sample_user', 55, 'caret');
    let confirms = 0;
    let cancels = 0;
    const toast = new Element('Your post was deleted.');
    if (scenario === 'stale-notice') regression.document.find.set(RESULT_NOTICES, [toast]);
    target.button.onclick = () => {
      const menu = new Element();
      const action = new Element('Delete');
      menu.find.set('[role="menuitem"], [data-testid="delete"]', [action]);
      regression.document.find.set(DROPDOWN, [menu]);
      action.onclick = () => {
        const dialog = new Element();
        const confirm = new Element(scenario === 'unknown-label' ? 'Confirm unrelated action' : '');
        if (scenario !== 'unknown-label') confirm.attributes.set('aria-label', 'Delete');
        const cancel = new Element('Cancel');
        dialog.find.set(CANCEL, [cancel]);
        confirm.ancestors.set(SHEET, dialog);
        regression.document.find.set(DROPDOWN, []);
        regression.document.find.set(CONFIRM, [confirm]);
        if (scenario === 'remount' || scenario === 'stale-notice') target.article.isConnected = false;
        cancel.onclick = () => {
          cancels++;
          regression.document.find.set(CONFIRM, []);
        };
        confirm.onclick = () => {
          confirms++;
          if (scenario === 'remount') regression.document.find.set(RESULT_NOTICES, [toast]);
          if (scenario === 'stale-notice') regression.document.find.set(CONFIRM, []);
        };
      };
    };
    const result = await regression.api.apply({ ...regression.api.parseCard(target.article), kind: 'delete' });
    const settlement = regression.calls.find(call => call.type === 'settled');
    assert.equal(confirms, scenario === 'unknown-label' ? 0 : 1);
    assert.equal(cancels, scenario === 'stale-notice' ? 0 : 1);
    assert.equal(settlement.ok, scenario === 'remount');
    assert.equal(result, scenario === 'remount' ? 'changed' : 'failed');
  }
  console.log('PASS remounted card, ARIA-labelled Delete, fresh versus stale X confirmation, and stuck-sheet dismissal');
  h.document.find.set(NOTICES, [new Element('Rate limit exceeded')]);
  assert.equal(h.api.rateLimited(), true);
  console.log('PASS live-control selection on simulated DOM: own deletion, foreign-thread exclusion, repost, bookmark, like, account mismatch, and rate-limit detection');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
