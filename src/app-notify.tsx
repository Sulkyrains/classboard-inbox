import {useEffect,useState} from 'react';
import {AlertTriangle,BatteryCharging,BellRing,CheckCircle2,RefreshCw,Rocket,Send} from 'lucide-react';
import {isApp} from './ua';

interface AppStatus{version:string;login:boolean;permission:boolean;enabled:boolean;ignoring:boolean;keepAlive:boolean;lastAt:number;lastResult:string;lastNew:number;lastSource:string;job:boolean;alarm:boolean;}

function read():AppStatus|null{
  try{const raw=window.AndroidApp?.notifyStatus?.();return raw?JSON.parse(raw) as AppStatus:null;}catch{return null;}
}
function when(at:number){
  if(!at)return '还没有检查过';
  const minutes=Math.max(0,Math.round((Date.now()-at)/60000));
  return minutes<1?'刚刚':minutes<60?`${minutes} 分钟前`:`${Math.round(minutes/60)} 小时前`;
}
function outcome(s:AppStatus){
  if(s.lastResult==='ok')return s.lastNew>0?`成功，提醒了 ${s.lastNew} 条新通知`:'成功，没有新通知';
  if(s.lastResult==='nologin')return '未登录，无法检查';
  if(s.lastResult==='network')return '网络不通，检查失败';
  return '还没有检查过';
}

/** App 内专用：手机通知自检。国产系统默认会冻结后台进程，这里让用户能一眼看到卡在哪一步。 */
export function AppNotifyCheck(){
  const [status,setStatus]=useState<AppStatus|null>(read);
  const [open,setOpen]=useState(()=>{const s=read();return !s||!s.permission||!s.enabled||!s.login||!(s.ignoring||s.keepAlive);});
  const [note,setNote]=useState('');
  useEffect(()=>{if(!isApp())return;const timer=window.setInterval(()=>setStatus(read()),3000);return()=>window.clearInterval(timer);},[]);
  if(!isApp()||!window.AndroidApp?.notifyStatus)return null;
  const call=(fn:()=>void,message='')=>{try{fn();}catch{}if(message){setNote(message);window.setTimeout(()=>setNote(''),4000);}};
  const rows:Array<[boolean,string,string]>=[
    [!!status?.permission&&!!status?.enabled,'通知权限',status?.permission&&status?.enabled?'已允许':'被系统关闭，去手机设置里打开'],
    [!!status?.login,'登录状态',status?.login?'已登录':'已退出，请重新登录'],
    [!!status?.ignoring,'电池优化',status?.ignoring?'已豁免，后台不会被冻结':'未豁免，关掉 App 后可能收不到'],
    [!!status?.keepAlive,'后台常驻',status?.keepAlive?'已开启':'已关闭'],
    [!!(status?.job||status?.alarm),'后台唤醒',(status?.job||status?.alarm)?'已注册':'未注册，重启手机可自动恢复'],
  ];
  const healthy=rows.every(([ok])=>ok);
  return <div className="notify-check">
    <div className="notify-check-head">
      <strong>{healthy?<CheckCircle2 size={15}/>:<AlertTriangle size={15}/>}手机通知自检</strong>
      <span className={healthy?'notify-pill ok':'notify-pill warn'}>{healthy?'一切正常':'有待处理'}</span>
      <button type="button" className="text-link" onClick={()=>setOpen(v=>!v)}>{open?'收起':'展开'}</button>
    </div>
    {open&&<>
      <ul className="notify-rows">{rows.map(([ok,label,text])=><li key={label} className={ok?'ok':'warn'}><span>{label}</span><em>{text}</em></li>)}</ul>
      <p className="field-hint">上次检查：{when(status?.lastAt??0)}（{status?outcome(status):''}）</p>
    </>}
    <div className="notify-actions">
      <button type="button" className="install-button" onClick={()=>call(()=>window.AndroidApp?.checkNow?.(),'正在检查新通知…')}><RefreshCw size={15}/>立即检查</button>
      <button type="button" className="install-button" onClick={()=>call(()=>window.AndroidApp?.testNotification?.(),'已发送测试通知，看看有没有横幅')}><Send size={15}/>发送测试通知</button>
      {!status?.ignoring&&<button type="button" className="install-button" onClick={()=>call(()=>window.AndroidApp?.openBatterySettings?.())}><BatteryCharging size={15}/>关闭电池优化</button>}
      <button type="button" className="install-button" onClick={()=>call(()=>window.AndroidApp?.setKeepAlive?.(!status?.keepAlive),status?.keepAlive?'已关闭后台常驻':'已开启后台常驻')}><BellRing size={15}/>{status?.keepAlive?'关闭后台常驻':'开启后台常驻'}</button>
      <button type="button" className="install-button" onClick={()=>call(()=>window.AndroidApp?.openAutoStart?.())}><Rocket size={15}/>自启动设置</button>
    </div>
    {note&&<p className="field-hint" role="status">{note}</p>}
    {status?.keepAlive&&<p className="field-hint">后台常驻会在通知栏留一条「知可而办正在后台接收通知」，不想看到就在上面关掉。</p>}
  </div>;
}
