import { useEffect,useMemo,useState } from 'react';
import { CheckCheck,Copy,History,KeyRound,PowerOff,RefreshCw,Search,UserCog,X } from 'lucide-react';
import { api } from '../api';
import { Modal } from './Modal';
import { formatDate } from '../shared/dates';
import type { AccountLogEntry,AccountRow } from '../shared/accounts';

type Filter='all'|'pending'|'active'|'committee';
const FILTERS:[Filter,string][]=[['all','全部'],['pending','待激活'],['active','已激活'],['committee','班委']];
/** 账号管理页（仅班长）：看激活进度与使用情况，重置密码、让设备下线。服务端同样校验职位。 */
export function AccountAdmin(){
  const [rows,setRows]=useState<AccountRow[]>([]),[log,setLog]=useState<AccountLogEntry[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[hint,setHint]=useState('');
  const [filter,setFilter]=useState<Filter>('all'),[query,setQuery]=useState('');
  const [target,setTarget]=useState<AccountRow|null>(null),[kick,setKick]=useState<AccountRow|null>(null);
  const [secret,setSecret]=useState(''),[busy,setBusy]=useState(false);
  const load=()=>{setError('');setLoading(true);api<{accounts:AccountRow[];log:AccountLogEntry[]}>('/admin/accounts').then(r=>{setRows(r.accounts);setLog(r.log);}).catch(e=>setError((e as Error).message)).finally(()=>setLoading(false));};
  useEffect(()=>{load();},[]);
  useEffect(()=>{if(!hint)return;const t=setTimeout(()=>setHint(''),5000);return()=>clearTimeout(t);},[hint]);
  const pending=rows.filter(r=>r.must_change_password);
  const shown=useMemo(()=>{
    const keyword=query.trim().toLowerCase();
    return rows.filter(r=>(filter==='all'||(filter==='pending'&&r.must_change_password)||(filter==='active'&&!r.must_change_password)||(filter==='committee'&&r.role==='committee'))
      &&(!keyword||`${r.display_name} ${r.student_id} ${r.position||''}`.toLowerCase().includes(keyword)));
  },[rows,filter,query]);
  const copy=async(text:string)=>{
    try{await navigator.clipboard.writeText(text);setHint('已复制到剪贴板。');}
    catch{setHint('这个浏览器不允许自动复制，请手动选中后复制。');}
  };
  const resetPassword=async()=>{
    if(!target)return;
    setBusy(true);
    try{
      const r=await api<{password:string;devices:number}>(`/admin/accounts/${target.id}/reset-password`,{method:'POST',body:'{}'});
      setSecret(r.password);
      setHint(r.devices?`已重置，并让 ${r.devices} 个在线设备退出登录。`:'已重置密码。');
      void load();
    }catch(e){setHint((e as Error).message);setTarget(null);}
    finally{setBusy(false);}
  };
  const closeSecret=()=>{setSecret('');setTarget(null);};
  const kickOut=async()=>{
    if(!kick)return;
    setBusy(true);
    try{
      const r=await api<{revoked:number}>(`/admin/accounts/${kick.id}/logout-all`,{method:'POST',body:'{}'});
      setHint(r.revoked?`已让「${kick.display_name}」在 ${r.revoked} 个设备上退出登录。`:`「${kick.display_name}」本来就没有在线设备。`);
      setKick(null);
      void load();
    }catch(e){setHint((e as Error).message);setKick(null);}
    finally{setBusy(false);}
  };
  return <>
    <section className="notices-section">
      <div className="section-heading"><h2><UserCog size={21}/>账号管理{!loading&&!error&&<span className="number-badge">{rows.length}</span>}</h2><button type="button" className="icon-button" aria-label="刷新账号列表" onClick={load}><RefreshCw size={17}/></button></div>
      <p className="log-hint">只有班长能看到这一页。重置密码只显示一次，请私聊发给本人；密码不会留在网页或记录里。</p>
      {hint&&<p className="account-hint" role="status">{hint}</p>}
      <div className="account-stats">
        <div><span>已激活</span><strong>{rows.length-pending.length}<small> / {rows.length} 人</small></strong></div>
        <div><span>待激活</span><strong className={pending.length?'pending':''}>{pending.length}<small> 人</small></strong></div>
        <div><span>班委</span><strong>{rows.filter(r=>r.role==='committee').length}<small> 人</small></strong></div>
        <div><span>在线设备</span><strong>{rows.reduce((sum,r)=>sum+r.sessions,0)}<small> 台</small></strong></div>
      </div>
      <div className="filters account-filters">
        <div className="category-tabs">{FILTERS.map(([id,label])=><button key={id} className={filter===id?'active':''} onClick={()=>setFilter(id)}>{label}</button>)}</div>
        {pending.length>0&&<button type="button" className="text-link" onClick={()=>void copy(pending.map(r=>`${r.display_name} ${r.student_id}`).join('\n'))}>复制未激活名单<Copy size={14}/></button>}
      </div>
      <label className="search"><Search size={17}/><input aria-label="搜索账号" placeholder="搜索姓名、学号或职位…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="清空搜索" onClick={()=>setQuery('')}><X size={15}/></button>}</label>
      {loading?<div className="loading-state" role="status"><RefreshCw size={22} className="spin"/>正在读取账号…</div>
        :error?<div className="error error-banner" role="alert">{error}<button type="button" onClick={load}><RefreshCw size={15}/>重试</button></div>
        :shown.length?<div className="account-list">{shown.map(r=><article className={`account-row ${r.must_change_password?'is-pending':''}`} key={r.id}>
          <span className={`account-avatar ${r.role}`}>{r.role==='committee'?'委':'同'}</span>
          <div className="account-identity"><strong>{r.display_name}{r.position&&<em>{r.position}</em>}</strong><span>{r.student_id}</span></div>
          <span className={`account-state ${r.must_change_password?'pending':'active'}`}>{r.must_change_password?'待激活':'已激活'}</span>
          <div className="account-meta">
            <span>{r.last_login_at?`最后登录 ${formatDate(r.last_login_at,true)}`:'从未登录'}</span>
            <span>{r.sessions} 台设备</span>
            {r.push_subs>0&&<span>推送 {r.push_subs}</span>}
            {r.has_calendar&&<span>日历已订阅</span>}
            {r.reads>0&&<span>已读 {r.reads}</span>}
          </div>
          <div className="account-actions">
            <button type="button" onClick={()=>{setSecret('');setTarget(r);}}><KeyRound size={14}/>重置密码</button>
            <button type="button" disabled={!r.sessions} title={r.sessions?'':'该账号当前没有在线设备'} onClick={()=>setKick(r)}><PowerOff size={14}/>强制下线</button>
          </div>
        </article>)}</div>
        :<div className="empty"><div><UserCog size={30}/></div><h3>{query||filter!=='all'?'没有匹配的账号':'还没有账号'}</h3><p>调整筛选条件，或稍后再来看看。</p></div>}
    </section>
    <section className="notices-section">
      <div className="section-heading"><h2><History size={21}/>账号操作记录{log.length>0&&<span className="number-badge">{log.length}</span>}</h2></div>
      <p className="log-hint">只记动作与时间，不记密码内容。</p>
      {log.length?<div className="op-log">{log.map(op=><article className="op-row" key={op.id}><span className={`op-badge ${op.action==='重置密码'?'warn':'muted'}`}>{op.action}</span><div className="op-main"><strong>{op.account_label}</strong><span>{op.actor_position?`${op.actor_position} · `:''}{op.actor_name}{op.detail?` · ${op.detail}`:''}</span></div><time>{formatDate(op.created_at,true)}</time></article>)}</div>
        :<div className="empty"><div><History size={30}/></div><h3>还没有账号操作</h3><p>重置密码或强制下线之后，这里会留下记录。</p></div>}
    </section>
    {target&&!secret&&<Modal title="重置密码" onClose={()=>setTarget(null)}><div className="detail-content"><p>「{target.display_name}（{target.student_id}）」</p><p className="muted">将生成一个新的随机临时密码，并把该账号设为「需首次改密」；{target.sessions?`此人在 ${target.sessions} 台设备上的登录会立即失效，`:'该账号当前没有在线设备，'}已读记录保留。密码只显示这一次，请私聊发给本人，不要发到群里。</p><div className="modal-actions"><button className="button secondary" onClick={()=>setTarget(null)}>取消</button><button className="button primary" disabled={busy} onClick={()=>void resetPassword()}>{busy?'正在重置…':'生成新密码'}</button></div></div></Modal>}
    {target&&secret&&<Modal title="临时密码（只显示这一次）" onClose={closeSecret}><div className="detail-content"><p>请现在复制并私聊发给 <strong>{target.display_name}</strong>（{target.student_id}）。对方用这个密码登录后，系统会要求改成自己的密码。</p><div className="secret-box"><code>{secret}</code><button type="button" className="button secondary" onClick={()=>void copy(secret)}><Copy size={15}/>复制</button></div><p className="muted">关掉这个窗口就查不到了；如果没发出去，可以再重置一次。</p><div className="modal-actions"><button className="button primary" onClick={closeSecret}><CheckCheck size={16}/>我已发给他</button></div></div></Modal>}
    {kick&&<Modal title="强制下线" onClose={()=>setKick(null)}><div className="detail-content"><p>「{kick.display_name}（{kick.student_id}）」</p><p className="muted">该账号在 {kick.sessions} 台设备上的登录会立即失效，本人需要用原密码重新登录；密码不变，已读记录保留。适用于手机丢失或账号借给别人用的情况。</p><div className="modal-actions"><button className="button secondary" onClick={()=>setKick(null)}>取消</button><button className="button primary" disabled={busy} onClick={()=>void kickOut()}>{busy?'处理中…':'确认下线'}</button></div></div></Modal>}
  </>;
}
