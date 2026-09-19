export const TIMEZONE = 'Asia/Shanghai';
export function dayKey(value: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function formatDate(value: string | null, full = false): string {
  if (!value) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: TIMEZONE, ...(full ? { year: 'numeric' as const } : {}), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
export function effectiveEnd(n: {deadline_at: string | null; event_at: string | null}) { return n.deadline_at || n.event_at; }
export function isExpired(n: {deadline_at: string | null; event_at: string | null}, now = Date.now()) {
  const end = effectiveEnd(n); return !!end && new Date(end).getTime() < now;
}
type Sortable = {deadline_at: string | null; event_at: string | null; published_at: string | null; created_at: string; pinned?: boolean; id?: string};
/** 已完成的整体沉到未完成之后（置顶的也一样）；其余按截止/活动时间快到的排最前，没有时间限制的按发布时间倒序居中，已经过期的沉底；置顶在各自分组内排最前。 */
export function byUrgency(a: Sortable, b: Sortable, now = Date.now(), done?: ReadonlySet<string>): number {
  const aDone = !!a.id && !!done?.has(a.id), bDone = !!b.id && !!done?.has(b.id);
  if (aDone !== bDone) return aDone ? 1 : -1;
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  const rank = (n: Sortable) => {
    const end = effectiveEnd(n);
    if (!end) return { group: 2, at: Date.parse(n.published_at || n.created_at) };
    const at = Date.parse(end); return { group: at < now ? 3 : 1, at };
  };
  const left = rank(a), right = rank(b);
  if (left.group !== right.group) return left.group - right.group;
  return left.group === 1 ? left.at - right.at : right.at - left.at;
}
export function countdown(date: string | null, now = Date.now()): string {
  if (!date) return '长期通知';
  const ms = new Date(date).getTime() - now;
  if (ms < 0) return '已过期';
  const hours = Math.ceil(ms / 3600000);
  if (hours < 1) return '即将截止';
  if (hours < 24) return `剩余 ${hours} 小时`;
  return `剩余 ${Math.floor(hours / 24)} 天${hours % 24 ? ` ${hours % 24} 小时` : ''}`;
}
export function toInputDate(value: string | null) {
  if (!value) return '';
  return new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16);
}
export function fromInputDate(value: string) { return value ? new Date(value + ':00+08:00').toISOString() : null; }
