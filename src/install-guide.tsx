import {isIOS} from './ua';
export type EnvKind='wechat'|'ios'|'android'|'desktop';
export function envKind(ua=navigator.userAgent,touch=navigator.maxTouchPoints):EnvKind{
  if(/MicroMessenger|QQ\//i.test(ua))return 'wechat';
  if(isIOS(ua,touch))return 'ios';
  if(/Mobi|Android/i.test(ua))return 'android';
  return 'desktop';
}
export function guideFor(kind:EnvKind){
  if(kind==='wechat')return <div className="install-guide" role="status"><p className="install-warn">当前在微信/QQ 内打开，无法安装或接收推送。</p><ol><li>点右上角「···」</li><li>选择「在浏览器打开」（推荐 Chrome 或系统自带浏览器）</li><li>在新浏览器中重新打开本站，再进行安装和推送设置</li></ol></div>;
  if(kind==='ios')return <div className="install-guide" role="status"><p>iPhone 接收横幅通知需先添加到主屏幕（系统要求 iOS 16.4 或更新）：</p><ol><li>用 <strong>Safari</strong> 打开本站（在微信里请先点「···」→「在 Safari 中打开」）</li><li>点底部中间的<strong>分享</strong>按钮（方框加箭头图标）</li><li>下滑点「<strong>添加到主屏幕</strong>」→「添加」</li><li>从桌面打开「知可而办」，在「个人账号」中开启推送，弹窗选择「<strong>允许通知</strong>」</li></ol><p>完成后，班委发布通知就会在这台 iPhone 上弹出横幅提醒。</p></div>;
  if(kind==='android')return <div className="install-guide" role="status"><p>推荐安装<strong>独立 App</strong>：不依赖浏览器、不依赖谷歌服务，班委发布通知后会直接在手机上提醒。</p><ol><li>点下方「<strong>下载安卓 App 安装包</strong>」，下载完成后打开安装</li><li>若提示「未知来源」，选择允许安装 / 仍要安装</li><li>打开「知可而办」App，登录一次（登录状态保留 30 天），首次启动允许通知权限</li></ol><p>不想装 App 也可以：在「个人账号」开启网页推送，需使用 Chrome 等支持推送的浏览器（国产浏览器、微信内不支持）。</p></div>;
  return <div className="install-guide" role="status"><p>点击地址栏右侧的<strong>安装</strong>图标，或在浏览器菜单中选择「安装应用」。</p></div>;
}
