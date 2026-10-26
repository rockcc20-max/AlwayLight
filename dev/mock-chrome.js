// Development-only adapter. The packager explicitly excludes this directory.
// It mirrors the background message contract and never calls a power API.
(() => {
  const key = 'alwaylight-preview';
  const listeners = [];
  let state = JSON.parse(sessionStorage.getItem(key) || 'null') || {mode:'default',timerEndsAt:null,timerMinutes:60,startedAt:null};
  const save = () => {sessionStorage.setItem(key,JSON.stringify(state));for(const fn of listeners) fn({alwaylightState:{newValue:{...state}}},'local');};
  const api = {
    runtime:{id:'alwaylight-development-preview',async sendMessage(message){
      if(state.timerEndsAt && state.timerEndsAt <= Date.now()) {state={...state,mode:'default',timerEndsAt:null,startedAt:null};save();}
      if(message.type === 'SET_MODE') {state={...state,mode:message.mode,timerEndsAt:null,startedAt:message.mode==='default'?null:Date.now()};save();}
      if(message.type === 'START_TIMER') {if(state.mode==='default')return{ok:false,error:'请先选择保持运行的模式。'};state={...state,timerMinutes:message.minutes,timerEndsAt:Date.now()+message.minutes*60000};save();}
      if(message.type === 'CANCEL_TIMER') {state={...state,timerEndsAt:null};save();}
      return{ok:true,state:{...state}};
    }},
    storage:{onChanged:{addListener(fn){listeners.push(fn);}}},
    commands:{async getAll(){return[{name:'toggle-keep-awake',shortcut:'⌘ ⇧ Y'}];}}
  };
  // Chromium may define a partial `chrome` global on ordinary web pages.
  Object.defineProperty(globalThis,'chrome',{value:api,configurable:true});
})();
