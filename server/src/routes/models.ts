import { Router, Request } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../lib/config.js';
import { getVerifiedRequestUser, verifyRequestToken, type AuthRequest } from '../middleware/auth.js';
import { ensurePreviewMeta } from '../services/previewMeta.js';
import { createModelConversionRouter } from './models/conversion.js';
import { createModelDetailRouter } from './models/detail.js';
import { createModelDownloadRouter } from './models/download.js';
import { createModelListRouter } from './models/list.js';
import { createModelManagementRouter } from './models/management.js';
import { createModelUploadRouter } from './models/upload.js';
import { createModelVersionsRouter } from './models/versions.js';
import { createPreviewDiagnosticsRouter } from './models/previewDiagnostics.js';
import { logger } from '../lib/logger.js';

// Try to import Prisma, fallback to null if DB is not configured
let prisma: any = null;
try {
  const mod = await import('../lib/prisma.js');
  prisma = mod.prisma;
} catch {
  logger.info('  ⚠️  Prisma not available, using filesystem storage');
}

const router = Router();

const METADATA_DIR = join(config.uploadDir, '.metadata');
mkdirSync(METADATA_DIR, { recursive: true });

// Filesystem fallback helpers
function getMeta(id: string): Record<string, unknown> | null {
  const p = join(METADATA_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function saveMeta(id: string, data: Record<string, unknown>) {
  if (prisma) return;
  writeFileSync(join(METADATA_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}

async function getPreviewMeta(
  id: string,
  options: {
    gltfUrl?: string | null;
    originalName?: string | null;
    format?: string | null;
    previewMeta?: unknown;
  } = {},
): Promise<Record<string, unknown> | null> {
  return (await ensurePreviewMeta({
    modelDir: join(config.staticDir, 'models'),
    modelId: id,
    preferredUrl: options.gltfUrl,
    sourceName: options.originalName || id,
    sourceFormat: options.format || 'gltf',
    storedMeta: options.previewMeta,
    persist: prisma
      ? async (meta) => {
          await prisma.model.update({ where: { id }, data: { previewMeta: meta } }).catch(() => {});
        }
      : undefined,
  })) as Record<string, unknown> | null;
}

function drawingDownloadUrl(modelId: string, drawingUrl?: string | null): string | null {
  return drawingUrl ? `/api/models/${encodeURIComponent(modelId)}/drawing/download` : null;
}

async function optionalVerifiedUser(req: Request) {
  const existing = (req as AuthRequest).user;
  if (existing) return existing;
  if (!verifyRequestToken(req)) return null;
  try {
    const verified = await getVerifiedRequestUser(req);
    if (!verified || verified.mustChangePassword) return null;
    return verified.payload;
  } catch {
    return null;
  }
}

router.use(createPreviewDiagnosticsRouter({ prisma, metadataDir: METADATA_DIR, getPreviewMeta }));
router.use(createModelListRouter({ prisma, metadataDir: METADATA_DIR, drawingDownloadUrl }));
router.use(createModelDetailRouter({ prisma, getMeta, getPreviewMeta, optionalVerifiedUser, drawingDownloadUrl }));
router.use(createModelUploadRouter({ prisma, saveMeta }));
router.use(createModelDownloadRouter({ prisma, getMeta }));
router.use(createModelManagementRouter({ prisma, metadataDir: METADATA_DIR, getMeta, saveMeta }));
router.use(createModelConversionRouter({ prisma, getMeta, saveMeta, getPreviewMeta }));
router.use(createModelVersionsRouter({ prisma, optionalVerifiedUser }));

export default router;
