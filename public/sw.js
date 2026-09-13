// Only the generic offline page is cached. Never cache accounts or notifications.
const CACHE='classboard-offline-__BUILD_VERSION__';
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.add(new Request('/offline.html',{cache:'reload'}));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('classboard-offline-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate')event.respondWith((async()=>{
    try{return await fetch(new Request(event.request,{cache:'no-store'}));}
    catch{return (await caches.match('/offline.html'))||new Response('暂时无法连接网络，请联网后重试。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
  })());
});
