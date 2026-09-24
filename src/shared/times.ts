export type Times={event_at:string|null;deadline_at:string|null};
const DAY=86400000;
/** 时间合理性：够明显能被程序判定为「填错」的情形。截止早于开始不算错（报名截止早于活动很常见），只有跨度离谱才提示。 */
export function timeIssues(n:Times,opts:{now?:number}={}):string[]{
  const now=opts.now??Date.now(),start=n.event_at?Date.parse(n.event_at):null,due=n.deadline_at?Date.parse(n.deadline_at):null,issues:string[]=[];
  if(start!==null&&start>now+366*DAY)issues.push('开始时间距离现在超过一年，请核对年份。');
  if(due!==null&&due>now+366*DAY)issues.push('截止时间距离现在超过一年，请核对年份。');
  if(start!==null&&due!==null&&Math.abs(due-start)>60*DAY)issues.push('开始时间与截止时间相差超过 60 天，请核对是否填错。');
  return issues;
}
/** 导入解析用：相对消息基准时间额外检查「时间已经过去」。 */
export function draftTimeIssues(n:Times,reference:number):string[]{
  const issues=timeIssues(n,{now:reference});
  for(const [label,value] of [['开始时间',n.event_at],['截止时间',n.deadline_at]] as const)
    if(value&&Date.parse(value)<reference)issues.push(`${label}早于消息发送时间，若指下一周请手动修正。`);
  return issues;
}
