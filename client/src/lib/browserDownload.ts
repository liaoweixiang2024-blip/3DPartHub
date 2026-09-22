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

/** 跨 window 的异常对象不满足 instanceof DOMException，只能按 name 判断（分享取消等）。 */
function isAbortErrorLike(error: unknown) {
  return Boolean(error) && (error as { name?: string }).name === 'AbortError';
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unit]}`;
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

/**
 * iOS 主屏 WebApp 内的分享面板只能在「聚焦窗口」里可靠弹出：旧实现先开浮层（浮层抢走焦点），
 * 再从失焦的主窗口调用 navigator.share，会静默挂起（面板不弹、Promise 永不 settle），
 * 表现为卡死在“请选择存储到文件…”提示页。此页把浮层本身渲染成保存/分享操作页，
 * 分享调用改在该聚焦窗口内先自动尝试一次，失败/挂起时用户仍可点按钮手动触发（手势+聚焦，最可靠）。
 */
function buildShareTargetHtml(fileName: string, fileSize: number) {
  const name = escapeHtml(fileName || 'download');
  const size = escapeHtml(formatFileSize(fileSize));
  const hint = escapeHtml(tDownload('browserDownload.chooseShareTarget', '请选择“存储到文件”或分享目标'));
  const saveLabel = escapeHtml(tDownload('browserDownload.saveOrShare', '保存到文件 / 分享'));
  const directLabel = escapeHtml(tDownload('browserDownload.directDownload', '直接下载'));
  const failText = escapeHtml(tDownload('browserDownload.shareFailed', '无法打开分享面板，请点“直接下载”重试'));
  const exitLabel = escapeHtml(tDownload('browserDownload.exit', '退出'));
  return `<!doctype html><html lang="${currentDocumentLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${name}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#1d1b20;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.exit{position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:12px;height:36px;border:0;border-radius:18px;background:#111827;color:#fff;padding:0 14px;font-size:14px;font-weight:600}.card{box-sizing:border-box;width:min(320px,calc(100vw - 48px));padding:24px 20px;text-align:center;background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:20px;box-shadow:0 12px 32px rgba(17,24,39,.08)}.icon{width:56px;height:56px;margin:0 auto 12px;display:grid;place-items:center;border-radius:16px;background:#111827;color:#fff}.icon svg{width:26px;height:26px}.name{font-size:15px;font-weight:700;word-break:break-all}.size{margin-top:2px;font-size:13px;color:#6b7280}.hint{margin:14px 0 18px;font-size:13px;line-height:1.6;color:#6b7280}.btn{display:flex;width:100%;height:48px;align-items:center;justify-content:center;border:0;border-radius:14px;font-size:15px;font-weight:700}.btn.primary{background:#111827;color:#fff}.btn.ghost{margin-top:10px;background:transparent;border:1.5px solid rgba(17,24,39,.18);color:#374151}.fail{margin:12px 0 0;font-size:12px;line-height:1.5;color:#b91c1c}.fail[hidden]{display:none}</style></head><body><button class="exit" onclick="window.close()">${exitLabel}</button><div class="card"><div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg></div><div class="name">${name}</div>${size ? `<div class="size">${size}</div>` : ''}<p class="hint">${hint}</p><button class="btn primary" id="shareBtn" type="button">${saveLabel}</button><button class="btn ghost" id="directBtn" type="button">${directLabel}</button><p class="fail" id="shareFailHint" hidden>${failText}</p></div></body></html>`;
}

function presentShareTargetWindow(
  win: NonNullable<PreparedDownloadWindow>,
  blob: Blob,
  blobUrl: string,
  fileName: string,
) {
  try {
    const doc = win.document;
    doc.open();
    doc.write(buildShareTargetHtml(fileName, blob.size));
    doc.close();
  } catch {
    // Cross-context windows may not expose document writes; fall back to navigation download.
    return false;
  }

  const shareFromWindow = async () => {
    const realmFile = (win as unknown as { File?: typeof File }).File;
    const file =
      realmFile && typeof realmFile === 'function'
        ? new realmFile([blob], fileName, { type: blob.type || 'application/octet-stream' })
        : createShareFileFallback(blob, fileName);
    if (!file) return false;
    const targetNavigator = win.navigator;
    if (!targetNavigator || typeof targetNavigator.share !== 'function') return false;
    const sharePayload = { files: [file], title: file.name };
    if (typeof targetNavigator.canShare === 'function' && !targetNavigator.canShare(sharePayload)) {
      return false;
    }
    await targetNavigator.share(sharePayload);
    return true;
  };

  const failHint = win.document.getElementById('shareFailHint');
  win.document.getElementById('shareBtn')?.addEventListener('click', () => {
    failHint?.setAttribute('hidden', '');
    shareFromWindow()
      .then((shared) => {
        if (shared) {
          closePreparedWindow(win);
          return;
        }
        failHint?.removeAttribute('hidden');
      })
      .catch((error: unknown) => {
        if (isAbortErrorLike(error)) return;
        failHint?.removeAttribute('hidden');
      });
  });
  win.document.getElementById('directBtn')?.addEventListener('click', () => {
    // 优先 <a download>（Safari iOS 13+ 官方下载通道），失败再退回整窗导航到 blob:
    let delivered = false;
    try {
      const anchor = win.document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      win.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      delivered = true;
    } catch {
      delivered = false;
    }
    if (!delivered && !navigatePreparedWindowToBlob(win, blobUrl)) {
      triggerBrowserDownload(blobUrl, fileName);
    }
  });

  // 零点击优化：窗口聚焦时先自动拉起一次分享面板；挂起或失败也不阻塞，页面上按钮随时可点。
  shareFromWindow()
    .then((shared) => {
      if (shared) closePreparedWindow(win);
    })
    .catch(() => {});
  return true;
}

function createShareFileFallback(blob: Blob, fileName: string) {
  if (typeof File === 'undefined') return null;
  return new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
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

  const blobUrl = URL.createObjectURL(blob);
  // iOS 主屏 WebApp：浮层已抢走焦点，分享必须改在浮层内进行，否则会静默挂起（见 buildShareTargetHtml 注释）。
  if (
    preparedWindow &&
    !preparedWindow.closed &&
    presentShareTargetWindow(preparedWindow, blob, blobUrl, safeFileName)
  ) {
    // 分享页自带「直接下载」兜底；blobUrl 交给用户操作，放宽回收时间。
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60_000);
    return;
  }

  // 没有可用浮层（如 window.open 被拦截）：主窗口仍处于聚焦状态，直接分享后回退 <a download>。
  try {
    const shared = await shareBlobFile(blob, safeFileName);
    if (shared) {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return;
    }
  } catch (error) {
    if (isAbortErrorLike(error)) {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      return;
    }
  }

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
