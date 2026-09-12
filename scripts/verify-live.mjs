import assert from 'node:assert/strict';
const origin=process.argv[2]||'https://classboard-inbox.pages.dev';
const get=path=>fetch(origin+path,{signal:AbortSignal.timeout(20000)});
const page=await get('/');assert.equal(page.status,200);assert.match(await page.text(),/知会/);assert.match(page.headers.get('Content-Security-Policy')||'',/frame-ancestors 'none'/);
const health=await get('/api/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
const all=await get('/api/notices');assert.equal(all.status,200);const {notices}=await all.json();assert.ok(Array.isArray(notices));assert.ok(notices.length>0);
for(const n of notices){assert.equal(n.status,'published');assert.equal(n.source_text,undefined);assert.equal(n.warnings,undefined);}
const filtered=await(await get('/api/notices?category='+encodeURIComponent('作业'))).json();assert.ok(filtered.notices.every(n=>n.category==='作业'));
assert.equal((await get('/api/admin/notices')).status,401);
assert.equal((await get('/api/notices/does-not-exist')).status,404);
assert.equal((await fetch(origin+'/api/admin/import',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({drafts:[],source:'text'}),signal:AbortSignal.timeout(20000)})).status,401);
assert.equal((await fetch(origin+'/api/admin/notices',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)})).status,403);
const session=await(await get('/api/session')).json();assert.equal(session.admin,null);
console.log(`PASS: ${origin} 页面、D1 数据、分类筛选、公开字段、未登录写入拒绝、跨站请求拒绝。公开通知 ${notices.length} 条。`);
