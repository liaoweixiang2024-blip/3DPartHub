import { execFileSync, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  statSync,
  statfsSync,
  readdirSync,
  readFileSync,
  renameSync,
  openSync,
  closeSync,
  writeSync,
  readSync,
  createReadStream,
  createWriteStream,
  copyFileSync,
  cpSync,
  symlinkSync,
} from 'fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  isIgnoredFileName,
  normalizeArchiveEntryLine,
  normalizeBackupArchiveEntryList,
  isUnsafeBackupArchiveEntry,
  isUnsafeBackupArchiveVerboseEntry,
  summarizeTarVerboseLine,
} from './backup/archiveSafety.js';
import {
  BACKUP_ENCRYPTION_ALGORITHM,
  encryptBackupArchiveInPlace,
  getBackupEncryptionStatus,
  isEncryptedBackupArchiveFile,
  materializeReadableBackupArchive,
} from './backup/encryption.js';
import type { BackupEncryptionStatus } from './backup/encryption.js';
import { config } from './config.js';
// 备份加密功能已抽到 ./backup/encryption.ts，这里再导出保持公共 API 不变（调用方零改动）
export {
  BACKUP_ENCRYPTION_ALGORITHM,
  encryptBackupArchiveInPlace,
  getBackupEncryptionStatus,
  isEncryptedBackupArchiveFile,
  materializeReadableBackupArchive,
} from './backup/encryption.js';
export type { BackupEncryptionStatus } from './backup/encryption.js';
export {
  normalizeBackupArchiveEntryList,
  isUnsafeBackupArchiveEntry,
  isUnsafeBackupArchiveVerboseEntry,
} from './backup/archiveSafety.js';
import { getErrorMessage } from './http.js';
import { syncJob, loadJob } from './jobStore.js';
import { createLogger } from './logger.js';

const log = createLogger({ component: 'backup' });

type RestoreTransaction = Prisma.TransactionClient;
type CreateManyDelegate = {
  createMany(args: { data: Record<string, unknown>[] }): Promise<unknown>;
};

let _backupPrisma: PrismaClient | null = null;
async function getBackupPrisma(): Promise<PrismaClient> {
  if (!_backupPrisma) {
    const { PrismaClient } = await import('@prisma/client');
    _backupPrisma = new PrismaClient();
  }
  return _backupPrisma;
}

const WORKER_ENV_BLOCKLIST = new Set(['SMTP_PASS', 'smtp_pass', 'ADMIN_PASS', 'MINIO_SECRET_KEY']);

function sanitizeWorkerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (WORKER_ENV_BLOCKLIST.has(key)) delete env[key];
  }
  return env;
}

const workerEnv = sanitizeWorkerEnv();

// Read app version from package.json
let _appVersion: string | null = null;
function getAppVersion(): string {
  if (_appVersion) return _appVersion;
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    _appVersion = pkg.version || 'unknown';
  } catch {
    log.warn({ err: {} }, 'Failed to read package.json for app version');
    _appVersion = 'unknown';
  }
  return _appVersion!;
}

function copyDirectoryContents(source: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    cpSync(join(source, entry.name), join(destination, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

function stripBackupArchiveExtension(name: string): string {
  return name.replace(/\.tar\.gz$/i, '').replace(/\.tgz$/i, '');
}

function assertDirectoryContainsNoSymlinks(root: string, label = root) {
  if (!existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`备份源目录包含符号链接，已中止以避免越界打包: ${label} -> ${fullPath}`);
      }
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
}

function stageStaticDirsForArchiveRoot(archiveRoot: string, staticDir: string, dirs: string[]) {
  for (const dir of dirs) {
    const source = join(staticDir, dir);
    const destination = join(archiveRoot, dir);
    assertTarEntrySource(staticDir, dir);
    rmSync(destination, { recursive: true, force: true });
    try {
      symlinkSync(source, destination, 'dir');
    } catch (err) {
      log.warn({ err, source, destination }, 'Failed to symlink backup source directory, copying instead');
      cpSync(source, destination, { recursive: true, force: true, dereference: true });
    }
  }
}

const DB_URL = config.databaseUrl;
// Strip Prisma-specific query params that pg_dump/psql don't understand, preserving SSL params
function stripPrismaParams(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('connection_limit');
    u.searchParams.delete('pool_timeout');
    return u.toString();
  } catch {
    log.warn({ err: {} }, 'Failed to parse database URL, stripping query params by regex');
    return url.replace(/\?.*/, '');
  }
}
const DB_URL_CLEAN = stripPrismaParams(DB_URL);
// Prefer static/backups (bind-mount in Docker → host disk space) over uploads/backups (named volume → limited space)
const ACTIVE_BACKUP_DIR = join(process.cwd(), config.staticDir, 'backups');
const LEGACY_BACKUP_DIR = join(process.cwd(), config.uploadDir, 'backups');
const BACKUP_DIRS = Array.from(new Set([ACTIVE_BACKUP_DIR, LEGACY_BACKUP_DIR]));
const BACKUP_WORK_DIR = join(ACTIVE_BACKUP_DIR, '.work');
const SAFETY_SNAPSHOT_DIR = join(ACTIVE_BACKUP_DIR, '_safety_snapshots');
const BACKUP_DB_ENTRY_DIR = '_backup_db';
const BACKUP_DATABASE_ENTRY = `${BACKUP_DB_ENTRY_DIR}/database.sql`;
const BACKUP_META_ENTRY = `${BACKUP_DB_ENTRY_DIR}/meta.json`;
const BACKUP_MANIFEST_ENTRY = `${BACKUP_DB_ENTRY_DIR}/manifest.json`;
const MODULE_BACKUP_DATA_ENTRY = `${BACKUP_DB_ENTRY_DIR}/module-data.json`;
const MODULE_BACKUP_SCHEMA_VERSION = 'module-1.0';
const BACKUP_UPLOAD_METADATA_ENTRY = `${BACKUP_DB_ENTRY_DIR}/metadata`;
const BACKUP_UPLOADS_ENTRY = `${BACKUP_DB_ENTRY_DIR}/uploads`;
const STATIC_BACKUP_EXCLUDE_DIRS = new Set(['backups', BACKUP_DB_ENTRY_DIR, '_safety_snapshots']);
const UPLOAD_BACKUP_EXCLUDE_DIRS = new Set(['backups', 'chunks', 'batch', '.download_tokens']);
const RESTORE_PRIORITY_DIRS = ['models', 'thumbnails', 'originals', 'drawings'];
const MODULE_EXT = import.meta.url.endsWith('.ts') ? '.ts' : '.js';

// Detect whether pg_dump/psql are available locally, otherwise use docker exec
let dockerContainerChecked = false;
let _dockerContainer: string | null = null;
function getDockerContainer(): string | null {
  if (dockerContainerChecked) return _dockerContainer;
  dockerContainerChecked = true;
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'pipe', timeout: 5000 });
    _dockerContainer = null;
    return null;
  } catch {
    // pg_dump not found locally — try docker
    log.info('pg_dump not found locally, falling back to docker');
    try {
      const containers = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { stdio: 'pipe', timeout: 5000 })
        .toString()
        .trim()
        .split('\n');
      let container = containers.find((c) => c.includes('postgres'));
      if (container) {
        container = container.trim();
        log.info({ container }, 'pg_dump not found locally, using docker exec');
        _dockerContainer = container;
        return container;
      }
    } catch {
      log.info('Docker not available either, backup/restore will not be possible');
    }
    _dockerContainer = null;
    return null;
  }
}

