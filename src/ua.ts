export const isIOS=(ua=navigator.userAgent,touch=navigator.maxTouchPoints)=>/iP(hone|ad|od)/.test(ua)||(ua.includes('Mac')&&touch>1);
export const isApp=(ua=navigator.userAgent)=>/ClassboardApp\//.test(ua);
declare global{interface Window{AndroidApp?:{notify?:(id:string,title:string,body:string)=>void;version?:()=>string};}}
