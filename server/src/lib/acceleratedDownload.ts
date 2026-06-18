import { createReadStream, statSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import type { Request, Response } from 'express';
import { config } from './config.js';
import { getCachedSettings } from './settings.js';

type Disposition = 'attachment' | 'inline';

function safeHeaderFileName(fileName: string) {
  const sanitized = Array.from(String(fileName || 'download').replace(/[<>:"/\\|?*]/g, '_'))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
  return sanitized.trim() || 'download';
}

function asciiFileName(fileName: string) {
  return safeHeaderFileName(fileName)
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, "'");
}

function contentDisposition(disposition: Disposition, fileName: string) {
  const headerName = safeHeaderFileName(fileName);
  const safeName = asciiFileName(fileName);
  return `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(headerName)}`;
}

function contentTypeForFile(fileName: string) {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

/** 资源下载默认 Cache-Control：读后台 resource_cache_max_age_days（天），缺失/非法回退 300s。 */
function defaultResourceCacheControl(): string {
  const days = Number(getCachedSettings().resource_cache_max_age_days);
  const seconds = Number.isFinite(days) && days >= 0 ? Math.min(days, 3650) * 24 * 3600 : 300;
  return `private, max-age=${seconds}`;
}

function accelPathFor(filePath: string): string | null {
  const absolutePath = resolve(filePath);
  const roots = [
    { root: resolve(process.cwd(), config.staticDir), prefix: '/_protected_static' },
    { root: resolve(process.cwd(), config.uploadDir), prefix: '/_protected_uploads' },
  ];

  for (const { root, prefix } of roots) {
    const rel = relative(root, absolutePath);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.includes('\0')) continue;
    const encoded = rel.split(sep).map(encodeURIComponent).join('/');
    return `${prefix}/${encoded}`;
  }

  return null;
}

function parseRangeHeader(rangeHeader: string | undefined, fileSize: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, fileSize - suffixLength);
    return { start, end: fileSize - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : fileSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= fileSize) {
    return null;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

export function sendAcceleratedFile(
  req: Request,
  res: Response,
  options: {
    filePath: string;
    fileName: string;
    contentType?: string;
    disposition?: Disposition;
    cacheControl?: string;
  },
) {
  const {
    filePath,
    fileName,
    contentType = contentTypeForFile(fileName),
    disposition = 'attachment',
    cacheControl = defaultResourceCacheControl(),
  } = options;

  const absolutePath = resolve(filePath);
  const allowedRoots = [resolve(process.cwd(), config.staticDir), resolve(process.cwd(), config.uploadDir)];
  const isContained = allowedRoots.some((root) => absolutePath === root || absolutePath.startsWith(`${root}${sep}`));
  if (!isContained) {
    res.status(403).json({ detail: '文件访问被拒绝' });
    return;
  }

  let fileSize = 0;
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile()) {
      res.status(404).json({ detail: '文件不存在' });
      return;
    }
    fileSize = stat.size;
  } catch {
    res.status(404).json({ detail: '文件不存在' });
    return;
  }

  res.setHeader('Content-Disposition', contentDisposition(disposition, fileName));
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(fileSize));

  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }

  // 加速（X-Accel-Redirect）由 nginx 的 X-Accel-Available 头驱动（client/nginx.conf 显式设置）。
  // 注意：resource_download_acceleration_enabled 设置默认 false，且 initDefaultSettings 用
  // skipDuplicates 不可回填，若按该设置门控会关掉生产环境既有的 nginx 加速，故此处保持头驱动。
  const accelPath = req.headers['x-accel-available'] === '1' ? accelPathFor(filePath) : null;
  if (accelPath) {
    res.setHeader('X-Accel-Redirect', accelPath);
    res.status(200).end();
    return;
  }

  const range = parseRangeHeader(req.headers.range, fileSize);
  let streamOptions: { start?: number; end?: number } | undefined;
  if (req.headers.range) {
    if (!range) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.setHeader('Content-Length', '0');
      res.end();
      return;
    }
    streamOptions = { start: range.start, end: range.end };
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${fileSize}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  }

  const stream = createReadStream(absolutePath, streamOptions);
  stream.on('error', () => stream.destroy());
  res.on('close', () => {
    if (!stream.destroyed) stream.destroy();
  });
  stream.pipe(res);
}
