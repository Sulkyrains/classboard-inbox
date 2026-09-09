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
