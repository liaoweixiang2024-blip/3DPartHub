import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { createExtractorFromData } from 'node-unrar-js';
import { DEFAULT_UPLOAD_POLICY, getBusinessConfig, type UploadPolicy } from '../lib/businessConfig.js';
import { config } from '../lib/config.js';
import { normalizeUploadFilename } from '../lib/filenameEncoding.js';
import { modelDownloadBaseName } from '../lib/modelDownloadName.js';
import { conversionQueue } from '../lib/queue.js';
import { MODEL_STATUS } from './modelStatus.js';
import { isStepFormat, scrubStepMetadata } from './stepMetadataScrub.js';

export const MAX_BATCH_MODEL_FILES = 200;

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
  entry: any;
  cleanName: string;
  ext: string;
  originalName: string;
  pairKey: string;
  structuredPath: StructuredArchivePath | null;
};

type RarEntryCandidate = {
  safeName: string;
  archiveName: string;
  ext: string;
  originalName: string;
  pairKey: string;
  structuredPath: StructuredArchivePath | null;
  declaredSize: number;
};

type StructuredArchivePath = {
  categoryName: string;
  subcategoryName: string | null;
  modelName: string;
  modelDirKey: string;
};

export type BatchArchiveUploadInput = {
  filePath: string;
  originalName: string;
  categoryId: string | null;
  userId: string;
};

export type BatchArchiveUploadOutput = {
  total: number;
  results: BatchUploadResult[];
  hasQueuedModels: boolean;
  categoryTreeChanged: boolean;
};

export class BatchArchiveUploadError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, detail: string) {
    super(detail);
    this.name = 'BatchArchiveUploadError';
    this.statusCode = statusCode;
  }
}

export function batchArchiveMaxSizeMb(uploadPolicy: UploadPolicy): number {
  const configuredMb = Number(uploadPolicy.batchArchiveMaxSizeMb);
  const fallbackMb = DEFAULT_UPLOAD_POLICY.batchArchiveMaxSizeMb;
  const maxMb = Number.isFinite(configuredMb) ? configuredMb : fallbackMb;
  return Math.max(1, Math.floor(maxMb));
}

export function batchArchiveMaxBytes(uploadPolicy: UploadPolicy): number {
  return batchArchiveMaxSizeMb(uploadPolicy) * 1024 * 1024;
}

export function isSupportedBatchArchive(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.rar');
}

