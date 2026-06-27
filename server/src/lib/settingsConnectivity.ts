import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { cacheDel, cacheGet, cacheIsAvailable, cachePing, cacheSet } from './cache.js';
import { config } from './config.js';
import { createS3Client, readStorageSettings } from './storageProvider.js';

export type SettingsConnectivityStatus = 'success' | 'warning' | 'error';

export interface SettingsConnectivityResult {
  ok: boolean;
  status: SettingsConnectivityStatus;
  message: string;
  details: string[];
  provider?: string;
  latencyMs?: number;
}

const STORAGE_PROVIDER_LABELS: Record<string, string> = {
  local: '本地存储',
  minio: 'MinIO / 私有 S3',
  tencent_cos: '腾讯云 COS',
  aliyun_oss: '阿里云 OSS',
  qiniu_kodo: '七牛云 Kodo',
  s3_compatible: 'S3 兼容存储',
};

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

function settingNumber(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? value : fallback;
}

function normalizePrefix(value: string, fallback: string): string {
  return (value || fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

function result(
  status: SettingsConnectivityStatus,
  message: string,
  details: string[],
  extra: Partial<SettingsConnectivityResult> = {},
): SettingsConnectivityResult {
  return { ok: status !== 'error', status, message, details, ...extra };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redisTroubleshootingHints(redisUrl: string): string[] {
  const hints: string[] = [];
  try {
    const parsed = new URL(redisUrl);
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      hints.push('当前 Redis 地址指向本机；Docker 部署中应使用 redis 服务名或 REDIS_URL 环境变量中的地址。');
    }
  } catch {
    hints.push('Redis 地址格式异常，请使用 redis://host:6379 或 rediss://host:6379。');
  }
  return hints;
}

async function readableToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function testCacheConnectivity(_settings: Record<string, unknown>): Promise<SettingsConnectivityResult> {
  const startedAt = Date.now();
  const redisUrl = config.redisUrl;
  const testKey = `settings-test:${Date.now()}`;

  // Test the cache connection the application ACTUALLY uses (env REDIS_URL, via the
  // shared cache.ts client). The app's cache layer ignores the redis_url /
  // redis_password DB settings, so building a separate client from those settings
  // can report WRONGPASS even while the real cache is perfectly healthy — which is
  // exactly the false alarm this guards against. A green result here means the same
  // connection serving /api/models, /api/categories etc. is live.
  let ready = cacheIsAvailable();
  if (!ready) {
    try {
      await cachePing();
      ready = cacheIsAvailable();
    } catch {
      ready = false;
    }
  }

  if (!ready) {
    return result(
      'error',
      'Redis 测试失败',
      ['应用实际使用的缓存连接（环境变量 REDIS_URL）未就绪', ...redisTroubleshootingHints(redisUrl)],
      { provider: 'redis', latencyMs: Date.now() - startedAt },
    );
  }

  try {
    await cacheSet(testKey, 'ok', 30);
    const value = await cacheGet<string>(testKey);
    await cacheDel(testKey);
    const latencyMs = Date.now() - startedAt;
    if (value !== 'ok') {
      return result('error', 'Redis 已连接，但读写校验失败', [`写入后读取=${value ?? '空'}`], {
        provider: 'redis',
        latencyMs,
      });
    }
    return result(
      'success',
      'Redis 连接和读写测试通过',
      ['使用应用实际缓存连接（REDIS_URL 环境变量）', `测试键 ${testKey}`, `读写延迟 ${latencyMs}ms`],
      { provider: 'redis', latencyMs },
    );
  } catch (error) {
    return result('error', 'Redis 测试失败', [errorMessage(error), ...redisTroubleshootingHints(redisUrl)], {
      provider: 'redis',
      latencyMs: Date.now() - startedAt,
    });
  }
}

export async function testStorageConnectivity(settings: Record<string, unknown>): Promise<SettingsConnectivityResult> {
  const provider = settingString(settings, 'storage_provider', 'local');
  const providerLabel = STORAGE_PROVIDER_LABELS[provider] || provider;
  const tempPrefix = normalizePrefix(settingString(settings, 'storage_temp_prefix', 'temp'), 'temp');
  const testObjectKey = `${tempPrefix}/settings-storage-test-${Date.now()}.txt`;
  const payload = `3DPartHub storage connectivity test ${new Date().toISOString()}`;
  const startedAt = Date.now();

  if (provider === 'local') {
    const filePath = join(process.cwd(), config.staticDir, testObjectKey);
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, payload, 'utf8');
      const saved = await readFile(filePath, 'utf8');
      await rm(filePath, { force: true });
      const latencyMs = Date.now() - startedAt;
      if (saved !== payload) {
        return result('error', '本地存储读写校验失败', [`文件 ${filePath} 写入后内容不一致`], {
          provider: providerLabel,
          latencyMs,
        });
      }
      return result('success', '本地存储读写测试通过', [`临时文件 ${filePath}`, `读写延迟 ${latencyMs}ms`], {
        provider: providerLabel,
        latencyMs,
      });
    } catch (error) {
      return result('error', '本地存储测试失败', [errorMessage(error)], {
        provider: providerLabel,
        latencyMs: Date.now() - startedAt,
      });
    }
  }

  const storage = readStorageSettings(settings);
  const missing = [
    !storage.endpoint ? 'Endpoint' : '',
    !storage.bucket ? 'Bucket' : '',
    !storage.accessKey ? 'Access Key ID' : '',
    !storage.secretKey ? 'Access Key Secret' : '',
  ].filter(Boolean);

  if (missing.length > 0) {
    return result('error', `${providerLabel} 配置不完整`, [`缺少：${missing.join('、')}`], { provider: providerLabel });
  }

  const endpointDisplay = `${storage.useSSL ? 'https' : 'http'}://${storage.endpoint}${storage.port ? `:${storage.port}` : ''}`;
  let uploaded = false;
  try {
    const client = await createS3Client(storage);

    const exists = await client.bucketExists(storage.bucket);
    if (!exists) {
      return result('error', `${providerLabel} Bucket 不存在或无权访问`, [`Bucket：${storage.bucket}`], {
        provider: providerLabel,
        latencyMs: Date.now() - startedAt,
      });
    }

    await client.putObject(storage.bucket, testObjectKey, Buffer.from(payload), payload.length, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    uploaded = true;
    const objectStream = await client.getObject(storage.bucket, testObjectKey);
    const saved = await readableToString(objectStream);
    const details = [`Endpoint：${endpointDisplay}`, `Bucket：${storage.bucket}`, `临时对象：${testObjectKey}`];
    if (settingBoolean(settings, 'storage_signed_url_enabled', false)) {
      const ttl = Math.min(
        86400,
        Math.max(60, Math.round(settingNumber(settings, 'storage_signed_url_ttl_seconds', 3600))),
      );
      await client.presignedGetObject(storage.bucket, testObjectKey, ttl).catch(() => undefined);
      details.push(`签名 URL 配置已读取：${ttl} 秒`);
    }
    await client.removeObject(storage.bucket, testObjectKey);
    uploaded = false;
    const latencyMs = Date.now() - startedAt;
    if (saved !== payload) {
      return result('error', `${providerLabel} 已连接，但读写校验失败`, ['写入后读取内容不一致'], {
        provider: providerLabel,
        latencyMs,
      });
    }
    return result('success', `${providerLabel} 连接和读写测试通过`, [...details, `读写延迟 ${latencyMs}ms`], {
      provider: providerLabel,
      latencyMs,
    });
  } catch (error) {
    return result('error', `${providerLabel} 测试失败`, [errorMessage(error)], {
      provider: providerLabel,
      latencyMs: Date.now() - startedAt,
    });
  } finally {
    if (uploaded) {
      try {
        const client = await createS3Client(storage);
        await client.removeObject(storage.bucket, testObjectKey);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}
