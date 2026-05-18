import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { logger } from './logger.js';

export type StorageSyncDirection = 'local_to_cloud' | 'cloud_to_local';
export type StorageSyncStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'error';

export interface StorageSyncScope {
  key: string;
  label: string;
  settingKey: string;
  prefix: string;
}

export interface StorageSyncJobSnapshot {
  id: string;
  direction: StorageSyncDirection;
  status: StorageSyncStatus;
  stage: string;
  percent: number;
  message: string;
  logs: string[];
  startedAt: string;
  finishedAt?: string;
  currentKey?: string;
  totalFiles: number;
  processedFiles: number;
  copiedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  deletedFiles: number;
  totalBytes: number;
  processedBytes: number;
  totalBytesText: string;
  processedBytesText: string;
  scopes: StorageSyncScope[];
  overwrite: boolean;
  deleteExtraneous: boolean;
  error?: string;
}

export interface StorageSyncStatusPayload {
  active: StorageSyncJobSnapshot | null;
  latest: StorageSyncJobSnapshot | null;
  jobs: StorageSyncJobSnapshot[];
}

interface StorageSyncOptions {
  direction: StorageSyncDirection;
  scopes?: string[];
  overwrite?: boolean;
  deleteExtraneous?: boolean;
}

interface LocalFileEntry {
  key: string;
  path: string;
  size: number;
}

interface RemoteFileEntry {
  key: string;
  size: number;
}

type ObjectStorageClient = {
  statObject(bucket: string, objectName: string): Promise<{ size?: number }>;
  putObject(
    bucket: string,
    objectName: string,
    stream: NodeJS.ReadableStream | Buffer,
    size?: number,
    metadata?: Record<string, string>,
  ): Promise<unknown>;
  getObject(bucket: string, objectName: string): Promise<NodeJS.ReadableStream>;
  removeObject(bucket: string, objectName: string): Promise<unknown>;
  listObjectsV2(bucket: string, prefix: string, recursive?: boolean): NodeJS.ReadableStream;
};

class StorageSyncJob {
  id = randomUUID();
  direction: StorageSyncDirection;
  status: StorageSyncStatus = 'queued';
  stage = 'queued';
  percent = 0;
  message = '等待开始同步...';
  logs: string[] = [];
  startedAt = new Date().toISOString();
  finishedAt?: string;
  currentKey?: string;
  totalFiles = 0;
  processedFiles = 0;
  copiedFiles = 0;
  skippedFiles = 0;
  failedFiles = 0;
  deletedFiles = 0;
  totalBytes = 0;
  processedBytes = 0;
  scopes: StorageSyncScope[];
  overwrite: boolean;
  deleteExtraneous: boolean;
  cancelRequested = false;
  error?: string;

  constructor(
    options: Required<Pick<StorageSyncOptions, 'direction' | 'overwrite' | 'deleteExtraneous'>>,
    scopes: StorageSyncScope[],
  ) {
    this.direction = options.direction;
    this.overwrite = options.overwrite;
    this.deleteExtraneous = options.deleteExtraneous;
    this.scopes = scopes;
  }

