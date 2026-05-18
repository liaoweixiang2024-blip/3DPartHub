import type { Prisma } from '@prisma/client';
import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import type { AuthRequest } from './auth.js';

/**
 * Audit log middleware — records mutation operations to the database.
 * Applied to POST/PUT/DELETE routes automatically.
 */
export function auditLog(action: string, resource: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Intercept res.json to capture the response for logging
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      // Log after response is sent (fire-and-forget)
      setImmediate(async () => {
        try {
          const userId = req.user?.userId || null;
          const resourceId = req.params?.id || req.params?.projectId || req.body?.id || null;

          const details: Record<string, Prisma.InputJsonValue> = {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            timestamp: new Date().toISOString(),
          };
          const body = sanitizeBody(req.body);
          if (body) {
            details.body = body;
          }

          await prisma.auditLog.create({
            data: {
              userId,
              action,
              resource,
              resourceId: resourceId as string | null,
              details: details as Prisma.InputJsonObject,
            },
          });
        } catch {
          // Audit logging is best-effort, don't fail the request
        }
      });

      return originalJson(body);
    };

    next();
  };
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'access_token',
  'refresh_token',
  'newPassword',
  'oldPassword',
  'confirmPassword',
  'smtp_pass',
  'smtpPass',
  'creditCard',
  'ssn',
  'privateKey',
  'credential',
  'cookie',
]);

function sanitizeBody(body: unknown): Prisma.InputJsonObject | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const sanitized: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key) || /pass|secret|token|key|credential/i.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = toJsonValue(value);
    }
  }
  return sanitized as Prisma.InputJsonObject;
}

function toJsonValue(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === null) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (depth >= 5) return '[array]';
    return value.map((item) => toJsonValue(item, depth + 1)) as Prisma.InputJsonArray;
  }
  if (value && typeof value === 'object') {
    if (depth >= 5) return '[object]';
    const output: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[key] = toJsonValue(nestedValue, depth + 1);
    }
    return output as Prisma.InputJsonObject;
  }
  return '[unsupported]';
}
