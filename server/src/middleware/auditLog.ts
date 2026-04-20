import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import type { AuthRequest } from "./auth.js";

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

          await prisma.auditLog.create({
            data: {
              userId,
              action,
              resource,
              resourceId: resourceId as string | null,
              details: {
                method: req.method,
                path: req.path,
                body: sanitizeBody(req.body),
                statusCode: res.statusCode,
                timestamp: new Date().toISOString(),
              },
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

function sanitizeBody(body: any): any {
  if (!body || typeof body !== "object") return body;
  const sanitized = { ...body };
  // Remove sensitive fields
  for (const key of ["password", "passwordHash", "token", "secret"]) {
    if (key in sanitized) sanitized[key] = "[REDACTED]";
  }
  return sanitized;
}
