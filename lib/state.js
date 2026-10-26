export const STORAGE_KEY = "alwaylightState";
export const TIMER_ALARM = "alwaylight-timer";
export const MINUTES_LIMIT = 1440;
export const MODES = Object.freeze(["default", "display", "system"]);

export function defaultState(timerMinutes = 60) {
  return { mode: "default", timerEndsAt: null, timerMinutes, startedAt: null };
}

export function validMinutes(value) {
  return Number.isInteger(value) && value >= 1 && value <= MINUTES_LIMIT;
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Treat a damaged or elapsed timer as finished, so it cannot become an
// unintended indefinite keep-awake session after the worker restarts.
export function restoreState(value, now) {
  if (!value || typeof value !== "object") return defaultState();
  const minutes = validMinutes(value.timerMinutes) ? value.timerMinutes : 60;
  if (!MODES.includes(value.mode) || value.mode === "default") return defaultState(minutes);
  if (value.timerEndsAt !== null && value.timerEndsAt !== undefined &&
      (!timestamp(value.timerEndsAt) || value.timerEndsAt <= now)) {
    return defaultState(minutes);
  }
  return {
    mode: value.mode,
    timerEndsAt: value.timerEndsAt ?? null,
    timerMinutes: minutes,
    startedAt: timestamp(value.startedAt) && value.startedAt <= now ? value.startedAt : now
  };
}

export function isExpired(state, now) {
  return state.timerEndsAt !== null && state.timerEndsAt <= now;
}

export class UserError extends Error {}

export function selectMode(state, mode, now) {
  if (!MODES.includes(mode)) throw new UserError("请选择有效的保持唤醒模式。");
  return mode === "default" ? defaultState(state.timerMinutes) : {
    mode,
    timerEndsAt: null,
    timerMinutes: state.timerMinutes,
    startedAt: now
  };
}

export function startTimer(state, minutes, now) {
  if (!validMinutes(minutes)) throw new UserError("请输入 1 至 1440 之间的整数分钟。");
  if (state.mode === "default") throw new UserError("请先选择屏幕常亮或系统保持运行，再启动倒计时。");
  return { ...state, timerEndsAt: now + minutes * 60_000, timerMinutes: minutes };
}