function normalizeZipEntryName(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return null;
  const clean = posix.normalize(normalized);
  if (clean === '.' || clean === '..' || clean.startsWith('../')) return null;
  return clean;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

function normalizeArchiveSegment(value: string, maxLength = 180): string {
  return normalizeUploadFilename(value).trim().slice(0, maxLength);
}

function structuredArchivePath(cleanName: string): StructuredArchivePath | null {
  const parts = cleanName
    .split('/')
    .filter(Boolean)
    .map((part) => normalizeArchiveSegment(part));
  if (parts.length < 3) return null;
  const [categoryName] = parts;
  const hasSubcategory = parts.length >= 4;
  const subcategoryName = hasSubcategory ? parts[1] : null;
  const modelName = hasSubcategory ? parts[2] : parts[1];
  if (!categoryName || (hasSubcategory && !subcategoryName) || !modelName) return null;
  return {
    categoryName: categoryName.slice(0, 50),
    subcategoryName: subcategoryName ? subcategoryName.slice(0, 50) : null,
    modelName,
    modelDirKey: parts
      .slice(0, hasSubcategory ? 3 : 2)
      .join('/')
      .toLowerCase(),
  };
}

function archivePairKey(cleanName: string): string {
  const structured = structuredArchivePath(cleanName);
  if (structured) return `folder:${structured.modelDirKey}`;
  const dir = posix.dirname(cleanName);
  const rawStem = stripExtension(normalizeUploadFilename(posix.basename(cleanName))).trim();
  const stem = modelDownloadBaseName(posix.basename(cleanName), rawStem || 'model').toLowerCase();
  return `file:${dir === '.' ? '' : `${dir.toLowerCase()}/`}${stem}`;
}

function selectBatchModelEntries<
  T extends { ext: string; originalName: string; structuredPath: StructuredArchivePath | null },
>(entries: T[], acceptedExts: string[], results: BatchUploadResult[]): T[] {
  const selected: T[] = [];
  const structuredModelDirs = new Set<string>();

  for (const item of entries) {
    if (!acceptedExts.includes(item.ext)) continue;
    if (item.structuredPath) {
      if (structuredModelDirs.has(item.structuredPath.modelDirKey)) {
        results.push({
          name: item.structuredPath.modelName || item.originalName,
          status: MODEL_STATUS.FAILED,
          error: '同一个模型文件夹内存在多个模型文件，已跳过重复文件',
        });
        continue;
      }
      structuredModelDirs.add(item.structuredPath.modelDirKey);
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

function maxDrawingMb(): number {
  return Math.max(1, Math.round(config.maxFileSize / 1024 / 1024));
}

async function attachDrawingFromBuffer(
  prismaClient: typeof import('../lib/prisma.js').prisma,
  modelId: string,
  originalName: string,
  data: Buffer,
): Promise<string | null> {
  if (!prismaClient) return '数据库未连接，无法绑定 PDF 图纸';
  if (data.length <= 0) return 'PDF 图纸为空';
  if (data.length > config.maxFileSize) return `PDF 图纸过大，最大支持 ${maxDrawingMb()}MB`;
  if (!isPdfData(data)) return 'PDF 图纸内容无效';

  const drawingPath = join(config.staticDir, 'drawings', `${modelId}.pdf`);
  try {
    const drawingDir = join(config.staticDir, 'drawings');
    mkdirSync(drawingDir, { recursive: true });
    writeFileSync(drawingPath, data);

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
    } catch {}
    return '绑定 PDF 图纸失败';
  }
}

export async function processBatchArchiveUpload({
  filePath,
  originalName: archiveOriginalName,
  categoryId,
  userId,
}: BatchArchiveUploadInput): Promise<BatchArchiveUploadOutput> {
  let cleanupCreatedCategories: (() => Promise<void>) | null = null;

  try {
    const { prisma } = await import('../lib/prisma.js');
    const { uploadPolicy } = await getBusinessConfig();
    const acceptedExts = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
    const maxModelBytes = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;
    const maxArchiveBytes = batchArchiveMaxBytes(uploadPolicy);
    const maxArchiveMb = batchArchiveMaxSizeMb(uploadPolicy);
    const results: BatchUploadResult[] = [];
    const archiveCategoryCache = new Map<string, string | null>();
    const createdCategoryIds: string[] = [];
    let categoryTreeChanged = false;

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

      const resolvedId = await prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`model-category-root:${structuredPath.categoryName}`}))`;

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

        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`model-category-child:${root.id}:${structuredPath.subcategoryName}`}))`;

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

    const queueModelFromBuffer = async (
      originalName: string,
      ext: string,
      data: Buffer,
      options?: { modelName?: string; categoryId?: string | null; resolveCategoryId?: () => Promise<string | null> },
    ): Promise<BatchUploadResult | null> => {
      const modelId = randomUUID().slice(0, 12);
      let originalDest: string | null = null;
      const modelName = normalizeArchiveSegment(options?.modelName || stripExtension(originalName));
      const initialCategoryId = options?.resolveCategoryId ? null : (options?.categoryId ?? categoryId);

      try {
        if (data.length <= 0 || data.length > maxModelBytes) {
          results.push({
            name: modelName || originalName,
            status: MODEL_STATUS.FAILED,
            error: `文件大小异常，最大支持 ${uploadPolicy.modelMaxSizeMb}MB`,
          });
          return null;
        }

        const originalsDir = join(config.staticDir, 'originals');
        mkdirSync(originalsDir, { recursive: true });
        originalDest = join(originalsDir, `${modelId}.${ext}`);
        writeFileSync(originalDest, data);

        if (isStepFormat(ext)) {
          try {
            scrubStepMetadata(originalDest);
          } catch {
            /* non-critical */
          }
        }

        if (prisma) {
          await prisma.model.create({
            data: {
              id: modelId,
              name: modelName || originalName.replace(/\.[^.]+$/, ''),
              originalName,
              originalFormat: ext,
              originalSize: data.length,
              gltfUrl: '',
              gltfSize: 0,
              format: ext,
              status: MODEL_STATUS.QUEUED,
              uploadPath: originalDest,
              createdById: userId,
              ...(initialCategoryId && { categoryId: initialCategoryId }),
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
          if (prisma && options?.resolveCategoryId) {
            try {
              const resolvedCategoryId = await options.resolveCategoryId();
              if (resolvedCategoryId) {
                await prisma.model.update({ where: { id: modelId }, data: { categoryId: resolvedCategoryId } });
              }
            } catch {
              result.category_error = '分类绑定失败';
            }
          }
          results.push(result);
          return result;
        } catch {
          if (prisma) {
            await prisma.model
              .update({ where: { id: modelId }, data: { status: MODEL_STATUS.FAILED } })
              .catch(() => {});
          }
          results.push({
            model_id: modelId,
            name: modelName || originalName,
            status: MODEL_STATUS.FAILED,
            error: '转换队列暂不可用',
          });
          return null;
        }
      } catch {
        if (originalDest && existsSync(originalDest)) rmSync(originalDest, { force: true });
        results.push({ name: modelName || originalName, status: MODEL_STATUS.FAILED, error: '处理失败' });
        return null;
      }
    };

    if (archiveOriginalName.toLowerCase().endsWith('.zip')) {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(filePath);
      const entries = zip
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => ({ entry, safeName: normalizeZipEntryName(entry.entryName) }))
        .filter((item) => Boolean(item.safeName))
        .map(({ entry, safeName }) => {
          const cleanName = safeName!;
          const ext = cleanName.split('.').pop()?.toLowerCase();
          const structuredPath = structuredArchivePath(cleanName);
          return {
            entry,
            cleanName,
            ext: ext || '',
            originalName: normalizeUploadFilename(posix.basename(cleanName)),
            pairKey: archivePairKey(cleanName),
            structuredPath,
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

      const maxTotalExtractBytes = maxModelBytes * MAX_BATCH_MODEL_FILES;
      let totalExtractedBytes = 0;

      for (const { entry, ext, originalName, pairKey, structuredPath } of modelEntries) {
        const declaredSize = Number((entry as any).header?.size);
        if (
          Number.isFinite(declaredSize) &&
          declaredSize > 0 &&
          (declaredSize > maxModelBytes || totalExtractedBytes + declaredSize > maxTotalExtractBytes)
        ) {
          results.push({ name: originalName, status: MODEL_STATUS.FAILED, error: `文件过大或解压总量超限` });
          continue;
        }
        const data = entry.getData();
        if (data.length > maxModelBytes || totalExtractedBytes + data.length > maxTotalExtractBytes) {
          results.push({ name: originalName, status: MODEL_STATUS.FAILED, error: `文件过大或解压总量超限` });
          continue;
        }
        totalExtractedBytes += data.length;
        const result = await queueModelFromBuffer(originalName, ext, data, {
          modelName: structuredPath?.modelName,
          resolveCategoryId: structuredPath ? () => resolveArchiveCategoryId(structuredPath) : undefined,
        });
        const drawing = result?.model_id ? pdfByKey.get(pairKey) : null;
        if (!result?.model_id || !drawing) continue;

        const drawingDeclaredSize = Number((drawing.entry as any).header?.size);
        if (
          Number.isFinite(drawingDeclaredSize) &&
          drawingDeclaredSize > 0 &&
          (drawingDeclaredSize > config.maxFileSize || totalExtractedBytes + drawingDeclaredSize > maxTotalExtractBytes)
        ) {
          result.drawing_error = `PDF 图纸过大，最大支持 ${maxDrawingMb()}MB`;
          continue;
        }

        const drawingData = drawing.entry.getData();
        if (
          drawingData.length > config.maxFileSize ||
          totalExtractedBytes + drawingData.length > maxTotalExtractBytes
        ) {
          result.drawing_error = `PDF 图纸过大，最大支持 ${maxDrawingMb()}MB`;
          continue;
        }
        totalExtractedBytes += drawingData.length;
        const drawingError = await attachDrawingFromBuffer(prisma, result.model_id, drawing.originalName, drawingData);
        if (drawingError) result.drawing_error = drawingError;
        else result.drawing_attached = true;
      }
    } else {
      const stat = statSync(filePath);
      if (stat.size > maxArchiveBytes) {
        throw new BatchArchiveUploadError(400, `压缩包超过 ${maxArchiveMb}MB，请上传更小的 ZIP/RAR 文件`);
      }
      const archiveBuffer = readFileSync(filePath);
      const archiveData = archiveBuffer.buffer.slice(
        archiveBuffer.byteOffset,
        archiveBuffer.byteOffset + archiveBuffer.byteLength,
      );
      const listExtractor = await createExtractorFromData({ data: archiveData });
      const fileList = listExtractor.getFileList();
      const rarEntries: RarEntryCandidate[] = [];
      for (const header of fileList.fileHeaders) {
        const safeName = normalizeZipEntryName(header.name);
        if (!safeName) continue;
        const ext = safeName.split('.').pop()?.toLowerCase() || '';
        if (ext !== 'pdf' && !acceptedExts.includes(ext)) continue;
        const structuredPath = structuredArchivePath(safeName);
        rarEntries.push({
          safeName,
          archiveName: header.name,
          ext,
          originalName: normalizeUploadFilename(posix.basename(safeName)),
          pairKey: archivePairKey(safeName),
          structuredPath,
          declaredSize: Number(header.unpSize) || 0,
        });
      }

      const pdfByKey = new Map<string, RarEntryCandidate>();
      for (const item of rarEntries) {
        if (item.ext === 'pdf' && !pdfByKey.has(item.pairKey)) pdfByKey.set(item.pairKey, item);
      }

      const maxTotalExtractBytes = maxModelBytes * MAX_BATCH_MODEL_FILES;
      let selectedDeclaredBytes = 0;
      const selectedModelEntries = selectBatchModelEntries(rarEntries, acceptedExts, results);
      registerUnmatchedPdfResults(rarEntries, selectedModelEntries, results);
      const selectedArchiveNames = new Set<string>();
      const drawingPreErrors = new Map<string, string>();

      for (const item of selectedModelEntries) {
        if (
          item.declaredSize > 0 &&
          (item.declaredSize > maxModelBytes || selectedDeclaredBytes + item.declaredSize > maxTotalExtractBytes)
        ) {
          results.push({ name: item.originalName, status: MODEL_STATUS.FAILED, error: `解压后文件过大或总量超限` });
          continue;
        }

        selectedArchiveNames.add(item.archiveName);
        if (item.declaredSize > 0) selectedDeclaredBytes += item.declaredSize;

        const drawing = pdfByKey.get(item.pairKey);
        if (!drawing) continue;
        if (
          drawing.declaredSize > 0 &&
          (drawing.declaredSize > config.maxFileSize ||
            selectedDeclaredBytes + drawing.declaredSize > maxTotalExtractBytes)
        ) {
          drawingPreErrors.set(item.pairKey, `PDF 图纸过大，最大支持 ${maxDrawingMb()}MB`);
          continue;
        }
        selectedArchiveNames.add(drawing.archiveName);
        if (drawing.declaredSize > 0) selectedDeclaredBytes += drawing.declaredSize;
      }

      const extractedByName = new Map<string, Uint8Array>();
      if (selectedArchiveNames.size > 0) {
        const extractExtractor = await createExtractorFromData({ data: archiveData });
        const extracted = extractExtractor.extract({ files: Array.from(selectedArchiveNames) });
        for (const item of extracted.files) {
          if (item.extraction) extractedByName.set(item.fileHeader.name, item.extraction);
        }
      }

      let rarTotalBytes = 0;
      for (const item of selectedModelEntries) {
        const content = extractedByName.get(item.archiveName);
        if (!content?.byteLength) {
          results.push({ name: item.originalName, status: MODEL_STATUS.FAILED, error: '文件为空或无法解压' });
          continue;
        }
        if (content.byteLength > maxModelBytes || rarTotalBytes + content.byteLength > maxTotalExtractBytes) {
          results.push({ name: item.originalName, status: MODEL_STATUS.FAILED, error: `解压后文件过大或总量超限` });
          continue;
        }
        rarTotalBytes += content.byteLength;
        const result = await queueModelFromBuffer(item.originalName, item.ext, Buffer.from(content), {
          modelName: item.structuredPath?.modelName,
          resolveCategoryId: item.structuredPath ? () => resolveArchiveCategoryId(item.structuredPath) : undefined,
        });
        const drawing = result?.model_id ? pdfByKey.get(item.pairKey) : null;
        if (!result?.model_id || !drawing) continue;

        const drawingPreError = drawingPreErrors.get(item.pairKey);
        if (drawingPreError) {
          result.drawing_error = drawingPreError;
          continue;
        }

        const drawingContent = extractedByName.get(drawing.archiveName);
        if (!drawingContent?.byteLength) {
          result.drawing_error = 'PDF 图纸为空或无法解压';
          continue;
        }
        if (
          drawingContent.byteLength > config.maxFileSize ||
          rarTotalBytes + drawingContent.byteLength > maxTotalExtractBytes
        ) {
          result.drawing_error = `PDF 图纸过大，最大支持 ${maxDrawingMb()}MB`;
          continue;
        }

        rarTotalBytes += drawingContent.byteLength;
        const drawingError = await attachDrawingFromBuffer(
          prisma,
          result.model_id,
          drawing.originalName,
          Buffer.from(drawingContent),
        );
        if (drawingError) result.drawing_error = drawingError;
        else result.drawing_attached = true;
      }
    }

    await cleanupCreatedCategories();
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
    await cleanupCreatedCategories?.().catch(() => {});
    throw error;
  } finally {
    try {
      rmSync(filePath, { force: true });
    } catch {}
  }
}