  log(message: string) {
    this.logs.push(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${message}`);
    if (this.logs.length > 200) this.logs = this.logs.slice(-200);
  }

  updateProgress(message?: string) {
    const total = Math.max(1, this.totalFiles);
    this.percent =
      this.totalFiles > 0
        ? Math.min(99, Math.round((Math.min(this.processedFiles, this.totalFiles) / total) * 100))
        : this.status === 'done'
          ? 100
          : 0;
    if (message) this.message = message;
  }

  finish(status: StorageSyncStatus, message: string, error?: string) {
    this.status = status;
    this.stage = status;
    this.percent = status === 'done' ? 100 : this.percent;
    this.message = message;
    this.error = error;
    this.finishedAt = new Date().toISOString();
    this.currentKey = undefined;
    this.log(message);
  }

  snapshot(): StorageSyncJobSnapshot {
    return {
      id: this.id,
      direction: this.direction,
      status: this.status,
      stage: this.stage,
      percent: this.percent,
      message: this.message,
      logs: this.logs,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      currentKey: this.currentKey,
      totalFiles: this.totalFiles,
      processedFiles: this.processedFiles,
      copiedFiles: this.copiedFiles,
      skippedFiles: this.skippedFiles,
      failedFiles: this.failedFiles,
      deletedFiles: this.deletedFiles,
      totalBytes: this.totalBytes,
      processedBytes: this.processedBytes,
      totalBytesText: formatBytes(this.totalBytes),
      processedBytesText: formatBytes(this.processedBytes),
      scopes: this.scopes,
      overwrite: this.overwrite,
      deleteExtraneous: this.deleteExtraneous,
      error: this.error,
    };
  }
}

const STORAGE_PROVIDER_LABELS: Record<string, string> = {
  local: '本地存储',
  minio: 'MinIO / 私有 S3',
  tencent_cos: '腾讯云 COS',
  aliyun_oss: '阿里云 OSS',
  qiniu_kodo: '七牛云 Kodo',
  s3_compatible: 'S3 兼容存储',
};

const SYNC_SCOPE_DEFINITIONS: Array<Omit<StorageSyncScope, 'prefix'>> = [
  { key: 'images', label: '图片原图', settingKey: 'storage_image_prefix' },
  { key: 'thumbnails', label: '缩略图', settingKey: 'storage_thumbnail_prefix' },
  { key: 'models', label: '模型文件', settingKey: 'storage_model_prefix' },
  { key: 'originals', label: '原始文件', settingKey: 'storage_original_prefix' },
  { key: 'drawings', label: '图纸文件', settingKey: 'storage_drawing_prefix' },
  { key: 'product-wall', label: '产品图库', settingKey: 'storage_product_wall_prefix' },
  { key: 'attachments', label: '业务附件', settingKey: 'storage_attachment_prefix' },
  { key: 'backups', label: '备份文件', settingKey: 'storage_backup_prefix' },
];

const jobs = new Map<string, StorageSyncJob>();
const MAX_STORED_JOBS = 10;

function settingString(settings: Record<string, unknown>, key: string, fallback = ''): string {
  const value = settings[key];
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function settingBoolean(settings: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = settings[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  return fallback;
}

function normalizePrefix(value: string, fallback: string): string {
  const normalized = (value || fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  return normalized || fallback;
}

function safeStorageKey(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function resolveInside(root: string, key: string): string {
  const rootPath = resolve(root);
  const resolved = resolve(rootPath, safeStorageKey(key));
  if (resolved !== rootPath && !resolved.startsWith(rootPath + sep)) {
    throw new Error(`资源路径越界: ${key}`);
  }
  return resolved;
}

function parseStorageEndpoint(rawEndpoint: string, useSSL: boolean) {
  const normalized = rawEndpoint.trim().replace(/\/+$/g, '');
  const endpointUrl = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(normalized) ? normalized : `${useSSL ? 'https' : 'http'}://${normalized}`,
  );
  const port = endpointUrl.port ? Number(endpointUrl.port) : undefined;
  return {
    endPoint: endpointUrl.hostname,
    port: Number.isFinite(port) ? port : undefined,
    useSSL: endpointUrl.protocol === 'https:',
  };
}

function getScopes(settings: Record<string, unknown>, selected?: string[]): StorageSyncScope[] {
  const selectedSet = new Set((selected || []).filter(Boolean));
  return SYNC_SCOPE_DEFINITIONS.map((scope) => ({
    ...scope,
    prefix: normalizePrefix(settingString(settings, scope.settingKey, scope.key), scope.key),
  })).filter((scope) => selectedSet.size === 0 || selectedSet.has(scope.key));
}

function getActiveJob(): StorageSyncJob | null {
  return [...jobs.values()].find((job) => job.status === 'queued' || job.status === 'running') || null;
}

function cleanupOldJobs() {
  const stored = [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const job of stored.slice(MAX_STORED_JOBS)) {
    if (job.status !== 'queued' && job.status !== 'running') jobs.delete(job.id);
  }
}

function assertCloudSettings(settings: Record<string, unknown>) {
  const provider = settingString(settings, 'storage_provider', 'local');
  if (provider === 'local') {
    throw new Error('当前使用本地存储，无需执行本地/云存储同步。请先配置云存储服务商。');
  }
  const endpoint = settingString(settings, 'storage_endpoint');
  const bucket = settingString(settings, 'storage_bucket');
  const accessKey = settingString(settings, 'storage_access_key_id');
  const secretKey = settingString(settings, 'storage_access_key_secret');
  const missing = [
    !endpoint ? 'Endpoint' : '',
    !bucket ? 'Bucket' : '',
    !accessKey ? 'Access Key ID' : '',
    !secretKey ? 'Access Key Secret' : '',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`云存储配置不完整：缺少 ${missing.join('、')}`);
  }
}

