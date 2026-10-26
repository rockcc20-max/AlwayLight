import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "../lib/controller.js";
import { STORAGE_KEY, TIMER_ALARM, defaultState } from "../lib/state.js";

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
    listeners
  };
}

function harness(stored) {
  let time = 1_000_000;
  const data = stored === undefined ? {} : { [STORAGE_KEY]: structuredClone(stored) };
  const alarms = new Map();
  const failures = new Map();
  const calls = [];
  const errors = [];
  let power = "default";
  let badge = "";
  let title = "";
  const check = (operation) => {
    calls.push(operation);
    if (failures.get(operation)) {
      failures.set(operation, failures.get(operation) - 1);
      throw new Error(`Simulated ${operation} failure`);
    }
  };
  const chrome = {
    runtime: { id: "alwaylight-test", onMessage: event(), onStartup: event(), onInstalled: event() },
    commands: { onCommand: event() },
    storage: { local: {
      async get() { check("storage.get"); return structuredClone(data); },
      async set(value) { check("storage.set"); Object.assign(data, structuredClone(value)); }
    } },
    power: {
      requestKeepAwake(mode) { check(`power.${mode}`); power = mode; },
      releaseKeepAwake() { check("power.default"); power = "default"; }
    },
    alarms: {
      onAlarm: event(),
      async get(name) { check("alarms.get"); return alarms.get(name); },
      async create(name, options) { check("alarms.create"); alarms.set(name, { name, scheduledTime: options.when }); },
      async clear(name) { check("alarms.clear"); return alarms.delete(name); }
    },
    action: {
      async setBadgeText(options) { check("action.badge"); badge = options.text; },
      async setBadgeBackgroundColor() { check("action.color"); },
      async setTitle(options) { check("action.title"); title = options.title; }
    }
  };
  const controller = createController(chrome, { now: () => time, logger: { error: (...items) => errors.push(items) } });
  return {
    chrome, controller, data, alarms, calls, errors,
    get power() { return power; },
    get badge() { return badge; },
    get title() { return title; },
    get now() { return time; },
    advance(ms) { time += ms; },
    fail(operation, count = 1) { failures.set(operation, count); },
    message(message, sender = { id: chrome.runtime.id }) {
      return new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
    },
    async alarm(name = TIMER_ALARM) {
      alarms.delete(name);
      chrome.alarms.onAlarm.emit({ name });
      await controller.whenIdle();
    }
  };
}

test("listeners are installed synchronously and rapid requests are serialized during initialization", async () => {
  const h = harness();
  assert.equal(h.chrome.runtime.onMessage.listeners.length, 1);
  assert.equal(h.chrome.alarms.onAlarm.listeners.length, 1);
  const first = h.message({ type: "SET_MODE", mode: "display" });
  const second = h.message({ type: "START_TIMER", minutes: 5 });
  const third = h.message({ type: "SET_MODE", mode: "system" });
  const results = await Promise.all([first, second, third]);
  assert.equal(results[0].state.mode, "display");
  assert.equal(results[1].state.timerEndsAt, h.now + 300_000);
  assert.deepEqual(results[2].state, { mode: "system", timerEndsAt: null, timerMinutes: 5, startedAt: h.now });
  assert.deepEqual(h.data[STORAGE_KEY], results[2].state);
  assert.equal(h.power, "system");
  assert.equal(h.badge, "SYS");
  assert.match(h.title, /系统保持运行/);
  assert.equal(h.alarms.size, 0);
});

test("active power mode is restored when a service worker starts again", async () => {
  const original = harness();
  await original.message({ type: "SET_MODE", mode: "display" });
  const saved = (await original.message({ type: "START_TIMER", minutes: 10 })).state;
  const restarted = harness(saved);
  await restarted.controller.ready;
  assert.equal(restarted.power, "display");
  assert.equal(restarted.badge, "ON");
  assert.equal(restarted.alarms.get(TIMER_ALARM).scheduledTime, saved.timerEndsAt);
  assert.deepEqual((await restarted.message({ type: "GET_STATE" })).state, saved);
});

test("expired persisted timers are released on worker startup", async () => {
  const h = harness({ mode: "display", timerEndsAt: 999_999, timerMinutes: 12, startedAt: 900_000 });
  await h.controller.ready;
  assert.equal(h.power, "default");
  assert.deepEqual(h.data[STORAGE_KEY], defaultState(12));
  assert.equal(h.alarms.size, 0);
});

test("timer expiry releases power, persists default, and keeps the chosen duration", async () => {
  const h = harness();
  await h.message({ type: "SET_MODE", mode: "system" });
  await h.message({ type: "START_TIMER", minutes: 2 });
  h.advance(120_000);
  await h.alarm();
  assert.deepEqual((await h.message({ type: "GET_STATE" })).state, defaultState(2));
  assert.deepEqual(h.data[STORAGE_KEY], defaultState(2));
  assert.equal(h.power, "default");
  assert.equal(h.badge, "");
});

test("GET_STATE reconciles a delayed timer and recreates missing future alarms", async () => {
  const h = harness();
  await h.message({ type: "SET_MODE", mode: "display" });
  const timed = (await h.message({ type: "START_TIMER", minutes: 1 })).state;
  h.alarms.clear();
  assert.equal((await h.message({ type: "GET_STATE" })).state.mode, "display");
  assert.equal(h.alarms.get(TIMER_ALARM).scheduledTime, timed.timerEndsAt);
  h.advance(61_000);
  assert.deepEqual((await h.message({ type: "GET_STATE" })).state, defaultState(1));
  assert.equal(h.power, "default");
});

