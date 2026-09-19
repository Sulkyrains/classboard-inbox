import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {sendPush,encryptPayload,vapidAuthorization,type VapidKeys,type PushPayload} from '../server/push';

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
    const ikm=await hmac(prkKey,concat(enc.encode('WebPush: info'),new Uint8Array(1),uaPublic,asPublic,new Uint8Array([1])));
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
  it('matches the RFC 8291 §5 example vector byte for byte',async()=>{
    // 官方向量同时校验 ECDH、HKDF 与填充：IKM 少补一个 0x01 时浏览器无法解密。
    const uaKey=unb64url('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
    const asPublic=unb64url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const asPrivate=unb64url('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
    const asKey=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:b64url(asPublic.slice(1,33)),y:b64url(asPublic.slice(33)),d:b64url(asPrivate),ext:true} as JsonWebKey,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
    const body=await encryptPayload('When I grow up, I want to be a watermelon',{p256dh:b64url(uaKey),auth:'BTBZMqHH6r4Tts7J_aSIgg'},asPublic,asKey,unb64url('DGv6ra1nlYgDCS1FRnbzlw'));
    expect(b64url(body)).toBe('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });
  it('signs VAPID tokens that verify against the advertised public key',async()=>{
    const header=await vapidAuthorization(keys,'https://push.test','mailto:test@example.com');
    const match=/^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).toBeTruthy();
    const [head,claims,signature]=match![1].split('.');
    expect(JSON.parse(new TextDecoder().decode(unb64url(head)))).toEqual({typ:'JWT',alg:'ES256'});
    const parsed=JSON.parse(new TextDecoder().decode(unb64url(claims)));
    expect(parsed.aud).toBe('https://push.test');
    expect(parsed.sub).toBe('mailto:test@example.com');
    expect(parsed.exp).toBeGreaterThan(Date.now()/1000);
    expect(parsed.exp).toBeLessThan(Date.now()/1000+86400);
    expect(match![2]).toBe(b64url(serverPublic));
    const publicKey=await crypto.subtle.importKey('raw',serverPublic as BufferSource,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    expect(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,unb64url(signature) as BufferSource,enc.encode(`${head}.${claims}`) as BufferSource)).toBe(true);
  });
});
