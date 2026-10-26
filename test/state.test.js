import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultState, restoreState, selectMode, startTimer, isExpired
} from "../lib/state.js";

const NOW = 1_000_000;

test("restoring state expires timers and clears damaged timer data", () => {
  assert.deepEqual(restoreState(null, NOW), defaultState());
  for (const timerEndsAt of [NOW, NOW - 1, "tomorrow", -1, NaN, Infinity]) {
    assert.deepEqual(restoreState({ mode: "display", timerEndsAt, timerMinutes: 30 }, NOW), defaultState(30));
  }
  assert.deepEqual(restoreState({ mode: "unknown" }, NOW), defaultState());
  assert.deepEqual(restoreState({ mode: "default", timerEndsAt: NOW + 100 }, NOW), defaultState());
});

test("restoring a valid active session preserves its timer and beginning", () => {
  const active = { mode: "system", startedAt: NOW - 100, timerEndsAt: NOW + 60_000, timerMinutes: 1 };
  assert.deepEqual(restoreState(active, NOW), active);
  assert.deepEqual(restoreState({ mode: "display", startedAt: NOW + 1 }, NOW), {
    mode: "display", timerEndsAt: null, timerMinutes: 60, startedAt: NOW
  });
});

test("selecting any mode cancels the prior timer and begins a fresh session", () => {
  const active = { mode: "display", startedAt: NOW - 100, timerEndsAt: NOW + 60_000, timerMinutes: 90 };
  assert.deepEqual(selectMode(active, "display", NOW), {
    mode: "display", startedAt: NOW, timerEndsAt: null, timerMinutes: 90
  });
  assert.deepEqual(selectMode(active, "default", NOW), defaultState(90));
  assert.throws(() => selectMode(active, "invalid", NOW), /有效/);
});

test("timers require an active session and whole minutes within the supported range", () => {
  assert.throws(() => startTimer(defaultState(), 60, NOW), /先选择/);
  const active = selectMode(defaultState(), "system", NOW);
  for (const value of [0, -1, 1.1, 1441, "60", null, NaN]) {
    assert.throws(() => startTimer(active, value, NOW), /整数/);
  }
  const timed = startTimer(active, 1440, NOW);
  assert.equal(timed.timerEndsAt, NOW + 86_400_000);
  assert.equal(timed.startedAt, NOW);
  assert.equal(isExpired(timed, timed.timerEndsAt - 1), false);
  assert.equal(isExpired(timed, timed.timerEndsAt), true);
});
