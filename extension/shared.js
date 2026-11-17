'use strict';

globalThis.Cleaner = Object.freeze({
  origin: 'https://x.com',
  defaultPace: 15000,
  maxPace: 3600000,
  batchSize: 6,
  batchRest: 45000,
  rateRest: 300000,
  itemRetryRest: 30000,
  refreshInterval: 600000,
  refreshActions: 40,
  refreshDue(job) {
    return Boolean(job.refreshAt && Date.now() >= job.refreshAt) ||
      (job.actionsSinceRefresh || 0) >= this.refreshActions;
  },
  automaticPace(job, success, duration = 0) {
    if (!success || duration > 8000) {
      job.successStreak = 0;
      return 15000;
    }
    job.successStreak = (job.successStreak || 0) + 1;
    if (job.successStreak >= 12) return 3000;
    if (job.successStreak >= 4) return 4000;
    return 10000;
  },
  elapsedSince(start) {
    const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  },
  sectionOrder: [0, 2, 1, 3, 4],
  sections: [
    { name: 'Posts', suffix: '' },
    { name: 'Replies', suffix: '/with_replies' },
    { name: 'Reposts', suffix: '/reposts' },
    { name: 'Bookmarks', path: '/i/bookmarks' },
    { name: 'Likes', suffix: '/likes' }
  ],
  validPace(pace) {
    return Number.isSafeInteger(pace) && pace >= 0 && pace <= this.maxPace;
  },
  sameSections(left, right) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every(index => right.includes(index));
  },
  normalizeHandle(handle) {
    return typeof handle === 'string' && /^[a-z0-9_]{1,15}$/i.test(handle)
      ? handle.toLowerCase() : null;
  },
  sectionUrl(index, handle) {
    const section = this.sections[index];
    if (section.path) return this.origin + section.path;
    const name = this.normalizeHandle(handle);
    if (!name) throw new Error('The signed-in X account is required.');
    return this.origin + '/' + name + section.suffix;
  },
  replySearchUrl(handle) {
    const name = this.normalizeHandle(handle);
    if (!name) throw new Error('The signed-in X account is required.');
    return this.origin + '/search?q=' + encodeURIComponent('from:' + name + ' filter:replies') + '&f=live';
  },
  sectionTarget(index, handle, history = false, replySearch = false, repostProfile = false) {
    if (index === 2 && repostProfile) return this.sectionUrl(0, handle);
    if (index === 1 && replySearch) return this.replySearchUrl(handle);
    return history ? this.origin + '/i/history' : this.sectionUrl(index, handle);
  },
  atSection(index, url, handle, history = false, replySearch = false, repostProfile = false) {
    const path = this.route(url);
    if (index === 2 && repostProfile) return path === this.route(this.sectionUrl(0, handle));
    if (index === 1 && replySearch) {
      if (path !== '/search') return false;
      const query = new URL(url).searchParams;
      return query.getAll('q').length === 1 && query.getAll('f').length === 1 &&
        query.get('q') === 'from:' + this.normalizeHandle(handle) + ' filter:replies' && query.get('f') === 'live';
    }
    if (path === this.route(this.sectionUrl(index, handle))) return true;
    if ((index === 3 || index === 4) && (history || index === 3)) {
      const tab = index === 3 ? 'bookmarks' : 'likes';
      return path === '/i/history' || path === '/i/history/' + tab;
    }
    return false;
  },
  routeStatus(job) {
    const index = job?.selected?.indexOf(job.section) ?? -1;
    if (index < 0) return '';
    const next = job.selected[index + 1];
    const step = 'Step ' + (index + 1) + ' of ' + job.selected.length;
    const following = next === undefined ? '' : ' · Next: ' + this.sections[next].name;
    return step + ' · Pass ' + job.pass + following;
  },
  route(url) {
    try {
      const parsed = new URL(url);
      if (parsed.origin === this.origin) {
        return parsed.pathname.replace(/\/+$/, '').toLowerCase();
      }
    } catch {
      return null;
    }
    return null;
  }
});
