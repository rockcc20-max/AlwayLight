const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const modeGroup = $('#mode-group');
const timerControls = $('#timer-controls');
const minutesInput = $('#minutes');
const feedback = $('#feedback');
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const presets = [...document.querySelectorAll('[data-minutes]')];
let state = null;
let busy = false;
let refreshPending = false;
let deferredRefresh = false;
let stateRevision = 0;
let connected = false;
let connectionFeedbackVisible = false;
let lastRemainingSecond = null;
let feedbackTimeout;

function showFeedback(message, permanent = false) {
  connectionFeedbackVisible = false;
  clearTimeout(feedbackTimeout);
  feedback.textContent = message;
  feedback.hidden = false;
  if (!permanent) feedbackTimeout = setTimeout(() => { feedback.hidden = true; }, 6000);
}

function syncPresets() {
  const value = Number(minutesInput.value);
  for (const button of presets) button.setAttribute('aria-pressed', String(value === Number(button.dataset.minutes)));
}

function setBusy(value) {
  busy = value;
  app.setAttribute('aria-busy', String(value));
  modeGroup.disabled = value || !connected;
  timerControls.disabled = value || !connected || state?.mode === 'default';
  $('#cancel-timer').disabled = value || !connected;
}

function showDisconnected() {
  connected = false;
  state = null;
  for (const input of modeInputs) input.checked = false;
  $('#status-pill').className = 'status-pill error';
  $('#status-label').textContent = '连接中断';
  $('#hero').dataset.mode = 'unknown';
  $('#hero-description').textContent = '请重新打开插件，确认实际运行状态。';
  $('#running-timer').hidden = true;
  $('#timer-form').hidden = false;
  $('#timer-hint').textContent = '重新打开插件后，将读取实际运行状态。';
  setBusy(busy);
}

function drainRefresh() {
  if (!deferredRefresh || busy || refreshPending) return;
  deferredRefresh = false;
  refreshState();
}

function updateCountdown() {
  if (!state?.timerEndsAt) return;
  const seconds = Math.max(0, Math.ceil((state.timerEndsAt - Date.now()) / 1000));
  if (lastRemainingSecond !== seconds) {
    lastRemainingSecond = seconds;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    $('#countdown').textContent = [hours, minutes, seconds % 60].map((n) => String(n).padStart(2, '0')).join(':');
    $('#countdown').setAttribute('aria-label', `剩余 ${hours} 小时 ${minutes} 分钟 ${seconds % 60} 秒`);
  }
  if (seconds === 0 && !busy && !refreshPending) refreshState();
}

function render(nextState, updateMinutes = false) {
  state = nextState;
  const active = state.mode !== 'default';
  const timed = Boolean(state.timerEndsAt);
  for (const input of modeInputs) input.checked = input.value === state.mode;
  $('#status-pill').className = `status-pill${active ? ' active' : ''}`;
  $('#status-label').textContent = active ? '已开启' : '未开启';
  $('#hero').dataset.mode = state.mode;
  $('#hero-title').textContent = {display:'让灵感，持续亮着。',system:'屏幕休息，灵感继续。',default:'让灵感，持续亮着。'}[state.mode];
  $('#hero-description').textContent = {display:'屏幕常亮中，安心等待每一次生成。',system:'系统保持运行，屏幕可以自然熄灭。',default:'选一个模式，陪你等 AI 完成。'}[state.mode];
  $('#timer-form').hidden = timed;
  $('#running-timer').hidden = !timed;
  $('#timer-hint').textContent = timed ? '关闭弹窗后继续计时；切换模式会取消定时。' : active ? '关闭弹窗后仍生效；不定时将持续保持当前模式。' : '先选择一种保持运行的模式，即可设置定时。';
  if (updateMinutes && Number.isInteger(state.timerMinutes)) minutesInput.value = String(state.timerMinutes);
  syncPresets();
  setBusy(busy);
  lastRemainingSecond = null;
  updateCountdown();
}

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok || !response.state) throw new Error(response?.error || '暂时无法读取插件状态，请重新打开后重试。');
  return response.state;
}

async function refreshState(initial = false) {
  if (refreshPending || busy) {
    deferredRefresh = true;
    return;
  }
  refreshPending = true;
  const revision = stateRevision;
  try {
    const nextState = await request({type:'GET_STATE'});
    // A mode/timer action may finish while this earlier read is in flight.
    // Only a read from the current revision may update the displayed state.
    if (revision !== stateRevision) {
      deferredRefresh = true;
      return;
    }
    connected = true;
    render(nextState, initial);
    if (connectionFeedbackVisible) {
      feedback.hidden = true;
      connectionFeedbackVisible = false;
    }
  } catch (error) {
    if (revision !== stateRevision) {
      deferredRefresh = true;
      return;
    }
    showDisconnected();
    showFeedback(error.message || '连接中断，请重新打开插件。', true);
    connectionFeedbackVisible = true;
  } finally {
    refreshPending = false;
    drainRefresh();
  }
}

async function mutate(message, successMessage) {
  if (busy || !connected) return;
  stateRevision += 1;
  setBusy(true);
  feedback.hidden = true;
  try {
    const nextState = await request(message);
    render(nextState, message.type === 'START_TIMER');
    if (successMessage) showFeedback(successMessage);
  } catch (error) {
    // Re-read after a failed operation so the selected radio never claims a mode
    // that the background could not apply.
    try {
      const recoveredState = await request({type:'GET_STATE'});
      connected = true;
      render(recoveredState);
      showFeedback(error.message || '操作未完成，请重试。', true);
    } catch {
      showDisconnected();
      showFeedback(`${error.message || '操作未完成。'} 当前状态暂无法确认，请重新打开插件。`, true);
      connectionFeedbackVisible = true;
    }
  } finally {
    setBusy(false);
    drainRefresh();
  }
}

for (const input of modeInputs) input.addEventListener('change', () => {
  if (input.checked) mutate({type:'SET_MODE', mode:input.value});
});
for (const button of presets) button.addEventListener('click', () => {
  minutesInput.value = button.dataset.minutes;
  syncPresets();
});
minutesInput.addEventListener('input', () => {
  minutesInput.removeAttribute('aria-invalid');
  syncPresets();
});
$('#timer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const minutes = Number(minutesInput.value);
  if (minutesInput.value.trim() === '' || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    minutesInput.setAttribute('aria-invalid', 'true');
    showFeedback('请输入 1～1440 之间的整数分钟。');
    minutesInput.focus();
    return;
  }
  minutesInput.removeAttribute('aria-invalid');
  mutate({type:'START_TIMER',minutes});
});
$('#cancel-timer').addEventListener('click', () => mutate({type:'CANCEL_TIMER'}, '已取消定时，当前运行模式继续保持。'));

if (globalThis.chrome?.runtime?.id) {
  refreshState(true);
  // Read the actual binding: another extension may already own the suggested key.
  chrome.commands?.getAll().then((commands) => {
    const shortcut = commands.find((command) => command.name === 'toggle-keep-awake')?.shortcut;
    $('#shortcut').textContent = shortcut || '未设置快捷键';
  }).catch(() => { $('#shortcut').textContent = '快捷键可设置'; });
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.alwaylightState) refreshState();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshState(); });
  setInterval(updateCountdown, 1000);
} else {
  app.setAttribute('aria-busy', 'false');
  $('#status-label').textContent = '待安装';
  $('#hero-description').textContent = '安装后，点击 Chrome 工具栏图标即可使用。';
  showFeedback('请在 Chrome 的扩展程序中加载 AlwayLight 文件夹。普通网页无法控制屏幕常亮。', true);
}
