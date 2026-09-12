import { describe,it,expect } from 'vitest';
import { parseMessages,parseRules,type ParserAdapter } from '../src/parser';
const context={referenceDate:'2026-09-09T10:00:00+08:00'};
const one=(text:string)=>parseRules(text,context).drafts[0];
describe('真实风格群消息',()=>{
  it('作业：明晚、@全体',()=>{const d=one('@全体成员 高数第3章习题，明晚8点前提交到学习通。');expect(d.category).toBe('作业');expect(d.deadline_at).toBe('2026-09-10T12:00:00.000Z');expect(d.audience).toBe('全体成员');expect(d.event_at).toBeNull();});
  it('班会：活动时间与报名截止分离',()=>{const d=one('周五下午3点在教三201开班会，周四18点前完成报名。');expect(d.category).toBe('事务');expect(d.event_at).toBe('2026-09-11T07:00:00.000Z');expect(d.deadline_at).toBe('2026-09-10T10:00:00.000Z');expect(d.location).toBe('教三201');});
  it('课程：明天与调整教室',()=>{const d=one('@软件1班 明天上午8点的英语课改到教二305。');expect(d.category).toBe('课程');expect(d.event_at).toBe('2026-09-10T00:00:00.000Z');expect(d.deadline_at).toBeNull();expect(d.location).toBe('教二305');expect(d.audience).toBe('软件1班');});
  it('志愿活动：绝对日期、中午、地点',()=>{const d=one('志愿活动9月12日9:00在图书馆集合，9月11日中午12点报名截止。');expect(d.category).toBe('活动');expect(d.event_at).toBe('2026-09-12T01:00:00.000Z');expect(d.deadline_at).toBe('2026-09-11T04:00:00.000Z');expect(d.location).toBe('图书馆');});
  it('QQ：发送时间作为相对日期基准',()=>{const d=one('张老师 2026/09/08 19:30：明天17点前交实验报告。');expect(d.deadline_at).toBe('2026-09-09T09:00:00.000Z');expect(d.body).not.toContain('19:30');});
  it('微信：多行消息与回复过滤',()=>{const r=parseRules('2026/09/08 19:30\n实验报告明天17点前提交。\n\n收到，谢谢老师。',context);expect(r.drafts).toHaveLength(1);expect(r.ignored).toBe(1);expect(r.drafts[0].deadline_at).toBe('2026-09-09T09:00:00.000Z');});
  it('回复不产生草稿',()=>{expect(parseRules('收到，谢谢老师。',context).drafts).toEqual([]);});
});
describe('日期与边界',()=>{
  it('缺钟点留空，不默认午夜',()=>{const d=one('请在周五前提交作业。');expect(d.deadline_at).toBeNull();expect(d.warnings.join()).toContain('未明确几点');});
  it('缺日期不猜今天',()=>{const d=one('作业18点前交。');expect(d.deadline_at).toBeNull();expect(d.warnings.join()).toContain('缺少明确日期');});
  it('无效日期不自动滚动',()=>{const d=one('活动在2月30日9点集合。');expect(d.event_at).toBeNull();expect(d.warnings.join()).toContain('不是有效日期');});
  it('下周一',()=>{expect(one('下周一上午9点在操场举行活动。').event_at).toBe('2026-09-14T01:00:00.000Z');});
  it('半点与跨年',()=>{const r=parseRules('活动1月2日下午3点半在操场集合。',{referenceDate:'2026-12-31T10:00:00+08:00'});expect(r.drafts[0].event_at).toBe('2027-01-02T07:30:00.000Z');});
  it('编号拆分成多草稿',()=>{expect(parseRules('1. 高数作业明天20点前提交。\n2. 后天15点在操场参加志愿活动。',context).drafts).toHaveLength(2);});
  it('更改或取消提醒审核',()=>{expect(one('原定周五15点的班会取消。').warnings.join()).toContain('变更信息');});
  it('无效输入与长度限制',()=>{expect(parseRules('',context).drafts).toEqual([]);expect(()=>parseRules('通知'.repeat(11000),context)).toThrow();expect(()=>parseRules('活动',{referenceDate:'invalid'})).toThrow();});
});
describe('可插拔增强与回退',()=>{
  const text='高数作业明天20点前提交。';
  it('适配器成功',async()=>{const adapter:ParserAdapter={name:'test',parse:async()=>({drafts:parseRules(text,context).drafts})};expect((await parseMessages(text,context,adapter)).engine).toBe('llm');});
  it('异常回退',async()=>{const adapter:ParserAdapter={name:'test',parse:async()=>{throw new Error('offline');}};const r=await parseMessages(text,context,adapter);expect(r.engine).toBe('rules');expect(r.drafts).toHaveLength(1);});
  it('坏数据回退',async()=>{const adapter:ParserAdapter={name:'test',parse:async()=>({drafts:[{title:'坏数据'}]})};expect((await parseMessages(text,context,adapter)).engine).toBe('rules');});
  it('超时回退且取消请求',async()=>{let signal:AbortSignal|undefined;const adapter:ParserAdapter={name:'test',parse:async(_t,_c,s)=>{signal=s;return new Promise(()=>{});}};expect((await parseMessages(text,context,adapter,10)).engine).toBe('rules');expect(signal?.aborted).toBe(true);});
});
