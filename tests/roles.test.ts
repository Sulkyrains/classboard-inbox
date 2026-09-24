import {describe,it,expect} from 'vitest';
import {LEAD_POSITIONS,canManageNotice,isLeadPosition} from '../src/shared/roles';

describe('isLeadPosition',()=>{
  it('只有班长和团支书是主要班委',()=>{
    expect(LEAD_POSITIONS).toEqual(['班长','团支书']);
    expect(isLeadPosition('班长')).toBe(true);
    expect(isLeadPosition('团支书')).toBe(true);
    expect(isLeadPosition('学习委员')).toBe(false);
    expect(isLeadPosition('')).toBe(false);
    expect(isLeadPosition(null)).toBe(false);
    expect(isLeadPosition(undefined)).toBe(false);
  });
});

describe('canManageNotice',()=>{
  it('主要班委不受限，也能互相归档、编辑',()=>{
    expect(canManageNotice('班长','班长')).toBe(true);
    expect(canManageNotice('班长','团支书')).toBe(true);
    expect(canManageNotice('团支书','班长')).toBe(true);
    expect(canManageNotice('团支书','生活委员')).toBe(true);
  });
  it('其他委员不能归档、编辑主要班委发布的通知',()=>{
    expect(canManageNotice('学习委员','班长')).toBe(false);
    expect(canManageNotice('学习委员','团支书')).toBe(false);
    expect(canManageNotice('心理委员','班长')).toBe(false);
    expect(canManageNotice(null,'班长')).toBe(false);
  });
  it('委员之间、以及自己发布的通知不受限',()=>{
    expect(canManageNotice('学习委员','学习委员')).toBe(true);
    expect(canManageNotice('学习委员','生活委员')).toBe(true);
    expect(canManageNotice('心理委员','文体委员')).toBe(true);
  });
  it('作者没有职位或通知没有作者时不做限制',()=>{
    expect(canManageNotice('学习委员',null)).toBe(true);
    expect(canManageNotice('学习委员','')).toBe(true);
    expect(canManageNotice('学习委员',undefined)).toBe(true);
  });
});
