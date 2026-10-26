import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const session = (mode, extra = {}) => ({mode, timerEndsAt:null, timerMinutes:60, startedAt:1, ...extra});
const flush = () => new Promise(setImmediate);

// Keep transport responses controllable so a late read can be delivered after
// a mode action, or a storage notification can arrive during either operation.
function popup() {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value:'60', dataset:{}, hidden:false, disabled:false, checked:false,
      attributes:{}, listeners:new Map(),
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, listener) { this.listeners.set(name, listener); },
      emit(name, event = {preventDefault(){}}) { this.listeners.get(name)?.(event); },
      focus() {}
    });
    return elements.get(selector);
  }
  const modes = ['display', 'system', 'default'].map((value) => Object.assign(element(value), {value}));
  const presets = ['30','60','120'].map((minutes) => Object.assign(element(`preset-${minutes}`), {dataset:{minutes}}));
  const requests = [];
  let storageListener;
  const document = {
    hidden:false, listeners:new Map(), querySelector:element,
    querySelectorAll(selector) { return selector === 'input[name="mode"]' ? modes : presets; },
    addEventListener(name, listener) { this.listeners.set(name, listener); }
  };
  const context = vm.createContext({
    document, Date,
    setTimeout:() => 0, clearTimeout(){}, setInterval(){},
    chrome:{
      runtime:{id:'alwaylight-popup-test', sendMessage(message) {
        return new Promise((resolve, reject) => requests.push({message, resolve, reject}));
      }},
      commands:{getAll:async () => []},
      storage:{onChanged:{addListener(listener) { storageListener = listener; }}}
    }
  });
  vm.runInContext(source, context);
  return {
    element, requests,
    take(type) {
      const pending = requests.shift();
      assert.ok(pending, `Expected ${type} request`);
      assert.equal(pending.message.type, type);
      return pending;
    },
    async respond(pending, state) { pending.resolve({ok:true,state}); await flush(); },
    async reject(pending) { pending.reject(new Error('连接已断开')); await flush(); },
    async initialize(state = session('display')) { await this.respond(this.take('GET_STATE'), state); },
    changeMode(mode) {
      for (const input of modes) input.checked = input.value === mode;
      modes.find((input) => input.value === mode).emit('change');
    },
    selectedMode() { return modes.find((input) => input.checked)?.value; },
    refresh() { document.listeners.get('visibilitychange')(); },
    storageChanged() { storageListener({alwaylightState:{newValue:{}}}, 'local'); }
  };
}

test('a delayed read cannot overwrite a newer completed mode action', async () => {
  const p = popup();
  await p.initialize();
  p.refresh();
  const oldRead = p.take('GET_STATE');
  p.changeMode('system');
  const mutation = p.take('SET_MODE');
  await p.respond(mutation, session('system'));
  assert.equal(p.selectedMode(), 'system');
  await p.respond(oldRead, session('display'));
  assert.equal(p.selectedMode(), 'system');
  await p.respond(p.take('GET_STATE'), session('system'));
  assert.equal(p.requests.length, 0);
});

test('a stale failed read cannot unlock or disconnect an active mutation', async () => {
  const p = popup();
  await p.initialize();
  p.refresh();
  const oldRead = p.take('GET_STATE');
  p.changeMode('system');
  const mutation = p.take('SET_MODE');
  await p.reject(oldRead);
  assert.equal(p.element('#app').attributes['aria-busy'], 'true');
  assert.equal(p.element('#mode-group').disabled, true);
  assert.equal(p.element('#status-label').textContent, '已开启');
  assert.equal(p.requests.length, 0);
  await p.respond(mutation, session('system'));
  assert.equal(p.element('#app').attributes['aria-busy'], 'false');
  await p.respond(p.take('GET_STATE'), session('system'));
  assert.equal(p.selectedMode(), 'system');
});

test('storage changes during a mutation trigger one trailing read and preserve edited minutes', async () => {
  const p = popup();
  await p.initialize(session('display', {timerMinutes:90}));
  assert.equal(p.element('#minutes').value, '90');
  p.element('#minutes').value = '37';
  p.element('#minutes').emit('input');
  p.changeMode('system');
  const mutation = p.take('SET_MODE');
  p.storageChanged();
  p.storageChanged();
  assert.equal(p.requests.length, 0);
  await p.respond(mutation, session('system'));
  await p.respond(p.take('GET_STATE'), session('default'));
  assert.equal(p.selectedMode(), 'default');
  assert.equal(p.element('#minutes').value, '37');
  assert.equal(p.requests.length, 0);
});

test('notifications during a read are coalesced into one additional refresh', async () => {
  const p = popup();
  await p.initialize();
  p.storageChanged();
  const firstRead = p.take('GET_STATE');
  p.storageChanged();
  p.storageChanged();
  await p.respond(firstRead, session('display'));
  await p.respond(p.take('GET_STATE'), session('system'));
  assert.equal(p.selectedMode(), 'system');
  assert.equal(p.requests.length, 0);
});

test('a lost state connection clears the active claim and can recover on a notification', async () => {
  const p = popup();
  await p.initialize(session('display', {timerEndsAt:Date.now() + 60_000}));
  p.refresh();
  await p.reject(p.take('GET_STATE'));
  assert.equal(p.element('#status-label').textContent, '连接中断');
  assert.equal(p.element('#status-pill').className, 'status-pill error');
  assert.equal(p.selectedMode(), undefined);
  assert.equal(p.element('#running-timer').hidden, true);
  assert.equal(p.element('#mode-group').disabled, true);
  p.storageChanged();
  await p.respond(p.take('GET_STATE'), session('system'));
  assert.equal(p.selectedMode(), 'system');
  assert.equal(p.element('#mode-group').disabled, false);
  assert.equal(p.element('#feedback').hidden, true);
});

test('a failed mutation and recovery read leave no unverified active indicator', async () => {
  const p = popup();
  await p.initialize();
  p.changeMode('default');
  await p.reject(p.take('SET_MODE'));
  await p.reject(p.take('GET_STATE'));
  assert.equal(p.selectedMode(), undefined);
  assert.equal(p.element('#status-label').textContent, '连接中断');
  assert.equal(p.element('#app').attributes['aria-busy'], 'false');
  assert.equal(p.element('#mode-group').disabled, true);
  assert.match(p.element('#feedback').textContent, /当前状态暂无法确认/);
});
