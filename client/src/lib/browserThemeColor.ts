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
}
