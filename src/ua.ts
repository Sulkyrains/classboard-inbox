export const isIOS=(ua=navigator.userAgent,touch=navigator.maxTouchPoints)=>/iP(hone|ad|od)/.test(ua)||(ua.includes('Mac')&&touch>1);
export const isApp=(ua=navigator.userAgent)=>/ClassboardApp\//.test(ua);
declare global{interface Window{AndroidApp?:{notify?:(id:string,title:string,body:string)=>void;version?:()=>string;theme?:(mode:'dark'|'light')=>void;checkUpdate?:()=>void};}}
/** 把网页主题同步给安卓 App：状态栏留白区颜色与图标明暗跟着一起变。 */
export function syncAppTheme(){try{window.AndroidApp?.theme?.(document.documentElement.dataset.theme==='dark'?'dark':'light');}catch{}}
