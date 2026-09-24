import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {randomUUID,randomBytes,randomInt,pbkdf2Sync} from 'node:crypto';
const args=process.argv.slice(2), remote=args.includes('--remote');
const value=key=>args[args.indexOf(key)+1];
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const run=sql=>JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','classboard-inbox',remote?'--remote':'--local','--command',sql,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const apply=async sql=>{await mkdir('work',{recursive:true});const file='work/accounts-'+randomUUID()+'.sql';try{await writeFile(file,sql,{mode:0o600});execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','classboard-inbox',remote?'--remote':'--local','--file',file,'--yes'],{stdio:['ignore','pipe','pipe']});}finally{await unlink(file).catch(()=>{});}};
/** 去掉 0/O/o、1/l/I 等易读错的字符：初始密码要靠口头或纸条转达。 */
const ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const newPassword=(length=10)=>Array.from({length},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');
/** 每人一份独立的随机密码：共享同一个初始密码，等于让任何知情者都能抢先登录别人的账号。 */
const credentials=secret=>{const salt=randomBytes(16).toString('hex');return [salt,pbkdf2Sync(secret,salt,100000,32,'sha256').toString('hex')];};
const csvCell=s=>/[",\r\n]/.test(String(s))?'"'+String(s).replaceAll('"','""')+'"':String(s);
/** 密码只落在这一个 0600 权限的本地文件里，不进控制台、不进 Git、不进静态资源。 */
const writeSecrets=async rows=>{
  await mkdir('work',{recursive:true});
  const file='work/initial-passwords.csv';
  const csv='\ufeff姓名,学号,角色,初始密码\n'+rows.map(r=>[r.name,r.student_id,r.role==='committee'?'班委':'同学',r.password].map(csvCell).join(',')).join('\n')+'\n';
  await writeFile(file,csv,{mode:0o600});
  return file;
};
const handOut=file=>console.log(`密码写入 ${file}。请逐人当面或私聊发放，发完删除该文件；不要发到群里，也不要提交到 Git。`);
const readStdin=async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;return input.trim();};
try{
  if(args.includes('--status')){
    const rows=run("SELECT student_id,display_name,role,COALESCE(position,'') AS position,must_change_password FROM users ORDER BY must_change_password DESC,student_id")[0].results;
    const idle=rows.filter(r=>r.must_change_password);
    for(const r of rows)console.log(`${r.must_change_password?'未激活':'已激活'}  ${r.student_id}  ${r.display_name}${r.role==='committee'?`（${r.position||'班委'}）`:''}`);
    console.log(`\n共 ${rows.length} 人：已激活 ${rows.length-idle.length} 人，未激活 ${idle.length} 人。未激活账号的初始密码仍然有效，请尽快催促本人登录改密。`);
  }else if(args.includes('--reissue')){
    // 已激活的账号用的是本人设的密码，不动；只给还没登录过的账号各换一份新的独立随机密码。
    const rows=run('SELECT id,student_id,display_name,role FROM users WHERE must_change_password=1 ORDER BY student_id')[0].results;
    const settled=run('SELECT COUNT(*) AS n FROM users WHERE must_change_password=0')[0].results[0].n;
    if(!rows.length)throw Error(`没有待重发的账号：${settled} 人都已经自行改过密码。`);
    const issued=rows.map(r=>({...r,name:r.display_name,password:newPassword()}));
    await apply(issued.map(r=>{const [salt,digest]=credentials(r.password);return `UPDATE users SET salt=${quote(salt)},digest=${quote(digest)},must_change_password=1 WHERE id=${quote(r.id)}; DELETE FROM user_sessions WHERE user_id=${quote(r.id)};`;}).join('\n'));
    console.log(`已为 ${issued.length} 个未激活账号各生成一份新的随机密码，并撤销其现有会话；${settled} 个已激活账号未受影响。`);
    handOut(await writeSecrets(issued));
  }else if(args.includes('--positions')){
    // 职位表含真实姓名与学号，不进 Git；这里读本地 0600 权限的名单文件写入。
    const rows=JSON.parse((await readFile(value('--positions'),'utf8')).replace(/^\ufeff/,''));
    if(!Array.isArray(rows)||!rows.length)throw Error('职位名单为空');
    const seen=new Set();for(const r of rows){if(typeof r.student_id!=='string'||!/^\d+$/.test(r.student_id)||typeof r.position!=='string'||!r.position.trim()||r.position.length>20||seen.has(r.student_id))throw Error('职位名单有缺失字段、重复学号或职位名过长');seen.add(r.student_id);}
    const known=new Set(run('SELECT student_id FROM users')[0].results.map(r=>r.student_id));
    const missing=rows.filter(r=>!known.has(r.student_id));
    if(missing.length)throw Error(`有 ${missing.length} 个学号在账号表里不存在，未做任何修改`);
    await apply(rows.map(r=>`UPDATE users SET role='committee',position=${quote(r.position)} WHERE student_id=${quote(r.student_id)};`).join('\n')+'\nUPDATE notice_feed SET version=version+1 WHERE id=1;');
    const tally=rows.reduce((acc,r)=>(acc[r.position]=(acc[r.position]||0)+1,acc),{});
    console.log(`已写入 ${rows.length} 个职位：${Object.entries(tally).map(([p,n])=>`${p} ${n} 人`).join('、')}。职位已生效，客户端缓存已失效。`);
  }else if(args.includes('--reset')){
    const id=value('--reset');const found=run('SELECT id,display_name FROM users WHERE student_id='+quote(id))[0].results;
    if(found.length!==1)throw Error('未找到唯一账号');
    const typed=await readStdin();
    if(typed&&(typed.length<8||typed.length>256))throw Error('手动指定的临时密码需为 8—256 位；留空则自动生成');
    const secret=typed||newPassword();
    const [salt,digest]=credentials(secret);
    await apply(`UPDATE users SET salt=${quote(salt)},digest=${quote(digest)},must_change_password=1 WHERE id=${quote(found[0].id)}; DELETE FROM user_sessions WHERE user_id=${quote(found[0].id)};`);
    console.log(`${found[0].display_name}（${id}）的密码已重置，所有会话已失效，需首次改密。`);
    if(!typed)console.log(`临时密码：${secret}\n请当面或私聊转达本人，不要发到群里。`);
  }else{
    if(!args.includes('--roster')||!args.includes('--committee'))throw Error('需要 --roster JSON路径 和 --committee 姓名（或 --positions JSON路径 写入班委职位、--status 查看激活情况、--reissue 重发全部未激活账号、--reset 学号 重置单人）');
    const rows=JSON.parse((await readFile(value('--roster'),'utf8')).replace(/^\ufeff/,''));const committee=value('--committee');
    if(!Array.isArray(rows)||!rows.length)throw Error('名单为空');
    const seen=new Set();for(const r of rows){if(typeof r.name!=='string'||!r.name.trim()||typeof r.student_id!=='string'||!/^\d+$/.test(r.student_id)||seen.has(r.student_id))throw Error('名单有缺失字段或重复学号');seen.add(r.student_id);}
    if(rows.filter(r=>r.name===committee).length!==1)throw Error('班委姓名未唯一匹配');
    const existing=run('SELECT student_id,display_name,role FROM users')[0].results;
    // 名单里的班委只有 --committee 一个；库里其它班委（职位见 --status）属于正常的职务调整，不算冲突。
    for(const r of rows){const old=existing.find(x=>x.student_id===r.student_id);if(old&&(old.display_name!==r.name||(r.name===committee&&old.role!=='committee')))throw Error('现有账号与名单姓名或角色冲突，导入已停止');}
    const fresh=rows.filter(r=>!existing.some(x=>x.student_id===r.student_id));
    const issued=fresh.map(r=>({...r,role:r.name===committee?'committee':'student',password:newPassword()}));
    const sql=issued.map(r=>{const [salt,digest]=credentials(r.password);return `INSERT INTO users(id,student_id,display_name,role,salt,digest,created_at) VALUES(${[randomUUID(),r.student_id,r.name,r.role,salt,digest,new Date().toISOString()].map(quote).join(',')});`;}).join('\n');
    if(sql)await apply(sql);
    console.log(`名单 ${rows.length} 人，新增 ${fresh.length} 人，跳过 ${rows.length-fresh.length} 人；班委职位与授权情况请用 --status 查看。`);
    if(issued.length)handOut(await writeSecrets(issued));
    else console.log('没有新增账号，未生成密码文件。要给已有的未激活账号重发密码，请使用 --reissue。');
  }
}catch(e){console.error(e.status!==undefined?'数据库操作失败，未输出数据库内容；请检查认证和迁移状态。':e.message);process.exitCode=1;}
