import { execFileSync, spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, statfsSync, readdirSync, readFileSync, renameSync, openSync, closeSync, writeSync, readSync, createReadStream, createWriteStream, copyFileSync, cpSync } from "fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "path";
import { createHash } from "crypto";
import { createInterface } from "readline";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { syncJob, loadJob } from "./jobStore.js";

// Read app version from package.json
let _appVersion: string | null = null;
function getAppVersion(): string {
  if (_appVersion) return _appVersion;
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    _appVersion = pkg.version || "unknown";
  } catch { _appVersion = "unknown"; }
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

const DB_URL = config.databaseUrl;
// Strip Prisma-specific query params that pg_dump/psql don't understand
const DB_URL_CLEAN = DB_URL.replace(/\?.*/, "");
// Prefer static/backups (bind-mount in Docker → host disk space) over uploads/backups (named volume → limited space)
const ACTIVE_BACKUP_DIR = join(process.cwd(), config.staticDir, "backups");
const LEGACY_BACKUP_DIR = join(process.cwd(), config.uploadDir, "backups");
const BACKUP_DIRS = Array.from(new Set([ACTIVE_BACKUP_DIR, LEGACY_BACKUP_DIR]));
const BACKUP_WORK_DIR = join(ACTIVE_BACKUP_DIR, ".work");
const SAFETY_SNAPSHOT_DIR = join(ACTIVE_BACKUP_DIR, "_safety_snapshots");
const BACKUP_DB_ENTRY_DIR = "_backup_db";
const BACKUP_DATABASE_ENTRY = `${BACKUP_DB_ENTRY_DIR}/database.sql`;
const BACKUP_META_ENTRY = `${BACKUP_DB_ENTRY_DIR}/meta.json`;
const BACKUP_MANIFEST_ENTRY = `${BACKUP_DB_ENTRY_DIR}/manifest.json`;
const BACKUP_UPLOAD_METADATA_ENTRY = `${BACKUP_DB_ENTRY_DIR}/metadata`;
const BACKUP_UPLOADS_ENTRY = `${BACKUP_DB_ENTRY_DIR}/uploads`;
const STATIC_BACKUP_EXCLUDE_DIRS = new Set(["backups", BACKUP_DB_ENTRY_DIR, "_safety_snapshots"]);
const UPLOAD_BACKUP_EXCLUDE_DIRS = new Set(["backups", "chunks", "batch", ".download_tokens"]);
const RESTORE_PRIORITY_DIRS = ["models", "thumbnails", "originals", "drawings"];
const MODULE_EXT = import.meta.url.endsWith(".ts") ? ".ts" : ".js";

// Detect whether pg_dump/psql are available locally, otherwise use docker exec
let dockerContainerChecked = false;
let _dockerContainer: string | null = null;
function getDockerContainer(): string | null {
  if (dockerContainerChecked) return _dockerContainer;
  dockerContainerChecked = true;
  try {
    execFileSync("pg_dump", ["--version"], { stdio: "pipe", timeout: 5000 });
    _dockerContainer = null;
    return null;
  } catch {
    // pg_dump not found locally — try docker
    try {
      const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { stdio: "pipe", timeout: 5000 }).toString().trim().split("\n");
      let container = containers.find(c => c.includes("postgres"));
      if (container) {
        container = container.trim();
        console.log(`[Backup] pg_dump not found locally, using docker exec ${container}`);
        _dockerContainer = container;
        return container;
      }
    } catch { /* docker not available either */ }
    _dockerContainer = null;
    return null;
  }
}

