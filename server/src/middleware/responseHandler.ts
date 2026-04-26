import { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth.js";

/**
 * Wraps successful JSON responses in { success: true, data: ... } format.
 * Works by overriding res.json to auto-wrap the payload.
 */
export function responseHandler(req: AuthRequest, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown) {
    // Skip if already wrapped or if it's an error response (status >= 400)
    if (
      typeof body === "object" &&
      body !== null &&
      "success" in (body as Record<string, unknown>)
    ) {
      return originalJson(body);
    }

    // Only wrap successful responses
    if (res.statusCode < 400) {
      return originalJson({ success: true, data: body });
    }

    // Error responses: wrap as { success: false, message: ... } and keep extra payload fields.
    if (typeof body === "object" && body !== null) {
      const payload = body as Record<string, unknown>;
      const { detail, message, ...rest } = payload;
      return originalJson({
        success: false,
        message: detail || message || "请求失败",
        ...rest,
      });
    }

    return originalJson({ success: false, message: body });
  };

  next();
}