async function createObjectStorageClient(
  settings: Record<string, unknown>,
): Promise<{ client: ObjectStorageClient; bucket: string }> {
  assertCloudSettings(settings);
  const endpoint = parseStorageEndpoint(
    settingString(settings, 'storage_endpoint'),
    settingBoolean(settings, 'storage_use_ssl', true),
  );
  const Minio = (await import('minio')).default;
  const client = new Minio.Client({
    endPoint: endpoint.endPoint,
    port: endpoint.port,
    useSSL: endpoint.useSSL,
    accessKey: settingString(settings, 'storage_access_key_id'),
    secretKey: settingString(settings, 'storage_access_key_secret'),
    region: settingString(settings, 'storage_region') || undefined,
    pathStyle: settingBoolean(settings, 'storage_force_path_style', false),
  }) as ObjectStorageClient;
  return { client, bucket: settingString(settings, 'storage_bucket') };
}

async function collectLocalFiles(staticRoot: string, scopes: StorageSyncScope[]): Promise<LocalFileEntry[]> {
  const entries: LocalFileEntry[] = [];
  for (const scope of scopes) {
    const root = resolveInside(staticRoot, scope.prefix);
    async function walk(dir: string) {
      let dirEntries: Dirent[];
      try {
        dirEntries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of dirEntries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const fileStat = await stat(fullPath);
        const key = relative(staticRoot, fullPath).replace(/\\/g, '/');
        entries.push({ key, path: fullPath, size: fileStat.size });
      }
    }
    await walk(root);
  }
  return entries;
}

async function collectRemoteFiles(
  client: ObjectStorageClient,
  bucket: string,
  scopes: StorageSyncScope[],
): Promise<RemoteFileEntry[]> {
  const entries: RemoteFileEntry[] = [];
  for (const scope of scopes) {
    const prefix = `${scope.prefix.replace(/\/+$/g, '')}/`;
    await new Promise<void>((resolvePromise, reject) => {
      const stream = client.listObjectsV2(bucket, prefix, true);
      stream.on('data', (item: { name?: string; prefix?: string; size?: number }) => {
        const name = item.name || item.prefix;
        if (!name) return;
        entries.push({ key: safeStorageKey(name), size: Number(item.size) || 0 });
      });
      stream.on('error', reject);
      stream.on('end', resolvePromise);
    });
  }
  return entries;
}

async function remoteSize(client: ObjectStorageClient, bucket: string, key: string): Promise<number | null> {
  try {
    const result = await client.statObject(bucket, key);
    return typeof result.size === 'number' ? result.size : null;
  } catch {
    return null;
  }
}

async function localSize(staticRoot: string, key: string): Promise<number | null> {
  try {
    const fileStat = await stat(resolveInside(staticRoot, key));
    return fileStat.isFile() ? fileStat.size : null;
  } catch {
    return null;
  }
}

function contentTypeForKey(key: string): string | undefined {
  const ext = key.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'json') return 'application/json; charset=utf-8';
  if (['step', 'stp'].includes(ext)) return 'application/step';
  if (['zip', 'rar', '7z'].includes(ext)) return 'application/octet-stream';
  return undefined;
}

function ensureNotCancelled(job: StorageSyncJob) {
  if (job.cancelRequested) throw new Error('同步任务已取消');
}

