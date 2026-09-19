import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {iosPushIssue,iosPushRows,type IosPushState} from '../src/shared/ios-push';
import {IosPushCheckView} from '../src/ios-notify';

const ok:IosPushState={standalone:true,capable:true,permission:'granted',local:true,server:1,thisDevice:true};
const rowOf=(s:IosPushState,label:string)=>iosPushRows(s).find(r=>r.label===label);

describe('iosPushRows',()=>{
  it('五项全绿时没有任何告警行',()=>{
    const rows=iosPushRows(ok);
    expect(rows).toHaveLength(5);
    expect(rows.every(r=>r.ok)).toBe(true);
  });
  it('Safari 标签页里打开时提示去主屏幕安装',()=>{
    const row=rowOf({...ok,standalone:false},'主屏幕打开');
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('主屏幕');
  });
  it('权限被拒绝与尚未允许给出不同说明',()=>{
    expect(rowOf({...ok,permission:'denied'},'通知权限')?.detail).toContain('设置');
    expect(rowOf({...ok,permission:'default'},'通知权限')?.detail).toContain('还没允许');
  });
  it('本地有订阅但服务端没登记时指出要重开推送',()=>{
    const row=rowOf({...ok,thisDevice:false},'服务端登记');
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('重新开启');
  });
  it('服务端有其他设备的订阅时说明本机没同步',()=>{
    const row=rowOf({...ok,local:false,thisDevice:false,server:1},'服务端登记');
    expect(row?.detail).toContain('同步');
  });
});

describe('iosPushIssue',()=>{
  it('全部正常时返回 null',()=>{
    expect(iosPushIssue(ok)).toBeNull();
  });
  it('按「安装 → 版本 → 权限 → 订阅 → 登记」的顺序只报第一个卡点',()=>{
    expect(iosPushIssue({...ok,standalone:false,capable:false,permission:'denied'})).toContain('添加到主屏幕');
    expect(iosPushIssue({...ok,capable:false,permission:'denied'})).toContain('iOS 16.4');
    expect(iosPushIssue({...ok,permission:'denied',local:false})).toContain('允许通知');
    expect(iosPushIssue({...ok,local:false,thisDevice:false})).toContain('开启新通知推送');
    expect(iosPushIssue({...ok,thisDevice:false})).toContain('没有同步到服务器');
  });
});

describe('IosPushCheckView',()=>{
  const html=(state:IosPushState|null)=>renderToStaticMarkup(IosPushCheckView({state,busy:false,onRefresh:()=>{}}));
  it('渲染五项读数并标出正常状态',()=>{
    const markup=html(ok);
    for(const label of ['主屏幕打开','系统版本','通知权限','本机订阅','服务端登记'])expect(markup).toContain(label);
    expect(markup).toContain('一切正常');
    expect(markup).toContain('发送测试推送');
  });
  it('没装到主屏幕时给出安装指引而不是「一切正常」',()=>{
    const markup=html({...ok,standalone:false,local:false,thisDevice:false});
    expect(markup).toContain('有待处理');
    expect(markup).toContain('notify-alert');
    expect(markup).toContain('添加到主屏幕');
    expect(markup).not.toContain('一切正常');
  });
  it('还在检查时先显示占位',()=>{
    expect(html(null)).toContain('正在检查…');
  });
});
