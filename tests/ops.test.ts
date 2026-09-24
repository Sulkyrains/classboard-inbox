import {describe,it,expect} from 'vitest';
import {EDIT_FIELDS,changedLabels} from '../src/shared/ops';

describe('changedLabels',()=>{
  const base={title:'原通知',body:'正文',category:'事务',location:'',audience:'',event_at:null,deadline_at:null,pinned:0};
  it('只报真正改过的字段',()=>{
    expect(changedLabels(base,{...base,title:'新标题'})).toEqual(['标题']);
    expect(changedLabels(base,{...base,title:'新标题',deadline_at:'2026-09-30T12:00:00.000Z'})).toEqual(['标题','截止时间']);
  });
  it('布尔与库里的 0/1 视为同一个值',()=>{
    expect(changedLabels(base,{...base,pinned:false})).toEqual([]);
    expect(changedLabels(base,{...base,pinned:true})).toEqual(['置顶']);
  });
  it('null 与空串不算改动',()=>{
    expect(changedLabels(base,{...base,location:'',event_at:null})).toEqual([]);
  });
  it('完全没改时返回空数组（日志里写「内容未变化」）',()=>{
    expect(changedLabels(base,{...base})).toEqual([]);
  });
  it('字段顺序固定，日志读起来稳定',()=>{
    expect(EDIT_FIELDS.map(([,label])=>label)).toEqual(['标题','正文','分类','地点','通知对象','开始时间','截止时间','置顶']);
  });
});
