import { Response, NextFunction, Request } from "express";
import { prisma } from "../lib/prisma.js";
import type { AuthRequest } from "./auth.js";

/**
 * Auto-audit middleware — applied globally, records mutation operations.
 * Only logs POST/PUT/DELETE/PATCH on /api/* routes.
 * Skips noisy paths like task polling, message refresh, etc.
 */
const SKIP_PREFIXES = [
  "/api/health",
  "/api/tasks?", // GET task status, not mutations
  "/api/settings/backup/progress", // polling
  "/api/settings/backup/restore-progress", // polling
  "/api/notifications", // GET polling
  "/api/audit", // don't audit the audit log itself
  "/api/auth/refresh", // token refresh noise
];

const ACTION_MAP: Record<string, string> = {
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

// Map URL patterns to resource names
function extractResource(path: string): string {
  if (path.includes("/models")) return "model";
  if (path.includes("/auth/login")) return "auth";
  if (path.includes("/auth/register")) return "auth";
  if (path.includes("/users")) return "user";
  if (path.includes("/categories")) return "category";
  if (path.includes("/comments")) return "comment";
  if (path.includes("/favorites")) return "favorite";
  if (path.includes("/tickets")) return "ticket";
  if (path.includes("/tasks") && !path.includes("/tickets")) return "ticket";
  if (path.includes("/settings")) return "settings";
  if (path.includes("/shares")) return "share";
  if (path.includes("/projects")) return "project";
  if (path.includes("/download")) return "download";
  return "other";
}

// Refine action based on URL
function refineAction(method: string, path: string): string {
  if (path.includes("/upload") || path.includes("/reconvert")) return "upload";
  if (path.includes("/login")) return "login";
  if (path.includes("/register")) return "register";
  if (path.includes("/download")) return "download";
  if (path.includes("/favorite") && method === "POST") return "favorite";
  if (path.includes("/favorite") && method === "DELETE") return "unfavorite";
  if (path.includes("/comment")) return "comment";
  if (path.includes("/settings") && method === "PUT") return "settings_update";
  if (path.includes("/tickets") && path.includes("/messages")) return "ticket_reply";
  if (path.includes("/tickets") && method === "PUT") return "ticket_status";
  if (path.includes("/tasks") && method === "POST" && !path.includes("/tickets")) return "ticket_create";
  return ACTION_MAP[method] || method.toLowerCase();
}

export function autoAudit(req: Request, _res: Response, next: NextFunction) {
  const path = req.originalUrl || req.path;

  // Only audit mutation methods on /api routes
  if (!path.startsWith("/api/") || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  // Skip noisy paths
  if (SKIP_PREFIXES.some(prefix => path.startsWith(prefix))) {
    next();
    return;
  }

  const action = refineAction(req.method, path);
  const resource = extractResource(path);

  // Attach a listener to log after response
  _res.on("finish", () => {
    if (_res.statusCode >= 400) return; // Don't log failed requests

    setImmediate(async () => {
      try {
        const authReq = req as AuthRequest;
        const userId = authReq.user?.userId || null;
        const resourceId = req.params?.id || req.params?.projectId || (req.body as any)?.id || null;

        const details: Record<string, unknown> = {
          method: req.method,
          path,
          statusCode: _res.statusCode,
        };

        // Include relevant body fields (sanitized)
        const body = req.body as Record<string, unknown>;
        if (body && typeof body === "object") {
          const safeFields: Record<string, unknown> = {};
          for (const key of ["name", "status", "classification", "description", "role", "email", "username", "format"]) {
            if (key in body) safeFields[key] = body[key];
          }
          if (Object.keys(safeFields).length > 0) details.body = safeFields;
        }

        await prisma.auditLog.create({
          data: {
            userId,
            action,
            resource,
            resourceId: resourceId as string | null,
            details,
          },
        });
      } catch {
        // Best-effort logging
      }
    });
  });

  next();
}
