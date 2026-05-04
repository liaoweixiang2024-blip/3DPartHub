import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { getMaintenanceStatus } from '../lib/maintenance.js';
import { getVerifiedRequestUser } from './auth.js';

const PUBLIC_API_ALLOWLIST = [
  /^\/api\/health(?:\/|$)/,
  /^\/api\/settings\/public$/,
  /^\/api\/settings\/maintenance-status$/,
  /^\/api\/auth\/captcha$/,
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/refresh$/,
  /^\/api\/auth\/logout$/,
  /^\/api\/auth\/profile$/,
  /^\/api\/auth\/password$/,
];

function shouldCheckMaintenance(path: string): boolean {
  return path.startsWith('/api/') || path === '/static/models' || path.startsWith('/static/models/');
}

function isAllowlisted(path: string): boolean {
  return PUBLIC_API_ALLOWLIST.some((pattern) => pattern.test(path));
}

export async function maintenanceGuard(req: Request, res: Response, next: NextFunction) {
  if (!shouldCheckMaintenance(req.path) || isAllowlisted(req.path)) {
    next();
    return;
  }

  const status = await getMaintenanceStatus();
  if (!status.enabled) {
    next();
    return;
  }

  try {
    const verified = await getVerifiedRequestUser(req);
    if (verified?.payload.role === 'ADMIN' && !verified.mustChangePassword) {
      next();
      return;
    }
  } catch (err) {
    logger.error({ err }, '[maintenance] Failed to verify admin bypass');
  }

  res.setHeader('Retry-After', '60');
  res.status(503).json({
    detail: status.message,
    code: 'MAINTENANCE_MODE',
    maintenance: status,
  });
}
