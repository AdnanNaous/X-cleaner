'use strict';

globalThis.Cleaner = Object.freeze({
  origin: 'https://x.com',
  defaultPace: 15000,
  slowerPace: 30000,
  batchSize: 6,
  batchRest: 45000,
  rateRest: 300000,
  sections: [
    { name: 'Posts', suffix: '' },
    { name: 'Replies', suffix: '/with_replies' },
    { name: 'Reposts', suffix: '/reposts' },
    { name: 'Bookmarks', path: '/i/bookmarks' },
    { name: 'Likes', suffix: '/likes' }
  ],
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
  sectionTarget(index, handle, history = false) {
    return history ? this.origin + '/i/history' : this.sectionUrl(index, handle);
  },
  atSection(index, url, handle, history = false) {
    const path = this.route(url);
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
