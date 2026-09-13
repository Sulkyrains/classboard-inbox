import assert from 'node:assert/strict';
const origin=process.argv[2]||'https://classboard-inbox.pages.dev';
const get=path=>fetch(origin+path,{signal:AbortSignal.timeout(20000)});
const page=await get('/');assert.equal(page.status,200);assert.match(await page.text(),/知会/);assert.match(page.headers.get('Content-Security-Policy')||'',/frame-ancestors 'none'/);
assert.equal((await get('/api/health')).status,200);
for(const path of ['/api/notices','/api/notices?category=作业','/api/notices/demo-01','/api/admin/notices','/api/account/reads']){
  const result=await get(path);assert.equal(result.status,401);assert.deepEqual(Object.keys(await result.json()),['error']);
}
assert.equal((await fetch(origin+'/api/admin/import',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,401);
assert.equal((await fetch(origin+'/api/admin/notices',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'})).status,403);
assert.deepEqual(await(await get('/api/session')).json(),{user:null});
const manifestResponse=await get('/manifest.webmanifest');assert.equal(manifestResponse.status,200);
const manifest=await manifestResponse.json();assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');
await Promise.all(manifest.icons.map(async icon=>{const response=await get(icon.src);assert.equal(response.status,200);assert.match(response.headers.get('Content-Type')||'',/image\/png/);}));
const sw=await get('/sw.js');assert.equal(sw.status,200);assert.match(sw.headers.get('Cache-Control')||'',/no-cache/);assert.ok(!(await sw.text()).includes('__BUILD_VERSION__'));
const offline=await get('/offline.html');assert.equal(offline.status,200);assert.match(await offline.text(),/暂时无法连接网络/);
console.log('PASS: 线上页面、登录门禁、个人信息隔离、游客写入拒绝、跨站请求拒绝、PWA 安装清单、图标、版本化 Service Worker 与离线页。');