test("canceling a timer keeps its current mode and a stale alarm cannot end it", async () => {
  const h = harness();
  await h.message({ type: "SET_MODE", mode: "display" });
  await h.message({ type: "START_TIMER", minutes: 1 });
  const canceled = await h.message({ type: "CANCEL_TIMER" });
  assert.equal(canceled.state.mode, "display");
  assert.equal(canceled.state.timerEndsAt, null);
  h.advance(61_000);
  await h.alarm();
  assert.equal(h.power, "display");
  assert.equal((await h.message({ type: "GET_STATE" })).state.mode, "display");
});

test("an old alarm cannot expire a replacement timer", async () => {
  const h = harness();
  await h.message({ type: "SET_MODE", mode: "display" });
  await h.message({ type: "START_TIMER", minutes: 1 });
  h.advance(30_000);
  const replacement = (await h.message({ type: "START_TIMER", minutes: 10 })).state;
  h.advance(30_000);
  await h.alarm();
  assert.equal(h.power, "display");
  assert.equal(h.alarms.get(TIMER_ALARM).scheduledTime, replacement.timerEndsAt);
});

test("selecting the same mode cancels the timer and the shortcut toggles on and off", async () => {
  const h = harness();
  await h.message({ type: "SET_MODE", mode: "display" });
  await h.message({ type: "START_TIMER", minutes: 10 });
  assert.equal((await h.message({ type: "SET_MODE", mode: "display" })).state.timerEndsAt, null);
  h.chrome.commands.onCommand.emit("toggle-keep-awake");
  await h.controller.whenIdle();
  assert.equal(h.power, "default");
  h.chrome.commands.onCommand.emit("toggle-keep-awake");
  await h.controller.whenIdle();
  assert.equal(h.power, "display");
});

test("malformed and external messages cannot change state", async () => {
  const h = harness();
  await h.controller.ready;
  assert.equal((await h.message({ type: "SET_MODE", mode: "display" }, { id: "other-extension" })).ok, false);
  assert.equal((await h.message(null)).ok, false);
  assert.equal((await h.message({ type: "SOMETHING" })).ok, false);
  assert.equal((await h.message({ type: "SET_MODE", mode: "unsupported" })).ok, false);
  assert.equal((await h.message({ type: "START_TIMER", minutes: 60 })).ok, false);
  assert.equal(h.power, "default");
  await h.message({ type: "SET_MODE", mode: "system" });
  for (const minutes of [0, "10", 1.5, 1441]) {
    assert.equal((await h.message({ type: "START_TIMER", minutes })).ok, false);
  }
  assert.equal((await h.message({ type: "GET_STATE" })).state.timerEndsAt, null);
});

test("a failed power request rolls back without showing an active mode", async () => {
  const h = harness();
  await h.controller.ready;
  h.fail("power.display");
  assert.equal((await h.message({ type: "SET_MODE", mode: "display" })).ok, false);
  assert.equal(h.power, "default");
  assert.deepEqual(h.data[STORAGE_KEY], defaultState());
  assert.equal(h.badge, "");
  assert.equal((await h.message({ type: "SET_MODE", mode: "system" })).ok, true);
});

test("a storage failure restores the previous mode and alarm", async () => {
  const h = harness();
  await h.message({ type: "SET_MODE", mode: "system" });
  const prior = (await h.message({ type: "START_TIMER", minutes: 20 })).state;
  h.fail("storage.set");
  assert.equal((await h.message({ type: "SET_MODE", mode: "display" })).ok, false);
  assert.equal(h.power, "system");
  assert.deepEqual(h.data[STORAGE_KEY], prior);
  assert.equal(h.alarms.get(TIMER_ALARM).scheduledTime, prior.timerEndsAt);
  assert.deepEqual((await h.message({ type: "GET_STATE" })).state, prior);
});

test("a failed timer creation does not leave a timer claimed in storage", async () => {
  const h = harness();
  const prior = (await h.message({ type: "SET_MODE", mode: "display" })).state;
  h.fail("alarms.create");
  assert.equal((await h.message({ type: "START_TIMER", minutes: 10 })).ok, false);
  assert.deepEqual(h.data[STORAGE_KEY], prior);
  assert.equal(h.alarms.size, 0);
  assert.equal(h.power, "display");
});

test("expiry remains released when its first storage write fails", async () => {
  const h = harness();
  await h.message({ type: "SET_MODE", mode: "display" });
  await h.message({ type: "START_TIMER", minutes: 1 });
  h.advance(60_000);
  h.fail("storage.set");
  await h.alarm();
  assert.equal(h.power, "default");
  assert.deepEqual(h.data[STORAGE_KEY], defaultState(1));
  assert.equal((await h.message({ type: "GET_STATE" })).state.mode, "default");
});

test("decoration failure does not undo a successfully applied power session", async () => {
  const h = harness();
  await h.controller.ready;
  h.fail("action.badge");
  const response = await h.message({ type: "SET_MODE", mode: "display" });
  assert.equal(response.ok, true);
  assert.equal(h.power, "display");
  assert.equal(h.data[STORAGE_KEY].mode, "display");
});

test("a browser startup event reapplies the saved mode and unrelated events are ignored", async () => {
  const h = harness({ mode: "system", timerEndsAt: null, startedAt: 900_000, timerMinutes: 60 });
  await h.controller.ready;
  const priorRequests = h.calls.filter((call) => call === "power.system").length;
  h.chrome.runtime.onStartup.emit();
  await h.controller.whenIdle();
  assert.equal(h.calls.filter((call) => call === "power.system").length, priorRequests + 1);
  h.chrome.commands.onCommand.emit("unknown");
  await h.alarm("unknown-alarm");
  assert.equal(h.power, "system");
});
