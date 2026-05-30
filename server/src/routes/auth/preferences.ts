import type { Prisma } from '@prisma/client';
import { Router, Response } from 'express';
import {
  DEFAULT_NOTIFICATION_PREFS,
  notificationPrefsFromMetadata,
  userWantsNotification,
} from '../../lib/notificationDelivery.js';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';

function jsonObject(value: unknown): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Prisma.JsonObject) };
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  );
}

export function createAuthPreferencesRouter() {
  const router = Router();

  // GET /api/auth/notification-prefs - get user's notification preferences
  router.get('/api/auth/notification-prefs', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { metadata: true },
      });
      res.json(notificationPrefsFromMetadata(user?.metadata));
    } catch {
      res.json(DEFAULT_NOTIFICATION_PREFS);
    }
  });

  // PUT /api/auth/notification-prefs
  router.put('/api/auth/notification-prefs', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const prefs = {
        ...DEFAULT_NOTIFICATION_PREFS,
        ...booleanRecord(req.body),
      };
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { metadata: true },
      });
      const meta = jsonObject(user?.metadata);
      meta.notificationPrefs = prefs;
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { metadata: meta as Prisma.InputJsonValue },
      });
      res.json(prefs);
    } catch {
      res.status(500).json({ detail: '更新通知偏好失败' });
    }
  });

  return router;
}

export { userWantsNotification };
