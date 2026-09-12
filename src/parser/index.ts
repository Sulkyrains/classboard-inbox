import { categories,emptyNotice,type Category,type Draft } from '../shared/types';

export interface ParseContext { referenceDate: string; timeZone?: 'Asia/Shanghai' }
export interface ParseResult { drafts: Draft[]; engine: 'rules'|'llm'; warnings: string[]; ignored: number }
export interface ParserAdapter { name: string; parse(text: string, context: ParseContext, signal: AbortSignal): Promise<unknown> }
const DATE_PATTERN=/(?:20\d{2}[年/.-])?\d{1,2}[月/.-]\d{1,2}日?|大后天|后天|明天|明早|明晚|今天|今晚|今早|(?:下下|下|本|这)?(?:周|星期)[一二三四五六日天]/g;
const TIME_PATTERN=/(凌晨|早上|上午|中午|下午|晚上|傍晚|晚)?\s*(\d{1,2})(?:[:：](\d{2})|[点时](?:(半)|(?:(\d{1,2})分?)?)?)/;
// Require a time separator: a bare day number must never be interpreted as an hour.
const HAS_TIME=/\d{1,2}(?:[:：]\d{2}|[点时])/;
const midnight=(date: Date)=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
const pad=(n:number)=>String(n).padStart(2,'0');

