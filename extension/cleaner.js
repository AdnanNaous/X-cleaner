'use strict';

(() => {
  const ARTICLE = 'article[data-testid="tweet"]';
  const PROFILE_LINK = [
    'a[data-testid="AppTabBar_Profile_Link"]',
    'header nav a[aria-label="Profile"]',
    'header nav a[aria-label="الملف الشخصي"]'
  ].join(', ');
  const ACCOUNT_BUTTON = '[data-testid="SideNav_AccountSwitcher_Button"]';
  const DROPDOWN = '[data-testid="Dropdown"], [role="menu"]';
  const CONFIRM = '[data-testid="confirmationSheetConfirm"]';
  const CANCEL = '[data-testid="confirmationSheetCancel"]';
  const SHEET = '[data-testid="confirmationSheetDialog"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
  const NOTICES = '[data-testid="toast"], [role="status"], [role="alert"]';
  const sections = Cleaner.sections;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const emptyLabels = [
    'no posts yet', 'hasn’t posted', "hasn't posted", 'when you post', 'no replies yet',
    'no reposts yet', 'hasn’t reposted', "hasn't reposted", 'when you repost',
    'save posts for later', 'no bookmarks yet', 'haven’t added any posts to your bookmarks',
    "haven't added any posts to your bookmarks", 'no likes yet', 'you haven’t liked',
    "you haven't liked", 'when you like a post', 'ليس هناك منشورات', 'لا توجد منشورات',
    'لم ينشر', 'لا توجد ردود', 'لا توجد إعادات نشر', 'احفظ المنشورات لوقت لاحق',
    'لا توجد علامات مرجعية', 'لا توجد إعجابات'
  ];
  const deleteLabels = new Set(['delete', 'delete post', 'حذف', 'حذف المنشور']);
  const deletedNotices = new Set([
    'post deleted', 'your post was deleted', 'your post has been deleted',
    'tweet deleted', 'your tweet was deleted', 'your tweet has been deleted',
    'تم حذف المنشور', 'تم حذف منشورك'
  ]);
  const undoLabels = new Set(['undo repost', 'undo retweet', 'التراجع عن إعادة النشر', 'إلغاء إعادة النشر']);
  const repostLabels = new Set(['you reposted', 'you retweeted', 'لقد أعدت النشر', 'أعدت النشر', 'قمت بإعادة النشر']);
  const historyLabels = {
    3: new Set(['bookmarks', 'العلامات المرجعية']),
    4: new Set(['likes', 'الإعجابات', 'تسجيلات الإعجاب'])
  };
  let job;
  let cancelled = false;
  let panel;
  let paint;
  let panelHost;
  let observer;
  let batchDue = false;
  let nextActionAt = 0;
  let lastIssue = '';
  let blockedByX;

  const normalize = value => String(value || '').replace(/[\u200e\u200f\u061c]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  const visible = node => node?.isConnected && node.getClientRects().length > 0 &&
    !node.closest('[hidden]');
  const all = (root, selector) => [...(root?.querySelectorAll(selector) || [])].filter(visible);
  const unique = (root, selector) => {
    const matches = all(root, selector);
    return matches.length === 1 ? matches[0] : null;
  };
  const primary = () => unique(document, '[data-testid="primaryColumn"]') || unique(document, 'main');
  const owned = (card, selector) => {
    const matches = all(card, selector).filter(node => node.closest(ARTICLE) === card &&
      !node.closest('[data-testid="quoteTweet"], [data-testid="card.wrapper"]'));
    return matches.length === 1 ? matches[0] : null;
  };

  async function ask(type, fields = {}) {
    const response = await chrome.runtime.sendMessage({
      type, id: job?.id, section: job?.section, pass: job?.pass, ...fields
    });
    if (response?.error) throw new Error(response.error);
    return response?.result;
  }

  async function waitFor(read, timeout = 9000, allowStopping = false) {
    const end = Date.now() + timeout;
    while ((allowStopping || !cancelled) && Date.now() < end) {
      const result = read();
      if (result) return result;
      await sleep(180);
    }
    return null;
  }

  function profileHandle(url) {
    return Cleaner.route(url)?.match(/^\/([a-z0-9_]{1,15})$/)?.[1];
  }

  function signedInHandle() {
    const visibleLinks = all(document, PROFILE_LINK);
    const links = visibleLinks.length ? visibleLinks : [...document.querySelectorAll(PROFILE_LINK)];
    const nav = [...new Set(links.map(link => profileHandle(link.href)).filter(Boolean))];
    const accountButton = unique(document, ACCOUNT_BUTTON);
    const handles = (accountButton?.innerText || '').split('\n')
      .map(line => line.trim().match(/^@([a-z0-9_]{1,15})$/i)?.[1])
      .filter(Boolean).map(handle => handle.toLowerCase());
    const detected = [...new Set([...nav, ...handles])];
    return detected.length === 1 ? detected[0] : null;
  }

  function account() {
    const detected = signedInHandle();
    if (detected) return detected === job?.handle ? 'verified' : 'mismatch';
    return null;
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id === chrome.runtime.id && message.type === 'detectAccount') {
      respond({ handle: signedInHandle() });
    }
  });

  function currentHistory() {
    return Cleaner.route(location.href)?.startsWith('/i/history');
  }

  function selectedTab(tab) {
    return tab?.getAttribute('aria-selected') === 'true' ||
      ['page', 'true'].includes(tab?.getAttribute('aria-current'));
  }

  function getHistoryTab() {
    const matches = all(primary(), '[role="tab"], [role="tablist"] a').filter(tab =>
      labelled(tab, historyLabels[job.section]));
    return matches.length === 1 ? matches[0] : null;
  }

  function correctView() {
    if (!Cleaner.atSection(job.section, location.href, job.handle, job.history)) return false;
    if (!currentHistory()) return true;
    const tab = getHistoryTab();
    if (tab) return selectedTab(tab);
    const route = Cleaner.route(location.href);
    if (job.section === 4) return route === '/i/history/likes';
    return job.section === 3 && route === '/i/history/bookmarks';
  }

  async function prepareView() {
    if (!currentHistory()) return correctView();
    if (correctView()) return true;
    const knownHistoryTab = await waitFor(getHistoryTab, 5000);
    if (knownHistoryTab && account() === 'verified' && !cancelled) {
      knownHistoryTab.click();
      return Boolean(await waitFor(correctView, 8000));
    }
    return false;
  }

  function parseCard(card) {
    const time = owned(card, 'time');
    const timestampRoute = Cleaner.route(time?.closest('a[href]')?.href);
    const header = owned(card, '[data-testid="User-Name"], [data-testid="UserName"]');
    const fallbackRoutes = () => [...new Set(all(header, 'a[href*="/status/"]')
      .map(link => Cleaner.route(link.href)).filter(Boolean))];
    const permalink = /^\/([a-z0-9_]{1,15})\/status\/(\d{1,22})$/;
    let match = timestampRoute?.match(permalink);
    if (!match) {
      const routes = fallbackRoutes();
      if (routes.length === 1) match = routes[0].match(permalink);
    }
    if (!match) return null;
    const [, author, id] = match;
    return { card, author, id, url: Cleaner.origin + match[0] };
  }

  function socialContext(card) {
    return normalize(owned(card, '[data-testid="socialContext"]')?.innerText);
  }

  function repostedHere(card) {
    if (repostLabels.has(socialContext(card))) return true;
    if (job.section !== 2) return false;
    const expected = Cleaner.route(Cleaner.sectionUrl(2, job.handle));
    return all(primary(), '[role="tab"][href], [role="tablist"] a[href]').some(tab =>
      selectedTab(tab) && Cleaner.route(tab.href) === expected);
  }

  function markedReply(card) {
    return all(card, '[data-testid="replyingTo"], [data-testid="replyingToContext"], [dir="auto"]')
      .some(node => node.closest(ARTICLE) === card &&
        !node.closest('[data-testid="tweetText"], [data-testid="User-Name"], [data-testid="UserName"], [data-testid="quoteTweet"], [data-testid="card.wrapper"]') &&
        (['replyingTo', 'replyingToContext'].includes(node.getAttribute('data-testid')) ||
          (/^(?:replying to|رد(?:ً?ا|ّ)? على)(?:\s|$)/.test(normalize(node.innerText)) &&
            all(node, 'a[href]').some(link => profileHandle(link.href)))));
  }

  function identify(card, data = parseCard(card)) {
    if (!data) return null;
    if (job.section === 3) return owned(card, '[data-testid="removeBookmark"]') ? 'bookmark' : null;
    if (job.section === 4) return owned(card, '[data-testid="unlike"]') ? 'like' : null;
    if (job.section === 2) {
      return repostedHere(card) && owned(card, '[data-testid="unretweet"]') ? 'repost' : null;
    }
    if (data.author === job.handle && job.section <= 1 &&
        !repostLabels.has(socialContext(card)) && markedReply(card) === (job.section === 1)) return 'delete';
    return null;
  }

  function enabled(node) {
    return visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
  }

  function menuItem(selector, names) {
    const roots = all(document, DROPDOWN);
    const matches = new Set(roots.flatMap(root => all(root, selector)).filter(enabled));
    if (names) {
      for (const item of matches) {
        if (!names.has(normalize(item.innerText))) matches.delete(item);
      }
    }
    return matches.size === 1 ? [...matches][0] : null;
  }

  function labelled(node, labels) {
    return [node?.innerText, node?.textContent, node?.getAttribute('aria-label')]
      .some(value => labels.has(normalize(value)));
  }

  function confirmationSheet(previous) {
    const candidates = all(document, CONFIRM).filter(button =>
      !previous.has(button) && !button.closest('[aria-hidden="true"], [inert]'));
    if (candidates.length !== 1) return null;
    const button = candidates[0];
    const sheet = button.closest(SHEET);
    return sheet ? { button, sheet } : null;
  }

  function closeConfirmation(confirmation) {
    const cancel = unique(confirmation?.sheet, CANCEL);
    if (enabled(cancel)) cancel.click();
  }

  function newDeletionNotice(previous) {
    return all(document, NOTICES).some(node => {
      const message = normalize(node.innerText || node.textContent);
      return previous.get(node) !== message && deletedNotices.has(message.replace(/[.!。]$/, ''));
    });
  }

  function pageNotice() {
    return all(document, '[data-testid="toast"], [data-testid="emptyState"], [role="alert"], [role="alertdialog"]')
      .filter(node => !node.closest(ARTICLE)).map(node => normalize(node.innerText)).join(' ');
  }

  function restriction() {
    if (blockedByX) return blockedByX;
    const notice = pageNotice();
    if (/verify (you are|your identity)|automated request|account (is |has been )?(locked|suspended|restricted)|تم (قفل|تعليق|تقييد) حسابك/.test(notice)) {
      blockedByX = { reason: 'X displayed an account check or restriction. Resolve the prompt on X before continuing.', x: true };
    } else if (/rate limit|too many requests|try again later|temporarily limited|معدل الطلبات|طلبات كثيرة|حاول مرة أخرى لاحقًا/.test(notice)) {
      blockedByX = { reason: 'X displayed a rate limit. Cleanup paused. Continue once the wait ends and X works normally.', rateLimited: true };
    }
    return blockedByX;
  }

  function rateLimited() {
    return Boolean(restriction());
  }

  function refreshDue() {
    return Boolean(job.refreshAt && Date.now() >= job.refreshAt);
  }

  async function waitUntil(time) {
    while (!cancelled && Date.now() < time) {
      if (!routeAndAccount() || refreshDue()) return false;
      await sleep(Math.min(700, time - Date.now(), job.refreshAt ? job.refreshAt - Date.now() : 700));
    }
    return !cancelled && routeAndAccount() && !refreshDue();
  }

  async function refreshTimeline() {
    const result = await ask('refresh', { mode: 'periodic' });
    return Boolean(result?.reloading || cancelled);
  }

  function timelineError() {
    const notice = pageNotice();
    return /something went wrong|failed to load|please retry|حدث خطأ ما|تعذر التحميل/.test(notice) ||
      all(primary(), '[data-testid="retry"]').length > 0;
  }

  function emptyTimeline() {
    return all(primary(), '[data-testid="emptyState"], [data-testid="empty_state_header_text"]')
      .some(node => emptyLabels.some(label => normalize(node.innerText).includes(label)));
  }

  function remainingPostCount() {
    const column = primary();
    const back = unique(column, '[data-testid="app-bar-back"]');
    let header = back?.parentElement;
    for (let depth = 0; header && header !== column && depth < 5; depth++, header = header.parentElement) {
      const text = header.innerText || '';
      if (text.length > 180 || header.querySelector(ARTICLE)) break;
      const count = text.split('\n').map(normalize)
        .find(line => /^\d[\d.,]*[kmb]? posts?$/.test(line));
      if (count) return /^0 posts?$/.test(count) ? null : count;
    }
    return null;
  }

  function showPanel() {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host {position:fixed; inset:auto auto 22px 22px; z-index:2147483647; color-scheme:dark}
      aside {box-sizing:border-box; width:min(335px,calc(100vw - 44px)); background:#000; color:#fff; border:1px solid #777; border-radius:12px; padding:15px 16px; box-shadow:0 10px 30px #0008; font:13px/1.4 system-ui,sans-serif}
      header {display:flex; justify-content:space-between; align-items:center; gap:10px}
      strong {font-size:16px} p {margin:8px 0; overflow-wrap:anywhere} small {color:#c1c1c1}
      button {font:600 12px system-ui,sans-serif; background:#fff; color:#000; padding:7px 12px; border:0; border-radius:5px; cursor:pointer}
      button:disabled {opacity:.55; cursor:default}
      button:focus-visible {outline:2px solid #fff; outline-offset:3px}
      aside[data-done] {border-color:#fff}
      aside[data-alert] {border:2px solid #fff}
      small[hidden] {display:none}
      #elapsed {display:block; margin:0 0 7px; font-variant-numeric:tabular-nums}
      #elapsed[hidden] {display:none}
    `;
    const box = document.createElement('aside');
    box.setAttribute('aria-label', 'X Cleaner');
    const header = document.createElement('header');
    const title = document.createElement('strong');
    const control = document.createElement('button');
    control.type = 'button';
    const description = document.createElement('p');
    description.setAttribute('role', 'status');
    const route = document.createElement('small');
    const counts = document.createElement('small');
    const elapsed = document.createElement('small');
    elapsed.id = 'elapsed';
    const updateElapsed = () => {
      elapsed.hidden = !(panel?.status === 'paused' && panel.pausedAt && ['x', 'rate-limit'].includes(panel.pauseKind));
      if (!elapsed.hidden) elapsed.textContent = 'Paused for ' + Cleaner.elapsedSince(panel.pausedAt);
    };
    let timer;
    header.append(title, control);
    box.append(header, route, description, elapsed, counts);
    root.append(style, box);
    document.body.append(host);
    panelHost = host;
    control.addEventListener('click', () => {
      if (panel?.alertPending) {
        control.disabled = true;
        ask('acknowledge').then(state => { if (!state) control.disabled = false; }).catch(() => { control.disabled = false; });
      } else if (panel?.status === 'running') {
        control.disabled = true;
        ask('stop').catch(() => { control.disabled = false; });
      } else {
        clearInterval(timer);
        host.remove();
      }
    });
    return state => {
      panel = state;
      title.textContent = state.status === 'finished' ? '✓ Cleanup complete'
        : state.alertPending ? (state.preview ? 'Preview stopped' : 'Cleanup stopped')
          : state.status === 'previewed' ? 'Preview complete' : state.preview ? 'X Cleaner · Preview' : 'X Cleaner';
      box.toggleAttribute('data-done', state.status === 'finished');
      box.toggleAttribute('data-alert', Boolean(state.alertPending));
      control.textContent = state.alertPending ? 'OK' : state.status === 'running' ? 'Stop' : 'Dismiss';
      control.disabled = state.status === 'stopping';
      route.textContent = ['running', 'stopping', 'paused'].includes(state.status)
        ? `${Cleaner.sections[state.section].name} · ${Cleaner.routeStatus(state)}` : '';
      route.hidden = !route.textContent;
      description.textContent = state.alertPending
        ? state.message.split(' Check the last attempted item: ')[0] + ' Select OK to acknowledge. The run stays stopped.'
        : state.message;
      updateElapsed();
      if (!elapsed.hidden && !timer) timer = setInterval(updateElapsed, 1000);
      if (elapsed.hidden && timer) {
        clearInterval(timer);
        timer = undefined;
      }
      const { deleted, reposts, bookmarks, likes, skipped, errors } = state.totals;
      const bookmarkCount = state.bookmarksCleared ? 'All' : bookmarks;
      counts.textContent = state.preview ? 'Scan only' : `${deleted} deleted · ${reposts} reposts · ${bookmarkCount} bookmarks · ${likes} likes · ${skipped} cards ignored · ${errors} action errors`;
    };
  }

  function routeAndAccount() {
    return correctView() && account() === 'verified' && !rateLimited();
  }

  function validCard(item) {
    const latest = parseCard(item.card);
    return latest?.id === item.id && latest.author === item.author &&
      identify(item.card, latest) === item.kind;
  }

  async function apply(item) {
    lastIssue = '';
    item.card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(650);
    if (cancelled || !routeAndAccount() || !validCard(item)) return 'deferred';

    let permission = await ask('begin', { item: { kind: item.kind, url: item.url } });
    while (permission?.wait) {
      if (!await waitUntil(Date.now() + permission.wait) || !validCard(item)) return 'deferred';
      permission = await ask('begin', { item: { kind: item.kind, url: item.url } });
    }
    if (permission?.retry) return 'retry';
    if (permission?.skipped) {
      lastIssue = permission.issue || 'Retry limit reached for this item.';
      return 'skipped';
    }
    if (!permission?.allowed) return 'deferred';
    let clicked = false;
    let deleteBaseline;
    let confirmation;
    let openedMenu = false;
    let ok = false;
    const fail = issue => {
      lastIssue = issue;
      return 'failed';
    };
    try {
      let button;
      if (item.kind === 'delete') {
        if (all(document, DROPDOWN).length || all(document, SHEET).length || all(document, CONFIRM).length) {
          return fail('An X menu or dialog was already open.');
        }
        const menu = owned(item.card, '[data-testid="caret"]') ||
          owned(item.card, 'button[aria-label="More"], [role="button"][aria-label="More"], button[aria-label="المزيد"]');
        if (!enabled(menu)) return fail('The post menu was missing or disabled.');
        menu.click();
        openedMenu = true;
        const remove = await waitFor(() => menuItem('[role="menuitem"], [data-testid="delete"]', deleteLabels), 7500);
        if (!enabled(remove)) return fail('The post menu did not offer a recognizable Delete command.');
        await sleep(750);
        if (cancelled || !enabled(remove) || !routeAndAccount() || !validCard(item)) {
          return fail('The post changed while its menu was open.');
        }
        deleteBaseline = new Set(all(document, CONFIRM));
        if (panelHost) panelHost.style.visibility = 'hidden';
        remove.click();
        confirmation = await waitFor(() => confirmationSheet(deleteBaseline), 7500);
        if (!confirmation) return fail('X did not open a recognizable Delete confirmation.');
      } else if (item.kind === 'repost') {
        if (all(document, DROPDOWN).length || all(document, '[role="dialog"], [aria-modal="true"]').length) {
          return fail('An X menu or dialog was already open.');
        }
        const toggle = owned(item.card, '[data-testid="unretweet"]');
        if (!enabled(toggle)) return fail('The repost control was missing or disabled.');
        toggle.click();
        openedMenu = true;
        button = await waitFor(() => {
          const choice = unique(document, '[data-testid="unretweetConfirm"]');
          return enabled(choice) && undoLabels.has(normalize(choice.innerText)) ? choice :
            menuItem('[role="menuitem"]', undoLabels);
        }, 7500);
        if (!button) return fail('The Undo repost confirmation did not appear.');
      } else {
        button = owned(item.card, item.kind === 'like' ? '[data-testid="unlike"]' : '[data-testid="removeBookmark"]');
      }
      await sleep(850);
      const approval = await ask('check', { url: item.url });
      if (cancelled || !approval?.allowed) return fail('The cleanup tab changed or stopped before confirmation.');
      if (!routeAndAccount()) return fail('X changed the active section or account before confirmation.');
      if (item.kind === 'delete') {
        // X can remount the timeline while its dialog is open. The validated menu action owns this dialog.
        confirmation = confirmationSheet(deleteBaseline);
        if (!confirmation || !enabled(confirmation.button) || !labelled(confirmation.button, deleteLabels)) {
          return fail('The Delete confirmation was missing, disabled or unrecognized.');
        }
        button = confirmation.button;
      } else if (!enabled(button) || !validCard(item)) {
        return fail('The item or its control changed before confirmation.');
      }
      const oldNotices = new Map(all(document, NOTICES).map(node =>
        [node, normalize(node.innerText || node.textContent)]));
      const renderedCards = () => all(primary(), ARTICLE);
      const targetStillRendered = () => renderedCards().some(card => parseCard(card)?.id === item.id);
      const presentBeforeClick = item.kind !== 'delete' || targetStillRendered();
      button.click();
      clicked = true;
      if (item.kind === 'delete') {
        ask('progress', { text: 'Delete sent · Waiting for X to confirm…' }).catch(console.warn);
      }

      const expected = { repost: 'retweet', bookmark: 'bookmark', like: 'like' }[item.kind];
      const changed = () => {
        if (expected && owned(item.card, `[data-testid="${expected}"]`) && parseCard(item.card)?.id === item.id) return true;
        if (item.card.isConnected && parseCard(item.card)?.id === item.id) return false;
        const timeline = primary();
        if (!timeline) return false;
        const cards = all(timeline, ARTICLE);
        if (!cards.length && !emptyTimeline()) return false;
        if (item.kind === 'delete') return presentBeforeClick && !targetStillRendered();
        return !cards.some(card => parseCard(card)?.id === item.id && identify(card) === item.kind);
      };
      let changedAt = null;
      const verified = await waitFor(() => {
        if (restriction() || timelineError()) return 'issue';
        if (deleteBaseline) {
          const open = confirmationSheet(deleteBaseline);
          if (newDeletionNotice(oldNotices)) {
            closeConfirmation(open);
            return 'verified';
          }
          if (open) {
            changedAt = null;
            return null;
          }
          if (panelHost) panelHost.style.visibility = '';
        }
        if (!changed()) {
          changedAt = null;
          return null;
        }
        changedAt ??= Date.now();
        return Date.now() - changedAt >= 1250 ? 'verified' : null;
      }, 22000, true);
      ok = verified === 'verified' && routeAndAccount();
      return ok ? 'changed' : fail(verified === 'issue'
        ? 'X showed an error after the action was sent.'
        : 'X did not confirm the change within 22 seconds.');
    } finally {
      if (deleteBaseline) {
        if (!ok) closeConfirmation(confirmationSheet(deleteBaseline));
        if (panelHost) panelHost.style.visibility = '';
      }
      if (!ok && !cancelled && openedMenu && all(document, DROPDOWN).length) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      const state = await ask('settled', {
        url: item.url, ok, sent: clicked, issue: lastIssue, cancelled: cancelled && !clicked,
        restriction: restriction()
      });
      batchDue = Boolean(state?.refreshPending);
      nextActionAt = state?.nextActionAt || 0;
    }
  }

  async function clearBookmarks() {
    if (job.preview || job.section !== 3 || job.bookmarkBulkTried ||
        Cleaner.route(location.href) !== '/i/bookmarks' || !all(primary(), ARTICLE).length) return;
    if (!await waitUntil(nextActionAt) || all(document, DROPDOWN).length ||
        all(document, '[role="dialog"], [aria-modal="true"]').length) return;
    const main = primary();
    const headerMenus = all(main, 'button[aria-label="More"], button[aria-label="المزيد"]')
      .filter(node => !node.closest(ARTICLE) && !node.closest('[data-testid="cellInnerDiv"]'));
    const button = unique(main, '[data-testid="bookmarkOverflowButton"]') ||
      (headerMenus.length === 1 ? headerMenus[0] : null);
    if (!enabled(button)) return;
    const bulk = { kind: 'bookmark-bulk', url: Cleaner.sectionUrl(3) };
    const clearLabels = new Set(['clear all bookmarks', 'مسح جميع العلامات المرجعية']);
    const confirmLabels = new Set(['clear', 'clear all', ...clearLabels, 'مسح']);
    let allowed = false;
    let sent = false;
    let ok = false;
    let dialog;
    try {
      if (!routeAndAccount()) return;
      button.click();
      const clear = await waitFor(() =>
        menuItem('[role="menuitem"], [data-testid="clearAllBookmarks"], [data-testid="clearBookmarks"]', clearLabels), 2500);
      if (cancelled || !enabled(clear) || !routeAndAccount()) return;
      const permission = await ask('begin', { item: bulk });
      if (!permission?.allowed) return;
      allowed = true;
      await ask('progress', { text: 'Bookmarks · Clearing all with X’s built-in command' });
      if (cancelled || !routeAndAccount() || !enabled(clear)) return;
      clear.click();
      const confirm = await waitFor(() => {
        const candidate = unique(document, '[data-testid="confirmationSheetConfirm"]');
        const sheet = candidate?.closest('[role="dialog"], [aria-modal="true"]');
        if (!enabled(candidate) || !sheet || !confirmLabels.has(normalize(candidate.innerText)) ||
            ![...clearLabels].some(label => normalize(sheet.innerText).includes(label))) return null;
        dialog = sheet;
        return candidate;
      }, 7500);
      if (!confirm) return;
      const approval = await ask('check', { url: bulk.url });
      if (cancelled || !approval?.allowed || !routeAndAccount() || !enabled(confirm) || !dialog?.contains(confirm)) return;
      confirm.click();
      sent = true;
      const bookmarksEmpty = () => emptyTimeline() && !all(primary(), ARTICLE).length;
      await waitFor(() => bookmarksEmpty() || restriction() || timelineError(), 22000, true);
      ok = Boolean(bookmarksEmpty() && routeAndAccount() && !timelineError());
    } finally {
      if (!sent && dialog?.isConnected) {
        const cancel = unique(dialog, '[data-testid="confirmationSheetCancel"]');
        if (enabled(cancel)) cancel.click();
      } else if (!sent && all(document, DROPDOWN).length) {
        button.click();
      }
      if (allowed) {
        const state = await ask('settled', {
          url: bulk.url, ok, sent, cancelled: cancelled && !sent,
          issue: 'The bulk bookmark clear could not be verified. Checking bookmarks individually.',
          restriction: restriction()
        });
        batchDue = Boolean(state?.refreshPending);
        nextActionAt = state?.nextActionAt || 0;
      }
    }
  }

  async function reportLostView() {
    const blocked = restriction();
    if (blocked) return ask('pause', blocked);
    if (account() === 'mismatch') {
      return ask('pause', { reason: `The active X account changed. Switch back to @${job.handle} and continue.` });
    }
    if (!Cleaner.atSection(job.section, location.href, job.handle, job.history)) return ask('routeLost');
    return ask('sectionIssue', { reason: 'The page stopped showing the expected section or account controls.' });
  }

  async function scan() {
    const name = sections[job.section].name;
    await waitFor(() => account() || restriction() ||
      !Cleaner.atSection(job.section, location.href, job.handle, job.history), 18000);
    if (cancelled) return;
    if (account() !== 'verified' || restriction() || !Cleaner.atSection(job.section, location.href, job.handle, job.history)) {
      await reportLostView();
      return;
    }
    if (!await prepareView()) {
      if (!cancelled) await reportLostView();
      return;
    }
    const blocked = restriction();
    if (blocked) {
      await ask('pause', blocked);
      return;
    }
    if (job.waitUntil > Date.now() && !await waitUntil(job.waitUntil)) {
      if (!cancelled && !(refreshDue() && routeAndAccount() && await refreshTimeline())) await reportLostView();
      return;
    }
    const ready = await waitFor(() => {
      const column = primary();
      return all(column, ARTICLE).length || emptyTimeline() || timelineError() || rateLimited();
    }, 18000);
    if (!ready && !cancelled) {
      const reason = 'X did not load a readable timeline.';
      if ([3, 4].includes(job.section) && !job.history) {
        await ask('sectionEnd', { result: 'review', detail: reason, fallback: true });
      } else {
        await ask('sectionIssue', { reason });
      }
      return;
    }

    await clearBookmarks();
    if (cancelled) return;
    const skipped = new Set();
    const failures = new Set();
    const found = new Set();
    const ambiguous = new Set();
    const needsRetry = new Set();
    const removed = new Set();
    const scrollRoot = document.scrollingElement;
    let still = 0;
    let errorsInARow = 0;
    let everSawCards = false;
    let previous = '';
    let lastReport = '';
    let lastSkipped = -1;
    let detail = '';
    let repeatDeferred = 0;
    let deferredKey;

    async function update(text, waiting = false) {
      if (text === lastReport && skipped.size === lastSkipped) return;
      lastReport = text;
      lastSkipped = skipped.size;
      await ask('progress', { text, skipped: skipped.size, waiting });
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    while (!cancelled) {
      const blocked = restriction();
      if (blocked) {
        await ask('pause', blocked);
        return;
      }
      if (!routeAndAccount()) {
        await reportLostView();
        return;
      }
      if (timelineError()) {
        detail = 'X reported a timeline loading error.';
        break;
      }
      if (refreshDue() && await refreshTimeline()) return;
      if (batchDue) {
        await update(`${name} · Break after six actions`, true);
        if (await waitUntil(nextActionAt)) batchDue = false;
        continue;
      }
      const cards = all(primary(), ARTICLE);
      everSawCards ||= cards.length > 0;
      let next;
      const marker = [];
      for (const card of cards) {
        const data = parseCard(card);
        const kind = identify(card, data);
        const key = data?.id || normalize(card.innerText).slice(0, 160) || 'unknown-card';
        marker.push(key);
        if (kind) {
          ambiguous.delete(key);
          if (job.preview) found.add(kind + ':' + key);
          else if (!removed.has(key) && !failures.has(key)) next ||= { ...data, kind };
          continue;
        }
        // Context cards in Replies can belong to someone else. They are never targets.
        const seemsEligible = !data && (job.section >= 2 || repostedHere(card) ||
          all(card, '[data-testid="User-Name"] a').some(link => profileHandle(link.href) === job.handle));
        const missingToggle = data && job.section >= 2 && !removed.has(key);
        if (seemsEligible || missingToggle) ambiguous.add(key);
        else skipped.add(key);
      }

      if (next) {
        if (nextActionAt > Date.now()) {
          await update(`${name} · Waiting before the next action`, true);
          if (!await waitUntil(nextActionAt)) continue;
          continue;
        }
        const verbs = { delete: 'Deleting', repost: 'Undoing repost', bookmark: 'Removing bookmark', like: 'Removing like' };
        await update(`${name} · ${verbs[next.kind]} · Pass ${job.pass}`);
        const result = await apply(next);
        if (cancelled) return;
        if (result === 'retry') {
          failures.add(next.id);
          needsRetry.add(next.id);
          continue;
        }
        if (result === 'skipped') {
          failures.add(next.id);
          continue;
        }
        if (result === 'deferred') {
          if (next.id !== deferredKey) {
            deferredKey = next.id;
            repeatDeferred = 0;
          }
          if (++repeatDeferred < 4) await sleep(400);
          else {
            failures.add(next.id);
            needsRetry.add(next.id);
            lastIssue = 'An item repeatedly changed before its control could be used.';
          }
          continue;
        }
        deferredKey = null;
        repeatDeferred = 0;
        if (result === 'changed') {
          removed.add(next.id);
          errorsInARow = 0;
          still = 0;
        } else {
          failures.add(next.id);
          needsRetry.add(next.id);
          if (++errorsInARow === 3 && !restriction()) {
            await ask('sectionIssue', { reason: lastIssue });
            return;
          }
        }
        continue;
      }

      await update(`${name} · Scanning for older items · Pass ${job.pass}`);
      if (emptyTimeline() && !cards.length) break;
      const y = scrollRoot.scrollTop;
      const max = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
      const atBottom = y >= max - 12;
      const signature = `${marker.join(',')}/${max}`;
      const loading = all(primary(), '[role="progressbar"], [data-testid="spinner"]').length > 0;
      still = atBottom && signature === previous && !loading ? still + 1 : 0;
      previous = signature;
      if (still >= 5) break;
      if (loading) {
        const loaded = await waitFor(() =>
          !all(primary(), '[role="progressbar"], [data-testid="spinner"]').length ||
          rateLimited() || timelineError(), 30000);
        if (!loaded && !cancelled) {
          detail = 'X kept loading older items.';
          break;
        }
      }
      window.scrollBy({ top: Math.max(250, window.innerHeight * 0.65), behavior: 'smooth' });
      await sleep(atBottom ? 1800 : 950);
    }
    if (cancelled) return;
    if (detail) {
      await ask('sectionIssue', { reason: detail });
      return;
    }
    if (!job.preview && (needsRetry.size || ambiguous.size)) {
      const retry = await ask('refresh', { mode: 'items' });
      if (retry?.reloading || cancelled) return;
    }
    if (removed.size) {
      await update(`${name} · Waiting to check for older items`, true);
      if (!await waitUntil(nextActionAt)) {
        if (!cancelled && !(refreshDue() && routeAndAccount() && await refreshTimeline())) await reportLostView();
        return;
      }
      const refresh = await ask('refresh', { mode: 'tail' });
      if (refresh?.reloading || cancelled) return;
    }
    if (refreshDue() && routeAndAccount() && await refreshTimeline()) return;
    if (!detail && failures.size) detail = `${failures.size} item(s) could not be verified. ${lastIssue}`.trim();
    if (!detail && ambiguous.size) detail = `${ambiguous.size} card(s) lacked a recognizable action or permalink.`;
    if (!detail && !everSawCards && !emptyTimeline()) detail = 'X did not confirm that the section is empty.';
    if (!job.preview && !detail && job.section === 0 && job.pass > 1 && job.selected.includes(2) && !removed.size) {
      const remaining = remainingPostCount();
      if (remaining) detail = `X still reports ${remaining} on the profile.`;
    }
    await ask('sectionEnd', {
      result: detail ? 'review' : 'clear',
      detail: detail || 'No more eligible items surfaced.',
      fallback: !everSawCards && !emptyTimeline(),
      found: found.size
    });
  }

  async function run() {
    job = await ask('hello');
    if (!job || (job.status !== 'running' && !job.alertPending)) return;
    batchDue = Boolean(job.refreshPending);
    nextActionAt = job.nextActionAt || 0;
    document.addEventListener('pointerdown', event => {
      if (job.status !== 'running' || !event.isTrusted || cancelled || !event.target.closest?.('main, header')) return;
      cancelled = true;
      ask('stop').catch(() => {});
    }, true);
    paint = showPanel();
    paint(job);
    observer = (changes, area) => {
      if (area !== 'local') return;
      const state = changes.report?.newValue;
      if (!state) return;
      cancelled ||= state?.id !== job.id || state.status !== 'running' ||
        state.section !== job.section || state.pass !== job.pass;
      if (state?.id !== job.id) return;
      paint(state);
    };
    chrome.storage.onChanged.addListener(observer);
    const latest = (await chrome.storage.local.get('report')).report;
    if (latest) observer({ report: { newValue: latest } }, 'local');
    if (!cancelled && job.status === 'running') await scan();
  }

  run().catch(async error => {
    if (job && !cancelled) {
      try {
        if (!routeAndAccount()) await reportLostView();
        else await ask('sectionIssue', { reason: `X Cleaner hit a page issue. ${error.message}` });
      } catch {
        if (paint) paint({ ...job, status: 'paused', message: 'Cleanup interrupted. Reopen X Cleaner.' });
      }
    }
  });
})();
