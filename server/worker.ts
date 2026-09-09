import { categories, type Admin, type NoticeInput } from '../src/shared/types';
import { derive, equal, sha256 } from './auth';

export interface Env { DB: D1Database; ASSETS: Fetcher }
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new HttpError(status,message); }
const json = (body: unknown, status=200, headers: Record<string,string>={}) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});

async function readBody(request: Request): Promise<Record<string,unknown>> {
  if(!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415,'请使用 JSON 格式');
  const reader=request.body?.getReader(); if(!reader) return {};
  const chunks: Uint8Array[]=[]; let size=0;
  for(;;){const {value,done}=await reader.read(); if(done)break; size+=value.byteLength; if(size>100000){await reader.cancel();fail(413,'内容过长，请分批导入');} chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength;}
  try { const value=JSON.parse(new TextDecoder().decode(all)); if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'格式错误'); return value; } catch{ return fail(400,'内容格式不正确'); }
}
function requireOrigin(request: Request) {
  const origin=request.headers.get('Origin'); const url=new URL(request.url);
  const loopback=['127.0.0.1','localhost'];
  const local=loopback.includes(url.hostname)&&origin&&loopback.includes(new URL(origin).hostname);
  if(origin!==url.origin&&!local)fail(403,'请求来源不被允许');
}
async function session(request: Request, db: D1Database): Promise<Admin|null> {
  const id=request.headers.get('Cookie')?.match(/(?:^|;\s*)cb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!id)return null;
  return db.prepare('SELECT a.id,a.username,a.display_name FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id_hash=? AND s.expires_at>?').bind(await sha256(id),Date.now()).first<Admin>();
}
function cookie(request: Request, value: string, age: number) {
  return `cb_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
function field(value: unknown, name: string, limit: number, required=false) {
  if(typeof value!=='string') { if(!required&&value==null)return ''; return fail(400,`${name}格式不正确`); }
  const s=value.trim(); if((required&&!s)||s.length>limit)fail(400,`${name}${required?'不能为空，且':''}最多 ${limit} 字`); return s;
}
function dateField(value: unknown): string|null {
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return fail(400,'日期格式不正确');
  return new Date(value).toISOString();
}
function validate(body: Record<string,unknown>): NoticeInput {
  if(!categories.includes(body.category as any))fail(400,'请选择有效分类');
  if(body.pinned!==undefined&&typeof body.pinned!=='boolean')fail(400,'置顶设置不正确');
  return { title:field(body.title,'标题',100,true),body:field(body.body,'正文',10000,true),category:body.category as NoticeInput['category'],
    location:field(body.location,'地点',200),audience:field(body.audience,'通知对象',300),
    event_at:dateField(body.event_at),deadline_at:dateField(body.deadline_at),pinned:body.pinned===true };
}
function mapNotice(row: Record<string,unknown>, privateFields=false) {
  const { source_text,source_hash,warnings,author_id,reviewed_by,...publicRow }=row;
  return {...publicRow,pinned:!!row.pinned,...(privateFields?{source_text,warnings:JSON.parse(String(warnings||'[]'))}:{})};
}
async function route(request: Request, env: Env): Promise<Response> {
  const url=new URL(request.url), path=url.pathname, method=request.method;
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
  if(!env.DB)return json({error:'数据库尚未配置'},503);
  if(!['GET','HEAD'].includes(method))requireOrigin(request);
  if(path==='/api/health')return json({ok:true,stage:'M1'});
  if(path==='/api/session'&&method==='GET')return json({admin:await session(request,env.DB)});
  if(path==='/api/login'&&method==='POST'){
    const body=await readBody(request);
    const username=field(body.username,'账号',64,true).toLowerCase();
    const secret=field(body.password,'密码',256,true);
    const now=Date.now();
    const bucket=await sha256(`${request.headers.get('CF-Connecting-IP')||'local'}:${username}`);
    const ipBucket=await sha256(`ip:${request.headers.get('CF-Connecting-IP')||'local'}`);
    const countSql='INSERT INTO login_attempts(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts';
    const counters=await env.DB.batch<{attempts:number}>([env.DB.prepare(countSql).bind(bucket,now+900000,now,now),env.DB.prepare(countSql).bind(ipBucket,now+900000,now,now)]);
    if(Number(counters[0].results[0]?.attempts)>8||Number(counters[1].results[0]?.attempts)>40)return json({error:'尝试次数过多，请在 15 分钟后重试'},429,{'Retry-After':'900'});
    const row=await env.DB.prepare('SELECT * FROM admins WHERE username=?').bind(username).first<{id:string;username:string;display_name:string;salt:string;digest:string}>();
    const digest=await derive(secret,row?.salt||'unregistered-account');
    if(!row||!equal(digest,row.digest))fail(401,'账号或密码不正确');
    const id=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sessions(id_hash,admin_id,expires_at) VALUES(?,?,?)').bind(await sha256(id),row.id,now+28800000),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),
      env.DB.prepare('DELETE FROM login_attempts WHERE bucket=? OR expires_at<?').bind(bucket,now)
    ]);
    return json({admin:{id:row.id,username:row.username,display_name:row.display_name}},200,{'Set-Cookie':cookie(request,id,28800)});
  }
  if(path==='/api/logout'&&method==='POST'){
    const id=request.headers.get('Cookie')?.match(/(?:^|;\s*)cb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(id)await env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await sha256(id)).run();
    return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
  }
  if(path==='/api/notices'&&method==='GET'){
    const clauses=["status='published'"],args: string[]=[];
    const category=url.searchParams.get('category'),q=url.searchParams.get('q');
    if(category&&categories.includes(category as any)){clauses.push('category=?');args.push(category);}
    if(q){clauses.push('(title LIKE ? OR body LIKE ?)');args.push(`%${q.slice(0,100)}%`,`%${q.slice(0,100)}%`);}
    const result=await env.DB.prepare(`SELECT * FROM notices WHERE ${clauses.join(' AND ')} ORDER BY pinned DESC,published_at DESC LIMIT 500`).bind(...args).all();
    return json({notices:result.results.map(r=>mapNotice(r))});
  }
  const publicDetail=path.match(/^\/api\/notices\/([\w-]+)$/);
  if(publicDetail&&method==='GET'){
    const row=await env.DB.prepare("SELECT * FROM notices WHERE id=? AND status='published'").bind(publicDetail[1]).first();
    return row?json({notice:mapNotice(row)}):json({error:'通知不存在或尚未发布'},404);
  }
  if(!path.startsWith('/api/admin/'))return json({error:'接口不存在'},404);
  const admin=await session(request,env.DB); if(!admin)fail(401,'请先以班委身份登录');
  if(path==='/api/admin/notices'&&method==='GET'){
    const result=await env.DB.prepare('SELECT * FROM notices ORDER BY created_at DESC LIMIT 500').all();
    return json({notices:result.results.map(r=>mapNotice(r,true))});
  }
  if(path==='/api/admin/notices'&&method==='POST'){
    const body=await readBody(request),n=validate(body),id=crypto.randomUUID(),now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notices(id,title,body,category,location,audience,event_at,deadline_at,pinned,status,author_id,author_name,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?)").bind(id,n.title,n.body,n.category,n.location,n.audience,n.event_at,n.deadline_at,+n.pinned,admin.id,admin.display_name,now,now,now),
      env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,admin.display_name,'发布',now)
    ]);
    return json({id},201);
  }
  const edit=path.match(/^\/api\/admin\/notices\/([\w-]+)$/);
  if(edit&&method==='PUT'){
    const body=await readBody(request),n=validate(body),now=new Date().toISOString();
    if(!Number.isInteger(body.version))fail(400,'缺少通知版本');
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE notices SET title=?,body=?,category=?,location=?,audience=?,event_at=?,deadline_at=?,pinned=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status IN ('pending','published')").bind(n.title,n.body,n.category,n.location,n.audience,n.event_at,n.deadline_at,+n.pinned,now,edit[1],body.version as number),
      env.DB.prepare('INSERT INTO audit_log SELECT ?,id,?,?,? FROM notices WHERE id=? AND version=? AND updated_at=?').bind(crypto.randomUUID(),admin.display_name,'编辑',now,edit[1],Number(body.version)+1,now)
    ]);
    if(!result[0].meta.changes)fail(409,'通知已被更新或已归档，请刷新后重试');
    return json({ok:true});
  }
  const action=path.match(/^\/api\/admin\/notices\/([\w-]+)\/(publish|reject|archive)$/);
  if(action&&method==='POST'){
    const body=await readBody(request),now=new Date().toISOString();
    if(!Number.isInteger(body.version))fail(400,'缺少通知版本');
    const status=action[2]==='publish'?'published':action[2]==='reject'?'rejected':'archived';
    const old=action[2]==='archive'?'published':'pending';
    const label=action[2]==='publish'?'审核通过':action[2]==='reject'?'驳回':'归档';
    const results=await env.DB.batch([
      env.DB.prepare('UPDATE notices SET status=?,reviewed_by=?,reviewed_at=?,published_at=CASE WHEN ?=\'published\' THEN ? ELSE published_at END,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=?').bind(status,admin.id,now,status,now,now,action[1],body.version as number,old),
      env.DB.prepare('INSERT INTO audit_log SELECT ?,id,?,?,? FROM notices WHERE id=? AND version=? AND updated_at=?').bind(crypto.randomUUID(),admin.display_name,label,now,action[1],Number(body.version)+1,now)
    ]);
    if(!results[0].meta.changes)fail(409,'通知状态已变化，请刷新后重试');
    return json({ok:true});
  }
  return json({error:'接口不存在'},404);
}
export default {
  async fetch(request: Request,env: Env): Promise<Response> {
    try{return await route(request,env);}catch(error){
      if(error instanceof HttpError)return json({error:error.message},error.status);
      // Never log request bodies, database contents, session values or credentials.
      return json({error:'服务暂时不可用，请稍后重试'},500);
    }
  }
};
