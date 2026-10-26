import {
  STORAGE_KEY, TIMER_ALARM, UserError, defaultState, isExpired,
  restoreState, selectMode, startTimer
} from "./state.js";

const MESSAGE_TYPES = new Set(["GET_STATE", "SET_MODE", "START_TIMER", "CANCEL_TIMER"]);
const LABELS = {
  default: "系统默认状态",
  display: "屏幕常亮",
  system: "系统保持运行"
};

export function createController(chrome, { now = Date.now, logger = console } = {}) {
  let state = defaultState();
  let initialized = false;
  let queue = Promise.resolve();
  const snapshot = () => ({ ...state });
  const log = (error) => logger?.error?.("AlwayLight:", error);

  function applyPower(next) {
    if (next.mode === "default") chrome.power.releaseKeepAwake();
    else chrome.power.requestKeepAwake(next.mode);
  }

  async function syncAlarm(next) {
    if (next.timerEndsAt === null) {
      await chrome.alarms.clear(TIMER_ALARM);
      return;
    }
    const alarm = await chrome.alarms.get(TIMER_ALARM);
    if (!alarm || alarm.scheduledTime !== next.timerEndsAt || alarm.periodInMinutes !== undefined) {
      await chrome.alarms.create(TIMER_ALARM, { when: next.timerEndsAt });
    }
  }

  async function decorate(next) {
    const results = await Promise.allSettled([
      chrome.action.setBadgeText({ text: next.mode === "display" ? "ON" : next.mode === "system" ? "SYS" : "" }),
      chrome.action.setBadgeBackgroundColor({ color: "#F5B942" }),
      chrome.action.setTitle({ title: `AlwayLight · ${LABELS[next.mode]}` })
    ]);
    for (const result of results) if (result.status === "rejected") log(result.reason);
  }

  // Power, alarm and storage changes are serialized. If one fails, restore the
  // complete prior session; if that also fails, release the keep-awake request.
  async function commit(next, { boot = false } = {}) {
    const prior = snapshot();
    try {
      applyPower(next);
      await syncAlarm(next);
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
    } catch (error) {
      log(error);
      const rollback = boot || next.mode === "default" ? defaultState(next.timerMinutes) : prior;
      try {
        applyPower(rollback);
        await syncAlarm(rollback);
        await chrome.storage.local.set({ [STORAGE_KEY]: rollback });
        state = rollback;
      } catch (rollbackError) {
        log(rollbackError);
        state = defaultState(prior.timerMinutes);
        // Use independent attempts: a failed storage operation must never stop
        // the release of an active keep-awake request.
        try { applyPower(state); } catch (releaseError) { log(releaseError); }
        const results = await Promise.allSettled([
          chrome.alarms.clear(TIMER_ALARM),
          chrome.storage.local.set({ [STORAGE_KEY]: state })
        ]);
        for (const result of results) if (result.status === "rejected") log(result.reason);
        initialized = false;
      }
      await decorate(state);
      throw new UserError("设置未能保存，请重试。可在工具栏查看当前状态。");
    }
    state = next;
    await decorate(next);
    return snapshot();
  }

  async function initialize() {
    if (initialized) return;
    let stored;
    try {
      stored = await chrome.storage.local.get(STORAGE_KEY);
    } catch (error) {
      log(error);
      try { chrome.power.releaseKeepAwake(); } catch (releaseError) { log(releaseError); }
      throw new UserError("无法读取已保存的状态，请稍后重试。");
    }
    await commit(restoreState(stored[STORAGE_KEY], now()), { boot: true });
    initialized = true;
  }

  function enqueue(operation) {
    const task = queue.then(async () => {
      await initialize();
      return operation();
    });
    queue = task.catch(() => {});
    return task;
  }

  async function reconcile({ reapply = false } = {}) {
    if (isExpired(state, now())) return commit(defaultState(state.timerMinutes));
    if (reapply) return commit(snapshot());
    // Chrome may clear alarms during a browser update or restart.
    await syncAlarm(state);
    return snapshot();
  }

  async function dispatch(message) {
    await reconcile();
    switch (message.type) {
      case "GET_STATE": return snapshot();
      case "SET_MODE": return commit(selectMode(state, message.mode, now()));
      case "START_TIMER": return commit(startTimer(state, message.minutes, now()));
      case "CANCEL_TIMER": return commit({ ...state, timerEndsAt: null });
      default: throw new UserError("无法识别此操作。");
    }
  }

  // Install listeners before the first asynchronous storage read. A popup,
  // browser startup event and an alarm can all wake the same worker together.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: "仅允许 AlwayLight 内部调用。" });
      return false;
    }
    if (!message || !MESSAGE_TYPES.has(message.type)) {
      sendResponse({ ok: false, error: "无法识别此操作。" });
      return false;
    }
    enqueue(() => dispatch(message)).then(
      (current) => sendResponse({ ok: true, state: current }),
      (error) => {
        if (!(error instanceof UserError)) log(error);
        sendResponse({ ok: false, error: error instanceof UserError ? error.message : "操作暂时未完成，请重试。" });
      }
    );
    return true;
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== TIMER_ALARM) return;
    // A queued alarm from an earlier timer must not end a newer session.
    enqueue(() => reconcile()).catch(log);
  });

  chrome.runtime.onStartup.addListener(() => {
    enqueue(() => reconcile({ reapply: true })).catch(log);
  });

  chrome.runtime.onInstalled.addListener(() => {
    enqueue(() => reconcile({ reapply: true })).catch(log);
  });

  chrome.commands.onCommand.addListener((command) => {
    if (command !== "toggle-keep-awake") return;
    enqueue(async () => {
      await reconcile();
      return commit(selectMode(state, state.mode === "default" ? "display" : "default", now()));
    }).catch(log);
  });

  const ready = enqueue(() => snapshot());
  ready.catch(log);
  return { ready, whenIdle: () => queue };
}
