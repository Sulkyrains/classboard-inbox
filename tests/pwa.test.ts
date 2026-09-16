import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function worker(){
  const events:Record<string,(event:any)=>void>={};

  const saved:string[]=[],removed:string[]=[];
  const state={offline:false};
  const store=new Map<string,Response>();
  const cache={
    add:async(request:any)=>{const url=typeof request==='string'?request:request.url;saved.push(url);store.set(url,new Response('shell page'));},
    put:async(request:any,response:Response)=>{const url=typeof request==='string'?request:request.url;store.set(url,response.clone());},
    match:async(request:any)=>{const hit=store.get(typeof request==='string'?request:request.url);return hit&&hit.clone();},
    keys:async()=>['classboard-offline-old','unrelated-cache'],
    delete:async(name:string)=>{removed.push(name);}
  };
  class Request {url:string;mode:string;method:string;constructor(input:any,options:any={}){this.url=typeof input==='string'?input:input.url;this.mode=options.mode??'cors';this.method=options.method??'GET';Object.assign(this,options);}}
  runInNewContext(readFileSync('public/sw.js','utf8'),{
    self:{location:{origin:'https://class.test'},addEventListener:(name:string,fn:any)=>{events[name]=fn;},skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    URL,Request,Response,
    caches:{open:async()=>cache,keys:async()=>cache.keys(),delete:async(name:string)=>cache.delete(name),match:async(request:any)=>cache.match(request)},
    fetch:async(request:any)=>{
      const url=typeof request==='string'?request:request.url;
      if(state.offline)throw Error('offline');
      const body=url.includes('notices')?JSON.stringify({notices:[1]}):url==='https://class.test/'?'shell page':'asset page';
      return new Response(body);
    }
  });
  const lifecycle=async(name:string)=>{let task:Promise<any>|undefined;events[name]({waitUntil:(promise:Promise<any>)=>{task=promise;}});await task;};
  const request=(url:string,mode='cors',method='GET')=>{let task:Promise<Response>|undefined;events.fetch({request:new Request(url,{mode,method}),respondWith:(promise:Promise<Response>)=>{task=promise;}});return task;};
  return {state,saved,removed,store,lifecycle,request};
}
describe('PWA',()=>{
  it('provides standalone manifest and valid PNG icons',()=>{
    const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
    expect(manifest.display).toBe('standalone');expect(manifest.start_url).toBe('/');expect(manifest.scope).toBe('/');
    expect(manifest.icons.some((icon:any)=>icon.purpose==='maskable')).toBe(true);
    for(const icon of manifest.icons){const bytes=readFileSync('public'+icon.src);const [width,height]=icon.sizes.split('x').map(Number);expect(bytes.subarray(1,4).toString()).toBe('PNG');expect(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)).toBe(width);expect(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20)).toBe(height);}
  });
  it('precaches the shell and removes only its own old cache',async()=>{
    const w=worker();await w.lifecycle('install');await w.lifecycle('activate');
    expect(w.saved).toEqual(expect.arrayContaining(['/offline.html','/']));expect(w.saved).toHaveLength(2);expect(w.removed).toEqual(['classboard-offline-old']);
  });
  it('serves live navigations and falls back to the cached shell offline',async()=>{
    const w=worker();await w.lifecycle('install');
    expect(await(await w.request('https://class.test/','navigate'))!.text()).toBe('shell page');
    w.state.offline=true;expect(await(await w.request('https://class.test/','navigate'))!.text()).toBe('shell page');
    expect(await(await w.request('https://class.test/other','navigate'))!.text()).toBe('shell page');
  });
  it('keeps the notice list available offline and never caches private or write APIs',async()=>{
    const w=worker();
    expect(w.request('https://class.test/api/account/reads')).toBeUndefined();
    expect(w.request('https://class.test/api/account/push','cors','POST')).toBeUndefined();
    expect(w.request('https://class.test/api/admin/notices','cors','POST')).toBeUndefined();
    expect(w.request('https://other.test/api/notices')).toBeUndefined();
    expect(await(await w.request('https://class.test/api/notices'))!.text()).toContain('notices');
    w.state.offline=true;
    expect(await(await w.request('https://class.test/api/notices'))!.text()).toContain('notices');
    expect(w.request('https://class.test/api/session')).toBeUndefined();
  });
  it('serves cached assets with background refresh',async()=>{
    const w=worker();
    expect(await(await w.request('https://class.test/assets/index.js'))!.text()).toBe('asset page');
    expect(await(await w.request('https://class.test/assets/index.js'))!.text()).toBe('asset page');
    w.state.offline=true;
    expect(await(await w.request('https://class.test/assets/index.js'))!.text()).toBe('asset page');
  });
});
