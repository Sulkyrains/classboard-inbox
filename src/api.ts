export async function api<T>(path: string, options: RequestInit={}): Promise<T> {
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers},credentials:'same-origin'});
  const body=await response.json().catch(()=>({error:'服务返回了无法识别的内容'})) as T & {error?:string};
  if(!response.ok)throw new Error(body.error||'请求失败，请稍后重试');
  return body as T;
}
