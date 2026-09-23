import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { initI18n } from './i18n';
import { getCachedPublicSettings } from './lib/publicSettings';
import { scheduleSentryInit } from './lib/sentryLazy';
import { reportWebVitals } from './lib/webVitals';

scheduleSentryInit();
reportWebVitals();

/**
 * 等主样式表下载并解析完成后再渲染：大 CSS 是流式渐进解析的，`link.sheet` 在传输
 * 过程中就可访问，首屏/路由骨架会在主题作用域规则（如 [data-interface-theme]
 * .app-page-hero 的卡片样式）就绪前绘制，造成移动端「标题先裸文本、后变卡片」的
 * FOUC 跳动。用 Resource Timing 的 responseEnd 判定真正收完，避免流式误判。
 */
function isStylesheetFullyLoaded(link: HTMLLinkElement): boolean {
  if (!link.sheet) return false;
  try {
    const entries = performance.getEntriesByName(link.href, 'resource') as PerformanceResourceTiming[];
    return entries.some((entry) => entry.responseEnd > 0);
  } catch {
    return false;
  }
}

function waitForStylesheets(): Promise<void> {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  if (links.length === 0) return Promise.resolve();
  return Promise.all(
    links.map(
      (link) =>
        new Promise<void>((resolve) => {
          if (isStylesheetFullyLoaded(link)) {
            resolve();
            return;
          }
          const done = () => resolve();
          link.addEventListener('load', done, { once: true });
          link.addEventListener('error', done, { once: true });
          // 兜底：极端情况下事件丢失也不永久卡住首屏
          window.setTimeout(done, 3000);
        }),
    ),
  ).then(() => undefined);
}

async function bootstrap() {
  // Load site config before the first React render so the selected interface
  // theme is known immediately and does not flash to the default theme.
  // 样式表等待与配置拉取并行执行。
  const [publicSettings] = await Promise.all([getCachedPublicSettings(), waitForStylesheets()]);
  await initI18n(publicSettings);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();

// Register the service worker for PWA installability (the address-bar "Install"
// affordance). Non-blocking — a failed registration never impairs the app, it
// just means the install prompt won't appear. Both localhost and HTTPS are
// secure contexts, so this works in dev and production.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* silent — install prompt simply won't be offered */
    });
  });
}
