import { mkdir,writeFile,unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const day = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const at = (offset,time) => {const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return new Date(d.toISOString().slice(0,10)+'T'+time+':00+08:00').toISOString();};
const rows=[
  ['demo-01','关于本周高等数学作业的提交说明','请完成第三章习题 1—8 题，将解题过程整理为 PDF，上传至学习通。文件命名：班级 + 姓名 + 第三章作业。如有疑问，请在课前与学习委员联系。','作业','学习通','全体同学',null,at(1,'20:00'),1],
  ['demo-02','周五班会 · 新学期，一起出发','本周班会将讨论新学期班级安排、班委分工和近期活动。请大家提前 10 分钟到场，并带上对班级建设的小建议。','事务','教三 201','全体同学',at(2,'15:00'),null,0],
  ['demo-03','校园志愿服务活动开始报名啦','图书馆志愿服务招募中！活动内容包括图书整理和借阅引导。请有意向的同学在截止前联系团支书登记，活动当天在图书馆门口集合。','活动','图书馆','志愿报名同学',at(3,'09:00'),at(2,'12:00'),0],
  ['demo-04','英语课教室调整通知','明天上午的大学英语课调整至教二 305，上课时间不变。请大家相互转告，带好教材与课堂练习。','课程','教二 305','全体同学',at(1,'08:00'),null,0],
  ['demo-05','新学期信息核对提醒','请核对本学期选课结果及班级信息。发现遗漏或错误时，请联系学习委员汇总处理。此条为演示通知。','事务','教务系统','全体同学',null,at(5,'18:00'),0],
  ['demo-06','上周实验报告提交','上周实验报告提交已结束。如需补交，请与任课老师联系。此条用于演示过期筛选。','作业','课程平台','实验课同学',null,at(-1,'18:00'),0]
];
const q=v=>v===null?'NULL':typeof v==='number'?String(v):`'${v.replaceAll("'","''")}'`;
const now=new Date().toISOString();
const sql=rows.map(r=>`INSERT OR IGNORE INTO notices(id,title,body,category,location,audience,event_at,deadline_at,pinned,status,author_name,created_at,updated_at,published_at) VALUES(${r.map(q).join(',')},'published','示例班委',${q(now)},${q(now)},${q(now)});`).join('\n');
await mkdir('work',{recursive:true});await writeFile('work/seed.sql',sql);
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','classboard-inbox',process.argv.includes('--remote')?'--remote':'--local','--file','work/seed.sql'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
await unlink('work/seed.sql');process.exitCode=result.status||0;
