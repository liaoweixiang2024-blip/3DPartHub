import { i18n, normalizeLocale } from '../i18n';

function isIosLikeDevice() {
  const platform = navigator.platform || '';
  const userAgent = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return Boolean(
    standaloneNavigator.standalone ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches,
  );
}

function isWeChatBrowser() {
  return /MicroMessenger/i.test(navigator.userAgent || '');
}

function isMobileLikeBrowser() {
  const userAgent = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || navigator.maxTouchPoints > 1;
}

function shouldIsolateDownloadNavigation() {
  return isIosLikeDevice() && isStandaloneApp();
}

function shouldUseBlobDownloadNavigation() {
  return shouldIsolateDownloadNavigation() || (isWeChatBrowser() && isMobileLikeBrowser());
}

export function shouldUseIsolatedBrowserDownload() {
  return shouldIsolateDownloadNavigation();
}

type PreparedDownloadWindow = Window | null | undefined;

type DownloadRequestOptions = {
  method?: 'GET' | 'POST';
  headers?: HeadersInit;
  body?: BodyInit | null;
  credentials?: RequestCredentials;
  fileName?: string;
  preparedWindow?: PreparedDownloadWindow;
};

type BrowserDocumentOptions = {
  title?: string;
  fallbackUrl?: string;
  preparedWindow?: PreparedDownloadWindow;
};

function tDownload(key: string, fallback: string, values?: Record<string, unknown>) {
  if (!i18n.isInitialized) return fallback;
  return String(i18n.t(key, { defaultValue: fallback, ...values }));
}

function currentDocumentLang() {
  const locale = normalizeLocale(i18n.language);
  if (locale === 'en-US') return 'en';
  if (locale === 'zh-TW') return 'zh-TW';
  if (locale === 'ja-JP') return 'ja';
  if (locale === 'ko-KR') return 'ko';
  if (locale === 'de-DE') return 'de';
  return 'zh-CN';
}

function currentBrowserPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || '/';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForInlineScript(value: string) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildDownloadWindowHtml(message = tDownload('browserDownload.preparingDownload', '正在准备下载...')) {
  const safeMessage = escapeHtml(message);
  const exitLabel = escapeHtml(tDownload('browserDownload.exit', '退出'));
  return `<!doctype html><html lang="${currentDocumentLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${safeMessage}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#1d1b20;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.exit{position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:12px;height:36px;border:0;border-radius:18px;background:#111827;color:#fff;padding:0 14px;font-size:14px;font-weight:600}.box{max-width:280px;padding:20px;text-align:center}.spinner{width:28px;height:28px;margin:0 auto 14px;border:3px solid rgba(0,0,0,.12);border-top-color:#2563eb;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}p{margin:0;font-size:14px;line-height:1.6;color:#555}</style></head><body><button class="exit" onclick="window.close()">${exitLabel}</button><div class="box"><div class="spinner"></div><p>${safeMessage}</p></div></body></html>`;
}

