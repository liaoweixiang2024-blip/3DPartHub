// /static 云优先服务中间件：配了云就从云端流式代理（支持 Range），
// 云端 miss / 出错 / 未配云端时 next() 交给 express.static 走本地兜底。
import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger.js';
import { resolveCloudObject } from './storageProvider.js';

function cacheMaxAgeSeconds(subPath: string): number {
  // 缩略图长期缓存；模型/原始文件缓存 1 天（与原 express.static 行为一致）。
  return subPath.includes('/thumbnails/') ? 365 * 24 * 3600 : 24 * 3600;
}

export async function cloudFirstStatic(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  // 该中间件挂在 '/static' 上，req.path 已剥离挂载前缀，如 '/models/x.glb'。
  const subPath = req.path;
  if (!subPath || subPath === '/') return next();
  // temp-previews 是转换过程中的临时产物，仅本地，不查云端。
  if (subPath.includes('/temp-previews')) return next();

  const key = subPath.replace(/^\/+/, '').replace(/\\/g, '');
  if (!key || key.includes('..') || key.includes('\0')) return next();

  let obj;
  try {
    obj = await resolveCloudObject(key, req.headers.range as string | undefined);
  } catch (error) {
    logger.warn({ err: error, key }, 'cloud static lookup threw, falling back to local');
    return next();
  }
  if (!obj) return next(); // 未配云端 / 云端 miss / 出错 → express.static 本地兜底

  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', `public, max-age=${cacheMaxAgeSeconds(subPath)}`);
  if (obj.contentType) res.set('Content-Type', obj.contentType);
  if (obj.etag) res.set('ETag', obj.etag);
  if (obj.lastModified) res.set('Last-Modified', obj.lastModified.toUTCString());
  res.set('Content-Length', String(obj.contentLength));

  if (obj.partial) {
    res.status(206);
    if (obj.contentRange) res.set('Content-Range', obj.contentRange);
  } else {
    res.status(200);
  }

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  // 流中途出错：头部已发则销毁连接，避免挂起；不得回退本地（已向客户端提交状态码）。
  obj.stream.on('error', () => {
    if (res.headersSent) res.destroy();
    else res.end();
  });
  obj.stream.pipe(res);
}
