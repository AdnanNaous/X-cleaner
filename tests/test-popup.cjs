const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor() { this.children = []; this.textContent = ''; }
  addEventListener() {}
  setAttribute() {}
  replaceChildren() { this.children = []; }
  append(...children) { this.children.push(...children); }
}
const elements = new Map();
const node = id => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
};
let onChange;
const responses = {};
const options = ['posts', 'reposts', 'bookmarks', 'likes'].map(value =>
  Object.assign(new Element(), { value, checked: true }));
const context = vm.createContext({
  URL, Date, console, setInterval() {},
  document: {
    getElementById: node,
    querySelectorAll: () => options,
    querySelector: () => node('stats'),
    createElement: () => new Element()
  },
  chrome: {
    runtime: { sendMessage: ({ type }) => new Promise(resolve => { responses[type] = resolve; }) },
    storage: { onChanged: { addListener(listener) { onChange = listener; } } }
  }
});
for (const name of ['shared', 'popup']) vm.runInContext(fs.readFileSync('extension/' + name + '.js', 'utf8'), context);
const snapshot = {
  id: 'current', handle: 'sample_user', revision: 8, status: 'running', section: 0, pass: 1, selected: [0, 1],
  pace: 15000, totals: { deleted: 1 }, message: 'Delete confirmed · 1 deleted this run.'
};
onChange({ report: { newValue: snapshot } }, 'local');
assert.equal(node('deleted').textContent, '1');
responses.status({ result: { ...snapshot, revision: 7, totals: { deleted: 0 }, message: 'Waiting…' } });
responses.detect({ result: { handle: 'sample_user' } });
setImmediate(() => {
  assert.equal(node('deleted').textContent, '1');
  assert.equal(node('message').textContent, snapshot.message);
  onChange({ report: { newValue: { ...snapshot, revision: 9, totals: { deleted: 2 } } } }, 'local');
  assert.equal(node('deleted').textContent, '2');
  console.log('PASS popup updates live and an older status response cannot reset a confirmed count');
});
