const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor() { this.children = []; this.textContent = ''; this.listeners = {}; this.attributes = {}; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(key, value) { this.attributes[key] = value; }
  replaceChildren() { this.children = []; }
  append(...children) { this.children.push(...children); }
}
const elements = new Map();
const node = id => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
};
Object.assign(node('pace'), { value: '15', valueAsNumber: 15, validity: { valid: true } });
let onChange;
const responses = {};
const options = ['replies', 'reposts', 'posts', 'bookmarks', 'likes'].map(value =>
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
    runtime: { sendMessage: message => new Promise(resolve => { responses[message.type] = { message, resolve }; }) },
    storage: { onChanged: { addListener(listener) { onChange = listener; } } }
  }
});
for (const name of ['shared', 'popup']) vm.runInContext(fs.readFileSync('extension/' + name + '.js', 'utf8'), context);
const snapshot = {
  id: 'current', handle: 'sample_user', revision: 8, status: 'running', section: 0, pass: 1, selected: [1, 0],
  pace: 15000, totals: { deleted: 1 }, message: 'Delete confirmed · 1 deleted this run.'
};
onChange({ report: { newValue: snapshot } }, 'local');
assert.equal(node('deleted').textContent, '1');
responses.status.resolve({ result: { ...snapshot, id: 'old', revision: 7, totals: { deleted: 0 }, message: 'Waiting…' } });
responses.detect.resolve({ result: { handle: 'sample_user' } });
setImmediate(async () => {
  assert.equal(node('deleted').textContent, '1');
  assert.equal(node('message').textContent, snapshot.message);
  onChange({ report: { newValue: { ...snapshot, revision: 9, totals: { deleted: 2 } } } }, 'local');
  assert.equal(node('deleted').textContent, '2');
  console.log('PASS popup updates live and an older status response cannot reset a confirmed count');
  onChange({ report: { newValue: { ...snapshot, revision: 10, status: 'paused', pace: 0 } } }, 'local');
  const pace = node('pace');
  assert.equal(pace.value, '0');
  options.find(box => box.value === 'posts').checked = false;
  options.find(box => box.value === 'posts').listeners.change();
  assert.deepEqual(node('route-list').children.map(item => item.children[0].textContent), ['Replies']);
  pace.valueAsNumber = NaN;
  pace.validity.valid = false;
  pace.listeners.input();
  assert.equal(node('start').disabled, true);
  assert.equal(node('preview').disabled, false);
  assert.equal(node('pace-error').hidden, false);
  pace.valueAsNumber = 0.5;
  pace.validity.valid = true;
  pace.listeners.input();
  assert.equal(node('start').disabled, false);
  const action = node('start').listeners.click();
  assert.equal(responses.start.message.pace, 500);
  assert.deepEqual(Array.from(responses.start.message.selection), [1]);
  responses.start.resolve({ result: { ...snapshot, revision: 11, selected: [1], pace: 500 } });
  await action;
  console.log('PASS popup sends the chosen category and fractional delay, restores zero, and validates invalid input');
});
