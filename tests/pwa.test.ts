import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function worker(){
  const events:Record<string,(event:any)=>void>={},saved:string[]=[],removed:string[]=[];
  const state={offline:false};
  const cache={add:async(request:any)=>{saved.push(request.url);}};
  class Request {url:string;cache?:string;constructor(input:any,options:any={}){this.url=typeof input==='string'?input:input.url;Object.assign(this,options);}}
  runInNewContext(readFileSync('public/sw.js','utf8'),{
    self:{location:{origin:'https://class.test'},addEventListener:(name:string,fn:any)=>{events[name]=fn;},skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    URL,Request,Response,
    caches:{open:async()=>cache,keys:async()=>['classboard-offline-old','unrelated-cache'],delete:async(name:string)=>{removed.push(name);},match:async()=>new Response('offline page')},
    fetch:async()=>{if(state.offline)throw Error('offline');return new Response('live page');}
  });
  const lifecycle=async(name:string)=>{let task:Promise<any>|undefined;events[name]({waitUntil:(promise:Promise<any>)=>{task=promise;}});await task;};
  const request=(url:string,mode='navigate',method='GET')=>{let task:Promise<Response>|undefined;events.fetch({request:{url,mode,method},respondWith:(promise:Promise<Response>)=>{task=promise;}});return task;};
  return {state,saved,removed,lifecycle,request};
}
describe('PWA',()=>{
  it('provides standalone manifest and valid PNG icons',()=>{
    const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
    expect(manifest.display).toBe('standalone');expect(manifest.start_url).toBe('/');expect(manifest.scope).toBe('/');
    expect(manifest.icons.some((icon:any)=>icon.purpose==='maskable')).toBe(true);
    for(const icon of manifest.icons){const bytes=readFileSync('public'+icon.src);const [width,height]=icon.sizes.split('x').map(Number);expect(bytes.subarray(1,4).toString()).toBe('PNG');expect(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)).toBe(width);expect(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20)).toBe(height);}
  });
  it('caches only the generic offline page and removes only its own old cache',async()=>{
    const w=worker();await w.lifecycle('install');await w.lifecycle('activate');
    expect(w.saved).toEqual(['/offline.html']);expect(w.removed).toEqual(['classboard-offline-old']);
  });
  it('uses live navigation and falls back only on network failure',async()=>{
    const w=worker();expect(await(await w.request('https://class.test/'))!.text()).toBe('live page');
    w.state.offline=true;expect(await(await w.request('https://class.test/'))!.text()).toBe('offline page');expect(w.saved).toEqual([]);
  });
  it('never intercepts private APIs, cross-origin requests, or writes',()=>{
    const w=worker();expect(w.request('https://class.test/api/notices')).toBeUndefined();expect(w.request('https://class.test/api/account/reads')).toBeUndefined();expect(w.request('https://other.test/')).toBeUndefined();expect(w.request('https://class.test/','navigate','POST')).toBeUndefined();
  });
});
