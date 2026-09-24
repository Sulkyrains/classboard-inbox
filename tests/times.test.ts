import { describe,it,expect } from 'vitest';
import { draftTimeIssues,timeIssues } from '../src/shared/times';
const now=Date.parse('2026-09-24T10:00:00+08:00');
const at=(days:number,hour=12)=>new Date(Date.parse('2026-09-24T00:00:00+08:00')+days*86400000+(hour-8)*3600000).toISOString();
describe('时间合理性校验',()=>{
  it('正常时间不提示',()=>{expect(timeIssues({event_at:at(2,14),deadline_at:at(3,18)},{now})).toEqual([]);});
  it('没有时间不提示',()=>{expect(timeIssues({event_at:null,deadline_at:null},{now})).toEqual([]);});
  it('超过一年提示核对年份',()=>{
    expect(timeIssues({event_at:at(400,14),deadline_at:null},{now}).join()).toContain('超过一年');
    expect(timeIssues({event_at:null,deadline_at:at(400,14)},{now}).join()).toContain('截止时间距离现在超过一年');
  });
  it('开始与截止跨度超过 60 天提示',()=>{expect(timeIssues({event_at:at(1,14),deadline_at:at(90,14)},{now}).join()).toContain('相差超过 60 天');});
  it('截止早于开始不算错（报名截止早于活动很常见）',()=>{expect(timeIssues({event_at:at(5,14),deadline_at:at(3,18)},{now})).toEqual([]);});
  it('导入时早于消息基准时间要提示',()=>{
    const issues=draftTimeIssues({event_at:at(-2,14),deadline_at:null},now);
    expect(issues).toHaveLength(1);expect(issues[0]).toContain('开始时间早于消息发送时间');
  });
  it('导入校验同时覆盖跨年与跨度规则',()=>{
    const issues=draftTimeIssues({event_at:at(400,14),deadline_at:at(500,14)},now);
    expect(issues.join()).toContain('超过一年');expect(issues.join()).toContain('相差超过 60 天');
  });
});
