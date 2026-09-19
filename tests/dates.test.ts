import {describe,it,expect} from 'vitest';
import {byUrgency,effectiveEnd,isExpired,countdown,dayKey} from '../src/shared/dates';

const NOW=Date.parse('2026-09-19T12:00:00+08:00');
const base={published_at:'2026-09-01T00:00:00.000Z',created_at:'2026-09-01T00:00:00.000Z'};
const make=(title:string,deadline_at:string|null,event_at:string|null=null,published_at=base.published_at,pinned=false)=>({id:title,title,deadline_at,event_at,published_at,created_at:base.created_at,pinned});

describe('byUrgency',()=>{
  it('置顶的排在最前，且置顶内部也按紧急度排',()=>{
    const pinnedLate=make('置顶且还早','2026-09-28T10:00:00+08:00',null,base.published_at,true);
    const pinnedSoon=make('置顶且快到期','2026-09-20T10:00:00+08:00',null,base.published_at,true);
    const normalSoon=make('普通但更急','2026-09-19T18:00:00+08:00');
    const expiredPinned=make('置顶但已过期','2026-09-10T10:00:00+08:00',null,base.published_at,true);
    expect([normalSoon,pinnedLate,expiredPinned,pinnedSoon].sort((a,b)=>byUrgency(a,b,NOW)).map(n=>n.title))
      .toEqual(['置顶且快到期','置顶且还早','置顶但已过期','普通但更急']);
  });
  it('没有置顶时退化为纯紧急度排序',()=>{
    const soon=make('快到期','2026-09-20T10:00:00+08:00');
    const none=make('长期','');
    expect([none,soon].sort((a,b)=>byUrgency(a,b,NOW)).map(n=>n.title)).toEqual(['快到期','长期']);
  });
  it('把快到期的排在没有期限的前面',()=>{
    const soon=make('快到期','2026-09-20T10:00:00+08:00');
    const later=make('还早','2026-09-25T10:00:00+08:00');
    const none=make('长期','');
    const list=[none,later,soon];
    expect([...list].sort((a,b)=>byUrgency(a,b,NOW)).map(n=>n.title)).toEqual(['快到期','还早','长期']);
  });
  it('活动时间也参与排序',()=>{
    const event=make('活动','', '2026-09-19T18:00:00+08:00');
    const deadline=make('截止','2026-09-21T10:00:00+08:00');
    expect([deadline,event].sort((a,b)=>byUrgency(a,b,NOW)).map(n=>n.title)).toEqual(['活动','截止']);
  });
  it('过期的沉到最底，且越近过期越靠前',()=>{
    const expiredOld=make('早过期','2026-09-10T10:00:00+08:00');
    const expiredNew=make('刚过期','2026-09-19T09:00:00+08:00');
    const none=make('长期','');
    const soon=make('快到期','2026-09-20T10:00:00+08:00');
    expect([expiredOld,none,soon,expiredNew].sort((a,b)=>byUrgency(a,b,NOW)).map(n=>n.title)).toEqual(['快到期','长期','刚过期','早过期']);
  });
  it('没有期限的按发布时间倒序',()=>{
    const older=make('旧','',null,'2026-09-01T00:00:00.000Z');
    const newer=make('新','',null,'2026-09-15T00:00:00.000Z');
    expect([older,newer].sort((a,b)=>byUrgency(a,b,NOW)).map(n=>n.title)).toEqual(['新','旧']);
  });
  it('已完成的沉到未完成之后，置顶的在已完成组内仍然最前',()=>{
    const pinnedTodo=make('置顶未完成','2026-09-25T10:00:00+08:00',null,base.published_at,true);
    const soonTodo=make('快到期未完成','2026-09-20T10:00:00+08:00');
    const pinnedDone=make('置顶已完成','2026-09-21T10:00:00+08:00',null,base.published_at,true);
    const plainDone=make('普通已完成','2026-09-20T09:00:00+08:00');
    const doneIds=new Set([pinnedDone.id,plainDone.id]);
    expect([plainDone,pinnedDone,soonTodo,pinnedTodo].sort((a,b)=>byUrgency(a,b,NOW,doneIds)).map(n=>n.title))
      .toEqual(['置顶未完成','快到期未完成','置顶已完成','普通已完成']);
  });
  it('截止时间优先于活动时间（沿用 effectiveEnd 规则）',()=>{
    const n=make('两者都有','2026-09-21T10:00:00+08:00','2026-09-20T10:00:00+08:00');
    expect(effectiveEnd(n)).toBe(n.deadline_at);
  });
});

describe('日期工具',()=>{
  it('isExpired 以截止/活动时间判断',()=>{
    expect(isExpired(make('过期','2026-09-10T10:00:00+08:00'),NOW)).toBe(true);
    expect(isExpired(make('进行中','2026-09-20T10:00:00+08:00'),NOW)).toBe(false);
    expect(isExpired(make('长期',''),NOW)).toBe(false);
  });
  it('countdown 覆盖过期、小时、天三档',()=>{
    expect(countdown(null,NOW)).toBe('长期通知');
    expect(countdown('2026-09-19T11:00:00+08:00',NOW)).toBe('已过期');
    expect(countdown('2026-09-19T18:30:00+08:00',NOW)).toBe('剩余 7 小时');
    expect(countdown('2026-09-21T12:00:00+08:00',NOW)).toBe('剩余 2 天');
  });
  it('dayKey 按北京时间分日',()=>{
    expect(dayKey('2026-09-18T16:30:00.000Z')).toBe('2026-09-19');
    expect(dayKey('2026-09-18T15:30:00.000Z')).toBe('2026-09-18');
  });
});
