// Offline shell: navigations and static assets are cached so the app keeps
// working without network. Only the public notice list is cached; accounts,
// reads, push and admin APIs are never cached.
const CACHE='classboard-offline-__BUILD_VERSION__';
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.add(new Request('/offline.html',{cache:'reload'}));
  await cache.add(new Request('/',{cache:'reload'}));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('classboard-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
const cacheable=response=>response&&response.ok;
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=='GET')return;
  if(url.pathname.startsWith('/api/')){
    if(url.pathname!=='/api/notices')return;
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      try{
        const live=await fetch(event.request);
        if(cacheable(live))await cache.put(event.request,live.clone());
        return live;
      }catch{
        return (await cache.match(event.request))||new Response(JSON.stringify({error:'当前离线，显示的是最近一次的通知列表。',notices:[]}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8'}});
      }
    })());
    return;
  }
  if(event.request.mode==='navigate'){event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const live=await fetch(new Request(event.request,{cache:'no-store'}));
      if(cacheable(live))await cache.put('/',live.clone());
      return live;
    }catch{
      return (await cache.match('/'))||(await cache.match('/offline.html'))||new Response('暂时无法连接网络，请联网后重试。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
  return;
}
event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const cached=await cache.match(event.request);
  const update=fetch(event.request).then(async live=>{if(cacheable(live))await cache.put(event.request,live.clone());return live;}).catch(()=>{});
  return cached||update;
})());
});
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let data={};
    if(event.data){try{data=event.data.json();}catch{data={body:event.data.text()};}}
    await self.registration.showNotification(data.title||'知可而办 · 班级通知',{
      body:data.body||'有新的班级通知，点击查看。',
      icon:'/icons/app-192.png',badge:'/icons/app-192.png',
      tag:data.tag||'classboard',renotify:true,
      data:{url:data.url||'/'}
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=(event.notification.data&&event.notification.data.url)||'/';
    const target=new URL(url,self.location.origin).pathname;
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list)if(new URL(client.url).pathname===target)return client.focus();
    return self.clients.openWindow(target);
  })());
});
