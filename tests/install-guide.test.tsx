import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {envKind,guideFor} from '../src/install-guide';
import {isApp} from '../src/ua';

const uas={
  iosSafari:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipad:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  wechat:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49',
  qq:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 V1_AND_SQ_8.9.0 QQ/8.9.0',
  android:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  desktop:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};
describe('install guide',()=>{
  it('detects platform from user agent',()=>{
    expect(envKind(uas.iosSafari)).toBe('ios');
    expect(envKind(uas.ipad,3)).toBe('ios');
    expect(envKind(uas.wechat)).toBe('wechat');
    expect(envKind(uas.qq)).toBe('wechat');
    expect(envKind(uas.android)).toBe('android');
    expect(envKind(uas.desktop)).toBe('desktop');
  });
  it('renders step-by-step guide per platform',()=>{
    expect(renderToStaticMarkup(guideFor('ios'))).toContain('添加到主屏幕');
    expect(renderToStaticMarkup(guideFor('ios'))).toContain('Safari');
    expect(renderToStaticMarkup(guideFor('ios'))).toContain('iOS 16.4');
    expect(renderToStaticMarkup(guideFor('ios'))).toContain('允许通知');
    expect(renderToStaticMarkup(guideFor('wechat'))).toContain('在浏览器打开');
    expect(renderToStaticMarkup(guideFor('wechat'))).toContain('install-warn');
    expect(renderToStaticMarkup(guideFor('android'))).toContain('独立 App');
    expect(renderToStaticMarkup(guideFor('android'))).toContain('下载安卓 App 安装包');
    expect(renderToStaticMarkup(guideFor('android'))).toContain('30 天');
    expect(renderToStaticMarkup(guideFor('desktop'))).toContain('地址栏');
  });
  it('detects the standalone app user agent',()=>{
    expect(isApp(uas.android)).toBe(false);
    expect(isApp(`${uas.android} ClassboardApp/2.0.0`)).toBe(true);
  });
});
