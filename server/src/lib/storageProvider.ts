// 云对象存储 provider（双写 + 云优先服务 + 本地兜底）
//
// 设计要点：
// - 本地是真相源：所有文件先落本地（现有 writeFileSync/rmSync/express.static 不变）。
// - 云端是可选镜像：`persistFile()` 把已落地的本地文件上传到云端（provider 为 local 时 no-op）。
// - 云端 key = 本地路径相对于 staticDir 的相对路径，与 /static/* 请求路径一一对应。
// - 服务层（/static）云优先：配了云就从云端流式代理（支持 Range）→ miss/出错则本地 express.static 兜底。
// - 7 种 provider（local/MinIO/AWS/阿里云/腾讯云/七牛/通用 S3）全是 S3 兼容，一套 minio 客户端覆盖。
//
// 所有云端操作 best-effort：失败只记日志、绝不抛出，保证本地链路不受影响。
import { basename, relative, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { Client as MinioClient } from 'minio';
import { config } from './config.js';
import { logger } from './logger.js';

// settings.ts 在 import 时即创建 Redis 订阅 / Prisma 客户端，会拖累纯单元测试（如 modelFiles.test.ts）。
// 这里改成调用时动态 import，使本模块的静态依赖图保持轻量（不拉 redis/prisma）。
async function loadAllSettings(): Promise<Record<string, unknown>> {
  const { getAllSettings } = await import('./settings.js');
  return getAllSettings();
}

export interface ResolvedObject {
  stream: NodeJS.ReadableStream;
  fullSize: number; // 完整对象大小（字节）
  contentLength: number; // 本次响应体大小（字节）
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  partial: boolean; // 是否为 Range 响应
  contentRange?: string; // 'bytes start-end/fullSize'，partial 时提供
}

export interface StorageSettings {
  provider: string;
  endpoint: string;
  port?: number;
  useSSL: boolean;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
}

// --- 设置读取（与 settingsConnectivity 一致，便于复用）---

function settingString(settings: Record<string, unknown>, key: string, fallback = ''): string {
  const value = settings[key];
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function settingBoolean(settings: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = settings[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

export interface StorageEndpoint {
  endPoint: string;
  port?: number;
  useSSL: boolean;
}

/** 把管理员填的 endpoint（可能带协议/端口/尾斜杠）归一为 minio 客户端所需的 host/port/useSSL。 */
export function resolveStorageEndpoint(rawEndpoint: string, useSSL: boolean): StorageEndpoint {
  const normalized = rawEndpoint.trim().replace(/\/+$/g, '');
  if (!normalized) return { endPoint: '', port: undefined, useSSL };
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

export function readStorageSettings(settings: Record<string, unknown> = {}): StorageSettings {
  const useSSL = settingBoolean(settings, 'storage_use_ssl', true);
  const parsed = resolveStorageEndpoint(settingString(settings, 'storage_endpoint'), useSSL);
  return {
    provider: settingString(settings, 'storage_provider', 'local'),
    endpoint: parsed.endPoint,
    port: parsed.port,
    useSSL: parsed.useSSL,
    region: settingString(settings, 'storage_region'),
    bucket: settingString(settings, 'storage_bucket'),
    accessKey: settingString(settings, 'storage_access_key_id'),
    secretKey: settingString(settings, 'storage_access_key_secret'),
    pathStyle: settingBoolean(settings, 'storage_force_path_style', false),
  };
}

/** 根据 DB 设置构造一个 minio 客户端（settingsConnectivity 的连接测试也复用此函数）。 */
export async function createS3Client(settings: StorageSettings): Promise<MinioClient> {
  const Minio = (await import('minio')).default;
  return new Minio.Client({
    endPoint: settings.endpoint,
    port: settings.port,
    useSSL: settings.useSSL,
    accessKey: settings.accessKey,
    secretKey: settings.secretKey,
    region: settings.region || undefined,
    pathStyle: settings.pathStyle,
  });
}

export function isCloudStorageConfigured(settings: StorageSettings): boolean {
  if (settings.provider === 'local') return false;
  return Boolean(settings.endpoint && settings.bucket && settings.accessKey && settings.secretKey);
}

// --- Range 头解析（无 Range 头返回 null；不可满足返回 null 由调用方走全量）---

function parseRangeHeader(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header || !header.startsWith('bytes=')) return null;
  const spec = header.slice(6).trim();
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m) return null;
  if (m[1] === '' && m[2] === '') return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // suffix：取最后 N 字节
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Number(m[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= size || start > end) return null;
  return { start, end };
}

// --- S3 provider（单一实现覆盖全部非 local 服务商）---

class S3Storage {
  private client: MinioClient | null = null;
  private readonly settings: StorageSettings;

  constructor(settings: StorageSettings) {
    this.settings = settings;
  }

  private async getClient(): Promise<MinioClient> {
    if (!this.client) this.client = await createS3Client(this.settings);
    return this.client;
  }

  async uploadFile(localPath: string, contentType?: string): Promise<void> {
    const client = await this.getClient();
    const metaData: Record<string, string> = {};
    if (contentType) metaData['Content-Type'] = contentType;
    await client.fPutObject(this.settings.bucket, this.deriveKey(localPath), localPath, metaData);
  }

  async deleteFile(key: string): Promise<void> {
    const client = await this.getClient();
    await client.removeObject(this.settings.bucket, key);
  }

  async exists(key: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      await client.statObject(this.settings.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 解析对象供 HTTP 响应：先 stat 拿到 size/元数据，再按 Range 头（若有）读取区间。
   * 对象不存在或读取出错时返回 null（由调用方走本地兜底）。
   */
  async resolveObject(key: string, rangeHeader?: string): Promise<ResolvedObject | null> {
    const client = await this.getClient();
    let size: number;
    let etag: string | undefined;
    let contentType: string | undefined;
    let lastModified: Date | undefined;
    try {
      const stat = await client.statObject(this.settings.bucket, key);
      size = stat.size;
      etag = stat.etag?.replace(/^"|"$/g, '') || undefined;
      contentType = (stat.metaData?.['content-type'] as string | undefined) || guessContentType(key);
      lastModified = stat.lastModified;
    } catch (error) {
      logger.warn({ err: error, key, bucket: this.settings.bucket }, 'cloud stat failed, will fall back to local');
      return null;
    }

    const range = parseRangeHeader(rangeHeader, size);
    let stream: Readable;
    if (range) {
      try {
        stream = (await client.getPartialObject(
          this.settings.bucket,
          key,
          range.start,
          range.end - range.start + 1,
        )) as unknown as Readable;
      } catch (error) {
        logger.warn({ err: error, key }, 'cloud partial read failed, will fall back to local');
        return null;
      }
      const contentLength = range.end - range.start + 1;
      return {
        stream,
        fullSize: size,
        contentLength,
        contentType,
        etag,
        lastModified,
        partial: true,
        contentRange: `bytes ${range.start}-${range.end}/${size}`,
      };
    }

    try {
      stream = (await client.getObject(this.settings.bucket, key)) as unknown as Readable;
    } catch (error) {
      logger.warn({ err: error, key }, 'cloud full read failed, will fall back to local');
      return null;
    }
    return { stream, fullSize: size, contentLength: size, contentType, etag, lastModified, partial: false };
  }

  private deriveKey(localPath: string): string {
    return deriveStorageKey(localPath);
  }
}

// --- 工厂 + 缓存（按配置签名失效，支持运行时切换 provider）---

const staticDirAbs = () => resolve(process.cwd(), config.staticDir);

let cached: { signature: string; provider: S3Storage } | null = null;

function settingsSignature(s: StorageSettings): string {
  return JSON.stringify([s.provider, s.endpoint, s.port, s.useSSL, s.region, s.bucket, s.accessKey, s.pathStyle]);
}

/**
 * 返回当前生效的云 provider；provider 为 local 或配置不全时返回 null。
 * 缓存实例，配置变更（切换服务商/改密钥）时自动重建。
 */
export async function getCloudProvider(): Promise<S3Storage | null> {
  const settings = readStorageSettings(await loadAllSettings());
  if (!isCloudStorageConfigured(settings)) {
    cached = null;
    return null;
  }
  const signature = settingsSignature(settings);
  if (cached && cached.signature === signature) return cached.provider;
  const provider = new S3Storage(settings);
  cached = { signature, provider };
  return provider;
}

export async function isCloudStorageActive(): Promise<boolean> {
  return (await getCloudProvider()) !== null;
}

// --- key 派生：本地路径 → 云端 key（= /static 请求路径）---

export function deriveStorageKey(localPath: string): string {
  return relative(staticDirAbs(), resolve(localPath)).replace(/\\/g, '/');
}

export function keyFromStaticUrl(urlPath: string): string {
  return urlPath.replace(/^\/static\//, '').replace(/\\/g, '/');
}

// --- 双写（写）/ 双删（删）：云端 best-effort，永不抛出 ---

const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
};

function guessContentType(key: string): string {
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

/** 双写：把已落地的本地文件上传到云端（provider 为 local 时 no-op）。失败只记日志。 */
export async function persistFile(localPath: string, contentType?: string): Promise<void> {
  try {
    const provider = await getCloudProvider();
    if (!provider) return;
    await provider.uploadFile(localPath, contentType ?? guessContentType(localPath));
  } catch (error) {
    logger.error({ err: error, file: basename(localPath) }, 'cloud persist failed (local copy intact)');
  }
}

/** 批量双写。 */
export async function persistFiles(localPaths: Array<string | null | undefined>): Promise<void> {
  let provider;
  try {
    provider = await getCloudProvider();
  } catch (error) {
    logger.error({ err: error }, 'cloud provider unavailable, skipping persist');
    return;
  }
  if (!provider) return;
  for (const localPath of localPaths) {
    if (!localPath) continue;
    try {
      await provider.uploadFile(localPath, guessContentType(localPath));
    } catch (error) {
      logger.error({ err: error, file: basename(localPath) }, 'cloud persist failed (local copy intact)');
    }
  }
}

/** 双删：从云端删除（provider 为 local 时 no-op）。失败只记日志。 */
export async function deleteCloudFile(key: string): Promise<void> {
  try {
    const provider = await getCloudProvider();
    if (!provider) return;
    await provider.deleteFile(key);
  } catch (error) {
    logger.error({ err: error, key }, 'cloud delete failed (local already removed)');
  }
}

export async function deleteCloudFiles(keys: Array<string | null | undefined>): Promise<void> {
  let provider;
  try {
    provider = await getCloudProvider();
  } catch (error) {
    logger.error({ err: error }, 'cloud provider unavailable, skipping delete');
    return;
  }
  if (!provider) return;
  for (const key of keys) {
    if (!key) continue;
    try {
      await provider.deleteFile(key);
    } catch (error) {
      logger.error({ err: error, key }, 'cloud delete failed (local already removed)');
    }
  }
}

// --- 服务层：云端流式读取（带 Range），供 /static 代理使用 ---

export async function resolveCloudObject(key: string, rangeHeader?: string): Promise<ResolvedObject | null> {
  const provider = await getCloudProvider();
  if (!provider) return null;
  return provider.resolveObject(key, rangeHeader);
}

/** 程序启动时打印对象存储模式（仅日志，不做网络调用；连通性由设置页测试按钮验证）。 */
export async function logStorageMode(): Promise<void> {
  const settings = readStorageSettings(await loadAllSettings());
  if (!isCloudStorageConfigured(settings)) {
    logger.info('  💾 对象存储：本地模式（未配置云端）');
    return;
  }
  logger.info(`  💾 对象存储：云端已启用（${settings.provider} · bucket=${settings.bucket}）`);
}
