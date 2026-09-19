export interface IosPushState {
  standalone: boolean;
  capable: boolean;
  permission: string;
  local: boolean;
  server: number;
  thisDevice: boolean;
}
export type IosPushRow = {ok: boolean; label: string; detail: string};

/** iPhone 的推送只有一条链路（APNs），任何一环断了都收不到，所以要逐环给出读数。 */
export function iosPushRows(s: IosPushState): IosPushRow[] {
  return [
    {ok: s.standalone, label: '主屏幕打开', detail: s.standalone ? '已从主屏幕独立打开' : '现在在 Safari 标签页里，推送只在主屏幕图标里生效'},
    {ok: s.capable, label: '系统版本', detail: s.capable ? '系统支持网页推送' : '版本过低，需要 iOS 16.4 或更新'},
    {ok: s.permission === 'granted', label: '通知权限', detail: s.permission === 'granted' ? '已允许' : s.permission === 'denied' ? '被拒绝了，要去系统设置里重新允许' : '还没允许，开启推送时系统会询问'},
    {ok: s.local, label: '本机订阅', detail: s.local ? '这台设备已开启推送' : '这台设备还没开启推送'},
    {ok: s.thisDevice, label: '服务端登记', detail: s.thisDevice ? '班委发布通知会推送到这台设备' : s.server > 0 ? '本机订阅没同步到服务器，关掉推送再重新开启即可' : '服务器上还没有这台设备的记录'},
  ];
}

/** 返回第一个卡住的地方和对应做法；全部正常时返回 null。 */
export function iosPushIssue(s: IosPushState): string | null {
  if (!s.standalone) return 'iPhone 要先从主屏幕打开才能收推送：用 Safari 打开本站 → 底部「分享」→「添加到主屏幕」，再从桌面图标进来。';
  if (!s.capable) return '当前系统版本不支持网页推送，升级到 iOS 16.4 或更新后再从主屏幕打开本站。';
  if (s.permission === 'denied') return '通知权限被拒绝了：打开 iPhone「设置」→「通知」→「知可而办」→ 打开「允许通知」。';
  if (s.permission !== 'granted') return '还没有允许通知：点下面「开启新通知推送」，在系统弹窗里选「允许」。';
  if (!s.local) return '这台设备还没有开启推送订阅：点下面「开启新通知推送」。';
  if (!s.thisDevice) return '本机的推送订阅没有同步到服务器：先「关闭手机推送」再重新「开启新通知推送」。';
  return null;
}
