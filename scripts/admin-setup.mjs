// Operator-only, loopback setup. No public registration endpoint and no default account.
// Passwords entered by the operator are never printed, saved to disk, or echoed by this script.
import { createServer } from 'node:http';
import { randomBytes,randomUUID,pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir,writeFile,unlink } from 'node:fs/promises';
const remote=process.argv.includes('--remote');
const port=8790,origin=`http://127.0.0.1:${port}`;
let saving=false;
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>知会 · 创建班委账号</title><style>body{font:16px/1.8 system-ui;background:#f3f6fc;color:#263956;max-width:440px;margin:70px auto;padding:24px}form{padding:30px;background:white;border-radius:16px}h1{font-size:24px}label{display:block;margin:18px 0}input,button{box-sizing:border-box;width:100%;padding:12px;border:1px solid #dbe3f2;border-radius:8px;font:inherit}button{background:#285be8;color:white}small{color:#8796ac}</style><form method="POST" action="/create"><h1>创建班委账号</h1><p>目标：${remote?'线上数据库':'本地数据库'}</p><label>账号<input name="username" required pattern="[a-zA-Z0-9_-]{3,32}" autocomplete="username"></label><label>显示名称<input name="display_name" required maxlength="32"></label><label>密码<input type="password" name="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label>再次输入密码<input type="password" name="repeat" required minlength="12" maxlength="128" autocomplete="new-password"></label><button>创建账号</button><small>密码至少 12 位。创建成功后本工具自动关闭。</small></form></html>`;
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('X-Frame-Options','DENY');
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end('不允许访问');}
  if(req.method==='GET'&&req.url==='/')return res.end(html);
  if(req.method!=='POST'||req.url!=='/create'||req.headers.origin!==origin){res.writeHead(403);return res.end('不允许访问');}
  if(saving){res.writeHead(409);return res.end('正在创建，请稍候');}
  let body='';for await(const c of req){body+=c;if(body.length>4096){res.writeHead(413);return res.end('请求过长');}}
  const f=new URLSearchParams(body);const username=(f.get('username')||'').toLowerCase(),display=(f.get('display_name')||'').trim(),secret=f.get('password')||'';
  if(!/^[a-z0-9_-]{3,32}$/.test(username)||!display||display.length>32||secret.length<12||secret.length>128||secret!==f.get('repeat')||secret!==secret.trim()){res.writeHead(400);return res.end('账号、显示名称或两次密码不符合要求，请返回修改。密码首尾不能为空格。');}
  saving=true;const salt=randomBytes(16).toString('hex');const digest=pbkdf2Sync(secret,salt,100000,32,'sha256').toString('hex');
  const q=s=>`'${s.replaceAll("'","''")}'`;
  const file='work/admin-once.sql';
  try{
    await mkdir('work',{recursive:true});
    await writeFile(file,`INSERT INTO admins(id,username,display_name,salt,digest,created_at) VALUES(${[randomUUID(),username,display,salt,digest,new Date().toISOString()].map(q).join(',')});`,{mode:0o600});
    const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','classboard-inbox',remote?'--remote':'--local','--file',file],{encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    if(result.status!==0){res.writeHead(500);res.end('创建未成功：请确认数据库已迁移、账号未被占用，线上操作还需完成 Wrangler 登录。');saving=false;}
    else{res.end('<h1>班委账号已创建</h1><p>可以关闭本页，回到看板登录。</p>');console.log('班委账号创建成功。');server.close();}
  }catch{res.writeHead(500);res.end('创建失败，请重试。');saving=false;}finally{await unlink(file).catch(()=>{});}
});
server.listen(port,'127.0.0.1',()=>console.log(`请在浏览器打开 ${origin} 创建${remote?'线上':'本地'}班委账号。`));