/** pg_dump to file — works with local install or Docker container */
function pgDumpToFile(dbUrl: string, outputPath: string, extraArgs: string[], timeout: number) {
  const container = getDockerContainer();
  const outputFd = openSync(outputPath, "w");
  try {
    if (container) {
      // Docker: use local connection (no host:port) inside the container
      const dbName = new URL(dbUrl).pathname.replace(/^\//, "");
      const user = new URL(dbUrl).username;
      execFileSync("docker", ["exec", container, "pg_dump", "-U", user, "-d", dbName, ...extraArgs], {
        stdio: ["ignore", outputFd, "pipe"],
        timeout,
      });
      return;
    }
    execFileSync("pg_dump", [dbUrl, ...extraArgs], {
      stdio: ["ignore", outputFd, "pipe"],
      timeout,
    });
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
    const dbName = new URL(dbUrl).pathname.replace(/^\//, "");
    const user = new URL(dbUrl).username;
    execFileSync("docker", ["cp", sqlPath, `${container}:${containerPath}`], { stdio: "pipe", timeout: 30000 });
    try {
      execFileSync("docker", ["exec", container, "psql", "-U", user, "-d", dbName, ...extraArgs, "-f", containerPath], {
        stdio: "pipe",
        timeout,
      });
    } finally {
      try { execFileSync("docker", ["exec", container, "rm", "-f", containerPath], { stdio: "pipe" }); } catch {}
    }
  } else {
    execFileSync("psql", [dbUrl, ...extraArgs, "-f", sqlPath], { stdio: "pipe", timeout });
  }
}

/** psql with -c flag — works with local install or Docker container */
function psqlCommand(dbUrl: string, sql: string, extraArgs: string[], timeout: number) {
  const container = getDockerContainer();
  if (container) {
    const dbName = new URL(dbUrl).pathname.replace(/^\//, "");
    const user = new URL(dbUrl).username;
    execFileSync("docker", ["exec", container, "psql", "-U", user, "-d", dbName, ...extraArgs, "-c", sql], {
      stdio: "pipe",
      timeout,
    });
  } else {
    execFileSync("psql", [dbUrl, ...extraArgs, "-c", sql], {
      stdio: "pipe",
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
const ARCHIVE_META_TIMEOUT_MS = 5 * 60_000;
const STEP_EXTENSIONS = new Set([".step", ".stp", ".iges", ".igs", ".xt", ".x_t"]);

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
  name: string;
  createdAt: string;
  fileSize: number;
  fileSizeText: string;
  modelCount: number;
  thumbnailCount: number;
  dbSize: string;
  countMode?: "step_models";
  archiveSha256?: string;
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
  schemaVersion: "3.0";
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

function buildMetaPath(baseDir: string, id: string) { return join(baseDir, `${id}.json`); }
function buildArchivePath(baseDir: string, id: string) { return join(baseDir, `${id}.tar.gz`); }

function resolveBackupDir(id: string): string | null {
  for (const dir of BACKUP_DIRS) {
    if (existsSync(buildArchivePath(dir, id))) return dir;
  }
  for (const dir of BACKUP_DIRS) {
    if (existsSync(buildMetaPath(dir, id))) return dir;
  }
  return null;
}

function activeMetaPath(id: string) { return buildMetaPath(ACTIVE_BACKUP_DIR, id); }
function activeArchivePath(id: string) { return buildArchivePath(ACTIVE_BACKUP_DIR, id); }
function metaPath(id: string) { return buildMetaPath(resolveBackupDir(id) ?? ACTIVE_BACKUP_DIR, id); }
function archivePath(id: string) { return buildArchivePath(resolveBackupDir(id) ?? ACTIVE_BACKUP_DIR, id); }

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
  stage: "dumping" | "packing" | "saving" | "done" | "error";
  percent: number;
  message: string;
  error?: string;
  logs: string[];
  source?: "manual" | "scheduled";
}

export interface BackupHealth {
  enabled: boolean;
  scheduleTime: string;
  retentionCount: number;
  mirrorEnabled: boolean;
  mirrorDir?: string;
  status: "ok" | "warning" | "disabled" | "empty";
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
}

export interface BackupPolicyCheckItem {
  key: string;
  label: string;
  status: "ok" | "warning" | "error";
  message: string;
}

export interface BackupPolicyCheck {
  status: "ok" | "warning" | "error";
  checkedAt: string;
  estimatedBackupSize: number;
  estimatedBackupSizeText: string;
  checks: BackupPolicyCheckItem[];
}

export interface BackupVerificationResult {
  id: string;
  ok: boolean;
  checkedAt: string;
  fileSize: number;
  fileSizeText: string;
  manifestVersion?: string;
  archiveSha256?: string;
  message: string;
}

interface VerifyJob {
  id: string;
  backupId: string;
  stage: "queued" | "validating_archive" | "hashing_archive" | "writing_record" | "done" | "error";
  percent: number;
  message: string;
  error?: string;
  result?: BackupVerificationResult;
  logs: string[];
}

interface RestoreJob {
  id: string;
  stage: "extracting" | "restoring_db" | "restoring_files" | "done" | "error";
  percent: number;
  message: string;
  error?: string;
  result?: { dbRestored: boolean; modelCount: number; thumbnailCount: number };
  logs: string[];
}

const jobs = new Map<string, BackupJob>();
const restoreJobs = new Map<string, RestoreJob>();
const verifyJobs = new Map<string, VerifyJob>();
const pendingRecordNormalizations = new Set<string>();

// File-based lock to prevent concurrent backup/restore across cluster workers
const LOCK_FILE = join(process.cwd(), config.uploadDir, ".backup_restore.lock");
function lockOwnerIsAlive(): boolean {
  try {
    const raw = readFileSync(LOCK_FILE, "utf-8").trim();
    const pid = Number(raw.split(/\r?\n/)[0]);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err?.code === "ESRCH" || err?.code === "ENOENT") return false;
    // EPERM means a process exists but is not signalable by this user.
    return err?.code === "EPERM";
  }
}

function lockContent(pid: number, jobId?: string, source?: "manual" | "scheduled"): string {
  return [
    String(pid),
    new Date().toISOString(),
    jobId ? `jobId=${jobId}` : "",
    source ? `source=${source}` : "",
  ].filter(Boolean).join("\n") + "\n";
}

function getActiveLockJobId(): string | undefined {
  try {
    const raw = readFileSync(LOCK_FILE, "utf-8");
    return raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("jobId="))?.slice("jobId=".length);
  } catch {
    return undefined;
  }
}

function setLockOwner(pid: number, jobId: string, source: "manual" | "scheduled"): void {
  writeFileSync(LOCK_FILE, lockContent(pid, jobId, source));
}

function acquireLock(): boolean {
  try {
    const fd = openSync(LOCK_FILE, "wx");
    writeSync(fd, lockContent(process.pid));
    closeSync(fd);
    return true;
  } catch {
    // Lock file exists — check if it's stale (older than 2 hours)
    try {
      const { mtime } = statSync(LOCK_FILE);
      if (!lockOwnerIsAlive() || Date.now() - mtime.getTime() > 2 * 60 * 60 * 1000) {
        rmSync(LOCK_FILE, { force: true });
        return acquireLock();
      }
    } catch {}
    return false;
  }
}
function releaseLock(): void {
  try { rmSync(LOCK_FILE, { force: true }); } catch {}
}

function releaseLockForJob(jobId: string): void {
  if (getActiveLockJobId() === jobId) releaseLock();
}

function ts(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

const MAX_LOG_LINES = 200;

function addLog(job: { id?: string; logs?: string[] }, text: string) {
  if (!job.logs) return;
  job.logs.push(`[${ts()}] ${text}`);
  if (job.logs.length > MAX_LOG_LINES) {
    job.logs = job.logs.slice(-MAX_LOG_LINES);
  }
  console.log(`[Backup] ${text}`);
  if (job.id) syncJob({ ...job, id: job.id });
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
  if (latest.stage === "done" || latest.stage === "error") return;
  latest.stage = "error";
  latest.error = message;
  latest.message = message;
  addLog(latest, message);
  syncJob(latest);
  releaseLockForJob(job.id);
}

function monitorWorkerExit<T extends MonitoredWorkerJob>(child: ChildProcess, job: T, label: string) {
  child.once("error", (err) => {
    markWorkerExitIfStillRunning(job, `${label}后台进程启动失败: ${err.message}`);
  });
  child.once("exit", (code, signal) => {
    setTimeout(() => {
      const detail = signal ? `signal=${signal}` : `code=${code ?? "unknown"}`;
      const message = code === 0 && !signal
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
  for (const current of jobs.values()) {
    const job = latestPersistedJob(current);
    jobs.set(job.id, job);
    if (job.stage !== "done" && job.stage !== "error") return job;
  }
  const lockedJobId = getActiveLockJobId();
  if (lockedJobId?.startsWith("backup_") && lockOwnerIsAlive()) {
    const job = loadJob<BackupJob>(lockedJobId);
    if (job && job.stage !== "done" && job.stage !== "error") return job;
    return {
      id: lockedJobId,
      stage: "packing",
      percent: 35,
      message: "备份任务正在后台执行...",
      logs: [],
      source: "manual",
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
  for (const current of verifyJobs.values()) {
    const job = latestPersistedJob(current);
    verifyJobs.set(job.id, job);
    if (job.stage !== "done" && job.stage !== "error") return job;
  }
  const lockedJobId = getActiveLockJobId();
  if (lockedJobId?.startsWith("verify_") && lockOwnerIsAlive()) {
    const job = loadJob<VerifyJob>(lockedJobId);
    if (job && job.stage !== "done" && job.stage !== "error") return job;
  }
  return undefined;
}

export function getActiveRestoreJob(): RestoreJob | undefined {
  for (const current of restoreJobs.values()) {
    const job = latestPersistedJob(current);
    restoreJobs.set(job.id, job);
    if (job.stage !== "done" && job.stage !== "error") return job;
  }
  const lockedJobId = getActiveLockJobId();
  if (lockedJobId?.startsWith("restore_") && lockOwnerIsAlive()) {
    const job = loadJob<RestoreJob>(lockedJobId);
    if (job && job.stage !== "done" && job.stage !== "error") return job;
  }
  return undefined;
}

// ---- Import as backup record (save to backup list) ----

export async function saveAsBackupRecord(archPath: string, originalName: string): Promise<BackupRecord> {
  const id = `backup_${Date.now()}`;
  const dest = activeArchivePath(id);

  try {
    copyFileSync(archPath, dest);
    if (existsSync(archPath)) rmSync(archPath, { force: true });

    const record = await inspectBackupArchive(id, dest, originalName);
    writeFileSync(activeMetaPath(id), JSON.stringify(record, null, 2));
    return record;
  } catch (err) {
    if (existsSync(dest)) rmSync(dest, { force: true });
    if (existsSync(activeMetaPath(id))) rmSync(activeMetaPath(id), { force: true });
    throw err;
  }
}

// ---- Import save as async job ----

interface ImportSaveJob {
  id: string;
  stage: "verifying_archive" | "reading_meta" | "counting_models" | "copying_archive" | "writing_record" | "done" | "error";
  percent: number;
  message: string;
  error?: string;
  result?: BackupRecord;
  logs: string[];
}

const importSaveJobs = new Map<string, ImportSaveJob>();

export function startImportSaveJob(archPath: string, originalName: string): string {
  if (!acquireLock()) throw new Error("有备份、恢复、校验或导入任务正在进行中，请等待完成后再试");
  const jobId = `importsave_${Date.now()}`;
  const job: ImportSaveJob = { id: jobId, stage: "verifying_archive", percent: 5, message: "正在校验备份文件...", logs: [] };
  importSaveJobs.set(jobId, job);
  syncJob(job);

  try {
    const workerScript = fileURLToPath(new URL(`../scripts/importSaveWorker${MODULE_EXT}`, import.meta.url));
    const child = spawn(process.execPath, [...process.execArgv, workerScript, jobId, archPath, originalName], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    if (!child.pid) throw new Error("备份导入保存后台进程启动失败");
    setLockOwner(child.pid, jobId, "manual");
    monitorWorkerExit(child, job, "备份导入保存");
    child.unref();
  } catch (err: any) {
    const message = err.message || "备份导入保存后台进程启动失败";
    job.stage = "error";
    job.error = message;
    job.message = message;
    syncJob(job);
    releaseLock();
    throw err;
  }

  return jobId;
}

export async function runImportSaveWorker(jobId: string, archPath: string, originalName: string) {
  const job = loadJob<ImportSaveJob>(jobId) || {
    id: jobId,
    stage: "verifying_archive",
    percent: 5,
    message: "正在校验备份文件...",
    logs: [],
  };
  importSaveJobs.set(job.id, job);
  syncJob(job);
  try {
    await runImportSave(job, archPath, originalName);
  } finally {
    releaseLockForJob(job.id);
  }
}

async function runImportSave(job: ImportSaveJob, archPath: string, originalName: string) {
  try {
    addLog(job, `开始导入保存: ${originalName}`);

    // Stage 1: Verify archive
    job.stage = "verifying_archive";
    job.percent = 10;
    job.message = "正在校验备份归档...";
    syncJob(job);
    if (!existsSync(archPath)) throw new Error("上传的备份文件不存在");
    const fileSize = statSync(archPath).size;
    addLog(job, `备份文件大小: ${formatSize(fileSize)}`);

    const entries = listArchiveEntries(archPath);
    if (entries.length === 0) throw new Error("备份归档内容为空");
    addLog(job, `归档包含 ${entries.length} 个条目`);

    // Stage 2: Read meta
    job.stage = "reading_meta";
    job.percent = 20;
    job.message = "正在读取备份元数据...";
    syncJob(job);

    // Stage 3: Count models (async — uses streaming)
    job.stage = "counting_models";
    job.percent = 30;
    job.message = "正在统计模型数量...";
    syncJob(job);
    const tmpDir = prepareWorkDir(`peek_${job.id}`);
    try {
      const sqlPath = extractRestoreSqlPath(archPath, tmpDir);
      if (sqlPath) {
        const modelCount = await countStepModelsInSqlDump(sqlPath);
        if (modelCount > 0) addLog(job, `发现 ${modelCount} 个 STEP 模型`);
      }
    } catch {
      // Model counting is best-effort
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }

    // Stage 4: Copy archive to backup storage
    job.stage = "copying_archive";
    job.percent = 50;
    job.message = "正在保存备份文件...";
    addLog(job, "正在复制归档到备份存储...");
    syncJob(job);

    const record = await saveAsBackupRecord(archPath, originalName);

    // Stage 5: Write record
    job.stage = "writing_record";
    job.percent = 90;
    job.message = "正在写入备份记录...";
    syncJob(job);

    addLog(job, `备份记录已保存: ${record.name}`);
    addLog(job, `${record.modelCount} 个模型, ${record.thumbnailCount} 张预览图, 数据库 ${record.dbSize}`);

    job.stage = "done";
    job.percent = 100;
    job.message = "保存完成";
    job.result = record;
    syncJob(job);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
    job.message = `保存失败: ${err.message}`;
    addLog(job, `保存失败: ${err.message}`);
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
    if (job.stage !== "done" && job.stage !== "error") return job;
  }
  const lockedJobId = getActiveLockJobId();
  if (lockedJobId?.startsWith("importsave_") && lockOwnerIsAlive()) {
    const job = loadJob<ImportSaveJob>(lockedJobId);
    if (job && job.stage !== "done" && job.stage !== "error") return job;
  }
  return undefined;
}

// ---- Create backup ----

export function startBackupJob(): string {
  return startBackupProcess("manual");
}

function startScheduledBackupJob(): string {
  return startBackupProcess("scheduled");
}

function startBackupProcess(source: "manual" | "scheduled"): string {
  if (!acquireLock()) {
    const err = new Error("有备份、恢复或校验任务正在进行中，请等待完成后再试");
    (err as Error & { jobId?: string }).jobId = getActiveBackupJob()?.id;
    throw err;
  }
  const id = `backup_${Date.now()}`;
  const job: BackupJob = {
    id,
    stage: "dumping",
    percent: 0,
    message: source === "scheduled" ? "正在执行自动备份..." : "正在导出数据库...",
    logs: [],
    source,
  };
  jobs.set(id, job);
  syncJob(job);

  try {
    const workerScript = fileURLToPath(new URL(`../scripts/backupWorker${MODULE_EXT}`, import.meta.url));
    const child = spawn(process.execPath, [...process.execArgv, workerScript, id, source], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    if (!child.pid) throw new Error("备份后台进程启动失败");
    setLockOwner(child.pid, id, source);
    monitorWorkerExit(child, job, "备份创建");
    child.unref();
  } catch (err: any) {
    job.stage = "error";
    const message = err.message || "备份后台进程启动失败";
    job.error = message;
    job.message = message;
    syncJob(job);
    releaseLock();
    throw err;
  }

  return id;
}

export async function runBackupWorker(jobId: string, source: "manual" | "scheduled" = "manual") {
  const job = loadJob<BackupJob>(jobId) || {
    id: jobId,
    stage: "dumping",
    percent: 0,
    message: source === "scheduled" ? "正在执行自动备份..." : "正在导出数据库...",
    logs: [],
    source,
  };
  job.source = source;
  jobs.set(job.id, job);
  syncJob(job);
  try {
    await runBackup(job);
  } finally {
    releaseLockForJob(job.id);
  }
}

async function runBackup(job: BackupJob) {
  const tmpDir = prepareWorkDir(job.id);
  const finalArchive = activeArchivePath(job.id);

  try {
    addLog(job, "开始备份任务...");

    // Step 1: pg_dump (0-30%)
    job.stage = "dumping";
    job.percent = 5;
    job.message = "正在导出数据库...";
    addLog(job, "正在导出数据库 (pg_dump)...");

    pgDumpToFile(DB_URL_CLEAN, join(tmpDir, "database.sql"), ["--no-owner", "--no-privileges"], DB_DUMP_TIMEOUT_MS);

    if (!existsSync(join(tmpDir, "database.sql"))) {
      throw new Error("数据库导出失败：文件未生成");
    }
    const dbSize = statSync(join(tmpDir, "database.sql")).size;
    addLog(job, `数据库导出完成，大小: ${formatSize(dbSize)}`);
    job.percent = 30;
    syncJob(job);

    // Discover business directories automatically so newly added attachment folders are protected by default.
    const staticDir = join(process.cwd(), config.staticDir);
    const uploadDir = join(process.cwd(), config.uploadDir);
    const existingBackupDirs = discoverStaticBackupDirs(staticDir);
    const uploadBackupDirs = discoverUploadBackupDirs(uploadDir);

    // Write metadata into tmp
    writeFileSync(join(tmpDir, "meta.json"), JSON.stringify({
      timestamp: new Date().toISOString(),
      version: "2.0",
      appVersion: getAppVersion(),
      staticDirs: existingBackupDirs,
      uploadDirs: uploadBackupDirs,
    }, null, 2));

    // Step 2: tar.gz packing (30-95%)
    job.stage = "packing";
    job.percent = 35;
    job.message = "正在打包模型文件...";
    addLog(job, "正在打包模型、预览图和原始文件...");

    // Stage database and upload-volume data inside the private backup work dir.
    // This avoids putting transient backup internals under /static, where dev
    // restarts or startup cleanup could remove them while tar is still running.
    const archiveRoot = join(tmpDir, "archive");
    const dbMarker = join(archiveRoot, BACKUP_DB_ENTRY_DIR);
    rmSync(archiveRoot, { recursive: true, force: true });
    mkdirSync(dbMarker, { recursive: true });
    copyFileSync(join(tmpDir, "database.sql"), join(dbMarker, "database.sql"));
    copyFileSync(join(tmpDir, "meta.json"), join(dbMarker, "meta.json"));

    // Copy uploads data into staging for inclusion in backup. Keep the legacy metadata path too.
    const uploadMetadataDir = join(process.cwd(), config.uploadDir, ".metadata");
    const stagedUploadsDir = join(dbMarker, "uploads");
    for (const dir of uploadBackupDirs) {
      const source = join(uploadDir, dir);
      const destination = join(stagedUploadsDir, dir);
      copyDirectoryContents(source, destination);
    }
    if (existsSync(uploadMetadataDir)) {
      copyDirectoryContents(uploadMetadataDir, join(dbMarker, "metadata"));
    }

    const manifestDirs: ArchiveDirectorySpec[] = [
      ...existingBackupDirs.map((dir) => ({ path: dir, source: join(staticDir, dir) })),
      ...uploadBackupDirs.map((dir) => ({ path: `${BACKUP_UPLOADS_ENTRY}/${dir}`, source: join(stagedUploadsDir, dir) })),
    ];
    if (existsSync(join(dbMarker, "metadata"))) {
      manifestDirs.push({ path: BACKUP_UPLOAD_METADATA_ENTRY, source: join(dbMarker, "metadata") });
    }

    const manifest = await createBackupManifest(
      job.id,
      join(tmpDir, "database.sql"),
      manifestDirs,
    );
    writeJsonAtomic(join(tmpDir, "manifest.json"), manifest);
    writeJsonAtomic(join(dbMarker, "manifest.json"), manifest);
    addLog(job, `备份清单已生成: ${manifest.directories.length} 个目录，数据库校验 ${manifest.database.sha256.slice(0, 12)}...`);

    await new Promise<void>((resolve, reject) => {
      const tmpArchive = join(tmpDir, `${job.id}.tar.gz.tmp`);
      const args: string[] = ["czf", tmpArchive];
      args.push(
        "--exclude=__MACOSX",
        "--exclude=*/__MACOSX",
        "--exclude=.DS_Store",
        "--exclude=*/.DS_Store",
        "--exclude=._*",
        "--exclude=*/._*",
        "--exclude=backups",
        "--exclude=.restore_*",
      );
      args.push("-C", archiveRoot, BACKUP_DB_ENTRY_DIR);
      for (const d of existingBackupDirs) args.push("-C", staticDir, d);

      const proc = spawn("tar", args, { timeout: ARCHIVE_EXTRACT_TIMEOUT_MS });
      let stderr = "";

      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("error", (err) => {
        if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
        reject(err);
      });
      proc.on("close", (code) => {
        clearInterval(progressInterval);
        if (code === 0) {
          renameSync(tmpArchive, finalArchive);
          resolve();
        } else {
          if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
          reject(new Error(`tar failed (code ${code}): ${stderr}`));
        }
      });

      // Progress simulation
      let p = 35;
      const progressInterval = setInterval(() => {
        if (p < 95) {
          const step = p < 70 ? 1.5 : 0.5;
          p = Math.min(95, p + step);
          job.percent = Math.round(p);
          if (p < 55) job.message = "正在打包模型文件...";
          else if (p < 75) job.message = "正在压缩归档...";
          else job.message = "即将完成...";
        } else if (existsSync(tmpArchive)) {
          job.message = `正在压缩归档... 已生成 ${formatSize(statSync(tmpArchive).size)}`;
        }
        syncJob(job);
      }, 3000);
    });

    // Step 3: Save metadata (95-100%)
    job.stage = "saving";
    job.percent = 96;
    job.message = "正在保存备份记录...";
    syncJob(job);
    addLog(job, `打包完成，文件大小: ${formatSize(statSync(finalArchive).size)}`);
    addLog(job, "正在校验备份包完整性...");
    await validateBackupArchive(finalArchive, {
      expectedManifest: manifest,
      onEntryProgress: ({ elapsedMs, entryCount }) => {
        const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
        job.message = `正在校验备份包完整性... 已扫描 ${entryCount} 项，用时 ${elapsedSec}s`;
        syncJob(job);
      },
    });
    addLog(job, "备份包完整性校验通过");
    addLog(job, "正在计算备份包 SHA256...");
    job.percent = 97;
    job.message = "正在计算备份包 SHA256... 0%";
    syncJob(job);
    const archiveSha256 = await sha256FileWithProgress(finalArchive, (percent) => {
      job.percent = Math.max(97, Math.min(99, 97 + Math.floor(percent / 50)));
      job.message = `正在计算备份包 SHA256... ${percent}%`;
      syncJob(job);
    });
    addLog(job, "正在保存备份记录...");
    job.percent = 99;
    job.message = "正在写入备份记录...";
    syncJob(job);

    const stats = await getBackupStats();
    const fileSize = statSync(finalArchive).size;
    const record: BackupRecord = {
      id: job.id,
      filename: `${job.id}.tar.gz`,
      name: `备份 ${formatDate(new Date())}`,
      createdAt: new Date().toISOString(),
      fileSize,
      fileSizeText: formatSize(fileSize),
      modelCount: stats.modelCount,
      thumbnailCount: stats.thumbnailCount,
      dbSize: stats.dbSize,
      countMode: "step_models",
      archiveSha256,
      manifestVersion: manifest.schemaVersion,
      verifiedAt: new Date().toISOString(),
    };
    writeJsonAtomic(activeMetaPath(job.id), record);
    await mirrorBackupIfEnabled(record, job);

    job.stage = "done";
    job.percent = 100;
    job.message = "备份完成";
    addLog(job, `备份完成！共 ${record.modelCount} 个 STEP 模型，${record.thumbnailCount} 张预览图`);
    await applyBackupRetentionPolicy(job);
    if (job.source === "scheduled") {
      await updateBackupPolicySettings({
        backup_last_auto_date: localDateKey(),
        backup_last_auto_status: "success",
        backup_last_auto_message: `自动备份完成: ${record.fileSizeText}`,
        backup_last_auto_job_id: job.id,
        backup_last_auto_at: new Date().toISOString(),
      });
    }

    console.log(`[Backup #${job.id}] Done: ${formatSize(fileSize)}`);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
    syncJob(job);
    if (job.source === "scheduled") {
      await updateBackupPolicySettings({
        backup_last_auto_status: "error",
        backup_last_auto_message: err.message || "自动备份失败",
        backup_last_auto_job_id: job.id,
        backup_last_auto_at: new Date().toISOString(),
      });
    }
    if (existsSync(finalArchive)) rmSync(finalArchive, { force: true });
    if (existsSync(activeMetaPath(job.id))) rmSync(activeMetaPath(job.id), { force: true });
    console.error(`[Backup #${job.id}] Error:`, err.message);
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- List backups ----

export function listBackups(): BackupRecord[] {
  const records: BackupRecord[] = [];
  const seen = new Set<string>();

  for (const dir of BACKUP_DIRS) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), "utf-8");
        const record = JSON.parse(raw) as BackupRecord;
        if (seen.has(record.id)) continue;
        const archive = buildArchivePath(dir, record.id);
        if (!existsSync(archive)) continue;
        records.push(normalizeBackupRecord(record, archive, join(dir, file)));
        seen.add(record.id);
      } catch {}
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
  const nextRunAt = settings.backup_auto_enabled
    ? nextScheduledRunIso(settings.backup_schedule_time)
    : undefined;

  if (!settings.backup_auto_enabled) {
    return {
      enabled: false,
      scheduleTime: settings.backup_schedule_time,
      retentionCount: settings.backup_retention_count,
      mirrorEnabled: settings.backup_mirror_enabled,
      mirrorDir: settings.backup_mirror_dir || undefined,
      status: backups.length > 0 ? "disabled" : "empty",
      message: buildBackupHealthMessage(
        backups.length > 0 ? "自动备份未开启，已有手动备份可用" : "尚无备份，建议先创建一次手动备份",
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
    };
  }

  if (!latestBackup) {
    return {
      enabled: true,
      scheduleTime: settings.backup_schedule_time,
      retentionCount: settings.backup_retention_count,
      mirrorEnabled: settings.backup_mirror_enabled,
      mirrorDir: settings.backup_mirror_dir || undefined,
      status: "empty",
      message: buildBackupHealthMessage("自动备份已开启，但当前还没有任何备份", settings),
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
    };
  }

  const latestAgeMs = Date.now() - new Date(latestBackup.createdAt).getTime();
  const stale = latestAgeMs > 36 * 60 * 60 * 1000;
  const mirrorWarning = settings.backup_mirror_enabled && settings.backup_last_mirror_status === "error";
  return {
    enabled: true,
    scheduleTime: settings.backup_schedule_time,
    retentionCount: settings.backup_retention_count,
    mirrorEnabled: settings.backup_mirror_enabled,
    mirrorDir: settings.backup_mirror_dir || undefined,
    status: stale || mirrorWarning ? "warning" : "ok",
    message: buildBackupHealthMessage(
      stale ? "最近一次备份超过 36 小时，请检查自动备份任务" : "备份策略正常，最近备份可用",
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
  };
}

export async function getBackupPolicyCheck(): Promise<BackupPolicyCheck> {
  const settings = await getBackupPolicySettings();
  const checks: BackupPolicyCheckItem[] = [];
  const estimatedBackupSize = estimateCurrentBackupBytes();
  const requiredBytes = Math.ceil(estimatedBackupSize * 1.25);

  checks.push(checkWritableDirectory(ACTIVE_BACKUP_DIR, "本地备份目录可写"));
  checks.push(checkDiskSpace(ACTIVE_BACKUP_DIR, requiredBytes, "本地备份磁盘空间"));

  if (settings.backup_auto_enabled) {
    checks.push({
      key: "schedule",
      label: "自动备份计划",
      status: "ok",
      message: `已开启，每日 ${settings.backup_schedule_time} 自动备份`,
    });
  } else {
    checks.push({
      key: "schedule",
      label: "自动备份计划",
      status: "warning",
      message: "自动备份未开启，建议确认手动备份稳定后开启",
    });
  }

  checks.push({
    key: "retention",
    label: "保留份数",
    status: settings.backup_retention_count >= 3 ? "ok" : "warning",
    message: `当前保留 ${settings.backup_retention_count} 份${settings.backup_retention_count < 3 ? "，建议至少 3 份" : ""}`,
  });

  if (settings.backup_mirror_enabled) {
    const mirrorDir = resolveMirrorBackupDir(settings.backup_mirror_dir);
    if (!mirrorDir) {
      checks.push({
        key: "mirror_dir",
        label: "外部镜像目录",
        status: "error",
        message: "镜像目录无效，请填写独立磁盘/NAS 的绝对路径，不能指向当前备份目录",
      });
    } else {
      checks.push(checkWritableDirectory(mirrorDir, "外部镜像目录可写"));
      checks.push(checkDiskSpace(mirrorDir, requiredBytes, "外部镜像磁盘空间"));
    }
  } else {
    checks.push({
      key: "mirror",
      label: "外部镜像备份",
      status: "warning",
      message: "外部镜像未开启，服务器硬盘故障时本地备份可能一起丢失",
    });
  }

  const latest = listBackups()[0];
  if (!latest) {
    checks.push({
      key: "latest_backup",
      label: "最近备份可用性",
      status: "warning",
      message: "当前没有备份记录，请先创建一次备份",
    });
  } else {
    try {
      await verifyBackupArchive(latest.id);
      checks.push({
        key: "latest_backup",
        label: "最近备份可用性",
        status: "ok",
        message: `最近备份 ${latest.name} 校验通过`,
      });
    } catch (err: any) {
      const isLegacyBackup = isMissingManifestError(err);
      checks.push({
        key: "latest_backup",
        label: "最近备份可用性",
        status: isLegacyBackup ? "warning" : "error",
        message: isLegacyBackup
          ? `最近备份 ${latest.name} 是旧版备份，缺少企业级清单；建议重新创建一次备份`
          : `最近备份校验失败: ${err?.message || err}`,
      });
    }
  }

  return {
    status: checks.some((check) => check.status === "error") ? "error" : checks.some((check) => check.status === "warning") ? "warning" : "ok",
    checkedAt: new Date().toISOString(),
    estimatedBackupSize,
    estimatedBackupSizeText: formatSize(estimatedBackupSize),
    checks,
  };
}

export async function verifyBackupArchive(id: string): Promise<BackupVerificationResult> {
  const archive = archivePath(id);
  if (!existsSync(archive)) throw new Error("备份文件不存在");
  const meta = metaPath(id);
  const record = existsSync(meta) ? JSON.parse(readFileSync(meta, "utf-8")) as BackupRecord : null;
  const manifest = await validateBackupArchive(archive, { requireManifest: true });
  const archiveSha256 = await sha256File(archive);
  if (record?.archiveSha256 && record.archiveSha256 !== archiveSha256) {
    throw new Error("备份归档 SHA256 与记录不一致");
  }
  const checkedAt = new Date().toISOString();
  if (record) {
    writeJsonAtomic(meta, {
      ...record,
      archiveSha256,
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
    message: "备份包 manifest、数据库 SHA256、目录文件数校验通过",
  };
}

export function startVerifyBackupJob(backupId: string): string {
  if (!acquireLock()) throw new Error("有备份、恢复或校验任务正在进行中，请等待完成后再试");
  const id = `verify_${Date.now()}`;
  const job: VerifyJob = {
    id,
    backupId,
    stage: "queued",
    percent: 0,
    message: "正在准备校验备份...",
    logs: [],
  };
  verifyJobs.set(id, job);
  syncJob(job);

  try {
    const workerScript = fileURLToPath(new URL(`../scripts/verifyBackupWorker${MODULE_EXT}`, import.meta.url));
    const child = spawn(process.execPath, [...process.execArgv, workerScript, id, backupId], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    if (!child.pid) throw new Error("备份校验后台进程启动失败");
    setLockOwner(child.pid, id, "manual");
    monitorWorkerExit(child, job, "备份校验");
    child.unref();
  } catch (err: any) {
    const message = err.message || "备份校验后台进程启动失败";
    job.stage = "error";
    job.error = message;
    job.message = message;
    syncJob(job);
    releaseLock();
    throw err;
  }

  return id;
}

export async function runVerifyBackupWorker(jobId: string, backupId: string) {
  const job = loadJob<VerifyJob>(jobId) || {
    id: jobId,
    backupId,
    stage: "queued",
    percent: 0,
    message: "正在准备校验备份...",
    logs: [],
  };
  verifyJobs.set(job.id, job);
  syncJob(job);
  try {
    await runVerifyBackup(job, backupId);
  } finally {
    releaseLockForJob(job.id);
  }
}

async function runVerifyBackup(job: VerifyJob, backupId: string) {
  try {
    addLog(job, "开始校验备份...");
    const archive = archivePath(backupId);
    if (!existsSync(archive)) throw new Error("备份文件不存在");
    const meta = metaPath(backupId);
    const record = existsSync(meta) ? JSON.parse(readFileSync(meta, "utf-8")) as BackupRecord : null;

    job.stage = "validating_archive";
    job.percent = 10;
    job.message = "正在校验备份清单、数据库和目录文件数...";
    syncJob(job);
    const manifest = await validateBackupArchive(archive, {
      requireManifest: true,
      onEntryProgress: ({ elapsedMs, entryCount }) => {
        const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
        job.percent = Math.min(65, 10 + Math.floor(elapsedSec / 4));
        job.message = `正在校验备份清单、数据库和目录文件数... 已扫描 ${entryCount} 项，用时 ${elapsedSec}s`;
        syncJob(job);
      },
    });
    addLog(job, "备份清单、数据库和目录文件数校验通过");

    job.stage = "hashing_archive";
    job.percent = 70;
    job.message = "正在计算备份包 SHA256...";
    syncJob(job);
    const archiveSha256 = await sha256FileWithProgress(archive, (percent) => {
      job.percent = Math.max(70, Math.min(95, 70 + Math.round(percent * 0.25)));
      job.message = `正在计算备份包 SHA256... ${percent}%`;
      syncJob(job);
    });
    if (record?.archiveSha256 && record.archiveSha256 !== archiveSha256) {
      throw new Error("备份归档 SHA256 与记录不一致");
    }

    const checkedAt = new Date().toISOString();
    job.stage = "writing_record";
    job.percent = 96;
    job.message = "正在写入校验记录...";
    syncJob(job);
    if (record) {
      writeJsonAtomic(meta, {
        ...record,
        archiveSha256,
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
      message: "备份包 manifest、数据库 SHA256、目录文件数校验通过",
    };
    job.stage = "done";
    job.percent = 100;
    job.message = "备份校验完成";
    addLog(job, "备份校验完成");
    syncJob(job);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message || "备份校验失败";
    job.message = `备份校验失败: ${job.error}`;
    addLog(job, job.message);
    syncJob(job);
  }
}

function isMissingManifestError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return message.includes("缺少企业级清单文件");
}

// ---- Rename backup ----

export function renameBackup(id: string, newName: string): BackupRecord | null {
  const meta = metaPath(id);
  if (!existsSync(meta) || !existsSync(archivePath(id))) return null;
  const raw = readFileSync(meta, "utf-8");
  const record = JSON.parse(raw) as BackupRecord;
  record.name = newName;
  writeFileSync(meta, JSON.stringify(record, null, 2));
  return record;
}

// ---- Delete backup ----

export function deleteBackup(id: string): boolean {
  let deleted = false;
  for (const dir of BACKUP_DIRS) {
    const meta = buildMetaPath(dir, id);
    const arch = buildArchivePath(dir, id);
    if (existsSync(meta)) { rmSync(meta, { force: true }); deleted = true; }
    if (existsSync(arch)) { rmSync(arch, { force: true }); deleted = true; }
  }
  return deleted;
}

// ---- Restore ----

export function startRestoreJob(backupId: string): string {
  if (!acquireLock()) throw new Error("有备份、恢复或校验任务正在进行中，请等待完成后再试");
  const jobId = `restore_${Date.now()}`;
  const job: RestoreJob = { id: jobId, stage: "extracting", percent: 0, message: "正在解压备份文件...", logs: [] };
  restoreJobs.set(jobId, job);
  syncJob(job);

  try {
    startRestoreWorkerProcess(job, ["backup", backupId]);
  } catch (err) {
    releaseLock();
    throw err;
  }

  return jobId;
}

async function runRestore(job: RestoreJob, backupId: string) {
  ensureBackupStoredInActiveDir(backupId);
  const arch = archivePath(backupId);
  if (!existsSync(arch)) throw new Error("备份文件不存在");
  await runRestoreFromArchive(job, arch, false);
}

// ---- Restore from uploaded file (import) ----

export function startRestoreJobFromFile(archPath: string, removeAfter = true): string {
  if (!acquireLock()) throw new Error("有备份、恢复或校验任务正在进行中，请等待完成后再试");
  const jobId = `restore_${Date.now()}`;
  const job: RestoreJob = { id: jobId, stage: "extracting", percent: 0, message: "正在上传完成，开始解压...", logs: [] };
  restoreJobs.set(jobId, job);
  syncJob(job);

  try {
    startRestoreWorkerProcess(job, ["file", archPath, removeAfter ? "true" : "false"]);
  } catch (err) {
    releaseLock();
    throw err;
  }

  return jobId;
}

async function runRestoreFromFile(job: RestoreJob, archPath: string, removeAfter: boolean) {
  await runRestoreFromArchive(job, archPath, removeAfter);
}

function startRestoreWorkerProcess(job: RestoreJob, args: string[]) {
  try {
    const workerScript = fileURLToPath(new URL(`../scripts/restoreWorker${MODULE_EXT}`, import.meta.url));
    const child = spawn(process.execPath, [...process.execArgv, workerScript, job.id, ...args], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    if (!child.pid) throw new Error("备份恢复后台进程启动失败");
    setLockOwner(child.pid, job.id, "manual");
    monitorWorkerExit(child, job, "备份恢复");
    child.unref();
  } catch (err: any) {
    const message = err.message || "备份恢复后台进程启动失败";
    job.stage = "error";
    job.error = message;
    job.message = message;
    syncJob(job);
    throw err;
  }
}

export async function runRestoreWorker(
  jobId: string,
  mode: "backup" | "file",
  target: string,
  removeAfter = true,
) {
  const job = loadJob<RestoreJob>(jobId) || {
    id: jobId,
    stage: "extracting",
    percent: 0,
    message: mode === "backup" ? "正在解压备份文件..." : "正在上传完成，开始解压...",
    logs: [],
  };
  restoreJobs.set(job.id, job);
  syncJob(job);
  try {
    if (mode === "backup") {
      await runRestore(job, target);
    } else {
      await runRestoreFromFile(job, target, removeAfter);
    }
  } finally {
    releaseLockForJob(job.id);
  }
}

async function runRestoreFromArchive(job: RestoreJob, archPath: string, removeArchiveAfterExtract: boolean) {
  const tmpDir = prepareWorkDir(job.id);
  const result = { dbRestored: false, modelCount: 0, thumbnailCount: 0 };
  let safetySnapshot: string | null = null; // Pre-restore safety backup

  try {
    addLog(job, "开始恢复任务...");

    job.stage = "extracting";
    job.percent = 5;
    job.message = "正在读取备份数据库...";
    addLog(job, "正在提取备份数据库文件...");
    syncJob(job);

    addLog(job, "正在执行备份包完整性预检...");
    await validateBackupArchive(archPath);
    addLog(job, "备份包完整性预检通过");

    const sqlPath = extractRestoreSqlPath(archPath, tmpDir);
    job.percent = 30;
    syncJob(job);

    job.message = "正在预检备份文件目录...";
    addLog(job, "正在预检模型、上传、静态文件目录...");
    syncJob(job);
    const staticDirsToRestore = getRestorableStaticDirs(archPath);
    const filePlan = await prepareRestoreFilePlan(archPath, tmpDir, staticDirsToRestore);
    assertRestoreHasDiskSpace(filePlan);
    addLog(job, `文件目录预检通过: ${filePlan.staticDirs.length} 个 static 目录，${filePlan.uploadDirs.length} 个 uploads 目录`);

    if (sqlPath) {
      job.stage = "restoring_db";
      job.percent = 35;
      job.message = "正在校验备份数据库...";
      syncJob(job);

      const sanitizedSqlPath = join(tmpDir, "database.restore.sql");

      // Check if full dump by reading only first 100KB — avoid loading entire file into memory
      job.percent = 35;
      job.message = "正在校验备份数据库...";
      syncJob(job);
      const fd = openSync(sqlPath, "r");
      const headBuffer = Buffer.alloc(100 * 1024);
      const bytesRead = readSync(fd, headBuffer, 0, headBuffer.length, 0);
      closeSync(fd);
      const headBytes = headBuffer.toString("utf-8", 0, bytesRead);
      const isFullDump = headBytes.includes("CREATE TABLE");
      addLog(job, `数据库类型: ${isFullDump ? "完整备份 (full dump)" : "数据备份 (data-only)"}`);

      // Stream-sanitize SQL dump — avoid loading entire file into memory
      job.percent = 37;
      job.message = "正在预处理数据库...";
      addLog(job, "正在预处理 SQL 数据...");
      syncJob(job);
      await sanitizeSqlDumpStreaming(sqlPath, sanitizedSqlPath);

      // --- Safety snapshot: export current DB before any destructive operation ---
      job.percent = 39;
      job.message = "正在创建恢复前安全快照...";
      addLog(job, "正在导出当前数据库安全快照（恢复失败时自动回滚）...");
      syncJob(job);
      try {
        safetySnapshot = join(tmpDir, "safety_snapshot.sql");
        pgDumpToFile(DB_URL_CLEAN, safetySnapshot, ["--no-owner", "--no-privileges"], DB_DUMP_TIMEOUT_MS);
        // Verify the snapshot is not empty
        const snapSize = statSync(safetySnapshot).size;
        if (snapSize === 0) throw new Error("安全快照为空");
        addLog(job, `安全快照已创建 (${formatSize(snapSize)})，恢复失败将自动回滚`);
      } catch (snapErr: any) {
        // Safety snapshot is mandatory — abort restore to prevent data loss
        throw new Error(`无法创建恢复前安全快照，已中止恢复以保护数据安全: ${snapErr.message}`);
      }

      if (isFullDump) {
        // Full dump: reset schema then restore directly (includes schema + data)
        job.percent = 45;
        job.message = "正在重置数据库...";
        addLog(job, "正在重置数据库 schema...");
        syncJob(job);
        await resetDatabaseSchema(DB_URL_CLEAN);
        addLog(job, "数据库 schema 已重置");

        job.percent = 55;
        job.message = "正在恢复数据库...";
        addLog(job, "正在导入数据库...");
        syncJob(job);
        try {
          await restoreSqlIntoDatabase(DB_URL_CLEAN, sanitizedSqlPath, { disableTriggers: true });
        } catch (err) {
          if (!isForeignKeyRestoreError(err)) {
            addLog(job, `数据库导入失败，尝试回滚到安全快照...`);
            await rollbackToSafetySnapshot(safetySnapshot, job);
            throw err;
          }

          addLog(job, "检测到历史数据存在孤儿外键，改用跳过外键约束模式恢复以优先保留数据...");
          const noFkSqlPath = join(tmpDir, "database.restore.no-fk.sql");
          await sanitizeSqlDumpStreaming(sqlPath, noFkSqlPath, { skipForeignKeys: true });
          await resetDatabaseSchema(DB_URL_CLEAN);
          try {
            await restoreSqlIntoDatabase(DB_URL_CLEAN, noFkSqlPath, { disableTriggers: true });
            addLog(job, "数据库已恢复；部分历史外键约束因源数据不一致已跳过");
          } catch (fallbackErr) {
            addLog(job, `数据库兜底导入失败，尝试回滚到安全快照...`);
            await rollbackToSafetySnapshot(safetySnapshot, job);
            throw fallbackErr;
          }
        }
        addLog(job, "数据库导入完成");

        // Run prisma migrate after restore to apply any new migrations
        job.percent = 65;
        job.message = "正在检查数据库迁移...";
        addLog(job, "正在检查并应用数据库迁移...");
        syncJob(job);
        try {
          runPrismaMigrations(DB_URL_CLEAN);
          addLog(job, "数据库迁移完成");
        } catch (migrateErr) {
          const detail = extractCommandError(migrateErr);
          addLog(job, `迁移提示: ${detail}`);
          addLog(job, "迁移存在冲突，改用 schema 同步兜底...");
          try {
            runPrismaDbPush(DB_URL_CLEAN);
            addLog(job, "schema 同步完成");
          } catch (pushErr) {
            addLog(job, `schema 同步提示: ${extractCommandError(pushErr)}`);
            console.warn(`[Restore] Post-restore schema sync warning: ${extractCommandError(pushErr)}`);
          }
        }
      } else {
        // Data-only dump: need prisma migrate first, then handle circular FKs
        await preflightRestoreSql(sanitizedSqlPath);

        job.percent = 45;
        job.message = "正在重置数据库结构...";
        addLog(job, "正在重置数据库 schema (增量模式)...");
        syncJob(job);
        await resetDatabaseSchema(DB_URL_CLEAN);

        job.percent = 55;
        job.message = "正在应用数据库迁移...";
        addLog(job, "正在应用数据库迁移...");
        syncJob(job);
        runPrismaMigrations(DB_URL_CLEAN);
        addLog(job, "数据库迁移完成");

        // Drop circular FK constraints before data import
        job.percent = 60;
        job.message = "正在准备数据导入...";
        addLog(job, "正在处理循环外键约束...");
        syncJob(job);
        const { dropCircularFKs, restoreCircularFKs } = await import("./restore-helpers.js").catch(() => ({
          dropCircularFKs: async (_dbUrl: string) => {},
          restoreCircularFKs: async (_dbUrl: string) => {},
        }));
        await dropCircularFKs(DB_URL_CLEAN);

        job.percent = 65;
        job.message = "正在导入数据库数据...";
        addLog(job, "正在导入数据...");
        syncJob(job);
        try {
          await restoreSqlIntoDatabase(DB_URL_CLEAN, sanitizedSqlPath, { disableTriggers: true });
        } catch (err) {
          addLog(job, `数据导入失败，尝试回滚到安全快照...`);
          await restoreCircularFKs(DB_URL_CLEAN).catch(() => {});
          await rollbackToSafetySnapshot(safetySnapshot, job);
          throw err;
        }

        // Re-add circular FK constraints
        await restoreCircularFKs(DB_URL_CLEAN);
        addLog(job, "数据库导入完成，外键已恢复");
      }

      result.dbRestored = true;
      job.percent = 70;
      syncJob(job);
    } else {
      addLog(job, "备份中未包含数据库文件，跳过数据库恢复");
      job.percent = 70;
      syncJob(job);
    }

    job.stage = "restoring_files";
    job.percent = 75;
    job.message = "正在恢复备份文件目录...";
    syncJob(job);
    let restoredSourceFiles = 0;
    try {
      const fileResult = await commitRestoreFilePlan(filePlan, job);
      restoredSourceFiles = fileResult.restoredSourceFiles;
      result.thumbnailCount = fileResult.thumbnailCount;
    } catch (err: any) {
      if (result.dbRestored) {
        addLog(job, "文件恢复失败，正在回滚数据库到恢复前安全快照...");
        await rollbackToSafetySnapshot(safetySnapshot, job);
      }
      throw err;
    }

    if (result.dbRestored) {
      try {
        result.modelCount = await countStepModelsInDatabase();
      } catch {
        result.modelCount = restoredSourceFiles;
      }
    } else {
      result.modelCount = restoredSourceFiles;
    }

    addLog(job, `恢复完成: ${result.modelCount} 个 STEP 模型, ${result.thumbnailCount} 张缩略图`);

    // Clear all caches so the app uses restored data immediately
    try {
      const { cacheDelByPrefix } = await import("./cache.js");
      await cacheDelByPrefix("cache:");
      addLog(job, "缓存已清理");
    } catch {}
    try {
      const { clearSettingsCache } = await import("./settings.js");
      clearSettingsCache();
    } catch {}

    job.stage = "done";
    job.percent = 100;
    job.message = "恢复完成";
    job.result = result;
    syncJob(job);

    console.log(`[Restore #${job.id}] Done: ${result.modelCount} step models, ${result.thumbnailCount} thumbnails`);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
    addLog(job, `恢复失败: ${err.message}`);
    syncJob(job);
    console.error(`[Restore #${job.id}] Error:`, err.message);
  } finally {
    if (removeArchiveAfterExtract && existsSync(archPath)) rmSync(archPath, { force: true });
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- Download path ----

export function getBackupArchivePath(id: string): string | null {
  const p = archivePath(id);
  return existsSync(p) ? p : null;
}

// ---- Stats ----

export async function getBackupStats(): Promise<{
  modelCount: number;
  thumbnailCount: number;
  dbSize: string;
}> {
  const staticDir = join(process.cwd(), config.staticDir);
  const thumbnailCount = countFilesRecursive(join(staticDir, "thumbnails"), (name) => name.endsWith(".png"));
  let modelCount = 0;
  let dbSize = "unknown";

  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    modelCount = await prisma.model.count({ where: completedStepWhere });
    const r = await prisma.$queryRaw<Array<{ pg_size_pretty: string }>>`SELECT pg_size_pretty(pg_database_size(current_database())) as pg_size_pretty`;
    await prisma.$disconnect();
    if (r[0]?.pg_size_pretty) dbSize = r[0].pg_size_pretty;
  } catch {}

  return { modelCount, thumbnailCount, dbSize };
}

// ---- Helpers ----

async function inspectBackupArchive(id: string, archive: string, originalName: string): Promise<BackupRecord> {
  const fileSize = statSync(archive).size;
  if (fileSize <= 0) {
    throw new Error("备份文件为空");
  }

  const manifest = await validateBackupArchive(archive);
  const entries = listArchiveEntries(archive);
  if (entries.length === 0) {
    throw new Error("备份归档内容为空");
  }
  const hasDbFile = entries.includes("_backup_db/database.sql") || entries.includes("database.sql");
  if (!hasDbFile) {
    throw new Error("备份包缺少数据库文件");
  }

  const record: BackupRecord = {
    id,
    filename: `${id}.tar.gz`,
    name: `导入 ${originalName.replace(/\.tar\.gz$/, "").replace(/\.tgz$/, "")}`,
    createdAt: new Date().toISOString(),
    fileSize,
    fileSizeText: formatSize(fileSize),
    modelCount: 0,
    thumbnailCount: entries.filter((entry) => entry.startsWith("thumbnails/") && entry.endsWith(".png")).length,
    dbSize: "unknown",
    countMode: "step_models",
    manifestVersion: manifest?.schemaVersion,
    verifiedAt: manifest ? new Date().toISOString() : undefined,
  };

  const tmpDir = prepareWorkDir(`peek_${id}`);
  try {
    // Try both possible locations for meta.json
    const metaLocations = ["_backup_db/meta.json", "meta.json"];
    for (const loc of metaLocations) {
      try {
        execFileSync("tar", ["xzf", archive, "-C", tmpDir, loc], { stdio: "pipe", timeout: ARCHIVE_META_TIMEOUT_MS });
        const metaFile = join(tmpDir, loc);
        if (existsSync(metaFile)) {
          const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
          if (meta.timestamp) record.createdAt = meta.timestamp;
          break;
        }
      } catch { /* try next location */ }
    }
  } catch {
    // Metadata is optional for imports from older versions.
  }

  try {
    const sqlPath = extractRestoreSqlPath(archive, tmpDir);
    if (sqlPath) {
      record.modelCount = await countStepModelsInSqlDump(sqlPath);
    }
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }

  if (record.modelCount <= 0) {
    record.modelCount = entries.filter((entry) => entry.startsWith("originals/") && isArchiveStepEntry(entry)).length;
  }

  const originalsCount = entries.filter((entry) => entry.startsWith("originals/") && !entry.endsWith("/")).length;
  if (originalsCount > 0) {
    record.name += ` (${originalsCount} 原始文件)`;
  }

  return record;
}

function normalizeArchiveEntryList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\.\//, ""))
    .filter(Boolean)
    .filter((line) => !isIgnoredArchiveEntry(line));
}

function listArchiveEntries(archive: string): string[] {
  const raw = execFileSync("tar", ["tzf", archive], { stdio: "pipe", timeout: ARCHIVE_LIST_TIMEOUT_MS }).toString();
  return normalizeArchiveEntryList(raw);
}

function listArchiveEntriesWithProgress(
  archive: string,
  onProgress?: (info: { elapsedMs: number; entryCount: number }) => void,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const chunks: Buffer[] = [];
    let stderr = "";
    let entryCount = 0;
    let settled = false;
    const proc = spawn("tar", ["tzf", archive], { stdio: ["ignore", "pipe", "pipe"] });
    const heartbeat = setInterval(() => {
      onProgress?.({ elapsedMs: Date.now() - startedAt, entryCount });
    }, 5000);
    const timeout = setTimeout(() => {
      if (settled) return;
      proc.kill("SIGKILL");
      reject(new Error(`tar list timed out after ${Math.round(ARCHIVE_LIST_TIMEOUT_MS / 1000)}s`));
    }, ARCHIVE_LIST_TIMEOUT_MS);

    proc.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const text = chunk.toString("utf-8");
      entryCount += (text.match(/\n/g) || []).length;
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      onProgress?.({ elapsedMs: Date.now() - startedAt, entryCount });
      if (code === 0) {
        resolve(normalizeArchiveEntryList(Buffer.concat(chunks).toString("utf-8")));
      } else {
        reject(new Error(`tar list failed (code ${code ?? "unknown"}): ${stderr}`));
      }
    });
  });
}

async function createBackupManifest(
  backupId: string,
  databaseSqlPath: string,
  directoriesToCheck: readonly ArchiveDirectorySpec[],
): Promise<BackupManifest> {
  const directories: BackupManifestDirectory[] = directoriesToCheck.map((dir) => {
    const stats = countFilesAndBytesRecursive(dir.source);
    return { path: dir.path, fileCount: stats.fileCount, totalBytes: stats.totalBytes };
  });

  const requiredEntries = [BACKUP_DATABASE_ENTRY, BACKUP_META_ENTRY, BACKUP_MANIFEST_ENTRY, ...directoriesToCheck.map((dir) => dir.path)];

  return {
    schemaVersion: "3.0",
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

async function validateBackupArchive(
  archive: string,
  options: {
    expectedManifest?: BackupManifest;
    requireManifest?: boolean;
    onEntryProgress?: (info: { elapsedMs: number; entryCount: number }) => void;
  } = {},
): Promise<BackupManifest | null> {
  if (!existsSync(archive)) throw new Error("备份文件不存在");
  const archiveSize = statSync(archive).size;
  if (archiveSize <= 0) throw new Error("备份文件为空");

  const entries = await listArchiveEntriesWithProgress(archive, options.onEntryProgress);
  if (entries.length === 0) throw new Error("备份归档内容为空");
  if (!archiveHasEntry(entries, BACKUP_DATABASE_ENTRY) && !archiveHasEntry(entries, "database.sql")) {
    throw new Error("备份包缺少数据库文件");
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
  if (options.expectedManifest && archiveManifest && JSON.stringify(options.expectedManifest) !== JSON.stringify(archiveManifest)) {
    throw new Error("备份包清单内容与打包前清单不一致");
  }

  if (manifest.schemaVersion !== "3.0") {
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
    throw new Error("数据库备份 SHA256 校验失败");
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
    const raw = execFileSync("tar", ["xOzf", archive, BACKUP_MANIFEST_ENTRY], {
      stdio: "pipe",
      timeout: ARCHIVE_META_TIMEOUT_MS,
    }).toString("utf-8");
    return JSON.parse(raw) as BackupManifest;
  } catch (err) {
    if (isArchiveEntryMissing(err)) return null;
    throw new Error(`读取备份清单失败: ${extractCommandError(err)}`);
  }
}

async function inspectArchiveDatabase(archive: string, databaseEntry: string): Promise<{ size: number; sha256: string }> {
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
  const normalized = entry.replace(/\/$/, "");
  return entries.some((item) => item === normalized || item === `${normalized}/` || item.startsWith(`${normalized}/`));
}

function countArchiveFiles(entries: string[], dir: string): number {
  const prefix = `${dir.replace(/\/$/, "")}/`;
  return entries.filter((entry) => entry.startsWith(prefix) && !entry.endsWith("/")).length;
}

function writeJsonAtomic(path: string, value: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

async function sha256File(path: string): Promise<string> {
  return sha256FileWithProgress(path);
}

async function sha256FileWithProgress(path: string, onProgress?: (percent: number) => void): Promise<string> {
  const hash = createHash("sha256");
  const total = statSync(path).size;
  let processed = 0;
  let lastPercent = -1;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      if (!onProgress || total <= 0) return;
      processed += chunk.length;
      const percent = Math.min(100, Math.floor((processed / total) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  onProgress?.(100);
  return hash.digest("hex");
}

function countFilesAndBytesRecursive(dir: string): { fileCount: number; totalBytes: number } {
  if (!existsSync(dir)) return { fileCount: 0, totalBytes: 0 };

  let fileCount = 0;
  let totalBytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isIgnoredFileName(entry.name)) continue;
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

function isIgnoredArchiveEntry(entry: string): boolean {
  return entry
    .split("/")
    .filter(Boolean)
    .some((part) => isIgnoredFileName(part));
}

function isIgnoredFileName(name: string): boolean {
  return name === "__MACOSX" || name === ".DS_Store" || name.startsWith("._");
}

function isArchiveStepEntry(entry: string): boolean {
  const normalized = entry.trim().replace(/\/$/, "");
  const fileName = normalized.split("/").pop();
  return Boolean(fileName && isStepFileName(fileName));
}

function extractRestoreSqlPath(archive: string, tmpDir: string): string | null {
  const nestedEntry = "_backup_db/database.sql";
  if (extractArchiveEntry(archive, tmpDir, nestedEntry)) {
    return join(tmpDir, nestedEntry);
  }

  const directEntry = "database.sql";
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
  const rl = createInterface({ input: createReadStream(source, { encoding: "utf-8" }), crlfDelay: Infinity });
  const ws = createWriteStream(destination, { encoding: "utf-8" });
  let pendingAlterTableLine: string | null = null;

  const writeIfAllowed = (line: string) => {
    if (line !== "SET transaction_timeout = 0;") {
      ws.write(line + "\n");
    }
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
    ws.on("finish", resolve);
    ws.on("error", reject);
  });
}

function isForeignKeyRestoreError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return message.includes("violates foreign key constraint") || message.includes("FOREIGN KEY");
}

function databaseNameFromUrl(): string {
  const pathname = new URL(DB_URL_CLEAN).pathname.replace(/^\//, "");
  return pathname || "postgres";
}

function databaseUrlFor(name: string): string {
  const url = new URL(DB_URL_CLEAN);
  url.pathname = `/${name}`;
  return url.toString();
}

function maintenanceDatabaseUrl(): string {
  return databaseUrlFor("postgres");
}

function makePreflightDatabaseName(): string {
  const base = databaseNameFromUrl().replace(/[^a-zA-Z0-9_]/g, "_");
  return `${base}_restore_check_${Date.now()}`;
}

async function preflightRestoreSql(sqlPath: string) {
  const preflightDbName = makePreflightDatabaseName();
  const preflightDbUrl = databaseUrlFor(preflightDbName);
  const maintenanceUrl = maintenanceDatabaseUrl();

  try {
    psqlCommand(maintenanceUrl, `CREATE DATABASE "${preflightDbName}"`, ["-v", "ON_ERROR_STOP=1"], PSQL_COMMAND_TIMEOUT_MS);
    runPrismaMigrations(preflightDbUrl);
    await restoreSqlIntoDatabase(preflightDbUrl, sqlPath, { disableTriggers: true });
    console.log("[Backup] 备份数据库校验通过");
  } catch (err: any) {
    // Preflight failed — could be missing CREATEDB privilege or incompatible data.
    // Skip preflight and let the actual restore handle errors with recovery.
    console.warn(`[Backup] Preflight skipped (DB user may lack CREATEDB or data incompatible): ${extractCommandError(err)}`);
  } finally {
    try {
      psqlCommand(maintenanceUrl, `DROP DATABASE IF EXISTS "${preflightDbName}" WITH (FORCE)`, ["-v", "ON_ERROR_STOP=1"], PSQL_COMMAND_TIMEOUT_MS);
    } catch {}
  }
}

async function resetDatabaseSchema(dbUrl: string) {
  const args = ["-v", "ON_ERROR_STOP=1"];
  psqlCommand(dbUrl, "DROP SCHEMA public CASCADE", args, PSQL_COMMAND_TIMEOUT_MS);
  psqlCommand(dbUrl, "CREATE SCHEMA public", args, PSQL_COMMAND_TIMEOUT_MS);
  psqlCommand(dbUrl, "GRANT ALL ON SCHEMA public TO public", args, PSQL_COMMAND_TIMEOUT_MS);
}

function runPrismaMigrations(dbUrl: string) {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "pipe",
    timeout: PRISMA_MIGRATE_TIMEOUT_MS,
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
}

function runPrismaDbPush(dbUrl: string) {
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    stdio: "pipe",
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
    psqlFromFile(dbUrl, restorePath, ["-v", "ON_ERROR_STOP=1"], DB_RESTORE_TIMEOUT_MS);
  } finally {
    if (guardedPath) rmSync(guardedPath, { force: true });
  }
}

async function writeTriggerGuardedSql(source: string): Promise<string> {
  const destination = join(dirname(source), `${basename(source)}.trigger_guarded.sql`);
  const rl = createInterface({ input: createReadStream(source, { encoding: "utf-8" }), crlfDelay: Infinity });
  const ws = createWriteStream(destination, { encoding: "utf-8" });
  ws.write("SET session_replication_role = replica;\n");
  for await (const line of rl) {
    ws.write(line + "\n");
  }
  ws.write("\nSET session_replication_role = origin;\n");
  ws.end();
  await new Promise<void>((resolve, reject) => {
    ws.on("finish", resolve);
    ws.on("error", reject);
  });
  return destination;
}

async function recoverDatabaseToCleanSchema() {
  try {
    await resetDatabaseSchema(DB_URL_CLEAN);
    runPrismaMigrations(DB_URL_CLEAN);
  } catch {}
}

/** Rollback to the pre-restore safety snapshot. Falls back to clean schema if snapshot is unavailable. */
async function rollbackToSafetySnapshot(snapshotPath: string | null, job: { id?: string; logs?: string[] }): Promise<boolean> {
  if (snapshotPath && existsSync(snapshotPath)) {
    try {
      addLog(job, "正在回滚到恢复前的安全快照...");
      await resetDatabaseSchema(DB_URL_CLEAN);
      await restoreSqlIntoDatabase(DB_URL_CLEAN, snapshotPath, { disableTriggers: true });
      // Apply migrations in case the snapshot was from an older schema version
      try { runPrismaMigrations(DB_URL_CLEAN); } catch {}
      addLog(job, "已成功回滚到恢复前的数据库状态");
      return true;
    } catch (rollbackErr: any) {
      const preservedPath = preserveSafetySnapshot(snapshotPath, job);
      const preservedMessage = preservedPath ? `；安全快照已保留: ${preservedPath}` : "";
      addLog(job, `安全快照回滚失败: ${rollbackErr.message}${preservedMessage}，尝试恢复空 schema...`);
      console.error(`[Restore] Safety snapshot rollback failed: ${rollbackErr.message}`);
    }
  } else {
    addLog(job, "未找到可用安全快照，尝试恢复空 schema...");
  }
  // No snapshot or rollback failed — fall back to clean empty schema
  await recoverDatabaseToCleanSchema();
  return false;
}

function preserveSafetySnapshot(snapshotPath: string | null, job: { id?: string; logs?: string[] }): string | null {
  if (!snapshotPath || !existsSync(snapshotPath)) return null;
  try {
    mkdirSync(SAFETY_SNAPSHOT_DIR, { recursive: true });
    const safeJobId = (job.id || "restore").replace(/[^a-zA-Z0-9_-]/g, "_");
    const destination = join(SAFETY_SNAPSHOT_DIR, `${safeJobId}_${Date.now()}_safety_snapshot.sql`);
    copyFileSync(snapshotPath, destination);
    return destination;
  } catch (err: any) {
    addLog(job, `安全快照保留失败: ${err?.message || err}`);
    return null;
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

async function prepareRestoreFilePlan(
  archive: string,
  tmpDir: string,
  staticDirsToRestore: string[],
): Promise<RestoreFilePlan> {
  const staticDir = join(process.cwd(), config.staticDir);
  const uploadDir = join(process.cwd(), config.uploadDir);
  const entries = listArchiveEntries(archive);
  const plan: RestoreFilePlan = { archive, stagingRoot: join(tmpDir, "restore_files"), staticDirs: [], uploadDirs: [] };

  for (const dir of staticDirsToRestore) {
    if (!archiveHasEntry(entries, dir)) continue;
    plan.staticDirs.push({
      dir,
      destination: join(staticDir, dir),
      archiveEntry: dir,
    });
  }

  const uploadPrefix = `${BACKUP_UPLOADS_ENTRY}/`;
  const uploadNames = Array.from(new Set(entries
    .filter((entry) => entry.startsWith(uploadPrefix))
    .map((entry) => entry.slice(uploadPrefix.length).split("/")[0])
    .filter(Boolean)))
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
      name: ".metadata",
      destination: join(uploadDir, ".metadata"),
      archiveEntry: BACKUP_UPLOAD_METADATA_ENTRY,
    };
  }

  return plan;
}

function assertRestoreHasDiskSpace(plan: RestoreFilePlan) {
  const requiredDataBytes = estimateRestoreWorkingBytes(plan);
  if (requiredDataBytes <= 0) return;

  const statfsTarget = existsSync(plan.stagingRoot) ? plan.stagingRoot : dirname(plan.stagingRoot);
  const fsStats = statfsSync(statfsTarget);
  const availableBytes = Number(fsStats.bavail) * Number(fsStats.bsize);
  const safetyMargin = Math.max(512 * 1024 * 1024, Math.ceil(requiredDataBytes * 0.05));
  const requiredBytes = requiredDataBytes + safetyMargin;

  if (availableBytes < requiredBytes) {
    throw new Error(
      `恢复前磁盘空间不足，已中止以保护现有数据：需要约 ${formatSize(requiredBytes)} 可用空间，当前仅 ${formatSize(availableBytes)}。请释放空间或挂载更大的备份/静态文件磁盘后重试。`,
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

async function stageArchiveDirectory(plan: RestoreFilePlan, archiveEntry: string, index: number): Promise<{ root: string; stagedPath: string }> {
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

async function replaceArchiveDirectory(
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

  try {
    const totalSteps = plan.staticDirs.length + plan.uploadDirs.length + (plan.legacyMetadata ? 1 : 0);
    let step = 0;
    const updateFileProgress = (message: string) => {
      job.percent = Math.min(94, 75 + Math.round((step / Math.max(totalSteps, 1)) * 19));
      job.message = message;
      syncJob(job);
    };

    for (const item of plan.staticDirs) {
      updateFileProgress(restoreMessageForStaticDir(item.dir));
      addLog(job, `正在恢复 ${item.dir}/...`);
      replacements.push(await replaceArchiveDirectory(plan, item.archiveEntry, item.destination, step));

      if (item.dir === "thumbnails") {
        thumbnailCount = countFilesRecursive(item.destination, (name) => name.endsWith(".png"));
        addLog(job, `缩略图恢复完成: ${thumbnailCount} 张`);
      } else if (item.dir === "originals") {
        restoredSourceFiles = countFilesRecursive(item.destination, isStepFileName);
        addLog(job, `原始文件恢复完成: ${restoredSourceFiles} 个`);
      } else {
        const count = countFilesRecursive(item.destination);
        addLog(job, `${item.dir}/ 恢复完成${count > 0 ? ` (${count} 个文件)` : ""}`);
      }
      step += 1;
    }

    for (const item of plan.uploadDirs) {
      updateFileProgress(`正在恢复 uploads/${item.name}/...`);
      addLog(job, `正在恢复 uploads/${item.name}/...`);
      replacements.push(await replaceArchiveDirectory(plan, item.archiveEntry, item.destination, step));
      step += 1;
    }
    if (plan.uploadDirs.length > 0) {
      addLog(job, `uploads/ 恢复完成 (${plan.uploadDirs.length} 个目录)`);
    }

    if (plan.legacyMetadata) {
      updateFileProgress("正在恢复上传元数据...");
      replacements.push(await replaceArchiveDirectory(plan, plan.legacyMetadata.archiveEntry, plan.legacyMetadata.destination, step));
      const metadataCount = countFilesRecursive(plan.legacyMetadata.destination);
      addLog(job, `上传元数据恢复完成 (${metadataCount} 个文件)`);
    }

    cleanupDirectoryBackups(replacements);
    job.percent = 94;
    syncJob(job);
    return { restoredSourceFiles, thumbnailCount };
  } catch (err: any) {
    rollbackDirectoryReplacements(replacements, job);
    throw new Error(`文件目录恢复失败，已回滚已替换目录: ${err?.message || err}`);
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
  } catch (err: any) {
    if (err?.code !== "EXDEV") throw err;
    copyDirectoryRecursive(source, destination);
    rmSync(source, { recursive: true, force: true });
  }
}

function copyDirectoryRecursive(source: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const src = join(source, entry.name);
    const dest = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(src, dest);
    } else if (entry.isFile()) {
      copyFileSync(src, dest);
    }
  }
}

function rollbackDirectoryReplacements(replacements: DirectoryReplacement[], job: { logs?: string[] }) {
  for (const replacement of [...replacements].reverse()) {
    try {
      rmSync(replacement.destination, { recursive: true, force: true });
      if (replacement.backup && existsSync(replacement.backup)) {
        renameSync(replacement.backup, replacement.destination);
      }
    } catch (err: any) {
      addLog(job, `目录回滚失败 ${replacement.destination}: ${err?.message || err}`);
    }
  }
}

function cleanupDirectoryBackups(replacements: DirectoryReplacement[]) {
  for (const replacement of replacements) {
    if (replacement.backup) rmSync(replacement.backup, { recursive: true, force: true });
  }
}

async function restoreArchiveDirectory(
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

function extractArchiveEntryAsync(archive: string, destination: string, entry: string): Promise<boolean> {
  try {
    execFileSync("tar", ["xzf", archive, "-C", destination, entry], {
      stdio: "pipe",
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
    if (name.startsWith(".")) return false;
    if (name.startsWith("_")) return false;
    return true;
  });
}

function discoverUploadBackupDirs(uploadDir: string): string[] {
  return discoverTopLevelDirs(uploadDir, (name) => {
    if (UPLOAD_BACKUP_EXCLUDE_DIRS.has(name)) return false;
    if (name.startsWith(".") && name !== ".metadata") return false;
    if (name.startsWith("_")) return false;
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

function getRestorableStaticDirs(archive: string): string[] {
  const manifest = readArchiveManifest(archive);
  const dirs = manifest
    ? manifest.directories.map((dir) => dir.path)
    : Array.from(new Set(listArchiveEntries(archive).map((entry) => entry.split("/")[0]).filter(Boolean)));

  const staticDirs = dirs
    .filter((dir) => !dir.startsWith(`${BACKUP_DB_ENTRY_DIR}/`) && dir !== BACKUP_DB_ENTRY_DIR)
    .filter((dir) => !STATIC_BACKUP_EXCLUDE_DIRS.has(dir))
    .filter((dir) => !dir.startsWith(".") && !dir.startsWith("_"));

  const priority = RESTORE_PRIORITY_DIRS.filter((dir) => staticDirs.includes(dir));
  const rest = staticDirs.filter((dir) => !priority.includes(dir)).sort((a, b) => a.localeCompare(b));
  return [...priority, ...rest];
}

function restoreMessageForStaticDir(dir: string): string {
  if (dir === "models") return "正在恢复转换模型文件...";
  if (dir === "thumbnails") return "正在恢复缩略图...";
  if (dir === "originals") return "正在恢复 STEP 原始文件...";
  if (dir === "drawings") return "正在恢复产品图纸...";
  return `正在恢复 ${dir}/...`;
}

async function restoreUploadDirectoriesFromArchive(archive: string, staticDir: string): Promise<number> {
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
          try { renameSync(backup, destination); } catch {}
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

async function restoreLegacyUploadMetadataFromArchive(archive: string, staticDir: string): Promise<number> {
  if (!archiveContainsEntry(archive, BACKUP_UPLOAD_METADATA_ENTRY)) return 0;

  const uploadDir = join(process.cwd(), config.uploadDir);
  const metadataDest = join(uploadDir, ".metadata");
  const stagingMeta = join(staticDir, `.restore_metadata_${Date.now()}`);
  const extractedMeta = join(stagingMeta, "_backup_db", "metadata");
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
        try { renameSync(metadataBackup, metadataDest); } catch {}
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
  if (err instanceof Error && "stderr" in err) {
    const stderr = String((err as { stderr?: Buffer | string }).stderr || "").trim();
    if (stderr) return stderr.split(/\r?\n/).slice(-5).join(" | ");
  }
  return err instanceof Error ? err.message : "未知错误";
}

function extractArchiveEntry(archive: string, destination: string, entry: string): boolean {
  try {
    execFileSync("tar", ["xzf", archive, "-C", destination, entry], {
      stdio: "pipe",
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
  return msg.includes("not found in archive") || msg.includes("could not find");
}

function archiveContainsEntry(archive: string, entry: string): boolean {
  try {
    execFileSync("tar", ["tzf", archive, entry], {
      stdio: "pipe",
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
    renameSync(sourceArchive, targetArchive);
    if (existsSync(sourceMeta)) {
      renameSync(sourceMeta, targetMeta);
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
  if (record.countMode === "step_models") return record;
  // Keep backup listing lightweight. Deep inspection of large archives can block
  // the API process for seconds or minutes; users can run explicit verification
  // when they need to normalize or validate an older backup.
  void archive;
  void metaFile;
  return record;
}

function scheduleBackupRecordNormalization(record: BackupRecord, archive: string, metaFile: string) {
  if (pendingRecordNormalizations.has(record.id)) return;

  pendingRecordNormalizations.add(record.id);
  setImmediate(async () => {
    try {
      const refreshed = await inspectBackupArchive(record.id, archive, record.filename);
      refreshed.name = record.name;
      refreshed.dbSize = record.dbSize || refreshed.dbSize;
      writeFileSync(metaFile, JSON.stringify(refreshed, null, 2));
      console.log(`[Backup] Normalized legacy backup record: ${record.id}`);
    } catch (err: any) {
      console.warn(`[Backup] Failed to normalize backup record ${record.id}: ${err?.message || err}`);
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
      console.warn(`[BackupScheduler] ${err?.message || err}`);
    });
  }, 60_000);
  interval.unref?.();
  runBackupSchedulerTick().catch(() => {});
}

async function runBackupSchedulerTick() {
  const settings = await getBackupPolicySettings();
  if (!settings.backup_auto_enabled) return;
  if (!isScheduleDue(settings.backup_schedule_time)) return;
  if (settings.backup_last_auto_date === localDateKey()) return;

  try {
    const jobId = startScheduledBackupJob();
    await updateBackupPolicySettings({
      backup_last_auto_status: "running",
      backup_last_auto_message: "自动备份正在执行",
      backup_last_auto_job_id: jobId,
      backup_last_auto_at: new Date().toISOString(),
    });
    console.log(`[BackupScheduler] Started scheduled backup: ${jobId}`);
  } catch (err: any) {
    await updateBackupPolicySettings({
      backup_last_auto_status: "skipped",
      backup_last_auto_message: err?.message || "自动备份跳过",
      backup_last_auto_at: new Date().toISOString(),
    });
    console.warn(`[BackupScheduler] Skipped: ${err?.message || err}`);
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
    const message = "镜像备份目录无效，请配置一个绝对路径，且不能指向当前备份目录";
    addLog(job, message);
    await updateBackupPolicySettings({
      backup_last_mirror_status: "error",
      backup_last_mirror_message: message,
      backup_last_mirror_at: new Date().toISOString(),
    });
    return;
  }

  try {
    mkdirSync(mirrorDir, { recursive: true });
    const sourceArchive = activeArchivePath(record.id);
    const sourceMeta = activeMetaPath(record.id);
    const targetArchive = join(mirrorDir, `${record.id}.tar.gz`);
    const targetMeta = join(mirrorDir, `${record.id}.json`);
    const tmpArchive = `${targetArchive}.tmp`;
    const tmpMeta = `${targetMeta}.tmp`;

    addLog(job, `正在复制备份到外部镜像目录: ${mirrorDir}`);
    copyFileSync(sourceArchive, tmpArchive);
    if (record.archiveSha256) {
      const copiedSha = await sha256File(tmpArchive);
      if (copiedSha !== record.archiveSha256) {
        throw new Error("镜像备份 SHA256 校验失败");
      }
    }
    await validateBackupArchive(tmpArchive, { requireManifest: true });
    renameSync(tmpArchive, targetArchive);

    copyFileSync(sourceMeta, tmpMeta);
    renameSync(tmpMeta, targetMeta);

    const message = `镜像备份完成: ${mirrorDir}`;
    addLog(job, message);
    await updateBackupPolicySettings({
      backup_last_mirror_status: "success",
      backup_last_mirror_message: message,
      backup_last_mirror_at: new Date().toISOString(),
    });
  } catch (err: any) {
    const message = `镜像备份失败: ${err?.message || err}`;
    addLog(job, message);
    await updateBackupPolicySettings({
      backup_last_mirror_status: "error",
      backup_last_mirror_message: message,
      backup_last_mirror_at: new Date().toISOString(),
    });
  }
}

function resolveMirrorBackupDir(value: string): string | null {
  const raw = value.trim();
  if (!raw || !isAbsolute(raw)) return null;
  const target = resolve(raw);
  const forbidden = [resolve(ACTIVE_BACKUP_DIR), resolve(LEGACY_BACKUP_DIR), resolve(BACKUP_WORK_DIR)];
  if (forbidden.some((dir) => target === dir || target.startsWith(`${dir}${sep}`))) return null;
  return target;
}

function cleanupMirrorBackups(mirrorDir: string, keep: number, job: { logs?: string[] }) {
  try {
    if (!existsSync(mirrorDir)) return;
    const records = readdirSync(mirrorDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        try {
          const record = JSON.parse(readFileSync(join(mirrorDir, file), "utf-8")) as BackupRecord;
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
  } catch (err: any) {
    addLog(job, `外部镜像保留策略清理失败: ${err?.message || err}`);
  }
}

function buildBackupHealthMessage(base: string, settings: BackupPolicySettings): string {
  if (!settings.backup_mirror_enabled) return base;
  if (!settings.backup_mirror_dir) return `${base}；外部镜像已开启但未配置目录`;
  if (settings.backup_last_mirror_status === "error") return `${base}；${settings.backup_last_mirror_message || "外部镜像最近失败"}`;
  if (settings.backup_last_mirror_status === "success") return `${base}；外部镜像正常`;
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
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    return { key: `write:${dir}`, label, status: "ok", message: `${dir} 可写` };
  } catch (err: any) {
    return { key: `write:${dir}`, label, status: "error", message: `${dir} 不可写: ${err?.message || err}` };
  }
}

function checkDiskSpace(dir: string, requiredBytes: number, label: string): BackupPolicyCheckItem {
  try {
    mkdirSync(dir, { recursive: true });
    const availableBytes = getAvailableBytes(dir);
    if (availableBytes === null) {
      return { key: `space:${dir}`, label, status: "warning", message: `无法读取 ${dir} 的剩余空间` };
    }
    const status = availableBytes >= requiredBytes ? "ok" : "error";
    return {
      key: `space:${dir}`,
      label,
      status,
      message: `${dir} 可用 ${formatSize(availableBytes)}，预计至少需要 ${formatSize(requiredBytes)}`,
    };
  } catch (err: any) {
    return { key: `space:${dir}`, label, status: "error", message: `检查磁盘空间失败: ${err?.message || err}` };
  }
}

function getAvailableBytes(dir: string): number | null {
  try {
    const raw = execFileSync("df", ["-Pk", dir], { encoding: "utf-8", timeout: 10_000 });
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
  const { getAllSettings } = await import("./settings.js");
  const settings = await getAllSettings();
  return {
    backup_auto_enabled: Boolean(settings.backup_auto_enabled),
    backup_schedule_time: normalizeScheduleTime(settings.backup_schedule_time),
    backup_retention_count: clampRetentionCount(settings.backup_retention_count),
    backup_mirror_enabled: Boolean(settings.backup_mirror_enabled),
    backup_mirror_dir: typeof settings.backup_mirror_dir === "string" ? settings.backup_mirror_dir.trim() : "",
    backup_last_mirror_status: typeof settings.backup_last_mirror_status === "string" ? settings.backup_last_mirror_status : "",
    backup_last_mirror_message: typeof settings.backup_last_mirror_message === "string" ? settings.backup_last_mirror_message : "",
    backup_last_mirror_at: typeof settings.backup_last_mirror_at === "string" ? settings.backup_last_mirror_at : "",
    backup_last_auto_date: typeof settings.backup_last_auto_date === "string" ? settings.backup_last_auto_date : "",
    backup_last_auto_status: typeof settings.backup_last_auto_status === "string" ? settings.backup_last_auto_status : "",
    backup_last_auto_message: typeof settings.backup_last_auto_message === "string" ? settings.backup_last_auto_message : "",
    backup_last_auto_job_id: typeof settings.backup_last_auto_job_id === "string" ? settings.backup_last_auto_job_id : "",
    backup_last_auto_at: typeof settings.backup_last_auto_at === "string" ? settings.backup_last_auto_at : "",
  };
}

async function updateBackupPolicySettings(settings: Partial<BackupPolicySettings>) {
  const { setSettings } = await import("./settings.js");
  await setSettings(settings as Record<string, unknown>);
}

function normalizeScheduleTime(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return "03:00";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function clampRetentionCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(60, Math.max(1, Math.floor(parsed)));
}

function isScheduleDue(scheduleTime: string): boolean {
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return current === scheduleTime;
}

function localDateKey(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nextScheduledRunIso(scheduleTime: string): string {
  const [hourRaw, minuteRaw] = normalizeScheduleTime(scheduleTime).split(":");
  const next = new Date();
  next.setHours(Number(hourRaw), Number(minuteRaw), 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function cleanupPartialArchives(dir: string) {
  try {
    const partials = readdirSync(dir).filter((file) => file.endsWith(".tar.gz.tmp"));
    for (const file of partials) {
      rmSync(join(dir, file), { force: true });
      console.warn(`[Backup] Removed orphan partial archive: ${join(dir, file)}`);
    }
  } catch (err: any) {
    console.warn(`[Backup] Failed to clean partial archives in ${dir}: ${err?.message || err}`);
  }
}

const completedStepWhere = {
  status: "completed",
  OR: [
    { format: { equals: "step", mode: "insensitive" as const } },
    { format: { equals: "stp", mode: "insensitive" as const } },
    { format: { equals: "iges", mode: "insensitive" as const } },
    { format: { equals: "igs", mode: "insensitive" as const } },
    { format: { equals: "xt", mode: "insensitive" as const } },
    { format: { equals: "x_t", mode: "insensitive" as const } },
  ],
};

async function countStepModelsInDatabase(): Promise<number> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    return await prisma.model.count({ where: completedStepWhere });
  } finally {
    await prisma.$disconnect();
  }
}

async function countStepModelsInSqlDump(sqlPath: string): Promise<number> {
  return new Promise((resolve) => {
    let count = 0;
    const input = createReadStream(sqlPath, { encoding: "utf-8" });
    const rl = createInterface({ input, crlfDelay: Infinity });

    let inModelsCopy = false;
    let formatIndex = -1;
    let statusIndex = -1;

    rl.on("line", (line: string) => {
      if (!inModelsCopy) {
        const match = line.match(/^COPY\s+(?:public\.)?"?models"?\s+\((.+)\)\s+FROM\s+stdin;$/i);
        if (!match) return;

        const columns = match[1]
          .split(",")
          .map((value) => value.trim().replace(/^"|"$/g, ""));
        formatIndex = columns.findIndex((column) => column === "format");
        statusIndex = columns.findIndex((column) => column === "status");
        if (formatIndex === -1 || statusIndex === -1) { rl.close(); return; }
        inModelsCopy = true;
        return;
      }

      if (line === "\\.") { rl.close(); return; }
      if (!line) return;

      const fields = line.split("\t");
      const format = (fields[formatIndex] || "").toLowerCase();
      const status = (fields[statusIndex] || "").toLowerCase();
      if (status === "completed" && STEP_EXTENSIONS.has(`.${format}`)) {
        count += 1;
      }
    });

    rl.on("close", () => resolve(count));
    input.on("error", () => resolve(0));
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}
