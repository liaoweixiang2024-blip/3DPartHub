import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, Response } from 'express';
import { cacheDelByPrefix } from '../../lib/cache.js';
import { logger } from '../../lib/logger.js';
import { conversionQueue } from '../../lib/queue.js';
import { numericValue, stringArray } from '../../lib/requestValidation.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { findOriginalModelPath, isDeprecatedHtmlPreviewFormat } from '../../services/modelFiles.js';
import {
  buildPreviewDiagnosticItem,
  normalizePreviewDiagnosticFilter,
  shouldIncludePreviewDiagnostic,
} from '../../services/modelPreviewDiagnostics.js';
import { MODEL_STATUS } from '../../services/modelStatus.js';

type PreviewMetaOptions = {
  gltfUrl?: string | null;
  originalName?: string | null;
  format?: string | null;
  previewMeta?: unknown;
};

type PreviewDiagnosticRow = {
  id: string;
  name?: string | null;
  originalName?: string | null;
  format?: string | null;
  thumbnailUrl?: string | null;
  gltfUrl?: string | null;
  originalSize?: number | null;
  createdAt?: Date | string | null;
  category?: string | null;
  previewMeta?: unknown;
};

type ModelsPreviewDiagnosticsContext = {
  prisma: any;
  metadataDir: string;
  getPreviewMeta: (id: string, options?: PreviewMetaOptions) => Promise<Record<string, unknown> | null>;
};

