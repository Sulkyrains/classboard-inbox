import { categories, type Admin, type NoticeInput } from '../src/shared/types';
import { canManageNotice } from '../src/shared/roles';
import { hashPassword, sha256, verifyPassword, ITERATIONS } from './auth';
import { parseMessages } from '../src/parser';
import { llmAdapter,type LlmEnv } from './llm';
import { loadVapid,sendPush,type PushPayload } from './push';

export interface Env extends CloudflareBindings,LlmEnv { ASSETS: Fetcher }
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new HttpError(status,message); }
/** 登录状态保留 30 天：App 需要长期保持登录才能在后台收到提醒。 */
const SESSION_MS=30*24*60*60*1000;
const SESSION_SECONDS=SESSION_MS/1000;
/** 登录、改密和测试推送共用同一张限流表：命中同一个桶的请求 15 分钟内累加。 */
const ATTEMPT_SQL='INSERT INTO login_attempts(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts';
const attempt=(db: D1Database, bucket: string, now: number)=>db.prepare(ATTEMPT_SQL).bind(bucket,now+900000,now,now);
/** 只接受真实推送服务：否则同学能让 Worker 向任意地址群发，也能刷满订阅表挤掉别人。 */
const PUSH_HOSTS=['fcm.googleapis.com','android.googleapis.com','push.apple.com','notify.windows.com','push.services.mozilla.com'];
const pushHostAllowed=(host: string)=>PUSH_HOSTS.some(d=>host===d||host.endsWith('.'+d));
const PUSH_PER_USER=5;
/** 挡掉同班同学最容易猜中的几类口令；长度和重复性检查在调用处完成。 */
const WEAK_PASSWORDS=new Set(['123456','1234567','12345678','123456789','1234567890','111111','000000','666666','888888','abc123','abcdef','abcd1234','password','passw0rd','qwerty','qwerty123','asdfgh','zxcvbnm','iloveyou','woaini','woaini1314','5201314','a123456','123123','123321','112233','11223344']);
function weakPassword(value: string, studentId: string) {
  const lower=value.toLowerCase();
  if(WEAK_PASSWORDS.has(lower))return true;
  if(studentId&&lower.includes(studentId.toLowerCase()))return true;
  if(new Set(value).size===1)return true;
  return /^\d+$/.test(value)&&[...value].every((c,i,a)=>!i||Math.abs(+c-+a[i-1])===1);
}
/** 通知列表的缓存标记：读一行版本号就能判断内容有没有变，省掉整表扫描。 */
const bumpFeed=(db: D1Database)=>db.prepare('UPDATE notice_feed SET version=version+1 WHERE id=1');
async function feedTag(db: D1Database, ...scope: (string|null)[]): Promise<string|null> {
  // 迁移还没跑时退回“不做缓存校验”，而不是让整站 500：宁可多扫几次表，也不能打不开。
  const row=await db.prepare('SELECT version FROM notice_feed WHERE id=1').first<{version:number}>().catch(()=>null);
  if(!row)return null;
  return `"${row.version}-${(await sha256(JSON.stringify(scope))).slice(0,16)}"`;
}
const feedHeaders=(etag: string|null): Record<string,string> => etag?{ETag:etag,'Cache-Control':FEED_CACHE}:{};
/** RFC 9110 的 If-None-Match 用弱比较：边缘节点会把 ETag 弱化成 W/"…" 再下发，逐字符比会永远不命中。 */
const ifNoneMatch=(request: Request, tag: string) => {
  const raw=request.headers.get('If-None-Match');
  if(!raw)return false;
  if(raw.trim()==='*')return true;
  return raw.split(',').some(value=>value.trim().replace(/^W\//,'')===tag);
};
// private：只允许浏览器自己缓存，不让 CDN 或中间代理留副本；no-cache：每次都回来校验 ETag，所以通知不会延迟。
const FEED_CACHE='private, no-cache';
/** 命中缓存时不带正文返回，客户端直接复用上一次的列表。 */
const notModified=(etag: string) => new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':FEED_CACHE,'X-Content-Type-Options':'nosniff'}});
const json = (body: unknown, status=200, headers: Record<string,string>={}) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
/** 静态资源的安全头由 public/_headers 下发，但 /api/* 由 Worker 直接返回，必须自己补上。 */
const SECURITY_HEADERS: Record<string,string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
function secure(response: Response): Response {
  const headers=new Headers(response.headers);
  for(const [name,value] of Object.entries(SECURITY_HEADERS))if(!headers.has(name))headers.set(name,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

async function readBody(request: Request): Promise<Record<string,unknown>> {
  if(!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415,'请使用 JSON 格式');
  const reader=request.body?.getReader(); if(!reader) return {};
  const chunks: Uint8Array[]=[]; let size=0;
  for(;;){const {value,done}=await reader.read(); if(done)break; size+=value.byteLength; if(size>100000){await reader.cancel();fail(413,'内容过长，请分批导入');} chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength;}
  const text=new TextDecoder().decode(all); if(!text.trim()) return {};   // 空请求体等同于 {}：标记已读等接口不带正文
  try { const value=JSON.parse(text); if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'格式错误'); return value; } catch{ return fail(400,'内容格式不正确'); }
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
  const user=await db.prepare('SELECT a.id,a.student_id,a.display_name,a.role,a.position,a.must_change_password FROM user_sessions s JOIN users a ON a.id=s.user_id WHERE s.id_hash=? AND s.expires_at>?').bind(await sha256(id),Date.now()).first<Admin>();
  return user?{...user,must_change_password:!!user.must_change_password}:null;
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
/** 权限判断按作者「当前」职位：以后调整职位，历史通知的管理权同步变化。 */
const authorPosition=(db: D1Database, id: string)=>db.prepare('SELECT u.position AS position FROM notices n LEFT JOIN users u ON u.id=n.author_id WHERE n.id=?').bind(id).first<{position:string|null}>();
function pushPayload(notice:{id:string;title:string;category:string;body:string}): PushPayload {
  return { title:`【${notice.category}】${notice.title}`,body:notice.body.replace(/\s+/g,' ').slice(0,140),url:'/',tag:notice.id };
}
function pushAvailable(env: Env) { return !!loadVapid(env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY); }
async function fanOutPush(env: Env, notice:{id:string;title:string;category:string;body:string}) {
  const keys=loadVapid(env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY); if(!keys)return;
  const subject=env.VAPID_SUBJECT||'mailto:classboard-upc@users.noreply.example';
  const subs=await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions ORDER BY created_at LIMIT 1000').all<{endpoint:string;p256dh:string;auth:string}>();
  const payload=pushPayload(notice),stale:string[]=[];
  await Promise.allSettled(subs.results.map(async sub=>{const ok=await sendPush(sub,payload,keys,subject).catch(()=>true);if(!ok)stale.push(sub.endpoint);}));
  if(stale.length)await env.DB.batch(stale.map(endpoint=>env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint)));
}
function deferPush(ctx: ExecutionContext|undefined, env: Env, notice:{id:string;title:string;category:string;body:string}) {
  if(!pushAvailable(env))return;
  ctx?.waitUntil(fanOutPush(env,notice).catch(()=>{}));
}
function icsEscape(value:string){return value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
function icsTime(iso:string){return new Date(iso).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');}
function buildCalendar(notices:Record<string,unknown>[],origin:string):string {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//classboard-upc//CN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:知可而办 · 班级日程','X-WR-TIMEZONE:Asia/Shanghai'];
  for(const n of notices){
    for(const [kind,date] of [['event_at',n.event_at],['deadline_at',n.deadline_at]] as const){
      if(typeof date!=='string')continue;
      const start=icsTime(date),end=icsTime(new Date(Date.parse(date)+3600000).toISOString());
      const kindLabel=kind==='event_at'?'开始':'截止';
      lines.push('BEGIN:VEVENT',`UID:notice-${n.id}-${kind}@classboard`,`DTSTAMP:${icsTime(String(n.published_at||n.created_at||new Date().toISOString()))}`,`DTSTART:${start}`,`DTEND:${end}`,`SUMMARY:【${n.category}】${icsEscape(String(n.title))}（${kindLabel}）`,`DESCRIPTION:${icsEscape(String(n.body).slice(0,800))}`,`URL:${origin}/`);
      if(n.location)lines.push(`LOCATION:${icsEscape(String(n.location))}`);
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n')+'\r\n';
}
async function route(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url=new URL(request.url), path=url.pathname, method=request.method;
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
  if(!env.DB)return json({error:'数据库尚未配置'},503);
  if(!['GET','HEAD'].includes(method))requireOrigin(request);
  if(path==='/api/health')return json({ok:true,stage:'MVP'});
  if(path==='/api/calendar'&&method==='GET'){
    const token=url.searchParams.get('token');
    if(!token||!/^[a-f0-9]{64}$/.test(token))return json({error:'无效的订阅链接'},404);
    const user=await env.DB.prepare('SELECT id FROM users WHERE calendar_token=?').bind(token).first<{id:string}>();
    if(!user)return json({error:'无效的订阅链接'},404);
    const result=await env.DB.prepare("SELECT * FROM notices WHERE status='published' AND (event_at IS NOT NULL OR deadline_at IS NOT NULL) ORDER BY published_at DESC LIMIT 500").all();
    return new Response(buildCalendar(result.results,url.origin),{headers:{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(path==='/api/session'&&method==='GET')return json({user:await session(request,env.DB)});
  if(path==='/api/login'&&method==='POST'){
    const body=await readBody(request);
    const username=field(body.student_id,'学号',64,true);
    const name=field(body.name,'姓名',64,true);
    const secret=body.password;
    if(typeof secret!=='string'||!secret||secret.length>256)fail(400,'请输入有效密码');
    const now=Date.now();
    const bucket=await sha256(`${request.headers.get('CF-Connecting-IP')||'local'}:${username}`);
    const ipBucket=await sha256(`ip:${request.headers.get('CF-Connecting-IP')||'local'}`);
    const counters=await env.DB.batch<{attempts:number}>([attempt(env.DB,bucket,now),attempt(env.DB,ipBucket,now)]);
    if(Number(counters[0].results[0]?.attempts)>8||Number(counters[1].results[0]?.attempts)>200)return json({error:'尝试次数过多，请在 15 分钟后重试'},429,{'Retry-After':'900'});
    const row=await env.DB.prepare('SELECT * FROM users WHERE student_id=?').bind(username).first<Admin & {salt:string;digest:string}>();
    // 账号不存在时也照同样成本推导一次：响应时间不泄漏学号是否注册。
    const verified=await verifyPassword(secret,row?.salt||'unregistered-account',row?.digest||`pbkdf2$sha256$${ITERATIONS}$${'0'.repeat(64)}`);
    if(!row||!verified||row.display_name!==name)fail(401,'姓名、学号或密码不正确');
    const id=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const authenticated=await env.DB.batch([
      env.DB.prepare('INSERT INTO user_sessions(id_hash,user_id,expires_at) SELECT ?,id,? FROM users WHERE id=? AND digest=?').bind(await sha256(id),now+SESSION_MS,row.id,row.digest),
      env.DB.prepare('DELETE FROM user_sessions WHERE expires_at<?').bind(now),
      env.DB.prepare('DELETE FROM login_attempts WHERE bucket=? OR expires_at<?').bind(bucket,now)
    ]);
    if(!authenticated[0].meta.changes)fail(401,'账号状态已变更，请重新登录');
    return json({user:{id:row.id,student_id:row.student_id,display_name:row.display_name,role:row.role,position:row.position,must_change_password:!!row.must_change_password}},200,{'Set-Cookie':cookie(request,id,SESSION_SECONDS)});
  }
  if(path==='/api/logout'&&method==='POST'){
    const id=request.headers.get('Cookie')?.match(/(?:^|;\s*)cb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(id)await env.DB.prepare('DELETE FROM user_sessions WHERE id_hash=?').bind(await sha256(id)).run();
    return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
  }
  const user=await session(request,env.DB); if(!user)fail(401,'请先登录');
  if(path==='/api/account/password'&&method==='POST'){
    const now=Date.now(),bucket=await sha256('change:'+user.id);
    const tries=await attempt(env.DB,bucket,now).first<{attempts:number}>();
    if(tries&&tries.attempts>8)return json({error:'尝试次数过多，请在 15 分钟后重试'},429,{'Retry-After':'900'});
    const body=await readBody(request);
    const current=body.current_password, next=body.new_password;
    if(typeof current!=='string'||current.length>256||typeof next!=='string'||next.length<6||next.length>256||!next.trim()||next===current)fail(400,'新密码须为 6—256 位，且不能与原密码相同');
    if(weakPassword(next,user.student_id))fail(400,'新密码过于简单，请不要使用学号、连续或重复的数字，以及常见密码');
    const row=await env.DB.prepare('SELECT salt,digest FROM users WHERE id=?').bind(user.id).first<{salt:string;digest:string}>();
    const verified=row?await verifyPassword(current,row.salt,row.digest):false;
    if(!row||!verified)fail(400,'当前密码不正确');
    const salt=crypto.randomUUID(), digest=await hashPassword(next,salt);
    const result=await env.DB.batch([
      env.DB.prepare('UPDATE users SET salt=?,digest=?,must_change_password=0 WHERE id=? AND digest=?').bind(salt,digest,user.id,row.digest),
      env.DB.prepare('DELETE FROM user_sessions WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM login_attempts WHERE bucket=?').bind(bucket)
    ]);
    if(!result[0].meta.changes)fail(409,'密码已变更，请重新登录');
    if(user.must_change_password){
      const id=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      const created=await env.DB.prepare('INSERT INTO user_sessions(id_hash,user_id,expires_at) SELECT ?,id,? FROM users WHERE id=? AND digest=?').bind(await sha256(id),Date.now()+SESSION_MS,user.id,digest).run();
      if(!created.meta.changes)fail(409,'账号状态已变更，请重新登录');
      return json({ok:true,user:{...user,must_change_password:false}},200,{'Set-Cookie':cookie(request,id,SESSION_SECONDS)});
    }
    return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
  }
  if(user.must_change_password)return json({error:'请先修改初始密码',code:'PASSWORD_CHANGE_REQUIRED'},403);
  if(path==='/api/account/push'&&method==='GET'){
    if(!pushAvailable(env))return json({publicKey:null,subscriptions:0,enabled:false,thisDevice:false});
    const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?').bind(user.id).first<{n:number}>();
    // 前端自检用：带 endpoint 时顺便回答「这台设备服务端登记了吗」，否则本地订阅丢了会一直被蒙在鼓里
    const endpoint=url.searchParams.get('endpoint')||'';
    const known=endpoint&&endpoint.length<=1000?await env.DB.prepare('SELECT 1 AS ok FROM push_subscriptions WHERE user_id=? AND endpoint=?').bind(user.id,endpoint).first<{ok:number}>():null;
    return json({publicKey:env.VAPID_PUBLIC_KEY,subscriptions:count?.n||0,enabled:true,thisDevice:!!known});
  }
  if(path==='/api/account/push/subscribe'&&method==='POST'){
    if(!pushAvailable(env))return json({error:'推送服务尚未配置'},503);
    const body=await readBody(request);
    const endpoint=field(body.endpoint,'推送地址',1000,true);
    let target:URL;try{target=new URL(endpoint)}catch{return fail(400,'推送地址格式不正确');}
    if(target.protocol!=='https:')fail(400,'推送地址必须为 HTTPS');
    if(!pushHostAllowed(target.hostname))fail(400,'推送地址不是受支持的推送服务');
    const bound=await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=? AND endpoint<>?').bind(user.id,endpoint).first<{n:number}>();
    if((bound?.n||0)>=PUSH_PER_USER)fail(400,`最多绑定 ${PUSH_PER_USER} 台设备，请先在不再使用的设备上关闭推送`);
    const keys=body.keys;
    if(!keys||typeof keys!=='object')fail(400,'缺少推送密钥');
    const p256dh=field((keys as Record<string,unknown>).p256dh,'推送公钥',200,true),auth=field((keys as Record<string,unknown>).auth,'推送密钥',200,true);
    await env.DB.prepare('INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,created_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth').bind(endpoint,user.id,p256dh,auth,new Date().toISOString()).run();
    return json({ok:true},201);
  }
  if(path==='/api/account/push/subscribe'&&method==='DELETE'){
    const body=await readBody(request);
    const endpoint=field(body.endpoint,'推送地址',1000,true);
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').bind(endpoint,user.id).run();
    return json({ok:true});
  }
  if(path==='/api/account/push/test'&&method==='POST'){
    const keys=loadVapid(env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
    if(!keys)return json({error:'推送服务尚未配置'},503);
    const tries=await attempt(env.DB,await sha256('push-test:'+user.id),Date.now()).first<{attempts:number}>();
    if(tries&&tries.attempts>5)return json({error:'测试推送太频繁，请在 15 分钟后重试'},429,{'Retry-After':'900'});
    const subs=await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?').bind(user.id).all<{endpoint:string;p256dh:string;auth:string}>();
    if(!subs.results.length)return json({error:'尚未在本设备开启推送'},400);
    const subject=env.VAPID_SUBJECT||'mailto:classboard-upc@users.noreply.example';
    const payload: PushPayload={title:'知可而办 · 测试推送',body:'绑定成功，新的班级通知会第一时间推送到这里。',url:'/',tag:'push-test'};
    const stale:string[]=[];
    await Promise.allSettled(subs.results.map(async sub=>{const ok=await sendPush(sub,payload,keys,subject).catch(()=>true);if(!ok)stale.push(sub.endpoint);}));
    if(stale.length)await env.DB.batch(stale.map(endpoint=>env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint)));
    return json({ok:true,delivered:subs.results.length-stale.length});
  }
  if(path==='/api/account/calendar-token'&&method==='POST'){
    const rotate=(await readBody(request)).rotate===true;
    let token=rotate?null:await env.DB.prepare('SELECT calendar_token AS t FROM users WHERE id=?').bind(user.id).first<{t:string|null}>();
    if(!token?.t){
      token={t:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')};
      await env.DB.prepare('UPDATE users SET calendar_token=? WHERE id=?').bind(token.t,user.id).run();
    }
    return json({token:token.t,url:`${url.origin}/api/calendar?token=${token.t}`,rotated:rotate});
  }
  if(path==='/api/account/reads'&&method==='GET'){
    const rows=await env.DB.prepare('SELECT notice_id,state FROM notice_reads WHERE user_id=?').bind(user.id).all<{notice_id:string,state:string}>();
    return json({ids:rows.results.map(r=>r.notice_id),done:rows.results.filter(r=>r.state==='done').map(r=>r.notice_id)});
  }
  const readPath=path.match(/^\/api\/account\/reads\/([\w-]+)$/);
  if(readPath&&['PUT','DELETE'].includes(method)){
    const notice=await env.DB.prepare("SELECT id FROM notices WHERE id=? AND status='published'").bind(readPath[1]).first();
    if(!notice)fail(404,'通知不存在或尚未发布');
    if(method==='PUT'){
      const state=(await readBody(request)).state==='done'?'done':'read';
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO notice_reads(user_id,notice_id) VALUES(?,?)').bind(user.id,readPath[1]),
        env.DB.prepare('UPDATE notice_reads SET state=? WHERE user_id=? AND notice_id=?').bind(state,user.id,readPath[1])
      ]);
    }else await env.DB.prepare('DELETE FROM notice_reads WHERE user_id=? AND notice_id=?').bind(user.id,readPath[1]).run();
    return json({ok:true});
  }
  if(path==='/api/notices'&&method==='GET'){
    const category=url.searchParams.get('category'),q=url.searchParams.get('q');
    const etag=await feedTag(env.DB,'public',category,q);
    if(etag&&ifNoneMatch(request,etag))return notModified(etag);
    const clauses=["n.status='published'"],args: string[]=[];
    if(category&&categories.includes(category as any)){clauses.push('n.category=?');args.push(category);}
    if(q){clauses.push('(n.title LIKE ? OR n.body LIKE ?)');args.push(`%${q.slice(0,100)}%`,`%${q.slice(0,100)}%`);}
    // author_position 是发布人当前职位，JOIN 后才能让同学看到「团支书 张三」这样的署名。
    const result=await env.DB.prepare(`SELECT n.*,u.position AS author_position FROM notices n LEFT JOIN users u ON u.id=n.author_id WHERE ${clauses.join(' AND ')} ORDER BY n.pinned DESC,n.published_at DESC LIMIT 500`).bind(...args).all();
    return json({notices:result.results.map(r=>mapNotice(r))},200,feedHeaders(etag));
  }
  const publicDetail=path.match(/^\/api\/notices\/([\w-]+)$/);
  if(publicDetail&&method==='GET'){
    const row=await env.DB.prepare("SELECT n.*,u.position AS author_position FROM notices n LEFT JOIN users u ON u.id=n.author_id WHERE n.id=? AND n.status='published'").bind(publicDetail[1]).first();
    return row?json({notice:mapNotice(row)}):json({error:'通知不存在或尚未发布'},404);
  }
  if(!path.startsWith('/api/admin/'))return json({error:'接口不存在'},404);
  if(user.role!=='committee')fail(403,'仅班委可进行此操作');
  const admin=user;
  if(path==='/api/admin/parse-options'&&method==='GET')return json({llmAvailable:!!llmAdapter(env)});
  if(path==='/api/admin/parse'&&method==='POST'){
    const body=await readBody(request);const text=field(body.text,'群聊文本',20000,true);
    const reference=dateField(body.referenceDate);if(!reference)fail(400,'请选择消息基准时间');
    return json(await parseMessages(text,{referenceDate:reference},body.enhance===true?llmAdapter(env):undefined));
  }
  if(path==='/api/admin/import'&&method==='POST'){
    const body=await readBody(request);
    if(!Array.isArray(body.drafts)||!body.drafts.length||body.drafts.length>30)fail(400,'每批请选择 1—30 条通知');
    if(!['text','ocr','llm'].includes(String(body.source)))fail(400,'导入来源不正确');
    const now=new Date().toISOString(),statements:D1PreparedStatement[]=[];
    for(const raw of body.drafts){
      if(!raw||typeof raw!=='object')fail(400,'草稿格式不正确');
      const n=validate(raw),id=crypto.randomUUID(),sourceText=field(raw.source_text,'原文',20000,true);
      const warnings=Array.isArray(raw.warnings)?raw.warnings.slice(0,20).map((x:unknown)=>field(x,'提示',300)):[];
      const hash=await sha256(n.body.replace(/\s+/g,'').normalize('NFKC'));
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO notices(id,title,body,category,location,audience,event_at,deadline_at,pinned,status,source,source_text,source_hash,warnings,author_id,author_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?)").bind(id,n.title,n.body,n.category,n.location,n.audience,n.event_at,n.deadline_at,+n.pinned,body.source,sourceText,hash,JSON.stringify(warnings),admin.id,admin.display_name,now,now));
      statements.push(env.DB.prepare('INSERT INTO audit_log SELECT ?,id,?,?,? FROM notices WHERE id=?').bind(crypto.randomUUID(),admin.display_name,'导入待审核',now,id));
    }
    statements.push(bumpFeed(env.DB));
    const results=await env.DB.batch(statements);const imported=results.slice(0,-1).filter((_,i)=>i%2===0).reduce((sum,r)=>sum+(r.meta.changes||0),0);
    return json({imported,skipped:body.drafts.length-imported},201);
  }
  if(path==='/api/admin/notices'&&method==='GET'){
    const etag=await feedTag(env.DB,'admin');
    if(etag&&ifNoneMatch(request,etag))return notModified(etag);
    const result=await env.DB.prepare('SELECT n.*,u.position AS author_position FROM notices n LEFT JOIN users u ON u.id=n.author_id ORDER BY n.created_at DESC LIMIT 500').all();
    return json({notices:result.results.map(r=>mapNotice(r,true))},200,feedHeaders(etag));
  }
  if(path==='/api/admin/notices'&&method==='POST'){
    const body=await readBody(request),n=validate(body),id=crypto.randomUUID(),now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notices(id,title,body,category,location,audience,event_at,deadline_at,pinned,status,author_id,author_name,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?)").bind(id,n.title,n.body,n.category,n.location,n.audience,n.event_at,n.deadline_at,+n.pinned,admin.id,admin.display_name,now,now,now),
      env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,admin.display_name,'发布',now),
      bumpFeed(env.DB)
    ]);
    deferPush(ctx,env,{id,title:n.title,category:n.category,body:n.body});
    return json({id},201);
  }
  const edit=path.match(/^\/api\/admin\/notices\/([\w-]+)$/);
  if(edit&&method==='PUT'){
    const body=await readBody(request),n=validate(body),now=new Date().toISOString();
    if(!Number.isInteger(body.version))fail(400,'缺少通知版本');
    const author=await authorPosition(env.DB,edit[1]);
    if(author&&!canManageNotice(admin.position,author.position))fail(403,'这条通知由班长或团支书发布，仅班长或团支书可以编辑');
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE notices SET title=?,body=?,category=?,location=?,audience=?,event_at=?,deadline_at=?,pinned=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status IN ('pending','published')").bind(n.title,n.body,n.category,n.location,n.audience,n.event_at,n.deadline_at,+n.pinned,now,edit[1],body.version as number),
      env.DB.prepare('INSERT INTO audit_log SELECT ?,id,?,?,? FROM notices WHERE id=? AND version=? AND updated_at=?').bind(crypto.randomUUID(),admin.display_name,'编辑',now,edit[1],Number(body.version)+1,now),
      bumpFeed(env.DB)
    ]);
    if(!result[0].meta.changes)fail(409,'通知已被更新或已归档，请刷新后重试');
    return json({ok:true});
  }
  const action=path.match(/^\/api\/admin\/notices\/([\w-]+)\/(publish|reject|archive|restore)$/);
  if(action&&method==='POST'){
    const body=await readBody(request),now=new Date().toISOString();
    if(!Number.isInteger(body.version))fail(400,'缺少通知版本');
    // 撤销归档回到「已发布」并按新发布对待（排序到最前并重新推送）；撤销驳回只回到待审核，不推送。
    if(action[2]==='restore'){
      const row=await env.DB.prepare('SELECT n.status AS status,u.position AS author_position FROM notices n LEFT JOIN users u ON u.id=n.author_id WHERE n.id=?').bind(action[1]).first<{status:string;author_position:string|null}>();
      if(!row)fail(404,'通知不存在');
      if(!['archived','rejected'].includes(row.status))fail(409,'只有已归档或已驳回的通知可以撤销');
      if(!canManageNotice(admin.position,row.author_position))fail(403,'这条通知由班长或团支书发布，仅班长或团支书可以撤销');
      const back=row.status==='archived'?'published':'pending';
      const results=await env.DB.batch([
        env.DB.prepare('UPDATE notices SET status=?,published_at=CASE WHEN ?=\'published\' THEN ? ELSE published_at END,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=?').bind(back,back,now,now,action[1],body.version as number,row.status),
        env.DB.prepare('INSERT INTO audit_log SELECT ?,id,?,?,? FROM notices WHERE id=? AND version=? AND updated_at=?').bind(crypto.randomUUID(),admin.display_name,row.status==='archived'?'撤销归档':'撤销驳回',now,action[1],Number(body.version)+1,now),
        bumpFeed(env.DB)
      ]);
      if(!results[0].meta.changes)fail(409,'通知状态已变化，请刷新后重试');
      if(back==='published'){
        const notice=await env.DB.prepare('SELECT id,title,category,body FROM notices WHERE id=?').bind(action[1]).first<{id:string;title:string;category:string;body:string}>();
        if(notice)deferPush(ctx,env,notice);
      }
      return json({ok:true});
    }
    const status=action[2]==='publish'?'published':action[2]==='reject'?'rejected':'archived';
    const old=action[2]==='archive'?'published':'pending';
    const label=action[2]==='publish'?'审核通过':action[2]==='reject'?'驳回':'归档';
    if(action[2]==='archive'){const author=await authorPosition(env.DB,action[1]);if(author&&!canManageNotice(admin.position,author.position))fail(403,'这条通知由班长或团支书发布，仅班长或团支书可以归档');}
    const results=await env.DB.batch([
      env.DB.prepare('UPDATE notices SET status=?,reviewed_by=?,reviewed_at=?,published_at=CASE WHEN ?=\'published\' THEN ? ELSE published_at END,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=?').bind(status,admin.id,now,status,now,now,action[1],body.version as number,old),
      env.DB.prepare('INSERT INTO audit_log SELECT ?,id,?,?,? FROM notices WHERE id=? AND version=? AND updated_at=?').bind(crypto.randomUUID(),admin.display_name,label,now,action[1],Number(body.version)+1,now),
      bumpFeed(env.DB)
    ]);
    if(!results[0].meta.changes)fail(409,'通知状态已变化，请刷新后重试');
    if(action[2]==='publish'){
      const notice=await env.DB.prepare('SELECT id,title,category,body FROM notices WHERE id=?').bind(action[1]).first<{id:string;title:string;category:string;body:string}>();
      if(notice)deferPush(ctx,env,notice);
    }
    return json({ok:true});
  }
  return json({error:'接口不存在'},404);
}
export default {
  async fetch(request: Request,env: Env,ctx: ExecutionContext): Promise<Response> {
    try{
      const response=await route(request,env,ctx);
      return new URL(request.url).pathname.startsWith('/api/')?secure(response):response;
    }catch(error){
      if(error instanceof HttpError)return secure(json({error:error.message},error.status));
      // 只记错误类型与信息，便于排查线上故障；绝不记录请求体、数据库内容、会话值或口令。
      console.error(`[api] ${new URL(request.url).pathname} failed: ${error instanceof Error?`${error.name}: ${error.message}`:'unknown error'}`);
      return secure(json({error:'服务暂时不可用，请稍后重试'},500));
    }
  }
};
