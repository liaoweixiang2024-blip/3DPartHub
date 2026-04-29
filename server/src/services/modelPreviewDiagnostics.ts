import { existsSync, statSync } from "node:fs";
import { resolveFileUrlPath } from "./gltfAsset.js";

export type PreviewDiagnosticStatus = "ok" | "warning" | "invalid" | "missing";
export type PreviewDiagnosticFilter = PreviewDiagnosticStatus | "problem" | "all";
export type PreviewAssetStatus = "ok" | "warning" | "invalid" | "missing";

const PREVIEW_DIAGNOSTIC_FILTERS = new Set(["all", "problem", "ok", "warning", "invalid", "missing"]);
const MIN_THUMBNAIL_BYTES = 1024;

export function normalizePreviewDiagnosticFilter(value: unknown): PreviewDiagnosticFilter {
  const status = String(value || "problem").toLowerCase();
  return PREVIEW_DIAGNOSTIC_FILTERS.has(status) ? status as PreviewDiagnosticFilter : "problem";
}

function getPreviewBoundsSize(meta: Record<string, any> | null): [number, number, number] | null {
  const size = meta?.bounds?.size;
  if (Array.isArray(size) && size.length >= 3) {
    const tuple = size.slice(0, 3).map((value: unknown) => Number(value)) as [number, number, number];
    if (tuple.every((value) => Number.isFinite(value))) return tuple;
  }

  const parts = Array.isArray(meta?.parts) ? meta.parts : [];
  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxs: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let valid = false;
  for (const part of parts) {
    const min = part?.bounds?.min;
    const max = part?.bounds?.max;
    if (!Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3) continue;
    for (let i = 0; i < 3; i++) {
      const lo = Number(min[i]);
      const hi = Number(max[i]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      mins[i] = Math.min(mins[i], lo);
      maxs[i] = Math.max(maxs[i], hi);
      valid = true;
    }
  }
  if (!valid) return null;
  return [
    Math.max(0, maxs[0] - mins[0]),
    Math.max(0, maxs[1] - mins[1]),
    Math.max(0, maxs[2] - mins[2]),
  ];
}

function classifyPreviewMeta(meta: Record<string, any> | null): { status: PreviewDiagnosticStatus; label: string; reason: string } {
  if (!meta) {
    return { status: "missing", label: "缺少诊断", reason: "没有找到可用的预览诊断或预览资产" };
  }

  const totals = meta.totals || {};
  const boundsSize = getPreviewBoundsSize(meta);
  const hasGeometry = Number(totals.faceCount) > 0 && Number(totals.vertexCount) > 0;

  if (!hasGeometry || !boundsSize || !boundsSize.some((value) => value > 0)) {
    return { status: "invalid", label: "转换异常", reason: "面片、顶点或包围盒数据异常" };
  }

  const warnings = Array.isArray(meta.diagnostics?.warnings) ? meta.diagnostics.warnings : [];
  const skipped = Number(meta.diagnostics?.skippedMeshCount || 0);
  if (!meta.diagnostics || !meta.bounds) {
    return { status: "warning", label: "需复核", reason: "旧版诊断缺少完整转换字段" };
  }
  if (warnings.length > 0 || skipped > 0) {
    return { status: "warning", label: "需复核", reason: skipped > 0 ? `转换时跳过 ${skipped} 个网格` : "转换诊断包含警告" };
  }

  return { status: "ok", label: "正常", reason: "预览诊断正常" };
}

function inspectFileUrl(
  value?: string | null,
  options: { label: string; minBytes?: number } = { label: "文件" }
): { status: PreviewAssetStatus; reason: string; size: number; path: string | null } {
  if (!value) {
    return { status: "missing", reason: `${options.label}地址为空`, size: 0, path: null };
  }

  try {
    const filePath = resolveFileUrlPath(value);
    if (!existsSync(filePath)) {
      return { status: "missing", reason: `${options.label}不存在`, size: 0, path: filePath };
    }

    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return { status: "invalid", reason: `${options.label}不是有效文件`, size: 0, path: filePath };
    }
    if (stats.size <= 0) {
      return { status: "invalid", reason: `${options.label}为空文件`, size: stats.size, path: filePath };
    }
    if (options.minBytes && stats.size < options.minBytes) {
      return { status: "warning", reason: `${options.label}文件过小，可能是异常图或占位图`, size: stats.size, path: filePath };
    }

    return { status: "ok", reason: `${options.label}正常`, size: stats.size, path: filePath };
  } catch {
    return { status: "invalid", reason: `${options.label}检查失败`, size: 0, path: null };
  }
}

