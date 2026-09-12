// Cloudflare API direct-upload variant: inline small app assets, proxy pinned OCR assets.
// Standard `npm run deploy` still uses Pages' ordinary static-asset hosting.
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
const assets={};
for(const f of await readdir('dist/assets')){
  if(!/\.(css|js)$/.test(f))continue;
  assets['/assets/'+f]={body:await readFile('dist/assets/'+f,'utf8'),type:f.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8'};
}
assets['/']={body:await readFile('dist/index.html','utf8'),type:'text/html; charset=utf-8'};
assets['/favicon.svg']={body:await readFile('dist/favicon.svg','utf8'),type:'image/svg+xml'};
const files=await readdir('public/ocr');
const ocrVersion=JSON.parse(await readFile('node_modules/tesseract.js/package.json','utf8')).version;
const coreVersion=JSON.parse(await readFile('node_modules/tesseract.js-core/package.json','utf8')).version;
const headers=Object.fromEntries((await readFile('public/_headers','utf8')).split('\n').filter(s=>s.startsWith('  ')).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}));
await mkdir('work',{recursive:true});
await writeFile('work/connector-entry.ts',`import app from '../server/worker';
const assets=${JSON.stringify(assets)};
const headers=${JSON.stringify(headers)};
const ocrFiles=${JSON.stringify(files)};
export default { async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/'))return app.fetch(request,env);
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  if(url.pathname.startsWith('/ocr/')){
    const file=url.pathname.slice(5);if(!ocrFiles.includes(file))return new Response('Not found',{status:404});
    const source=file==='worker.min.js'?'https://cdn.jsdelivr.net/npm/tesseract.js@${ocrVersion}/dist/'+file:'https://cdn.jsdelivr.net/npm/tesseract.js-core@${coreVersion}/'+file;
    const r=await fetch(source,{cf:{cacheTtl:86400,cacheEverything:true}});
    return new Response(request.method==='HEAD'?null:r.body,{status:r.status,headers:{...headers,'Content-Type':file.endsWith('.wasm')?'application/wasm':'application/javascript','Cache-Control':r.ok?'public,max-age=86400':'no-store'}});
  }
  const item=assets[url.pathname]||(url.pathname==='/index.html'?assets['/']:null);
  if(!item)return new Response('Not found',{status:404,headers});
  return new Response(request.method==='HEAD'?null:item.body,{headers:{...headers,'Content-Type':item.type,'Cache-Control':url.pathname.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache'}});
}};`);
await build({entryPoints:['work/connector-entry.ts'],outfile:'work/pages-api-worker.js',bundle:true,format:'esm',target:'es2022',minify:true});
console.log('Pages direct-upload bundle ready.');
