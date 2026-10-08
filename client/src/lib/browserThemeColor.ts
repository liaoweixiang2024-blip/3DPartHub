const THEME_COLOR_META_SELECTOR = 'meta[name="theme-color"]';
const APPLE_STATUS_BAR_SELECTOR = 'meta[name="apple-mobile-web-app-status-bar-style"]';
const DEFAULT_LIGHT_CHROME_COLOR = '#faf9f7';
const DEFAULT_DARK_CHROME_COLOR = '#121316';

function ensureMeta(name: string): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  return meta;
}

function readCssVariable(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

export function syncBrowserChromeColor(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const root = document.documentElement;
  const isLight = root.classList.contains('theme-light');
  const styles = window.getComputedStyle(root);
  const color =
    readCssVariable(styles, '--color-surface-container-low') ||
    readCssVariable(styles, '--color-surface') ||
    (isLight ? DEFAULT_LIGHT_CHROME_COLOR : DEFAULT_DARK_CHROME_COLOR);

  const themeColor = document.querySelector<HTMLMetaElement>(THEME_COLOR_META_SELECTOR) || ensureMeta('theme-color');
  themeColor.content = color;

  const statusBar =
    document.querySelector<HTMLMetaElement>(APPLE_STATUS_BAR_SELECTOR) ||
    ensureMeta('apple-mobile-web-app-status-bar-style');
  statusBar.content = isLight ? 'default' : 'black-translucent';
  // 与 index.html 启动脚本的首屏底色保持同一来源（--color-surface）：
  // 切主题时同步 html 底色，移动端过卷发光区/应用未铺满区域不露出旧主题的颜色。
  // 注意别复用上面的 color（surface-container-low，供浏览器标题栏取色），
  // 否则底色比应用表面亮一档，过卷时会露馅
  const bgColor =
    readCssVariable(styles, '--color-surface') || (isLight ? DEFAULT_LIGHT_CHROME_COLOR : DEFAULT_DARK_CHROME_COLOR);
  root.style.backgroundColor = bgColor;
  root.style.colorScheme = isLight ? 'light' : 'dark';
}
