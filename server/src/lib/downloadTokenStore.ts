import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.js';
import { getSetting } from './settings.js';
const PROTECTED_RESOURCE_TOKEN_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const RECORD_MARK_SUFFIX = '.recorded';

const modelTokenDir = join(resolve(process.cwd(), config.uploadDir), '.download_tokens', 'models');
const resourceTokenDir = join(resolve(process.cwd(), config.uploadDir), '.download_tokens', 'resources');
let lastModelCleanupAt = 0;
let lastResourceCleanupAt = 0;

export interface ModelDownloadTokenPayload {
  modelId: string;
  format: string;
  userId?: string;
  expiresAt: number;
}

interface ExpiringTokenPayload {
  expiresAt: number;
}

interface CreatedStoredToken {
  token: string;
  expiresAt: number;
}

export type ProtectedResourceType =
  | 'model-drawing'
  | 'ticket-attachment'
  | 'inquiry-attachment'
  | 'batch-download'
  | 'backup-download'
  | 'share-access';

export interface ProtectedResourceTokenPayload {
  type: ProtectedResourceType;
  resourceId: string;
  userId: string;
  role?: string;
  expiresAt: number;
  singleUse: boolean;
}

export type CreatedModelDownloadToken = CreatedStoredToken;

export type CreatedProtectedResourceToken = CreatedStoredToken;

function ensureTokenDirectory(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function tokenFilePath(dir: string, token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  return join(dir, token);
}

function isPayload(value: unknown): value is ModelDownloadTokenPayload {
  const payload = value as Partial<ModelDownloadTokenPayload> | null;
  return Boolean(
    payload &&
    typeof payload.modelId === 'string' &&
    typeof payload.format === 'string' &&
    typeof payload.expiresAt === 'number',
  );
}

function isResourcePayload(value: unknown): value is ProtectedResourceTokenPayload {
  const payload = value as Partial<ProtectedResourceTokenPayload> | null;
  return Boolean(
    payload &&
    (payload.type === 'model-drawing' ||
      payload.type === 'ticket-attachment' ||
      payload.type === 'inquiry-attachment' ||
      payload.type === 'batch-download' ||
      payload.type === 'backup-download' ||
      payload.type === 'share-access') &&
    typeof payload.resourceId === 'string' &&
    typeof payload.userId === 'string' &&
    typeof payload.expiresAt === 'number' &&
    typeof payload.singleUse === 'boolean',
  );
}

interface RecordMarkPayload {
  expiresAt: number;
}

function isRecordMarkPayload(value: unknown): value is RecordMarkPayload {
  const mark = value as Partial<RecordMarkPayload> | null;
  return Boolean(mark && typeof mark.expiresAt === 'number');
}

function readJsonPayload<T>(path: string, guard: (value: unknown) => value is T): T | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readPayload(path: string): ModelDownloadTokenPayload | null {
  return readJsonPayload(path, isPayload);
}

function readResourcePayload(path: string): ProtectedResourceTokenPayload | null {
  return readJsonPayload(path, isResourcePayload);
}

function cleanupExpiredTokenFiles<T extends ExpiringTokenPayload>(
  dir: string,
  lastCleanupAt: number,
  read: (path: string) => T | null,
): number {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return lastCleanupAt;
  try {
    ensureTokenDirectory(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(dir, entry.name);
      // 打点去重标记：自身携带 expiresAt（与令牌同寿命），过期/损坏即清理
      if (entry.name.endsWith(RECORD_MARK_SUFFIX)) {
        const mark = readJsonPayload(path, isRecordMarkPayload);
        if (!mark || mark.expiresAt <= now) rmSync(path, { force: true });
        continue;
      }
      if (!TOKEN_PATTERN.test(entry.name)) continue;
      const payload = read(path);
      if (!payload || payload.expiresAt <= now) {
        rmSync(path, { force: true });
      }
    }
  } catch {
    // Cleanup is best-effort; create/consume paths still validate expiry.
  }
  return now;
}

function createTokenFile<T extends ExpiringTokenPayload>(
  dir: string,
  payloadFactory: () => T,
  errorMessage: string,
): CreatedStoredToken {
  ensureTokenDirectory(dir);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString('base64url');
    const payload = payloadFactory();
    const path = tokenFilePath(dir, token);
    if (!path) continue;
    try {
      writeFileSync(path, JSON.stringify(payload), { flag: 'wx', mode: 0o600 });
      return { token, expiresAt: payload.expiresAt };
    } catch {
      // Extremely unlikely token collision; retry with a new random token.
    }
  }

  throw new Error(errorMessage);
}

function claimTokenFile(dir: string, token: string): string | null {
  const path = tokenFilePath(dir, token);
  if (!path || !existsSync(path)) return null;

  ensureTokenDirectory(dir);
  const claimedPath = `${path}.${process.pid}.${Date.now()}.used`;
  try {
    renameSync(path, claimedPath);
    return claimedPath;
  } catch {
    return null;
  }
}

