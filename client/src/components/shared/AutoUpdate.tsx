import { useEffect } from 'react';

/**
 * 静默自动更新 —— 解决 iOS 主屏 WebApp「服务器更新后 App 一直跑旧代码」的问题。
 *
 * 背景：iOS 把主屏 WebApp（standalone PWA）切后台后是**挂起**，点图标只是恢复
 * 挂起的 WebView —— 不重新导航、不发任何请求，页面 JS 从挂起前继续跑；服务器
 * 更新后，已安装的 App 会一直停在旧页面，且用户无法自行「更新系统」。桌面/普通
 * 浏览器刷新或重开标签页即拉到新 index.html（nginx 已 no-cache），无此问题。
 *
 * 机制：构建时 vite 把 VITE_APP_VERSION 注入为 __APP_VERSION__，并在 dist 产出
 * /version.json（nginx no-cache）。本组件在「恢复可见」（visibilitychange —— iOS
 * 挂起恢复必然触发；pageshow persisted —— bfcache 恢复）以及前台每 15 分钟兜底
 * 时拉 /version.json 对比当前版本；不一致 → 直接整页 reload（index.html 是
 * no-cache，reload 即拿到新 bundle；SPA history 路由 URL 不变，用户回到同一页面）。
 *
 * 防打断约束（自动刷新绝不能吃掉用户正在填的东西）：
 * - 离开不足 30s 的快速切回不刷（多任务穿梭/复制粘贴场景），下次再查
 * - 检测瞬间焦点在输入框/富文本上不刷，留到下一轮（最迟 15 分钟）
 * - 页面不在前台不刷（iOS 挂起中 JS 本就不跑，此条防桌面后台标签页无谓重载）
 *
 * dev 构建不注入版本（空字符串），检测自禁用；fetch 失败（离线/502）静默留待下次。
 */

/** 前台兜底轮询间隔：桌面长开标签页也能在发版后 ~30 分钟内自动更新 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** 挂起恢复后网络栈刚醒，稍等一拍再查，避免 iOS 恢复瞬间请求被吞 */
const RESUME_DELAY_MS = 2_000;
/** 离开不足此时长的快速切回不自动刷新（用户可能正在多任务间穿梭操作） */
const HIDDEN_THRESHOLD_MS = 30_000;

/** 返回服务器当前版本号；拉不到（404/离线/格式异常）返回 null，静默 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (typeof data === 'object' && data !== null && typeof (data as { version?: unknown }).version === 'string') {
      return (data as { version: string }).version;
    }
    return null;
  } catch {
    return null;
  }
}

/** 焦点在输入框/富文本上 —— 此时自动刷新会吃掉用户正在编辑的内容 */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** 版本不一致时静默整页刷新（当前页 URL 保持，SPA 路由回到同一页面） */
function reloadIfOutOfDate(): void {
  void fetchLatestVersion().then((version) => {
    if (!version || version === __APP_VERSION__) return;
    if (isTyping() || document.visibilityState !== 'visible') return;
    window.location.reload();
  });
}

function useAutoUpdateOnResume(): void {
  useEffect(() => {
    // dev/未带版本的本地构建：当前版本为空，无从对比，检测关闭
    if (!__APP_VERSION__) return;

    // pagehide 同时覆盖「进后台」与「进 bfcache」两种离开方式，恢复时用它算离开时长
    let hiddenAt = 0;
    const onPageHide = () => {
      hiddenAt = Date.now();
    };

    // iOS 挂起恢复 / 桌面切回标签页：离开足够久才考虑刷新
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const awayFor = hiddenAt ? Date.now() - hiddenAt : Number.POSITIVE_INFINITY;
      if (awayFor >= HIDDEN_THRESHOLD_MS) window.setTimeout(reloadIfOutOfDate, RESUME_DELAY_MS);
    };

    // bfcache 恢复（前进/后退返回本页，不触发 load），时长判断同上
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const awayFor = hiddenAt ? Date.now() - hiddenAt : Number.POSITIVE_INFINITY;
      if (awayFor >= HIDDEN_THRESHOLD_MS) reloadIfOutOfDate();
    };

    // 前台长开兜底：桌面标签页一直不切走也能在发版后自动更新
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reloadIfOutOfDate();
    }, CHECK_INTERVAL_MS);

    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.clearInterval(timer);
    };
  }, []);
}

/** 无 UI：纯副作用组件，挂在应用根部，返回 null */
export default function AutoUpdate() {
  useAutoUpdateOnResume();
  return null;
}
