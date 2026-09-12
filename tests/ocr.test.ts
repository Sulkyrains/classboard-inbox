import {describe,it,expect} from 'vitest';
import {normalizeOcrText} from '../src/parser/ocr';
import {parseRules} from '../src/parser';
describe('OCR 清洗后进入统一解析',()=>{
  it('保留消息换行并修复中文日期间距',()=>{
    const source='班级 通知 群\n2026/09/11 10:00\n学 习 委 员\n@ 全 体 成 员 高 数 作业 通知\n请 完成 第 三 章 习 题 ，\n9 月 12 日 晚上 8 点 前 提交 。\n9 月 13 日 上 午 9 点 在 教 三 201 讲 解 。';
    const r=parseRules(normalizeOcrText(source),{referenceDate:'2026-09-12T10:00:00+08:00'});
    expect(r.drafts).toHaveLength(1);expect(r.drafts[0].category).toBe('作业');expect(r.drafts[0].audience).toBe('全体成员');
    expect(r.drafts[0].deadline_at).toBe('2026-09-12T12:00:00.000Z');expect(r.drafts[0].event_at).toBe('2026-09-13T01:00:00.000Z');expect(r.drafts[0].location).toBe('教三201');
  });
  it('不破坏英文单词之间的空格',()=>{expect(normalizeOcrText('English course\n9 月 12 日')).toBe('English course\n9月12日');});
});
