import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {randomUUID,randomBytes,pbkdf2Sync} from 'node:crypto';
const args=process.argv.slice(2), remote=args.includes('--remote');
const value=key=>args[args.indexOf(key)+1];
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const run=sql=>JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','classboard-inbox',remote?'--remote':'--local','--command',sql,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const apply=async sql=>{await mkdir('work',{recursive:true});const file='work/accounts-'+randomUUID()+'.sql';try{await writeFile(file,sql,{mode:0o600});execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','classboard-inbox',remote?'--remote':'--local','--file',file,'--yes'],{stdio:['ignore','pipe','pipe']});}finally{await unlink(file).catch(()=>{});}};
try{
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const secret=input.trim();input='';if(secret.length<8||secret.length>256)throw Error('请通过标准输入提供 8—256 位初始化密码');
  const credentials=()=>{const salt=randomBytes(16).toString('hex');return [salt,pbkdf2Sync(secret,salt,100000,32,'sha256').toString('hex')];};
  if(args.includes('--reset')){
    const id=value('--reset');const found=run('SELECT id FROM users WHERE student_id='+quote(id))[0].results;
    if(found.length!==1)throw Error('未找到唯一账号');const [salt,digest]=credentials();
    await apply(`UPDATE users SET salt=${quote(salt)},digest=${quote(digest)},must_change_password=1 WHERE id=${quote(found[0].id)}; DELETE FROM user_sessions WHERE user_id=${quote(found[0].id)};`);
    console.log('密码已重置，所有会话已失效，需首次改密。');
  }else{
    if(!args.includes('--roster')||!args.includes('--committee'))throw Error('需要 --roster JSON路径 和 --committee 姓名');
    const rows=JSON.parse((await readFile(value('--roster'),'utf8')).replace(/^\uFEFF/,''));const committee=value('--committee');
    if(!Array.isArray(rows)||!rows.length)throw Error('名单为空');
    const seen=new Set();for(const r of rows){if(typeof r.name!=='string'||!r.name.trim()||typeof r.student_id!=='string'||!/^\d+$/.test(r.student_id)||seen.has(r.student_id))throw Error('名单有缺失字段或重复学号');seen.add(r.student_id);}
    if(rows.filter(r=>r.name===committee).length!==1)throw Error('班委姓名未唯一匹配');
    const existing=run('SELECT student_id,display_name,role FROM users')[0].results;
    for(const r of rows){const old=existing.find(x=>x.student_id===r.student_id);if(old&&(old.display_name!==r.name||old.role!==(r.name===committee?'committee':'student')))throw Error('现有账号与名单姓名或角色冲突，导入已停止');}
    const fresh=rows.filter(r=>!existing.some(x=>x.student_id===r.student_id));
    const sql=fresh.map(r=>{const [salt,digest]=credentials();return `INSERT INTO users(id,student_id,display_name,role,salt,digest,created_at) VALUES(${[randomUUID(),r.student_id,r.name,r.name===committee?'committee':'student',salt,digest,new Date().toISOString()].map(quote).join(',')});`;}).join('\n');
    if(sql)await apply(sql);
    console.log(`名单 ${rows.length} 人，新增 ${fresh.length} 人，跳过 ${rows.length-fresh.length} 人；班委 1 人，同学 ${rows.length-1} 人。`);
  }
}catch(e){console.error(e.status!==undefined?'数据库操作失败，未输出数据库内容；请检查认证和迁移状态。':e.message);process.exitCode=1;}
