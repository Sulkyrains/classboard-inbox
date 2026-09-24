import { categories,emptyNotice,type Category,type Draft } from '../shared/types';
import { draftTimeIssues } from '../shared/times';

export interface ParseContext { referenceDate: string; timeZone?: 'Asia/Shanghai' }
export interface ParseResult { drafts: Draft[]; engine: 'rules'|'llm'; warnings: string[]; ignored: number; skipped: {text:string;reason:string}[] }
export interface ParserAdapter { name: string; parse(text: string, context: ParseContext, signal: AbortSignal): Promise<unknown> }
const CN_NUM='[一二三四五六七八九十两]{1,3}';
/** 认识的时间写法：绝对日期（含中文数字）、相对日、周几与周末、月初月底、X 天/周/月内（后）。 */
const DATE_SOURCE=[
  // 月日要在 1-12 / 1-31 内，否则「9:00-11:00」这种时段会被当成日期；日要按长优先，免得「12日」被截成「1」。
  '(?:20\\d{2}[年/.-])?(?:1[0-2]|0?[1-9])[月/.-](?:3[01]|[12]\\d|0?[1-9])日?',
  `(?:20\\d{2}年)?${CN_NUM}月${CN_NUM}[号日]`,
  `${CN_NUM}月(?:初|底)`,
  // 「十五号」这类号数只认 号，且排除「一号楼 / 一号线」等量词用法。
  `${CN_NUM}号(?![\\d线楼门院班车店])`,
  '大后天|后天|明天|明早|明晚|今天|今晚|今早',
  '(?:下下|下|本|这)?(?:周|星期)[一二三四五六日天]',
  '(?:下下|下|本|这)?(?:周|星期)末',
  '下下月底|下月底|本月底|月底|下下月初|下月初|本月初|月初',
  '(?:\\d{1,3}|[一二三四五六七八九十]{1,3})(?:天|周|星期|个月)[内后]',
  '半个月[内后]',
].join('|');
const DATE_PATTERN=new RegExp(DATE_SOURCE,'g');
const HAS_DATE=new RegExp(DATE_SOURCE);
const HOUR='\\d{1,2}|[一二三四五六七八九十两]{1,3}';
const TIME_PATTERN=new RegExp(`(凌晨|早上|上午|中午|下午|晚上|傍晚)?\\s*(${HOUR})(?:[:：](\\d{2})|[点时](?:(半)|(?:(\\d{1,2})分?)?)?)`);
// 必须带分隔符或「点/时」：光有数字不算钟点，免得把「第3章」当成 3 点。
const HAS_TIME=new RegExp('(?:\\d{1,2}(?:[:：]\\d{2}|[点时]))|(?:[一二三四五六七八九十两]{1,3}[点时])');
const RANGE_PATTERN=/(\d{1,2}(?:[:：]\d{2}|[点时](?:半|\d{1,2}分?)?))\s*(?:[-–—~～]|到|至)\s*(\d{1,2}(?:[:：]\d{2}|[点时](?:半|\d{1,2}分?)?))/;
const SPAN_TOKEN=new RegExp('^(?:(?:\\d{1,3}|[一二三四五六七八九十]{1,3})(?:天|周|星期|个月)[内后]|半个月[内后])$');
/** 只写了「早上/晚上」没写几点时的常用钟点，草稿里会带提醒。 */
const PERIOD_HOUR:Record<string,number>={凌晨:5,早上:8,早:8,上午:9,中午:12,下午:14,傍晚:18,晚上:19,晚:19};
const KEYWORDS=/通知|作业|习题|报告|提交|截止|上交|报名|集合|班会|活动|课程|课|考试|材料|缴费|核对|会议|竞赛|比赛|讲座/;
const CHATTER=/^(?:收到|好的|好嘞|好呀|谢谢|谢谢老师|谢谢班长|辛苦|辛苦了|明白|了解|嗯+|哦+|OK|ok|点赞)[！!。，,、~～\s]*(?:谢谢老师|谢谢班长|老师|班长)?[！!。，,、~～\s]*$/;
const DAY_MS=86400000;
const midnight=(date: Date)=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
const pad=(n:number)=>String(n).padStart(2,'0');
const makeIso=(day:Date,hour:number,minute:number)=>new Date(`${day.getUTCFullYear()}-${pad(day.getUTCMonth()+1)}-${pad(day.getUTCDate())}T${pad(hour)}:${pad(minute)}:00+08:00`).toISOString();
const CN_DIGITS='零一二三四五六七八九';
function cnNumber(value:string):number{
  if(/^\d{1,3}$/.test(value))return Number(value);
  const v=value.replace(/两/g,'二');
  if(v==='十')return 10;
  if(v.length===1)return CN_DIGITS.indexOf(v);
  if(v[0]==='十')return 10+CN_DIGITS.indexOf(v[1]);
  if(v[1]==='十')return CN_DIGITS.indexOf(v[0])*10+(v[2]?CN_DIGITS.indexOf(v[2]):0);
  return NaN;
}
interface Clock{hour:number;minute:number;raw:string;period:string}
function clockIn(segment:string,fallback=''):Clock|null{
  const m=segment.match(TIME_PATTERN);
  if(!m)return null;
  const hour=cnNumber(m[2]);
  if(!Number.isFinite(hour))return null;
  return {hour,minute:Number(m[3]||(m[4]?30:m[5]||0)),raw:m[0],period:m[1]||fallback};
}
function to24(clock:Clock,dateToken:string){
  let hour=clock.hour;
  const period=clock.period||(dateToken.includes('晚')?'晚上':dateToken.includes('早')?'早上':'');
  if(['下午','晚上','晚','傍晚'].includes(period)&&hour<12)hour+=12;
  if(period==='中午'&&hour>=1&&hour<=6)hour+=12;
  if(period==='凌晨'&&hour===12)hour=0;
  return {hour,minute:clock.minute,period};
}
function absolute(year:number|null,month:number,date:number,token:string,day:Date,warnings:string[]):Date|null{
  let y=year??day.getUTCFullYear();
  let candidate=new Date(Date.UTC(y,month-1,date));
  if(year===null&&day.getTime()-candidate.getTime()>180*DAY_MS){y++;candidate=new Date(Date.UTC(y,month-1,date));warnings.push(`“${token}”按跨年日期解析，请核对年份。`);}
  if(candidate.getUTCFullYear()!==y||candidate.getUTCMonth()!==month-1||candidate.getUTCDate()!==date){warnings.push(`“${token}”不是有效日期，请手动修正。`);return null;}
  return candidate;
}

