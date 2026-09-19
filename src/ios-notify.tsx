import {useEffect,useState} from 'react';
import {AlertTriangle,CheckCircle2,RefreshCw} from 'lucide-react';
import {api} from './api';
import {iosPushIssue,iosPushRows,type IosPushState} from './shared/ios-push';
import {isApp,isIOS,isStandalone} from './ua';

async function read():Promise<IosPushState>{
  const capable='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  let local=false,endpoint='';
  try{
    const reg=await navigator.serviceWorker.getRegistration();
    const sub=reg?await reg.pushManager.getSubscription():null;
    local=!!sub;endpoint=sub?.endpoint||'';
  }catch{}
  let server=0,thisDevice=false;
  try{
    const info=await api<{subscriptions?:number;thisDevice?:boolean}>(`/account/push${endpoint?`?endpoint=${encodeURIComponent(endpoint)}`:''}`);
    server=info.subscriptions||0;thisDevice=!!info.thisDevice;
  }catch{}
  return {standalone:isStandalone(),capable,permission:capable?Notification.permission:'unsupported',local,server,thisDevice};
}

/** iPhone 专用：把「主屏幕安装/系统版本/通知权限/订阅登记」逐项列出来，卡在哪一步一眼看到。 */
export function IosPushCheck(){
  const [state,setState]=useState<IosPushState|null>(null);
  const [busy,setBusy]=useState(false);
  const refresh=()=>{setBusy(true);void read().then(setState).finally(()=>setBusy(false));};
  useEffect(()=>{if(isApp()||!isIOS())return;refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')refresh();},15000);return()=>window.clearInterval(timer);},[]);
  if(isApp()||!isIOS())return null;
  return <IosPushCheckView state={state} busy={busy} onRefresh={refresh}/>;
}

export function IosPushCheckView({state,busy,onRefresh}:{state:IosPushState|null;busy:boolean;onRefresh:()=>void}){
  const issue=state?iosPushIssue(state):null;
  const healthy=!!state&&!issue;
  return <div className="notify-check">
    <div className="notify-check-head">
      <strong>{healthy?<CheckCircle2 size={15}/>:<AlertTriangle size={15}/>}iPhone 推送自检</strong>
      {state&&<span className={healthy?'notify-pill ok':'notify-pill warn'}>{healthy?'一切正常':'有待处理'}</span>}
      <button type="button" className="text-link" onClick={onRefresh} disabled={busy}>{busy?'检查中…':'重新检查'}</button>
    </div>
    {state?<ul className="notify-rows">{iosPushRows(state).map(row=><li key={row.label} className={row.ok?'ok':'warn'}><span>{row.label}</span><em>{row.detail}</em></li>)}</ul>:<p className="field-hint">正在检查…</p>}
    {issue&&<p className="notify-alert">{issue}</p>}
    {healthy&&<p className="field-hint">可以让班委发一条测试通知，或在上方点「发送测试推送」亲眼确认一次。</p>}
    <p className="field-hint">小提示：如果开了「专注模式」或把通知设成「定时推送摘要」，横幅可能会被攒起来不弹；关掉 App 也能收到，因为走的是苹果系统推送。</p>
  </div>;
}