export function createPreviewDiagnosticsRouter({
  prisma,
  metadataDir,
  getPreviewMeta,
}: ModelsPreviewDiagnosticsContext) {
  const router = Router();

  // Preview diagnostics scan (admin only)
  router.get(
    '/api/models/preview-diagnostics',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const page = numericValue(req.query.page, 1, 1, 100000);
      const pageSize = numericValue(req.query.page_size, 12, 1, 50);
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
      const filter = normalizePreviewDiagnosticFilter(req.query.status);

      try {
        let rows: PreviewDiagnosticRow[] = [];

        if (prisma) {
          const where: any = { status: MODEL_STATUS.COMPLETED };
          if (search) {
            where.OR = [
              { name: { contains: search, mode: 'insensitive' } },
              { originalName: { contains: search, mode: 'insensitive' } },
            ];
          }

          const models = await prisma.model.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              originalName: true,
              format: true,
              thumbnailUrl: true,
              gltfUrl: true,
              originalSize: true,
              previewMeta: true,
              createdAt: true,
              categoryRef: { select: { name: true } },
            },
          });

          rows = models.map((m: any) => ({
            id: m.id,
            name: m.name,
            originalName: m.originalName,
            format: m.format,
            thumbnailUrl: m.thumbnailUrl,
            gltfUrl: m.gltfUrl,
            originalSize: m.originalSize,
            createdAt: m.createdAt,
            category: m.categoryRef?.name || null,
            previewMeta: m.previewMeta,
          }));
        } else {
          const files = readdirSync(metadataDir)
            .filter((f) => f.endsWith('.json'))
            .sort()
            .reverse();
          rows = files
            .map((f) => JSON.parse(readFileSync(join(metadataDir, f), 'utf-8')))
            .filter((m) => m.status === MODEL_STATUS.COMPLETED)
            .filter((m) => {
              if (!search) return true;
              const q = search.toLowerCase();
              return `${m.name || ''} ${m.original_name || ''}`.toLowerCase().includes(q);
            })
            .map((m) => ({
              id: m.model_id,
              name: m.name || m.original_name,
              originalName: m.original_name,
              format: m.format,
              thumbnailUrl: m.thumbnail_url,
              gltfUrl: m.gltf_url,
              originalSize: m.original_size,
              createdAt: m.created_at,
              category: null,
            }));
        }

        const items = await Promise.all(
          rows.map(async (m) => {
            const meta = await getPreviewMeta(m.id, {
              gltfUrl: m.gltfUrl,
              originalName: m.originalName,
              format: m.format,
              previewMeta: m.previewMeta,
            });
            return buildPreviewDiagnosticItem(m, meta);
          }),
        );

        const summary = items.reduce(
          (acc, item) => {
            acc[item.preview_status] += 1;
            return acc;
          },
          { total: items.length, ok: 0, warning: 0, invalid: 0, missing: 0, problem: 0 },
        );
        summary.problem = summary.warning + summary.invalid + summary.missing;

        const filtered = items.filter((item) => shouldIncludePreviewDiagnostic(item.preview_status, filter));
        const start = (page - 1) * pageSize;

        res.json({
          summary,
          items: filtered.slice(start, start + pageSize),
          total: filtered.length,
          page,
          page_size: pageSize,
          status: filter,
        });
      } catch (err: any) {
        logger.error({ err }, '[previewDiagnostics] Scan failed');
        res.status(500).json({ detail: '预览诊断扫描失败' });
      }
    },
  );

  // Queue preview rebuild jobs for models matching preview diagnostics.
  router.post(
    '/api/models/preview-diagnostics/rebuild',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      if (!prisma) {
        res.status(503).json({ detail: '数据库未连接' });
        return;
      }

      const rebuildAll = req.body?.all === true || req.body?.scope === 'all';
      const filter = rebuildAll ? 'all' : normalizePreviewDiagnosticFilter(req.body?.status || 'problem');
      const defaultLimit = rebuildAll ? 5000 : 50;
      const maxLimit = rebuildAll ? 10000 : 100;
      const limit = numericValue(req.body?.limit, defaultLimit, 1, maxLimit);
      const requestedIds = stringArray(req.body?.modelIds, { limit, maxLength: 160 });

      try {
        const where: any = {
          status: MODEL_STATUS.COMPLETED,
          ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
        };

        const models = await prisma.model.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            originalName: true,
            format: true,
            uploadPath: true,
            thumbnailUrl: true,
            gltfUrl: true,
            originalSize: true,
            previewMeta: true,
            createdAt: true,
            categoryRef: { select: { name: true } },
          },
        });

        const candidateEntries = await Promise.all(
          models.map(async (m: any) => {
            const meta = await getPreviewMeta(m.id, {
              gltfUrl: m.gltfUrl,
              originalName: m.originalName,
              format: m.format,
              previewMeta: m.previewMeta,
            });
            return {
              model: m,
              diagnostic: buildPreviewDiagnosticItem(
                {
                  id: m.id,
                  name: m.name,
                  originalName: m.originalName,
                  format: m.format,
                  thumbnailUrl: m.thumbnailUrl,
                  gltfUrl: m.gltfUrl,
                  originalSize: m.originalSize,
                  createdAt: m.createdAt,
                  category: m.categoryRef?.name || null,
                },
                meta,
              ),
            };
          }),
        );

        const candidates = candidateEntries
          .filter((entry: { diagnostic: ReturnType<typeof buildPreviewDiagnosticItem> }) =>
            shouldIncludePreviewDiagnostic(entry.diagnostic.preview_status, filter),
          )
          .slice(0, limit);

        let queued = 0;
        let skipped = 0;
        let failed = 0;
        const items: Array<{
          model_id: string;
          name: string;
          status: string;
          reason?: string;
          job_id?: string | number;
        }> = [];

        for (const { model, diagnostic } of candidates) {
          const format = String(model.format || '').toLowerCase();
          if (!format || isDeprecatedHtmlPreviewFormat(format)) {
            skipped++;
            items.push({
              model_id: model.id,
              name: model.name || model.originalName,
              status: 'skipped',
              reason: '不支持的源格式',
            });
            continue;
          }

          const originalPath = findOriginalModelPath(model);
          if (!originalPath) {
            skipped++;
            items.push({
              model_id: model.id,
              name: model.name || model.originalName,
              status: 'skipped',
              reason: '缺少原始模型文件',
            });
            continue;
          }

          try {
            const job = await conversionQueue.add('convert', {
              modelId: model.id,
              filePath: originalPath,
              originalName: model.originalName || `${model.id}.${format}`,
              ext: format,
              userId: req.user!.userId,
              preserveSource: true,
              rebuildReason: diagnostic.preview_status,
            });
            await prisma.model
              .update({ where: { id: model.id }, data: { status: MODEL_STATUS.QUEUED } })
              .catch(() => {});
            queued++;
            items.push({
              model_id: model.id,
              name: model.name || model.originalName,
              status: MODEL_STATUS.QUEUED,
              job_id: job.id,
            });
          } catch (err: any) {
            failed++;
            items.push({
              model_id: model.id,
              name: model.name || model.originalName,
              status: MODEL_STATUS.FAILED,
              reason: err?.message || '队列投递失败',
            });
          }
        }

        await cacheDelByPrefix('cache:models:');
        res.json({
          success: true,
          data: {
            status: filter,
            total_candidates: candidates.length,
            queued,
            skipped,
            failed,
            items,
          },
        });
      } catch (err: any) {
        logger.error({ err }, '[previewDiagnostics] Batch rebuild failed');
        res.status(500).json({ detail: '批量重建预览失败' });
      }
    },
  );

  return router;
}