function resolveDay(token:string,base:Date,warnings:string[]):Date|null{
  const day=midnight(base);
  const rel:Record<string,number>={今天:0,今晚:0,今早:0,明天:1,明早:1,明晚:1,后天:2,大后天:3};
  if(token in rel){day.setUTCDate(day.getUTCDate()+rel[token]);return day;}
  const week=token.match(/^(下下|下|本|这)?(?:周|星期)([一二三四五六日天])$/);
  if(week){const target='一二三四五六日'.indexOf(week[2]==='天'?'日':week[2]);const current=(day.getUTCDay()+6)%7;let delta=target-current+(week[1]==='下下'?14:week[1]==='下'?7:0);if(!week[1]&&delta<0){delta+=7;warnings.push(`“${token}”按下一个对应星期解析，请核对。`);}day.setUTCDate(day.getUTCDate()+delta);return day;}
  const weekend=token.match(/^(下下|下|本|这)?(?:周|星期)末$/);
  if(weekend){const current=(day.getUTCDay()+6)%7;const delta=Math.max(0,5-current);const weeks=weekend[1]==='下下'?2:weekend[1]==='下'?1:0;day.setUTCDate(day.getUTCDate()+weeks*7+delta);return day;}
  const edge=token.match(/^(下下|下|本)?月(初|底)$/);
  if(edge){
    const offset=edge[1]==='下下'?2:edge[1]==='下'?1:0,first=edge[2]==='初';
    let target=first?new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+offset,1)):new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+offset+1,0));
    if(!offset&&target.getTime()<day.getTime()){
      target=first?new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,1)):new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+2,0));
      warnings.push(`“${token}”已过去，按${first?'下个月月初':'下个月月底'}解析，请核对。`);
    }
    return target;
  }
  const cnEdge=token.match(new RegExp(`^(${CN_NUM})月(初|底)$`));
  if(cnEdge){
    const month=cnNumber(cnEdge[1]);
    if(!(month>=1&&month<=12))return null;
    const build=(y:number)=>cnEdge[2]==='初'?new Date(Date.UTC(y,month-1,1)):new Date(Date.UTC(y,month,0));
    let year=day.getUTCFullYear(),target=build(year);
    if(day.getTime()-target.getTime()>180*DAY_MS){year++;target=build(year);warnings.push(`“${token}”按跨年日期解析，请核对年份。`);}
    return target;
  }
  const cnFull=token.match(new RegExp(`^(?:(20\\d{2})年)?(${CN_NUM})月(${CN_NUM})[号日]$`));
  if(cnFull)return absolute(cnFull[1]?Number(cnFull[1]):null,cnNumber(cnFull[2]),cnNumber(cnFull[3]),token,day,warnings);
  const cnDay=token.match(new RegExp(`^(${CN_NUM})[号日]$`));
  if(cnDay){
    const date=cnNumber(cnDay[1]);
    if(!(date>=1&&date<=31)){warnings.push(`“${token}”不是有效日期，请手动修正。`);return null;}
    const candidate=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),date));
    if(candidate.getUTCMonth()!==day.getUTCMonth()||candidate.getUTCDate()!==date){warnings.push(`“${token}”不是有效日期，请手动修正。`);return null;}
    if(candidate.getTime()<day.getTime()){warnings.push(`“${token}”已过去，按下个月 ${date} 号解析，请核对。`);return new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,date));}
    return candidate;
  }
  const absoluteToken=token.match(/^(?:(20\d{2})[年/.-])?(\d{1,2})[月/.-](\d{1,2})日?$/);
  if(absoluteToken)return absolute(absoluteToken[1]?Number(absoluteToken[1]):null,Number(absoluteToken[2]),Number(absoluteToken[3]),token,day,warnings);
  const span=token.match(/^(?:(\d{1,3})|([一二三四五六七八九十两]{1,3}))(天|周|星期|个月)([内后])$/);
  if(span){
    const n=span[1]?Number(span[1]):cnNumber(span[2]);
    if(!Number.isFinite(n)||n<1||n>366)return null;
    if(span[3]==='个月'){day.setUTCMonth(day.getUTCMonth()+n);warnings.push(`“${token}”按自然月估算，请核对具体日期。`);}
    else if(span[3]==='天')day.setUTCDate(day.getUTCDate()+n);
    else day.setUTCDate(day.getUTCDate()+7*n);
    return day;
  }
  if(/^半个月[内后]$/.test(token)){day.setUTCDate(day.getUTCDate()+15);warnings.push('“半个月”按 15 天估算，请核对。');return day;}
  return null;
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
type Skip={reason:string};
function parseOne(text:string,reference:string):Draft|Skip{
  if(text.length<30&&/(?:通知群|群聊|聊天记录)$/.test(text))return {reason:'群名或群聊标题，不是通知内容'};
  if(/撤回了一条消息|加入了群聊|邀请.{0,12}加入|开启了朋友验证|以上是打招呼的内容/.test(text))return {reason:'系统提示，不是通知内容'};
  if(/^\[(?:图片|表情|动画表情|视频|语音|文件|链接|转账|红包|位置)\]\s*$/.test(text))return {reason:'只有图片或表情占位，没有文字'};
  if(/^[@＠]?(?:全体成员|所有人|同学们?)[\s，,。！!~～]*$/.test(text))return {reason:'只有 @全体成员，没有具体内容'};
  if(CHATTER.test(text))return {reason:'只是闲聊确认，没有具体安排'};
  const warnings:string[]=[];
  const base=new Date(Date.parse(reference)+8*3600000);
  if(!Number.isFinite(base.getTime()))throw new Error('请提供有效的消息基准时间');
  const hasWhen=HAS_DATE.test(text)||HAS_TIME.test(text);
  const mentioned=/[@＠]/.test(text);
  const lowConfidence=!KEYWORDS.test(text);
  if(lowConfidence&&!hasWhen&&!mentioned)return {reason:'没识别到时间、@对象或通知关键词'};
  const parsed:{iso:string|null;deadline:boolean;token:string}[]=[];
  const matches=Array.from(text.matchAll(DATE_PATTERN));
  let rangeUsed=false;
  for(let i=0;i<matches.length;i++){
    const match=matches[i],start=match.index!,end=start+match[0].length;
    const next=matches[i+1]?.index??text.length;
    const after=text.slice(end,next).split(/[，,。；;\n]/)[0];
    const before=text.slice(0,start).split(/[，,。；;\n]/).at(-1)||'';
    const context=before+match[0]+after;
    const deadline=/截止|之前|以前|前(?:提交|交|完成|报名|上交)?|最晚|提交|上交|交到|交给|交报告/.test(context)&&!/提前\s*\d+\s*分钟/.test(context);
    const day=resolveDay(match[0],base,warnings);
    const period=(after.match(/^\s*(凌晨|早上|上午|中午|下午|晚上|傍晚|早|晚)/)?.[1])||'';
    const range=day?after.match(RANGE_PATTERN):null;
    const from=range?clockIn(range[1],period):null,to=range?clockIn(range[2],period):null;
    if(day&&from&&to){
      const begin=to24(from,match[0]),finish=to24(to,match[0]);
      if(begin.hour<=23&&begin.minute<=59&&finish.hour<=23&&finish.minute<=59){
        rangeUsed=true;
        warnings.push(`原文是时间段「${from.raw}-${to.raw}」，已按开始与截止两个时间处理，请核对。`);
        parsed.push({iso:makeIso(day,begin.hour,begin.minute),deadline:false,token:match[0]});
        parsed.push({iso:makeIso(day,finish.hour,finish.minute),deadline:true,token:match[0]});
        continue;
      }
    }
    const clock=HAS_TIME.test(after)?clockIn(after,period):null;
    const loose=SPAN_TOKEN.test(match[0])||/月(?:初|底)$/.test(match[0]);
    let iso:string|null=null;
    if(day&&clock){
      const time=to24(clock,match[0]);
      if(time.hour>23||time.minute>59)warnings.push(`“${match[0]+clock.raw}”时间无效，请手动修正。`);
      else iso=makeIso(day,time.hour,time.minute);
    }else if(day&&loose){
      const end=SPAN_TOKEN.test(match[0])?match[0].endsWith('内'):match[0].endsWith('底');
      const hour=end?23:9;
      iso=makeIso(day,hour,end?59:0);
      warnings.push(`“${match[0]}”没写具体时间，按 ${pad(hour)}:${end?'59':'00'} 估算，请核对。`);
    }else if(day){
      const fallback=period||(match[0].includes('晚')?'晚上':match[0].includes('早')?'早上':'');
      const hour=PERIOD_HOUR[fallback];
      if(hour===undefined)warnings.push(`“${match[0]}”未明确几点，时间留空待确认。`);
      else{iso=makeIso(day,hour,0);warnings.push(`“${match[0]+fallback}”没写几点，按 ${pad(hour)}:00 估算，请核对。`);}
    }
    parsed.push({iso,deadline,token:match[0]});
  }
  let deadline: string|null=null,event:string|null=null;
  for(const p of parsed){if(p.deadline){if(deadline&&p.iso!==deadline)warnings.push('识别到多个截止时间，请核对或拆分通知。');else deadline=p.iso;}else{if(event&&p.iso!==event)warnings.push('识别到多个开始时间，请核对或拆分通知。');else event=p.iso;}}
  if(!parsed.length&&HAS_TIME.test(text))warnings.push('仅识别到钟点，缺少明确日期；请手动补充时间。');
  if(deadline&&event&&!rangeUsed&&Date.parse(deadline)>Date.parse(event))warnings.push('截止时间晚于开始时间，请核对日期或原消息发送时间。');
  if(/取消|延期|改期|推迟|改为/.test(text))warnings.push('原文包含变更信息，请核对新时间，并处理旧通知。');
  if(lowConfidence)warnings.push('没识别到明确的通知关键词，请核对这段内容是否要发布。');
  warnings.push(...draftTimeIssues({event_at:event,deadline_at:deadline},Date.parse(reference)));
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
  if(!text.trim())return {drafts:[],engine:'rules',warnings:['请先粘贴群聊文本。'],ignored:0,skipped:[]};
  if(text.length>20000)throw new Error('单次最多解析 20000 字，请分批导入');
  if(!Number.isFinite(Date.parse(context.referenceDate)))throw new Error('请提供有效的消息基准时间');
  const parts=segments(text,context.referenceDate);const drafts:Draft[]=[],skipped:{text:string;reason:string}[]=[];
  for(const part of parts){
    const result=parseOne(part.text,part.date);
    if('reason' in result)skipped.push({text:part.text.slice(0,300),reason:result.reason});
    else drafts.push(result);
  }
  return {drafts,engine:'rules',warnings:drafts.length?[]:['未识别到通知事项，可以补充内容后重试。'],ignored:skipped.length,skipped};
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
    return {drafts:drafts.map(d=>({...d,pinned:false,source_text:text,warnings:[...d.warnings,'由增强解析生成，请对照原文确认信息。']})),engine:'llm',warnings:[],ignored:0,skipped:[]};
  }catch{return {...fallback,warnings:[...fallback.warnings,'增强解析暂不可用，已自动使用规则解析。']};}
  finally{if(timer)clearTimeout(timer);controller.abort();}
}
