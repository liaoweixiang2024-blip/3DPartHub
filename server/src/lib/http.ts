import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncRouteHandler<Req extends Request = Request, Res extends Response = Response> = (
  req: Req,
  res: Res,
  next: NextFunction,
) => void | Promise<void>;

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, options: { code?: string; details?: unknown } = {}) {
    super(message);
    this.status = status;
    this.code = options.code;
    this.details = options.details;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

export function httpError(status: number, message: string, options: { code?: string; details?: unknown } = {}) {
  return new HttpError(status, message, options);
}

export const badRequest = (message: string, options?: { code?: string; details?: unknown }) =>
  httpError(400, message, options);

export const unauthorized = (message = '未认证', options?: { code?: string; details?: unknown }) =>
  httpError(401, message, options);

export const forbidden = (message = '权限不足', options?: { code?: string; details?: unknown }) =>
  httpError(403, message, options);

export const notFound = (message = '资源不存在', options?: { code?: string; details?: unknown }) =>
  httpError(404, message, options);

export const conflict = (message = '数据冲突', options?: { code?: string; details?: unknown }) =>
  httpError(409, message, options);

export function asyncHandler<Req extends Request = Request, Res extends Response = Response>(
  handler: AsyncRouteHandler<Req, Res>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as Req, res as Res, next)).catch(next);
  };
}