function mergePreviewHealth(
  metaHealth: ReturnType<typeof classifyPreviewMeta>,
  assetHealth: ReturnType<typeof inspectFileUrl>,
  thumbnailHealth: ReturnType<typeof inspectFileUrl>
): { status: PreviewDiagnosticStatus; label: string; reason: string } {
  if (assetHealth.status === "missing" || assetHealth.status === "invalid") {
    return {
      status: assetHealth.status,
      label: assetHealth.status === "missing" ? "缺少预览" : "预览异常",
      reason: assetHealth.reason,
    };
  }

  if (metaHealth.status === "missing" || metaHealth.status === "invalid") {
    return metaHealth;
  }

  if (thumbnailHealth.status === "missing" || thumbnailHealth.status === "invalid") {
    return {
      status: "warning",
      label: "缩略图异常",
      reason: thumbnailHealth.reason,
    };
  }

  if (metaHealth.status === "warning") return metaHealth;
  if (thumbnailHealth.status === "warning") {
    return { status: "warning", label: "需复核", reason: thumbnailHealth.reason };
  }

  return metaHealth;
}

export function shouldIncludePreviewDiagnostic(status: PreviewDiagnosticStatus, filter: PreviewDiagnosticFilter): boolean {
  if (filter === "all") return true;
  if (filter === "problem") return status !== "ok";
  return status === filter;
}

export function buildPreviewDiagnosticItem(m: {
  id: string;
  name?: string | null;
  originalName?: string | null;
  format?: string | null;
  thumbnailUrl?: string | null;
  gltfUrl?: string | null;
  originalSize?: number | null;
  createdAt?: Date | string | null;
  category?: string | null;
}, meta: Record<string, any> | null) {
  const metaHealth = classifyPreviewMeta(meta);
  const assetHealth = inspectFileUrl(m.gltfUrl, { label: "预览资产" });
  const thumbnailHealth = inspectFileUrl(m.thumbnailUrl, { label: "缩略图", minBytes: MIN_THUMBNAIL_BYTES });
  const health = mergePreviewHealth(metaHealth, assetHealth, thumbnailHealth);
  return {
    model_id: m.id,
    name: m.name || m.originalName || "未命名模型",
    original_name: m.originalName || null,
    format: m.format || null,
    thumbnail_url: m.thumbnailUrl || null,
    gltf_url: m.gltfUrl || null,
    original_size: m.originalSize || 0,
    category: m.category || null,
    created_at: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt || null,
    preview_status: health.status,
    preview_label: health.label,
    preview_reason: health.reason,
    asset_status: assetHealth.status,
    asset_reason: assetHealth.reason,
    asset_size: assetHealth.size,
    thumbnail_status: thumbnailHealth.status,
    thumbnail_reason: thumbnailHealth.reason,
    thumbnail_size: thumbnailHealth.size,
    part_count: Number(meta?.totals?.partCount || 0),
    vertex_count: Number(meta?.totals?.vertexCount || 0),
    face_count: Number(meta?.totals?.faceCount || 0),
    skipped_mesh_count: Number(meta?.diagnostics?.skippedMeshCount || 0),
    warnings: Array.isArray(meta?.diagnostics?.warnings) ? meta.diagnostics.warnings : [],
    performance_level: meta?.diagnostics?.performance?.level || meta?.diagnostics?.precheck?.sourceLevel || null,
    performance_hints: [
      ...(Array.isArray(meta?.diagnostics?.precheck?.hints) ? meta.diagnostics.precheck.hints : []),
      ...(Array.isArray(meta?.diagnostics?.performance?.hints) ? meta.diagnostics.performance.hints : []),
    ],
    estimated_peak_memory_mb: Number(meta?.diagnostics?.precheck?.estimatedPeakMemoryMb || 0),
    bounds_size: getPreviewBoundsSize(meta),
    converter: meta?.diagnostics?.converter || (meta ? "legacy-meta" : null),
    generated_at: meta?.diagnostics?.generatedAt || null,
  };
}
