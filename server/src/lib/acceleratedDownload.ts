import { createReadStream, statSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import type { Request, Response } from 'express';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { getCachedSettings } from './settings.js';

const log = createLogger({ component: 'accelerated-download' });

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
    /** 强制走 Node 流式下发，跳过 X-Accel-Redirect 加速。 */
    forceStream?: boolean;
  },
) {
  const {
    filePath,
    fileName,
    contentType = contentTypeForFile(fileName),
    disposition = 'attachment',
    cacheControl = defaultResourceCacheControl(),
    forceStream = false,
  } = options;

  // 非白名单类型（contentTypeForFile 落到默认分支，含 .html/.svg/.htm 等可执行/可渲染内容）
  // 一律强制下载，避免被浏览器以 inline 方式渲染执行（XSS）。仅图片/PDF/zip 等白名单类型允许 inline。
  const forceDownload = contentType === 'application/octet-stream';
  const finalDisposition: Disposition = forceDownload ? 'attachment' : disposition;

  const absolutePath = resolve(filePath);
  const allowedRoots = [resolve(process.cwd(), config.staticDir), resolve(process.cwd(), config.uploadDir)];
  const isContained = allowedRoots.some((root) => absolutePath === root || absolutePath.startsWith(`${root}${sep}`));
  if (!isContained) {
    res.status(403).json({ detail: '文件访问被拒绝' });
    return;
  }

  let fileSize = 0;
  let fileMtimeMs = 0;
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile()) {
      res.status(404).json({ detail: '文件不存在' });
      return;
    }
    fileSize = stat.size;
    fileMtimeMs = stat.mtimeMs;
  } catch {
    res.status(404).json({ detail: '文件不存在' });
    return;
  }

  res.setHeader('Content-Disposition', contentDisposition(finalDisposition, fileName));
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(fileSize));
  // 断点续传验证器（RFC 7233）：中断重连时客户端带 If-Range 校验文件未变才续传，
  // 缺验证器时部分浏览器/下载工具（Safari、迅雷/IDM 等）会放弃续传、整单从零重下——
  // 大文件（GB 级备份）下载被网络抖动打断后表现为「快完成了又从头开始」。
  const etag = `"${fileSize}-${fileMtimeMs}"`;
  const lastModified = new Date(fileMtimeMs).toUTCString();
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', lastModified);

  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }

  // 加速（X-Accel-Redirect）由 nginx 的 X-Accel-Available 头驱动（client/nginx.conf 显式设置）。
  // 注意：resource_download_acceleration_enabled 设置默认 false，且 initDefaultSettings 用
  // skipDuplicates 不可回填，若按该设置门控会关掉生产环境既有的 nginx 加速，故此处保持头驱动。
  // forceStream：备份目录（static/backups）是全站唯一 bind mount，api 与 web(nginx) 容器的
  // 文件系统视图可能不一致（挂载漂移），而 API 无法探测 nginx 侧是否能看到文件——一旦漂移，
  // X-Accel-Redirect 会让 nginx 404 且 API 毫无感知。故备份下载强制走 Node 直连流，
  // 彻底不依赖 nginx 挂载备份目录。其他调用方的文件都在双容器共享的命名卷里，不受此影响。
  const accelPath = !forceStream && req.headers['x-accel-available'] === '1' ? accelPathFor(filePath) : null;
  if (accelPath) {
    res.setHeader('X-Accel-Redirect', accelPath);
    res.status(200).end();
    return;
  }

  const range = parseRangeHeader(req.headers.range, fileSize);
  // If-Range 匹配才续传（RFC 7233 §3.2）：验证器不符说明文件已变化，回退整单 200，
  // 客户端不会把新旧两段拼成坏文件。无 If-Range 头的裸 Range 请求照旧 206。
  const ifRange = Array.isArray(req.headers['if-range']) ? req.headers['if-range'][0] : req.headers['if-range'];
  const ifRangeMatches = !ifRange || ifRange === etag || (ifRange === lastModified && !ifRange.startsWith('W/'));
  let streamOptions: { start?: number; end?: number } | undefined;
  if (req.headers.range) {
    if (!range) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.setHeader('Content-Length', '0');
      res.end();
      return;
    }
    if (ifRangeMatches) {
      streamOptions = { start: range.start, end: range.end };
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${fileSize}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    }
    // If-Range 不匹配：忽略 Range，按整单 200 下发（Content-Length 已是全量大小）
  }

  const stream = createReadStream(absolutePath, streamOptions);
  stream.on('error', (err) => {
    // 读流失败必须留痕且在连接层掐断：只 destroy 流会让响应以「短于 Content-Length
    // 的正常结束」收尾，客户端可能把截断文件当下载成功保存；destroy 响应则明确
    // 标记中断，浏览器/下载工具会走断点续传（配合上面的 ETag/If-Range 可靠恢复）。
    log.error({ err, filePath: absolutePath }, 'File download stream failed');
    stream.destroy();
    res.destroy();
  });
  res.on('close', () => {
    if (!stream.destroyed) stream.destroy();
  });
  stream.pipe(res);
}
