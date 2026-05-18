import { Router, Response } from 'express';
import { getAllSettings } from '../../lib/settings.js';
import {
  cancelStorageSyncJob,
  deleteStorageSyncJob,
  getAvailableStorageSyncScopes,
  getStorageSyncJob,
  getStorageSyncStatus,
  startStorageSyncJob,
  type StorageSyncDirection,
} from '../../lib/storageSync.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { adminOnly } from './common.js';

function readBodyArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readDirection(value: unknown): StorageSyncDirection {
  return value === 'cloud_to_local' ? 'cloud_to_local' : 'local_to_cloud';
}

export function createSettingsStorageSyncRouter() {
  const router = Router();

  router.get('/api/settings/storage/sync', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const settings = await getAllSettings();
      res.json({
        ...getStorageSyncStatus(),
        scopes: getAvailableStorageSyncScopes(settings),
      });
    } catch {
      res.status(500).json({ detail: '获取同步状态失败' });
    }
  });

  router.get('/api/settings/storage/sync/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const id = String(req.params.id || '');
    const job = getStorageSyncJob(id);
    if (!job) {
      res.status(404).json({ detail: '同步任务不存在' });
      return;
    }
    res.json(job);
  });

  router.post('/api/settings/storage/sync', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const settings = await getAllSettings();
      const job = startStorageSyncJob(settings, {
        direction: readDirection(req.body?.direction),
        scopes: readBodyArray(req.body?.scopes),
        overwrite: Boolean(req.body?.overwrite),
        deleteExtraneous: Boolean(req.body?.deleteExtraneous),
      });
      res.json(job);
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : '启动同步失败' });
    }
  });

  router.post('/api/settings/storage/sync/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    const id = String(req.params.id || '');
    const job = cancelStorageSyncJob(id);
    if (!job) {
      res.status(404).json({ detail: '同步任务不存在' });
      return;
    }
    res.json(job);
  });

  router.delete('/api/settings/storage/sync/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = String(req.params.id || '');
      const deleted = deleteStorageSyncJob(id);
      if (!deleted) {
        res.status(404).json({ detail: '同步任务不存在' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : '删除同步记录失败' });
    }
  });

  return router;
}
