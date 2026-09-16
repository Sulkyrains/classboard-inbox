import {useEffect,useState} from 'react';
import {BellRing, BellOff, Send, Download, RefreshCw, Sun, Moon, PackageOpen} from 'lucide-react';
import {api} from './api';
import {envKind,guideFor,type EnvKind} from './install-guide';
import {isApp,isIOS} from './ua';

interface InstallPrompt extends Event {prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>}
let prompt:InstallPrompt|null=null;
let updateReady=false;
const changed=()=>window.dispatchEvent(new Event('pwa-state'));
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();prompt=e as InstallPrompt;changed();});
window.addEventListener('appinstalled',()=>{prompt=null;changed();});
if('serviceWorker' in navigator&&import.meta.env.PROD){
  let controlled=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(controlled){updateReady=true;changed();}controlled=true;});
  window.addEventListener('load',()=>{
    void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(registration=>{
      const check=()=>{if(document.visibilityState==='visible')void registration.update().catch(()=>{});};
      window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
    }).catch(()=>{});
  });
}
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator & {standalone?:boolean}).standalone===true;
export function InstallApp(){
  const [kind]=useState(envKind);
  const [installed,setInstalled]=useState(standalone),[hint,setHint]=useState(()=>kind==='ios'||kind==='wechat'),[busy,setBusy]=useState(false);
  useEffect(()=>{const update=()=>{setInstalled(standalone());};const installedNow=()=>setInstalled(true);window.addEventListener('pwa-state',update);window.addEventListener('appinstalled',installedNow);return()=>{window.removeEventListener('pwa-state',update);window.removeEventListener('appinstalled',installedNow);};},[]);
  if(installed||isApp())return null;
  const install=async()=>{if(!prompt){setHint(v=>!v);return;}setBusy(true);const current=prompt;prompt=null;try{await current.prompt();const choice=await current.userChoice;if(choice.outcome==='accepted')setInstalled(true);}catch{setHint(true);}finally{setBusy(false);}};
  const label=kind==='wechat'?'如何安装到桌面':kind==='ios'?'安装到 iPhone 桌面':'添加到手机桌面';
  const apk=kind==='android'||kind==='desktop';
  return <div className="install-app">{hint&&guideFor(kind)}<button type="button" className="install-button" onClick={()=>void install()} disabled={busy}><Download size={16}/>{busy?'正在打开安装提示…':hint?'收起指引':label}</button>{apk&&<a className="install-button" href="/classboard.apk" download="知会.apk"><PackageOpen size={16}/>下载安卓 App 安装包（独立运行，无需浏览器）</a>}</div>;
}
export function AppUpdate(){
  const [ready,setReady]=useState(updateReady);
  useEffect(()=>{const update=()=>setReady(updateReady);window.addEventListener('pwa-state',update);return()=>window.removeEventListener('pwa-state',update);},[]);
  return ready?<div className="app-update" role="status"><span>新版已就绪，请先保存正在编辑的内容。</span><button type="button" onClick={()=>location.reload()}><RefreshCw size={15}/>刷新更新</button></div>:null;
}
export function ThemeToggle(){
  const [dark,setDark]=useState(()=>document.documentElement.dataset.theme==='dark');
  const toggle=()=>{
    const next=!dark;setDark(next);
    document.documentElement.dataset.theme=next?'dark':'';
    document.documentElement.style.colorScheme=next?'dark':'light';
    localStorage.setItem('cb-theme',next?'dark':'light');
  };
  return <button type="button" className="icon-button theme-toggle" aria-label={dark?'切换到浅色模式':'切换到深色模式'} title={dark?'切换到浅色模式':'切换到深色模式'} onClick={toggle}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button>;
}
type PushState='busy'|'unsupported'|'ios-standalone'|'denied'|'off'|'on';
function urlBase64ToUint8Array(value:string){
  const norm=value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=');
  const raw=atob(norm);const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}
export function PushToggle(){
  const [state,setState]=useState<PushState>('busy');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const init=async()=>{
      if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)||!('PushMessageData' in window)){setState('unsupported');return;}
      if(isIOS()&&!(window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator & {standalone?:boolean}).standalone===true)){setState('ios-standalone');return;}
      if(Notification.permission==='denied'){setState('denied');return;}
      const reg=await navigator.serviceWorker.getRegistration();
      const sub=reg?await reg.pushManager.getSubscription():null;
      setState(sub?'on':'off');
    };
    void init().catch(()=>setState('unsupported'));
  },[]);
  const enable=async()=>{
    setBusy(true);setError('');
    try{
      const permission=await Notification.requestPermission();
      if(permission==='denied'){setState('denied');return;}
      const reg=await navigator.serviceWorker.ready;
      const info=await api<{publicKey:string|null,enabled:boolean}>('/account/push');
      if(!info.enabled||!info.publicKey)throw new Error('推送服务尚未配置，请联系网站维护者');
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(info.publicKey)});
      const keys=sub.toJSON().keys as {p256dh?:string;auth?:string};
      await api('/account/push/subscribe',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint,keys:{p256dh:keys.p256dh,auth:keys.auth}})});
      setState('on');
    }catch(e){setError((e as Error).message);setState('off');}finally{setBusy(false);}
  };
  const disable=async()=>{
    setBusy(true);setError('');
    try{
      const reg=await navigator.serviceWorker.getRegistration();
      const sub=reg?await reg.pushManager.getSubscription():null;
      if(sub){await api('/account/push/subscribe',{method:'DELETE',body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe();}
      setState('off');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const test=async()=>{setBusy(true);setError('');try{await api('/account/push/test',{method:'POST',body:'{}'});}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const hint=state==='ios-standalone'?<p className="field-hint">iPhone 上需先用 Safari「添加到主屏幕」，再从桌面打开本站即可开启推送。</p>:state==='denied'?<p className="field-hint">通知权限已被拒绝，请在浏览器设置的站点权限中重新允许。</p>:state==='unsupported'?<p className="field-hint">{envKind()==='wechat'?'微信/QQ 内置浏览器不支持推送，请点右上角「···」用系统浏览器打开本站。':'当前浏览器不支持推送通知，可继续使用网页查看通知。'}</p>:null;
  if(isApp())return null;
  if(state==='busy'||state==='unsupported'||state==='ios-standalone'||state==='denied')return <div className="install-app">{hint}</div>;
  return <div className="install-app">{state==='on'?<><button type="button" className="install-button" onClick={()=>void disable()} disabled={busy}><BellOff size={16}/>{busy?'正在关闭…':'关闭手机推送'}</button><button type="button" className="install-button" onClick={()=>void test()} disabled={busy}><Send size={16}/>{busy?'…':'发送测试推送'}</button></>:<button type="button" className="install-button" onClick={()=>void enable()} disabled={busy}><BellRing size={16}/>{busy?'正在开启…':'开启新通知推送'}</button>}
    {error&&<p className="field-hint" role="alert">{error}</p>}
    {state==='on'&&<p className="field-hint">开启后，班委发布新通知会推送到这台设备。</p>}
  </div>;
}