function buildDocumentViewerHtml(href: string, options: BrowserDocumentOptions = {}) {
  const title = escapeHtml(options.title || tDownload('browserDownload.filePreview', '文件预览'));
  const safeHref = escapeHtml(href);
  const fallbackUrl = options.fallbackUrl || '/';
  const exitLabel = escapeHtml(tDownload('browserDownload.exit', '退出'));
  const openLabel = escapeHtml(tDownload('browserDownload.open', '打开'));
  const fallbackText = escapeHtml(
    tDownload('browserDownload.documentFallback', '如果图纸没有显示，点右上角“打开”；完成后点左上角“退出”。'),
  );
  return `<!doctype html><html lang="${currentDocumentLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111827;color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.bar{height:calc(52px + env(safe-area-inset-top,0px));padding:env(safe-area-inset-top,0px) 12px 0;display:flex;align-items:center;gap:10px;background:#111827;border-bottom:1px solid rgba(255,255,255,.1);box-sizing:border-box}.exit,.open{height:36px;border:0;border-radius:18px;padding:0 14px;font-size:14px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.exit{background:#fff;color:#111827}.open{margin-left:auto;background:rgba(255,255,255,.12);color:#fff}.title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:700}.viewer{display:block;width:100%;height:calc(100% - 52px - env(safe-area-inset-top,0px));border:0;background:#f3f4f6}.fallback{position:fixed;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);padding:10px 12px;border-radius:12px;background:rgba(17,24,39,.82);backdrop-filter:blur(12px);font-size:12px;line-height:1.5;color:#d1d5db}</style></head><body><div class="bar"><button class="exit" id="exitButton" type="button">${exitLabel}</button><div class="title">${title}</div><a class="open" href="${safeHref}" target="_self">${openLabel}</a></div><iframe class="viewer" src="${safeHref}" title="${title}"></iframe><div class="fallback">${fallbackText}</div><script>const fallbackUrl=${jsonForInlineScript(
    fallbackUrl,
  )};document.getElementById('exitButton').addEventListener('click',function(){try{window.close()}catch(e){}setTimeout(function(){if(!window.closed)location.href=fallbackUrl},80)})</script></body></html>`;
}

function updatePreparedWindow(win: PreparedDownloadWindow, message: string) {
  if (!win || win.closed) return;
  try {
    win.document.open();
    win.document.write(buildDownloadWindowHtml(message));
    win.document.close();
  } catch {
    // Cross-context windows may not expose document writes; navigation fallback still works.
  }
}

function closePreparedWindow(win: PreparedDownloadWindow) {
  if (!win || win.closed) return;
  try {
    win.close();
  } catch {
    // Nothing useful to do if the browser refuses to close it.
  }
}

function openPreparedDownloadWindow(): PreparedDownloadWindow {
  if (!shouldIsolateDownloadNavigation()) return null;
  const win = window.open('', '_blank');
  if (win) {
    try {
      win.opener = null;
    } catch {
      // Some browsers expose opener as readonly for isolated contexts.
    }
    updatePreparedWindow(win, tDownload('browserDownload.preparingDownload', '正在准备下载...'));
  }
  return win;
}

export function prepareBrowserDownload(): PreparedDownloadWindow {
  return openPreparedDownloadWindow();
}

export function prepareBrowserDocument(
  message = tDownload('browserDownload.openingFile', '正在打开文件...'),
): PreparedDownloadWindow {
  const win = window.open('', '_blank');
  if (win) {
    try {
      win.opener = null;
    } catch {
      // Some browsers expose opener as readonly for isolated contexts.
    }
    updatePreparedWindow(win, message);
  }
  return win;
}

export function cancelPreparedBrowserDownload(win: PreparedDownloadWindow) {
  closePreparedWindow(win);
}

function parseContentDispositionFileName(disposition: string | null): string {
  if (!disposition) return '';

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;\n]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return utf8Match[1].trim().replace(/^"|"$/g, '');
    }
  }

  const plainMatch = disposition.match(/filename="?([^";\n]+)"?/i);
  return plainMatch?.[1]?.trim() || '';
}

function sanitizeFileName(fileName: string) {
  const cleaned = Array.from(fileName || 'download')
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || /[<>:"/\\|?*]/.test(char) ? '_' : char;
    })
    .join('')
    .trim();
  return cleaned || 'download';
}

async function shareBlobFile(blob: Blob, fileName: string) {
  if (typeof File === 'undefined') return false;
  const file = new File([blob], sanitizeFileName(fileName), {
    type: blob.type || 'application/octet-stream',
  });
  const sharePayload = { files: [file], title: file.name };
  const canShareFiles =
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare(sharePayload);
  if (!canShareFiles) return false;
  await navigator.share(sharePayload);
  return true;
}

function navigatePreparedWindowToBlob(win: PreparedDownloadWindow, blobUrl: string) {
  if (win && !win.closed) {
    try {
      win.location.replace(blobUrl);
      return true;
    } catch {
      // Fall through to a normal browser-triggered download.
    }
  }
  return false;
}

