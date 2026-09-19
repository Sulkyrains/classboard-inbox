/**
 * Cloudflare 运行时的 PBKDF2 硬上限是 10 万次迭代（更高会直接抛 NotSupportedError），
 * 所以这里只能取到顶；别再调大，否则线上登录会 500。
 */
export const ITERATIONS = 100000;
export async function sha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function derive(secret: string, salt: string, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations},key,256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}
/** 旧格式是裸 hex，参数无从得知；新格式把算法与迭代次数写进摘要，将来平台放宽上限时可直接识别并升级。 */
export function digestIterations(stored: string) {
  const match=/^pbkdf2\$sha256\$(\d+)\$[a-f0-9]{64}$/.exec(stored);
  const parsed=match?Number(match[1]):NaN;
  return Number.isInteger(parsed)&&parsed>=10000&&parsed<=2000000?parsed:ITERATIONS;
}
export async function hashPassword(secret: string, salt: string) {
  return `pbkdf2$sha256$${ITERATIONS}$${await derive(secret, salt, ITERATIONS)}`;
}
export async function verifyPassword(secret: string, salt: string, stored: string) {
  const hex=stored.includes('$')?stored.slice(stored.lastIndexOf('$')+1):stored;
  return equal(await derive(secret, salt, digestIterations(stored)), hex);
}
export function equal(a: string, b: string) {
  let diff = a.length ^ b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++) diff |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return diff === 0;
}