/** pg_dump to file — works with local install or Docker container */
function pgDumpToFile(dbUrl: string, outputPath: string, extraArgs: string[], timeout: number) {
  const container = getDockerContainer();
  const outputFd = openSync(outputPath, 'w');
  try {
    if (container) {
      const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
      const user = new URL(dbUrl).username;
      execFileSync('docker', ['exec', container, 'pg_dump', '-U', user, '-d', dbName, ...extraArgs], {
        stdio: ['ignore', outputFd, 'pipe'],
        timeout,
      });
      return;
    }
    const url = new URL(dbUrl);
    const env = { ...process.env, PGPASSWORD: url.password };
    execFileSync(
      'pg_dump',
      [
        '-U',
        url.username,
        '-d',
        url.pathname.replace(/^\//, ''),
        '-h',
        url.hostname,
        '-p',
        url.port || '5432',
        ...extraArgs,
      ],
      {
        stdio: ['ignore', outputFd, 'pipe'],
        timeout,
        env,
      },
    );
  } finally {
    closeSync(outputFd);
  }
}

/** psql with -f flag — works with local install or Docker container */
function psqlFromFile(dbUrl: string, sqlPath: string, extraArgs: string[], timeout: number) {
  const container = getDockerContainer();
  if (container) {
    // Copy SQL file into container, run psql, clean up
    const containerPath = `/tmp/restore_${Date.now()}.sql`;
    const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
    const user = new URL(dbUrl).username;
    execFileSync('docker', ['cp', sqlPath, `${container}:${containerPath}`], { stdio: 'pipe', timeout: 30000 });
    try {
      execFileSync('docker', ['exec', container, 'psql', '-U', user, '-d', dbName, ...extraArgs, '-f', containerPath], {
        stdio: 'pipe',
        timeout,
      });
    } finally {
      try {
        execFileSync('docker', ['exec', container, 'rm', '-f', containerPath], { stdio: 'pipe' });
      } catch {
        log.warn({ containerPath }, 'Failed to clean up temporary SQL file in docker container');
      }
    }
  } else {
    const url = new URL(dbUrl);
    const env = { ...process.env, PGPASSWORD: url.password };
    execFileSync(
      'psql',
      [
        '-U',
        url.username,
        '-d',
        url.pathname.replace(/^\//, ''),
        '-h',
        url.hostname,
        '-p',
        url.port || '5432',
        ...extraArgs,
        '-f',
        sqlPath,
      ],
      { stdio: 'pipe', timeout, env },
    );
  }
}

/** psql with -c flag — works with local install or Docker container */
function psqlCommand(dbUrl: string, sql: string, extraArgs: string[], timeout: number) {
  const container = getDockerContainer();
  if (container) {
    const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
    const user = new URL(dbUrl).username;
    execFileSync('docker', ['exec', container, 'psql', '-U', user, '-d', dbName, ...extraArgs, '-c', sql], {
      stdio: 'pipe',
      timeout,
    });
  } else {
    execFileSync('psql', [dbUrl, ...extraArgs, '-c', sql], {
      stdio: 'pipe',
      timeout,
    });
  }
}

const PSQL_COMMAND_TIMEOUT_MS = 5 * 60_000;
const PRISMA_MIGRATE_TIMEOUT_MS = 10 * 60_000;
const DB_DUMP_TIMEOUT_MS = 60 * 60_000;
const DB_RESTORE_TIMEOUT_MS = 60 * 60_000;
const ARCHIVE_LIST_TIMEOUT_MS = 30 * 60_000;
const ARCHIVE_EXTRACT_TIMEOUT_MS = 60 * 60_000;
// 读清单需从归档头顺序解压到 manifest 条目（_backup_db 里 database.sql 可能很大），
// 大库 + 慢盘/低配 CPU 下 5 分钟不够，提到 20 分钟避免误判超时。
const ARCHIVE_META_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_BACKUP_LOCK_STALE_MINUTES = 12 * 60;
const BACKUP_LOCK_STALE_MS = (() => {
  const raw = Number(process.env.BACKUP_LOCK_STALE_MINUTES);
  const minutes = Number.isFinite(raw) ? raw : DEFAULT_BACKUP_LOCK_STALE_MINUTES;
  return Math.min(7 * 24 * 60, Math.max(30, Math.floor(minutes))) * 60_000;
})();
const BACKUP_LOCK_KEEPALIVE_MS = Math.min(60_000, Math.max(10_000, Math.floor(BACKUP_LOCK_STALE_MS / 6)));
const ALLOW_FOREIGN_KEY_SKIP_RESTORE = /^(1|true|yes)$/i.test(process.env.BACKUP_RESTORE_ALLOW_FK_SKIP || '');
const STEP_EXTENSIONS = new Set(['.step', '.stp', '.iges', '.igs']);

export type BackupScope = 'full' | 'models' | 'selection' | 'product_wall' | 'config';

const BACKUP_SCOPE_LABELS: Record<BackupScope, string> = {
  full: '整站备份',
  models: '模型库',
  selection: '选型',
  product_wall: '产品图库',
  config: '系统配置',
};

const MODULE_BACKUP_STATIC_DIRS: Record<Exclude<BackupScope, 'full'>, string[]> = {
  models: ['models', 'thumbnails', 'originals', 'drawings'],
  selection: ['option-images', 'selection-assets', 'selection-categories-ai'],
  product_wall: ['product-wall'],
  config: ['logo', 'favicon', 'watermark'],
};

export const MODULE_BACKUP_TABLE_KEYS: Record<Exclude<BackupScope, 'full'>, readonly string[]> = {
  models: ['categories', 'modelGroups', 'models', 'modelVersions', 'favorites', 'downloads', 'comments', 'shareLinks'],
  selection: ['selectionCategories', 'selectionProducts', 'threadSizeEntries', 'selectionShares'],
  product_wall: ['productWallCategories', 'productWallImages', 'productWallImageFavorites'],
  config: ['settings', 'categories'],
};

export function normalizeBackupScope(value: unknown): BackupScope {
  if (value === 'models' || value === 'selection' || value === 'product_wall' || value === 'config') return value;
  return 'full';
}

function backupScopeLabel(scope: BackupScope): string {
  return BACKUP_SCOPE_LABELS[scope] || BACKUP_SCOPE_LABELS.full;
}

function isModuleBackupScope(scope: BackupScope): scope is Exclude<BackupScope, 'full'> {
  return scope !== 'full';
}

async function withReadableBackupArchive<T>(archive: string, fn: (archivePath: string) => Promise<T>): Promise<T> {
  if (!isEncryptedBackupArchiveFile(archive)) return fn(archive);
  const tmpDir = prepareWorkDir(`decrypt_${Date.now()}_${randomBytes(4).toString('hex')}`);
  try {
    const readableArchive = await materializeReadableBackupArchive(archive, tmpDir);
    return await fn(readableArchive);
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Ensure backup directories exist
for (const dir of BACKUP_DIRS) {
  mkdirSync(dir, { recursive: true });
  cleanupPartialArchives(dir);
}
mkdirSync(BACKUP_WORK_DIR, { recursive: true });

// ---- Backup record (stored as .json alongside .tar.gz) ----

export interface BackupRecord {
  id: string;
  filename: string;
  /** 宿主机侧归档路径（docker-compose bind mount：./server/<staticDir>/backups），仅供后台展示定位用 */
  filePath?: string;
  name: string;
  scope?: BackupScope;
  scopeLabel?: string;
  createdAt: string;
  fileSize: number;
  fileSizeText: string;
  modelCount: number;
  thumbnailCount: number;
  dbSize: string;
  countMode?: 'step_models';
  archiveSha256?: string;
  archiveSignature?: string;
  encrypted?: boolean;
  encryptionAlgorithm?: string;
  manifestVersion?: string;
  verifiedAt?: string;
}

interface BackupManifestDirectory {
  path: string;
  fileCount: number;
  totalBytes: number;
}

interface ArchiveDirectorySpec {
  path: string;
  source: string;
}

interface BackupManifest {
  schemaVersion: string;
  backupId: string;
  generatedAt: string;
  appVersion: string;
  database: {
    path: typeof BACKUP_DATABASE_ENTRY;
    size: number;
    sha256: string;
  };
  directories: BackupManifestDirectory[];
  requiredEntries: string[];
}

interface ModuleBackupManifest {
  schemaVersion: typeof MODULE_BACKUP_SCHEMA_VERSION;
  backupId: string;
  generatedAt: string;
  appVersion: string;
  scope: Exclude<BackupScope, 'full'>;
  data: {
    path: typeof MODULE_BACKUP_DATA_ENTRY;
    size: number;
    sha256: string;
  };
  directories: BackupManifestDirectory[];
  requiredEntries: string[];
}

interface ModuleBackupPayload {
  schemaVersion: typeof MODULE_BACKUP_SCHEMA_VERSION;
  scope: Exclude<BackupScope, 'full'>;
  generatedAt: string;
  appVersion: string;
  tables: Record<string, unknown[]>;
}

const SAFE_BACKUP_ID_RE = /^[a-zA-Z0-9_\-.:]+$/;

function buildMetaPath(baseDir: string, id: string) {
  if (!SAFE_BACKUP_ID_RE.test(id) || id.includes('..')) throw new Error(`Invalid backup ID: ${id}`);
  return join(baseDir, `${id}.json`);
}
function buildArchivePath(baseDir: string, id: string) {
  if (!SAFE_BACKUP_ID_RE.test(id) || id.includes('..')) throw new Error(`Invalid backup ID: ${id}`);
  return join(baseDir, `${id}.tar.gz`);
}

function resolveBackupDir(id: string): string | null {
  for (const dir of BACKUP_DIRS) {
    if (existsSync(buildArchivePath(dir, id))) return dir;
  }
  for (const dir of BACKUP_DIRS) {
    if (existsSync(buildMetaPath(dir, id))) return dir;
  }
  return null;
}

function activeMetaPath(id: string) {
  return buildMetaPath(ACTIVE_BACKUP_DIR, id);
}
function activeArchivePath(id: string) {
  return buildArchivePath(ACTIVE_BACKUP_DIR, id);
}
function metaPath(id: string) {
  return buildMetaPath(resolveBackupDir(id) ?? ACTIVE_BACKUP_DIR, id);
}
function archivePath(id: string) {
  return buildArchivePath(resolveBackupDir(id) ?? ACTIVE_BACKUP_DIR, id);
}

// 宿主机侧归档路径，镜像 docker-compose 的 bind mount（见 docker-compose.yml）：
//   ./server/<staticDir>/backups  <->  <cwd>/<staticDir>/backups
// 仅供后台「备份记录」展示，方便运维在宿主机上定位/复制备份文件。
function hostBackupFilePath(filename: string): string {
  return join('server', config.staticDir, 'backups', filename);
}

function isStepFileName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const ext of STEP_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

// ---- Progress tracking ----

interface BackupJob {
  id: string;
  stage: 'dumping' | 'packing' | 'saving' | 'done' | 'error';
  percent: number;
  message: string;
  error?: string;
  logs: string[];
  source?: 'manual' | 'scheduled';
  scope?: BackupScope;
}

export interface BackupHealth {
  enabled: boolean;
  scheduleTime: string;
  retentionCount: number;
  mirrorEnabled: boolean;
  mirrorDir?: string;
  status: 'ok' | 'warning' | 'disabled' | 'empty';
  message: string;
  backupCount: number;
  totalSize: number;
  totalSizeText: string;
  latestBackup?: BackupRecord;
  nextRunAt?: string;
  lastAutoStatus?: string;
  lastAutoMessage?: string;
  lastAutoAt?: string;
  lastAutoJobId?: string;
  lastMirrorStatus?: string;
  lastMirrorMessage?: string;
  lastMirrorAt?: string;
  encryption: BackupEncryptionStatus;
}

export interface BackupPolicyCheckItem {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
}

export interface BackupPolicyReportFinding {
  key: string;
  label: string;
  message: string;
}

export interface BackupPolicyReport {
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
  blockers: BackupPolicyReportFinding[];
  warnings: BackupPolicyReportFinding[];
  nextActions: string[];
}

export interface BackupPolicyCheck {
  status: 'ok' | 'warning' | 'error';
  checkedAt: string;
  estimatedBackupSize: number;
  estimatedBackupSizeText: string;
  checks: BackupPolicyCheckItem[];
  report: BackupPolicyReport;
}

export interface BackupStats {
  modelCount: number;
  thumbnailCount: number;
  dbSize: string;
  dbSizeBytes: number;
  totalModelCount: number;
  modelGroupCount: number;
  categoryCount: number;
  settingsCount: number;
  originalFileCount: number;
  drawingFileCount: number;
  modelResourceFileCount: number;
  modelResourceSize: number;
  modelResourceSizeText: string;
  selectionCategoryCount: number;
  selectionProductCount: number;
  threadSizeCount: number;
  selectionResourceFileCount: number;
  selectionResourceSize: number;
  selectionResourceSizeText: string;
  productWallCategoryCount: number;
  productWallImageCount: number;
  productWallResourceFileCount: number;
  productWallResourceSize: number;
  productWallResourceSizeText: string;
  uploadResourceFileCount: number;
  uploadResourceSize: number;
  uploadResourceSizeText: string;
  resourceFileCount: number;
  resourceSize: number;
  resourceSizeText: string;
  totalDataSize: number;
  totalDataSizeText: string;
}

export interface BackupVerificationResult {
  id: string;
  ok: boolean;
  checkedAt: string;
  fileSize: number;
  fileSizeText: string;
  manifestVersion?: string;
  archiveSha256?: string;
  archiveSignature?: string;
  encrypted?: boolean;
  encryptionAlgorithm?: string;
  message: string;
}

interface VerifyJob {
  id: string;
  backupId: string;
  userId?: string | null;
  stage: 'queued' | 'validating_archive' | 'hashing_archive' | 'writing_record' | 'done' | 'error';
  percent: number;
  message: string;
  error?: string;
  result?: BackupVerificationResult;
  logs: string[];
}

interface RestoreJob {
  id: string;
  userId?: string | null;
  source?: 'backup-record' | 'import-file';
  backupId?: string | null;
  stage: 'extracting' | 'restoring_db' | 'restoring_files' | 'done' | 'error';
  percent: number;
  message: string;
  error?: string;
  /** 已进入不可安全取消的阶段（数据库 schema 重置），为 true 时禁止取消 */
  destructiveStarted?: boolean;
  /** 用户手动取消（与失败区分，前端展示用） */
  cancelled?: boolean;
  /** 跨服务器迁移强制恢复：跳过 HMAC 签名校验（仍校验文件完整性 SHA256） */
  force?: boolean;
  result?: {
    dbRestored: boolean;
    modelCount: number;
    thumbnailCount: number;
    scope?: BackupScope;
    scopeLabel?: string;
    itemCount?: number;
    fileCount?: number;
  };
  logs: string[];
}

const jobs = new Map<string, BackupJob>();
const restoreJobs = new Map<string, RestoreJob>();
const verifyJobs = new Map<string, VerifyJob>();
const pendingRecordNormalizations = new Set<string>();

const JOB_EVICTION_MS = 60 * 60 * 1000;

export function evictCompleted<K, V extends { stage: string; updatedAt?: number }>(map: Map<K, V>): void {
  const now = Date.now();
  for (const [key, job] of map) {
    if ((job.stage === 'done' || job.stage === 'error') && (!job.updatedAt || now - job.updatedAt > JOB_EVICTION_MS)) {
      map.delete(key);
    }
  }
}

// File-based lock to prevent concurrent backup/restore across cluster workers
const LOCK_FILE = join(process.cwd(), config.uploadDir, '.backup_restore.lock');
function lockOwnerIsAlive(): boolean {
  try {
    const raw = readFileSync(LOCK_FILE, 'utf-8').trim();
    const pid = Number(raw.split(/\r?\n/)[0]);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ESRCH' || code === 'ENOENT') return false;
    // EPERM means a process exists but is not signalable by this user.
    return code === 'EPERM';
  }
}

function lockContent(pid: number, jobId?: string, source?: 'manual' | 'scheduled'): string {
  return (
    [String(pid), new Date().toISOString(), jobId ? `jobId=${jobId}` : '', source ? `source=${source}` : '']
      .filter(Boolean)
      .join('\n') + '\n'
  );
}

function getActiveLockJobId(): string | undefined {
  try {
    const raw = readFileSync(LOCK_FILE, 'utf-8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('jobId='))
      ?.slice('jobId='.length);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn({ err }, 'Failed to read active lock job ID');
    }
    return undefined;
  }
}

function setLockOwner(pid: number, jobId: string, source: 'manual' | 'scheduled'): void {
  writeFileSync(LOCK_FILE, lockContent(pid, jobId, source));
}

function startLockKeepAlive(jobId: string, source: 'manual' | 'scheduled' = 'manual'): () => void {
  setLockOwner(process.pid, jobId, source);
  const timer = setInterval(() => {
    if (getActiveLockJobId() === jobId) {
      setLockOwner(process.pid, jobId, source);
    }
  }, BACKUP_LOCK_KEEPALIVE_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

function acquireLock(): boolean {
  try {
    const fd = openSync(LOCK_FILE, 'wx');
    writeSync(fd, lockContent(process.pid));
    closeSync(fd);
    return true;
  } catch {
    // Lock file exists — check if the owner is gone or the keepalive has stopped.
    try {
      const { mtime } = statSync(LOCK_FILE);
      const ageMs = Date.now() - mtime.getTime();
      if (!lockOwnerIsAlive() || ageMs > BACKUP_LOCK_STALE_MS) {
        log.warn({ ageMs, staleAfterMs: BACKUP_LOCK_STALE_MS }, 'Removing stale backup lock');
        rmSync(LOCK_FILE, { force: true });
        return acquireLock();
      }
    } catch {
      log.warn({ err: {} }, 'Failed to check stale lock file status');
    }
    return false;
  }
}
function releaseLock(): void {
  try {
    rmSync(LOCK_FILE, { force: true });
  } catch {
    log.warn({ err: {} }, 'Failed to release backup lock file');
  }
}

function releaseLockForJob(jobId: string): void {
  if (getActiveLockJobId() === jobId) releaseLock();
}

cleanupStaleBackupWorkDirs(BACKUP_WORK_DIR);

function ts(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

const MAX_LOG_LINES = 200;

function addLog(job: { id?: string; logs?: string[] }, text: string) {
  if (!job.logs) return;
  job.logs.push(`[${ts()}] ${text}`);
  if (job.logs.length > MAX_LOG_LINES) {
    job.logs = job.logs.slice(-MAX_LOG_LINES);
  }
  log.info(text);
  if (job.id) syncJob({ ...job, id: job.id });
}

function addLogStart(job: { id?: string; logs?: string[] }, text: string): number {
  addLog(job, text);
  return Date.now();
}

function addLogEnd(job: { id?: string; logs?: string[] }, startTime: number, text: string) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  addLog(job, `${text}（耗时 ${elapsed}s）`);
}

async function recordBackupAudit(input: {
  action: string;
  userId?: string | null;
  resourceId?: string | null;
  details: Record<string, unknown>;
}) {
  try {
    const prismaClient = await getBackupPrisma();
    await prismaClient.auditLog.create({
      data: {
        userId: input.userId || null,
        action: input.action,
        resource: 'backup',
        resourceId: input.resourceId || null,
        details: {
          ...input.details,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    log.warn({ err, action: input.action, resourceId: input.resourceId }, 'Failed to write backup audit log');
  }
}

type MonitoredWorkerJob = {
  id: string;
  stage: string;
  message: string;
  error?: string;
  logs?: string[];
};

function markWorkerExitIfStillRunning<T extends MonitoredWorkerJob>(job: T, message: string) {
  const latest = loadJob<T>(job.id) || job;
  if (latest.stage === 'done' || latest.stage === 'error') return;
  latest.stage = 'error';
  latest.error = message;
  latest.message = message;
  addLog(latest, message);
  syncJob(latest);
  releaseLockForJob(job.id);
}

function monitorWorkerExit<T extends MonitoredWorkerJob>(child: ChildProcess, job: T, label: string) {
  child.once('error', (err) => {
    markWorkerExitIfStillRunning(job, `${label}后台进程启动失败: ${err.message}`);
  });
  child.once('exit', (code, signal) => {
    setTimeout(() => {
      const detail = signal ? `signal=${signal}` : `code=${code ?? 'unknown'}`;
      const message =
        code === 0 && !signal
          ? `${label}后台进程已退出，但任务未写入完成状态，请重试`
          : `${label}后台进程异常退出（${detail}），请查看服务端日志后重试`;
      markWorkerExitIfStillRunning(job, message);
    }, 1000);
  });
}

function latestPersistedJob<T extends { id: string }>(job: T): T {
  return loadJob<T>(job.id) || job;
}

export function getJob(id: string): BackupJob | undefined {
  const persisted = loadJob<BackupJob>(id);
  if (persisted) {
    jobs.set(id, persisted);
    return persisted;
  }
  return jobs.get(id);
}

export function getActiveBackupJob(): BackupJob | undefined {
  evictCompleted(jobs);
  for (const current of jobs.values()) {
    const job = latestPersistedJob(current);
    jobs.set(job.id, job);
    if (job.stage !== 'done' && job.stage !== 'error') return job;
  }
  const lockedJobId = getActiveLockJobId();
  if (lockedJobId?.startsWith('backup_') && lockOwnerIsAlive()) {
    const job = loadJob<BackupJob>(lockedJobId);
    if (job && job.stage !== 'done' && job.stage !== 'error') return job;
    return {
      id: lockedJobId,
      stage: 'packing',
      percent: 35,
      message: '备份任务正在后台执行...',
      logs: [],
      source: 'manual',
    };
  }
  return undefined;
}

export function getRestoreJob(id: string): RestoreJob | undefined {
  const persisted = loadJob<RestoreJob>(id);
  if (persisted) {
    restoreJobs.set(id, persisted);
    return persisted;
  }
  return restoreJobs.get(id);
}

export function getVerifyJob(id: string): VerifyJob | undefined {
  const persisted = loadJob<VerifyJob>(id);
  if (persisted) {
    verifyJobs.set(id, persisted);
    return persisted;
  }
  return verifyJobs.get(id);
}

export function getActiveVerifyJob(): VerifyJob | undefined {
  evictCompleted(verifyJobs);
  for (const current of verifyJobs.values()) {
    const job = latestPersistedJob(current);
    verifyJobs.set(job.id, job);
    if (job.stage !== 'done' && job.stage !== 'error') return job;
  }
  const lockedJobId = getActiveLockJobId();
  if (lockedJobId?.startsWith('verify_') && lockOwnerIsAlive()) {
    const job = loadJob<VerifyJob>(lockedJobId);
    if (job && job.stage !== 'done' && job.stage !== 'error') return job;
  }
  return undefined;
}

export function getActiveRestoreJob(): RestoreJob | undefined {
  evictCompleted(restoreJobs);
  for (const current of restoreJobs.values()) {
    const job = latestPersistedJob(current);
    restoreJobs.set(job.id, job);
    if (job.stage !== 'done' && job.stage !== 'error') return job;
  }
  const lockedJobId = getActiveLockJobId();
  if (lockedJobId?.startsWith('restore_') && lockOwnerIsAlive()) {
    const job = loadJob<RestoreJob>(lockedJobId);
    if (job && job.stage !== 'done' && job.stage !== 'error') return job;
  }
  return undefined;
}

/**
 * 取消正在进行的恢复任务。仅在「数据库 schema 重置前」(destructiveStarted=false) 安全：
 * 此时只有 tar / pg_dump（只读）在跑，杀掉不影响现有数据。一旦进入 schema 重置则拒绝取消，
 * 避免留下不完整数据库。
 */
export function cancelRestoreJob(jobId: string): { cancelled: boolean; message: string } {
  const job = loadJob<RestoreJob>(jobId);
  if (!job) return { cancelled: false, message: '恢复任务不存在或已结束' };
  if (job.stage === 'done' || job.stage === 'error') {
    return { cancelled: false, message: job.cancelled ? '恢复任务已取消' : '恢复任务已结束，无需取消' };
  }
  if (job.destructiveStarted) {
    return {
      cancelled: false,
      message: '数据库恢复已开始（schema 已重置），无法安全取消；请等待完成或失败后从恢复前快照回滚',
    };
  }

  // 先 SIGKILL 整个进程组（worker 是 detached 进程组长，负 PID 连 tar/pg_dump 子进程一起立即终止），
  // 避免 worker 在死亡前再 syncJob 覆盖取消状态。预重置阶段仅 tar / pg_dump(只读) 在跑，杀掉安全。
  let killed = false;
  if (getActiveLockJobId() === jobId) {
    try {
      const raw = readFileSync(LOCK_FILE, 'utf-8').trim();
      const pid = Number(raw.split(/\r?\n/)[0]);
      if (pid) {
        try {
          process.kill(-pid, 'SIGKILL');
          killed = true;
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code === 'ESRCH')
            killed = true; // 进程已退出，视为已终止
          else log.warn({ err, pid, jobId }, '取消恢复：终止进程组失败');
        }
      }
    } catch {
      // 锁文件读取失败 — 忽略，继续标记取消
    }
  }

  // 清理该任务的临时工作目录
  try {
    const workDir = join(BACKUP_WORK_DIR, jobId);
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  } catch (err: unknown) {
    log.warn({ err, jobId }, '取消恢复：清理临时目录失败');
  }

  // 标记取消（stage=error 终态 + cancelled=true 供前端区分）。worker 已死不会再覆盖；
  // monitorWorkerExit 的 markWorkerExitIfStillRunning 见 stage 已终态会跳过，不覆盖取消状态。
  job.stage = 'error';
  job.cancelled = true;
  job.error = undefined;
  job.message = killed ? '已取消恢复，未修改任何数据' : '已取消恢复';
  addLog(job, '用户已手动取消恢复任务');
  syncJob(job);
  restoreJobs.set(job.id, job);
  releaseLockForJob(jobId);
  return { cancelled: true, message: job.message };
}

// ---- Import as backup record (save to backup list) ----

export async function saveAsBackupRecord(archPath: string, originalName: string): Promise<BackupRecord> {
  const id = `backup_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const dest = activeArchivePath(id);
  let archiveVerified = false;
  let recordWritten = false;

  try {
    try {
      renameSync(archPath, dest);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
      copyFileSync(archPath, dest);
      if (existsSync(archPath)) rmSync(archPath, { force: true });
    }

    const record = await inspectBackupArchive(id, dest, originalName);
    archiveVerified = true;
    const encrypted = await encryptBackupArchiveInPlace(dest);
    const archiveSha256 = await sha256File(dest);
    record.archiveSha256 = archiveSha256;
    record.archiveSignature = signBackupArchiveSha256(archiveSha256);
    record.encrypted = encrypted || isEncryptedBackupArchiveFile(dest);
    if (record.encrypted) record.encryptionAlgorithm = BACKUP_ENCRYPTION_ALGORITHM;
    record.verifiedAt = new Date().toISOString();
    writeFileSync(activeMetaPath(id), JSON.stringify(record, null, 2));
    recordWritten = true;
    return record;
  } catch (err: unknown) {
    if (!archiveVerified && existsSync(dest)) {
      rmSync(dest, { force: true });
    } else if (archiveVerified && existsSync(dest)) {
      log.warn({ err, id, path: dest }, 'Preserved verified imported backup archive after record write failure');
    }
    if (!recordWritten && existsSync(activeMetaPath(id))) rmSync(activeMetaPath(id), { force: true });
    throw err;
  }
}

// ---- Import save as async job ----

interface ImportSaveJob {
  id: string;
  stage:
    | 'verifying_archive'
    | 'reading_meta'
    | 'counting_models'
    | 'copying_archive'
    | 'writing_record'
    | 'done'
    | 'error';
  percent: number;
  message: string;
  error?: string;
  result?: BackupRecord;
  logs: string[];
}

const importSaveJobs = new Map<string, ImportSaveJob>();

export function startImportSaveJob(archPath: string, originalName: string): string {
  if (!acquireLock()) throw new Error('有备份、恢复、校验或导入任务正在进行中，请等待完成后再试');
  const jobId = `importsave_${Date.now()}`;
  const job: ImportSaveJob = {
    id: jobId,
    stage: 'verifying_archive',
    percent: 5,
    message: '正在校验备份文件...',
    logs: [],
  };
  importSaveJobs.set(jobId, job);
  syncJob(job);

  try {
    const workerScript = fileURLToPath(new URL(`../scripts/importSaveWorker${MODULE_EXT}`, import.meta.url));
    const child = spawn(process.execPath, [...process.execArgv, workerScript, jobId, archPath, originalName], {
      cwd: process.cwd(),
      env: workerEnv,
      detached: true,
      stdio: 'ignore',
    });
    if (!child.pid) throw new Error('备份导入保存后台进程启动失败');
    setLockOwner(child.pid, jobId, 'manual');
    monitorWorkerExit(child, job, '备份导入保存');
    child.unref();
  } catch (err: unknown) {
    const message = getErrorMessage(err) || '备份导入保存后台进程启动失败';
    job.stage = 'error';
    job.error = message;
    job.message = message;
    syncJob(job);
    releaseLock();
    throw err;
  }

  return jobId;
}

export async function runImportSaveWorker(jobId: string, archPath: string, originalName: string) {
  const stopLockKeepAlive = startLockKeepAlive(jobId);
  const job = loadJob<ImportSaveJob>(jobId) || {
    id: jobId,
    stage: 'verifying_archive',
    percent: 5,
    message: '正在校验备份文件...',
    logs: [],
  };
  importSaveJobs.set(job.id, job);
  syncJob(job);
  try {
    await runImportSave(job, archPath, originalName);
  } finally {
    stopLockKeepAlive();
    releaseLockForJob(job.id);
  }
}

async function runImportSave(job: ImportSaveJob, archPath: string, originalName: string) {
  try {
    addLog(job, `开始导入保存: ${originalName}`);

    // Stage 1: Verify archive
    job.stage = 'verifying_archive';
    job.percent = 10;
    job.message = '正在校验备份归档...';
    syncJob(job);
    if (!existsSync(archPath)) throw new Error('上传的备份文件不存在');
    const fileSize = statSync(archPath).size;
    addLog(job, `备份文件大小: ${formatSize(fileSize)}`);

    const tmpDir = prepareWorkDir(`peek_${job.id}`);
    try {
      const readableArchive = await materializeReadableBackupArchive(archPath, tmpDir);
      const entries = listArchiveEntries(readableArchive);
      if (entries.length === 0) throw new Error('备份归档内容为空');
      assertSafeArchiveEntriesForExtraction(readableArchive, entries);
      addLog(job, `归档包含 ${entries.length} 个条目`);

      // Stage 2: Read meta
      job.stage = 'reading_meta';
      job.percent = 20;
      job.message = '正在读取备份元数据...';
      syncJob(job);

      // Stage 3: Count models (async — uses streaming)
      job.stage = 'counting_models';
      job.percent = 30;
      job.message = '正在统计模型数量...';
      syncJob(job);
      try {
        const sqlPath = extractRestoreSqlPath(readableArchive, tmpDir);
        if (sqlPath) {
          const modelCount = await countStepModelsInSqlDump(sqlPath);
          if (modelCount > 0) addLog(job, `发现 ${modelCount} 个 STEP 模型`);
        }
      } catch {
        // Model counting is best-effort
        log.warn({ err: {} }, 'Model counting during import save failed (best-effort)');
      }
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }

    // Stage 4: Copy archive to backup storage
    job.stage = 'copying_archive';
    job.percent = 50;
    job.message = '正在保存备份文件...';
    addLog(job, '正在复制归档到备份存储...');
    syncJob(job);

    const record = await saveAsBackupRecord(archPath, originalName);

    // Stage 5: Write record
    job.stage = 'writing_record';
    job.percent = 90;
    job.message = '正在写入备份记录...';
    syncJob(job);

    addLog(job, `备份记录已保存: ${record.name}`);
    addLog(job, `${record.modelCount} 个模型, ${record.thumbnailCount} 张预览图, 数据库 ${record.dbSize}`);

    job.stage = 'done';
    job.percent = 100;
    job.message = '保存完成';
    job.result = record;
    syncJob(job);
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    job.stage = 'error';
    job.error = message;
    job.message = `保存失败: ${message}`;
    addLog(job, `保存失败: ${message}`);
    syncJob(job);
    if (existsSync(archPath)) rmSync(archPath, { force: true });
  }
}

export function getImportSaveJob(id: string): ImportSaveJob | undefined {
  const persisted = loadJob<ImportSaveJob>(id);
  if (persisted) {
    importSaveJobs.set(id, persisted);
    return persisted;
  }
  return importSaveJobs.get(id);
}

export function getActiveImportSaveJob(): ImportSaveJob | undefined {
  for (const current of importSaveJobs.values()) {
    const job = latestPersistedJob(current);
    importSaveJobs.set(job.id, job);
    if (job.stage !== 'done' && job.stage !== 'error') return job;
  }
  const lockedJobId = getActiveLockJobId();
  if (lockedJobId?.startsWith('importsave_') && lockOwnerIsAlive()) {
    const job = loadJob<ImportSaveJob>(lockedJobId);
    if (job && job.stage !== 'done' && job.stage !== 'error') return job;
  }
  return undefined;
}

// ---- Create backup ----

export function startBackupJob(scope: BackupScope = 'full'): string {
  return startBackupProcess('manual', normalizeBackupScope(scope));
}

function startScheduledBackupJob(): string {
  return startBackupProcess('scheduled', 'full');
}

function startBackupProcess(source: 'manual' | 'scheduled', scope: BackupScope): string {
  if (!acquireLock()) {
    const err = new Error('有备份、恢复或校验任务正在进行中，请等待完成后再试');
    (err as Error & { jobId?: string }).jobId = getActiveBackupJob()?.id;
    throw err;
  }
  const id = `backup_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const job: BackupJob = {
    id,
    stage: 'dumping',
    percent: 0,
    message:
      source === 'scheduled'
        ? '正在执行自动备份...'
        : isModuleBackupScope(scope)
          ? `正在导出${backupScopeLabel(scope)}数据...`
          : '正在导出数据库...',
    logs: [],
    source,
    scope,
  };
  jobs.set(id, job);
  syncJob(job);

  try {
    const workerScript = fileURLToPath(new URL(`../scripts/backupWorker${MODULE_EXT}`, import.meta.url));
    const child = spawn(process.execPath, [...process.execArgv, workerScript, id, source, scope], {
      cwd: process.cwd(),
      env: workerEnv,
      detached: true,
      stdio: 'ignore',
    });
    if (!child.pid) throw new Error('备份后台进程启动失败');
    setLockOwner(child.pid, id, source);
    monitorWorkerExit(child, job, '备份创建');
    child.unref();
  } catch (err: unknown) {
    job.stage = 'error';
    const message = getErrorMessage(err) || '备份后台进程启动失败';
    job.error = message;
    job.message = message;
    syncJob(job);
    releaseLock();
    throw err;
  }

  return id;
}

export async function runBackupWorker(
  jobId: string,
  source: 'manual' | 'scheduled' = 'manual',
  rawScope: BackupScope = 'full',
) {
  const scope = normalizeBackupScope(rawScope);
  const stopLockKeepAlive = startLockKeepAlive(jobId, source);
  const job = loadJob<BackupJob>(jobId) || {
    id: jobId,
    stage: 'dumping',
    percent: 0,
    message:
      source === 'scheduled'
        ? '正在执行自动备份...'
        : isModuleBackupScope(scope)
          ? `正在导出${backupScopeLabel(scope)}数据...`
          : '正在导出数据库...',
    logs: [],
    source,
    scope,
  };
  job.source = source;
  job.scope = scope;
  jobs.set(job.id, job);
  syncJob(job);
  try {
    await runBackup(job);
  } finally {
    stopLockKeepAlive();
    releaseLockForJob(job.id);
  }
}

async function runBackup(job: BackupJob) {
  const scope = normalizeBackupScope(job.scope);
  if (isModuleBackupScope(scope)) {
    await runModuleBackup(job, scope);
    return;
  }

  const tmpDir = prepareWorkDir(job.id);
  const finalArchive = activeArchivePath(job.id);
  let archiveVerified = false;
  let recordWritten = false;

  try {
    let t: number;
    addLog(job, '开始备份任务...');

    // Step 1: pg_dump (0-30%)
    job.stage = 'dumping';
    job.percent = 5;
    job.message = '正在导出数据库...';
    addLog(job, '正在导出数据库 (pg_dump)...');

    pgDumpToFile(DB_URL_CLEAN, join(tmpDir, 'database.sql'), ['--no-owner', '--no-privileges'], DB_DUMP_TIMEOUT_MS);

    if (!existsSync(join(tmpDir, 'database.sql'))) {
      throw new Error('数据库导出失败：文件未生成');
    }
    const dbSize = statSync(join(tmpDir, 'database.sql')).size;
    addLog(job, `数据库导出完成，大小: ${formatSize(dbSize)}`);
    job.percent = 30;
    syncJob(job);

    // Discover business directories automatically so newly added attachment folders are protected by default.
    const staticDir = join(process.cwd(), config.staticDir);
    const uploadDir = join(process.cwd(), config.uploadDir);
    const existingBackupDirs = discoverStaticBackupDirs(staticDir);
    const uploadBackupDirs = discoverUploadBackupDirs(uploadDir);

    // Write metadata into tmp
    writeFileSync(
      join(tmpDir, 'meta.json'),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          version: '2.0',
          appVersion: getAppVersion(),
          staticDirs: existingBackupDirs,
          uploadDirs: uploadBackupDirs,
        },
        null,
        2,
      ),
    );

    // Step 2: tar.gz packing (30-95%)
    job.stage = 'packing';
    job.percent = 35;
    job.message = '正在打包模型文件...';
    addLog(job, '正在打包模型、预览图和原始文件...');

    // Stage database and upload-volume data inside the private backup work dir.
    // This avoids putting transient backup internals under /static, where dev
    // restarts or startup cleanup could remove them while tar is still running.
    const archiveRoot = join(tmpDir, 'archive');
    const dbMarker = join(archiveRoot, BACKUP_DB_ENTRY_DIR);
    rmSync(archiveRoot, { recursive: true, force: true });
    mkdirSync(dbMarker, { recursive: true });
    copyFileSync(join(tmpDir, 'database.sql'), join(dbMarker, 'database.sql'));
    copyFileSync(join(tmpDir, 'meta.json'), join(dbMarker, 'meta.json'));
    stageStaticDirsForArchiveRoot(archiveRoot, staticDir, existingBackupDirs);

    // Copy uploads data into staging for inclusion in backup. Keep the legacy metadata path too.
    const uploadMetadataDir = join(process.cwd(), config.uploadDir, '.metadata');
    const stagedUploadsDir = join(dbMarker, 'uploads');
    for (const dir of uploadBackupDirs) {
      const source = join(uploadDir, dir);
      const destination = join(stagedUploadsDir, dir);
      copyDirectoryContents(source, destination);
    }
    if (existsSync(uploadMetadataDir)) {
      copyDirectoryContents(uploadMetadataDir, join(dbMarker, 'metadata'));
    }

    const manifestDirs: ArchiveDirectorySpec[] = [
      ...existingBackupDirs.map((dir) => ({ path: dir, source: join(staticDir, dir) })),
      ...uploadBackupDirs.map((dir) => ({
        path: `${BACKUP_UPLOADS_ENTRY}/${dir}`,
        source: join(stagedUploadsDir, dir),
      })),
    ];
    if (existsSync(join(dbMarker, 'metadata'))) {
      manifestDirs.push({ path: BACKUP_UPLOAD_METADATA_ENTRY, source: join(dbMarker, 'metadata') });
    }

    const manifest = await createBackupManifest(job.id, join(tmpDir, 'database.sql'), manifestDirs);
    writeJsonAtomic(join(tmpDir, 'manifest.json'), manifest);
    writeJsonAtomic(join(dbMarker, 'manifest.json'), manifest);
    addLog(
      job,
      `备份清单已生成: ${manifest.directories.length} 个目录，数据库校验 ${manifest.database.sha256.slice(0, 12)}...`,
    );

    await new Promise<void>((resolve, reject) => {
      const tmpArchive = join(tmpDir, `${job.id}.tar.gz.tmp`);
      assertTarEntrySource(archiveRoot, BACKUP_DB_ENTRY_DIR);
      for (const dir of existingBackupDirs) assertTarEntrySource(archiveRoot, dir);

      const args: string[] = ['-czhf', tmpArchive];
      args.push(
        '--exclude=__MACOSX',
        '--exclude=*/__MACOSX',
        '--exclude=.DS_Store',
        '--exclude=*/.DS_Store',
        '--exclude=._*',
        '--exclude=*/._*',
        '--exclude=backups',
        '--exclude=.restore_*',
      );
      args.push(BACKUP_DB_ENTRY_DIR, ...existingBackupDirs);

      const proc = spawn('tar', args, { cwd: archiveRoot, timeout: ARCHIVE_EXTRACT_TIMEOUT_MS });
      let stderr = '';

      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', (err) => {
        if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
        reject(err);
      });
      proc.on('close', (code) => {
        clearInterval(progressInterval);
        if (code === 0) {
          renameSync(tmpArchive, finalArchive);
          resolve();
        } else {
          if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
          reject(new Error(`tar failed (code ${code}): ${stderr}`));
        }
      });

      let p = 35;
      const progressInterval = setInterval(() => {
        if (p < 95) {
          const step = p < 70 ? 1.5 : 0.5;
          p = Math.min(95, p + step);
          job.percent = Math.round(p);
          if (p < 55) job.message = '正在打包模型文件...';
          else if (p < 75) job.message = '正在压缩归档...';
          else job.message = '即将完成...';
        } else if (existsSync(tmpArchive)) {
          job.message = `正在压缩归档... 已生成 ${formatSize(statSync(tmpArchive).size)}`;
        }
        syncJob(job);
      }, 3000);
    });

    // Step 3: Validate + compute SHA256 (serial — safe for HDD)
    job.stage = 'saving';
    job.percent = 96;
    job.message = '正在校验备份包完整性...';
    syncJob(job);
    addLog(job, `打包完成，文件大小: ${formatSize(statSync(finalArchive).size)}`);

    t = addLogStart(job, '正在校验备份包完整性...');
    await validateBackupArchive(finalArchive, {
      expectedManifest: manifest,
      onEntryProgress: ({ elapsedMs, entryCount }) => {
        const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
        job.message = `正在校验备份包完整性... 已扫描 ${entryCount} 项，用时 ${elapsedSec}s`;
        syncJob(job);
      },
    });
    archiveVerified = true;
    addLogEnd(job, t, '备份包完整性校验通过');

    const encrypted = await encryptBackupArchiveInPlace(finalArchive);
    if (encrypted) {
      addLog(job, '备份包已加密存储');
    }

    job.percent = 97;
    job.message = '正在计算备份包 SHA256... 0%';
    syncJob(job);
    t = addLogStart(job, '正在计算备份包 SHA256...');
    const archiveSha256 = await sha256FileWithProgress(finalArchive, (percent) => {
      job.percent = Math.max(97, Math.min(99, 97 + Math.floor(percent / 50)));
      job.message = `正在计算备份包 SHA256... ${percent}%`;
      syncJob(job);
    });
    addLogEnd(job, t, 'SHA256 计算完成');

    job.percent = 99;
    job.message = '正在写入备份记录...';
    syncJob(job);

    const stats = await getBackupStats();
    const fileSize = statSync(finalArchive).size;
    const record: BackupRecord = {
      id: job.id,
      filename: `${job.id}.tar.gz`,
      name: `备份 ${formatDate(new Date())}`,
      scope: 'full',
      scopeLabel: backupScopeLabel('full'),
      createdAt: new Date().toISOString(),
      fileSize,
      fileSizeText: formatSize(fileSize),
      modelCount: stats.modelCount,
      thumbnailCount: stats.thumbnailCount,
      dbSize: stats.dbSize,
      countMode: 'step_models',
      archiveSha256,
      archiveSignature: signBackupArchiveSha256(archiveSha256),
      encrypted: encrypted || isEncryptedBackupArchiveFile(finalArchive),
      encryptionAlgorithm:
        encrypted || isEncryptedBackupArchiveFile(finalArchive) ? BACKUP_ENCRYPTION_ALGORITHM : undefined,
      manifestVersion: manifest.schemaVersion,
      verifiedAt: new Date().toISOString(),
    };
    writeJsonAtomic(activeMetaPath(job.id), record);
    recordWritten = true;
    await mirrorBackupIfEnabled(record, job);

    job.stage = 'done';
    job.percent = 100;
    job.message = '备份完成';
    addLog(job, `备份完成！共 ${record.modelCount} 个 STEP 模型，${record.thumbnailCount} 张预览图`);
    try {
      await applyBackupRetentionPolicy(job);
    } catch (err: unknown) {
      const message = `备份已完成，但保留策略清理失败: ${getErrorMessage(err)}`;
      addLog(job, message);
      log.warn({ err, jobId: job.id }, 'Backup retention cleanup failed after backup completed');
    }
    if (job.source === 'scheduled') {
      try {
        await updateBackupPolicySettings({
          backup_last_auto_date: localDateKey(),
          backup_last_auto_status: 'success',
          backup_last_auto_message: `自动备份完成: ${record.fileSizeText}`,
          backup_last_auto_job_id: job.id,
          backup_last_auto_at: new Date().toISOString(),
        });
      } catch (err: unknown) {
        addLog(job, `备份已完成，但自动备份状态更新失败: ${getErrorMessage(err)}`);
        log.warn({ err, jobId: job.id }, 'Scheduled backup status update failed after backup completed');
      }
    }

    log.info({ jobId: job.id, fileSize: formatSize(fileSize) }, 'Backup completed');
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    job.stage = 'error';
    job.error = message;
    syncJob(job);
    if (job.source === 'scheduled') {
      try {
        await updateBackupPolicySettings({
          backup_last_auto_status: 'error',
          backup_last_auto_message: message || '自动备份失败',
          backup_last_auto_job_id: job.id,
          backup_last_auto_at: new Date().toISOString(),
        });
      } catch (statusErr: unknown) {
        log.warn({ err: statusErr, jobId: job.id }, 'Failed to update scheduled backup error status');
      }
    }
    if (!archiveVerified && existsSync(finalArchive)) {
      rmSync(finalArchive, { force: true });
    } else if (archiveVerified && existsSync(finalArchive)) {
      addLog(job, '备份包已通过完整性校验，失败后已保留为未登记备份，可在备份列表中校验或手动处理');
      log.warn({ err, jobId: job.id, path: finalArchive }, 'Preserved verified backup archive after late failure');
    }
    if (!recordWritten && existsSync(activeMetaPath(job.id))) rmSync(activeMetaPath(job.id), { force: true });
    log.error({ err, jobId: job.id }, 'Backup failed');
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runModuleBackup(job: BackupJob, scope: Exclude<BackupScope, 'full'>) {
  const tmpDir = prepareWorkDir(job.id);
  const finalArchive = activeArchivePath(job.id);
  const label = backupScopeLabel(scope);
  let archiveVerified = false;
  let recordWritten = false;

  try {
    let t: number;
    addLog(job, `开始${label}模块备份...`);

    job.stage = 'dumping';
    job.percent = 10;
    job.message = `正在导出${label}数据...`;
    syncJob(job);

    const payload = await buildModuleBackupPayload(scope);
    const dataPath = join(tmpDir, 'module-data.json');
    writeJsonAtomic(dataPath, payload);
    const dataSize = statSync(dataPath).size;
    const dataSha256 = await sha256File(dataPath);
    const itemCount = countModulePayloadItems(payload);
    addLog(job, `${label}数据导出完成，共 ${itemCount} 条记录`);

    job.stage = 'packing';
    job.percent = 35;
    job.message = `正在打包${label}资源文件...`;
    syncJob(job);

    const staticDir = join(process.cwd(), config.staticDir);
    const archiveRoot = join(tmpDir, 'archive');
    const dbMarker = join(archiveRoot, BACKUP_DB_ENTRY_DIR);
    rmSync(archiveRoot, { recursive: true, force: true });
    mkdirSync(dbMarker, { recursive: true });
    copyFileSync(dataPath, join(dbMarker, 'module-data.json'));
    writeFileSync(
      join(dbMarker, 'meta.json'),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          version: MODULE_BACKUP_SCHEMA_VERSION,
          appVersion: getAppVersion(),
          scope,
          scopeLabel: label,
        },
        null,
        2,
      ),
    );

    const moduleDirs = moduleStaticDirs(scope);
    for (const dir of moduleDirs) {
      mkdirSync(join(staticDir, dir), { recursive: true });
    }
    const manifestDirs: ArchiveDirectorySpec[] = moduleDirs.map((dir) => ({ path: dir, source: join(staticDir, dir) }));
    const manifest = await createModuleBackupManifest(job.id, scope, dataSize, dataSha256, manifestDirs);
    writeJsonAtomic(join(dbMarker, 'manifest.json'), manifest);
    addLog(job, `模块备份清单已生成: ${manifest.directories.length} 个目录，数据 ${formatSize(dataSize)}`);

    await packBackupArchive({
      tmpDir,
      finalArchive,
      archiveRoot,
      staticDir,
      staticDirs: moduleDirs,
      job,
    });

    job.stage = 'saving';
    job.percent = 96;
    job.message = '正在校验模块备份包...';
    syncJob(job);
    t = addLogStart(job, '正在校验模块备份包...');
    await validateModuleBackupArchive(finalArchive, { expectedManifest: manifest });
    archiveVerified = true;
    addLogEnd(job, t, '模块备份包校验通过');

    const encrypted = await encryptBackupArchiveInPlace(finalArchive);
    if (encrypted) addLog(job, '模块备份包已加密存储');

    job.percent = 97;
    job.message = '正在计算备份包 SHA256... 0%';
    syncJob(job);
    t = addLogStart(job, '正在计算备份包 SHA256...');
    const archiveSha256 = await sha256FileWithProgress(finalArchive, (percent) => {
      job.percent = Math.max(97, Math.min(99, 97 + Math.floor(percent / 50)));
      job.message = `正在计算备份包 SHA256... ${percent}%`;
      syncJob(job);
    });
    addLogEnd(job, t, 'SHA256 计算完成');

    const fileSize = statSync(finalArchive).size;
    const record: BackupRecord = {
      id: job.id,
      filename: `${job.id}.tar.gz`,
      name: `${label}备份 ${formatDate(new Date())}`,
      scope,
      scopeLabel: label,
      createdAt: new Date().toISOString(),
      fileSize,
      fileSizeText: formatSize(fileSize),
      modelCount: scope === 'models' ? Number(payload.tables.models?.length || 0) : itemCount,
      thumbnailCount: countModuleBackupFiles(scope),
      dbSize: `${itemCount} 条记录`,
      countMode: scope === 'models' ? 'step_models' : undefined,
      archiveSha256,
      archiveSignature: signBackupArchiveSha256(archiveSha256),
      encrypted: encrypted || isEncryptedBackupArchiveFile(finalArchive),
      encryptionAlgorithm:
        encrypted || isEncryptedBackupArchiveFile(finalArchive) ? BACKUP_ENCRYPTION_ALGORITHM : undefined,
      manifestVersion: manifest.schemaVersion,
      verifiedAt: new Date().toISOString(),
    };
    writeJsonAtomic(activeMetaPath(job.id), record);
    recordWritten = true;
    await mirrorBackupIfEnabled(record, job);

    job.stage = 'done';
    job.percent = 100;
    job.message = `${label}备份完成`;
    addLog(job, `${label}备份完成: ${record.dbSize}, ${record.thumbnailCount} 个资源文件`);
    try {
      await applyBackupRetentionPolicy(job);
    } catch (err: unknown) {
      addLog(job, `${label}备份已完成，但保留策略清理失败: ${getErrorMessage(err)}`);
      log.warn({ err, jobId: job.id, scope }, 'Backup retention cleanup failed after module backup completed');
    }
    log.info({ jobId: job.id, scope, fileSize: formatSize(fileSize) }, 'Module backup completed');
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    job.stage = 'error';
    job.error = message;
    syncJob(job);
    if (!archiveVerified && existsSync(finalArchive)) {
      rmSync(finalArchive, { force: true });
    } else if (archiveVerified && existsSync(finalArchive)) {
      addLog(job, `${label}备份包已通过完整性校验，失败后已保留为未登记备份，可在备份列表中校验或手动处理`);
      log.warn(
        { err, jobId: job.id, scope, path: finalArchive },
        'Preserved verified module backup archive after late failure',
      );
    }
    if (!recordWritten && existsSync(activeMetaPath(job.id))) rmSync(activeMetaPath(job.id), { force: true });
    log.error({ err, jobId: job.id, scope }, 'Module backup failed');
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function packBackupArchive({
  tmpDir,
  finalArchive,
  archiveRoot,
  staticDir,
  staticDirs,
  job,
}: {
  tmpDir: string;
  finalArchive: string;
  archiveRoot: string;
  staticDir: string;
  staticDirs: string[];
  job: BackupJob;
}) {
  await new Promise<void>((resolve, reject) => {
    const tmpArchive = join(tmpDir, `${job.id}.tar.gz.tmp`);
    stageStaticDirsForArchiveRoot(archiveRoot, staticDir, staticDirs);
    assertTarEntrySource(archiveRoot, BACKUP_DB_ENTRY_DIR);
    for (const dir of staticDirs) assertTarEntrySource(archiveRoot, dir);

    const args: string[] = ['-czhf', tmpArchive];
    args.push(
      '--exclude=__MACOSX',
      '--exclude=*/__MACOSX',
      '--exclude=.DS_Store',
      '--exclude=*/.DS_Store',
      '--exclude=._*',
      '--exclude=*/._*',
      '--exclude=backups',
      '--exclude=.restore_*',
    );
    args.push(BACKUP_DB_ENTRY_DIR, ...staticDirs);

    const proc = spawn('tar', args, { cwd: archiveRoot, timeout: ARCHIVE_EXTRACT_TIMEOUT_MS });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
      reject(err);
    });
    proc.on('close', (code) => {
      clearInterval(progressInterval);
      if (code === 0) {
        renameSync(tmpArchive, finalArchive);
        resolve();
      } else {
        if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
        reject(new Error(`tar failed (code ${code}): ${stderr}`));
      }
    });

    let p = 35;
    const progressInterval = setInterval(() => {
      if (p < 95) {
        const step = p < 70 ? 1.5 : 0.5;
        p = Math.min(95, p + step);
        job.percent = Math.round(p);
        if (p < 55) job.message = '正在打包资源文件...';
        else if (p < 75) job.message = '正在压缩归档...';
        else job.message = '即将完成...';
      } else if (existsSync(tmpArchive)) {
        job.message = `正在压缩归档... 已生成 ${formatSize(statSync(tmpArchive).size)}`;
      }
      syncJob(job);
    }, 3000);
  });
}

function assertTarEntrySource(root: string, entry: string) {
  const target = join(root, entry);
  if (!existsSync(target)) {
    throw new Error(`备份打包源不存在: ${target}`);
  }
}

function moduleStaticDirs(scope: Exclude<BackupScope, 'full'>): string[] {
  return MODULE_BACKUP_STATIC_DIRS[scope] || [];
}

async function buildModuleBackupPayload(scope: Exclude<BackupScope, 'full'>): Promise<ModuleBackupPayload> {
  const prisma = await getBackupPrisma();
  const generatedAt = new Date().toISOString();
  const base: Omit<ModuleBackupPayload, 'tables'> = {
    schemaVersion: MODULE_BACKUP_SCHEMA_VERSION,
    scope,
    generatedAt,
    appVersion: getAppVersion(),
  };

  if (scope === 'models') {
    return {
      ...base,
      tables: {
        categories: await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
        modelGroups: await prisma.modelGroup.findMany({ orderBy: [{ createdAt: 'asc' }] }),
        models: await prisma.model.findMany({ orderBy: [{ createdAt: 'asc' }] }),
        modelVersions: await prisma.modelVersion.findMany({ orderBy: [{ createdAt: 'asc' }] }),
        favorites: await prisma.favorite.findMany({ orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }] }),
        downloads: await prisma.download.findMany({ orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }] }),
        comments: await prisma.comment.findMany({ orderBy: [{ modelId: 'asc' }, { createdAt: 'asc' }] }),
        shareLinks: await prisma.shareLink.findMany({ orderBy: [{ createdById: 'asc' }, { createdAt: 'asc' }] }),
      },
    };
  }

  if (scope === 'selection') {
    return {
      ...base,
      tables: {
        selectionCategories: await prisma.selectionCategory.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        selectionProducts: await prisma.selectionProduct.findMany({
          orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        threadSizeEntries: await prisma.threadSizeEntry.findMany({
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        selectionShares: await prisma.selectionShare.findMany({
          orderBy: [{ createdById: 'asc' }, { createdAt: 'asc' }],
        }),
      },
    };
  }

  if (scope === 'config') {
    return {
      ...base,
      tables: {
        settings: await prisma.setting.findMany({ orderBy: [{ key: 'asc' }] }),
        categories: await prisma.category.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
      },
    };
  }

  return {
    ...base,
    tables: {
      productWallCategories: await prisma.productWallCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      productWallImages: await prisma.productWallImage.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      productWallImageFavorites: await prisma.productWallImageFavorite.findMany({
        orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
      }),
    },
  };
}

function countModulePayloadItems(payload: ModuleBackupPayload): number {
  return Object.values(payload.tables).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

function countModuleBackupFiles(scope: Exclude<BackupScope, 'full'>): number {
  const staticDir = join(process.cwd(), config.staticDir);
  return moduleStaticDirs(scope).reduce((sum, dir) => sum + countFilesRecursive(join(staticDir, dir)), 0);
}

async function createModuleBackupManifest(
  backupId: string,
  scope: Exclude<BackupScope, 'full'>,
  dataSize: number,
  dataSha256: string,
  directoriesToCheck: readonly ArchiveDirectorySpec[],
): Promise<ModuleBackupManifest> {
  for (const dir of directoriesToCheck) assertDirectoryContainsNoSymlinks(dir.source, dir.path);
  const directories: BackupManifestDirectory[] = directoriesToCheck.map((dir) => {
    const stats = countFilesAndBytesRecursive(dir.source);
    return { path: dir.path, fileCount: stats.fileCount, totalBytes: stats.totalBytes };
  });

  return {
    schemaVersion: MODULE_BACKUP_SCHEMA_VERSION,
    backupId,
    generatedAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    scope,
    data: {
      path: MODULE_BACKUP_DATA_ENTRY,
      size: dataSize,
      sha256: dataSha256,
    },
    directories,
    requiredEntries: [
      BACKUP_META_ENTRY,
      BACKUP_MANIFEST_ENTRY,
      MODULE_BACKUP_DATA_ENTRY,
      ...directoriesToCheck.map((dir) => dir.path),
    ],
  };
}

// ---- List backups ----

export function listBackups(): BackupRecord[] {
  const records: BackupRecord[] = [];
  const seen = new Set<string>();

  for (const dir of BACKUP_DIRS) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir);
    for (const file of files.filter((entry) => entry.endsWith('.json'))) {
      try {
        const raw = readFileSync(join(dir, file), 'utf-8');
        const record = JSON.parse(raw) as BackupRecord;
        if (seen.has(record.id)) continue;
        const archive = buildArchivePath(dir, record.id);
        if (!existsSync(archive)) continue;
        const normalized = normalizeBackupRecord(record, archive, join(dir, file));
        normalized.filePath = hostBackupFilePath(normalized.filename);
        records.push(normalized);
        seen.add(record.id);
      } catch {
        log.warn({ file, dir }, 'Failed to read backup record JSON');
      }
    }
    for (const file of files.filter((entry) => entry.endsWith('.tar.gz'))) {
      const id = file.slice(0, -'.tar.gz'.length);
      if (!SAFE_BACKUP_ID_RE.test(id) || seen.has(id)) continue;
      const archive = buildArchivePath(dir, id);
      if (!existsSync(archive)) continue;
      try {
        const stats = statSync(archive);
        records.push({
          id,
          filename: file,
          filePath: hostBackupFilePath(file),
          name: `未登记备份 ${formatDate(stats.mtime)}`,
          createdAt: stats.mtime.toISOString(),
          fileSize: stats.size,
          fileSizeText: formatSize(stats.size),
          modelCount: 0,
          thumbnailCount: 0,
          dbSize: '未知',
        });
        seen.add(id);
      } catch {
        log.warn({ file: id, dir }, 'Failed to stat unregistered backup archive');
      }
    }
  }

  // Sort by date descending
  records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return records;
}

export async function getBackupHealth(): Promise<BackupHealth> {
  const settings = await getBackupPolicySettings();
  const backups = listBackups();
  const latestBackup = backups[0];
  const totalSize = backups.reduce((sum, backup) => sum + (backup.fileSize || 0), 0);
  const nextRunAt = settings.backup_auto_enabled ? nextScheduledRunIso(settings.backup_schedule_time) : undefined;
  const encryption = getBackupEncryptionStatus();

  if (!settings.backup_auto_enabled) {
    return {
      enabled: false,
      scheduleTime: settings.backup_schedule_time,
      retentionCount: settings.backup_retention_count,
      mirrorEnabled: settings.backup_mirror_enabled,
      mirrorDir: settings.backup_mirror_dir || undefined,
      status: backups.length > 0 ? 'disabled' : 'empty',
      message: buildBackupHealthMessage(
        backups.length > 0 ? '自动备份未开启，已有手动备份可用' : '尚无备份，建议先创建一次手动备份',
        settings,
      ),
      backupCount: backups.length,
      totalSize,
      totalSizeText: formatSize(totalSize),
      latestBackup,
      lastAutoStatus: settings.backup_last_auto_status,
      lastAutoMessage: settings.backup_last_auto_message,
      lastAutoAt: settings.backup_last_auto_at,
      lastAutoJobId: settings.backup_last_auto_job_id,
      lastMirrorStatus: settings.backup_last_mirror_status,
      lastMirrorMessage: settings.backup_last_mirror_message,
      lastMirrorAt: settings.backup_last_mirror_at,
      encryption,
    };
  }

  if (!latestBackup) {
    return {
      enabled: true,
      scheduleTime: settings.backup_schedule_time,
      retentionCount: settings.backup_retention_count,
      mirrorEnabled: settings.backup_mirror_enabled,
      mirrorDir: settings.backup_mirror_dir || undefined,
      status: 'empty',
      message: buildBackupHealthMessage('自动备份已开启，但当前还没有任何备份', settings),
      backupCount: 0,
      totalSize: 0,
      totalSizeText: formatSize(0),
      nextRunAt,
      lastAutoStatus: settings.backup_last_auto_status,
      lastAutoMessage: settings.backup_last_auto_message,
      lastAutoAt: settings.backup_last_auto_at,
      lastAutoJobId: settings.backup_last_auto_job_id,
      lastMirrorStatus: settings.backup_last_mirror_status,
      lastMirrorMessage: settings.backup_last_mirror_message,
      lastMirrorAt: settings.backup_last_mirror_at,
      encryption,
    };
  }

  const latestAgeMs = Date.now() - new Date(latestBackup.createdAt).getTime();
  const stale = latestAgeMs > 36 * 60 * 60 * 1000;
  const mirrorWarning = settings.backup_mirror_enabled && settings.backup_last_mirror_status === 'error';
  return {
    enabled: true,
    scheduleTime: settings.backup_schedule_time,
    retentionCount: settings.backup_retention_count,
    mirrorEnabled: settings.backup_mirror_enabled,
    mirrorDir: settings.backup_mirror_dir || undefined,
    status: stale || mirrorWarning ? 'warning' : 'ok',
    message: buildBackupHealthMessage(
      stale ? '最近一次备份超过 36 小时，请检查自动备份任务' : '备份策略正常，最近备份可用',
      settings,
    ),
    backupCount: backups.length,
    totalSize,
    totalSizeText: formatSize(totalSize),
    latestBackup,
    nextRunAt,
    lastAutoStatus: settings.backup_last_auto_status,
    lastAutoMessage: settings.backup_last_auto_message,
    lastAutoAt: settings.backup_last_auto_at,
    lastAutoJobId: settings.backup_last_auto_job_id,
    lastMirrorStatus: settings.backup_last_mirror_status,
    lastMirrorMessage: settings.backup_last_mirror_message,
    lastMirrorAt: settings.backup_last_mirror_at,
    encryption,
  };
}

function backupPolicyAction(check: BackupPolicyCheckItem): string {
  if (check.key === 'schedule') return '开启每日自动备份，避免只依赖人工创建恢复点。';
  if (check.key === 'retention') return '将备份保留份数调到至少 3 份，覆盖误删和延迟发现问题的场景。';
  if (check.key === 'mirror') return '配置外部镜像目录，优先选择 NAS、独立磁盘或异地挂载目录。';
  if (check.key === 'mirror_dir') return '修正外部镜像目录，不能为空，也不能指向当前备份目录。';
  if (check.key === 'latest_backup') return '重新创建一次整站备份并完成校验，先建立可信恢复点。';
  if (check.key === 'encryption') return '配置 BACKUP_ENCRYPTION_SECRET，让备份包在磁盘上保持加密。';
  if (check.label.includes('磁盘空间')) return `${check.label}不足或无法确认，请清理空间或迁移到更大磁盘。`;
  if (check.label.includes('可写')) return `${check.label}失败，请检查目录挂载和读写权限。`;
  return `${check.label}：${check.message}`;
}

function toBackupPolicyFinding(check: BackupPolicyCheckItem): BackupPolicyReportFinding {
  return {
    key: check.key,
    label: check.label,
    message: check.message,
  };
}

export function buildBackupPolicyReport(checks: BackupPolicyCheckItem[]): BackupPolicyReport {
  const blockers = checks.filter((check) => check.status === 'error').map(toBackupPolicyFinding);
  const warnings = checks.filter((check) => check.status === 'warning').map(toBackupPolicyFinding);
  const nextActions = checks
    .filter((check) => check.status !== 'ok')
    .map(backupPolicyAction)
    .slice(0, 5);

  if (blockers.length > 0) {
    return {
      riskLevel: 'high',
      summary: `发现 ${blockers.length} 个阻断风险，当前备份策略不适合作为生产恢复保障。`,
      blockers,
      warnings,
      nextActions,
    };
  }

  if (warnings.length > 0) {
    return {
      riskLevel: 'medium',
      summary: `体检完成，有 ${warnings.length} 个需关注项；备份可用性需要继续完善。`,
      blockers,
      warnings,
      nextActions,
    };
  }

  return {
    riskLevel: 'low',
    summary: '体检通过：当前备份策略具备基础生产恢复保障。',
    blockers,
    warnings,
    nextActions: ['保持定期体检，并在版本升级或大批量导入后重新创建一次整站备份。'],
  };
}

export async function getBackupPolicyCheck(): Promise<BackupPolicyCheck> {
  const settings = await getBackupPolicySettings();
  const checks: BackupPolicyCheckItem[] = [];
  const estimatedBackupSize = estimateCurrentBackupBytes();
  const requiredBytes = Math.ceil(estimatedBackupSize * 1.25);

  checks.push(checkWritableDirectory(ACTIVE_BACKUP_DIR, '本地备份目录可写'));
  checks.push(checkDiskSpace(ACTIVE_BACKUP_DIR, requiredBytes, '本地备份磁盘空间'));

  if (settings.backup_auto_enabled) {
    checks.push({
      key: 'schedule',
      label: '自动备份计划',
      status: 'ok',
      message: `已开启，每日 ${settings.backup_schedule_time} 自动备份`,
    });
  } else {
    checks.push({
      key: 'schedule',
      label: '自动备份计划',
      status: 'warning',
      message: '自动备份未开启，建议确认手动备份稳定后开启',
    });
  }

  checks.push({
    key: 'retention',
    label: '保留份数',
    status: settings.backup_retention_count >= 3 ? 'ok' : 'warning',
    message: `当前保留 ${settings.backup_retention_count} 份${settings.backup_retention_count < 3 ? '，建议至少 3 份' : ''}`,
  });

  const encryption = getBackupEncryptionStatus();
  checks.push({
    key: 'encryption',
    label: '备份加密',
    status: encryption.enabled ? 'ok' : 'warning',
    message: encryption.enabled
      ? `已启用 ${encryption.algorithm} 加密`
      : `未启用备份加密，建议配置 ${encryption.recommendedEnvName}`,
  });

  if (settings.backup_mirror_enabled) {
    const mirrorDir = resolveMirrorBackupDir(settings.backup_mirror_dir);
    if (!mirrorDir) {
      checks.push({
        key: 'mirror_dir',
        label: '外部镜像目录',
        status: 'error',
        message: '镜像目录无效，请填写独立磁盘/NAS 的绝对路径，不能指向当前备份目录',
      });
    } else {
      checks.push(checkWritableDirectory(mirrorDir, '外部镜像目录可写'));
      checks.push(checkDiskSpace(mirrorDir, requiredBytes, '外部镜像磁盘空间'));
    }
  } else {
    checks.push({
      key: 'mirror',
      label: '外部镜像备份',
      status: 'warning',
      message: '外部镜像未开启，服务器硬盘故障时本地备份可能一起丢失',
    });
  }

  const latest = listBackups()[0];
  if (!latest) {
    checks.push({
      key: 'latest_backup',
      label: '最近备份可用性',
      status: 'warning',
      message: '当前没有备份记录，请先创建一次备份',
    });
  } else {
    try {
      await verifyBackupArchive(latest.id);
      checks.push({
        key: 'latest_backup',
        label: '最近备份可用性',
        status: 'ok',
        message: `最近备份 ${latest.name} 校验通过`,
      });
    } catch (err: unknown) {
      const isLegacyBackup = isMissingManifestError(err);
      checks.push({
        key: 'latest_backup',
        label: '最近备份可用性',
        status: isLegacyBackup ? 'warning' : 'error',
        message: isLegacyBackup
          ? `最近备份 ${latest.name} 是旧版备份，缺少企业级清单；建议重新创建一次备份`
          : `最近备份校验失败: ${getErrorMessage(err)}`,
      });
    }
  }

  return {
    status: checks.some((check) => check.status === 'error')
      ? 'error'
      : checks.some((check) => check.status === 'warning')
        ? 'warning'
        : 'ok',
    checkedAt: new Date().toISOString(),
    estimatedBackupSize,
    estimatedBackupSizeText: formatSize(estimatedBackupSize),
    checks,
    report: buildBackupPolicyReport(checks),
  };
}

export async function verifyBackupArchive(id: string): Promise<BackupVerificationResult> {
  const archive = archivePath(id);
  if (!existsSync(archive)) throw new Error('备份文件不存在');
  const meta = metaPath(id);
  const record = existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf-8')) as BackupRecord) : null;
  const rawManifest = await readBackupManifestForKind(archive);
  const moduleManifest = isModuleBackupManifest(rawManifest) ? rawManifest : null;
  const manifest = moduleManifest
    ? await validateModuleBackupArchive(archive)
    : await validateBackupArchive(archive, { requireManifest: true });
  const archiveSha256 = await sha256File(archive);
  if (record?.archiveSha256 && record.archiveSha256 !== archiveSha256) {
    throw new Error('备份归档 SHA256 与记录不一致');
  }
  if (record) assertBackupSignature(record, archiveSha256);
  const checkedAt = new Date().toISOString();
  const archiveSignature = signBackupArchiveSha256(archiveSha256);
  const encrypted = isEncryptedBackupArchiveFile(archive);
  if (record) {
    writeJsonAtomic(meta, {
      ...record,
      archiveSha256,
      archiveSignature,
      encrypted,
      encryptionAlgorithm: encrypted ? BACKUP_ENCRYPTION_ALGORITHM : undefined,
      scope: moduleManifest ? moduleManifest.scope : record.scope || 'full',
      scopeLabel: moduleManifest
        ? backupScopeLabel(moduleManifest.scope)
        : record.scopeLabel || backupScopeLabel('full'),
      manifestVersion: manifest?.schemaVersion,
      verifiedAt: checkedAt,
    });
  }
  const fileSize = statSync(archive).size;
  return {
    id,
    ok: true,
    checkedAt,
    fileSize,
    fileSizeText: formatSize(fileSize),
    manifestVersion: manifest?.schemaVersion,
    archiveSha256,
    archiveSignature,
    encrypted,
    encryptionAlgorithm: encrypted ? BACKUP_ENCRYPTION_ALGORITHM : undefined,
    message: moduleManifest
      ? `${backupScopeLabel(moduleManifest.scope)}备份包 manifest、数据 SHA256、目录文件数校验通过`
      : '备份包 manifest、数据库 SHA256、目录文件数校验通过',
  };
}

export function startVerifyBackupJob(backupId: string, userId?: string | null): string {
  if (!acquireLock()) throw new Error('有备份、恢复或校验任务正在进行中，请等待完成后再试');
  const id = `verify_${Date.now()}`;
  const job: VerifyJob = {
    id,
    backupId,
    userId: userId || null,
    stage: 'queued',
    percent: 0,
    message: '正在准备校验备份...',
    logs: [],
  };
  verifyJobs.set(id, job);
  syncJob(job);

  try {
    const workerScript = fileURLToPath(new URL(`../scripts/verifyBackupWorker${MODULE_EXT}`, import.meta.url));
    const child = spawn(process.execPath, [...process.execArgv, workerScript, id, backupId], {
      cwd: process.cwd(),
      env: workerEnv,
      detached: true,
      stdio: 'ignore',
    });
    if (!child.pid) throw new Error('备份校验后台进程启动失败');
    setLockOwner(child.pid, id, 'manual');
    monitorWorkerExit(child, job, '备份校验');
    child.unref();
  } catch (err: unknown) {
    const message = getErrorMessage(err) || '备份校验后台进程启动失败';
    job.stage = 'error';
    job.error = message;
    job.message = message;
    syncJob(job);
    releaseLock();
    throw err;
  }

  return id;
}

export async function runVerifyBackupWorker(jobId: string, backupId: string) {
  const stopLockKeepAlive = startLockKeepAlive(jobId);
  const job = loadJob<VerifyJob>(jobId) || {
    id: jobId,
    backupId,
    userId: null,
    stage: 'queued',
    percent: 0,
    message: '正在准备校验备份...',
    logs: [],
  };
  verifyJobs.set(job.id, job);
  syncJob(job);
  try {
    await runVerifyBackup(job, backupId);
  } finally {
    stopLockKeepAlive();
    releaseLockForJob(job.id);
  }
}

async function runVerifyBackup(job: VerifyJob, backupId: string) {
  try {
    addLog(job, '开始校验备份...');
    const archive = archivePath(backupId);
    if (!existsSync(archive)) throw new Error('备份文件不存在');
    const meta = metaPath(backupId);
    const record = existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf-8')) as BackupRecord) : null;

    job.stage = 'validating_archive';
    job.percent = 10;
    job.message = '正在校验备份清单、数据库和目录文件数...';
    syncJob(job);
    const rawManifest = await readBackupManifestForKind(archive);
    const moduleManifest = isModuleBackupManifest(rawManifest) ? rawManifest : null;
    const manifest = moduleManifest
      ? await validateModuleBackupArchive(archive, {
          onEntryProgress: ({ elapsedMs, entryCount }) => {
            const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
            job.percent = Math.min(65, 10 + Math.floor(elapsedSec / 4));
            job.message = `正在校验模块备份清单、数据和目录文件数... 已扫描 ${entryCount} 项，用时 ${elapsedSec}s`;
            syncJob(job);
          },
        })
      : await validateBackupArchive(archive, {
          requireManifest: true,
          onEntryProgress: ({ elapsedMs, entryCount }) => {
            const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
            job.percent = Math.min(65, 10 + Math.floor(elapsedSec / 4));
            job.message = `正在校验备份清单、数据库和目录文件数... 已扫描 ${entryCount} 项，用时 ${elapsedSec}s`;
            syncJob(job);
          },
        });
    addLog(job, '备份清单、数据库和目录文件数校验通过');

    job.stage = 'hashing_archive';
    job.percent = 70;
    job.message = '正在计算备份包 SHA256...';
    syncJob(job);
    const archiveSha256 = await sha256FileWithProgress(archive, (percent) => {
      job.percent = Math.max(70, Math.min(95, 70 + Math.round(percent * 0.25)));
      job.message = `正在计算备份包 SHA256... ${percent}%`;
      syncJob(job);
    });
    if (record?.archiveSha256 && record.archiveSha256 !== archiveSha256) {
      throw new Error('备份归档 SHA256 与记录不一致');
    }
    if (record) assertBackupSignature(record, archiveSha256);

    const checkedAt = new Date().toISOString();
    const archiveSignature = signBackupArchiveSha256(archiveSha256);
    const encrypted = isEncryptedBackupArchiveFile(archive);
    job.stage = 'writing_record';
    job.percent = 96;
    job.message = '正在写入校验记录...';
    syncJob(job);
    if (record) {
      writeJsonAtomic(meta, {
        ...record,
        archiveSha256,
        archiveSignature,
        encrypted,
        encryptionAlgorithm: encrypted ? BACKUP_ENCRYPTION_ALGORITHM : undefined,
        scope: moduleManifest ? moduleManifest.scope : record.scope || 'full',
        scopeLabel: moduleManifest
          ? backupScopeLabel(moduleManifest.scope)
          : record.scopeLabel || backupScopeLabel('full'),
        manifestVersion: manifest?.schemaVersion,
        verifiedAt: checkedAt,
      });
    }

    const fileSize = statSync(archive).size;
    job.result = {
      id: backupId,
      ok: true,
      checkedAt,
      fileSize,
      fileSizeText: formatSize(fileSize),
      manifestVersion: manifest?.schemaVersion,
      archiveSha256,
      archiveSignature,
      encrypted,
      encryptionAlgorithm: encrypted ? BACKUP_ENCRYPTION_ALGORITHM : undefined,
      message: moduleManifest
        ? `${backupScopeLabel(moduleManifest.scope)}备份包 manifest、数据 SHA256、目录文件数校验通过`
        : '备份包 manifest、数据库 SHA256、目录文件数校验通过',
    };
    job.stage = 'done';
    job.percent = 100;
    job.message = '备份校验完成';
    addLog(job, '备份校验完成');
    syncJob(job);
    await recordBackupAudit({
      action: 'backup_verify',
      userId: job.userId,
      resourceId: backupId,
      details: {
        status: 'ok',
        jobId: job.id,
        backupId,
        fileSizeText: job.result.fileSizeText,
        manifestVersion: job.result.manifestVersion || '',
        encrypted,
        message: job.result.message,
        checkedAt,
      },
    });
  } catch (err: unknown) {
    job.stage = 'error';
    job.error = getErrorMessage(err) || '备份校验失败';
    job.message = `备份校验失败: ${job.error}`;
    addLog(job, job.message);
    syncJob(job);
    await recordBackupAudit({
      action: 'backup_verify',
      userId: job.userId,
      resourceId: backupId,
      details: {
        status: 'error',
        jobId: job.id,
        backupId,
        error: job.error,
      },
    });
  }
}

function isMissingManifestError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return message.includes('缺少企业级清单文件');
}

// ---- Rename backup ----

export function renameBackup(id: string, newName: string): BackupRecord | null {
  const meta = metaPath(id);
  if (!existsSync(meta) || !existsSync(archivePath(id))) return null;
  const raw = readFileSync(meta, 'utf-8');
  const record = JSON.parse(raw) as BackupRecord;
  record.name = newName;
  writeFileSync(meta, JSON.stringify(record, null, 2));
  return record;
}

// ---- Delete backup ----

export function deleteBackup(id: string): boolean {
  let deleted = false;
  const fatalErrors: string[] = [];
  const metadataWarnings: string[] = [];
  for (const dir of BACKUP_DIRS) {
    const meta = buildMetaPath(dir, id);
    const arch = buildArchivePath(dir, id);
    if (existsSync(meta)) {
      deleted = true;
    }
    if (existsSync(arch)) {
      deleted = true;
    }
    try {
      if (existsSync(arch)) rmSync(arch, { force: true });
    } catch (err: unknown) {
      fatalErrors.push(`${arch}: ${getErrorMessage(err)}`);
      continue;
    }
    try {
      if (existsSync(meta)) rmSync(meta, { force: true });
    } catch (err: unknown) {
      metadataWarnings.push(`${meta}: ${getErrorMessage(err)}`);
    }
  }
  if (fatalErrors.length > 0) {
    throw new Error(`删除备份文件失败，请检查备份目录权限: ${fatalErrors.join('; ')}`);
  }
  if (metadataWarnings.length > 0) {
    log.warn({ id, metadataWarnings }, 'Backup archive deleted but metadata cleanup failed');
  }
  return deleted;
}

// ---- Restore ----

async function recordRestoreAudit(job: RestoreJob, status: 'ok' | 'error', extra: Record<string, unknown>) {
  await recordBackupAudit({
    action: 'backup_restore_result',
    userId: job.userId,
    resourceId: job.backupId || job.id,
    details: {
      status,
      jobId: job.id,
      source: job.source || 'backup-record',
      backupId: job.backupId || '',
      ...extra,
    },
  });
}

export function startRestoreJob(backupId: string, userId?: string | null, force = false): string {
  if (!acquireLock()) throw new Error('有备份、恢复或校验任务正在进行中，请等待完成后再试');
  const jobId = `restore_${Date.now()}`;
  const job: RestoreJob = {
    id: jobId,
    userId: userId || null,
    source: 'backup-record',
    backupId,
    stage: 'extracting',
    percent: 0,
    message: '正在解压备份文件...',
    logs: [],
    force,
  };
  restoreJobs.set(jobId, job);
  syncJob(job);

  try {
    startRestoreWorkerProcess(job, ['backup', backupId]);
  } catch (err) {
    releaseLock();
    throw err;
  }

  return jobId;
}

async function runRestore(job: RestoreJob, backupId: string) {
  try {
    ensureBackupStoredInActiveDir(backupId);
    const arch = archivePath(backupId);
    if (!existsSync(arch)) throw new Error('备份文件不存在');
    const meta = metaPath(backupId);
    if (existsSync(meta)) {
      const record = JSON.parse(readFileSync(meta, 'utf-8')) as BackupRecord;
      if (record.archiveSha256) {
        addLog(job, '正在校验备份文件 SHA256...');
        const actualSha256 = await sha256File(arch);
        if (actualSha256 !== record.archiveSha256) {
          throw new Error('备份文件 SHA256 与记录不一致，可能已损坏或被替换，已中止恢复');
        }
        if (job.force) {
          addLog(job, '⚠ 已跳过签名校验（跨服务器迁移强制恢复）。文件完整性 SHA256 已通过，但备份来源真实性未校验。');
        } else {
          assertBackupSignature(record, actualSha256);
        }
        addLog(job, '备份文件 SHA256 校验通过');
      }
    }
    await runRestoreAutoFromArchive(job, arch, false);
  } catch (err: unknown) {
    const message = getErrorMessage(err) || '恢复失败';
    job.stage = 'error';
    job.error = message;
    job.message = `恢复失败: ${message}`;
    addLog(job, job.message);
    syncJob(job);
    await recordRestoreAudit(job, 'error', { error: message });
  }
}

// ---- Restore from uploaded file (import) ----

export function startRestoreJobFromFile(archPath: string, removeAfter = true, userId?: string | null): string {
  if (!acquireLock()) throw new Error('有备份、恢复或校验任务正在进行中，请等待完成后再试');
  const jobId = `restore_${Date.now()}`;
  const job: RestoreJob = {
    id: jobId,
    userId: userId || null,
    source: 'import-file',
    backupId: null,
    stage: 'extracting',
    percent: 0,
    message: '正在上传完成，开始解压...',
    logs: [],
  };
  restoreJobs.set(jobId, job);
  syncJob(job);

  try {
    startRestoreWorkerProcess(job, ['file', archPath, removeAfter ? 'true' : 'false']);
  } catch (err) {
    releaseLock();
    throw err;
  }

  return jobId;
}

async function runRestoreFromFile(job: RestoreJob, archPath: string, removeAfter: boolean) {
  try {
    await runRestoreAutoFromArchive(job, archPath, removeAfter);
  } catch (err: unknown) {
    const message = getErrorMessage(err) || '恢复失败';
    job.stage = 'error';
    job.error = message;
    job.message = `恢复失败: ${message}`;
    addLog(job, job.message);
    syncJob(job);
    await recordRestoreAudit(job, 'error', { error: message, source: 'import-file' });
  }
}

async function runRestoreAutoFromArchive(job: RestoreJob, archPath: string, removeAfter: boolean) {
  // 读清单需从归档头顺序解压到 manifest 条目，大备份可能数分钟；先给个诚实提示，
  // 避免停留在 job 创建时的「正在解压备份文件... 0%」让用户误以为卡住。
  job.message = '正在读取备份清单（大备份可能需要数分钟，请耐心等待）...';
  syncJob(job);
  const rawManifest = await readBackupManifestForKind(archPath);
  if (isModuleBackupManifest(rawManifest)) {
    await runModuleRestoreFromArchive(job, archPath, removeAfter, rawManifest.scope);
    return;
  }
  // 透传已读清单，runRestoreFromArchive 不必再 tar 读第二遍。
  await runRestoreFromArchive(job, archPath, removeAfter, rawManifest);
}

async function runModuleRestoreFromArchive(
  job: RestoreJob,
  archPath: string,
  removeArchiveAfterExtract: boolean,
  expectedScope: Exclude<BackupScope, 'full'>,
) {
  const tmpDir = prepareWorkDir(job.id);
  const label = backupScopeLabel(expectedScope);
  const result = {
    dbRestored: false,
    modelCount: 0,
    thumbnailCount: 0,
    scope: expectedScope as BackupScope,
    scopeLabel: label,
    itemCount: 0,
    fileCount: 0,
  };
  let readableArchivePath = archPath;
  let safetySnapshot: string | null = null;

  try {
    const archiveSize = statSync(archPath).size;
    addLog(job, `开始恢复${label}模块（备份文件 ${formatSize(archiveSize)}）...`);

    job.stage = 'extracting';
    job.percent = 5;
    job.message = '正在读取模块备份包...';
    syncJob(job);
    readableArchivePath = await materializeReadableBackupArchive(archPath, tmpDir);
    if (readableArchivePath !== archPath) addLog(job, '模块备份包已解密到临时恢复目录');

    job.percent = 10;
    job.message = '正在校验模块备份完整性...';
    syncJob(job);
    let t = addLogStart(job, '正在校验模块备份清单、数据 SHA256 和目录文件数...');
    const manifest = await validateModuleBackupArchive(readableArchivePath, {
      onEntryProgress: ({ elapsedMs, entryCount }) => {
        const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
        job.message = `正在校验模块备份完整性... 已扫描 ${entryCount} 项，用时 ${elapsedSec}s`;
        syncJob(job);
      },
    });
    if (manifest.scope !== expectedScope) {
      throw new Error(`模块备份类型不匹配: 期望 ${label}, 实际 ${backupScopeLabel(manifest.scope)}`);
    }
    addLogEnd(job, t, '模块备份完整性校验通过');

    job.percent = 20;
    job.message = '正在读取模块数据...';
    syncJob(job);
    const dataPath = extractModuleDataToTmp(readableArchivePath, tmpDir, manifest);
    const payload = readModulePayload(dataPath, manifest.scope);
    result.itemCount = countModulePayloadItems(payload);
    result.fileCount = manifest.directories.reduce((sum, dir) => sum + dir.fileCount, 0);
    addLog(job, `模块数据读取完成: ${result.itemCount} 条记录，${result.fileCount} 个资源文件`);

    job.percent = 28;
    job.message = '正在准备模块文件恢复计划...';
    syncJob(job);
    const filePlan = buildModuleFilePlanFromManifest(readableArchivePath, tmpDir, manifest);
    assertRestoreHasDiskSpace(filePlan);
    addLog(job, `文件目录预检通过: ${filePlan.staticDirs.length} 个 ${label}资源目录`);

    job.stage = 'restoring_db';
    job.percent = 35;
    job.message = '正在创建恢复前安全快照...';
    syncJob(job);
    t = addLogStart(job, '正在导出当前数据库安全快照（模块恢复失败时自动回滚）...');
    try {
      safetySnapshot = join(tmpDir, 'safety_snapshot.sql');
      pgDumpToFile(DB_URL_CLEAN, safetySnapshot, ['--no-owner', '--no-privileges'], DB_DUMP_TIMEOUT_MS);
      const snapSize = statSync(safetySnapshot).size;
      if (snapSize === 0) throw new Error('安全快照为空');
      addLogEnd(job, t, `安全快照已创建（${formatSize(snapSize)}）`);
    } catch (snapErr: unknown) {
      throw new Error(`无法创建恢复前安全快照，已中止恢复以保护数据安全: ${getErrorMessage(snapErr)}`);
    }

    job.percent = 50;
    job.message = `正在恢复${label}数据...`;
    syncJob(job);
    t = addLogStart(job, `正在重建${label}相关数据表...`);
    const restoredItemCount = await restoreModulePayload(payload, job);
    result.dbRestored = true;
    result.itemCount = restoredItemCount;
    result.modelCount = manifest.scope === 'models' ? await countStepModelsInDatabase() : restoredItemCount;
    addLogEnd(job, t, `${label}数据恢复完成（${restoredItemCount} 条记录）`);

    job.stage = 'restoring_files';
    job.percent = 75;
    job.message = `正在恢复${label}资源文件...`;
    syncJob(job);

    try {
      t = addLogStart(job, `正在恢复${label}资源目录...`);
      const fileResult = await commitRestoreFilePlan(filePlan, job);
      result.thumbnailCount = fileResult.thumbnailCount || result.fileCount;
      addLogEnd(job, t, `${label}资源目录恢复完成`);
    } catch (err: unknown) {
      addLog(job, '模块文件恢复失败，正在回滚数据库到恢复前安全快照...');
      await rollbackToSafetySnapshot(safetySnapshot, job);
      throw err;
    }

    await clearCachesAfterRestore(job);

    job.stage = 'done';
    job.percent = 100;
    job.message = `${label}恢复完成`;
    job.result = result;
    addLog(job, `${label}恢复完成: ${result.itemCount} 条记录，${result.fileCount} 个资源文件`);
    syncJob(job);
    await recordRestoreAudit(job, 'ok', {
      scope: result.scope,
      scopeLabel: result.scopeLabel,
      itemCount: result.itemCount,
      fileCount: result.fileCount,
      modelCount: result.modelCount,
      thumbnailCount: result.thumbnailCount,
    });

    log.info({ jobId: job.id, scope: manifest.scope, itemCount: result.itemCount }, 'Module restore completed');
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    job.stage = 'error';
    job.error = message;
    addLog(job, `${label}恢复失败: ${message}`);
    syncJob(job);
    await recordRestoreAudit(job, 'error', {
      scope: expectedScope,
      scopeLabel: label,
      error: message,
    });
    log.error({ err, jobId: job.id, scope: expectedScope }, 'Module restore failed');
  } finally {
    if (removeArchiveAfterExtract && existsSync(archPath)) rmSync(archPath, { force: true });
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function startRestoreWorkerProcess(job: RestoreJob, args: string[]) {
  try {
    const workerScript = fileURLToPath(new URL(`../scripts/restoreWorker${MODULE_EXT}`, import.meta.url));
    const child = spawn(process.execPath, [...process.execArgv, workerScript, job.id, ...args], {
      cwd: process.cwd(),
      env: workerEnv,
      detached: true,
      stdio: 'ignore',
    });
    if (!child.pid) throw new Error('备份恢复后台进程启动失败');
    setLockOwner(child.pid, job.id, 'manual');
    monitorWorkerExit(child, job, '备份恢复');
    child.unref();
  } catch (err: unknown) {
    const message = getErrorMessage(err) || '备份恢复后台进程启动失败';
    job.stage = 'error';
    job.error = message;
    job.message = message;
    syncJob(job);
    throw err;
  }
}

export async function runRestoreWorker(jobId: string, mode: 'backup' | 'file', target: string, removeAfter = true) {
  const stopLockKeepAlive = startLockKeepAlive(jobId);
  const job = loadJob<RestoreJob>(jobId) || {
    id: jobId,
    userId: null,
    source: mode === 'backup' ? 'backup-record' : 'import-file',
    backupId: mode === 'backup' ? target : null,
    stage: 'extracting',
    percent: 0,
    message: mode === 'backup' ? '正在解压备份文件...' : '正在上传完成，开始解压...',
    logs: [],
  };
  restoreJobs.set(job.id, job);
  syncJob(job);
  try {
    if (mode === 'backup') {
      await runRestore(job, target);
    } else {
      await runRestoreFromFile(job, target, removeAfter);
    }
  } finally {
    stopLockKeepAlive();
    releaseLockForJob(job.id);
  }
}

async function runRestoreFromArchive(
  job: RestoreJob,
  archPath: string,
  removeArchiveAfterExtract: boolean,
  preReadManifest?: BackupManifest | null,
) {
  const tmpDir = prepareWorkDir(job.id);
  const result = { dbRestored: false, modelCount: 0, thumbnailCount: 0 };
  let safetySnapshot: string | null = null;
  let readableArchivePath = archPath;

  try {
    const archiveSize = statSync(archPath).size;
    addLog(job, `开始恢复任务（备份文件 ${formatSize(archiveSize)}）...`);

    job.stage = 'extracting';
    job.percent = 5;
    job.message = '正在读取备份包...';
    syncJob(job);
    readableArchivePath = await materializeReadableBackupArchive(archPath, tmpDir);
    if (readableArchivePath !== archPath) {
      addLog(job, '备份包已解密到临时恢复目录');
    }

    // ── Phase 1: Single-pass pre-extraction (read tar ONCE) ──
    let t = addLogStart(job, '正在读取备份包文件列表...');
    let lastScanSync = 0;
    const allEntries = await listArchiveEntriesWithProgress(readableArchivePath, ({ elapsedMs, entryCount }) => {
      // 每 ~2s 更新一次进度，让前端看到扫描在动（大归档这步可能很久）
      if (elapsedMs - lastScanSync < 2000) return;
      lastScanSync = elapsedMs;
      job.message = `正在扫描备份归档... 已扫描 ${entryCount} 个条目，用时 ${Math.round(elapsedMs / 1000)}s`;
      syncJob(job);
    });
    addLogEnd(job, t, `文件列表读取完成（${allEntries.length} 个条目）`);

    t = addLogStart(job, '正在读取备份清单...');
    const archiveManifest =
      preReadManifest && archiveHasEntry(allEntries, BACKUP_MANIFEST_ENTRY)
        ? preReadManifest
        : readArchiveManifestFromEntries(readableArchivePath, allEntries);
    if (!archiveManifest) {
      throw new Error('备份包缺少清单文件，无法验证完整性');
    }
    addLogEnd(job, t, '备份清单读取完成');

    job.percent = 10;
    job.message = '正在校验备份完整性...';
    syncJob(job);

    t = addLogStart(job, '正在校验备份包完整性（条目检查 + SHA256）...');
    assertSafeArchiveEntriesForExtraction(readableArchivePath, allEntries);
    validateArchiveEntries(allEntries, archiveManifest);
    addLogEnd(job, t, '备份包完整性校验通过');

    job.percent = 15;
    job.message = '正在提取数据库文件...';
    syncJob(job);

    t = addLogStart(job, `正在从备份包提取数据库文件（${formatSize(archiveManifest.database.size)}）...`);
    const dbEntry = archiveManifest.database.path;
    const sqlPath = extractDbToTmp(readableArchivePath, tmpDir, dbEntry);
    addLogEnd(job, t, '数据库文件提取完成');
    job.percent = 25;
    syncJob(job);

    t = addLogStart(job, '正在校验数据库文件 SHA256...');
    const actualSha256 = await sha256File(sqlPath);
    if (actualSha256 !== archiveManifest.database.sha256) {
      throw new Error('数据库备份 SHA256 校验失败');
    }
    addLogEnd(job, t, '数据库文件 SHA256 校验通过');

    // ── Phase 2: Build file plan from cached entries (no tar read) ──
    job.percent = 28;
    job.message = '正在准备文件恢复计划...';
    syncJob(job);
    addLog(job, '正在预检模型、上传、静态文件目录...');

    const staticDirsToRestore = computeRestorableDirs(allEntries, archiveManifest);
    const filePlan = buildFilePlanFromEntries(
      readableArchivePath,
      tmpDir,
      allEntries,
      staticDirsToRestore,
      archiveManifest,
    );
    assertRestoreHasDiskSpace(filePlan);
    addLog(
      job,
      `文件目录预检通过: ${filePlan.staticDirs.length} 个 static 目录，${filePlan.uploadDirs.length} 个 uploads 目录`,
    );

    if (sqlPath) {
      job.stage = 'restoring_db';
      job.percent = 35;
      job.message = '正在校验备份数据库...';
      syncJob(job);

      const sqlSize = statSync(sqlPath).size;
      addLog(job, `数据库 SQL 文件大小: ${formatSize(sqlSize)}`);
      assertAvailableDiskSpace(tmpDir, sqlSize, '恢复前数据库安全快照空间不足，已中止以保护现有数据');

      const sanitizedSqlPath = join(tmpDir, 'database.restore.sql');

      const fd = openSync(sqlPath, 'r');
      const headBuffer = Buffer.alloc(100 * 1024);
      const bytesRead = readSync(fd, headBuffer, 0, headBuffer.length, 0);
      closeSync(fd);
      const headBytes = headBuffer.toString('utf-8', 0, bytesRead);
      const isFullDump = headBytes.includes('CREATE TABLE');
      addLog(job, `数据库类型: ${isFullDump ? '完整备份 (full dump)' : '数据备份 (data-only)'}`);

      job.percent = 37;
      job.message = '正在预处理数据库...';
      syncJob(job);
      t = addLogStart(job, '正在流式预处理 SQL 数据（过滤危险语句）...');
      await sanitizeSqlDumpStreaming(sqlPath, sanitizedSqlPath);
      const sanitizedSize = statSync(sanitizedSqlPath).size;
      addLogEnd(job, t, `SQL 预处理完成（输出 ${formatSize(sanitizedSize)}）`);

      job.percent = 39;
      job.message = '正在创建恢复前安全快照...';
      syncJob(job);
      t = addLogStart(job, '正在导出当前数据库安全快照（恢复失败时自动回滚）...');
      try {
        safetySnapshot = join(tmpDir, 'safety_snapshot.sql');
        pgDumpToFile(DB_URL_CLEAN, safetySnapshot, ['--no-owner', '--no-privileges'], DB_DUMP_TIMEOUT_MS);
        const snapSize = statSync(safetySnapshot).size;
        if (snapSize === 0) throw new Error('安全快照为空');
        addLogEnd(job, t, `安全快照已创建（${formatSize(snapSize)}）`);
      } catch (snapErr: unknown) {
        throw new Error(`无法创建恢复前安全快照，已中止恢复以保护数据安全: ${getErrorMessage(snapErr)}`);
      }

      // 进入破坏性阶段前，把安全快照持久化到 _safety_snapshots/ 并写 marker。
      // 临时目录里的快照会在硬崩后被 cleanupStaleBackupWorkDirs 清掉，这里先复制一份保命。
      // 持久化失败则中止恢复（与「快照创建失败即中止」一致的保守策略）。
      if (!persistPreRestoreSnapshot(safetySnapshot, job.id)) {
        throw new Error('无法持久化恢复前安全快照，已中止恢复以保障崩溃可恢复性');
      }

      if (isFullDump) {
        job.percent = 45;
        job.message = '正在重置数据库...';
        syncJob(job);
        // 即将 DROP+CREATE 数据库 schema，此后中断会留下不完整数据库，禁止取消。
        job.destructiveStarted = true;
        t = addLogStart(job, '正在重置数据库 schema（DROP + CREATE）...');
        await resetDatabaseSchema(DB_URL_CLEAN);
        addLogEnd(job, t, '数据库 schema 已重置');

        job.percent = 55;
        job.message = '正在恢复数据库...';
        syncJob(job);
        t = addLogStart(job, '正在导入数据库（psql restore）...');
        try {
          await restoreSqlIntoDatabase(DB_URL_CLEAN, sanitizedSqlPath, { disableTriggers: true });
        } catch (err) {
          if (!isForeignKeyRestoreError(err)) {
            addLog(job, '数据库导入失败，尝试回滚到安全快照...');
            await rollbackToSafetySnapshot(safetySnapshot, job);
            throw err;
          }

          if (!ALLOW_FOREIGN_KEY_SKIP_RESTORE) {
            addLog(job, '检测到外键一致性错误，已回滚到恢复前安全快照');
            await rollbackToSafetySnapshot(safetySnapshot, job);
            throw new Error(`备份数据存在外键一致性问题，已中止恢复以避免数据关系损坏: ${getErrorMessage(err)}`);
          }

          addLog(job, '检测到历史数据存在孤儿外键，改用跳过外键约束模式恢复...');
          const noFkSqlPath = join(tmpDir, 'database.restore.no-fk.sql');
          await sanitizeSqlDumpStreaming(sqlPath, noFkSqlPath, { skipForeignKeys: true });
          await resetDatabaseSchema(DB_URL_CLEAN);
          try {
            await restoreSqlIntoDatabase(DB_URL_CLEAN, noFkSqlPath, { disableTriggers: true });
            addLog(job, '数据库已恢复；部分历史外键约束因源数据不一致已跳过');
          } catch (fallbackErr) {
            addLog(job, '数据库兜底导入失败，尝试回滚到安全快照...');
            await rollbackToSafetySnapshot(safetySnapshot, job);
            throw fallbackErr;
          }
        }
        addLogEnd(job, t, '数据库导入完成');

        job.percent = 65;
        job.message = '正在检查数据库迁移...';
        syncJob(job);
        t = addLogStart(job, '正在检查并应用数据库迁移（prisma migrate deploy）...');
        try {
          runPrismaMigrations(DB_URL_CLEAN);
          addLogEnd(job, t, '数据库迁移完成');
        } catch (migrateErr) {
          const detail = extractCommandError(migrateErr);
          addLog(job, `迁移提示: ${detail}`);
          addLog(job, '迁移存在冲突，改用 schema 同步兜底...');
          try {
            runPrismaDbPush(DB_URL_CLEAN);
            addLog(job, 'schema 同步完成');
          } catch (pushErr) {
            addLog(job, `schema 同步提示: ${extractCommandError(pushErr)}`);
            log.warn({ error: extractCommandError(pushErr) }, 'Post-restore schema sync warning');
          }
        }
      } else {
        await preflightRestoreSql(sanitizedSqlPath);

        job.percent = 45;
        job.message = '正在重置数据库结构...';
        syncJob(job);
        // 即将重置数据库 schema，此后中断会留下不完整数据库，禁止取消。
        job.destructiveStarted = true;
        t = addLogStart(job, '正在重置数据库 schema (增量模式)...');
        await resetDatabaseSchema(DB_URL_CLEAN);
        addLogEnd(job, t, '数据库 schema 已重置');

        job.percent = 55;
        job.message = '正在应用数据库迁移...';
        syncJob(job);
        t = addLogStart(job, '正在应用数据库迁移...');
        runPrismaMigrations(DB_URL_CLEAN);
        addLogEnd(job, t, '数据库迁移完成');

        job.percent = 60;
        job.message = '正在准备数据导入...';
        syncJob(job);
        addLog(job, '正在处理循环外键约束...');
        const { dropCircularFKs, restoreCircularFKs } = await import('./restore-helpers.js').catch(() => ({
          dropCircularFKs: async (_dbUrl: string) => {},
          restoreCircularFKs: async (_dbUrl: string) => {},
        }));
        await dropCircularFKs(DB_URL_CLEAN);

        job.percent = 65;
        job.message = '正在导入数据库数据...';
        syncJob(job);
        t = addLogStart(job, '正在导入数据...');
        try {
          await restoreSqlIntoDatabase(DB_URL_CLEAN, sanitizedSqlPath, { disableTriggers: true });
        } catch (err) {
          addLog(job, '数据导入失败，尝试回滚到安全快照...');
          try {
            await restoreCircularFKs(DB_URL_CLEAN);
          } catch (restoreFkErr) {
            log.warn({ err: restoreFkErr }, 'Failed to restore circular foreign keys before rollback');
            addLog(job, `回滚前恢复循环外键失败: ${getErrorMessage(restoreFkErr)}`);
          }
          await rollbackToSafetySnapshot(safetySnapshot, job);
          throw err;
        }

        await restoreCircularFKs(DB_URL_CLEAN);
        addLogEnd(job, t, '数据库导入完成，外键已恢复');
      }

      // 数据库已成功导入（full dump 或 data-only 任一路径），现在处于已知良好状态。
      // 清除恢复中断 marker——此后的硬崩不会留下破损数据库，无需启动时回滚。
      clearRestoreInProgressMarker(job.id);

      result.dbRestored = true;
      job.percent = 70;
      syncJob(job);
    } else {
      addLog(job, '备份中未包含数据库文件，跳过数据库恢复');
      job.percent = 70;
      syncJob(job);
    }

    job.stage = 'restoring_files';
    job.percent = 75;
    job.message = '正在恢复备份文件目录...';
    syncJob(job);

    let restoredSourceFiles = 0;
    try {
      t = addLogStart(job, '正在恢复文件目录（模型、缩略图、上传文件）...');
      const fileResult = await commitRestoreFilePlan(filePlan, job);
      restoredSourceFiles = fileResult.restoredSourceFiles;
      result.thumbnailCount = fileResult.thumbnailCount;
      addLogEnd(job, t, `文件恢复完成（${fileResult.thumbnailCount} 张缩略图）`);
    } catch (err: unknown) {
      if (result.dbRestored) {
        addLog(job, '文件恢复失败，正在回滚数据库到恢复前安全快照...');
        await rollbackToSafetySnapshot(safetySnapshot, job);
      }
      throw err;
    }

    if (result.dbRestored) {
      try {
        result.modelCount = await countStepModelsInDatabase();
      } catch {
        log.warn({ err: {} }, 'Failed to count STEP models after restore, using file count');
        result.modelCount = restoredSourceFiles;
      }
    } else {
      result.modelCount = restoredSourceFiles;
    }

    addLog(job, `恢复完成: ${result.modelCount} 个 STEP 模型, ${result.thumbnailCount} 张缩略图`);

    await clearCachesAfterRestore(job);

    job.stage = 'done';
    job.percent = 100;
    job.message = '恢复完成';
    job.result = result;
    syncJob(job);
    await recordRestoreAudit(job, 'ok', {
      scope: 'full',
      scopeLabel: backupScopeLabel('full'),
      dbRestored: result.dbRestored,
      modelCount: result.modelCount,
      thumbnailCount: result.thumbnailCount,
    });

    log.info(
      { jobId: job.id, modelCount: result.modelCount, thumbnailCount: result.thumbnailCount },
      'Restore completed',
    );
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    job.stage = 'error';
    job.error = message;
    addLog(job, `恢复失败: ${message}`);
    syncJob(job);
    await recordRestoreAudit(job, 'error', {
      scope: 'full',
      scopeLabel: backupScopeLabel('full'),
      error: message,
    });
    log.error({ err, jobId: job.id }, 'Restore failed');
  } finally {
    if (removeArchiveAfterExtract && existsSync(archPath)) rmSync(archPath, { force: true });
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function clearCachesAfterRestore(job: { logs?: string[] }) {
  try {
    const { cacheDelByPrefix } = await import('./cache.js');
    await cacheDelByPrefix('cache:');
    addLog(job, '缓存已清理');
  } catch {
    log.warn({ err: {} }, 'Failed to clear cache after restore');
  }
  try {
    const { clearSettingsCache } = await import('./settings.js');
    clearSettingsCache();
  } catch {
    log.warn({ err: {} }, 'Failed to clear settings cache after restore');
  }
}

// ---- Download path ----

export function getBackupArchivePath(id: string): string | null {
  const p = archivePath(id);
  return existsSync(p) ? p : null;
}

// ---- Stats ----

export async function getBackupStats(): Promise<BackupStats> {
  const staticDir = join(process.cwd(), config.staticDir);
  const uploadDir = join(process.cwd(), config.uploadDir);
  const modelsDirStats = countDirs(staticDir, moduleStaticDirs('models'));
  const selectionDirStats = countDirs(staticDir, moduleStaticDirs('selection'));
  const productWallDirStats = countDirs(staticDir, moduleStaticDirs('product_wall'));
  const uploadDirStats = countDirs(uploadDir, discoverUploadBackupDirs(uploadDir));
  const thumbnailCount = countFilesRecursive(join(staticDir, 'thumbnails'), (name) => name.endsWith('.png'));
  const originalFileCount = countFilesRecursive(join(staticDir, 'originals'), isStepFileName);
  const drawingFileCount = countFilesRecursive(join(staticDir, 'drawings'));
  let modelCount = 0;
  let totalModelCount = 0;
  let modelGroupCount = 0;
  let categoryCount = 0;
  let selectionCategoryCount = 0;
  let selectionProductCount = 0;
  let threadSizeCount = 0;
  let productWallCategoryCount = 0;
  let productWallImageCount = 0;
  let settingsCount = 0;
  let dbSizeBytes = 0;
  let dbSize = 'unknown';

  try {
    const prisma = await getBackupPrisma();
    [
      modelCount,
      totalModelCount,
      modelGroupCount,
      categoryCount,
      selectionCategoryCount,
      selectionProductCount,
      threadSizeCount,
      productWallCategoryCount,
      productWallImageCount,
      settingsCount,
    ] = await Promise.all([
      prisma.model.count({ where: completedStepWhere }),
      prisma.model.count(),
      prisma.modelGroup.count(),
      prisma.category.count(),
      prisma.selectionCategory.count(),
      prisma.selectionProduct.count(),
      prisma.threadSizeEntry.count(),
      prisma.productWallCategory.count(),
      prisma.productWallImage.count(),
      prisma.setting.count(),
    ]);
    const r = await prisma.$queryRaw<
      Array<{ bytes: bigint | number; pg_size_pretty: string }>
    >`SELECT pg_database_size(current_database()) as bytes, pg_size_pretty(pg_database_size(current_database())) as pg_size_pretty`;
    dbSizeBytes = Number(r[0]?.bytes || 0);
    if (r[0]?.pg_size_pretty) dbSize = r[0].pg_size_pretty;
  } catch {
    log.warn({ err: {} }, 'Failed to query database stats for backup overview');
  }

  const resourceFileCount =
    modelsDirStats.fileCount + selectionDirStats.fileCount + productWallDirStats.fileCount + uploadDirStats.fileCount;
  const resourceSize =
    modelsDirStats.totalBytes +
    selectionDirStats.totalBytes +
    productWallDirStats.totalBytes +
    uploadDirStats.totalBytes;

  return {
    modelCount,
    thumbnailCount,
    dbSize,
    dbSizeBytes,
    totalModelCount,
    modelGroupCount,
    categoryCount,
    originalFileCount,
    drawingFileCount,
    modelResourceFileCount: modelsDirStats.fileCount,
    modelResourceSize: modelsDirStats.totalBytes,
    modelResourceSizeText: formatSize(modelsDirStats.totalBytes),
    selectionCategoryCount,
    selectionProductCount,
    threadSizeCount,
    selectionResourceFileCount: selectionDirStats.fileCount,
    selectionResourceSize: selectionDirStats.totalBytes,
    selectionResourceSizeText: formatSize(selectionDirStats.totalBytes),
    productWallCategoryCount,
    productWallImageCount,
    settingsCount,
    productWallResourceFileCount: productWallDirStats.fileCount,
    productWallResourceSize: productWallDirStats.totalBytes,
    productWallResourceSizeText: formatSize(productWallDirStats.totalBytes),
    uploadResourceFileCount: uploadDirStats.fileCount,
    uploadResourceSize: uploadDirStats.totalBytes,
    uploadResourceSizeText: formatSize(uploadDirStats.totalBytes),
    resourceFileCount,
    resourceSize,
    resourceSizeText: formatSize(resourceSize),
    totalDataSize: dbSizeBytes + resourceSize,
    totalDataSizeText: formatSize(dbSizeBytes + resourceSize),
  };
}

// ---- Helpers ----

async function inspectBackupArchive(id: string, archive: string, originalName: string): Promise<BackupRecord> {
  const fileSize = statSync(archive).size;
  if (fileSize <= 0) {
    throw new Error('备份文件为空');
  }

  const tmpDir = prepareWorkDir(`peek_${id}`);
  try {
    const readableArchive = await materializeReadableBackupArchive(archive, tmpDir);
    const entries = listArchiveEntries(readableArchive);
    if (entries.length === 0) {
      throw new Error('备份归档内容为空');
    }
    const rawManifest = readArchiveManifest(readableArchive) as unknown;
    if (isModuleBackupManifest(rawManifest)) {
      return await inspectModuleBackupArchive(id, archive, readableArchive, originalName, rawManifest);
    }

    const manifest = await validatePlainBackupArchive(readableArchive);
    const hasDbFile = entries.includes('_backup_db/database.sql') || entries.includes('database.sql');
    if (!hasDbFile) {
      throw new Error('备份包缺少数据库文件');
    }

    const encrypted = isEncryptedBackupArchiveFile(archive);
    const record: BackupRecord = {
      id,
      filename: `${id}.tar.gz`,
      name: `导入 ${stripBackupArchiveExtension(originalName)}`,
      createdAt: new Date().toISOString(),
      fileSize,
      fileSizeText: formatSize(fileSize),
      modelCount: 0,
      thumbnailCount: entries.filter((entry) => entry.startsWith('thumbnails/') && entry.endsWith('.png')).length,
      dbSize: 'unknown',
      countMode: 'step_models',
      encrypted,
      encryptionAlgorithm: encrypted ? BACKUP_ENCRYPTION_ALGORITHM : undefined,
      manifestVersion: manifest?.schemaVersion,
      verifiedAt: manifest ? new Date().toISOString() : undefined,
    };

    try {
      // Try both possible locations for meta.json
      const metaLocations = ['_backup_db/meta.json', 'meta.json'];
      for (const loc of metaLocations) {
        try {
          execFileSync('tar', ['xzf', readableArchive, '-C', tmpDir, loc], {
            stdio: 'pipe',
            timeout: ARCHIVE_META_TIMEOUT_MS,
          });
          const metaFile = join(tmpDir, loc);
          if (existsSync(metaFile)) {
            const meta = JSON.parse(readFileSync(metaFile, 'utf-8'));
            if (meta.timestamp) record.createdAt = meta.timestamp;
            break;
          }
        } catch {
          log.debug({ loc }, 'Failed to extract backup meta.json location');
        }
      }
    } catch {
      // Metadata is optional for imports from older versions.
      log.debug({ err: {} }, 'Backup metadata extraction failed (optional)');
    }

    try {
      const sqlPath = extractRestoreSqlPath(readableArchive, tmpDir);
      if (sqlPath) {
        record.modelCount = await countStepModelsInSqlDump(sqlPath);
      }
    } catch {
      log.debug({ err: {} }, 'Backup model count failed (optional)');
    }

    if (record.modelCount <= 0) {
      record.modelCount = entries.filter((entry) => entry.startsWith('originals/') && isArchiveStepEntry(entry)).length;
    }

    const originalsCount = entries.filter((entry) => entry.startsWith('originals/') && !entry.endsWith('/')).length;
    if (originalsCount > 0) {
      record.name += ` (${originalsCount} 原始文件)`;
    }

    return record;
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function inspectModuleBackupArchive(
  id: string,
  archive: string,
  readableArchive: string,
  originalName: string,
  manifest: ModuleBackupManifest,
): Promise<BackupRecord> {
  await validateModuleBackupArchive(readableArchive, { expectedManifest: manifest });
  const tmpDir = prepareWorkDir(`peek_module_${id}`);
  try {
    const dataPath = extractModuleDataToTmp(readableArchive, tmpDir, manifest);
    const payload = readModulePayload(dataPath, manifest.scope);
    const itemCount = countModulePayloadItems(payload);
    const fileSize = statSync(archive).size;
    const encrypted = isEncryptedBackupArchiveFile(archive);
    return {
      id,
      filename: `${id}.tar.gz`,
      name: `导入${backupScopeLabel(manifest.scope)} ${stripBackupArchiveExtension(originalName)}`,
      scope: manifest.scope,
      scopeLabel: backupScopeLabel(manifest.scope),
      createdAt: manifest.generatedAt || new Date().toISOString(),
      fileSize,
      fileSizeText: formatSize(fileSize),
      modelCount: manifest.scope === 'models' ? Number(payload.tables.models?.length || 0) : itemCount,
      thumbnailCount: manifest.directories.reduce((sum, dir) => sum + dir.fileCount, 0),
      dbSize: `${itemCount} 条记录`,
      countMode: manifest.scope === 'models' ? 'step_models' : undefined,
      encrypted,
      encryptionAlgorithm: encrypted ? BACKUP_ENCRYPTION_ALGORITHM : undefined,
      manifestVersion: manifest.schemaVersion,
      verifiedAt: new Date().toISOString(),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function extractModuleDataToTmp(archive: string, tmpDir: string, manifest: ModuleBackupManifest): string {
  if (!extractArchiveEntry(archive, tmpDir, manifest.data.path)) {
    throw new Error(`模块备份包缺少数据文件: ${manifest.data.path}`);
  }
  return join(tmpDir, manifest.data.path);
}

function readModulePayload(dataPath: string, expectedScope: Exclude<BackupScope, 'full'>): ModuleBackupPayload {
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8')) as unknown;
  if (!isPlainRecord(raw)) throw new Error('模块备份数据格式无效');
  if (raw.schemaVersion !== MODULE_BACKUP_SCHEMA_VERSION) {
    throw new Error(`不支持的模块备份数据版本: ${String(raw.schemaVersion || '')}`);
  }
  if (raw.scope !== expectedScope) {
    throw new Error(`模块备份数据类型不匹配: 期望 ${backupScopeLabel(expectedScope)}`);
  }
  if (!isPlainRecord(raw.tables)) throw new Error('模块备份数据缺少表数据');
  return raw as unknown as ModuleBackupPayload;
}

function buildModuleFilePlanFromManifest(
  archive: string,
  tmpDir: string,
  manifest: ModuleBackupManifest,
): RestoreFilePlan {
  const staticDir = join(process.cwd(), config.staticDir);
  const allowedDirs = new Set(moduleStaticDirs(manifest.scope));
  const plan: RestoreFilePlan = { archive, stagingRoot: join(tmpDir, 'restore_files'), staticDirs: [], uploadDirs: [] };

  for (const dir of manifest.directories) {
    if (!allowedDirs.has(dir.path)) continue;
    plan.staticDirs.push({
      dir: dir.path,
      destination: join(staticDir, dir.path),
      archiveEntry: dir.path,
    });
  }

  return plan;
}

async function restoreModulePayload(payload: ModuleBackupPayload, job: RestoreJob): Promise<number> {
  const prisma = await getBackupPrisma();
  return prisma.$transaction(
    async (tx) => {
      if (payload.scope === 'models') return restoreModelsModule(tx, payload, job);
      if (payload.scope === 'selection') return restoreSelectionModule(tx, payload);
      if (payload.scope === 'config') return restoreConfigModule(tx, payload);
      return restoreProductWallModule(tx, payload);
    },
    { maxWait: 60_000, timeout: DB_RESTORE_TIMEOUT_MS },
  );
}

async function restoreModelsModule(
  tx: RestoreTransaction,
  payload: ModuleBackupPayload,
  job: RestoreJob,
): Promise<number> {
  await tx.$executeRawUnsafe(
    'TRUNCATE TABLE "model_versions", "favorites", "downloads", "comments", "share_links", "models", "model_groups", "categories" RESTART IDENTITY CASCADE',
  );

  const categories = tableRows(payload, 'categories');
  const modelGroups = tableRows(payload, 'modelGroups');
  const models = tableRows(payload, 'models');
  const modelVersions = tableRows(payload, 'modelVersions');
  const favorites = tableRows(payload, 'favorites');
  const downloads = tableRows(payload, 'downloads');
  const comments = tableRows(payload, 'comments');
  const shareLinks = tableRows(payload, 'shareLinks');
  const userContext = await getRestoreUserContext(
    tx,
    models.length > 0 ||
      modelVersions.length > 0 ||
      favorites.length > 0 ||
      downloads.length > 0 ||
      comments.length > 0 ||
      shareLinks.length > 0,
  );
  const projectIds = new Set<string>(
    (await tx.project.findMany({ select: { id: true } })).map((item: { id: string }) => item.id),
  );

  await restoreCategoryRows(tx, categories);

  const groupIds = new Set<string>();
  const groupPrimaryById = new Map<string, string>();
  const groupUpdatedAtById = new Map<string, Date>();
  const groupData = modelGroups
    .map((row) => {
      const data = reviveDateFields(row, ['createdAt', 'updatedAt']);
      const id = stringValue(data.id);
      if (!id) return null;
      const primaryId = stringValue(data.primaryId);
      if (primaryId) groupPrimaryById.set(id, primaryId);
      if (data.updatedAt instanceof Date) groupUpdatedAtById.set(id, data.updatedAt);
      data.primaryId = null;
      groupIds.add(id);
      return data;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  await createManyInChunks(tx.modelGroup, groupData);

  const categoryIds = new Set(categories.map((row) => stringValue(row.id)).filter((id): id is string => Boolean(id)));
  const modelIds = new Set<string>();
  const modelData = models
    .map((row) => {
      const data = reviveDateFields(row, ['createdAt', 'updatedAt', 'fileModifiedAt']);
      const id = stringValue(data.id);
      if (!id) return null;
      data.categoryId = keepIdIfPresent(data.categoryId, categoryIds);
      data.groupId = keepIdIfPresent(data.groupId, groupIds);
      data.projectId = keepIdIfPresent(data.projectId, projectIds);
      data.createdById = pickRestoreUserId(data.createdById, userContext);
      modelIds.add(id);
      return data;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  await createManyInChunks(tx.model, modelData);

  const versionData = modelVersions
    .map((row) => {
      const data = reviveDateFields(row, ['createdAt']);
      data.modelId = keepIdIfPresent(data.modelId, modelIds);
      if (!data.modelId) return null;
      data.createdById = pickRestoreUserId(data.createdById, userContext);
      return data;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  await createManyInChunks(tx.modelVersion, versionData);

  const favoriteData = dedupeRowsByKeys(
    favorites
      .map((row) => {
        const data = reviveDateFields(row, ['createdAt']);
        data.userId = pickRestoreUserId(data.userId, userContext);
        data.modelId = keepIdIfPresent(data.modelId, modelIds);
        return data.modelId ? data : null;
      })
      .filter((row): row is Record<string, unknown> => Boolean(row)),
    ['userId', 'modelId'],
  );
  await createManyInChunks(tx.favorite, favoriteData);

  const downloadData = downloads
    .map((row) => {
      const data = reviveDateFields(row, ['createdAt']);
      data.userId = pickRestoreUserId(data.userId, userContext);
      data.modelId = keepIdIfPresent(data.modelId, modelIds);
      return data.modelId ? data : null;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  await createManyInChunks(tx.download, downloadData);

  const commentData = comments
    .map((row) => {
      const data = reviveDateFields(row, ['createdAt']);
      data.userId = pickRestoreUserId(data.userId, userContext);
      data.modelId = keepIdIfPresent(data.modelId, modelIds);
      return data.modelId ? data : null;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  await createManyInChunks(tx.comment, commentData);

  const shareLinkData = shareLinks
    .map((row) => {
      const data = reviveDateFields(row, ['createdAt', 'expiresAt']);
      data.createdById = pickRestoreUserId(data.createdById, userContext);
      data.modelId = keepIdIfPresent(data.modelId, modelIds);
      return data.modelId ? data : null;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  await createManyInChunks(tx.shareLink, shareLinkData);

  for (const [id, primaryId] of groupPrimaryById.entries()) {
    if (!modelIds.has(primaryId)) continue;
    await tx.modelGroup.update({
      where: { id },
      data: { primaryId, ...(groupUpdatedAtById.has(id) ? { updatedAt: groupUpdatedAtById.get(id) } : {}) },
    });
  }

  addLog(
    job,
    `模型库表已重建: ${modelData.length} 个模型，${versionData.length} 个版本，${favoriteData.length} 条收藏，${downloadData.length} 条下载，${commentData.length} 条评论，${shareLinkData.length} 条分享`,
  );
  return (
    modelData.length +
    versionData.length +
    favoriteData.length +
    downloadData.length +
    commentData.length +
    shareLinkData.length
  );
}

async function restoreSelectionModule(tx: RestoreTransaction, payload: ModuleBackupPayload): Promise<number> {
  await tx.$executeRawUnsafe(
    'TRUNCATE TABLE "selection_shares", "selection_products", "selection_categories", "thread_size_entries" RESTART IDENTITY CASCADE',
  );

  const categories = tableRows(payload, 'selectionCategories').map((row) =>
    reviveDateFields(row, ['createdAt', 'updatedAt']),
  );
  await createManyInChunks(tx.selectionCategory, categories);
  const categoryIds = new Set(categories.map((row) => stringValue(row.id)).filter((id): id is string => Boolean(id)));

  const products = tableRows(payload, 'selectionProducts')
    .map((row) => {
      const data = reviveDateFields(row, ['createdAt', 'updatedAt']);
      data.categoryId = keepIdIfPresent(data.categoryId, categoryIds);
      return data.categoryId ? data : null;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  await createManyInChunks(tx.selectionProduct, products);

  const threadSizes = tableRows(payload, 'threadSizeEntries').map((row) =>
    reviveDateFields(row, ['createdAt', 'updatedAt']),
  );
  await createManyInChunks(tx.threadSizeEntry, threadSizes);

  const selectionShares = tableRows(payload, 'selectionShares');
  const userContext = await getRestoreUserContext(tx, selectionShares.length > 0);
  const shareData = selectionShares
    .map((row) => {
      const data = reviveDateFields(row, ['createdAt']);
      data.createdById = pickRestoreUserId(data.createdById, userContext);
      return data;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  await createManyInChunks(tx.selectionShare, shareData);

  return categories.length + products.length + threadSizes.length + shareData.length;
}

async function restoreProductWallModule(tx: RestoreTransaction, payload: ModuleBackupPayload): Promise<number> {
  await tx.$executeRawUnsafe(
    'TRUNCATE TABLE "product_wall_image_favorites", "product_wall_images", "product_wall_categories" RESTART IDENTITY CASCADE',
  );

  const categories = tableRows(payload, 'productWallCategories').map((row) =>
    reviveDateFields(row, ['createdAt', 'updatedAt']),
  );
  await createManyInChunks(tx.productWallCategory, categories);

  const imageFavorites = tableRows(payload, 'productWallImageFavorites');
  const userContext = await getRestoreUserContext(tx, imageFavorites.length > 0);
  const images = tableRows(payload, 'productWallImages').map((row) => {
    const data = reviveDateFields(row, ['createdAt', 'updatedAt', 'reviewedAt']);
    data.uploaderId = keepIdIfPresent(data.uploaderId, userContext.ids);
    data.reviewedById = keepIdIfPresent(data.reviewedById, userContext.ids);
    return data;
  });
  await createManyInChunks(tx.productWallImage, images);

  const imageIds = new Set(images.map((row) => stringValue(row.id)).filter((id): id is string => Boolean(id)));
  const favoriteData = dedupeRowsByKeys(
    imageFavorites
      .map((row) => {
        const data = reviveDateFields(row, ['createdAt']);
        data.userId = pickRestoreUserId(data.userId, userContext);
        data.imageId = keepIdIfPresent(data.imageId, imageIds);
        return data.imageId ? data : null;
      })
      .filter((row): row is Record<string, unknown> => Boolean(row)),
    ['userId', 'imageId'],
  );
  await createManyInChunks(tx.productWallImageFavorite, favoriteData);

  return categories.length + images.length + favoriteData.length;
}

/**
 * Restore the "系统配置" module: site settings (key-value) + model categories.
 *
 * settings is a standalone key-value table (no inbound FKs) → safe to TRUNCATE + bulk insert.
 *
 * categories is referenced by models via models_category_id_fkey (ON DELETE SET NULL),
 * so it MUST NOT be truncated — that would null out every model's category. Instead we
 * upsert each category by id (parent-first topological order) so existing rows are updated
 * and new ones inserted without disturbing model references.
 */
async function restoreConfigModule(tx: RestoreTransaction, payload: ModuleBackupPayload): Promise<number> {
  // Settings — standalone key-value table, clean slate. Dedupe by `key` (unique
  // constraint) defensively so a tampered/legacy backup with duplicate keys
  // doesn't fail the whole createMany.
  const settings = dedupeRowsByKeys(
    tableRows(payload, 'settings').map((row) => reviveDateFields(row, ['updatedAt'])),
    ['key'],
  );
  await tx.$executeRawUnsafe('TRUNCATE TABLE "settings" RESTART IDENTITY');
  await createManyInChunks(tx.setting, settings);

  // Categories — upsert by id, parents first (parentId self-FK).
  const categories = tableRows(payload, 'categories').map((row) => reviveDateFields(row, ['createdAt', 'updatedAt']));
  const knownIds = new Set(categories.map((row) => stringValue(row.id)).filter((id): id is string => Boolean(id)));
  const pending = [...categories];
  const done = new Set<string>();
  while (pending.length > 0) {
    let progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const row = pending[index];
      const id = stringValue(row.id);
      if (!id) {
        pending.splice(index, 1);
        progressed = true;
        continue;
      }
      const parentId = stringValue(row.parentId);
      // Parent exists in the backup but isn't upserted yet → wait for it.
      if (parentId && knownIds.has(parentId) && !done.has(parentId)) continue;
      // Keep the link only if the parent was actually restored; otherwise detach to avoid a dangling FK.
      if (parentId && !(knownIds.has(parentId) && done.has(parentId))) {
        row.parentId = null;
      }
      await tx.category.upsert({
        where: { id },
        create: row as Prisma.CategoryUncheckedCreateInput,
        update: row as Prisma.CategoryUncheckedUpdateInput,
      });
      done.add(id);
      pending.splice(index, 1);
      progressed = true;
    }
    if (!progressed) break; // cycle / unresolvable parents — bail out safely
  }

  return settings.length + categories.length;
}

async function restoreCategoryRows(tx: RestoreTransaction, rows: Record<string, unknown>[]) {
  const knownIds = new Set(rows.map((row) => stringValue(row.id)).filter((id): id is string => Boolean(id)));
  const pending = rows.map((row) => reviveDateFields(row, ['createdAt', 'updatedAt']));
  const created = new Set<string>();

  while (pending.length > 0) {
    let progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const row = pending[index];
      const id = stringValue(row.id);
      if (!id) {
        pending.splice(index, 1);
        progressed = true;
        continue;
      }
      const parentId = stringValue(row.parentId);
      if (parentId && knownIds.has(parentId) && !created.has(parentId)) continue;
      row.parentId = parentId && created.has(parentId) ? parentId : null;
      await tx.category.create({ data: row as Prisma.CategoryUncheckedCreateInput });
      created.add(id);
      pending.splice(index, 1);
      progressed = true;
    }
    if (!progressed) {
      for (const row of pending) {
        const id = stringValue(row.id);
        if (!id) continue;
        row.parentId = null;
        await tx.category.create({ data: row as Prisma.CategoryUncheckedCreateInput });
        created.add(id);
      }
      pending.length = 0;
    }
  }
}

async function createManyInChunks(model: unknown, data: Record<string, unknown>[], size = 500) {
  const delegate = model as CreateManyDelegate;
  for (let index = 0; index < data.length; index += size) {
    const chunk = data.slice(index, index + size);
    if (chunk.length > 0) await delegate.createMany({ data: chunk });
  }
}

function dedupeRowsByKeys(rows: Record<string, unknown>[], keys: string[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const fingerprint = keys.map((key) => String(row[key] ?? '')).join('\u0000');
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

async function getRestoreUserContext(
  tx: RestoreTransaction,
  requireFallback: boolean,
): Promise<{ ids: Set<string>; fallbackId: string | null }> {
  const users = (await tx.user.findMany({
    select: { id: true, role: true },
    orderBy: { createdAt: 'asc' },
  })) as Array<{ id: string; role?: string | null }>;
  const ids = new Set(users.map((user) => user.id));
  const fallbackId = users.find((user) => user.role === 'ADMIN')?.id || users[0]?.id || null;
  if (requireFallback && !fallbackId) {
    throw new Error('当前系统没有可用用户，无法恢复模型创建人信息');
  }
  return { ids, fallbackId };
}

function pickRestoreUserId(value: unknown, context: { ids: Set<string>; fallbackId: string | null }): string {
  const id = stringValue(value);
  if (id && context.ids.has(id)) return id;
  if (!context.fallbackId) throw new Error('当前系统没有可用用户，无法恢复用户关联数据');
  return context.fallbackId;
}

function tableRows(payload: ModuleBackupPayload, key: string): Record<string, unknown>[] {
  const value = payload.tables[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainRecord).map((row) => ({ ...row }));
}

export function reviveDateFields(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const next = { ...row };
  for (const field of fields) {
    if (next[field] == null) continue;
    const date = new Date(String(next[field]));
    if (!Number.isNaN(date.getTime())) next[field] = date;
  }
  return next;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function keepIdIfPresent(value: unknown, ids: Set<string>): string | null {
  const id = stringValue(value);
  return id && ids.has(id) ? id : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertArchiveContainsOnlyRegularFilesAndDirectories(archive: string) {
  const raw = execFileSync('tar', ['tvzf', archive], {
    stdio: 'pipe',
    timeout: ARCHIVE_LIST_TIMEOUT_MS,
  }).toString('utf-8');
  const unsafeLine = raw.split(/\r?\n/).find(isUnsafeBackupArchiveVerboseEntry);
  if (unsafeLine) {
    throw new Error(`备份包包含符号链接、硬链接或特殊文件，已中止恢复: ${summarizeTarVerboseLine(unsafeLine)}`);
  }
}

function assertSafeArchiveEntriesForExtraction(archive: string, entries: string[]) {
  const unsafeEntry = entries.find(isUnsafeBackupArchiveEntry);
  if (unsafeEntry) {
    throw new Error(`备份包包含不安全路径: ${unsafeEntry}`);
  }
  assertArchiveContainsOnlyRegularFilesAndDirectories(archive);
}

function listArchiveEntries(archive: string): string[] {
  const raw = execFileSync('tar', ['tzf', archive], { stdio: 'pipe', timeout: ARCHIVE_LIST_TIMEOUT_MS }).toString();
  return normalizeBackupArchiveEntryList(raw);
}

function listArchiveEntriesWithProgress(
  archive: string,
  onProgress?: (info: { elapsedMs: number; entryCount: number }) => void,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const entries: string[] = [];
    let bufferedLine = '';
    let stderr = '';
    let settled = false;
    const proc = spawn('tar', ['tzf', archive], { stdio: ['ignore', 'pipe', 'pipe'] });
    const heartbeat = setInterval(() => {
      onProgress?.({ elapsedMs: Date.now() - startedAt, entryCount: entries.length });
    }, 5000);
    const timeout = setTimeout(() => {
      if (settled) return;
      proc.kill('SIGKILL');
      reject(new Error(`tar list timed out after ${Math.round(ARCHIVE_LIST_TIMEOUT_MS / 1000)}s`));
    }, ARCHIVE_LIST_TIMEOUT_MS);

    proc.stdout?.on('data', (chunk: Buffer) => {
      const parts = `${bufferedLine}${chunk.toString('utf-8')}`.split(/\r?\n/);
      bufferedLine = parts.pop() || '';
      for (const line of parts) {
        const normalized = normalizeArchiveEntryLine(line);
        if (normalized) entries.push(normalized);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (code === 0) {
        const normalizedRemainder = normalizeArchiveEntryLine(bufferedLine);
        if (normalizedRemainder) entries.push(normalizedRemainder);
        onProgress?.({ elapsedMs: Date.now() - startedAt, entryCount: entries.length });
        resolve(entries);
      } else {
        onProgress?.({ elapsedMs: Date.now() - startedAt, entryCount: entries.length });
        reject(new Error(`tar list failed (code ${code ?? 'unknown'}): ${stderr}`));
      }
    });
  });
}

async function createBackupManifest(
  backupId: string,
  databaseSqlPath: string,
  directoriesToCheck: readonly ArchiveDirectorySpec[],
): Promise<BackupManifest> {
  for (const dir of directoriesToCheck) assertDirectoryContainsNoSymlinks(dir.source, dir.path);
  const directories: BackupManifestDirectory[] = directoriesToCheck.map((dir) => {
    const stats = countFilesAndBytesRecursive(dir.source);
    return { path: dir.path, fileCount: stats.fileCount, totalBytes: stats.totalBytes };
  });

  const requiredEntries = [
    BACKUP_DATABASE_ENTRY,
    BACKUP_META_ENTRY,
    BACKUP_MANIFEST_ENTRY,
    ...directoriesToCheck.map((dir) => dir.path),
  ];

  return {
    schemaVersion: '3.0',
    backupId,
    generatedAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    database: {
      path: BACKUP_DATABASE_ENTRY,
      size: statSync(databaseSqlPath).size,
      sha256: await sha256File(databaseSqlPath),
    },
    directories,
    requiredEntries,
  };
}

function readArchiveManifestFromEntries(archive: string, entries: string[]): BackupManifest | null {
  if (!archiveHasEntry(entries, BACKUP_MANIFEST_ENTRY)) return null;
  return readArchiveManifest(archive);
}

function validateArchiveEntries(entries: string[], manifest: BackupManifest): void {
  if (entries.length === 0) throw new Error('备份归档内容为空');
  const unsafeEntry = entries.find(isUnsafeBackupArchiveEntry);
  if (unsafeEntry) {
    throw new Error(`备份包包含不安全路径: ${unsafeEntry}`);
  }
  if (manifest.schemaVersion !== '3.0') {
    throw new Error(`不支持的备份清单版本: ${manifest.schemaVersion}`);
  }
  if (!archiveHasEntry(entries, manifest.database.path)) {
    throw new Error(`备份包缺少数据库文件: ${manifest.database.path}`);
  }
  for (const entry of manifest.requiredEntries) {
    if (!archiveHasEntry(entries, entry)) {
      throw new Error(`备份包缺少必要条目: ${entry}`);
    }
  }
  for (const dir of manifest.directories) {
    if (!archiveHasEntry(entries, dir.path)) {
      throw new Error(`备份包缺少业务目录: ${dir.path}`);
    }
    const archivedCount = countArchiveFiles(entries, dir.path);
    if (archivedCount !== dir.fileCount) {
      throw new Error(`备份目录文件数不一致: ${dir.path} manifest=${dir.fileCount}, archive=${archivedCount}`);
    }
  }
}

function extractDbToTmp(archive: string, tmpDir: string, dbEntry: string): string {
  if (!extractArchiveEntry(archive, tmpDir, dbEntry)) {
    throw new Error(`备份包缺少数据库文件: ${dbEntry}`);
  }
  return join(tmpDir, dbEntry);
}

function computeRestorableDirs(entries: string[], manifest: BackupManifest): string[] {
  const dirs = manifest.directories.map((dir) => dir.path);
  const staticDirs = dirs
    .filter((dir) => !dir.startsWith(`${BACKUP_DB_ENTRY_DIR}/`) && dir !== BACKUP_DB_ENTRY_DIR)
    .filter((dir) => !STATIC_BACKUP_EXCLUDE_DIRS.has(dir))
    .filter((dir) => !dir.startsWith('.') && !dir.startsWith('_'));
  const priority = RESTORE_PRIORITY_DIRS.filter((dir) => staticDirs.includes(dir));
  const rest = staticDirs.filter((dir) => !priority.includes(dir)).sort((a, b) => a.localeCompare(b));
  return [...priority, ...rest];
}

function buildFilePlanFromEntries(
  archive: string,
  tmpDir: string,
  entries: string[],
  staticDirsToRestore: string[],
  _manifest: BackupManifest,
): RestoreFilePlan {
  const staticDir = join(process.cwd(), config.staticDir);
  const uploadDir = join(process.cwd(), config.uploadDir);
  const plan: RestoreFilePlan = { archive, stagingRoot: join(tmpDir, 'restore_files'), staticDirs: [], uploadDirs: [] };

  for (const dir of staticDirsToRestore) {
    if (!archiveHasEntry(entries, dir)) continue;
    plan.staticDirs.push({
      dir,
      destination: join(staticDir, dir),
      archiveEntry: dir,
    });
  }

  const uploadPrefix = `${BACKUP_UPLOADS_ENTRY}/`;
  const uploadNames = Array.from(
    new Set(
      entries
        .filter((entry) => entry.startsWith(uploadPrefix))
        .map((entry) => entry.slice(uploadPrefix.length).split('/')[0])
        .filter(Boolean),
    ),
  )
    .filter((name) => !UPLOAD_BACKUP_EXCLUDE_DIRS.has(name))
    .sort((a, b) => a.localeCompare(b));
  for (const name of uploadNames) {
    plan.uploadDirs.push({
      name,
      destination: join(uploadDir, name),
      archiveEntry: `${BACKUP_UPLOADS_ENTRY}/${name}`,
    });
  }

  if (plan.uploadDirs.length === 0 && archiveHasEntry(entries, BACKUP_UPLOAD_METADATA_ENTRY)) {
    plan.legacyMetadata = {
      name: '.metadata',
      destination: join(uploadDir, '.metadata'),
      archiveEntry: BACKUP_UPLOAD_METADATA_ENTRY,
    };
  }

  return plan;
}

async function validateBackupArchive(
  archive: string,
  options: {
    expectedManifest?: BackupManifest;
    requireManifest?: boolean;
    onEntryProgress?: (info: { elapsedMs: number; entryCount: number }) => void;
  } = {},
): Promise<BackupManifest | null> {
  return withReadableBackupArchive(archive, (readableArchive) => validatePlainBackupArchive(readableArchive, options));
}

function isModuleBackupManifest(value: unknown): value is ModuleBackupManifest {
  const manifest = value as Partial<ModuleBackupManifest> | null | undefined;
  return (
    manifest?.schemaVersion === MODULE_BACKUP_SCHEMA_VERSION &&
    (manifest.scope === 'models' ||
      manifest.scope === 'selection' ||
      manifest.scope === 'product_wall' ||
      manifest.scope === 'config') &&
    manifest.data?.path === MODULE_BACKUP_DATA_ENTRY
  );
}

async function readBackupManifestForKind(archive: string): Promise<BackupManifest | ModuleBackupManifest | null> {
  return withReadableBackupArchive(
    archive,
    async (readableArchive) => readArchiveManifest(readableArchive) as BackupManifest | ModuleBackupManifest | null,
  );
}

async function validateBackupArchiveByKind(archive: string): Promise<BackupManifest | ModuleBackupManifest | null> {
  const rawManifest = await readBackupManifestForKind(archive);
  if (isModuleBackupManifest(rawManifest)) {
    return await validateModuleBackupArchive(archive, { expectedManifest: rawManifest });
  }
  return await validateBackupArchive(archive, { requireManifest: true });
}

async function validateModuleBackupArchive(
  archive: string,
  options: {
    expectedManifest?: ModuleBackupManifest;
    onEntryProgress?: (info: { elapsedMs: number; entryCount: number }) => void;
  } = {},
): Promise<ModuleBackupManifest> {
  return withReadableBackupArchive(archive, async (readableArchive) => {
    if (!existsSync(readableArchive)) throw new Error('备份文件不存在');
    if (statSync(readableArchive).size <= 0) throw new Error('备份文件为空');
    const entries = await listArchiveEntriesWithProgress(readableArchive, options.onEntryProgress);
    if (entries.length === 0) throw new Error('备份归档内容为空');
    assertSafeArchiveEntriesForExtraction(readableArchive, entries);

    const archiveManifest = readArchiveManifest(readableArchive) as unknown;
    if (!isModuleBackupManifest(archiveManifest)) {
      throw new Error('备份包不是有效的模块备份');
    }
    const manifest = options.expectedManifest || archiveManifest;
    if (options.expectedManifest && JSON.stringify(options.expectedManifest) !== JSON.stringify(archiveManifest)) {
      throw new Error('模块备份清单内容与打包前清单不一致');
    }

    const allowedDirs = new Set(moduleStaticDirs(manifest.scope));
    const unexpectedDir = manifest.directories.find((dir) => !allowedDirs.has(dir.path));
    if (unexpectedDir) {
      throw new Error(`模块备份包含不属于${backupScopeLabel(manifest.scope)}的目录: ${unexpectedDir.path}`);
    }

    for (const entry of manifest.requiredEntries) {
      if (!archiveHasEntry(entries, entry)) {
        throw new Error(`备份包缺少必要条目: ${entry}`);
      }
    }

    const dataStats = await inspectArchiveDatabase(readableArchive, manifest.data.path);
    if (dataStats.size !== manifest.data.size) {
      throw new Error(`模块数据大小不一致: manifest=${manifest.data.size}, archive=${dataStats.size}`);
    }
    if (dataStats.sha256 !== manifest.data.sha256) {
      throw new Error('模块数据 SHA256 校验失败');
    }

    for (const dir of manifest.directories) {
      if (!archiveHasEntry(entries, dir.path)) {
        throw new Error(`备份包缺少业务目录: ${dir.path}`);
      }
      const archivedCount = countArchiveFiles(entries, dir.path);
      if (archivedCount !== dir.fileCount) {
        throw new Error(`备份目录文件数不一致: ${dir.path} manifest=${dir.fileCount}, archive=${archivedCount}`);
      }
    }

    return manifest;
  });
}

async function validatePlainBackupArchive(
  archive: string,
  options: {
    expectedManifest?: BackupManifest;
    requireManifest?: boolean;
    onEntryProgress?: (info: { elapsedMs: number; entryCount: number }) => void;
  } = {},
): Promise<BackupManifest | null> {
  if (!existsSync(archive)) throw new Error('备份文件不存在');
  const archiveSize = statSync(archive).size;
  if (archiveSize <= 0) throw new Error('备份文件为空');

  const entries = await listArchiveEntriesWithProgress(archive, options.onEntryProgress);
  if (entries.length === 0) throw new Error('备份归档内容为空');
  assertSafeArchiveEntriesForExtraction(archive, entries);
  if (!archiveHasEntry(entries, BACKUP_DATABASE_ENTRY) && !archiveHasEntry(entries, 'database.sql')) {
    throw new Error('备份包缺少数据库文件');
  }

  const archiveManifest = readArchiveManifest(archive);
  const manifest = options.expectedManifest || archiveManifest;
  if (!manifest) {
    if (options.requireManifest) throw new Error(`备份包缺少企业级清单文件: ${BACKUP_MANIFEST_ENTRY}`);
    return null;
  }
  if (options.expectedManifest && !archiveManifest) {
    throw new Error(`备份包缺少企业级清单文件: ${BACKUP_MANIFEST_ENTRY}`);
  }
  if (
    options.expectedManifest &&
    archiveManifest &&
    JSON.stringify(options.expectedManifest) !== JSON.stringify(archiveManifest)
  ) {
    throw new Error('备份包清单内容与打包前清单不一致');
  }

  if (manifest.schemaVersion !== '3.0') {
    throw new Error(`不支持的备份清单版本: ${manifest.schemaVersion}`);
  }

  for (const entry of manifest.requiredEntries) {
    if (!archiveHasEntry(entries, entry)) {
      throw new Error(`备份包缺少必要条目: ${entry}`);
    }
  }

  const archiveDbStats = await inspectArchiveDatabase(archive, manifest.database.path);
  if (archiveDbStats.size !== manifest.database.size) {
    throw new Error(`数据库备份大小不一致: manifest=${manifest.database.size}, archive=${archiveDbStats.size}`);
  }
  if (archiveDbStats.sha256 !== manifest.database.sha256) {
    throw new Error('数据库备份 SHA256 校验失败');
  }

  for (const dir of manifest.directories) {
    if (!archiveHasEntry(entries, dir.path)) {
      throw new Error(`备份包缺少业务目录: ${dir.path}`);
    }
    const archivedCount = countArchiveFiles(entries, dir.path);
    if (archivedCount !== dir.fileCount) {
      throw new Error(`备份目录文件数不一致: ${dir.path} manifest=${dir.fileCount}, archive=${archivedCount}`);
    }
  }

  return manifest;
}

function readArchiveManifest(archive: string): BackupManifest | null {
  try {
    const raw = execFileSync('tar', ['xOzf', archive, BACKUP_MANIFEST_ENTRY], {
      stdio: 'pipe',
      timeout: ARCHIVE_META_TIMEOUT_MS,
    }).toString('utf-8');
    return JSON.parse(raw) as BackupManifest;
  } catch (err) {
    if (isArchiveEntryMissing(err)) return null;
    throw new Error(`读取备份清单失败: ${extractCommandError(err)}`);
  }
}

async function inspectArchiveDatabase(
  archive: string,
  databaseEntry: string,
): Promise<{ size: number; sha256: string }> {
  const tmpDir = prepareWorkDir(`verify_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  try {
    if (!extractArchiveEntry(archive, tmpDir, databaseEntry)) {
      throw new Error(`备份包缺少数据库文件: ${databaseEntry}`);
    }
    const dbPath = join(tmpDir, databaseEntry);
    return {
      size: statSync(dbPath).size,
      sha256: await sha256File(dbPath),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function archiveHasEntry(entries: string[], entry: string): boolean {
  const normalized = entry.replace(/\/$/, '');
  return entries.some((item) => item === normalized || item === `${normalized}/` || item.startsWith(`${normalized}/`));
}

function countArchiveFiles(entries: string[], dir: string): number {
  const prefix = `${dir.replace(/\/$/, '')}/`;
  return entries.filter((entry) => entry.startsWith(prefix) && !entry.endsWith('/')).length;
}

function writeJsonAtomic(path: string, value: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

function signBackupArchiveSha256(archiveSha256: string): string {
  const secret = process.env.BACKUP_SIGNING_SECRET || config.jwtSecret;
  return createHmac('sha256', secret).update(`3dparthub-backup:${archiveSha256}`).digest('hex');
}

function assertBackupSignature(record: BackupRecord, archiveSha256: string) {
  if (!record.archiveSignature) return;
  const expected = signBackupArchiveSha256(archiveSha256);
  const actualBuffer = Buffer.from(record.archiveSignature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error(
      '备份签名校验失败，已中止恢复。常见原因：① 跨服务器迁移时新服务器的 BACKUP_SIGNING_SECRET（或 JWT_SECRET）与备份时不同——请把旧服务器的 BACKUP_SIGNING_SECRET 复制到新 .env，或在恢复确认里勾选「跨服务器迁移：跳过签名校验」，或改用「导入恢复」直接上传 .tar.gz；② 备份文件或记录被篡改。（注：文件完整性 SHA256 已通过，仅来源真实性签名不匹配。）',
    );
  }
}

async function sha256File(path: string): Promise<string> {
  return sha256FileWithProgress(path);
}

async function sha256FileWithProgress(path: string, onProgress?: (percent: number) => void): Promise<string> {
  const hash = createHash('sha256');
  const total = statSync(path).size;
  let processed = 0;
  let lastPercent = -1;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      if (!onProgress || total <= 0) return;
      processed += chunk.length;
      const percent = Math.min(100, Math.floor((processed / total) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  onProgress?.(100);
  return hash.digest('hex');
}

function countFilesAndBytesRecursive(dir: string): { fileCount: number; totalBytes: number } {
  if (!existsSync(dir)) return { fileCount: 0, totalBytes: 0 };

  let fileCount = 0;
  let totalBytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isIgnoredFileName(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = countFilesAndBytesRecursive(fullPath);
      fileCount += child.fileCount;
      totalBytes += child.totalBytes;
      continue;
    }
    fileCount += 1;
    totalBytes += statSync(fullPath).size;
  }

  return { fileCount, totalBytes };
}

function countDirs(root: string, dirs: string[]): { fileCount: number; totalBytes: number } {
  return dirs.reduce(
    (sum, dir) => {
      const stats = countFilesAndBytesRecursive(join(root, dir));
      return {
        fileCount: sum.fileCount + stats.fileCount,
        totalBytes: sum.totalBytes + stats.totalBytes,
      };
    },
    { fileCount: 0, totalBytes: 0 },
  );
}

function isArchiveStepEntry(entry: string): boolean {
  const normalized = entry.trim().replace(/\/$/, '');
  const fileName = normalized.split('/').pop();
  return Boolean(fileName && isStepFileName(fileName));
}

function extractRestoreSqlPath(archive: string, tmpDir: string): string | null {
  const nestedEntry = '_backup_db/database.sql';
  if (extractArchiveEntry(archive, tmpDir, nestedEntry)) {
    return join(tmpDir, nestedEntry);
  }

  const directEntry = 'database.sql';
  if (extractArchiveEntry(archive, tmpDir, directEntry)) {
    return join(tmpDir, directEntry);
  }

  return null;
}

async function sanitizeSqlDumpStreaming(
  source: string,
  destination: string,
  options: { skipForeignKeys?: boolean } = {},
) {
  // Stream through the SQL dump, filtering out problematic lines
  const rl = createInterface({ input: createReadStream(source, { encoding: 'utf-8' }), crlfDelay: Infinity });
  const ws = createWriteStream(destination, { encoding: 'utf-8' });
  let pendingAlterTableLine: string | null = null;

  const DANGEROUS_SQL = [
    /^\\/, // psql meta-commands (\!, \copy, \i, etc.)
    /^\s*COPY\s+.*\s+(TO|FROM\s+PROGRAM)\s+/i, // COPY ... TO / COPY ... FROM PROGRAM
    /^\s*CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i,
    /^\s*CREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\b/i,
    /^\s*CREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
    /^\s*CREATE\s+(OR\s+REPLACE\s+)?EVENT\s+TRIGGER\b/i,
    /^\s*DO\s+\$\$/i, // anonymous DO blocks
    /^\s*ALTER\s+SYSTEM\b/i, // PostgreSQL config manipulation
  ];

  let insideCopyFrom = false;

  const writeIfAllowed = (line: string) => {
    if (line === 'SET transaction_timeout = 0;') return;
    if (line === '\\.') {
      ws.write(line + '\n');
      insideCopyFrom = false;
      return;
    }
    if (insideCopyFrom) {
      ws.write(line + '\n');
      return;
    }
    if (/^\s*COPY\s+.*\s+FROM\s+stdin;/i.test(line)) {
      insideCopyFrom = true;
      ws.write(line + '\n');
      return;
    }
    const trimmed = line.trim();
    for (const pat of DANGEROUS_SQL) {
      if (pat.test(trimmed)) return;
    }
    ws.write(line + '\n');
  };

  for await (const line of rl) {
    if (options.skipForeignKeys && pendingAlterTableLine !== null) {
      if (/\bFOREIGN KEY\b/.test(line)) {
        pendingAlterTableLine = null;
        continue;
      }
      writeIfAllowed(pendingAlterTableLine);
      pendingAlterTableLine = null;
    }

    if (options.skipForeignKeys && /^ALTER TABLE ONLY public\./.test(line)) {
      if (/\bFOREIGN KEY\b/.test(line)) {
        continue;
      }
      pendingAlterTableLine = line;
      continue;
    }

    writeIfAllowed(line);
  }
  if (pendingAlterTableLine !== null) {
    writeIfAllowed(pendingAlterTableLine);
  }
  ws.end();
  await new Promise<void>((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

function isForeignKeyRestoreError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return message.includes('violates foreign key constraint') || message.includes('FOREIGN KEY');
}

function databaseNameFromUrl(): string {
  const pathname = new URL(DB_URL_CLEAN).pathname.replace(/^\//, '');
  return pathname || 'postgres';
}

function databaseUrlFor(name: string): string {
  const url = new URL(DB_URL_CLEAN);
  url.pathname = `/${name}`;
  return url.toString();
}

function maintenanceDatabaseUrl(): string {
  return databaseUrlFor('postgres');
}

function makePreflightDatabaseName(): string {
  const base = databaseNameFromUrl().replace(/[^a-zA-Z0-9_]/g, '_');
  return `${base}_restore_check_${Date.now()}`;
}

async function preflightRestoreSql(sqlPath: string) {
  const preflightDbName = makePreflightDatabaseName();
  const preflightDbUrl = databaseUrlFor(preflightDbName);
  const maintenanceUrl = maintenanceDatabaseUrl();

  try {
    psqlCommand(
      maintenanceUrl,
      `CREATE DATABASE "${preflightDbName}"`,
      ['-v', 'ON_ERROR_STOP=1'],
      PSQL_COMMAND_TIMEOUT_MS,
    );
    runPrismaMigrations(preflightDbUrl);
    await restoreSqlIntoDatabase(preflightDbUrl, sqlPath, { disableTriggers: true });
    log.info('Backup database preflight verification passed');
  } catch (err: unknown) {
    // Preflight failed — could be missing CREATEDB privilege or incompatible data.
    // Skip preflight and let the actual restore handle errors with recovery.
    log.warn({ error: extractCommandError(err) }, 'Preflight skipped (DB user may lack CREATEDB or data incompatible)');
  } finally {
    try {
      psqlCommand(
        maintenanceUrl,
        `DROP DATABASE IF EXISTS "${preflightDbName}" WITH (FORCE)`,
        ['-v', 'ON_ERROR_STOP=1'],
        PSQL_COMMAND_TIMEOUT_MS,
      );
    } catch {
      log.warn({ preflightDbName }, 'Failed to drop preflight database after verification');
    }
  }
}

async function resetDatabaseSchema(dbUrl: string) {
  const args = ['-v', 'ON_ERROR_STOP=1'];
  // IF EXISTS: 硬中断恢复场景下 public 可能已被上一次中断的 reset/dump 删掉，
  // 此时 `DROP SCHEMA public` 会因 "schema does not exist" + ON_ERROR_STOP=1 而失败，
  // 导致 rollbackToSafetySnapshot 无法回滚。幂等化后无论 public 是否存在都能重置。
  psqlCommand(dbUrl, 'DROP SCHEMA IF EXISTS public CASCADE', args, PSQL_COMMAND_TIMEOUT_MS);
  psqlCommand(dbUrl, 'CREATE SCHEMA public', args, PSQL_COMMAND_TIMEOUT_MS);
  psqlCommand(dbUrl, 'GRANT ALL ON SCHEMA public TO public', args, PSQL_COMMAND_TIMEOUT_MS);
}

function runPrismaMigrations(dbUrl: string) {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'pipe',
    timeout: PRISMA_MIGRATE_TIMEOUT_MS,
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
}

function runPrismaDbPush(dbUrl: string) {
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    stdio: 'pipe',
    timeout: PRISMA_MIGRATE_TIMEOUT_MS,
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
}

async function restoreSqlIntoDatabase(dbUrl: string, sqlPath: string, options: { disableTriggers?: boolean } = {}) {
  let restorePath = sqlPath;
  let guardedPath: string | null = null;
  try {
    if (options.disableTriggers) {
      guardedPath = await writeTriggerGuardedSql(sqlPath);
      restorePath = guardedPath;
    }
    psqlFromFile(dbUrl, restorePath, ['-v', 'ON_ERROR_STOP=1'], DB_RESTORE_TIMEOUT_MS);
  } finally {
    if (guardedPath) rmSync(guardedPath, { force: true });
  }
}

async function writeTriggerGuardedSql(source: string): Promise<string> {
  const destination = join(dirname(source), `${basename(source)}.trigger_guarded.sql`);
  const rl = createInterface({ input: createReadStream(source, { encoding: 'utf-8' }), crlfDelay: Infinity });
  const ws = createWriteStream(destination, { encoding: 'utf-8' });
  ws.write('SET session_replication_role = replica;\n');
  for await (const line of rl) {
    ws.write(line + '\n');
  }
  ws.write('\nSET session_replication_role = origin;\n');
  ws.end();
  await new Promise<void>((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
  return destination;
}

async function recoverDatabaseToCleanSchema() {
  try {
    await resetDatabaseSchema(DB_URL_CLEAN);
    runPrismaMigrations(DB_URL_CLEAN);
  } catch {
    log.error({ err: {} }, 'Failed to recover database to clean schema');
  }
}

/** Rollback to the pre-restore safety snapshot. Falls back to clean schema if snapshot is unavailable. */
async function rollbackToSafetySnapshot(
  snapshotPath: string | null,
  job: { id?: string; logs?: string[] },
): Promise<boolean> {
  if (snapshotPath && existsSync(snapshotPath)) {
    try {
      addLog(job, '正在回滚到恢复前的安全快照...');
      await resetDatabaseSchema(DB_URL_CLEAN);
      await restoreSqlIntoDatabase(DB_URL_CLEAN, snapshotPath, { disableTriggers: true });
      // Apply migrations in case the snapshot was from an older schema version
      try {
        runPrismaMigrations(DB_URL_CLEAN);
      } catch {
        log.warn({ err: {} }, 'Failed to apply migrations after safety snapshot rollback');
      }
      addLog(job, '已成功回滚到恢复前的数据库状态');
      // 数据库已回到恢复前的安全状态，清除「恢复进行中」marker（若存在）。
      // 恢复端点路径下 job.id='recovery' 不匹配原 marker，由调用方按快照路径另行清理。
      clearRestoreInProgressMarker(job.id);
      return true;
    } catch (rollbackErr: unknown) {
      const preservedPath = preserveSafetySnapshot(snapshotPath, job);
      const preservedMessage = preservedPath ? `；安全快照已保留: ${preservedPath}` : '';
      addLog(job, `安全快照回滚失败: ${getErrorMessage(rollbackErr)}${preservedMessage}，尝试恢复空 schema...`);
      log.error({ err: rollbackErr }, 'Safety snapshot rollback failed');
    }
  } else {
    addLog(job, '未找到可用安全快照，尝试恢复空 schema...');
  }
  // No snapshot or rollback failed — fall back to clean empty schema
  await recoverDatabaseToCleanSchema();
  return false;
}

function preserveSafetySnapshot(snapshotPath: string | null, job: { id?: string; logs?: string[] }): string | null {
  if (!snapshotPath || !existsSync(snapshotPath)) return null;
  try {
    mkdirSync(SAFETY_SNAPSHOT_DIR, { recursive: true });
    const safeJobId = (job.id || 'restore').replace(/[^a-zA-Z0-9_-]/g, '_');
    const destination = join(SAFETY_SNAPSHOT_DIR, `${safeJobId}_${Date.now()}_safety_snapshot.sql`);
    copyFileSync(snapshotPath, destination);
    return destination;
  } catch (err: unknown) {
    addLog(job, `安全快照保留失败: ${getErrorMessage(err)}`);
    return null;
  }
}

// ─── Pre-restore crash-recovery safety ───────────────────────────────────────
// 恢复的破坏性阶段（resetDatabaseSchema = DROP+CREATE）若被 SIGKILL / OOM / 断电硬中断，
// 数据库会留在空 schema 的破损态，而临时目录里的 safety_snapshot.sql 会被下次启动的
// cleanupStaleBackupWorkDirs 当作 stale work dir 清掉 → 丢失回滚凭据。
// 因此在进入破坏性阶段前，把快照复制一份到持久目录 _safety_snapshots/ 并写入 marker 文件。
// marker 在「数据库导入成功」或「回滚成功」时清除；若服务重启时 marker 仍在，说明恢复被硬中断，
// 启动逻辑会大声告警并指向持久快照供恢复（见 main.ts + /recover-interrupted 端点）。
const RESTORE_IN_PROGRESS_MARKER_PREFIX = '.restore_in_progress_';

interface RestoreInProgressMarker {
  jobId: string;
  durableSnapshot: string;
  startedAt: string;
}

function restoreInProgressMarkerPath(jobId: string | undefined): string {
  const safeJobId = (jobId || 'restore').replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(SAFETY_SNAPSHOT_DIR, `${RESTORE_IN_PROGRESS_MARKER_PREFIX}${safeJobId}.json`);
}

// 进入破坏性阶段前调用：把安全快照持久化一份 + 写 marker。返回持久快照路径；失败返回 null。
function persistPreRestoreSnapshot(snapshotPath: string, jobId: string | undefined): string | null {
  if (!snapshotPath || !existsSync(snapshotPath)) return null;
  try {
    mkdirSync(SAFETY_SNAPSHOT_DIR, { recursive: true });
    const safeJobId = (jobId || 'restore').replace(/[^a-zA-Z0-9_-]/g, '_');
    const durableSnapshot = join(SAFETY_SNAPSHOT_DIR, `${safeJobId}_${Date.now()}_pre_restore.sql`);
    copyFileSync(snapshotPath, durableSnapshot);
    const marker: RestoreInProgressMarker = {
      jobId: jobId || '',
      durableSnapshot,
      startedAt: new Date().toISOString(),
    };
    writeFileSync(restoreInProgressMarkerPath(jobId), JSON.stringify(marker, null, 2));
    log.warn({ jobId, durableSnapshot }, 'Pre-restore safety snapshot persisted (destructive phase starting)');
    return durableSnapshot;
  } catch (err: unknown) {
    log.error({ err, jobId }, 'Failed to persist pre-restore safety snapshot');
    return null;
  }
}

// 数据库已安全（导入成功或回滚成功）后调用：清除 marker 及其引用的持久快照。
function clearRestoreInProgressMarker(jobId: string | undefined): void {
  try {
    const markerPath = restoreInProgressMarkerPath(jobId);
    if (!existsSync(markerPath)) return;
    let durableSnapshot: string | null = null;
    try {
      durableSnapshot =
        (JSON.parse(readFileSync(markerPath, 'utf-8')) as RestoreInProgressMarker).durableSnapshot || null;
    } catch {
      /* corrupt marker — best effort */
    }
    rmSync(markerPath, { force: true });
    if (durableSnapshot && existsSync(durableSnapshot)) rmSync(durableSnapshot, { force: true });
  } catch (err: unknown) {
    log.warn({ err, jobId }, 'Failed to clear restore-in-progress marker');
  }
}

export interface InterruptedRestoreInfo {
  jobId: string;
  durableSnapshot: string;
  startedAt: string;
  markerPath: string;
}

// 服务启动时调用：扫描仍存在的 marker，返回被硬中断的恢复任务（及其持久快照）。
export function detectInterruptedRestores(): InterruptedRestoreInfo[] {
  try {
    if (!existsSync(SAFETY_SNAPSHOT_DIR)) return [];
    const results: InterruptedRestoreInfo[] = [];
    for (const entry of readdirSync(SAFETY_SNAPSHOT_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith(RESTORE_IN_PROGRESS_MARKER_PREFIX) || !entry.name.endsWith('.json')) continue;
      const markerPath = join(SAFETY_SNAPSHOT_DIR, entry.name);
      try {
        const marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as RestoreInProgressMarker;
        if (marker.durableSnapshot && existsSync(marker.durableSnapshot)) {
          results.push({
            jobId: marker.jobId || entry.name,
            durableSnapshot: marker.durableSnapshot,
            startedAt: marker.startedAt || '',
            markerPath,
          });
        }
      } catch {
        /* ignore corrupt marker */
      }
    }
    return results;
  } catch {
    return [];
  }
}

// 校验持久快照路径确实位于 _safety_snapshots/ 内（防路径遍历）。
export function isValidDurableRestoreSnapshot(path: string): boolean {
  try {
    const resolved = resolve(path);
    const root = resolve(SAFETY_SNAPSHOT_DIR) + sep;
    return resolved.startsWith(root) && resolved.endsWith('.sql') && existsSync(resolved);
  } catch {
    return false;
  }
}

// 按持久快照路径清理对应的 marker（恢复端点用：恢复任务的 jobId 未必等于调用方 id）。
function clearRestoreInProgressMarkerBySnapshot(durableSnapshot: string): void {
  try {
    const resolved = resolve(durableSnapshot);
    for (const info of detectInterruptedRestores()) {
      if (resolve(info.durableSnapshot) === resolved) {
        try {
          rmSync(info.markerPath, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
    // 快照已用于回滚，删除文件本身，避免 _safety_snapshots/ 无限堆积。
    if (existsSync(resolved)) rmSync(resolved, { force: true });
  } catch {
    /* best effort */
  }
}

// 管理员触发的恢复：用持久化的恢复前快照回滚数据库。调用方需先取得备份锁。
export async function recoverFromInterruptedRestore(
  durableSnapshot: string,
  job?: { id?: string; logs?: string[] },
): Promise<boolean> {
  if (!isValidDurableRestoreSnapshot(durableSnapshot)) {
    throw new Error('无效或越界的恢复快照路径');
  }
  const ok = await rollbackToSafetySnapshot(durableSnapshot, job || { id: 'recovery' });
  if (ok) clearRestoreInProgressMarkerBySnapshot(durableSnapshot);
  return ok;
}

// 路由侧恢复入口：取备份锁 → 用持久快照回滚 → 清 marker → 释放锁。
export async function performInterruptedRestoreRecovery(
  durableSnapshot: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isValidDurableRestoreSnapshot(durableSnapshot)) {
    return { ok: false, message: '无效或越界的恢复快照路径' };
  }
  if (!acquireLock()) {
    return { ok: false, message: '有备份、恢复、校验或导入任务正在进行中，请等待完成后再试' };
  }
  const jobId = `recovery_${Date.now()}`;
  const stopKeepAlive = startLockKeepAlive(jobId, 'manual');
  const job = { id: jobId, logs: [] as string[] };
  try {
    addLog(job, '正在用恢复前安全快照回滚数据库...');
    const ok = await rollbackToSafetySnapshot(durableSnapshot, job);
    if (!ok) {
      return {
        ok: false,
        message: '回滚失败，已尝试恢复空 schema；请检查日志，保留的快照见 _safety_snapshots/',
      };
    }
    clearRestoreInProgressMarkerBySnapshot(durableSnapshot);
    return { ok: true, message: '已成功回滚到恢复前的数据库状态' };
  } finally {
    stopKeepAlive();
    releaseLockForJob(jobId);
  }
}

interface RestoreStaticDirPlan {
  dir: string;
  destination: string;
  archiveEntry: string;
}

interface RestoreUploadDirPlan {
  name: string;
  destination: string;
  archiveEntry: string;
}

interface RestoreFilePlan {
  archive: string;
  stagingRoot: string;
  staticDirs: RestoreStaticDirPlan[];
  uploadDirs: RestoreUploadDirPlan[];
  legacyMetadata?: RestoreUploadDirPlan;
}

interface RestoreFileCommitResult {
  restoredSourceFiles: number;
  thumbnailCount: number;
}

interface DirectoryReplacement {
  destination: string;
  backup: string | null;
}

async function _prepareRestoreFilePlan(
  archive: string,
  tmpDir: string,
  staticDirsToRestore: string[],
): Promise<RestoreFilePlan> {
  const staticDir = join(process.cwd(), config.staticDir);
  const uploadDir = join(process.cwd(), config.uploadDir);
  const entries = listArchiveEntries(archive);
  const plan: RestoreFilePlan = { archive, stagingRoot: join(tmpDir, 'restore_files'), staticDirs: [], uploadDirs: [] };

  for (const dir of staticDirsToRestore) {
    if (!archiveHasEntry(entries, dir)) continue;
    plan.staticDirs.push({
      dir,
      destination: join(staticDir, dir),
      archiveEntry: dir,
    });
  }

  const uploadPrefix = `${BACKUP_UPLOADS_ENTRY}/`;
  const uploadNames = Array.from(
    new Set(
      entries
        .filter((entry) => entry.startsWith(uploadPrefix))
        .map((entry) => entry.slice(uploadPrefix.length).split('/')[0])
        .filter(Boolean),
    ),
  )
    .filter((name) => !UPLOAD_BACKUP_EXCLUDE_DIRS.has(name))
    .sort((a, b) => a.localeCompare(b));
  for (const name of uploadNames) {
    plan.uploadDirs.push({
      name,
      destination: join(uploadDir, name),
      archiveEntry: `${BACKUP_UPLOADS_ENTRY}/${name}`,
    });
  }

  if (plan.uploadDirs.length === 0 && archiveHasEntry(entries, BACKUP_UPLOAD_METADATA_ENTRY)) {
    plan.legacyMetadata = {
      name: '.metadata',
      destination: join(uploadDir, '.metadata'),
      archiveEntry: BACKUP_UPLOAD_METADATA_ENTRY,
    };
  }

  return plan;
}

function assertRestoreHasDiskSpace(plan: RestoreFilePlan) {
  const requiredDataBytes = estimateRestoreWorkingBytes(plan);
  if (requiredDataBytes <= 0) return;

  const statfsTarget = existsSync(plan.stagingRoot) ? plan.stagingRoot : dirname(plan.stagingRoot);
  assertAvailableDiskSpace(statfsTarget, requiredDataBytes, '恢复前磁盘空间不足，已中止以保护现有数据');
}

function assertAvailableDiskSpace(target: string, requiredDataBytes: number, prefix: string) {
  const fsStats = statfsSync(target);
  const availableBytes = Number(fsStats.bavail) * Number(fsStats.bsize);
  const safetyMargin = Math.max(512 * 1024 * 1024, Math.ceil(requiredDataBytes * 0.05));
  const requiredBytes = requiredDataBytes + safetyMargin;

  if (availableBytes < requiredBytes) {
    throw new Error(
      `${prefix}：需要约 ${formatSize(requiredBytes)} 可用空间，当前仅 ${formatSize(availableBytes)}。请释放空间或挂载更大的备份/静态文件磁盘后重试。`,
    );
  }
}

function estimateRestoreWorkingBytes(plan: RestoreFilePlan): number {
  const manifest = readArchiveManifest(plan.archive);
  if (!manifest) return 0;

  const bytesByPath = new Map(manifest.directories.map((dir) => [dir.path, dir.totalBytes]));
  const entries = [
    ...plan.staticDirs.map((item) => item.archiveEntry),
    ...plan.uploadDirs.map((item) => item.archiveEntry),
    ...(plan.legacyMetadata ? [plan.legacyMetadata.archiveEntry] : []),
  ];

  return entries.reduce((sum, entry) => sum + (bytesByPath.get(entry) || 0), 0);
}

async function stageArchiveDirectory(
  plan: RestoreFilePlan,
  archiveEntry: string,
  index: number,
): Promise<{ root: string; stagedPath: string }> {
  const root = join(plan.stagingRoot, `step_${index}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const ok = await extractArchiveEntryAsync(plan.archive, root, archiveEntry);
  const stagedPath = join(root, archiveEntry);
  if (!ok || !existsSync(stagedPath)) {
    throw new Error(`备份包缺少目录: ${archiveEntry}`);
  }
  pruneIgnoredFiles(stagedPath);
  return { root, stagedPath };
}

async function _replaceArchiveDirectory(
  plan: RestoreFilePlan,
  archiveEntry: string,
  destination: string,
  stepIndex: number,
): Promise<DirectoryReplacement> {
  const staged = await stageArchiveDirectory(plan, archiveEntry, stepIndex);
  try {
    return replaceStagedDirectory(staged.stagedPath, destination);
  } finally {
    rmSync(staged.root, { recursive: true, force: true });
  }
}

async function commitRestoreFilePlan(plan: RestoreFilePlan, job: RestoreJob): Promise<RestoreFileCommitResult> {
  const replacements: DirectoryReplacement[] = [];
  let restoredSourceFiles = 0;
  let thumbnailCount = 0;
  let cleanupReplacedBackups = false;

  try {
    const allItems: Array<{ archiveEntry: string; destination: string; label: string }> = [
      ...plan.staticDirs.map((item) => ({
        archiveEntry: item.archiveEntry,
        destination: item.destination,
        label: item.dir,
      })),
      ...plan.uploadDirs.map((item) => ({
        archiveEntry: item.archiveEntry,
        destination: item.destination,
        label: `uploads/${item.name}`,
      })),
    ];
    if (plan.legacyMetadata) {
      allItems.push({
        archiveEntry: plan.legacyMetadata.archiveEntry,
        destination: plan.legacyMetadata.destination,
        label: '上传元数据',
      });
    }

    const totalSteps = allItems.length;
    let step = 0;
    const updateFileProgress = (message: string) => {
      job.percent = Math.min(94, 75 + Math.round((step / Math.max(totalSteps, 1)) * 19));
      job.message = message;
      syncJob(job);
    };

    // Phase 1: Extract ALL directories from the archive in a single tar pass
    const batchStageRoot = join(plan.stagingRoot, 'batch_restore');
    rmSync(batchStageRoot, { recursive: true, force: true });
    mkdirSync(batchStageRoot, { recursive: true });

    const entriesToExtract = allItems.map((item) => item.archiveEntry);
    updateFileProgress('正在解压所有文件目录...');
    const t = addLogStart(job, `一次性解压 ${entriesToExtract.length} 个目录（避免重复扫描备份包）...`);

    await extractMultipleArchiveEntries(plan.archive, batchStageRoot, entriesToExtract);
    addLogEnd(job, t, '全部目录解压完成');

    // Phase 2: Replace each directory one by one (fast — just filesystem moves)
    for (const item of allItems) {
      updateFileProgress(`正在恢复 ${item.label}/...`);
      addLog(job, `正在恢复 ${item.label}/...`);

      const stagedPath = join(batchStageRoot, item.archiveEntry);
      if (!existsSync(stagedPath)) {
        addLog(job, `跳过 ${item.label}/（备份中不存在）`);
        step += 1;
        continue;
      }
      pruneIgnoredFiles(stagedPath);
      replacements.push(replaceStagedDirectory(stagedPath, item.destination));

      const dir = item.label;
      if (dir === 'thumbnails') {
        thumbnailCount = countFilesRecursive(item.destination, (name) => name.endsWith('.png'));
        addLog(job, `缩略图恢复完成: ${thumbnailCount} 张`);
      } else if (dir === 'originals') {
        restoredSourceFiles = countFilesRecursive(item.destination, isStepFileName);
        addLog(job, `原始文件恢复完成: ${restoredSourceFiles} 个`);
      } else {
        const count = countFilesRecursive(item.destination);
        addLog(job, `${dir}/ 恢复完成${count > 0 ? ` (${count} 个文件)` : ''}`);
      }
      step += 1;
    }

    rmSync(batchStageRoot, { recursive: true, force: true });

    const result = { restoredSourceFiles, thumbnailCount };
    job.percent = 94;
    syncJob(job);
    cleanupReplacedBackups = true;
    return result;
  } catch (err: unknown) {
    const rollbackOk = rollbackDirectoryReplacements(replacements, job);
    cleanupReplacedBackups = rollbackOk;
    if (!rollbackOk) {
      const preservedBackups = replacements
        .map((replacement) => replacement.backup)
        .filter((backup): backup is string => typeof backup === 'string' && existsSync(backup));
      if (preservedBackups.length > 0) {
        const sample = preservedBackups.slice(0, 5).join('；');
        addLog(
          job,
          `部分目录回滚失败，已保留旧目录备份便于人工恢复: ${sample}${
            preservedBackups.length > 5 ? ` 等 ${preservedBackups.length} 个目录` : ''
          }`,
        );
      }
    }
    throw new Error(
      `文件目录恢复失败，${rollbackOk ? '已回滚已替换目录' : '部分目录回滚失败，旧目录备份已保留'}: ${getErrorMessage(
        err,
      )}`,
    );
  } finally {
    if (cleanupReplacedBackups) cleanupDirectoryBackups(replacements, job);
  }
}

function replaceStagedDirectory(stagedPath: string, destination: string): DirectoryReplacement {
  if (!existsSync(stagedPath)) {
    throw new Error(`恢复源目录不存在: ${stagedPath}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  const backup = existsSync(destination)
    ? `${destination}.restore_backup_${Date.now()}_${Math.random().toString(36).slice(2)}`
    : null;
  if (backup) renameSync(destination, backup);

  try {
    moveDirectory(stagedPath, destination);
    return { destination, backup };
  } catch (err) {
    rmSync(destination, { recursive: true, force: true });
    if (backup && existsSync(backup)) renameSync(backup, destination);
    throw err;
  }
}

function moveDirectory(source: string, destination: string) {
  try {
    renameSync(source, destination);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
    copyDirectoryRecursive(source, destination);
    rmSync(source, { recursive: true, force: true });
  }
}

function copyDirectoryRecursive(source: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const src = join(source, entry.name);
    const dest = join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    } else if (entry.isDirectory()) {
      copyDirectoryRecursive(src, dest);
    } else if (entry.isFile()) {
      copyFileSync(src, dest);
    }
  }
}

function rollbackDirectoryReplacements(replacements: DirectoryReplacement[], job: { logs?: string[] }): boolean {
  let ok = true;
  for (const replacement of [...replacements].reverse()) {
    try {
      rmSync(replacement.destination, { recursive: true, force: true });
      if (replacement.backup && existsSync(replacement.backup)) {
        renameSync(replacement.backup, replacement.destination);
      }
    } catch (err: unknown) {
      ok = false;
      addLog(job, `目录回滚失败 ${replacement.destination}: ${getErrorMessage(err)}`);
    }
  }
  return ok;
}

function cleanupDirectoryBackups(replacements: DirectoryReplacement[], job?: { logs?: string[] }) {
  for (const replacement of replacements) {
    if (!replacement.backup) continue;
    try {
      rmSync(replacement.backup, { recursive: true, force: true });
    } catch (err: unknown) {
      addLog(job || {}, `旧目录备份清理失败 ${replacement.backup}: ${getErrorMessage(err)}`);
      log.warn({ err, backup: replacement.backup }, 'Failed to clean restore directory backup');
    }
  }
}

async function _restoreArchiveDirectory(
  archive: string,
  staticDir: string,
  folder: string,
  predicate?: (name: string) => boolean,
): Promise<number> {
  const destination = join(staticDir, folder);
  const stagingRoot = join(staticDir, `.restore_${folder}_${Date.now()}`);
  const stagedFolder = join(stagingRoot, folder);

  if (!archiveContainsEntry(archive, folder)) {
    // Backup doesn't contain this directory — keep current data (don't delete)
    // Old backups may not include newly added directories
    return 0;
  }

  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  try {
    // Extract to staging first — if extraction fails, original data is preserved
    await extractArchiveEntryAsync(archive, stagingRoot, folder);
    if (!existsSync(stagedFolder)) {
      rmSync(stagingRoot, { recursive: true, force: true });
      return 0;
    }

    pruneIgnoredFiles(stagedFolder);

    // Only delete original after successful extraction
    rmSync(destination, { recursive: true, force: true });
    renameSync(stagedFolder, destination);
    return countFilesRecursive(destination, predicate);
  } catch (err) {
    // Extraction failed — clean up staging, keep original data intact
    rmSync(stagingRoot, { recursive: true, force: true });
    throw err;
  } finally {
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
  }
}

async function extractMultipleArchiveEntries(archive: string, destination: string, entries: string[]): Promise<void> {
  if (entries.length === 0) return;

  return new Promise((resolve, reject) => {
    const args = ['xzf', archive, '-C', destination, ...entries];
    const proc = spawn('tar', args, { timeout: ARCHIVE_EXTRACT_TIMEOUT_MS });
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(new Error(`解压失败: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      if (stderr && /not found in archive|could not find/i.test(stderr)) {
        return reject(new Error(`备份包缺少部分目录: ${stderr.trim()}`));
      }
      reject(new Error(`解压失败 (exit ${code}): ${stderr.trim()}`));
    });
  });
}

function extractArchiveEntryAsync(archive: string, destination: string, entry: string): Promise<boolean> {
  try {
    execFileSync('tar', ['xzf', archive, '-C', destination, entry], {
      stdio: 'pipe',
      timeout: ARCHIVE_EXTRACT_TIMEOUT_MS,
    });
    return Promise.resolve(true);
  } catch (err) {
    if (isArchiveEntryMissing(err)) return Promise.resolve(false);
    return Promise.reject(new Error(`提取备份内容失败: ${extractCommandError(err)}`));
  }
}

function pruneIgnoredFiles(dir: string) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (isIgnoredFileName(entry.name)) {
      rmSync(fullPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) pruneIgnoredFiles(fullPath);
  }
}

function countFilesRecursive(dir: string, predicate?: (name: string) => boolean): number {
  if (!existsSync(dir)) return 0;

  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isIgnoredFileName(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countFilesRecursive(fullPath, predicate);
      continue;
    }
    if (!predicate || predicate(entry.name)) total++;
  }
  return total;
}

function discoverStaticBackupDirs(staticDir: string): string[] {
  return discoverTopLevelDirs(staticDir, (name) => {
    if (STATIC_BACKUP_EXCLUDE_DIRS.has(name)) return false;
    if (name.startsWith('.')) return false;
    if (name.startsWith('_')) return false;
    return true;
  });
}

function discoverUploadBackupDirs(uploadDir: string): string[] {
  return discoverTopLevelDirs(uploadDir, (name) => {
    if (UPLOAD_BACKUP_EXCLUDE_DIRS.has(name)) return false;
    if (name.startsWith('.') && name !== '.metadata') return false;
    if (name.startsWith('_')) return false;
    return true;
  });
}

function discoverTopLevelDirs(root: string, include: (name: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && include(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function _getRestorableStaticDirs(archive: string): string[] {
  const manifest = readArchiveManifest(archive);
  const dirs = manifest
    ? manifest.directories.map((dir) => dir.path)
    : Array.from(
        new Set(
          listArchiveEntries(archive)
            .map((entry) => entry.split('/')[0])
            .filter(Boolean),
        ),
      );

  const staticDirs = dirs
    .filter((dir) => !dir.startsWith(`${BACKUP_DB_ENTRY_DIR}/`) && dir !== BACKUP_DB_ENTRY_DIR)
    .filter((dir) => !STATIC_BACKUP_EXCLUDE_DIRS.has(dir))
    .filter((dir) => !dir.startsWith('.') && !dir.startsWith('_'));

  const priority = RESTORE_PRIORITY_DIRS.filter((dir) => staticDirs.includes(dir));
  const rest = staticDirs.filter((dir) => !priority.includes(dir)).sort((a, b) => a.localeCompare(b));
  return [...priority, ...rest];
}

function _restoreMessageForStaticDir(dir: string): string {
  if (dir === 'models') return '正在恢复转换模型文件...';
  if (dir === 'thumbnails') return '正在恢复缩略图...';
  if (dir === 'originals') return '正在恢复 STEP 原始文件...';
  if (dir === 'drawings') return '正在恢复产品图纸...';
  return `正在恢复 ${dir}/...`;
}

async function _restoreUploadDirectoriesFromArchive(archive: string, staticDir: string): Promise<number> {
  if (!archiveContainsEntry(archive, BACKUP_UPLOADS_ENTRY)) return 0;

  const uploadDir = join(process.cwd(), config.uploadDir);
  const stagingRoot = join(staticDir, `.restore_uploads_${Date.now()}`);
  const extractedUploads = join(stagingRoot, BACKUP_UPLOADS_ENTRY);
  const replacedBackups: string[] = [];
  let restored = 0;

  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  try {
    await extractArchiveEntryAsync(archive, stagingRoot, BACKUP_UPLOADS_ENTRY);
    if (!existsSync(extractedUploads)) return 0;
    for (const entry of readdirSync(extractedUploads, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (UPLOAD_BACKUP_EXCLUDE_DIRS.has(entry.name)) continue;
      const source = join(extractedUploads, entry.name);
      const destination = join(uploadDir, entry.name);
      const backup = join(uploadDir, `.restore_backup_${entry.name}_${Date.now()}`);
      rmSync(backup, { recursive: true, force: true });
      if (existsSync(destination)) renameSync(destination, backup);
      try {
        renameSync(source, destination);
        rmSync(backup, { recursive: true, force: true });
        restored += 1;
      } catch (err) {
        if (existsSync(backup) && !existsSync(destination)) {
          try {
            renameSync(backup, destination);
          } catch {
            log.warn({ backup, destination }, 'Failed to restore upload directory backup during rollback');
          }
        }
        throw err;
      } finally {
        replacedBackups.push(backup);
      }
    }
    return restored;
  } finally {
    for (const backup of replacedBackups) rmSync(backup, { recursive: true, force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

async function _restoreLegacyUploadMetadataFromArchive(archive: string, staticDir: string): Promise<number> {
  if (!archiveContainsEntry(archive, BACKUP_UPLOAD_METADATA_ENTRY)) return 0;

  const uploadDir = join(process.cwd(), config.uploadDir);
  const metadataDest = join(uploadDir, '.metadata');
  const stagingMeta = join(staticDir, `.restore_metadata_${Date.now()}`);
  const extractedMeta = join(stagingMeta, '_backup_db', 'metadata');
  const metadataBackup = join(uploadDir, `.metadata_backup_${Date.now()}`);
  try {
    mkdirSync(stagingMeta, { recursive: true });
    await extractArchiveEntryAsync(archive, stagingMeta, BACKUP_UPLOAD_METADATA_ENTRY);
    if (!existsSync(extractedMeta)) return 0;
    rmSync(metadataBackup, { recursive: true, force: true });
    if (existsSync(metadataDest)) renameSync(metadataDest, metadataBackup);
    try {
      renameSync(extractedMeta, metadataDest);
    } catch (replaceErr) {
      if (existsSync(metadataBackup) && !existsSync(metadataDest)) {
        try {
          renameSync(metadataBackup, metadataDest);
        } catch {
          log.warn({ metadataBackup, metadataDest }, 'Failed to restore metadata backup during rollback');
        }
      }
      throw replaceErr;
    }
    rmSync(metadataBackup, { recursive: true, force: true });
    return countFilesRecursive(metadataDest);
  } finally {
    rmSync(metadataBackup, { recursive: true, force: true });
    rmSync(stagingMeta, { recursive: true, force: true });
  }
}

function extractCommandError(err: unknown): string {
  if (err instanceof Error && 'stderr' in err) {
    const stderr = String((err as { stderr?: Buffer | string }).stderr || '').trim();
    if (stderr) return stderr.split(/\r?\n/).slice(-5).join(' | ');
  }
  return err instanceof Error ? err.message : '未知错误';
}

function extractArchiveEntry(archive: string, destination: string, entry: string): boolean {
  try {
    execFileSync('tar', ['xzf', archive, '-C', destination, entry], {
      stdio: 'pipe',
      timeout: ARCHIVE_EXTRACT_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    if (isArchiveEntryMissing(err)) return false;
    throw new Error(`提取备份内容失败: ${extractCommandError(err)}`);
  }
}

function isArchiveEntryMissing(err: unknown): boolean {
  const msg = extractCommandError(err).toLowerCase();
  return msg.includes('not found in archive') || msg.includes('could not find');
}

function archiveContainsEntry(archive: string, entry: string): boolean {
  try {
    execFileSync('tar', ['tzf', archive, entry], {
      stdio: 'pipe',
      timeout: ARCHIVE_LIST_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    if (isArchiveEntryMissing(err)) return false;
    throw new Error(`检查备份内容失败: ${extractCommandError(err)}`);
  }
}

function ensureBackupStoredInActiveDir(id: string) {
  const currentDir = resolveBackupDir(id);
  if (!currentDir || currentDir === ACTIVE_BACKUP_DIR) return;

  const sourceArchive = buildArchivePath(currentDir, id);
  const sourceMeta = buildMetaPath(currentDir, id);
  const targetArchive = activeArchivePath(id);
  const targetMeta = activeMetaPath(id);

  try {
    if (existsSync(targetArchive)) rmSync(targetArchive, { force: true });
    if (existsSync(targetMeta)) rmSync(targetMeta, { force: true });
    try {
      renameSync(sourceArchive, targetArchive);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EXDEV') {
        copyFileSync(sourceArchive, targetArchive);
        rmSync(sourceArchive, { force: true });
      } else throw err;
    }
    if (existsSync(sourceMeta)) {
      try {
        renameSync(sourceMeta, targetMeta);
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EXDEV') {
          copyFileSync(sourceMeta, targetMeta);
          rmSync(sourceMeta, { force: true });
        } else throw err;
      }
    }
  } catch (err) {
    throw new Error(`迁移备份存储位置失败: ${extractCommandError(err)}`);
  }
}

function prepareWorkDir(name: string): string {
  const dir = join(BACKUP_WORK_DIR, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeBackupRecord(record: BackupRecord, archive: string, metaFile: string): BackupRecord {
  if (record.countMode === 'step_models') return record;
  // Keep backup listing lightweight. Deep inspection of large archives can block
  // the API process for seconds or minutes; users can run explicit verification
  // when they need to normalize or validate an older backup.
  void archive;
  void metaFile;
  return record;
}

function _scheduleBackupRecordNormalization(record: BackupRecord, archive: string, metaFile: string) {
  if (pendingRecordNormalizations.has(record.id)) return;

  pendingRecordNormalizations.add(record.id);
  setImmediate(async () => {
    try {
      const refreshed = await inspectBackupArchive(record.id, archive, record.filename);
      refreshed.name = record.name;
      refreshed.dbSize = record.dbSize || refreshed.dbSize;
      writeFileSync(metaFile, JSON.stringify(refreshed, null, 2));
      log.info({ recordId: record.id }, 'Normalized legacy backup record');
    } catch (err: unknown) {
      log.warn({ recordId: record.id, err }, 'Failed to normalize backup record');
    } finally {
      pendingRecordNormalizations.delete(record.id);
    }
  });
}

interface BackupPolicySettings {
  backup_auto_enabled: boolean;
  backup_schedule_time: string;
  backup_retention_count: number;
  backup_mirror_enabled: boolean;
  backup_mirror_dir: string;
  backup_last_mirror_status: string;
  backup_last_mirror_message: string;
  backup_last_mirror_at: string;
  backup_last_auto_date: string;
  backup_last_auto_status: string;
  backup_last_auto_message: string;
  backup_last_auto_job_id: string;
  backup_last_auto_at: string;
}

let backupSchedulerStarted = false;

export function startBackupScheduler() {
  if (backupSchedulerStarted) return;
  backupSchedulerStarted = true;
  const interval = setInterval(() => {
    runBackupSchedulerTick().catch((err) => {
      log.warn({ err }, 'Backup scheduler tick error');
    });
  }, 60_000);
  interval.unref?.();
  runBackupSchedulerTick().catch((err) => {
    log.warn({ err }, 'Initial backup scheduler tick error');
  });
}

async function runBackupSchedulerTick() {
  const settings = await getBackupPolicySettings();
  if (!settings.backup_auto_enabled) return;
  if (!isScheduleDue(settings.backup_schedule_time)) return;
  if (settings.backup_last_auto_date === localDateKey()) return;

  try {
    const jobId = startScheduledBackupJob();
    await updateBackupPolicySettings({
      backup_last_auto_status: 'running',
      backup_last_auto_message: '自动备份正在执行',
      backup_last_auto_job_id: jobId,
      backup_last_auto_at: new Date().toISOString(),
    });
    log.info({ jobId }, 'Started scheduled backup');
  } catch (err: unknown) {
    await updateBackupPolicySettings({
      backup_last_auto_status: 'skipped',
      backup_last_auto_message: getErrorMessage(err) || '自动备份跳过',
      backup_last_auto_at: new Date().toISOString(),
    });
    log.warn({ err }, 'Scheduled backup skipped');
  }
}

async function applyBackupRetentionPolicy(job: { logs?: string[] }) {
  const settings = await getBackupPolicySettings();
  const keep = settings.backup_retention_count;
  if (!Number.isFinite(keep) || keep <= 0) return;

  const backups = listBackups();
  const removable = backups.slice(keep);
  for (const backup of removable) {
    if (deleteBackup(backup.id)) {
      addLog(job, `已按保留策略清理旧备份: ${backup.name || backup.id}`);
    }
  }

  const mirrorDir = resolveMirrorBackupDir(settings.backup_mirror_dir);
  if (settings.backup_mirror_enabled && mirrorDir) {
    cleanupMirrorBackups(mirrorDir, keep, job);
  }
}

async function mirrorBackupIfEnabled(record: BackupRecord, job: { logs?: string[] }) {
  const settings = await getBackupPolicySettings();
  if (!settings.backup_mirror_enabled) return;

  const mirrorDir = resolveMirrorBackupDir(settings.backup_mirror_dir);
  if (!mirrorDir) {
    const message = '镜像备份目录无效，请配置一个绝对路径，且不能指向当前备份目录';
    addLog(job, message);
    try {
      await updateBackupPolicySettings({
        backup_last_mirror_status: 'error',
        backup_last_mirror_message: message,
        backup_last_mirror_at: new Date().toISOString(),
      });
    } catch (err: unknown) {
      log.warn({ err }, 'Failed to update mirror backup error status');
    }
    return;
  }

  let targetArchive = '';
  let targetMeta = '';
  let tmpArchive = '';
  let tmpMeta = '';
  let targetArchiveWritten = false;
  let targetMetaWritten = false;
  try {
    mkdirSync(mirrorDir, { recursive: true });
    const sourceArchive = activeArchivePath(record.id);
    const sourceMeta = activeMetaPath(record.id);
    targetArchive = join(mirrorDir, `${record.id}.tar.gz`);
    targetMeta = join(mirrorDir, `${record.id}.json`);
    tmpArchive = `${targetArchive}.tmp`;
    tmpMeta = `${targetMeta}.tmp`;

    addLog(job, `正在复制备份到外部镜像目录: ${mirrorDir}`);
    copyFileSync(sourceArchive, tmpArchive);
    if (record.archiveSha256) {
      const copiedSha = await sha256File(tmpArchive);
      if (copiedSha !== record.archiveSha256) {
        throw new Error('镜像备份 SHA256 校验失败');
      }
    }
    await validateBackupArchiveByKind(tmpArchive);
    copyFileSync(sourceMeta, tmpMeta);

    renameSync(tmpArchive, targetArchive);
    targetArchiveWritten = true;
    renameSync(tmpMeta, targetMeta);
    targetMetaWritten = true;

    const message = `镜像备份完成: ${mirrorDir}`;
    addLog(job, message);
    try {
      await updateBackupPolicySettings({
        backup_last_mirror_status: 'success',
        backup_last_mirror_message: message,
        backup_last_mirror_at: new Date().toISOString(),
      });
    } catch (err: unknown) {
      log.warn({ err }, 'Failed to update mirror backup success status');
    }
  } catch (err: unknown) {
    if (tmpArchive && existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
    if (tmpMeta && existsSync(tmpMeta)) rmSync(tmpMeta, { force: true });
    if (targetArchiveWritten && !targetMetaWritten && targetArchive && existsSync(targetArchive)) {
      rmSync(targetArchive, { force: true });
    }
    if (!targetArchiveWritten && targetMetaWritten && targetMeta && existsSync(targetMeta)) {
      rmSync(targetMeta, { force: true });
    }
    const message = `镜像备份失败: ${getErrorMessage(err)}`;
    addLog(job, message);
    try {
      await updateBackupPolicySettings({
        backup_last_mirror_status: 'error',
        backup_last_mirror_message: message,
        backup_last_mirror_at: new Date().toISOString(),
      });
    } catch (statusErr: unknown) {
      log.warn({ err: statusErr }, 'Failed to update mirror backup error status');
    }
  }
}

const SYSTEM_PATH_BLOCKLIST = [
  '/bin',
  '/sbin',
  '/usr',
  '/etc',
  '/var',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/lib',
  '/lib64',
  '/run',
];

function resolveMirrorBackupDir(value: string): string | null {
  const raw = value.trim();
  if (!raw || !isAbsolute(raw)) return null;
  const target = resolve(raw);
  if (SYSTEM_PATH_BLOCKLIST.some((blocked) => target === blocked || target.startsWith(`${blocked}/`))) return null;
  const forbidden = [resolve(ACTIVE_BACKUP_DIR), resolve(LEGACY_BACKUP_DIR), resolve(BACKUP_WORK_DIR)];
  if (forbidden.some((dir) => target === dir || target.startsWith(`${dir}${sep}`))) return null;
  return target;
}

function cleanupMirrorBackups(mirrorDir: string, keep: number, job: { logs?: string[] }) {
  try {
    if (!existsSync(mirrorDir)) return;
    const records = readdirSync(mirrorDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try {
          const record = JSON.parse(readFileSync(join(mirrorDir, file), 'utf-8')) as BackupRecord;
          return record.id ? record : null;
        } catch {
          return null;
        }
      })
      .filter((record): record is BackupRecord => Boolean(record))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    for (const record of records.slice(keep)) {
      rmSync(join(mirrorDir, `${record.id}.json`), { force: true });
      rmSync(join(mirrorDir, `${record.id}.tar.gz`), { force: true });
      addLog(job, `已清理外部镜像旧备份: ${record.name || record.id}`);
    }
  } catch (err: unknown) {
    addLog(job, `外部镜像保留策略清理失败: ${getErrorMessage(err)}`);
  }
}

function buildBackupHealthMessage(base: string, settings: BackupPolicySettings): string {
  if (!settings.backup_mirror_enabled) return base;
  if (!settings.backup_mirror_dir) return `${base}；外部镜像已开启但未配置目录`;
  if (settings.backup_last_mirror_status === 'error')
    return `${base}；${settings.backup_last_mirror_message || '外部镜像最近失败'}`;
  if (settings.backup_last_mirror_status === 'success') return `${base}；外部镜像正常`;
  return `${base}；外部镜像等待首次执行`;
}

function estimateCurrentBackupBytes(): number {
  const staticDir = join(process.cwd(), config.staticDir);
  const uploadDir = join(process.cwd(), config.uploadDir);
  let total = 0;
  for (const dir of discoverStaticBackupDirs(staticDir)) {
    total += countFilesAndBytesRecursive(join(staticDir, dir)).totalBytes;
  }
  for (const dir of discoverUploadBackupDirs(uploadDir)) {
    total += countFilesAndBytesRecursive(join(uploadDir, dir)).totalBytes;
  }
  // Keep a floor so an empty development instance still performs a useful space check.
  return Math.max(total, 1024 * 1024 * 1024);
}

function checkWritableDirectory(dir: string, label: string): BackupPolicyCheckItem {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.backup_write_test_${process.pid}_${Date.now()}`);
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    return { key: `write:${dir}`, label, status: 'ok', message: `${dir} 可写` };
  } catch (err: unknown) {
    return { key: `write:${dir}`, label, status: 'error', message: `${dir} 不可写: ${getErrorMessage(err)}` };
  }
}

function checkDiskSpace(dir: string, requiredBytes: number, label: string): BackupPolicyCheckItem {
  try {
    mkdirSync(dir, { recursive: true });
    const availableBytes = getAvailableBytes(dir);
    if (availableBytes === null) {
      return { key: `space:${dir}`, label, status: 'warning', message: `无法读取 ${dir} 的剩余空间` };
    }
    const status = availableBytes >= requiredBytes ? 'ok' : 'error';
    return {
      key: `space:${dir}`,
      label,
      status,
      message: `${dir} 可用 ${formatSize(availableBytes)}，预计至少需要 ${formatSize(requiredBytes)}`,
    };
  } catch (err: unknown) {
    return { key: `space:${dir}`, label, status: 'error', message: `检查磁盘空间失败: ${getErrorMessage(err)}` };
  }
}

function getAvailableBytes(dir: string): number | null {
  try {
    const raw = execFileSync('df', ['-Pk', dir], { encoding: 'utf-8', timeout: 10_000 });
    const lines = raw.trim().split(/\r?\n/);
    const parts = lines[1]?.trim().split(/\s+/);
    const availableKb = Number(parts?.[3]);
    if (!Number.isFinite(availableKb)) return null;
    return availableKb * 1024;
  } catch {
    return null;
  }
}

async function getBackupPolicySettings(): Promise<BackupPolicySettings> {
  const { getAllSettings } = await import('./settings.js');
  const settings = await getAllSettings();
  return {
    backup_auto_enabled: Boolean(settings.backup_auto_enabled),
    backup_schedule_time: normalizeScheduleTime(settings.backup_schedule_time),
    backup_retention_count: clampRetentionCount(settings.backup_retention_count),
    backup_mirror_enabled: Boolean(settings.backup_mirror_enabled),
    backup_mirror_dir: typeof settings.backup_mirror_dir === 'string' ? settings.backup_mirror_dir.trim() : '',
    backup_last_mirror_status:
      typeof settings.backup_last_mirror_status === 'string' ? settings.backup_last_mirror_status : '',
    backup_last_mirror_message:
      typeof settings.backup_last_mirror_message === 'string' ? settings.backup_last_mirror_message : '',
    backup_last_mirror_at: typeof settings.backup_last_mirror_at === 'string' ? settings.backup_last_mirror_at : '',
    backup_last_auto_date: typeof settings.backup_last_auto_date === 'string' ? settings.backup_last_auto_date : '',
    backup_last_auto_status:
      typeof settings.backup_last_auto_status === 'string' ? settings.backup_last_auto_status : '',
    backup_last_auto_message:
      typeof settings.backup_last_auto_message === 'string' ? settings.backup_last_auto_message : '',
    backup_last_auto_job_id:
      typeof settings.backup_last_auto_job_id === 'string' ? settings.backup_last_auto_job_id : '',
    backup_last_auto_at: typeof settings.backup_last_auto_at === 'string' ? settings.backup_last_auto_at : '',
  };
}

async function updateBackupPolicySettings(settings: Partial<BackupPolicySettings>) {
  const { setSettings } = await import('./settings.js');
  await setSettings(settings as Record<string, unknown>);
}

function normalizeScheduleTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return '03:00';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function clampRetentionCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(60, Math.max(1, Math.floor(parsed)));
}

function isScheduleDue(scheduleTime: string): boolean {
  const [h, m] = scheduleTime.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  const diffMs = now.getTime() - target.getTime();
  return diffMs >= 0 && diffMs < 120_000;
}

function localDateKey(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function nextScheduledRunIso(scheduleTime: string): string {
  const [hourRaw, minuteRaw] = normalizeScheduleTime(scheduleTime).split(':');
  const next = new Date();
  next.setHours(Number(hourRaw), Number(minuteRaw), 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function cleanupPartialArchives(dir: string) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const isPartialFile =
        entry.isFile() &&
        (entry.name.endsWith('.tmp') ||
          entry.name.endsWith('.part') ||
          entry.name.endsWith('.tar.gz.tmp') ||
          entry.name.endsWith('.json.tmp'));
      const isPartialDir = entry.isDirectory() && entry.name.startsWith('.restore_');
      if (!isPartialFile && !isPartialDir) continue;
      const target = join(dir, entry.name);
      rmSync(target, { recursive: isPartialDir, force: true });
      log.warn({ path: target }, 'Removed orphan backup temp artifact');
    }
  } catch (err: unknown) {
    log.warn({ dir, err }, 'Failed to clean backup temp artifacts');
  }
}

function cleanupStaleBackupWorkDirs(dir: string) {
  try {
    if (!existsSync(dir) || lockOwnerIsAlive()) return;
    const stalePrefixes = ['backup_', 'restore_', 'verify_', 'importsave_', 'peek_'];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!stalePrefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
      const target = join(dir, entry.name);
      rmSync(target, { recursive: true, force: true });
      log.warn({ path: target }, 'Removed stale backup work directory');
    }
  } catch (err: unknown) {
    log.warn({ dir, err }, 'Failed to clean stale backup work directories');
  }
}

const completedStepWhere = {
  status: 'completed',
  OR: [
    { format: { equals: 'step', mode: 'insensitive' as const } },
    { format: { equals: 'stp', mode: 'insensitive' as const } },
    { format: { equals: 'iges', mode: 'insensitive' as const } },
    { format: { equals: 'igs', mode: 'insensitive' as const } },
  ],
};

async function countStepModelsInDatabase(): Promise<number> {
  const prisma = await getBackupPrisma();
  return await prisma.model.count({ where: completedStepWhere });
}

async function countStepModelsInSqlDump(sqlPath: string): Promise<number> {
  return new Promise((resolve) => {
    let count = 0;
    const input = createReadStream(sqlPath, { encoding: 'utf-8' });
    const rl = createInterface({ input, crlfDelay: Infinity });

    let inModelsCopy = false;
    let formatIndex = -1;
    let statusIndex = -1;

    rl.on('line', (line: string) => {
      if (!inModelsCopy) {
        const match = line.match(/^COPY\s+(?:public\.)?"?models"?\s+\((.+)\)\s+FROM\s+stdin;$/i);
        if (!match) return;

        const columns = match[1].split(',').map((value) => value.trim().replace(/^"|"$/g, ''));
        formatIndex = columns.findIndex((column) => column === 'format');
        statusIndex = columns.findIndex((column) => column === 'status');
        if (formatIndex === -1 || statusIndex === -1) {
          rl.close();
          return;
        }
        inModelsCopy = true;
        return;
      }

      if (line === '\\.') {
        rl.close();
        return;
      }
      if (!line) return;

      const fields = line.split('\t');
      const format = (fields[formatIndex] || '').toLowerCase();
      const status = (fields[statusIndex] || '').toLowerCase();
      if (status === 'completed' && STEP_EXTENSIONS.has(`.${format}`)) {
        count += 1;
      }
    });

    rl.on('close', () => resolve(count));
    input.on('error', () => resolve(0));
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
