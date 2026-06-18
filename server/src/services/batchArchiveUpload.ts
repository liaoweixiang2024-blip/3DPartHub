import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, posix, resolve, sep } from 'node:path';
import type { Prisma } from '@prisma/client';
import type { IZipEntry } from 'adm-zip';
import { createExtractorFromFile } from 'node-unrar-js';
import { getBusinessConfig } from '../lib/businessConfig.js';
import { config } from '../lib/config.js';
import { normalizeUploadFilename } from '../lib/filenameEncoding.js';
import { createLogger } from '../lib/logger.js';
import { modelDownloadBaseName } from '../lib/modelDownloadName.js';
import { conversionQueue } from '../lib/queue.js';
import { persistFile } from '../lib/storageProvider.js';
import {
  batchArchiveMaxBytes,
  batchArchiveMaxSizeMb,
  modelDrawingMaxBytes,
  modelDrawingMaxSizeMb,
  modelMaxBytes,
  modelMaxSizeMb,
} from '../lib/uploadLimits.js';
import {
  decodeZipEntryNameForUpload,
  normalizeBatchArchiveEntryName,
  structuredArchivePath,
  type StructuredArchivePath,
  type StructuredArchivePathOptions,
} from './archivePath.js';
import { MODEL_STATUS } from './modelStatus.js';
import { isStepFormat, scrubStepMetadata } from './stepMetadataScrub.js';

export const MAX_BATCH_MODEL_FILES = 200;
export const LARGE_ZIP_STREAMING_THRESHOLD_MB = 2048;
const log = createLogger({ component: 'batch-archive-upload' });

const PDF_HEADER = '%PDF-';

export type BatchUploadResult = {
  name: string;
  model_id?: string;
  status: string;
  error?: string;
  category_error?: string;
  drawing_attached?: boolean;
  drawing_error?: string;
};

type ZipEntryCandidate = {
  entry: IZipEntry;
  cleanName: string;
  ext: string;
  originalName: string;
  pairKey: string;
  structuredPath: StructuredArchivePath | null;
  modelNameOverride?: string;
  modelFolderKey?: string;
};

type RarEntryCandidate = {
  safeName: string;
  archiveName: string;
  ext: string;
  originalName: string;
  pairKey: string;
  structuredPath: StructuredArchivePath | null;
  declaredSize: number;
  modelNameOverride?: string;
  modelFolderKey?: string;
};

type SingleModelFolderArchive = {
  rootName: string;
  rootKey: string;
};

export type BatchArchiveUploadInput = {
  filePath: string;
  originalName: string;
  categoryId: string | null;
  userId: string;
  onProgress?: (progress: BatchArchiveUploadProgress) => void | Promise<void>;
};

export type BatchArchiveUploadOutput = {
  total: number;
  results: BatchUploadResult[];
  hasQueuedModels: boolean;
  categoryTreeChanged: boolean;
};

export type BatchArchiveUploadProgress = {
  stage: 'scanning' | 'extracting' | 'queueing' | 'binding_drawings' | 'finalizing';
  percent: number;
  message: string;
  processed?: number;
  total?: number;
};

export class BatchArchiveUploadError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, detail: string) {
    super(detail);
    this.name = 'BatchArchiveUploadError';
    this.statusCode = statusCode;
  }
}