function consumeTokenFile<T>(
  dir: string,
  token: string,
  read: (path: string) => T | null,
  validate: (payload: T | null) => T | null,
): T | null {
  const claimedPath = claimTokenFile(dir, token);
  if (!claimedPath) return null;

  try {
    return validate(read(claimedPath));
  } finally {
    rmSync(claimedPath, { force: true });
  }
}

function verifyTokenFile<T extends ExpiringTokenPayload>(
  dir: string,
  token: string,
  read: (path: string) => T | null,
  validate: (payload: T | null) => T | null,
): T | null {
  const path = tokenFilePath(dir, token);
  if (!path || !existsSync(path)) return null;

  const payload = read(path);
  const valid = validate(payload);
  if (!valid && payload?.expiresAt && payload.expiresAt <= Date.now()) {
    rmSync(path, { force: true });
  }
  return valid;
}

export async function createModelDownloadToken(input: {
  modelId: string;
  format?: string;
  userId?: string;
}): Promise<CreatedModelDownloadToken> {
  lastModelCleanupAt = cleanupExpiredTokenFiles(modelTokenDir, lastModelCleanupAt, readPayload);
  const ttlMinutes = (await getSetting<number>('download_token_ttl_minutes')) || 5;
  return createTokenFile(
    modelTokenDir,
    () => {
      const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
      return {
        modelId: input.modelId,
        format: input.format || 'original',
        userId: input.userId,
        expiresAt,
      };
    },
    '无法创建下载令牌',
  );
}

export function createProtectedResourceToken(input: {
  type: ProtectedResourceType;
  resourceId: string;
  userId: string;
  role?: string;
  ttlMs?: number;
  singleUse?: boolean;
}): CreatedProtectedResourceToken {
  lastResourceCleanupAt = cleanupExpiredTokenFiles(resourceTokenDir, lastResourceCleanupAt, readResourcePayload);
  return createTokenFile(
    resourceTokenDir,
    () => {
      const expiresAt = Date.now() + (input.ttlMs || PROTECTED_RESOURCE_TOKEN_TTL_MS);
      return {
        type: input.type,
        resourceId: input.resourceId,
        userId: input.userId,
        role: input.role,
        expiresAt,
        singleUse: input.singleUse !== false,
      };
    },
    '无法创建资源访问令牌',
  );
}

function validateResourcePayload(
  payload: ProtectedResourceTokenPayload | null,
  type: ProtectedResourceType,
  resourceId: string,
): ProtectedResourceTokenPayload | null {
  if (!payload || payload.expiresAt <= Date.now()) return null;
  if (payload.type !== type || payload.resourceId !== resourceId) return null;
  return payload;
}

export function consumeProtectedResourceToken(
  token: string,
  type: ProtectedResourceType,
  resourceId: string,
): ProtectedResourceTokenPayload | null {
  return consumeTokenFile(resourceTokenDir, token, readResourcePayload, (payload) =>
    validateResourcePayload(payload, type, resourceId),
  );
}

export function verifyProtectedResourceToken(
  token: string,
  type: ProtectedResourceType,
  resourceId: string,
): ProtectedResourceTokenPayload | null {
  return verifyTokenFile(resourceTokenDir, token, readResourcePayload, (payload) =>
    validateResourcePayload(payload, type, resourceId),
  );
}

export function verifyModelDownloadToken(token: string): ModelDownloadTokenPayload | null {
  return verifyTokenFile(modelTokenDir, token, readPayload, (payload) => {
    if (!payload || payload.expiresAt <= Date.now()) return null;
    return payload;
  });
}

/**
 * 模型下载打点去重标记。华为/鸿蒙等浏览器把附件下载交给系统下载管理器，同一次下载会
 * 对原 URL 发起多次请求（重拉 / 分段 Range 续传），因此模型下载令牌与图纸/备份令牌一致
 * 改为 TTL 内可复用（verify 而非 consume）——但下载打点（计数+通知+每日限额）每次用户
 * 操作只能记一次。用 wx 原子创建的标记文件判定「第一个到达的请求」：赢得标记的请求走
 * 打点，同令牌的后续请求跳过打点直接出流。标记与令牌同 TTL，由清理任务回收。
 */
export function claimModelDownloadRecordMark(token: string, expiresAt: number): boolean {
  const path = tokenFilePath(modelTokenDir, token);
  if (!path || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  ensureTokenDirectory(modelTokenDir);
  try {
    writeFileSync(`${path}${RECORD_MARK_SUFFIX}`, JSON.stringify({ expiresAt }), { flag: 'wx', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** 回收打点标记：每日限额拒绝时必须归还，否则同令牌的后续请求会因「已打点」跳过限额
 *  检查而直接放行出流（首请求 429、重试反而成功的限额绕过）。 */
export function releaseModelDownloadRecordMark(token: string): void {
  const path = tokenFilePath(modelTokenDir, token);
  if (!path) return;
  try {
    rmSync(`${path}${RECORD_MARK_SUFFIX}`, { force: true });
  } catch {
    // Best-effort; expired marks are reclaimed by the cleanup sweep anyway.
  }
}
