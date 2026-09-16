// Generates a VAPID key pair for Web Push and prints the env values to configure.
// Usage: node scripts/generate-vapid.mjs
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
const b64url = s => String(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
console.log('VAPID_PUBLIC_KEY=' + b64url(Buffer.from(raw).toString('base64')));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
console.log('\n本地开发：把上面两行加入 .dev.vars');
console.log('生产环境：wrangler pages secret put VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