function resolveDay(token:string,base:Date,warnings:string[]):Date|null{
  const day=midnight(base);
  const rel:Record<string,number>={今天:0,今晚:0,今早:0,明天:1,明早:1,明晚:1,后天:2,大后天:3};
  if(token in rel){day.setUTCDate(day.getUTCDate()+rel[token]);return day;}
  const week=token.match(/^(下下|下|本|这)?(?:周|星期)([一二三四五六日天])$/);
  if(week){const target='一二三四五六日'.indexOf(week[2]==='天'?'日':week[2]);const current=(day.getUTCDay()+6)%7;let delta=target-current+(week[1]==='下下'?14:week[1]==='下'?7:0);if(!week[1]&&delta<0){delta+=7;warnings.push(`“${token}”按下一个对应星期解析，请核对。`);}day.setUTCDate(day.getUTCDate()+delta);return day;}
  const absolute=token.match(/^(?:(20\d{2})[年/.-])?(\d{1,2})[月/.-](\d{1,2})日?$/);
  if(!absolute)return null;
  let year=Number(absolute[1]||day.getUTCFullYear()),month=Number(absolute[2]),date=Number(absolute[3]);
  let candidate=new Date(Date.UTC(year,month-1,date));
  if(!absolute[1]&&day.getTime()-candidate.getTime()>180*86400000){year++;candidate=new Date(Date.UTC(year,month-1,date));warnings.push(`“${token}”按跨年日期解析，请核对年份。`);}
  if(candidate.getUTCFullYear()!==year||candidate.getUTCMonth()!==month-1||candidate.getUTCDate()!==date){warnings.push(`“${token}”不是有效日期，请手动修正。`);return null;}
  return candidate;
}
function classify(text:string):Category{
  if(/作业|习题|实验报告|论文|题目|练习册/.test(text))return '作业';
  if(/调课|停课|上课|补课|教室|英语课|数学课|课程|课表/.test(text))return '课程';
  if(/班会|班委|缴费|信息核对|材料|登记表|收集|会议/.test(text))return '事务';
  if(/活动|志愿|比赛|竞赛|运动会|讲座|报名|迎新/.test(text))return '活动';
  return '事务';
}
function segments(text:string,reference:string){
  const lines=text.replace(/\r\n?/g,'\n').replace(/[\u200b-\u200d\ufeff]/g,'').split('\n');
  const chunks:{text:string;date:string}[]=[];let current='',date=reference;
  const push=()=>{if(current.trim())chunks.push({text:current.trim(),date});current='';};
  for(const raw of lines){
    const line=raw.trim();
    const stamp=line.match(/^(?:.{0,40}?\s+)?(20\d{2}[/-]\d{1,2}[/-]\d{1,2})\s+(\d{1,2}:\d{2})(?::\d{2})?\s*[:：]?\s*(.*)$/);
    if(stamp){push();const [y,m,d]=stamp[1].split(/[/-]/);const [h,min]=stamp[2].split(':');date=`${y}-${pad(+m)}-${pad(+d)}T${pad(+h)}:${min}:00+08:00`;current=stamp[3];continue;}
    if(!line){push();continue;}
    if(/^\d+[、.)）]\s*/.test(line)&&current){push();}
    current+=(current?'\n':'')+line.replace(/^\d+[、.)）]\s*/,'');
  }
  push();return chunks;
}
function parseOne(text:string,reference:string):Draft|null{
  if(text.length<30&&/(?:通知群|群聊|聊天记录)$/.test(text))return null;
  if(!/通知|作业|习题|报告|提交|截止|上交|报名|集合|班会|活动|课程|课|考试|材料|缴费|核对|会议|竞赛|比赛|讲座/.test(text))return null;
  if(/^(收到|好的|谢谢|辛苦|明白|了解|[嗯哦])[！!。，,\s]*(谢谢老师|老师|班长)?[！!。，,\s]*$/.test(text))return null;
  const warnings:string[]=[];
  const base=new Date(Date.parse(reference)+8*3600000);
  if(!Number.isFinite(base.getTime()))throw new Error('请提供有效的消息基准时间');
  const parsed:{iso:string|null;deadline:boolean;token:string}[]=[];
  const matches=Array.from(text.matchAll(DATE_PATTERN));
  for(let i=0;i<matches.length;i++){
    const match=matches[i],start=match.index!,end=start+match[0].length;
    const next=matches[i+1]?.index??text.length;
    const after=text.slice(end,next).split(/[，,。；;\n]/)[0];
    const before=text.slice(0,start).split(/[，,。；;\n]/).at(-1)||'';
    const context=before+match[0]+after;
    const deadline=/截止|之前|以前|前(?:提交|交|完成|报名|上交)?|最晚|提交|上交|交到|交给|交报告/.test(context)&&!/提前\s*\d+\s*分钟/.test(context);
    const day=resolveDay(match[0],base,warnings);
    const time=HAS_TIME.test(after)?after.match(TIME_PATTERN):null;
    let iso:string|null=null;
    if(day&&time){let hour=Number(time[2]),minute=Number(time[3]||time[5]||(time[4]?'30':'0'));const period=time[1]||(match[0].includes('晚')?'晚上':match[0].includes('早')?'早上':'');
      if(['下午','晚上','晚','傍晚'].includes(period)&&hour<12)hour+=12;
      if(period==='中午'&&hour>=1&&hour<=6)hour+=12;
      if(period==='凌晨'&&hour===12)hour=0;
      if(hour>23||minute>59){warnings.push(`“${match[0]+time[0]}”时间无效，请手动修正。`);}
      else iso=new Date(`${day.getUTCFullYear()}-${pad(day.getUTCMonth()+1)}-${pad(day.getUTCDate())}T${pad(hour)}:${pad(minute)}:00+08:00`).toISOString();
    }else if(day){warnings.push(`“${match[0]}”未明确几点，时间留空待确认。`);}
    parsed.push({iso,deadline,token:match[0]});
  }
  let deadline: string|null=null,event:string|null=null;
  for(const p of parsed){if(p.deadline){if(deadline&&p.iso!==deadline)warnings.push('识别到多个截止时间，请核对或拆分通知。');else deadline=p.iso;}else{if(event&&p.iso!==event)warnings.push('识别到多个活动时间，请核对或拆分通知。');else event=p.iso;}}
  if(!parsed.length&&HAS_TIME.test(text))warnings.push('仅识别到钟点，缺少明确日期；请手动补充时间。');
  if(deadline&&event&&Date.parse(deadline)>Date.parse(event))warnings.push('截止时间晚于活动时间，请核对日期或原消息发送时间。');
  if(/取消|延期|改期|推迟|改为/.test(text))warnings.push('原文包含变更信息，请核对新时间，并处理旧通知。');
  const mentions=Array.from(text.matchAll(/[@＠]([^\s@＠，,。；;：:！!]+)/g),m=>m[1]);
  let location=text.match(/(?:地点|教室)\s*[:：]\s*([^，,。；;\n]{1,50})/)?.[1]||text.match(/(?:改到|改至|调整至|在|到)\s*((?:教[一二三四五六七八九十\d]+\s*\d{2,4}|[A-Z]\s*[-－]?\d{2,4}|[^，,。；;\n\s]{0,12}(?:图书馆|活动中心|操场|体育馆|报告厅|会议室|礼堂|教室)(?:[一二三四五六七八九十\d]+楼)?\s*\d{0,4}))/)?.[1]||'';
  location=location.trim();
  const cleaned=text.replace(/[@＠][^\s@＠，,。；;：:！!]+/g,'').replace(/^[^\n:：]{1,12}[:：]\s*/,'').trim();
  let title=cleaned.split(/[。！!\n]/)[0].replace(/^【通知】\s*/,'').trim();
  if(title.length>42)title=title.slice(0,41)+'…';
  if(!title)title=`${classify(text)}通知`;
  return {...emptyNotice(),title,body:text,category:classify(text),location,audience:[...new Set(mentions)].join('、'),event_at:event,deadline_at:deadline,source_text:text,warnings:[...new Set(warnings)]};
}
export function parseRules(text:string,context:ParseContext):ParseResult{
  if(!text.trim())return {drafts:[],engine:'rules',warnings:['请先粘贴群聊文本。'],ignored:0};
  if(text.length>20000)throw new Error('单次最多解析 20000 字，请分批导入');
  if(!Number.isFinite(Date.parse(context.referenceDate)))throw new Error('请提供有效的消息基准时间');
  const parts=segments(text,context.referenceDate);const drafts:Draft[]=[];let ignored=0;
  for(const part of parts){const draft=parseOne(part.text,part.date);if(draft)drafts.push(draft);else ignored++;}
  return {drafts,engine:'rules',warnings:drafts.length?[]:['未识别到通知事项，可以补充内容后重试。'],ignored};
}
function validDraft(value:unknown):value is Draft{
  if(!value||typeof value!=='object')return false;const d=value as Draft;
  return typeof d.title==='string'&&d.title.trim().length>0&&d.title.length<=100&&typeof d.body==='string'&&d.body.trim().length>0&&d.body.length<=10000&&categories.includes(d.category)&&typeof d.location==='string'&&d.location.length<=200&&typeof d.audience==='string'&&d.audience.length<=300&&[d.event_at,d.deadline_at].every(x=>x===null||typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x)))&&Array.isArray(d.warnings)&&d.warnings.every(x=>typeof x==='string');
}
export async function parseMessages(text:string,context:ParseContext,adapter?:ParserAdapter,timeoutMs=8000):Promise<ParseResult>{
  const fallback=parseRules(text,context);if(!adapter)return fallback;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const result=await Promise.race([adapter.parse(text,context,controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},timeoutMs);})]);
    const drafts=(result as {drafts?:unknown})?.drafts;
    if(!Array.isArray(drafts)||!drafts.length||drafts.length>30||!drafts.every(validDraft))throw new Error('invalid schema');
    return {drafts:drafts.map(d=>({...d,pinned:false,source_text:text,warnings:[...d.warnings,'由增强解析生成，请对照原文确认信息。']})),engine:'llm',warnings:[],ignored:0};
  }catch{return {...fallback,warnings:[...fallback.warnings,'增强解析暂不可用，已自动使用规则解析。']};}
  finally{if(timer)clearTimeout(timer);controller.abort();}
}