export function isSupportedBatchArchive(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.rar');
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

function normalizeArchiveModelName(value: string, maxLength = 180): string {
  return normalizeUploadFilename(value, 'model').trim().slice(0, maxLength);
}

function categoryNameKey(value: string) {
  return normalizeUploadFilename(value).trim().toLowerCase();
}

async function loadKnownCategoryChildren(prismaClient: typeof import('../lib/prisma.js').prisma) {
  const categories = await prismaClient.category.findMany({
    select: { name: true, parent: { select: { name: true } } },
  });
  const childrenByRoot = new Map<string, Set<string>>();

  for (const category of categories) {
    if (!category.parent) {
      const rootKey = categoryNameKey(category.name);
      if (!childrenByRoot.has(rootKey)) childrenByRoot.set(rootKey, new Set());
      continue;
    }

    const rootKey = categoryNameKey(category.parent.name);
    const children = childrenByRoot.get(rootKey) ?? new Set<string>();
    children.add(categoryNameKey(category.name));
    childrenByRoot.set(rootKey, children);
  }

  return childrenByRoot;
}

function archivePairKey(cleanName: string, structured = structuredArchivePath(cleanName)): string {
  if (structured) return `folder:${structured.modelDirKey}`;
  const dir = posix.dirname(cleanName);
  const rawStem = stripExtension(normalizeUploadFilename(posix.basename(cleanName))).trim();
  const stem = modelDownloadBaseName(posix.basename(cleanName), rawStem || 'model').toLowerCase();
  return `file:${dir === '.' ? '' : `${dir.toLowerCase()}/`}${stem}`;
}

function modelExtensionPriority(ext: string) {
  const normalized = ext.toLowerCase();
  if (normalized === 'step') return 0;
  if (normalized === 'stp') return 1;
  if (normalized === 'iges' || normalized === 'igs') return 2;
  return 10;
}

function candidateArchiveName<T extends { cleanName?: string; safeName?: string; originalName: string }>(item: T) {
  return item.cleanName || item.safeName || item.originalName;
}

function candidateModelStemKey<T extends { cleanName?: string; safeName?: string; originalName: string }>(item: T) {
  const name = candidateArchiveName(item);
  return stripExtension(normalizeUploadFilename(posix.basename(name), 'model'))
    .trim()
    .toLowerCase();
}

function candidateModelName<T extends { cleanName?: string; safeName?: string; originalName: string }>(item: T) {
  const name = candidateArchiveName(item);
  return normalizeArchiveModelName(stripExtension(posix.basename(name)));
}

function archiveSegments(cleanName: string) {
  return cleanName
    .split('/')
    .filter(Boolean)
    .map((segment) => normalizeUploadFilename(segment).trim())
    .filter(Boolean);
}

function isSingleModelFolderEntry(cleanName: string, folder: SingleModelFolderArchive | null) {
  if (!folder) return false;
  const parts = archiveSegments(cleanName);
  return parts.length >= 2 && categoryNameKey(parts[0]) === folder.rootKey;
}

function detectSingleModelFolderArchive(
  cleanNames: string[],
  acceptedExts: string[],
  selectedCategoryId: string | null,
  knownRootCategories: Set<string>,
): SingleModelFolderArchive | null {
  if (!selectedCategoryId) return null;

  const modelStemKeys = new Set<string>();
  let rootName = '';
  let rootKey = '';

  for (const cleanName of cleanNames) {
    const ext = cleanName.split('.').pop()?.toLowerCase() || '';
    if (ext !== 'pdf' && !acceptedExts.includes(ext)) continue;

    const parts = archiveSegments(cleanName);
    if (parts.length < 2) return null;

    const currentRootName = parts[0];
    const currentRootKey = categoryNameKey(currentRootName);
    if (!currentRootKey || knownRootCategories.has(currentRootKey)) return null;
    if (!rootKey) {
      rootName = currentRootName;
      rootKey = currentRootKey;
    } else if (rootKey !== currentRootKey) {
      return null;
    }

    if (acceptedExts.includes(ext)) modelStemKeys.add(candidateModelStemKey({ originalName: cleanName }));
  }

  return rootName && modelStemKeys.size === 1 ? { rootName, rootKey } : null;
}

function safeExtractedArchiveFileName(index: number, originalName: string) {
  const base = posix.basename(normalizeBatchArchiveEntryName(originalName) || originalName) || `archive-file-${index}`;
  const safeBase = normalizeUploadFilename(base, `archive-file-${index}`).replace(/[\\/:\0]/g, '_');
  return `${String(index).padStart(4, '0')}-${safeBase}`;
}

function safeExtractedArchivePath(rootDir: string, fileName: string): string | null {
  if (!fileName || /[/\\\0]/.test(fileName) || fileName === '.' || fileName === '..') return null;
  const root = resolve(rootDir);
  const candidate = resolve(root, fileName);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function selectBatchModelEntries<
  T extends {
    ext: string;
    originalName: string;
    structuredPath: StructuredArchivePath | null;
    cleanName?: string;
    safeName?: string;
    modelNameOverride?: string;
    modelFolderKey?: string;
  },
>(entries: T[], acceptedExts: string[], results: BatchUploadResult[]): T[] {
  const selected: T[] = [];
  const structuredModelDirCounts = new Map<string, number>();
  const selectedStructuredModelStems = new Set<string>();

  for (const item of entries) {
    if (!acceptedExts.includes(item.ext)) continue;
    const key = item.structuredPath?.modelDirKey || item.modelFolderKey;
    if (!key) continue;
    structuredModelDirCounts.set(key, (structuredModelDirCounts.get(key) || 0) + 1);
  }

  const candidates = entries
    .filter((item) => acceptedExts.includes(item.ext))
    .sort((a, b) => modelExtensionPriority(a.ext) - modelExtensionPriority(b.ext));

  for (const item of candidates) {
    const dirKey = item.structuredPath?.modelDirKey || item.modelFolderKey;
    if (dirKey) {
      const hasMultipleModelsInDir = (structuredModelDirCounts.get(dirKey) || 0) > 1;
      if (hasMultipleModelsInDir && item.structuredPath && !item.modelNameOverride) {
        item.modelNameOverride = candidateModelName(item);
      }
      const modelStemKey = `${dirKey}\0${hasMultipleModelsInDir ? candidateModelStemKey(item) : dirKey}`;
      if (selectedStructuredModelStems.has(modelStemKey)) {
        results.push({
          name: item.modelNameOverride || item.structuredPath?.modelName || item.originalName,
          status: MODEL_STATUS.FAILED,
          error: '同一个型号存在多个模型文件，已跳过重复文件',
        });
        continue;
      }
      selectedStructuredModelStems.add(modelStemKey);
    }
    selected.push(item);
    if (selected.length >= MAX_BATCH_MODEL_FILES) break;
  }

  return selected;
}

function registerUnmatchedPdfResults<T extends { ext: string; originalName: string; pairKey: string }>(
  entries: T[],
  modelEntries: T[],
  results: BatchUploadResult[],
) {
  const modelPairKeys = new Set(modelEntries.map((item) => item.pairKey));
  const reportedPdfKeys = new Set<string>();

  for (const item of entries) {
    const reportKey = `${item.pairKey}\0${item.originalName}`;
    if (item.ext !== 'pdf' || modelPairKeys.has(item.pairKey) || reportedPdfKeys.has(reportKey)) continue;
    reportedPdfKeys.add(reportKey);
    results.push({
      name: item.originalName,
      status: MODEL_STATUS.FAILED,
      error: '未找到同名模型文件，PDF 图纸未绑定',
      drawing_error: '未找到同名模型文件，PDF 图纸未绑定',
    });
  }
}

function isPdfData(data: Buffer | Uint8Array): boolean {
  if (data.byteLength < PDF_HEADER.length) return false;
  return Buffer.from(data.subarray(0, PDF_HEADER.length)).toString('ascii') === PDF_HEADER;
}

type DrawingUploadLimit = {
  maxBytes: number;
  maxMb: number;
};

async function attachDrawingFromBuffer(
  prismaClient: typeof import('../lib/prisma.js').prisma,
  modelId: string,
  originalName: string,
  data: Buffer,
  limit: DrawingUploadLimit,
): Promise<string | null> {
  if (!prismaClient) return '数据库未连接，无法绑定 PDF 图纸';
  if (data.length <= 0) return 'PDF 图纸为空';
  if (data.length > limit.maxBytes) return `PDF 图纸过大，最大支持 ${limit.maxMb}MB`;
  if (!isPdfData(data)) return 'PDF 图纸内容无效';

  const drawingPath = join(config.staticDir, 'drawings', `${modelId}.pdf`);
  try {
    const drawingDir = join(config.staticDir, 'drawings');
    mkdirSync(drawingDir, { recursive: true });
    writeFileSync(drawingPath, data);
    await persistFile(drawingPath);

    await prismaClient.model.update({
      where: { id: modelId },
      data: {
        drawingUrl: `/static/drawings/${modelId}.pdf`,
        drawingName: normalizeUploadFilename(originalName, 'drawing.pdf'),
        drawingSize: data.length,
      },
    });

    return null;
  } catch {
    try {
      if (existsSync(drawingPath)) rmSync(drawingPath, { force: true });
    } catch (cleanupErr) {
      log.warn({ cleanupErr, drawingPath, modelId }, 'Failed to clean drawing after attach failure');
    }
    return '绑定 PDF 图纸失败';
  }
}

export async function processBatchArchiveUpload({
  filePath,
  originalName: archiveOriginalName,
  categoryId,
  userId,
  onProgress,
}: BatchArchiveUploadInput): Promise<BatchArchiveUploadOutput> {
  let cleanupCreatedCategories: (() => Promise<void>) | null = null;

  try {
    const reportProgress = async (progress: BatchArchiveUploadProgress) => {
      await onProgress?.({
        ...progress,
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      });
    };
    await reportProgress({ stage: 'scanning', percent: 3, message: '正在读取压缩包...' });

    const { prisma } = await import('../lib/prisma.js');
    const { uploadPolicy } = await getBusinessConfig();
    const acceptedExts = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
    const maxModelBytes = modelMaxBytes(uploadPolicy);
    const maxModelMb = modelMaxSizeMb(uploadPolicy);
    const drawingLimit = {
      maxBytes: modelDrawingMaxBytes(uploadPolicy),
      maxMb: modelDrawingMaxSizeMb(uploadPolicy),
    };
    const maxArchiveBytes = batchArchiveMaxBytes(uploadPolicy);
    const maxArchiveMb = batchArchiveMaxSizeMb(uploadPolicy);
    const results: BatchUploadResult[] = [];
    const archiveCategoryCache = new Map<string, string | null>();
    const createdCategoryIds: string[] = [];
    let categoryTreeChanged = false;
    const knownCategoryChildren = await loadKnownCategoryChildren(prisma);
    const pathOptions: StructuredArchivePathOptions = {
      isKnownSubcategory: (categoryName, segmentName) => {
        const children = knownCategoryChildren.get(categoryNameKey(categoryName));
        return children ? children.has(categoryNameKey(segmentName)) : undefined;
      },
    };
    const knownRootCategories = new Set(knownCategoryChildren.keys());
    const parseStructuredArchivePath = (cleanName: string) => structuredArchivePath(cleanName, pathOptions);
    await reportProgress({ stage: 'scanning', percent: 8, message: '正在读取分类规则...' });

    cleanupCreatedCategories = async () => {
      if (!prisma || createdCategoryIds.length === 0) return;
      for (const id of [...createdCategoryIds].reverse()) {
        try {
          const [modelCount, childCount] = await Promise.all([
            prisma.model.count({ where: { categoryId: id } }),
            prisma.category.count({ where: { parentId: id } }),
          ]);
          if (modelCount === 0 && childCount === 0) {
            await prisma.category.delete({ where: { id } });
            categoryTreeChanged = true;
          }
        } catch {
          // Best-effort cleanup: never fail the upload response because an empty category could not be removed.
        }
      }
    };

    const resolveArchiveCategoryId = async (structuredPath: StructuredArchivePath | null): Promise<string | null> => {
      if (!structuredPath || !prisma) return categoryId;
      const cacheKey = `${structuredPath.categoryName}\0${structuredPath.subcategoryName || ''}`;
      if (archiveCategoryCache.has(cacheKey)) return archiveCategoryCache.get(cacheKey) ?? null;

      const resolvedId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`model-category-root:${structuredPath.categoryName}`}))`;

        let root = await tx.category.findFirst({
          where: { parentId: null, name: structuredPath.categoryName },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!root) {
          root = await tx.category.create({
            data: { name: structuredPath.categoryName, icon: 'folder', parentId: null },
            select: { id: true },
          });
          createdCategoryIds.push(root.id);
          categoryTreeChanged = true;
        }

        if (!structuredPath.subcategoryName) return root.id;

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`model-category-child:${root.id}:${structuredPath.subcategoryName}`}))`;

        let child = await tx.category.findFirst({
          where: { parentId: root.id, name: structuredPath.subcategoryName },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!child) {
          child = await tx.category.create({
            data: { name: structuredPath.subcategoryName, icon: 'folder', parentId: root.id },
            select: { id: true },
          });
          createdCategoryIds.push(child.id);
          categoryTreeChanged = true;
        }

        return child.id;
      });

      archiveCategoryCache.set(cacheKey, resolvedId);
      return resolvedId;
    };

    const queuePreparedModelFile = async (
      modelId: string,
      originalName: string,
      ext: string,
      originalDest: string,
      originalSize: number,
      options?: { modelName?: string; categoryId?: string | null; resolveCategoryId?: () => Promise<string | null> },
    ): Promise<BatchUploadResult | null> => {
      const modelName = normalizeArchiveModelName(options?.modelName || stripExtension(originalName));

      try {
        if (isStepFormat(ext)) {
          try {
            scrubStepMetadata(originalDest);
          } catch {
            /* non-critical */
          }
        }

        let resolvedCategoryId = options?.categoryId ?? categoryId;
        let categoryError: string | undefined;
        if (prisma && options?.resolveCategoryId) {
          try {
            resolvedCategoryId = await options.resolveCategoryId();
          } catch {
            categoryError = '分类绑定失败';
            resolvedCategoryId = categoryId;
          }
        }

        if (prisma) {
          await prisma.model.create({
            data: {
              id: modelId,
              name: modelName || originalName.replace(/\.[^.]+$/, ''),
              originalName,
              originalFormat: ext,
              originalSize,
              gltfUrl: '',
              gltfSize: 0,
              format: ext,
              status: MODEL_STATUS.QUEUED,
              uploadPath: originalDest,
              createdById: userId,
              ...(resolvedCategoryId && { categoryId: resolvedCategoryId }),
            },
          });
        }

        try {
          await conversionQueue.add('convert', {
            modelId,
            filePath: originalDest,
            originalName,
            ext,
            userId,
            preserveSource: true,
          });
          const result: BatchUploadResult = {
            model_id: modelId,
            name: modelName || originalName,
            status: MODEL_STATUS.QUEUED,
          };
          if (categoryError) result.category_error = categoryError;
          results.push(result);
          return result;
        } catch (queueErr) {
          if (prisma) {
            await prisma.model.delete({ where: { id: modelId } }).catch((deleteErr: unknown) => {
              log.warn({ deleteErr, modelId }, 'Failed to clean queued model after batch archive queue failure');
            });
          }
          if (originalDest && existsSync(originalDest)) rmSync(originalDest, { force: true });
          log.warn({ queueErr, modelId, originalName }, 'Failed to queue batch archive model');
          results.push({
            name: modelName || originalName,
            status: MODEL_STATUS.FAILED,
            error: '转换队列暂不可用',
          });
          return null;
        }
      } catch {
        if (existsSync(originalDest)) rmSync(originalDest, { force: true });
        results.push({ name: modelName || originalName, status: MODEL_STATUS.FAILED, error: '处理失败' });
        return null;
      }
    };

    const queueModelFromBuffer = async (
      originalName: string,
      ext: string,
      data: Buffer,
      options?: { modelName?: string; categoryId?: string | null; resolveCategoryId?: () => Promise<string | null> },
    ): Promise<BatchUploadResult | null> => {
      const modelName = normalizeArchiveModelName(options?.modelName || stripExtension(originalName));
      if (data.length <= 0 || data.length > maxModelBytes) {
        results.push({
          name: modelName || originalName,
          status: MODEL_STATUS.FAILED,
          error: `文件大小异常，最大支持 ${maxModelMb}MB`,
        });
        return null;
      }

      const modelId = randomUUID().slice(0, 12);
      const originalsDir = join(config.staticDir, 'originals');
      mkdirSync(originalsDir, { recursive: true });
      const originalDest = join(originalsDir, `${modelId}.${ext}`);
      try {
        writeFileSync(originalDest, data);
      } catch {
        results.push({ name: modelName || originalName, status: MODEL_STATUS.FAILED, error: '保存模型文件失败' });
        return null;
      }
      await persistFile(originalDest);

      return queuePreparedModelFile(modelId, originalName, ext, originalDest, data.length, options);
    };

    const queueModelFromFile = async (
      originalName: string,
      ext: string,
      sourcePath: string,
      sourceSize: number,
      options?: { modelName?: string; categoryId?: string | null; resolveCategoryId?: () => Promise<string | null> },
    ): Promise<BatchUploadResult | null> => {
      const modelName = normalizeArchiveModelName(options?.modelName || stripExtension(originalName));
      if (sourceSize <= 0 || sourceSize > maxModelBytes) {
        results.push({
          name: modelName || originalName,
          status: MODEL_STATUS.FAILED,
          error: `文件大小异常，最大支持 ${maxModelMb}MB`,
        });
        return null;
      }

      const modelId = randomUUID().slice(0, 12);
      const originalsDir = join(config.staticDir, 'originals');
      mkdirSync(originalsDir, { recursive: true });
      const originalDest = join(originalsDir, `${modelId}.${ext}`);
      try {
        copyFileSync(sourcePath, originalDest);
      } catch {
        results.push({ name: modelName || originalName, status: MODEL_STATUS.FAILED, error: '保存模型文件失败' });
        return null;
      }
      await persistFile(originalDest);

      return queuePreparedModelFile(modelId, originalName, ext, originalDest, sourceSize, options);
    };

    if (archiveOriginalName.toLowerCase().endsWith('.zip')) {
      await reportProgress({ stage: 'scanning', percent: 12, message: '正在扫描 ZIP 文件...' });
      const stat = statSync(filePath);
      if (stat.size > maxArchiveBytes) {
        throw new BatchArchiveUploadError(400, `压缩包超过 ${maxArchiveMb}MB，请上传更小的 ZIP/RAR 文件`);
      }
      if (stat.size > LARGE_ZIP_STREAMING_THRESHOLD_MB * 1024 * 1024) {
        throw new BatchArchiveUploadError(
          400,
          `ZIP 超过 ${LARGE_ZIP_STREAMING_THRESHOLD_MB}MB，当前为避免内存占用过高暂不处理超大 ZIP；请改用 RAR 或拆分后上传`,
        );
      }
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(filePath);
      const zipItems = zip
        .getEntries()
        .map((entry) => ({ entry, safeName: normalizeBatchArchiveEntryName(decodeZipEntryNameForUpload(entry)) }))
        .filter((item) => Boolean(item.safeName));
      const singleModelFolder = detectSingleModelFolderArchive(
        zipItems.filter((item) => !item.entry.isDirectory).map((item) => item.safeName!),
        acceptedExts,
        categoryId,
        knownRootCategories,
      );
      const entries = zipItems
        .filter((item) => !item.entry.isDirectory)
        .map(({ entry, safeName }) => {
          const cleanName = safeName!;
          const ext = cleanName.split('.').pop()?.toLowerCase();
          const isSingleFolderEntry = isSingleModelFolderEntry(cleanName, singleModelFolder);
          const structuredPath = isSingleFolderEntry ? null : parseStructuredArchivePath(cleanName);
          return {
            entry,
            cleanName,
            ext: ext || '',
            originalName: normalizeUploadFilename(posix.basename(cleanName)),
            pairKey: isSingleFolderEntry
              ? `single-folder:${singleModelFolder!.rootKey}`
              : archivePairKey(cleanName, structuredPath),
            structuredPath,
            modelNameOverride:
              isSingleFolderEntry && ext && acceptedExts.includes(ext) ? singleModelFolder!.rootName : undefined,
            modelFolderKey: isSingleFolderEntry ? `single-folder:${singleModelFolder!.rootKey}` : undefined,
          };
        })
        .filter((item) => Boolean(item.ext))
        .filter((item) => item.ext === 'pdf' || acceptedExts.includes(item.ext))
        .reduce<ZipEntryCandidate[]>((acc, item) => {
          acc.push(item);
          return acc;
        }, []);

      const pdfByKey = new Map<string, ZipEntryCandidate>();
      for (const item of entries) {
        if (item.ext === 'pdf' && !pdfByKey.has(item.pairKey)) pdfByKey.set(item.pairKey, item);
      }

      const modelEntries = selectBatchModelEntries(entries, acceptedExts, results);
      registerUnmatchedPdfResults(entries, modelEntries, results);
      await reportProgress({
        stage: 'queueing',
        percent: 22,
        message: `识别到 ${modelEntries.length} 个模型，开始处理...`,
        processed: 0,
        total: modelEntries.length,
      });

      const maxTotalExtractBytes = Math.max(maxModelBytes, drawingLimit.maxBytes) * MAX_BATCH_MODEL_FILES;
      let totalExtractedBytes = 0;
      let processedModels = 0;

      for (const item of modelEntries) {
        const { entry, ext, originalName, pairKey, structuredPath } = item;
        await reportProgress({
          stage: 'queueing',
          percent: 22 + (processedModels / Math.max(1, modelEntries.length)) * 66,
          message: `正在处理模型 ${processedModels + 1}/${modelEntries.length}: ${originalName}`,
          processed: processedModels,
          total: modelEntries.length,
        });
        processedModels += 1;
        const declaredSize = Number(entry.header.size);
        if (
          Number.isFinite(declaredSize) &&
          declaredSize > 0 &&
          (declaredSize > maxModelBytes || totalExtractedBytes + declaredSize > maxTotalExtractBytes)
        ) {
          results.push({
            name: originalName,
            status: MODEL_STATUS.FAILED,
            error:
              declaredSize > maxModelBytes ? `文件过大，最大支持 ${maxModelMb}MB` : `压缩包解压总量超限，请拆分后上传`,
          });
          continue;
        }
        const data = entry.getData();
        if (data.length > maxModelBytes || totalExtractedBytes + data.length > maxTotalExtractBytes) {
          results.push({
            name: originalName,
            status: MODEL_STATUS.FAILED,
            error:
              data.length > maxModelBytes ? `文件过大，最大支持 ${maxModelMb}MB` : `压缩包解压总量超限，请拆分后上传`,
          });
          continue;
        }
        totalExtractedBytes += data.length;
        const result = await queueModelFromBuffer(originalName, ext, data, {
          modelName: item.modelNameOverride || structuredPath?.modelName,
          resolveCategoryId: structuredPath ? () => resolveArchiveCategoryId(structuredPath) : undefined,
        });
        const drawing = result?.model_id ? pdfByKey.get(pairKey) : null;
        if (!result?.model_id || !drawing) continue;

        const drawingDeclaredSize = Number(drawing.entry.header.size);
        if (
          Number.isFinite(drawingDeclaredSize) &&
          drawingDeclaredSize > 0 &&
          (drawingDeclaredSize > drawingLimit.maxBytes ||
            totalExtractedBytes + drawingDeclaredSize > maxTotalExtractBytes)
        ) {
          result.drawing_error = `PDF 图纸过大，最大支持 ${drawingLimit.maxMb}MB`;
          continue;
        }

        const drawingData = drawing.entry.getData();
        if (
          drawingData.length > drawingLimit.maxBytes ||
          totalExtractedBytes + drawingData.length > maxTotalExtractBytes
        ) {
          result.drawing_error = `PDF 图纸过大，最大支持 ${drawingLimit.maxMb}MB`;
          continue;
        }
        totalExtractedBytes += drawingData.length;
        const drawingError = await attachDrawingFromBuffer(
          prisma,
          result.model_id,
          drawing.originalName,
          drawingData,
          drawingLimit,
        );
        if (drawingError) result.drawing_error = drawingError;
        else result.drawing_attached = true;
        await reportProgress({
          stage: 'queueing',
          percent: 22 + (processedModels / Math.max(1, modelEntries.length)) * 66,
          message: `已处理 ${processedModels}/${modelEntries.length} 个模型`,
          processed: processedModels,
          total: modelEntries.length,
        });
      }
    } else {
      await reportProgress({ stage: 'scanning', percent: 12, message: '正在扫描 RAR 文件...' });
      const stat = statSync(filePath);
      if (stat.size > maxArchiveBytes) {
        throw new BatchArchiveUploadError(400, `压缩包超过 ${maxArchiveMb}MB，请上传更小的 ZIP/RAR 文件`);
      }
      const listExtractor = await createExtractorFromFile({ filepath: filePath });
      const fileList = listExtractor.getFileList();
      const fileHeaders = Array.from(fileList.fileHeaders);
      const headerNames = fileHeaders
        .filter((header) => !header.flags.directory)
        .map((header) => normalizeBatchArchiveEntryName(header.name))
        .filter((name): name is string => Boolean(name));
      const singleModelFolder = detectSingleModelFolderArchive(
        headerNames,
        acceptedExts,
        categoryId,
        knownRootCategories,
      );
      const rarEntries: RarEntryCandidate[] = [];
      for (const header of fileHeaders) {
        if (header.flags.directory) continue;
        const safeName = normalizeBatchArchiveEntryName(header.name);
        if (!safeName) continue;
        const ext = safeName.split('.').pop()?.toLowerCase() || '';
        if (ext !== 'pdf' && !acceptedExts.includes(ext)) continue;
        const isSingleFolderEntry = isSingleModelFolderEntry(safeName, singleModelFolder);
        const structuredPath = isSingleFolderEntry ? null : parseStructuredArchivePath(safeName);
        rarEntries.push({
          safeName,
          archiveName: header.name,
          ext,
          originalName: normalizeUploadFilename(posix.basename(safeName)),
          pairKey: isSingleFolderEntry
            ? `single-folder:${singleModelFolder!.rootKey}`
            : archivePairKey(safeName, structuredPath),
          structuredPath,
          declaredSize: Number(header.unpSize) || 0,
          modelNameOverride:
            isSingleFolderEntry && acceptedExts.includes(ext) ? singleModelFolder!.rootName : undefined,
          modelFolderKey: isSingleFolderEntry ? `single-folder:${singleModelFolder!.rootKey}` : undefined,
        });
      }

      const pdfByKey = new Map<string, RarEntryCandidate>();
      for (const item of rarEntries) {
        if (item.ext === 'pdf' && !pdfByKey.has(item.pairKey)) pdfByKey.set(item.pairKey, item);
      }

      const maxTotalExtractBytes = Math.max(maxModelBytes, drawingLimit.maxBytes) * MAX_BATCH_MODEL_FILES;
      let selectedDeclaredBytes = 0;
      const selectedModelEntries = selectBatchModelEntries(rarEntries, acceptedExts, results);
      registerUnmatchedPdfResults(rarEntries, selectedModelEntries, results);
      await reportProgress({
        stage: 'extracting',
        percent: 22,
        message: `识别到 ${selectedModelEntries.length} 个模型，正在解压...`,
        processed: 0,
        total: selectedModelEntries.length,
      });
      const selectedArchiveNames = new Set<string>();
      const drawingPreErrors = new Map<string, string>();

      for (const item of selectedModelEntries) {
        if (
          item.declaredSize > 0 &&
          (item.declaredSize > maxModelBytes || selectedDeclaredBytes + item.declaredSize > maxTotalExtractBytes)
        ) {
          results.push({
            name: item.originalName,
            status: MODEL_STATUS.FAILED,
            error:
              item.declaredSize > maxModelBytes
                ? `文件过大，最大支持 ${maxModelMb}MB`
                : `压缩包解压总量超限，请拆分后上传`,
          });
          continue;
        }

        selectedArchiveNames.add(item.archiveName);
        if (item.declaredSize > 0) selectedDeclaredBytes += item.declaredSize;

        const drawing = pdfByKey.get(item.pairKey);
        if (!drawing) continue;
        if (
          drawing.declaredSize > 0 &&
          (drawing.declaredSize > drawingLimit.maxBytes ||
            selectedDeclaredBytes + drawing.declaredSize > maxTotalExtractBytes)
        ) {
          drawingPreErrors.set(item.pairKey, `PDF 图纸过大，最大支持 ${drawingLimit.maxMb}MB`);
          continue;
        }
        selectedArchiveNames.add(drawing.archiveName);
        if (drawing.declaredSize > 0) selectedDeclaredBytes += drawing.declaredSize;
      }

      const extractedPathByName = new Map<string, string>();
      let extractDir: string | null = null;
      if (selectedArchiveNames.size > 0) {
        await reportProgress({
          stage: 'extracting',
          percent: 30,
          message: `正在解压 ${selectedArchiveNames.size} 个模型/图纸文件...`,
          processed: 0,
          total: selectedModelEntries.length,
        });
        const extractRoot = join(config.uploadDir, 'batch-extract');
        mkdirSync(extractRoot, { recursive: true });
        extractDir = mkdtempSync(join(extractRoot, 'rar-'));

        const archiveNames = Array.from(selectedArchiveNames);
        const extractNameByArchive = new Map(
          archiveNames.map((name, index) => [name, safeExtractedArchiveFileName(index, name)] as const),
        );
        const extractExtractor = await createExtractorFromFile({
          filepath: filePath,
          targetPath: extractDir,
          filenameTransform: (filename) =>
            extractNameByArchive.get(filename) || safeExtractedArchiveFileName(0, filename),
        });
        const extracted = extractExtractor.extract({ files: archiveNames });
        for (const item of extracted.files) {
          const extractedName = extractNameByArchive.get(item.fileHeader.name);
          const extractedPath = extractedName ? safeExtractedArchivePath(extractDir, extractedName) : null;
          if (extractedPath) extractedPathByName.set(item.fileHeader.name, extractedPath);
        }
      }

      try {
        let rarTotalBytes = 0;
        let processedModels = 0;
        for (const item of selectedModelEntries) {
          await reportProgress({
            stage: 'queueing',
            percent: 38 + (processedModels / Math.max(1, selectedModelEntries.length)) * 50,
            message: `正在处理模型 ${processedModels + 1}/${selectedModelEntries.length}: ${item.originalName}`,
            processed: processedModels,
            total: selectedModelEntries.length,
          });
          processedModels += 1;
          const contentPath = extractedPathByName.get(item.archiveName);
          if (!contentPath || !existsSync(contentPath)) {
            results.push({ name: item.originalName, status: MODEL_STATUS.FAILED, error: '文件为空或无法解压' });
            continue;
          }
          const contentSize = statSync(contentPath).size;
          if (contentSize <= 0) {
            results.push({ name: item.originalName, status: MODEL_STATUS.FAILED, error: '文件为空或无法解压' });
            continue;
          }
          if (contentSize > maxModelBytes || rarTotalBytes + contentSize > maxTotalExtractBytes) {
            results.push({
              name: item.originalName,
              status: MODEL_STATUS.FAILED,
              error:
                contentSize > maxModelBytes ? `文件过大，最大支持 ${maxModelMb}MB` : `压缩包解压总量超限，请拆分后上传`,
            });
            continue;
          }

          rarTotalBytes += contentSize;
          const result = await queueModelFromFile(item.originalName, item.ext, contentPath, contentSize, {
            modelName: item.modelNameOverride || item.structuredPath?.modelName,
            resolveCategoryId: item.structuredPath ? () => resolveArchiveCategoryId(item.structuredPath) : undefined,
          });
          const drawing = result?.model_id ? pdfByKey.get(item.pairKey) : null;
          if (!result?.model_id || !drawing) continue;

          const drawingPreError = drawingPreErrors.get(item.pairKey);
          if (drawingPreError) {
            result.drawing_error = drawingPreError;
            continue;
          }

          const drawingPath = extractedPathByName.get(drawing.archiveName);
          if (!drawingPath || !existsSync(drawingPath)) {
            result.drawing_error = 'PDF 图纸为空或无法解压';
            continue;
          }
          const drawingSize = statSync(drawingPath).size;
          if (drawingSize <= 0) {
            result.drawing_error = 'PDF 图纸为空或无法解压';
            continue;
          }
          if (drawingSize > drawingLimit.maxBytes || rarTotalBytes + drawingSize > maxTotalExtractBytes) {
            result.drawing_error = `PDF 图纸过大，最大支持 ${drawingLimit.maxMb}MB`;
            continue;
          }

          rarTotalBytes += drawingSize;
          const drawingError = await attachDrawingFromBuffer(
            prisma,
            result.model_id,
            drawing.originalName,
            readFileSync(drawingPath),
            drawingLimit,
          );
          if (drawingError) result.drawing_error = drawingError;
          else result.drawing_attached = true;
          await reportProgress({
            stage: 'queueing',
            percent: 38 + (processedModels / Math.max(1, selectedModelEntries.length)) * 50,
            message: `已处理 ${processedModels}/${selectedModelEntries.length} 个模型`,
            processed: processedModels,
            total: selectedModelEntries.length,
          });
        }
      } finally {
        if (extractDir) rmSync(extractDir, { recursive: true, force: true });
      }
    }

    await cleanupCreatedCategories();
    await reportProgress({ stage: 'finalizing', percent: 94, message: '正在整理上传结果...' });
    if (!results.length) {
      throw new BatchArchiveUploadError(
        400,
        `压缩包内没有识别到支持的模型文件，请上传 ${acceptedExts.map((item) => `.${item}`).join(' / ')} 文件`,
      );
    }

    return {
      total: results.length,
      results,
      hasQueuedModels: results.some((item) => item.status === MODEL_STATUS.QUEUED),
      categoryTreeChanged,
    };
  } catch (error) {
    await cleanupCreatedCategories?.().catch((cleanupErr: unknown) => {
      log.warn({ cleanupErr }, 'Failed to roll back categories after batch archive upload failure');
    });
    throw error;
  } finally {
    try {
      rmSync(filePath, { force: true });
    } catch (cleanupErr) {
      log.warn({ cleanupErr, filePath }, 'Failed to clean uploaded batch archive');
    }
  }
}
