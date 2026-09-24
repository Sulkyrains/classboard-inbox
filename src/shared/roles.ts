/** 主要班委：权限不受限，彼此可以互相归档、编辑。 */
export const LEAD_POSITIONS=['班长','团支书'] as const;
export const isLeadPosition=(position?:string|null)=>!!position&&(LEAD_POSITIONS as readonly string[]).includes(position);
/** 主要班委不受限；其他委员动不了主要班委发布的内容。 */
export const canManageNotice=(actor?:string|null,author?:string|null)=>isLeadPosition(actor)||!isLeadPosition(author);