async function runLocalToCloud(job: StorageSyncJob, settings: Record<string, unknown>) {
  const staticRoot = resolve(process.cwd(), config.staticDir);
  const { client, bucket } = await createObjectStorageClient(settings);
  job.stage = 'scanning';
  job.log('正在扫描本地资源目录');
  const localFiles = await collectLocalFiles(staticRoot, job.scopes);
  job.totalFiles = localFiles.length;
  job.totalBytes = localFiles.reduce((sum, item) => sum + item.size, 0);
  job.log(`扫描完成：${job.totalFiles} 个文件，${formatBytes(job.totalBytes)}`);
  job.updateProgress('开始同步到云存储...');

  const localKeySet = new Set(localFiles.map((item) => item.key));
  for (const file of localFiles) {
    ensureNotCancelled(job);
    job.status = 'running';
    job.stage = 'uploading';
    job.currentKey = file.key;
    try {
      const existingSize = await remoteSize(client, bucket, file.key);
      if (!job.overwrite && existingSize === file.size) {
        job.skippedFiles++;
        job.log(`跳过已存在：${file.key}`);
      } else {
        await client.putObject(bucket, file.key, createReadStream(file.path), file.size, {
          ...(contentTypeForKey(file.key) ? { 'Content-Type': contentTypeForKey(file.key) as string } : {}),
        });
        job.copiedFiles++;
        job.log(`${existingSize === null ? '上传' : '覆盖'}：${file.key}`);
      }
      job.processedFiles++;
      job.processedBytes += file.size;
      job.updateProgress(`正在同步 ${job.processedFiles}/${job.totalFiles}`);
    } catch (error) {
      job.failedFiles++;
      job.log(`失败：${file.key} - ${error instanceof Error ? error.message : String(error)}`);
      job.processedFiles++;
      job.updateProgress(`同步失败 ${job.failedFiles} 个，继续处理...`);
    }
  }

  if (job.deleteExtraneous) {
    ensureNotCancelled(job);
    job.stage = 'deleting';
    job.message = '正在删除云端多余文件...';
    const remoteFiles = await collectRemoteFiles(client, bucket, job.scopes);
    for (const remote of remoteFiles) {
      ensureNotCancelled(job);
      if (localKeySet.has(remote.key)) continue;
      await client.removeObject(bucket, remote.key);
      job.deletedFiles++;
      job.log(`删除云端多余文件：${remote.key}`);
    }
  }
}

async function runCloudToLocal(job: StorageSyncJob, settings: Record<string, unknown>) {
  const staticRoot = resolve(process.cwd(), config.staticDir);
  const { client, bucket } = await createObjectStorageClient(settings);
  job.stage = 'scanning';
  job.log('正在扫描云存储对象');
  const remoteFiles = await collectRemoteFiles(client, bucket, job.scopes);
  job.totalFiles = remoteFiles.length;
  job.totalBytes = remoteFiles.reduce((sum, item) => sum + item.size, 0);
  job.log(`扫描完成：${job.totalFiles} 个对象，${formatBytes(job.totalBytes)}`);
  job.updateProgress('开始同步到本地...');

  const remoteKeySet = new Set(remoteFiles.map((item) => item.key));
  for (const remote of remoteFiles) {
    ensureNotCancelled(job);
    job.status = 'running';
    job.stage = 'downloading';
    job.currentKey = remote.key;
    try {
      const existingSize = await localSize(staticRoot, remote.key);
      if (!job.overwrite && existingSize === remote.size) {
        job.skippedFiles++;
        job.log(`跳过已存在：${remote.key}`);
      } else {
        const destination = resolveInside(staticRoot, remote.key);
        await mkdir(dirname(destination), { recursive: true });
        await pipeline(await client.getObject(bucket, remote.key), createWriteStream(destination));
        job.copiedFiles++;
        job.log(`${existingSize === null ? '下载' : '覆盖'}：${remote.key}`);
      }
      job.processedFiles++;
      job.processedBytes += remote.size;
      job.updateProgress(`正在同步 ${job.processedFiles}/${job.totalFiles}`);
    } catch (error) {
      job.failedFiles++;
      job.log(`失败：${remote.key} - ${error instanceof Error ? error.message : String(error)}`);
      job.processedFiles++;
      job.updateProgress(`同步失败 ${job.failedFiles} 个，继续处理...`);
    }
  }

  if (job.deleteExtraneous) {
    ensureNotCancelled(job);
    job.stage = 'deleting';
    job.message = '正在删除本地多余文件...';
    const localFiles = await collectLocalFiles(staticRoot, job.scopes);
    for (const local of localFiles) {
      ensureNotCancelled(job);
      if (remoteKeySet.has(local.key)) continue;
      await rm(local.path, { force: true });
      job.deletedFiles++;
      job.log(`删除本地多余文件：${local.key}`);
    }
  }
}

