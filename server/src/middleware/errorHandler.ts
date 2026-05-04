import { Request, Response, NextFunction } from 'express';
import { isHttpError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { RequestValidationError } from '../lib/requestValidation.js';

const isProduction = process.env.NODE_ENV === 'production';

function formatError(status: number, message: string) {
  return { success: false, message };
}

function isPrismaKnownRequestError(err: Error): err is Error & { code: string } {
  return err.constructor.name === 'PrismaClientKnownRequestError' && 'code' in err;
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (isHttpError(err)) {
    if (err.status >= 500) {
      logger.error({ err, status: err.status }, 'HTTP 5xx error');
    }
    // Hide internal details for 5xx errors in production
    if (isProduction && err.status >= 500) {
      res.status(err.status).json(formatError(err.status, '服务器内部错误'));
    } else {
      res.status(err.status).json({
        success: false,
        message: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      });
    }
    return;
  }

  if (err instanceof RequestValidationError) {
    res.status(err.status).json(formatError(err.status, err.message));
    return;
  }

  logger.error({ err }, 'Unhandled error');

  // Prisma known errors
  if (isPrismaKnownRequestError(err)) {
    if (err.code === 'P2025') {
      res.status(404).json(formatError(404, '资源不存在'));
      return;
    }
    if (err.code === 'P2002') {
      res.status(409).json(formatError(409, '数据冲突，记录已存在'));
      return;
    }
    res.status(400).json(formatError(400, '数据库操作失败'));
    return;
  }

  // Multer errors
  if (err.message?.includes('File too large')) {
    res.status(413).json(formatError(413, '文件大小超过限制'));
    return;
  }

  // Default
  res.status(500).json(formatError(500, '服务器内部错误'));
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json(formatError(404, '接口不存在'));
}
