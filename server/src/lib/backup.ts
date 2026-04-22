import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, readdirSync, readFileSync, renameSync } from "fs";
import { join } from "path";
import { config } from "./config.js";
import { syncJob, loadJob } from "./jobStore.js";

const DB_URL = config.databaseUrl;
// Strip Prisma-specific query params that pg_dump/psql don't understand
const DB_URL_CLEAN = DB_URL.replace(/\?.*/, "");
const ACTIVE_BACKUP_DIR = join(process.cwd(), config.uploadDir, "backups");
const LEGACY_BACKUP_DIR = join(process.cwd(), config.staticDir, "backups");
const BACKUP_DIRS = Array.from(new Set([ACTIVE_BACKUP_DIR, LEGACY_BACKUP_DIR]));
const BACKUP_WORK_DIR = join(ACTIVE_BACKUP_DIR, ".work");

// Detect whether pg_dump/psql are available locally, otherwise use docker exec
let _dockerContainer: string | null = undefined as any;
function getDockerContainer(): string | null {
  if (_dockerContainer !== undefined as any) return _dockerContainer;
  try {
    execSync("which pg_dump", { stdio: "pipe", timeout: 5000 });
    _dockerContainer = null;
    return null;
  } catch {
    // pg_dump not found locally — try docker
    try {
      const containers = execSync("docker ps --format '{{.Names}}'", { stdio: "pipe", timeout: 5000 }).toString().trim().split("\n");
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

/** Run a pg command (pg_dump or psql) — works with local install or Docker container */
function execPgCommand(command: string, options?: { input?: string; timeout?: number }) {
  const container = getDockerContainer();
  const timeout = options?.timeout || PSQL_COMMAND_TIMEOUT_MS;
  if (container) {
    if (options?.input) {
      // Pass input via stdin — echo ... | docker exec -i container psql ...
      execSync(`echo '${options.input.replace(/'/g, "'\\''")}' | docker exec -i ${container} ${command}`, {
        stdio: "pipe",
        timeout,
      });
    } else {
      execSync(`docker exec ${container} ${command}`, { stdio: "pipe", timeout });
    }
  } else {
    if (options?.input) {
      execSync(command, { stdio: ["pipe", "pipe", "pipe"], input: options.input, timeout });
    } else {
      execSync(command, { stdio: "pipe", timeout });
    }
  }
}

/** pg_dump to file — works with local install or Docker container */
function pgDumpToFile(dbUrl: string, outputPath: string, extraArgs: string, timeout: number) {
  const container = getDockerContainer();
  if (container) {
    // Docker: use local connection (no host:port) inside the container
    const dbName = new URL(dbUrl).pathname.replace(/^\//, "");
    const user = new URL(dbUrl).username;
    execSync(`docker exec ${container} pg_dump -U ${user} -d ${dbName} ${extraArgs} > "${outputPath}"`, {
      stdio: "pipe",
      timeout,
    });
  } else {
    execSync(`pg_dump "${dbUrl}" ${extraArgs} > "${outputPath}"`, {
      stdio: "pipe",
      timeout,
    });
  }
}

/** psql with -f flag — works with local install or Docker container */
function psqlFromFile(dbUrl: string, sqlPath: string, extraArgs: string, timeout: number) {
  const container = getDockerContainer();
  if (container) {
    // Copy SQL file into container, run psql, clean up
    const containerPath = `/tmp/restore_${Date.now()}.sql`;
    const dbName = new URL(dbUrl).pathname.replace(/^\//, "");
    const user = new URL(dbUrl).username;
    execSync(`docker cp "${sqlPath}" ${container}:${containerPath}`, { stdio: "pipe", timeout: 30000 });
    try {
      execSync(`docker exec ${container} psql -U ${user} -d ${dbName} ${extraArgs} -f "${containerPath}"`, {
        stdio: "pipe",
        timeout,
      });
    } finally {
      try { execSync(`docker exec ${container} rm -f "${containerPath}"`, { stdio: "pipe" }); } catch {}
    }
  } else {
    execSync(`psql "${dbUrl}" ${extraArgs} -f "${sqlPath}"`, { stdio: "pipe", timeout });
  }
}

/** psql with -c flag — works with local install or Docker container */
function psqlCommand(dbUrl: string, sql: string, extraArgs: string, timeout: number) {
  const container = getDockerContainer();
  if (container) {
    const dbName = new URL(dbUrl).pathname.replace(/^\//, "");
    const user = new URL(dbUrl).username;
    execSync(`docker exec ${container} psql -U ${user} -d ${dbName} ${extraArgs} -c "${sql.replace(/"/g, '\\"')}"`, {
      stdio: "pipe",
      timeout,
    });
  } else {
    execSync(`psql "${dbUrl}" ${extraArgs} -c "${sql.replace(/"/g, '\\"')}"`, {
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
const pendingRecordNormalizations = new Set<string>();

function ts(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function addLog(job: BackupJob | RestoreJob, text: string) {
  job.logs.push(`[${ts()}] ${text}`);
  console.log(`[Backup] ${text}`);
  syncJob(job);
}

export function getJob(id: string): BackupJob | undefined {
  return jobs.get(id) || loadJob<BackupJob>(id);
}

export function getRestoreJob(id: string): RestoreJob | undefined {
  return restoreJobs.get(id) || loadJob<RestoreJob>(id);
}

// ---- Import as backup record (save to backup list) ----

export function saveAsBackupRecord(archPath: string, originalName: string): BackupRecord {
  const id = `backup_${Date.now()}`;
  const dest = activeArchivePath(id);

  try {
    execSync(`cp "${archPath}" "${dest}"`, { stdio: "pipe" });
    if (existsSync(archPath)) rmSync(archPath, { force: true });

    const record = inspectBackupArchive(id, dest, originalName);
    writeFileSync(activeMetaPath(id), JSON.stringify(record, null, 2));
    return record;
  } catch (err) {
    if (existsSync(dest)) rmSync(dest, { force: true });
    if (existsSync(activeMetaPath(id))) rmSync(activeMetaPath(id), { force: true });
    throw err;
  }
}

// ---- Create backup ----

export function startBackupJob(): string {
  const id = `backup_${Date.now()}`;
  const job: BackupJob = { id, stage: "dumping", percent: 0, message: "正在导出数据库...", logs: [] };
  jobs.set(id, job);
  syncJob(job);

  // Use setImmediate to ensure HTTP response is sent before blocking work
  setImmediate(() => {
    runBackup(job).catch((err) => {
      job.stage = "error";
      job.error = err.message;
      // Clean up partial archive
      if (existsSync(activeArchivePath(id))) rmSync(activeArchivePath(id), { force: true });
      if (existsSync(activeMetaPath(id))) rmSync(activeMetaPath(id), { force: true });
      syncJob(job);
      console.error(`[Backup #${job.id}] Error:`, err.message);
    });
  });

  return id;
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

    pgDumpToFile(DB_URL_CLEAN, join(tmpDir, "database.sql"), "--data-only --no-owner --no-privileges", DB_DUMP_TIMEOUT_MS);

    if (!existsSync(join(tmpDir, "database.sql"))) {
      throw new Error("数据库导出失败：文件未生成");
    }
    const dbSize = statSync(join(tmpDir, "database.sql")).size;
    addLog(job, `数据库导出完成，大小: ${formatSize(dbSize)}`);
    job.percent = 30;
    syncJob(job);

    // Write metadata into tmp
    writeFileSync(join(tmpDir, "meta.json"), JSON.stringify({
      timestamp: new Date().toISOString(),
      version: "1.0",
    }, null, 2));

    // Step 2: tar.gz packing (30-95%)
    job.stage = "packing";
    job.percent = 35;
    job.message = "正在打包模型文件...";
    addLog(job, "正在打包模型、预览图和原始文件...");

    const staticDir = join(process.cwd(), config.staticDir);
    const hasModels = existsSync(join(staticDir, "models"));
    const hasThumbs = existsSync(join(staticDir, "thumbnails"));
    const hasOriginals = existsSync(join(staticDir, "originals"));
    const hasDrawings = existsSync(join(staticDir, "drawings"));

    // Copy db files into static/_backup_db so tar uses a single -C
    const dbMarker = join(staticDir, "_backup_db");
    // Clean up any residual _backup_db from previous crashed backup
    if (existsSync(dbMarker)) rmSync(dbMarker, { recursive: true, force: true });
    mkdirSync(dbMarker, { recursive: true });
    execSync(`cp "${join(tmpDir, "database.sql")}" "${join(dbMarker, "database.sql")}"`, { stdio: "pipe" });
    execSync(`cp "${join(tmpDir, "meta.json")}" "${join(dbMarker, "meta.json")}"`, { stdio: "pipe" });

    await new Promise<void>((resolve, reject) => {
      const tmpArchive = `${finalArchive}.tmp`;
      const args: string[] = ["czf", tmpArchive, "-C", staticDir];
      args.push(
        "--exclude=__MACOSX",
        "--exclude=*/__MACOSX",
        "--exclude=.DS_Store",
        "--exclude=*/.DS_Store",
        "--exclude=._*",
        "--exclude=*/._*",
      );
      args.push("_backup_db/database.sql", "_backup_db/meta.json");
      if (hasModels) args.push("models");
      if (hasThumbs) args.push("thumbnails");
      if (hasOriginals) args.push("originals");
      if (hasDrawings) args.push("drawings");

      const proc = spawn("tar", args, { timeout: ARCHIVE_EXTRACT_TIMEOUT_MS });
      let stderr = "";

      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("error", (err) => {
        rmSync(dbMarker, { recursive: true, force: true });
        reject(err);
      });
      proc.on("close", (code) => {
        clearInterval(progressInterval);
        rmSync(dbMarker, { recursive: true, force: true });
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
          syncJob(job);
        }
      }, 3000);
    });

    // Step 3: Save metadata (95-100%)
    job.stage = "saving";
    job.percent = 96;
    job.message = "正在保存备份记录...";
    syncJob(job);
    addLog(job, `打包完成，文件大小: ${formatSize(statSync(finalArchive).size)}`);
    addLog(job, "正在保存备份记录...");

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
    };
    writeFileSync(activeMetaPath(job.id), JSON.stringify(record, null, 2));

    job.stage = "done";
    job.percent = 100;
    job.message = "备份完成";
    addLog(job, `备份完成！共 ${record.modelCount} 个 STEP 模型，${record.thumbnailCount} 张预览图`);

    console.log(`[Backup #${job.id}] Done: ${formatSize(fileSize)}`);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
    syncJob(job);
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
  const jobId = `restore_${Date.now()}`;
  const job: RestoreJob = { id: jobId, stage: "extracting", percent: 0, message: "正在解压备份文件...", logs: [] };
  restoreJobs.set(jobId, job);
  syncJob(job);

  // Use setImmediate to ensure HTTP response is sent before blocking work
  setImmediate(() => {
    runRestore(job, backupId).catch((err) => {
      job.stage = "error";
      job.error = err.message;
      addLog(job, `恢复失败: ${err.message}`);
      console.error(`[Restore #${jobId}] Error:`, err.message);
    });
  });

  return jobId;
}

async function runRestore(job: RestoreJob, backupId: string) {
  ensureBackupStoredInActiveDir(backupId);
  const arch = archivePath(backupId);
  if (!existsSync(arch)) throw new Error("备份文件不存在");
  await runRestoreFromArchive(job, arch, false);
}

// ---- Restore from uploaded file (import) ----

export function startRestoreJobFromFile(archPath: string): string {
  const jobId = `restore_${Date.now()}`;
  const job: RestoreJob = { id: jobId, stage: "extracting", percent: 0, message: "正在上传完成，开始解压...", logs: [] };
  restoreJobs.set(jobId, job);
  syncJob(job);

  // Use setImmediate to ensure HTTP response is sent before blocking work
  setImmediate(() => {
    runRestoreFromFile(job, archPath).catch((err) => {
      job.stage = "error";
      job.error = err.message;
      addLog(job, `恢复失败: ${err.message}`);
      console.error(`[Restore #${jobId}] Error:`, err.message);
    });
  });

  return jobId;
}

async function runRestoreFromFile(job: RestoreJob, archPath: string) {
  await runRestoreFromArchive(job, archPath, true);
}

async function runRestoreFromArchive(job: RestoreJob, archPath: string, removeArchiveAfterExtract: boolean) {
  const tmpDir = prepareWorkDir(job.id);
  const result = { dbRestored: false, modelCount: 0, thumbnailCount: 0 };

  try {
    job.stage = "extracting";
    job.percent = 5;
    job.message = "正在读取备份数据库...";
    syncJob(job);

    const sqlPath = extractRestoreSqlPath(archPath, tmpDir);
    job.percent = 30;
    syncJob(job);

    if (sqlPath) {
      job.stage = "restoring_db";
      job.percent = 35;
      job.message = "正在校验备份数据库兼容性...";
      syncJob(job);

      const sanitizedSqlPath = join(tmpDir, "database.restore.sql");
      await sanitizeSqlDump(sqlPath, sanitizedSqlPath);
      await preflightRestoreSql(sanitizedSqlPath);

      job.percent = 45;
      job.message = "正在重置数据库结构...";
      syncJob(job);
      await resetDatabaseSchema(DB_URL_CLEAN);

      job.percent = 55;
      job.message = "正在应用数据库迁移...";
      syncJob(job);
      runPrismaMigrations(DB_URL_CLEAN);

      job.percent = 65;
      job.message = "正在导入数据库数据...";
      syncJob(job);
      try {
        restoreSqlIntoDatabase(DB_URL_CLEAN, sanitizedSqlPath);
      } catch (err) {
        await recoverDatabaseToCleanSchema();
        throw err;
      }

      result.dbRestored = true;
      job.percent = 70;
      syncJob(job);
    } else {
      job.percent = 70;
      syncJob(job);
    }

    const staticDir = join(process.cwd(), config.staticDir);

    job.stage = "restoring_files";
    job.percent = 75;
    job.message = "正在恢复转换模型文件...";
    syncJob(job);
    restoreArchiveDirectory(archPath, staticDir, "models");

    job.percent = 88;
    job.message = "正在恢复缩略图...";
    syncJob(job);
    result.thumbnailCount = restoreArchiveDirectory(archPath, staticDir, "thumbnails", (name) => name.endsWith(".png"));

    job.percent = 92;
    job.message = "正在恢复 STEP 原始文件...";
    syncJob(job);
    const restoredSourceFiles = restoreArchiveDirectory(archPath, staticDir, "originals", isStepFileName);

    job.percent = 94;
    job.message = "正在恢复产品图纸...";
    syncJob(job);
    restoreArchiveDirectory(archPath, staticDir, "drawings");

    if (result.dbRestored) {
      try {
        result.modelCount = await countStepModelsInDatabase();
      } catch {
        result.modelCount = restoredSourceFiles;
      }
    } else {
      result.modelCount = restoredSourceFiles;
    }

    job.stage = "done";
    job.percent = 100;
    job.message = "恢复完成";
    job.result = result;
    syncJob(job);

    console.log(`[Restore #${job.id}] Done: ${result.modelCount} step models, ${result.thumbnailCount} thumbnails`);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
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

function inspectBackupArchive(id: string, archive: string, originalName: string): BackupRecord {
  const fileSize = statSync(archive).size;
  if (fileSize <= 0) {
    throw new Error("备份文件为空");
  }

  const entries = listArchiveEntries(archive);
  if (entries.length === 0) {
    throw new Error("备份归档内容为空");
  }
  if (!entries.includes("_backup_db/database.sql")) {
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
  };

  const tmpDir = prepareWorkDir(`peek_${id}`);
  try {
    execSync(`tar xzf "${archive}" -C "${tmpDir}" _backup_db/meta.json`, { stdio: "pipe", timeout: ARCHIVE_META_TIMEOUT_MS });
    const metaFile = join(tmpDir, "_backup_db", "meta.json");
    if (existsSync(metaFile)) {
      const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
      if (meta.timestamp) record.createdAt = meta.timestamp;
    }
  } catch {
    // Metadata is optional for imports from older versions.
  }

  try {
    const sqlPath = extractRestoreSqlPath(archive, tmpDir);
    if (sqlPath) {
      record.modelCount = countStepModelsInSqlDump(sqlPath);
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

function listArchiveEntries(archive: string): string[] {
  const raw = execSync(`tar tzf "${archive}"`, { stdio: "pipe", timeout: ARCHIVE_LIST_TIMEOUT_MS }).toString();
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\.\//, ""))
    .filter(Boolean)
    .filter((line) => !isIgnoredArchiveEntry(line));
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

async function sanitizeSqlDump(source: string, destination: string) {
  const sanitized = readFileSync(source, "utf-8")
    .split(/\r?\n/)
    .filter((line) => (
      !line.startsWith("\\restrict") &&
      !line.startsWith("\\unrestrict") &&
      line !== "SET transaction_timeout = 0;"
    ))
    .join("\n");

  writeFileSync(destination, `${sanitized}\n`);
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
    psqlCommand(maintenanceUrl, `CREATE DATABASE "${preflightDbName}"`, "-v ON_ERROR_STOP=1", PSQL_COMMAND_TIMEOUT_MS);
    runPrismaMigrations(preflightDbUrl);
    restoreSqlIntoDatabase(preflightDbUrl, sqlPath);
    addLog({ logs: [] } as any, "备份数据库校验通过");
  } catch (err: any) {
    // Preflight failed — could be missing CREATEDB privilege or incompatible data.
    // Skip preflight and let the actual restore handle errors with recovery.
    console.warn(`[Backup] Preflight skipped (DB user may lack CREATEDB or data incompatible): ${extractCommandError(err)}`);
  } finally {
    try {
      psqlCommand(maintenanceUrl, `DROP DATABASE IF EXISTS "${preflightDbName}" WITH (FORCE)`, "-v ON_ERROR_STOP=1", PSQL_COMMAND_TIMEOUT_MS);
    } catch {}
  }
}

async function resetDatabaseSchema(dbUrl: string) {
  const container = getDockerContainer();
  const dbName = new URL(dbUrl).pathname.replace(/^\//, "");
  const user = new URL(dbUrl).username;
  const cmds = "-c 'DROP SCHEMA public CASCADE' -c 'CREATE SCHEMA public' -c 'GRANT ALL ON SCHEMA public TO public'";
  if (container) {
    execSync(`docker exec ${container} psql -U ${user} -d ${dbName} -v ON_ERROR_STOP=1 ${cmds}`, {
      stdio: "pipe", timeout: PSQL_COMMAND_TIMEOUT_MS,
    });
  } else {
    execSync(`psql "${dbUrl}" -v ON_ERROR_STOP=1 ${cmds}`, {
      stdio: "pipe", timeout: PSQL_COMMAND_TIMEOUT_MS,
    });
  }
}

function runPrismaMigrations(dbUrl: string) {
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    timeout: PRISMA_MIGRATE_TIMEOUT_MS,
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
}

function restoreSqlIntoDatabase(dbUrl: string, sqlPath: string) {
  psqlFromFile(dbUrl, sqlPath, "-v ON_ERROR_STOP=0", DB_RESTORE_TIMEOUT_MS);
}

async function recoverDatabaseToCleanSchema() {
  try {
    await resetDatabaseSchema(DB_URL_CLEAN);
    runPrismaMigrations(DB_URL_CLEAN);
  } catch {}
}

function restoreArchiveDirectory(
  archive: string,
  staticDir: string,
  folder: string,
  predicate?: (name: string) => boolean,
): number {
  const destination = join(staticDir, folder);
  const stagingRoot = join(staticDir, `.restore_${folder}_${Date.now()}`);
  const stagedFolder = join(stagingRoot, folder);

  if (!archiveContainsEntry(archive, folder)) return 0;

  rmSync(destination, { recursive: true, force: true });
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  try {
    extractArchiveEntry(archive, stagingRoot, folder);
    if (!existsSync(stagedFolder)) return 0;

    pruneIgnoredFiles(stagedFolder);
    renameSync(stagedFolder, destination);
    return predicate ? countFilesRecursive(destination, predicate) : 0;
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
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

function countFilesRecursive(dir: string, predicate: (name: string) => boolean): number {
  if (!existsSync(dir)) return 0;

  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isIgnoredFileName(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countFilesRecursive(fullPath, predicate);
      continue;
    }
    if (predicate(entry.name)) total++;
  }
  return total;
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
    execSync(`tar xzf "${archive}" -C "${destination}" "${entry}"`, {
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
  return extractCommandError(err).includes("Not found in archive");
}

function archiveContainsEntry(archive: string, entry: string): boolean {
  try {
    execSync(`tar tzf "${archive}" "${entry}"`, {
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
    execSync(`mv "${sourceArchive}" "${targetArchive}"`, {
      stdio: "pipe",
      timeout: ARCHIVE_EXTRACT_TIMEOUT_MS,
    });
    if (existsSync(sourceMeta)) {
      execSync(`mv "${sourceMeta}" "${targetMeta}"`, {
        stdio: "pipe",
        timeout: PSQL_COMMAND_TIMEOUT_MS,
      });
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

  scheduleBackupRecordNormalization(record, archive, metaFile);
  return record;
}

function scheduleBackupRecordNormalization(record: BackupRecord, archive: string, metaFile: string) {
  if (pendingRecordNormalizations.has(record.id)) return;

  pendingRecordNormalizations.add(record.id);
  setImmediate(() => {
    try {
      const refreshed = inspectBackupArchive(record.id, archive, record.filename);
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

function countStepModelsInSqlDump(sqlPath: string): number {
  const lines = readFileSync(sqlPath, "utf-8").split(/\r?\n/);
  let inModelsCopy = false;
  let formatIndex = -1;
  let statusIndex = -1;
  let count = 0;

  for (const line of lines) {
    if (!inModelsCopy) {
      const match = line.match(/^COPY\s+(?:public\.)?"?models"?\s+\((.+)\)\s+FROM\s+stdin;$/i);
      if (!match) continue;

      const columns = match[1]
        .split(",")
        .map((value) => value.trim().replace(/^"|"$/g, ""));
      formatIndex = columns.findIndex((column) => column === "format");
      statusIndex = columns.findIndex((column) => column === "status");
      if (formatIndex === -1 || statusIndex === -1) return 0;
      inModelsCopy = true;
      continue;
    }

    if (line === "\\.") break;
    if (!line) continue;

    const fields = line.split("\t");
    const format = (fields[formatIndex] || "").toLowerCase();
    const status = (fields[statusIndex] || "").toLowerCase();
    if ((format === "step" || format === "stp") && status === "completed") {
      count += 1;
    }
  }

  return count;
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
