// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using only Web Crypto.
const enc = new TextEncoder();
export interface VapidKeys { publicKey: Uint8Array; privateKey: Uint8Array }
export interface PushKeys { p256dh: string; auth: string }
export interface PushSubscriptionRow { endpoint: string; p256dh: string; auth: string }
export interface PushPayload { title: string; body: string; url: string; tag?: string }

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function unb64url(value: string): Uint8Array {
  const norm = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(norm);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
export function loadVapid(publicKey: string | undefined, privateKey: string | undefined): VapidKeys | null {
  if (!publicKey || !privateKey) return null;
  try {
    const pub = unb64url(publicKey), priv = unb64url(privateKey);
    if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return null;
    return { publicKey: pub, privateKey: priv };
  } catch { return null; }
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
/** RFC 8291 §3.4：IKM = HKDF-Expand(PRK_key, key_info, 32)，即 info 后必须再补一个 0x01。 */
export async function encryptPayload(raw: string, keys: PushKeys, serverPublic: Uint8Array, serverPrivate: CryptoKey, saltOverride?: Uint8Array): Promise<Uint8Array> {
  const ua = unb64url(keys.p256dh), authSecret = unb64url(keys.auth);
  if (ua.length !== 65 || ua[0] !== 4) throw new Error('invalid client key');
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('raw', ua as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, serverPrivate, 256));
  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info'), new Uint8Array(1), ua, serverPublic, new Uint8Array([1])));
  const salt = saltOverride ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
  const nonceBase = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0, 1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBase as BufferSource }, key, concat(enc.encode(raw), new Uint8Array([2])) as BufferSource));
  const header = new Uint8Array(21 + serverPublic.length);
  header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = serverPublic.length; header.set(serverPublic, 21);
  return concat(header, cipher);
}
export async function vapidAuthorization(keys: VapidKeys, audience: string, subject: string): Promise<string> {
  const claims = { aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject };
  const input = `${b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))}.${b64url(enc.encode(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64url(keys.publicKey.slice(1, 33)), y: b64url(keys.publicKey.slice(33, 65)), d: b64url(keys.privateKey), ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input) as BufferSource));
  return `vapid t=${input}.${b64url(signature)}, k=${b64url(keys.publicKey)}`;
}
// Returns false only when the endpoint is gone (404/410) and should be dropped.
export async function sendPush(sub: PushSubscriptionRow, payload: PushPayload, keys: VapidKeys, subject: string): Promise<boolean> {
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const body = await encryptPayload(JSON.stringify(payload), { p256dh: sub.p256dh, auth: sub.auth }, serverPublic, ephemeral.privateKey);
  const authorization = await vapidAuthorization(keys, new URL(sub.endpoint).origin, subject);
  const response = await fetch(sub.endpoint, { method: 'POST', headers: { TTL: '604800', Urgency: 'normal', Authorization: authorization, 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm' }, body: body as BufferSource });
  if (response.ok || [403, 413, 429].includes(response.status)) return true;
  return !(response.status === 404 || response.status === 410);
}
