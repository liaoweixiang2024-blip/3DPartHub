import { Router, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';

const DEFAULT_NOTIFICATION_PREFS: Record<string, boolean> = {
  ticket: true,
  favorite: true,
  model_conversion: true,
  download: false,
};

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

function notificationPrefsFromMetadata(metadata: unknown): Record<string, boolean> {
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...booleanRecord(jsonObject(metadata).notificationPrefs),
  };
}

// Helper: check if user wants this notification type
export async function userWantsNotification(userId: string, type: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    const prefs = notificationPrefsFromMetadata(user?.metadata);
    return prefs[type] !== false;
  } catch {
    return true;
  }
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
        data: { metadata: meta },
      });
      res.json(prefs);
    } catch {
      res.status(500).json({ detail: '更新通知偏好失败' });
    }
  });

  return router;
}