async function fetchBlobDownload(href: string, options: DownloadRequestOptions = {}) {
  const response = await fetch(href, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    credentials: options.credentials || 'include',
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      text ||
        tDownload('browserDownload.downloadFailedWithStatus', '下载失败: {{status}}', { status: response.status }),
    );
  }

  const blob = await response.blob();
  const fileName = options.fileName || parseContentDispositionFileName(response.headers.get('Content-Disposition'));
  return { blob, fileName: sanitizeFileName(fileName) };
}

export async function downloadBrowserFile(href: string, options: DownloadRequestOptions = {}): Promise<void> {
  if (!href) return;

  if (!shouldUseBlobDownloadNavigation() || href.startsWith('blob:')) {
    triggerBrowserDownload(href, options.fileName);
    return;
  }

  const preparedWindow = options.preparedWindow ?? openPreparedDownloadWindow();
  updatePreparedWindow(preparedWindow, tDownload('browserDownload.preparingDownload', '正在准备下载...'));
  const { blob, fileName } = await fetchBlobDownload(href, options);
  await downloadBrowserBlob(blob, fileName, { preparedWindow });
}

export async function downloadBrowserBlob(
  blob: Blob,
  fileName = 'download',
  options: { preparedWindow?: PreparedDownloadWindow } = {},
): Promise<void> {
  const preparedWindow = options.preparedWindow;
  const safeFileName = sanitizeFileName(fileName);

  if (!shouldUseBlobDownloadNavigation()) {
    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(blobUrl, safeFileName);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  try {
    updatePreparedWindow(
      preparedWindow,
      tDownload('browserDownload.chooseShareTarget', '请选择“存储到文件”或分享目标'),
    );
    const shared = await shareBlobFile(blob, safeFileName);
    if (shared) {
      closePreparedWindow(preparedWindow);
      return;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      closePreparedWindow(preparedWindow);
      return;
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  if (!navigatePreparedWindowToBlob(preparedWindow, blobUrl)) {
    triggerBrowserDownload(blobUrl, safeFileName);
  }
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export async function downloadBrowserPostFile(
  href: string,
  body: BodyInit,
  options: Omit<DownloadRequestOptions, 'method' | 'body'> = {},
): Promise<void> {
  await downloadBrowserFile(href, {
    ...options,
    method: 'POST',
    body,
  });
}

export function openBrowserDocument(href: string, options: BrowserDocumentOptions = {}) {
  if (!href) return;

  const preparedWindow = options.preparedWindow ?? window.open('about:blank', '_blank');
  if (preparedWindow) {
    try {
      preparedWindow.opener = null;
    } catch {
      // Some browsers expose opener as readonly for isolated contexts.
    }
  }

  if (shouldIsolateDownloadNavigation()) {
    if (preparedWindow && !preparedWindow.closed) {
      try {
        preparedWindow.document.open();
        preparedWindow.document.write(buildDocumentViewerHtml(href, options));
        preparedWindow.document.close();
        return;
      } catch {
        // Fall through to direct navigation.
      }
    }
    window.location.href = href;
    return;
  }

  if (preparedWindow && !preparedWindow.closed) {
    preparedWindow.location.replace(href);
    return;
  }
  window.location.href = href;
}

export function openDocumentUrl(href: string, options: BrowserDocumentOptions = {}) {
  openBrowserDocument(href, {
    ...options,
    fallbackUrl: options.fallbackUrl || currentBrowserPath(),
  });
}

export function triggerBrowserDownload(href: string, fileName = '') {
  if (!href) return;

  if (shouldIsolateDownloadNavigation() && !href.startsWith('blob:')) {
    const preparedWindow = openPreparedDownloadWindow();
    if (preparedWindow && !preparedWindow.closed) {
      preparedWindow.location.replace(href);
      return;
    }
  }

  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
