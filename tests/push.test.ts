import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {sendPush,type VapidKeys,type PushPayload} from '../server/push';

const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64url');
const unb64url=(value:string)=>new Uint8Array(Buffer.from(value,'base64url'));
async function hmac(key:Uint8Array,data:Uint8Array){
  const k=await crypto.subtle.importKey('raw',key as BufferSource,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',k,data as BufferSource));
}
function concat(...parts:Uint8Array[]):Uint8Array{
  const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;
  for(const p of parts){out.set(p,o);o+=p.length;}return out;
}
let captured:{url:string;headers:Record<string,string>;body:Uint8Array}|null=null;
const realFetch=globalThis.fetch;
const serverPair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const serverPublic=new Uint8Array(await crypto.subtle.exportKey('raw',serverPair.publicKey));
const serverJwk=await crypto.subtle.exportKey('jwk',serverPair.privateKey);
const keys:VapidKeys={publicKey:serverPublic,privateKey:unb64url(serverJwk.d as string)};
const uaPair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const uaPublic=new Uint8Array(await crypto.subtle.exportKey('raw',uaPair.publicKey));
const uaJwk=await crypto.subtle.exportKey('jwk',uaPair.privateKey);
const subscription={endpoint:'https://push.test/send/1',p256dh:b64url(uaPublic),auth:uaJwk.d as string};
const payload:PushPayload={title:'【作业】数学作业',body:'明天交',url:'/',tag:'n-1'};
beforeAll(()=>{
  globalThis.fetch=(async(input:any,init:any)=>{
    captured={url:String(input.url??input),headers:init.headers,body:new Uint8Array(init.body instanceof ArrayBuffer?new Uint8Array(init.body):init.body)};
    return new Response(null,{status:201});
  }) as typeof fetch;
});
afterAll(()=>{globalThis.fetch=realFetch;captured=null;});
describe('Web Push',()=>{
  it('encrypts payloads the browser can decrypt (RFC 8291 round-trip)',async()=>{
    const ok=await sendPush(subscription,payload,keys,'mailto:test@example.com');
    expect(ok).toBe(true);
    expect(captured).toBeTruthy();
    const {headers,body}=captured!;
    expect(headers['TTL']).toBe('604800');
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers['Authorization']).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const salt=body.slice(0,16),idlen=body[20];
    const asPublic=body.slice(21,21+idlen),cipher=body.slice(21+idlen);
    expect(idlen).toBe(65);
    expect(new DataView(body.buffer,body.byteOffset).getUint32(16)).toBe(4096);
    const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:await crypto.subtle.importKey('raw',asPublic as BufferSource,{name:'ECDH',namedCurve:'P-256'},false,[])},uaPair.privateKey,256));
    const prkKey=await hmac(unb64url(subscription.auth),shared);
    const ikm=await hmac(prkKey,concat(enc.encode('WebPush: info'),new Uint8Array(1),uaPublic,asPublic));
    const prk=await hmac(salt,ikm);
    const cek=(await hmac(prk,concat(enc.encode('Content-Encoding: aes128gcm'),new Uint8Array([0,1])))).slice(0,16);
    const nonce=(await hmac(prk,concat(enc.encode('Content-Encoding: nonce'),new Uint8Array([0,1])))).slice(0,12);
    const aesKey=await crypto.subtle.importKey('raw',cek as BufferSource,'AES-GCM',false,['decrypt']);
    const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce as BufferSource},aesKey,cipher as BufferSource));
    expect(plain.at(-1)).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(plain.slice(0,-1)))).toEqual(payload);
  });
  it('marks gone endpoints for deletion',async()=>{
    globalThis.fetch=(async()=>new Response(null,{status:410})) as typeof fetch;
    expect(await sendPush(subscription,payload,keys,'mailto:test@example.com')).toBe(false);
  });
});
