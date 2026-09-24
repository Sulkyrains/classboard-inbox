import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile,readdir } from 'node:fs/promises';
import { randomBytes,randomUUID,pbkdf2Sync } from 'node:crypto';
import assert from 'node:assert/strict';
const vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const vapidKeys={VAPID_PUBLIC_KEY:Buffer.from(new Uint8Array(await crypto.subtle.exportKey('raw',vapid.publicKey))).toString('base64url'),VAPID_PRIVATE_KEY:(await crypto.subtle.exportKey('jwk',vapid.privateKey)).d};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile('dist/_worker.js','utf8'),compatibilityDate:'2026-09-09',d1Databases:['DB'],bindings:vapidKeys}));
try{
  const db=await mf.getD1Database('DB');
  for(const file of (await readdir('migrations')).sort())for(const statement of (await readFile('migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  const secret=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex');
  await db.prepare("INSERT INTO users(id,student_id,display_name,role,salt,digest,created_at,must_change_password) VALUES(?,?,?,'committee',?,?,?,0)").bind(randomUUID(),'integration-admin','测试班委',salt,pbkdf2Sync(secret,salt,100000,32,'sha256').toString('hex'),new Date().toISOString()).run();
  let cookie='';
  let etagHeader=null;
  const call=(path,method='GET',body,auth=true,origin='https://example.test')=>mf.dispatchFetch('https://example.test/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(auth&&cookie?{Cookie:cookie}:{}),...(etagHeader?{'If-None-Match':etagHeader}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const revalidate=async path=>{etagHeader=null;const first=await call(path);const tag=first.headers.get('ETag');
    etagHeader=tag;const second=await call(path);etagHeader=null;
    return {tag,status:first.status,cached:second.status,cachedBody:await second.text()};};
  const denied=await call('/admin/notices');assert.equal(denied.status,401);
  // 静态资源的安全头由 public/_headers 下发，/api/* 由 Worker 自己补：错误响应也必须带上
  for(const [name,expected] of [['Strict-Transport-Security','max-age=31536000; includeSubDomains'],['Cross-Origin-Resource-Policy','same-origin'],['X-Content-Type-Options','nosniff'],['X-Frame-Options','DENY'],['Referrer-Policy','no-referrer']])assert.equal(denied.headers.get(name),expected);
  assert.match(denied.headers.get('Content-Security-Policy'),/default-src 'none'/);
  assert.equal((await call('/login','POST',{student_id:'integration-admin',name:'测试班委',password:secret},false,'https://evil.test')).status,403);
  const login=await call('/login','POST',{student_id:'integration-admin',name:'测试班委',password:secret});assert.equal(login.status,200);
  assert.equal(login.headers.get('Strict-Transport-Security'),'max-age=31536000; includeSubDomains');
  assert.match(login.headers.get('Content-Security-Policy'),/default-src 'none'/);
  // 旧版裸 hex 摘要必须继续可登录：Cloudflare 的 PBKDF2 上限就是 10 万次，登录不会再改写摘要
  const storedDigest=await db.prepare('SELECT digest FROM users WHERE student_id=?').bind('integration-admin').first();
  assert.match(storedDigest.digest,/^[a-f0-9]{64}$/);
  const setCookie=login.headers.get('Set-Cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Strict/);cookie=setCookie.split(';')[0];
  assert.equal((await call('/notices','GET',undefined,false)).status,401);
  assert.equal((await call('/login','POST',{student_id:'integration-admin',name:'错误姓名',password:secret})).status,401);
  const committeeCookie=cookie;
  const studentId=randomUUID();
  await db.prepare("INSERT INTO users(id,student_id,display_name,role,salt,digest,created_at) VALUES(?,?,?,'student',?,?,?)").bind(studentId,'test-student','测试同学',salt,pbkdf2Sync(secret,salt,100000,32,'sha256').toString('hex'),new Date().toISOString()).run();
  const studentLogin=await call('/login','POST',{student_id:'test-student',name:'测试同学',password:secret});
  cookie=studentLogin.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await call('/notices')).status,403);
  assert.equal((await call('/admin/notices')).status,403);
  assert.equal((await call('/account/reads')).status,403);
  assert.equal((await call('/account/password','POST',{current_password:secret,new_password:'short'})).status,400);
  const newSecret=randomBytes(3).toString('hex');
  const changed=await call('/account/password','POST',{current_password:secret,new_password:newSecret});
  assert.equal(changed.status,200);assert.equal((await changed.json()).user.must_change_password,false);
  // 改密后写入带参数的摘要格式，参数值受平台上限约束（PBKDF2 最多 10 万次迭代）
  const rotatedDigest=await db.prepare('SELECT digest FROM users WHERE student_id=?').bind('test-student').first();
  assert.match(rotatedDigest.digest,/^pbkdf2\$sha256\$100000\$[a-f0-9]{64}$/);
  const renewedCookie=changed.headers.get('Set-Cookie').split(';')[0];assert.notEqual(renewedCookie,cookie);
  assert.equal((await call('/notices')).status,401);
  cookie=renewedCookie;
  assert.equal((await call('/notices')).status,200);
  assert.equal((await call('/admin/notices')).status,403);
  assert.equal((await call('/login','POST',{student_id:'test-student',name:'测试同学',password:secret})).status,401);
  const studentAgain=await call('/login','POST',{student_id:'test-student',name:'测试同学',password:newSecret});
  assert.equal(studentAgain.status,200);
  const studentCookie=studentAgain.headers.get('Set-Cookie').split(';')[0];cookie=studentCookie;
  assert.equal((await call('/admin/notices')).status,403);
  assert.equal((await call('/admin/import','POST',{})).status,403);
  cookie=committeeCookie;
  const notice={title:'集成测试通知',body:'请在明天完成作业',category:'作业',location:'教三201',audience:'全体',event_at:null,deadline_at:'2026-09-12T12:00:00Z',pinned:false};
  const create=await call('/admin/notices','POST',notice);assert.equal(create.status,201);const {id}=await create.json();
  let list=await(await call('/notices')).json();assert.equal(list.notices.length,1);assert.equal(list.notices[0].source_text,undefined);
  assert.equal((await call('/admin/notices/'+id,'PUT',{...notice,pinned:true,version:1})).status,200);
  assert.equal((await call('/admin/notices/'+id,'PUT',{...notice,version:1})).status,409);
  list=await(await call('/notices?category=活动')).json();assert.equal(list.notices.length,0);
  await db.prepare("UPDATE notices SET status='pending',source_text='PRIVATE SOURCE' WHERE id=?").bind(id).run();
  assert.equal((await(await call('/notices')).json()).notices.length,0);
  assert.equal((await call('/notices/'+id)).status,404);
  assert.equal((await call('/admin/notices/'+id+'/publish','POST',{version:2},false)).status,401);
  assert.equal((await call('/admin/notices/'+id+'/publish','POST',{version:2})).status,200);
  assert.equal((await call('/admin/notices/'+id+'/publish','POST',{version:2})).status,409);
  list=await(await call('/notices')).json();assert.equal(list.notices.length,1);assert.equal(list.notices[0].source_text,undefined);assert.equal(list.notices[0].pinned,true);
  assert.equal((await call('/admin/notices/'+id+'/archive','POST',{version:3})).status,200);
  assert.equal((await(await call('/notices')).json()).notices.length,0);
  const parse=await call('/admin/parse','POST',{text:'@全体成员 高数作业明晚8点前提交。',referenceDate:'2026-09-09T10:00:00+08:00'});assert.equal(parse.status,200);
  const parsed=await parse.json();assert.equal(parsed.drafts.length,1);assert.equal(parsed.drafts[0].deadline_at,'2026-09-10T12:00:00.000Z');
  const imported=await call('/admin/import','POST',{drafts:parsed.drafts,source:'text',status:'published'});assert.equal(imported.status,201);assert.equal((await imported.json()).imported,1);
  assert.equal((await(await call('/notices')).json()).notices.length,0);
  const dup=await call('/admin/import','POST',{drafts:parsed.drafts,source:'text'});assert.equal((await dup.json()).skipped,1);
  const all=await(await call('/admin/notices')).json();const pending=all.notices.find(n=>n.status==='pending');assert.ok(pending);assert.ok(pending.source_text);
  cookie=studentCookie;
  assert.equal((await call('/notices/'+pending.id)).status,404);
  assert.equal((await call('/account/reads/'+pending.id,'PUT')).status,404);
  assert.equal((await call('/admin/notices/'+pending.id+'/publish','POST',{version:pending.version})).status,403);
  assert.equal((await(await call('/notices')).json()).notices.length,0);
  cookie=committeeCookie;
  assert.equal((await call('/admin/notices/'+pending.id+'/publish','POST',{version:pending.version})).status,200);
  assert.equal((await(await call('/notices')).json()).notices.length,1);
  cookie=studentCookie;
  assert.equal((await call('/account/reads/'+pending.id,'PUT')).status,200);
  assert.deepEqual((await(await call('/account/reads')).json()).ids,[pending.id]);
  cookie=committeeCookie;
  assert.deepEqual((await(await call('/account/reads')).json()).ids,[]);
  cookie=studentCookie;
  const otherDevice=await call('/login','POST',{student_id:'test-student',name:'测试同学',password:newSecret});
  cookie=otherDevice.headers.get('Set-Cookie').split(';')[0];
  assert.deepEqual((await(await call('/account/reads')).json()).ids,[pending.id]);
  assert.equal((await call('/account/reads/'+pending.id,'DELETE')).status,200);
  cookie=studentCookie;
  const studentView=await(await call('/notices')).json();assert.equal(studentView.notices[0].source_text,undefined);assert.equal(studentView.notices[0].warnings,undefined);
  assert.deepEqual((await(await call('/account/reads')).json()).ids,[]);
  // 推送订阅：只接受真实推送服务的域名，且每人最多 5 台设备（重复的 endpoint 算更新，不算新增）
  const sub=(endpoint,keys={p256dh:'test-p256dh',auth:'test-auth'})=>call('/account/push/subscribe','POST',{endpoint,keys});
  assert.equal((await sub('https://attacker.test/hook')).status,400);
  assert.equal((await sub('http://fcm.googleapis.com/fcm/send/x')).status,400);
  assert.equal((await sub('https://fcm.googleapis.com.attacker.test/x')).status,400);
  assert.equal((await sub('https://evilpush.apple.com/x')).status,400);
  for(let i=0;i<5;i++)assert.equal((await sub('https://web.push.apple.com/device-'+i)).status,201);
  assert.equal((await sub('https://web.push.apple.com/device-5')).status,400);
  assert.equal((await sub('https://web.push.apple.com/device-3',{p256dh:'rotated',auth:'rotated'})).status,201);
  // 日程订阅链接可以重置，旧链接立刻失效
  const firstToken=(await(await call('/account/calendar-token','POST',{})).json()).token;
  assert.equal((await(await call('/account/calendar-token','POST',{})).json()).token,firstToken);
  const rotatedToken=(await(await call('/account/calendar-token','POST',{rotate:true})).json()).token;
  assert.notEqual(rotatedToken,firstToken);
  assert.equal((await mf.dispatchFetch('https://example.test/api/calendar?token='+firstToken)).status,404);
  assert.equal((await mf.dispatchFetch('https://example.test/api/calendar?token='+rotatedToken)).status,200);
  // 弱口令不能作为新密码
  assert.equal((await call('/account/password','POST',{current_password:newSecret,new_password:'123456'})).status,400);
  assert.equal((await call('/account/password','POST',{current_password:newSecret,new_password:'test-student'})).status,400);
  assert.equal((await call('/account/password','POST',{current_password:newSecret,new_password:newSecret})).status,400);
  assert.equal((await call('/account/password','POST',{current_password:'wrong',new_password:randomBytes(24).toString('hex')})).status,400);
  assert.equal((await call('/account/password','POST',{current_password:newSecret,new_password:randomBytes(24).toString('hex')})).status,200);
  assert.equal((await call('/notices')).status,401);
  cookie=otherDevice.headers.get('Set-Cookie').split(';')[0];assert.equal((await call('/notices')).status,401);
  // ---- 通知列表的 ETag 校验：内容没变时回 304，不再扫描整张表 ----
  cookie=committeeCookie;
  const feed=await revalidate('/notices');
  assert.match(feed.tag,/^"\d+-[a-f0-9]{16}"$/);      // 版本号 + 查询范围的指纹
  assert.equal(feed.status,200);
  assert.equal(feed.cached,304);
  assert.equal(feed.cachedBody,'');                    // 304 不能带正文
  const adminFeed=await revalidate('/admin/notices');
  assert.equal(adminFeed.cached,304);
  assert.notEqual(adminFeed.tag,feed.tag);             // 公开列表与管理列表互不串用
  const filtered=await revalidate('/notices?category=作业');
  assert.notEqual(filtered.tag,feed.tag);              // 不同筛选条件不能共用同一个 ETag
  // 发布新通知后 ETag 必须变化，否则同学会一直看到旧列表
  const fresh={title:'ETag 校验通知',body:'发布后列表必须失效',category:'事务',location:'',audience:'',event_at:null,deadline_at:null,pinned:false};
  const created=await call('/admin/notices','POST',fresh);assert.equal(created.status,201);
  const afterPublish=await revalidate('/notices');
  assert.notEqual(afterPublish.tag,feed.tag);
  assert.equal(afterPublish.cached,304);
  // 编辑、归档、导入待审同样要让缓存失效
  const {id:freshId}=await created.json();
  await call('/admin/notices/'+freshId,'PUT',{...fresh,title:'改过标题',version:1});
  const afterEdit=await revalidate('/notices');assert.notEqual(afterEdit.tag,afterPublish.tag);
  await call('/admin/notices/'+freshId+'/archive','POST',{version:2});
  const afterArchive=await revalidate('/notices');assert.notEqual(afterArchive.tag,afterEdit.tag);
  const draft=await(await call('/admin/parse','POST',{text:'周五下午三点开班会，请准时到场。',referenceDate:'2026-09-09T10:00:00+08:00'})).json();
  await call('/admin/import','POST',{drafts:draft.drafts,source:'text'});
  const afterImport=await revalidate('/admin/notices');assert.notEqual(afterImport.tag,adminFeed.tag);
  // 拿着别人的 ETag 不能骗到 304
  etagHeader='"999999-0000000000000000"';
  assert.equal((await call('/notices')).status,200);
  etagHeader=null;
  cookie=committeeCookie;
  assert.equal((await call('/logout','POST',{})).status,200);assert.equal((await call('/admin/notices')).status,401);
  assert.equal((await call('/admin/parse','POST',{text:'作业明天交',referenceDate:'2026-09-09T10:00:00+08:00'})).status,401);
  for(let i=0;i<8;i++)assert.equal((await call('/login','POST',{student_id:'unknown',name:'未知',password:secret})).status,401);
  assert.equal((await call('/login','POST',{student_id:'unknown',name:'未知',password:secret})).status,429);
  // ---- 职位与权限分级：主要班委（班长/团支书）不受限，其他委员不能归档或编辑主要班委发布的通知 ----
  const committeeLogin=async(id,name,position)=>{const s=randomBytes(16).toString('hex');await db.prepare("INSERT INTO users(id,student_id,display_name,role,position,salt,digest,created_at,must_change_password) VALUES(?,?,?,'committee',?,?,?,?,0)").bind(randomUUID(),id,name,position,s,pbkdf2Sync(secret,s,100000,32,'sha256').toString('hex'),new Date().toISOString()).run();const r=await call('/login','POST',{student_id:id,name,password:secret});assert.equal(r.status,200);assert.equal((await r.json()).user.position,position);cookie=r.headers.get('Set-Cookie').split(';')[0];return cookie;};
  const leadCookie=await committeeLogin('integration-lead','测试班长','班长');
  const memberCookie=await committeeLogin('integration-member','测试学习委员','学习委员');
  await committeeLogin('integration-peer','测试文体委员','文体委员');
  const peerCookie=cookie;
  assert.equal((await(await call('/session')).json()).user.position,'文体委员');
  const publish=async title=>{const r=await call('/admin/notices','POST',{...fresh,title});assert.equal(r.status,201);return (await r.json()).id;};
  cookie=leadCookie;
  const leadId=await publish('班长发布的通知');
  cookie=memberCookie;
  const memberId=await publish('学习委员发布的通知');    // 委员自行发布免审核，201 即为已发布
  let leadFeed=await(await call('/notices')).json();
  const leadPublic=leadFeed.notices.find(n=>n.id===leadId);
  assert.equal(leadPublic.author_name,'测试班长');assert.equal(leadPublic.author_position,'班长');assert.equal(leadPublic.author_id,undefined);
  assert.equal((await call('/admin/notices/'+leadId,'PUT',{...fresh,title:'偷改班长的通知',version:1})).status,403);
  assert.equal((await call('/admin/notices/'+leadId+'/archive','POST',{version:1})).status,403);
  assert.ok((await(await call('/notices')).json()).notices.some(n=>n.id===leadId));    // 被拒后通知仍然发布中
  assert.equal((await call('/admin/notices/'+memberId,'PUT',{...fresh,pinned:true,version:1})).status,200);   // 自己发布的可以编辑
  cookie=peerCookie;
  const peerId=await publish('文体委员发布的通知');
  cookie=memberCookie;
  assert.equal((await call('/admin/notices/'+peerId+'/archive','POST',{version:1})).status,200);              // 委员之间可以互相归档
  cookie=leadCookie;
  assert.equal((await call('/admin/notices/'+memberId+'/archive','POST',{version:2})).status,200);            // 班长可以归档委员的
  leadFeed=await(await call('/notices')).json();
  assert.ok(leadFeed.notices.some(n=>n.id===leadId));
  assert.ok(!leadFeed.notices.some(n=>n.id===memberId||n.id===peerId));   // 归档后对所有人（含同学）都从看板消失
  // ---- 撤销归档 / 撤销驳回：归档→已发布（重新推送），驳回→待审核；权限与乐观锁与归档一致 ----
  const readNotice=async id=>db.prepare('SELECT status,published_at,version FROM notices WHERE id=?').bind(id).first();
  await db.prepare("UPDATE notices SET status='archived',version=version+1,updated_at=? WHERE id=?").bind(new Date().toISOString(),leadId).run();
  const archivedLead=await readNotice(leadId);
  cookie=memberCookie;
  assert.equal((await call('/admin/notices/'+leadId+'/restore','POST',{version:archivedLead.version})).status,403);   // 委员不能撤销班长发布的通知
  assert.equal((await readNotice(leadId)).status,'archived');
  cookie=leadCookie;
  assert.equal((await call('/admin/notices/'+leadId+'/restore','POST',{version:archivedLead.version+7})).status,409); // 版本冲突
  assert.equal((await call('/admin/notices/'+leadId+'/restore','POST',{version:archivedLead.version})).status,200);
  const restoredLead=await readNotice(leadId);
  assert.equal(restoredLead.status,'published');
  assert.ok(restoredLead.published_at>archivedLead.published_at);    // 重新发布，排序回到最前
  assert.equal(restoredLead.version,archivedLead.version+1);
  assert.ok((await(await call('/notices')).json()).notices.some(n=>n.id===leadId));   // 重新出现在所有人看板
  assert.equal((await call('/admin/notices/'+leadId+'/restore','POST',{version:restoredLead.version})).status,409);   // 已发布不能再撤销
  await db.prepare("UPDATE notices SET status='rejected',version=version+1,updated_at=? WHERE id=?").bind(new Date().toISOString(),peerId).run();
  const rejectedPeer=await readNotice(peerId);
  cookie=memberCookie;
  assert.equal((await call('/admin/notices/'+peerId+'/restore','POST',{version:rejectedPeer.version})).status,200);    // 自己被驳回的草稿可以撤销
  const restoredPeer=await readNotice(peerId);
  assert.equal(restoredPeer.status,'pending');
  assert.ok(!(await(await call('/notices')).json()).notices.some(n=>n.id===peerId));   // 回到待审核，不对外可见
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operation_log WHERE notice_id=? AND action='撤销归档'").bind(leadId).first()).n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operation_log WHERE notice_id=? AND action='撤销驳回'").bind(peerId).first()).n,1);
  // ---- 永久删除：只有班长能删；删掉后通知、已读记录与审计记录一起消失，列表缓存立即失效 ----
  const secretaryCookie=await committeeLogin('integration-secretary','测试团支书','团支书');
  cookie=leadCookie;
  const doomedId=await publish('准备删除的测试通知');
  const doomedVersion=(await readNotice(doomedId)).version;
  await db.prepare("INSERT INTO notice_reads(user_id,notice_id,state) VALUES(?,?,'read')").bind(studentId,doomedId).run();
  const beforeDelete=await revalidate('/notices');
  cookie=memberCookie;
  assert.equal((await call('/admin/notices/'+doomedId,'DELETE',{version:doomedVersion})).status,403);   // 委员不能删除
  assert.equal((await readNotice(doomedId)).status,'published');
  cookie=secretaryCookie;
  assert.equal((await call('/admin/notices/'+doomedId,'DELETE',{version:doomedVersion})).status,403);   // 团支书同为主要班委，但不能删除
  assert.equal((await readNotice(doomedId)).status,'published');
  cookie=leadCookie;
  assert.equal((await call('/admin/notices/'+doomedId,'DELETE',{version:doomedVersion+5})).status,409); // 版本不符
  assert.equal((await call('/admin/notices/'+doomedId,'DELETE',{})).status,400);                       // 必须带版本
  assert.equal((await call('/admin/notices/'+doomedId,'DELETE',{version:doomedVersion})).status,200);
  assert.equal((await call('/admin/notices/'+doomedId,'DELETE',{version:doomedVersion})).status,404);   // 删过就没了
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notices WHERE id=?').bind(doomedId).first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notice_reads WHERE notice_id=?').bind(doomedId).first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE notice_id=?').bind(doomedId).first()).n,0);
  const afterDelete=await revalidate('/notices');assert.notEqual(afterDelete.tag,beforeDelete.tag);
  assert.ok(!(await(await call('/notices')).json()).notices.some(n=>n.id===doomedId));
  assert.ok(!(await(await call('/admin/notices')).json()).notices.some(n=>n.id===doomedId));
  // ---- 操作日志：只有班长能看；发布/编辑/归档/撤销/删除逐条留痕，通知被删也留快照 ----
  cookie=memberCookie;
  assert.equal((await call('/admin/operations')).status,403);            // 委员没有权限
  cookie=secretaryCookie;
  assert.equal((await call('/admin/operations')).status,403);            // 团支书也没有
  // 同学也没有（前面的同学会话早被改密踢掉，这里新开一个同学账号）
  const studentSalt=randomBytes(16).toString('hex');
  await db.prepare("INSERT INTO users(id,student_id,display_name,role,salt,digest,created_at,must_change_password) VALUES(?,?,?,'student',?,?,?,0)").bind(randomUUID(),'integration-student2','测试同学二号',studentSalt,pbkdf2Sync(secret,studentSalt,100000,32,'sha256').toString('hex'),new Date().toISOString()).run();
  const student2=await call('/login','POST',{student_id:'integration-student2',name:'测试同学二号',password:secret});
  assert.equal(student2.status,200);
  cookie=student2.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await call('/admin/operations')).status,403);
  cookie=leadCookie;
  const ops=(await(await call('/admin/operations')).json()).operations;
  assert.ok(ops.length>=8,`应记录多条操作，实际 ${ops.length} 条`);
  assert.deepEqual(ops[0].notice_id,doomedId);assert.equal(ops[0].action,'删除');    // 最新一条排最前
  assert.equal(ops[0].notice_title,'准备删除的测试通知');                            // 通知没了，标题快照还在
  assert.equal(ops[0].actor_name,'测试班长');assert.equal(ops[0].actor_position,'班长');
  assert.equal(ops[0].detail,'含 1 条已读记录一并清除');
  const editLog=ops.find(o=>o.notice_id===freshId&&o.action==='编辑');
  // 这条编辑由最早的「测试班委」完成：他没有职位，日志里职位就是空串（前端只显示姓名）
  assert.ok(editLog,'应有 freshId 的编辑日志');assert.equal(editLog.detail,'修改了标题');assert.equal(editLog.actor_name,'测试班委');assert.equal(editLog.actor_position,'');
  const pinLog=ops.find(o=>o.notice_id===memberId&&o.action==='编辑');
  // 委员那次「置顶」顺带把标题改回 fresh.title，所以两个字段都算改动，顺序按字段表
  assert.ok(pinLog,'应有 memberId 的置顶日志');assert.equal(pinLog.detail,'修改了标题、置顶');assert.equal(pinLog.actor_name,'测试学习委员');
  assert.ok(ops.some(o=>o.notice_id===leadId&&o.action==='发布'));
  assert.ok(ops.some(o=>o.notice_id===peerId&&o.action==='撤销驳回'));
  // 只有「发布」与「删除」两条：被 403/409/400 挡下的尝试不该留下日志
  assert.deepEqual(ops.filter(o=>o.notice_id===doomedId).map(o=>o.action),['删除','发布']);
  // 老表 audit_log 不再写入（历史行由 0009 迁移回填到 operation_log）
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM audit_log').first()).n,0);
  // ---- 账号管理（仅班长）：激活进度与使用情况、重置密码（一次性临时密码）、强制下线 ----
  const student2Id=(await db.prepare('SELECT id FROM users WHERE student_id=?').bind('integration-student2').first()).id;
  const student2Again2=await call('/login','POST',{student_id:'integration-student2',name:'测试同学二号',password:secret});
  assert.equal(student2Again2.status,200);
  const student2Cookie=student2Again2.headers.get('Set-Cookie').split(';')[0];
  const accountsCall=async who=>{cookie=who;const r=await call('/admin/accounts');return {status:r.status,body:await r.json().catch(()=>({}))};};
  for(const who of [memberCookie,secretaryCookie,student2Cookie]){
    cookie=who;
    assert.equal((await call('/admin/accounts')).status,403);                                  // 委员、团支书、同学都看不到
    assert.equal((await call('/admin/accounts/'+student2Id+'/reset-password','POST',{})).status,403);
    assert.equal((await call('/admin/accounts/'+student2Id+'/logout-all','POST',{})).status,403);
  }
  const logCount=async()=>(await db.prepare('SELECT COUNT(*) AS n FROM account_log').first()).n;
  const logsAt=await logCount();
  assert.equal(logsAt,0);
  cookie=leadCookie;
  const leadAccounts=await accountsCall(leadCookie);
  assert.equal(leadAccounts.status,200);
  const target=leadAccounts.body.accounts.find(a=>a.id===student2Id);
  assert.ok(target,'列表应包含同学账号');
  assert.equal(target.display_name,'测试同学二号');assert.equal(target.must_change_password,false);
  assert.ok(target.last_login_at,'登录过就应有最后登录时间');
  assert.ok(target.sessions>=1,'刚登录过应至少有一台在线设备');
  assert.equal(leadAccounts.body.accounts[0].role,'committee');                                // 班委排在同学前面
  assert.equal(leadAccounts.body.accounts.length,(await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n);
  assert.ok(!JSON.stringify(leadAccounts.body).includes('digest')&&!JSON.stringify(leadAccounts.body).includes('salt'),'散列不能出现在接口里');
  cookie=leadCookie;
  assert.equal((await call('/admin/accounts/not-a-real-id/reset-password','POST',{})).status,404);
  cookie=memberCookie;
  await call('/admin/accounts/'+student2Id+'/reset-password','POST',{});                        // 被拒绝的那一次
  assert.equal(await logCount(),logsAt,'越权尝试不应留下账号操作记录');
  // 班长重置：返回一次性临时密码，旧会话立即失效，旧密码作废，本人必须改成自己的密码
  const digestBefore=(await db.prepare('SELECT digest FROM users WHERE id=?').bind(student2Id).first()).digest;
  cookie=leadCookie;
  const reset=await call('/admin/accounts/'+student2Id+'/reset-password','POST',{});
  assert.equal(reset.status,200);
  const resetBody=await reset.json();
  assert.match(resetBody.password,/^[A-Za-z2-9]{10}$/);
  assert.ok(!/[0O1lI]/.test(resetBody.password),'临时密码不含易混字符');
  assert.ok(!JSON.stringify(resetBody).includes('digest'),'重置响应里不能带散列');
  assert.ok(resetBody.devices>=1,'重置时应收割在线设备');
  const afterReset=await db.prepare('SELECT digest,must_change_password FROM users WHERE id=?').bind(student2Id).first();
  assert.notEqual(afterReset.digest,digestBefore);assert.equal(afterReset.must_change_password,1);
  cookie=student2Cookie;assert.equal((await call('/notices')).status,401);                      // 旧会话已失效
  assert.equal((await call('/login','POST',{student_id:'integration-student2',name:'测试同学二号',password:secret})).status,401);
  const tempLogin=await call('/login','POST',{student_id:'integration-student2',name:'测试同学二号',password:resetBody.password});
  assert.equal(tempLogin.status,200);assert.equal((await tempLogin.json()).user.must_change_password,true);
  cookie=tempLogin.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await call('/notices')).status,403);                                            // 改密之前业务接口不放行
  const ownSecret=randomBytes(12).toString('hex');
  const ownChanged=await call('/account/password','POST',{current_password:resetBody.password,new_password:ownSecret});
  assert.equal(ownChanged.status,200);assert.equal((await ownChanged.json()).user.must_change_password,false);
  const ownCookie=ownChanged.headers.get('Set-Cookie').split(';')[0];   // 首次改密换发新会话
  cookie=ownCookie;
  assert.equal((await call('/notices')).status,200);
  // 强制下线：密码不变，只让设备掉线（手机丢了或账号借给别人用完之后）
  cookie=leadCookie;
  const kick=await call('/admin/accounts/'+student2Id+'/logout-all','POST',{});assert.equal(kick.status,200);
  assert.ok((await kick.json()).revoked>=1);
  cookie=ownCookie;assert.equal((await call('/notices')).status,401);
  assert.equal((await call('/login','POST',{student_id:'integration-student2',name:'测试同学二号',password:ownSecret})).status,200);
  // 留痕：最新排最前，只记动作不记密码
  cookie=leadCookie;
  const accountLog=(await(await call('/admin/accounts')).json()).log;
  assert.equal(accountLog.length,2);
  assert.equal(accountLog[0].action,'强制下线');assert.equal(accountLog[1].action,'重置密码');
  assert.equal(accountLog[1].account_label,'测试同学二号（integration-student2）');
  assert.equal(accountLog[1].actor_name,'测试班长');assert.equal(accountLog[1].actor_position,'班长');
  assert.ok(accountLog[1].detail.includes('会话'));
  assert.ok(!JSON.stringify(accountLog).includes(resetBody.password),'临时密码不能出现在记录里');
  console.log('PASS: 姓名学号登录、首次改密、弱口令拦截、旧密码失效、全部会话撤销、限流、同学权限、个人已读隔离与跨设备同步、发布筛选置顶、并发编辑、待审隔离、解析导入审核归档、撤销归档与撤销驳回、推送订阅域名白名单与设备上限、日程订阅链接重置、通知列表 ETag 校验与发布后失效、班委职位与归档/编辑权限分级、班长永久删除与已读级联清理、班长专用操作日志（含删除留痕与越权 403）、班长账号管理（使用情况、一次性临时密码重置、强制下线与留痕，越权 403）。');
}finally{await mf.dispose();}
