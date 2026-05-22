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

function shouldIsolateDownloadNavigation() {
  return isIosLikeDevice() && isStandaloneApp();
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

function buildDownloadWindowHtml(message = '正在准备下载...') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${message}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#1d1b20;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.box{max-width:280px;padding:20px;text-align:center}.spinner{width:28px;height:28px;margin:0 auto 14px;border:3px solid rgba(0,0,0,.12);border-top-color:#2563eb;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}p{margin:0;font-size:14px;line-height:1.6;color:#555}</style></head><body><div class="box"><div class="spinner"></div><p>${message}</p></div></body></html>`;
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
    updatePreparedWindow(win, '正在准备下载...');
  }
  return win;
}

export function prepareBrowserDownload(): PreparedDownloadWindow {
  return openPreparedDownloadWindow();
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
    throw new Error(text || `下载失败: ${response.status}`);
  }

  const blob = await response.blob();
  const fileName = options.fileName || parseContentDispositionFileName(response.headers.get('Content-Disposition'));
  return { blob, fileName: sanitizeFileName(fileName) };
}

export async function downloadBrowserFile(href: string, options: DownloadRequestOptions = {}): Promise<void> {
  if (!href) return;

  if (!shouldIsolateDownloadNavigation() || href.startsWith('blob:')) {
    triggerBrowserDownload(href, options.fileName);
    return;
  }

  const preparedWindow = options.preparedWindow ?? openPreparedDownloadWindow();
  updatePreparedWindow(preparedWindow, '正在准备下载...');
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

  if (!shouldIsolateDownloadNavigation()) {
    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(blobUrl, safeFileName);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  try {
    updatePreparedWindow(preparedWindow, '请选择“存储到文件”或分享目标');
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
