import { useState,type FormEvent } from 'react';
import { categories,type NoticeInput } from '../shared/types';
import { fromInputDate,toInputDate } from '../shared/dates';
export function NoticeForm({initial,onSave,onCancel,label='发布通知'}:{initial:NoticeInput;onSave:(n:NoticeInput)=>Promise<void>;onCancel:()=>void;label?:string}){
  const [n,set]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async(e:FormEvent)=>{e.preventDefault();setError('');setBusy(true);try{await onSave(n);}catch(err){setError((err as Error).message);}finally{setBusy(false);}};
  return <form className="notice-form" onSubmit={submit}>
    <label>通知标题 <span>*</span><input required maxLength={100} value={n.title} onChange={e=>set({...n,title:e.target.value})} placeholder="用一句话说清这件事"/></label>
    <div className="form-grid"><label>分类<select value={n.category} onChange={e=>set({...n,category:e.target.value as NoticeInput['category']})}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>通知对象<input maxLength={300} value={n.audience} onChange={e=>set({...n,audience:e.target.value})} placeholder="例如：全体同学"/></label></div>
    <label>正文 <span>*</span><textarea required maxLength={10000} rows={5} value={n.body} onChange={e=>set({...n,body:e.target.value})} placeholder="补充安排、要求与提交方式…（支持 Markdown：标题、列表、链接、代码）"/></label>
    <label>地点<input maxLength={200} value={n.location} onChange={e=>set({...n,location:e.target.value})} placeholder="例如：教三 201 / 学习通"/></label>
    <div className="form-grid"><label>活动 / 上课时间<input type="datetime-local" value={toInputDate(n.event_at)} onChange={e=>set({...n,event_at:fromInputDate(e.target.value)})}/></label><label>截止时间<input type="datetime-local" value={toInputDate(n.deadline_at)} onChange={e=>set({...n,deadline_at:fromInputDate(e.target.value)})}/></label></div>
    <p className="field-hint">时间均为北京时间。没有明确时间的通知可以留空。</p>
    <label className="check-row"><input type="checkbox" checked={n.pinned} onChange={e=>set({...n,pinned:e.target.checked})}/>置顶这条通知</label>
    {error&&<p className="error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onCancel}>取消</button><button className="button primary" disabled={busy}>{busy?'正在保存…':label}</button></div>
  </form>;
}
