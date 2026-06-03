import { i18n } from '../i18n';
import {
  cancelPreparedBrowserDownload,
  downloadBrowserBlob,
  downloadBrowserPostFile,
  prepareBrowserDownload,
  shouldUseIsolatedBrowserDownload,
} from '../lib/browserDownload';
import { getAccessToken } from '../stores/useAuthStore';
import { unwrapApiData } from './response';

type BatchFieldValue = string | number | boolean | string[] | undefined;

export type BatchZipDownloadResult = {
  fileCount: number;
};

type BatchZipDownloadOptions = {
  url: string;
  fields: Record<string, BatchFieldValue>;
  legacyUrl?: string;
  legacyFields?: Record<string, BatchFieldValue>;
  fallbackFileCount: number;
  fallbackFileName: string;
};

type BatchZipPreflightResponse = {
  fileCount?: number;
};

function tDownload(key: string, fallback: string) {
  if (!i18n.isInitialized) return fallback;
  return String(i18n.t(key, { defaultValue: fallback }));
}

function waitForBrowserPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => window.setTimeout(resolve, 0));
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function serializeFieldValue(value: BatchFieldValue): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value ?? '');
}

function submitPostDownload(url: string, fields: Record<string, BatchFieldValue>): void {
  const frameName = `download-frame-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const iframe = document.createElement('iframe');
  iframe.name = frameName;
  iframe.style.display = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  form.target = frameName;
  form.enctype = 'application/x-www-form-urlencoded';
  form.style.display = 'none';

  Object.entries(fields).forEach(([name, value]) => {
    if (typeof value === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = serializeFieldValue(value);
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  form.remove();
  window.setTimeout(() => iframe.remove(), 60_000);
}

async function readDownloadError(resp: Response, fallback: string): Promise<string> {
  const data = await resp.json().catch(() => null);
  if (data && typeof data === 'object') {
    const payload = data as { message?: unknown; detail?: unknown; error?: unknown };
    if (typeof payload.message === 'string' && payload.message) return payload.message;
    if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
    if (typeof payload.error === 'string' && payload.error) return payload.error;
  }
  return fallback;
}

async function saveBatchBlobResponse(
  resp: Response,
  fileCount: number,
  fallbackFileName: string,
  preparedWindow?: ReturnType<typeof prepareBrowserDownload>,
): Promise<BatchZipDownloadResult> {
  const blob = await resp.blob();
  const disposition = resp.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";\n]+)"?/);
  await downloadBrowserBlob(blob, match ? match[1] : fallbackFileName, { preparedWindow });
  return { fileCount };
}

export async function downloadBatchZip({
  url,
  fields,
  legacyUrl,
  legacyFields,
  fallbackFileCount,
  fallbackFileName,
}: BatchZipDownloadOptions): Promise<BatchZipDownloadResult> {
  const preparedWindow = prepareBrowserDownload();
  await waitForBrowserPaint();
  const token = getAccessToken();
  let activeUrl = url;
  let activeFields = fields;
  const buildHeaders = (extra?: Record<string, string>) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  let resp: Response;

  try {
    resp = await fetch(activeUrl, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders({ 'X-Download-Preflight': '1' }),
      body: JSON.stringify(activeFields),
    });

    if (resp.status === 404 && legacyUrl) {
      activeUrl = legacyUrl;
      activeFields = legacyFields ?? fields;
      resp = await fetch(activeUrl, {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders({ 'X-Download-Preflight': '1' }),
        body: JSON.stringify(activeFields),
      });
    }

    if (!resp.ok) {
      throw new Error(
        await readDownloadError(resp, tDownload('browserDownload.batchZipFailed', 'Batch download failed')),
      );
    }

    const contentType = resp.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      return saveBatchBlobResponse(resp, fallbackFileCount, fallbackFileName, preparedWindow);
    }

    const checked = unwrapApiData<BatchZipPreflightResponse>(await resp.json().catch(() => ({})));
    const fileCount = Math.max(1, Math.floor(Number(checked?.fileCount) || fallbackFileCount));

    await waitForBrowserPaint();
    if (shouldUseIsolatedBrowserDownload()) {
      await downloadBrowserPostFile(activeUrl, JSON.stringify(activeFields), {
        preparedWindow,
        headers: buildHeaders(),
        credentials: 'include',
        fileName: fallbackFileName,
      });
    } else {
      submitPostDownload(activeUrl, activeFields);
    }
    await delay(700);
    return { fileCount };
  } catch (error) {
    cancelPreparedBrowserDownload(preparedWindow);
    throw error;
  }
}
