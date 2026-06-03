import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import Redis from 'ioredis';
import { config } from './config.js';

export type SettingsConnectivityStatus = 'success' | 'warning' | 'error';

export interface SettingsConnectivityResult {
  ok: boolean;
  status: SettingsConnectivityStatus;
  message: string;
  details: string[];
  provider?: string;
  latencyMs?: number;
}

type StorageEndpoint = {
  endPoint: string;
  port?: number;
  useSSL: boolean;
};

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

function parseStorageEndpoint(rawEndpoint: string, useSSL: boolean): StorageEndpoint {
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

async function readableToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function testCacheConnectivity(settings: Record<string, unknown>): Promise<SettingsConnectivityResult> {
  const enabled = settingBoolean(settings, 'cache_enabled', true);
  const driver = settingString(settings, 'cache_driver', 'redis');
  if (!enabled || driver === 'off') {
    return result('warning', '缓存已关闭，未执行 Redis 测试', ['cache_enabled 关闭或 cache_driver 为 off。']);
  }
  if (driver === 'memory') {
    return result('warning', '当前使用内存缓存，无需连接 Redis', [
      '内存缓存只适合单机或开发环境，多进程部署建议使用 Redis。',
    ]);
  }
  if (driver !== 'redis') {
    return result('error', '未知缓存驱动，无法测试', [`cache_driver=${driver || '空'}`]);
  }

  const redisUrl = settingString(settings, 'redis_url', config.redisUrl);
  const redisPassword = settingString(settings, 'redis_password');
  const redisDb = Math.min(15, Math.max(0, Math.round(settingNumber(settings, 'redis_db', 0))));
  const keyPrefix = normalizePrefix(settingString(settings, 'redis_key_prefix', '3dparthub'), '3dparthub');
  const useTls = settingBoolean(settings, 'redis_tls_enabled', false) || redisUrl.startsWith('rediss://');
  const testKey = `${keyPrefix}:settings-test:${Date.now()}`;
  const startedAt = Date.now();
  let firstRedisError: Error | null = null;
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    password: redisPassword || undefined,
    db: redisDb,
    tls: useTls ? {} : undefined,
    connectTimeout: 3000,
    commandTimeout: 3000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', (error) => {
    firstRedisError ||= error;
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    await redis.set(testKey, 'ok', 'EX', 30);
    const value = await redis.get(testKey);
    await redis.del(testKey);
    const latencyMs = Date.now() - startedAt;
    if (pong !== 'PONG' || value !== 'ok') {
      return result('error', 'Redis 已连接，但读写校验失败', [`PING=${pong}`, `写入后读取=${value ?? '空'}`], {
        provider: 'redis',
        latencyMs,
      });
    }
    return result(
      'success',
      'Redis 连接和读写测试通过',
      [`数据库 DB ${redisDb}`, `测试键 ${testKey}`, `读写延迟 ${latencyMs}ms`],
      { provider: 'redis', latencyMs },
    );
  } catch (error) {
    const message = errorMessage(firstRedisError || error);
    return result('error', 'Redis 测试失败', [message, ...redisTroubleshootingHints(redisUrl)], {
      provider: 'redis',
      latencyMs: Date.now() - startedAt,
    });
  } finally {
    try {
      if (redis.status === 'ready') {
        await redis.quit();
      } else {
        redis.disconnect();
      }
    } catch {
      redis.disconnect();
    }
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

  const endpoint = settingString(settings, 'storage_endpoint');
  const bucket = settingString(settings, 'storage_bucket');
  const accessKey = settingString(settings, 'storage_access_key_id');
  const secretKey = settingString(settings, 'storage_access_key_secret');
  const region = settingString(settings, 'storage_region');
  const missing = [
    !endpoint ? 'Endpoint' : '',
    !bucket ? 'Bucket' : '',
    !accessKey ? 'Access Key ID' : '',
    !secretKey ? 'Access Key Secret' : '',
  ].filter(Boolean);

  if (missing.length > 0) {
    return result('error', `${providerLabel} 配置不完整`, [`缺少：${missing.join('、')}`], { provider: providerLabel });
  }

  const parsedEndpoint = parseStorageEndpoint(endpoint, settingBoolean(settings, 'storage_use_ssl', true));
  let uploaded = false;
  try {
    const Minio = (await import('minio')).default;
    const client = new Minio.Client({
      endPoint: parsedEndpoint.endPoint,
      port: parsedEndpoint.port,
      useSSL: parsedEndpoint.useSSL,
      accessKey,
      secretKey,
      region: region || undefined,
      pathStyle: settingBoolean(settings, 'storage_force_path_style', false),
    });

    const exists = await client.bucketExists(bucket);
    if (!exists) {
      return result('error', `${providerLabel} Bucket 不存在或无权访问`, [`Bucket：${bucket}`], {
        provider: providerLabel,
        latencyMs: Date.now() - startedAt,
      });
    }

    await client.putObject(bucket, testObjectKey, Buffer.from(payload), payload.length, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    uploaded = true;
    const objectStream = await client.getObject(bucket, testObjectKey);
    const saved = await readableToString(objectStream);
    const details = [
      `Endpoint：${parsedEndpoint.useSSL ? 'https' : 'http'}://${parsedEndpoint.endPoint}${parsedEndpoint.port ? `:${parsedEndpoint.port}` : ''}`,
      `Bucket：${bucket}`,
      `临时对象：${testObjectKey}`,
    ];
    if (settingBoolean(settings, 'storage_signed_url_enabled', false)) {
      const ttl = Math.min(
        86400,
        Math.max(60, Math.round(settingNumber(settings, 'storage_signed_url_ttl_seconds', 3600))),
      );
      await client.presignedGetObject(bucket, testObjectKey, ttl).catch(() => undefined);
      details.push(`签名 URL 配置已读取：${ttl} 秒`);
    }
    await client.removeObject(bucket, testObjectKey);
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
        const Minio = (await import('minio')).default;
        const client = new Minio.Client({
          endPoint: parsedEndpoint.endPoint,
          port: parsedEndpoint.port,
          useSSL: parsedEndpoint.useSSL,
          accessKey,
          secretKey,
          region: region || undefined,
          pathStyle: settingBoolean(settings, 'storage_force_path_style', false),
        });
        await client.removeObject(bucket, testObjectKey);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}
