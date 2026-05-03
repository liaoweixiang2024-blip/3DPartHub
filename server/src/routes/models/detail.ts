import { Router, Request, Response } from "express";
import { existsSync } from "node:fs";
import { stat as statAsync } from "node:fs/promises";
import { requireBrowseAccess } from "../../middleware/browseAccess.js";
import { cacheGet, cacheSet, TTL } from "../../lib/cache.js";
import { MODEL_STATUS } from "../../services/modelStatus.js";
import { withAssetVersion } from "../../services/gltfAsset.js";
import { findOriginalModelPath, resolveStoredPath } from "../../services/modelFiles.js";
import { parseStepFileDate } from "../../services/modelFileDates.js";

type PreviewMetaOptions = {
  gltfUrl?: string | null;
  originalName?: string | null;
  format?: string | null;
  previewMeta?: unknown;
};

type ModelDetailContext = {
  prisma: any;
  getMeta: (id: string) => Record<string, unknown> | null;
  getPreviewMeta: (id: string, options?: PreviewMetaOptions) => Promise<Record<string, unknown> | null>;
  optionalVerifiedUser: (req: Request) => Promise<{ role?: string } | null>;
  drawingDownloadUrl: (modelId: string, drawingUrl?: string | null) => string | null;
};

export function createModelDetailRouter({
  prisma,
  getMeta,
  getPreviewMeta,
  optionalVerifiedUser,
  drawingDownloadUrl,
}: ModelDetailContext) {
  const router = Router();

  // Get model detail (public)
  router.get("/api/models/:id", async (req: Request, res: Response) => {
    if (!(await requireBrowseAccess(req, res))) return;

    const id = req.params.id as string;
    const authPayload = await optionalVerifiedUser(req);
    const canViewUnpublished = authPayload?.role === "ADMIN";
    const cacheKey = `cache:models:detail:${id}`;

    if (prisma) {
      try {
        if (canViewUnpublished) {
          // Admin may view non-completed models — skip cache, always fresh
        } else {
          const cached = await cacheGet(cacheKey);
          if (cached) {
            res.set("X-Cache", "HIT");
            res.json(cached);
            return;
          }
        }

        const m = await prisma.model.findUnique({
          where: { id },
          include: {
            categoryRef: { select: { name: true, parent: { select: { id: true, name: true } } } },
            group: {
              include: {
                models: {
                  select: { id: true, name: true, thumbnailUrl: true, originalName: true, originalSize: true, uploadPath: true, createdAt: true, updatedAt: true, metadata: true, fileModifiedAt: true },
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
        });
        if (m) {
          if (m.status !== MODEL_STATUS.COMPLETED && !canViewUnpublished) {
            res.status(404).json({ detail: "模型不存在" });
            return;
          }
          if (m.status === MODEL_STATUS.COMPLETED) {
            // Cache was already checked above for non-admin
          }

          // Get original file date: STEP header > DB dedicated column > fs mtime > metadata.
          const dbMeta = (m.metadata as Record<string, unknown>) || {};
          let mainFileModifiedAt: string = m.createdAt.toISOString();
          try {
            const mainPath = findOriginalModelPath(m);
            if (mainPath) {
              const stepDate = parseStepFileDate(mainPath);
              if (stepDate) {
                mainFileModifiedAt = stepDate.toISOString();
                if (!(m as any).fileModifiedAt || (m as any).fileModifiedAt.toISOString() !== stepDate.toISOString()) {
                  prisma.model.update({ where: { id: m.id }, data: { fileModifiedAt: stepDate } }).catch(() => {});
                }
              } else if ((m as any).fileModifiedAt) {
                mainFileModifiedAt = (m as any).fileModifiedAt.toISOString();
              } else {
                const stat = await statAsync(mainPath);
                mainFileModifiedAt = stat.mtime.toISOString();
                prisma.model.update({ where: { id: m.id }, data: { fileModifiedAt: stat.mtime } }).catch(() => {});
              }
            } else if ((m as any).fileModifiedAt) {
              mainFileModifiedAt = (m as any).fileModifiedAt.toISOString();
            } else if (dbMeta.originalModifiedAt) {
              mainFileModifiedAt = dbMeta.originalModifiedAt as string;
            }
          } catch {
            // keep DB fallback
          }

          const [variantStats, previewMeta] = await Promise.all([
            Promise.all(
              (m.group?.models ?? []).map(async (v: any) => {
                try {
                  if (v.fileModifiedAt) return v.fileModifiedAt.toISOString();
                  const vMeta = (v.metadata as Record<string, unknown>) || {};
                  if (vMeta.originalModifiedAt) return vMeta.originalModifiedAt as string;
                  if (v.uploadPath) {
                    const p = resolveStoredPath(v.uploadPath);
                    if (p && existsSync(p)) {
                      const stat = await statAsync(p);
                      return stat.mtime.toISOString();
                    }
                  }
                } catch {}
                return v.createdAt ? v.createdAt.toISOString() : null;
              })
            ),
            getPreviewMeta(m.id, {
              gltfUrl: m.gltfUrl,
              originalName: m.originalName,
              format: m.format,
              previewMeta: (m as any).previewMeta,
            }),
          ]);

          const groupData = m.group ? {
            id: m.group.id,
            name: m.group.name,
            variants: m.group.models.map((v: any, i: number) => ({
              model_id: v.id,
              name: v.name,
              thumbnail_url: withAssetVersion(v.thumbnailUrl, v.updatedAt),
              original_name: v.originalName,
              original_size: v.originalSize,
              is_primary: v.id === m.group.primaryId,
              created_at: v.createdAt,
              file_modified_at: variantStats[i],
            })),
          } : null;

          const responseData = {
            model_id: m.id,
            name: m.name,
            original_name: m.originalName,
            gltf_url: withAssetVersion(m.gltfUrl, m.updatedAt),
            thumbnail_url: withAssetVersion(m.thumbnailUrl, m.updatedAt),
            gltf_size: m.gltfSize,
            original_size: m.originalSize,
            format: m.format,
            status: m.status,
            description: m.description,
            category: (m as any).categoryRef?.name || null,
            category_id: m.categoryId || null,
            category_parent: (m as any).categoryRef?.parent || null,
            created_at: m.createdAt,
            file_modified_at: mainFileModifiedAt,
            drawing_url: drawingDownloadUrl(m.id, m.drawingUrl),
            drawing_name: m.drawingName || null,
            drawing_size: m.drawingSize || null,
            preview_meta: previewMeta,
            group: groupData,
          };
          if (m.status === MODEL_STATUS.COMPLETED) {
            await cacheSet(cacheKey, responseData, TTL.MODEL_DETAIL);
          }
          res.set("X-Cache", "MISS");
          res.json(responseData);
          return;
        }
      } catch {
        // Fallback to filesystem
      }
    }

    const m = getMeta(id);
    if (!m) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }
    if (m.status !== MODEL_STATUS.COMPLETED && !canViewUnpublished) {
      res.status(404).json({ detail: "模型不存在" });
      return;
    }
    const previewMeta = await getPreviewMeta(id, {
      gltfUrl: m.gltf_url as string | null,
      originalName: m.original_name as string | null,
      format: m.format as string | null,
    });

    const responseData = {
      model_id: m.model_id,
      original_name: m.original_name,
      gltf_url: m.gltf_url,
      thumbnail_url: m.thumbnail_url,
      gltf_size: m.gltf_size,
      original_size: m.original_size,
      format: m.format,
      status: m.status,
      created_at: m.created_at,
      preview_meta: previewMeta,
    };
    if (m.status === MODEL_STATUS.COMPLETED) {
      await cacheSet(cacheKey, responseData, TTL.MODEL_DETAIL);
    }
    res.set("X-Cache", "MISS");
    res.json(responseData);
  });

  return router;
}
