import {useEffect,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';

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
  const [installed,setInstalled]=useState(standalone),[hint,setHint]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{const update=()=>{setInstalled(standalone());};const installedNow=()=>setInstalled(true);window.addEventListener('pwa-state',update);window.addEventListener('appinstalled',installedNow);return()=>{window.removeEventListener('pwa-state',update);window.removeEventListener('appinstalled',installedNow);};},[]);
  if(installed)return null;
  const install=async()=>{if(!prompt){setHint(v=>!v);return;}setBusy(true);const current=prompt;prompt=null;try{await current.prompt();const choice=await current.userChoice;if(choice.outcome==='accepted')setInstalled(true);}catch{setHint(true);}finally{setBusy(false);}};
  return <div className="install-app"><button type="button" className="install-button" onClick={()=>void install()} disabled={busy}><Download size={16}/>{busy?'正在打开安装提示…':'添加到手机桌面'}</button>{hint&&<div className="install-guide" role="status"><p><strong>安卓：</strong>用 Chrome 或 Edge 打开本站，在浏览器菜单选择「安装应用」或「添加到主屏幕」。</p><p><strong>iPhone：</strong>用 Safari 打开本站，点击「分享」→「添加到主屏幕」。</p><p>从桌面打开即可使用；联网重新打开会获取网站最新版。</p></div>}</div>;
}
export function AppUpdate(){
  const [ready,setReady]=useState(updateReady);
  useEffect(()=>{const update=()=>setReady(updateReady);window.addEventListener('pwa-state',update);return()=>window.removeEventListener('pwa-state',update);},[]);
  return ready?<div className="app-update" role="status"><span>新版已就绪，请先保存正在编辑的内容。</span><button type="button" onClick={()=>location.reload()}><RefreshCw size={15}/>刷新更新</button></div>:null;
}
