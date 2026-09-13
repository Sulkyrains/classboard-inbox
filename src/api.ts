export async function api<T>(path: string, options: RequestInit={}): Promise<T> {
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers},credentials:'same-origin'});
  const body=await response.json().catch(()=>({error:'服务返回了无法识别的内容'})) as T & {error?:string};
  if(!response.ok){if(response.status===401&&path!=='/login')window.dispatchEvent(new Event('session-expired'));throw new Error(body.error||'请求失败，请稍后重试');}
  return body as T;
}