async function runJob(job: StorageSyncJob, settings: Record<string, unknown>) {
  try {
    job.status = 'running';
    job.stage = 'checking';
    job.message = '正在检查云存储配置...';
    const provider = settingString(settings, 'storage_provider', 'local');
    job.log(`存储服务商：${STORAGE_PROVIDER_LABELS[provider] || provider}`);
    if (job.direction === 'local_to_cloud') await runLocalToCloud(job, settings);
    else await runCloudToLocal(job, settings);

    if (job.cancelRequested) {
      job.finish('cancelled', '同步任务已停止');
      return;
    }
    const message =
      job.failedFiles > 0
        ? `同步完成，${job.copiedFiles} 个已复制，${job.skippedFiles} 个已跳过，${job.failedFiles} 个失败`
        : `同步完成，${job.copiedFiles} 个已复制，${job.skippedFiles} 个已跳过`;
    job.finish('done', message);
  } catch (error) {
    if (job.cancelRequested) {
      job.finish('cancelled', '同步任务已停止');
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    job.finish('error', '同步任务失败', message);
    logger.error({ err: error, jobId: job.id }, 'storage sync failed');
  } finally {
    cleanupOldJobs();
  }
}

export function getAvailableStorageSyncScopes(settings: Record<string, unknown>): StorageSyncScope[] {
  return getScopes(settings);
}

export function getStorageSyncStatus(): StorageSyncStatusPayload {
  const snapshots = [...jobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((job) => job.snapshot());
  return {
    active: snapshots.find((job) => job.status === 'queued' || job.status === 'running') || null,
    latest: snapshots[0] || null,
    jobs: snapshots,
  };
}

export function getStorageSyncJob(id: string): StorageSyncJobSnapshot | null {
  return jobs.get(id)?.snapshot() || null;
}

export function startStorageSyncJob(
  settings: Record<string, unknown>,
  options: StorageSyncOptions,
): StorageSyncJobSnapshot {
  if (!settingBoolean(settings, 'storage_sync_enabled', false)) {
    throw new Error('本地/云同步功能未开启，请先打开“启用同步工具”。');
  }
  const active = getActiveJob();
  if (active) throw new Error('已有同步任务正在执行，请等待完成或先停止当前任务。');

  const direction = options.direction === 'cloud_to_local' ? 'cloud_to_local' : 'local_to_cloud';
  const scopes = getScopes(settings, options.scopes);
  if (scopes.length === 0) throw new Error('请选择至少一个资源目录。');
  assertCloudSettings(settings);

  const job = new StorageSyncJob(
    {
      direction,
      overwrite: Boolean(options.overwrite),
      deleteExtraneous:
        Boolean(options.deleteExtraneous) && settingBoolean(settings, 'storage_sync_delete_extra_enabled', false),
    },
    scopes,
  );
  jobs.set(job.id, job);
  void runJob(job, settings);
  return job.snapshot();
}

export function cancelStorageSyncJob(id: string): StorageSyncJobSnapshot | null {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'queued' || job.status === 'running') {
    job.cancelRequested = true;
    job.message = '正在停止同步任务...';
    job.log('收到停止请求，当前文件处理完成后停止');
  }
  return job.snapshot();
}

export function deleteStorageSyncJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'queued' || job.status === 'running') {
    throw new Error('同步任务正在执行，不能删除记录。请先停止任务。');
  }
  return jobs.delete(id);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
