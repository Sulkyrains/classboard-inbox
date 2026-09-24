/** 编辑通知时用来判断改了哪些字段，给操作日志写一句人话（「修改了标题、截止时间」）。 */
export const EDIT_FIELDS=[['title','标题'],['body','正文'],['category','分类'],['location','地点'],['audience','通知对象'],['event_at','开始时间'],['deadline_at','截止时间'],['pinned','置顶']] as const;
/** 库里 pinned 是 0/1、表单是布尔，比较前统一成同一种写法。 */
const normal=(value:unknown)=>typeof value==='boolean'?(value?1:0):value??'';
export function changedLabels(before:Record<string,unknown>,after:Record<string,unknown>):string[]{
  return EDIT_FIELDS.filter(([key])=>String(normal(before[key]))!==String(normal(after[key]))).map(([,label])=>label);
}
export type Operation={id:string;notice_id:string;notice_title:string;actor_name:string;actor_position:string;action:string;detail:string;created_at:string};
