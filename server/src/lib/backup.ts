import { execSync, spawn, execFile } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, readdirSync, readFileSync, renameSync, createWriteStream } from "fs";
import { join } from "path";
import { config } from "./config.js";
import { syncJob, loadJob, removeJobFile } from "./jobStore.js";

const DB_URL = config.databaseUrl;
// Strip Prisma-specific query params that pg_dump/psql don't understand
const DB_URL_CLEAN = DB_URL.replace(/\?.*/, "");
const BACKUP_DIR = join(process.cwd(), config.staticDir, "backups");

// Ensure backup directory exists
mkdirSync(BACKUP_DIR, { recursive: true });

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
}

function metaPath(id: string) { return join(BACKUP_DIR, `${id}.json`); }
function archivePath(id: string) { return join(BACKUP_DIR, `${id}.tar.gz`); }

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
  const dest = archivePath(id);

  // Copy uploaded file to backups directory (rename may fail across devices)
  execSync(`cp "${archPath}" "${dest}"`, { stdio: "pipe" });
  if (existsSync(archPath)) rmSync(archPath, { force: true });

  const fileSize = statSync(dest).size;
  const record: BackupRecord = {
    id,
    filename: `${id}.tar.gz`,
    name: `导入 ${originalName.replace(/\.tar\.gz$/, "").replace(/\.tgz$/, "")}`,
    createdAt: new Date().toISOString(),
    fileSize,
    fileSizeText: formatSize(fileSize),
    modelCount: 0,
    thumbnailCount: 0,
    dbSize: "unknown",
  };

  // Try to extract metadata from archive
  const tmpDir = `/tmp/peek_${id}`;
  try {
    mkdirSync(tmpDir, { recursive: true });
    execSync(`tar xzf "${dest}" -C "${tmpDir}" _backup_db/meta.json 2>/dev/null || true`, { stdio: "pipe", timeout: 30_000 });
    const metaFile = join(tmpDir, "_backup_db", "meta.json");
    if (existsSync(metaFile)) {
      const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
      if (meta.timestamp) record.createdAt = meta.timestamp;
    }
    // Count models and thumbnails in archive
    try {
      const list = execSync(`tar tzf "${dest}"`, { stdio: "pipe", timeout: 60_000 }).toString();
      record.modelCount = (list.match(/models\/.*\.gltf/g) || []).length;
      record.thumbnailCount = (list.match(/thumbnails\/.*\.png/g) || []).length;
      const originalsCount = (list.match(/originals\/.*/g) || []).length;
      if (originalsCount > 0) {
        record.name += ` (${originalsCount} 原始文件)`;
      }
    } catch {}
  } catch {} finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }

  writeFileSync(metaPath(id), JSON.stringify(record, null, 2));
  return record;
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
      if (existsSync(archivePath(id))) rmSync(archivePath(id), { force: true });
      if (existsSync(metaPath(id))) rmSync(metaPath(id), { force: true });
      syncJob(job);
      console.error(`[Backup #${job.id}] Error:`, err.message);
    });
  });

  return id;
}

async function runBackup(job: BackupJob) {
  const tmpDir = `/tmp/backup_${job.id}`;
  const finalArchive = archivePath(job.id);

  try {
    mkdirSync(tmpDir, { recursive: true });
    addLog(job, "开始备份任务...");

    // Step 1: pg_dump (0-30%)
    job.stage = "dumping";
    job.percent = 5;
    job.message = "正在导出数据库...";
    addLog(job, "正在导出数据库 (pg_dump)...");

    execSync(`pg_dump "${DB_URL_CLEAN}" --no-owner --no-privileges > "${tmpDir}/database.sql"`, {
      stdio: "pipe",
      timeout: 120_000,
    });

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

    // Copy db files into static/_backup_db so tar uses a single -C
    const dbMarker = join(staticDir, "_backup_db");
    mkdirSync(dbMarker, { recursive: true });
    execSync(`cp "${join(tmpDir, "database.sql")}" "${join(dbMarker, "database.sql")}"`, { stdio: "pipe" });
    execSync(`cp "${join(tmpDir, "meta.json")}" "${join(dbMarker, "meta.json")}"`, { stdio: "pipe" });

    await new Promise<void>((resolve, reject) => {
      const tmpArchive = `${finalArchive}.tmp`;
      const args: string[] = ["czf", tmpArchive, "-C", staticDir];
      args.push("_backup_db/database.sql", "_backup_db/meta.json");
      if (hasModels) args.push("models");
      if (hasThumbs) args.push("thumbnails");
      if (hasOriginals) args.push("originals");

      const proc = spawn("tar", args, { timeout: 600_000 });
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
    writeFileSync(metaPath(job.id), JSON.stringify(record, null, 2));

    job.stage = "done";
    job.percent = 100;
    job.message = "备份完成";
    addLog(job, `备份完成！共 ${record.modelCount} 个模型，${record.thumbnailCount} 张预览图`);

    console.log(`[Backup #${job.id}] Done: ${formatSize(fileSize)}`);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
    syncJob(job);
    if (existsSync(finalArchive)) rmSync(finalArchive, { force: true });
    if (existsSync(metaPath(job.id))) rmSync(metaPath(job.id), { force: true });
    console.error(`[Backup #${job.id}] Error:`, err.message);
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- List backups ----

export function listBackups(): BackupRecord[] {
  if (!existsSync(BACKUP_DIR)) return [];
  const files = readdirSync(BACKUP_DIR).filter(f => f.endsWith(".json"));
  const records: BackupRecord[] = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(BACKUP_DIR, f), "utf-8");
      const r = JSON.parse(raw) as BackupRecord;
      // Verify archive exists
      if (existsSync(archivePath(r.id))) {
        records.push(r);
      }
    } catch {}
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
  const meta = metaPath(id);
  const arch = archivePath(id);
  let deleted = false;
  if (existsSync(meta)) { rmSync(meta, { force: true }); deleted = true; }
  if (existsSync(arch)) { rmSync(arch, { force: true }); deleted = true; }
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
  const arch = archivePath(backupId);
  if (!existsSync(arch)) throw new Error("备份文件不存在");

  const tmpDir = `/tmp/restore_${job.id}`;
  const result = { dbRestored: false, modelCount: 0, thumbnailCount: 0 };

  try {
    mkdirSync(tmpDir, { recursive: true });

    // Step 1: Extract (0-30%)
    job.stage = "extracting";
    job.percent = 5;
    job.message = "正在解压备份文件...";
    syncJob(job);

    execSync(`tar xzf "${arch}" -C "${tmpDir}"`, { stdio: "pipe", timeout: 600_000 });
    job.percent = 30;
    syncJob(job);

    // Find database.sql (may be inside _backup_db/)
    let sqlPath = join(tmpDir, "database.sql");
    if (!existsSync(sqlPath)) sqlPath = join(tmpDir, "_backup_db", "database.sql");

    // Step 2: Restore database (30-70%)
    if (existsSync(sqlPath)) {
      job.stage = "restoring_db";
      job.percent = 35;
      job.message = "正在恢复数据库...";
      syncJob(job);

      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      try { await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;`); } catch {}
      await prisma.$disconnect();
      job.percent = 45;
      syncJob(job);

      execSync("npx prisma migrate deploy", { stdio: "pipe", timeout: 60_000, env: { ...process.env } });
      job.percent = 55;
      syncJob(job);

      execSync(`psql "${DB_URL_CLEAN}" < "${sqlPath}"`, { stdio: "pipe", timeout: 300_000 });
      result.dbRestored = true;
      job.percent = 70;
      syncJob(job);
    } else {
      job.percent = 70;
      syncJob(job);
    }

    // Step 3: Restore files (70-95%)
    const staticDir = join(process.cwd(), config.staticDir);

    const modelsTmp = join(tmpDir, "models");
    if (existsSync(modelsTmp)) {
      job.stage = "restoring_files";
      job.percent = 75;
      job.message = "正在恢复模型文件...";
      syncJob(job);

      const dest = join(staticDir, "models");
      mkdirSync(dest, { recursive: true });
      execSync(`rm -rf "${dest}"/*`, { stdio: "pipe" });
      execSync(`cp -r "${modelsTmp}/." "${dest}/"`, { stdio: "pipe" });
      try { result.modelCount = parseInt(execSync(`find "${dest}" -name '*.gltf' -type f | wc -l`).toString().trim()) || 0; } catch {}
      job.percent = 85;
      syncJob(job);
    }

    const thumbsTmp = join(tmpDir, "thumbnails");
    if (existsSync(thumbsTmp)) {
      job.percent = 90;
      job.message = "正在恢复缩略图...";
      syncJob(job);

      const dest = join(staticDir, "thumbnails");
      mkdirSync(dest, { recursive: true });
      execSync(`rm -rf "${dest}"/*`, { stdio: "pipe" });
      execSync(`cp -r "${thumbsTmp}/." "${dest}/"`, { stdio: "pipe" });
      try { result.thumbnailCount = parseInt(execSync(`find "${dest}" -name '*.png' -type f | wc -l`).toString().trim()) || 0; } catch {}
      syncJob(job);
    }

    const originalsTmp = join(tmpDir, "originals");
    if (existsSync(originalsTmp)) {
      job.percent = 94;
      job.message = "正在恢复原始文件...";
      syncJob(job);

      const dest = join(staticDir, "originals");
      mkdirSync(dest, { recursive: true });
      execSync(`rm -rf "${dest}"/*`, { stdio: "pipe" });
      execSync(`cp -r "${originalsTmp}/." "${dest}/"`, { stdio: "pipe" });
      syncJob(job);
    }

    job.stage = "done";
    job.percent = 100;
    job.message = "恢复完成";
    job.result = result;
    syncJob(job);

    console.log(`[Restore #${job.id}] Done: ${result.modelCount} models, ${result.thumbnailCount} thumbnails`);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
    syncJob(job);
    console.error(`[Restore #${job.id}] Error:`, err.message);
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
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
  const tmpDir = `/tmp/restore_${job.id}`;
  const result = { dbRestored: false, modelCount: 0, thumbnailCount: 0 };

  try {
    mkdirSync(tmpDir, { recursive: true });

    // Step 1: Extract (0-30%)
    job.stage = "extracting";
    job.percent = 5;
    job.message = "正在解压备份文件...";
    syncJob(job);

    execSync(`tar xzf "${archPath}" -C "${tmpDir}"`, { stdio: "pipe", timeout: 600_000 });
    // Clean up uploaded archive
    if (existsSync(archPath)) rmSync(archPath, { force: true });
    job.percent = 30;
    syncJob(job);

    // Find database.sql
    let sqlPath = join(tmpDir, "database.sql");
    if (!existsSync(sqlPath)) sqlPath = join(tmpDir, "_backup_db", "database.sql");

    // Step 2: Restore database (30-70%)
    if (existsSync(sqlPath)) {
      job.stage = "restoring_db";
      job.percent = 35;
      job.message = "正在恢复数据库...";
      syncJob(job);

      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      try { await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;`); } catch {}
      await prisma.$disconnect();
      job.percent = 45;
      syncJob(job);

      execSync("npx prisma migrate deploy", { stdio: "pipe", timeout: 60_000, env: { ...process.env } });
      job.percent = 55;
      syncJob(job);

      execSync(`psql "${DB_URL_CLEAN}" < "${sqlPath}"`, { stdio: "pipe", timeout: 300_000 });
      result.dbRestored = true;
      job.percent = 70;
      syncJob(job);
    } else {
      job.percent = 70;
      syncJob(job);
    }

    // Step 3: Restore files (70-95%)
    const staticDir = join(process.cwd(), config.staticDir);

    const modelsTmp = join(tmpDir, "models");
    if (existsSync(modelsTmp)) {
      job.stage = "restoring_files";
      job.percent = 75;
      job.message = "正在恢复模型文件...";
      syncJob(job);

      const dest = join(staticDir, "models");
      mkdirSync(dest, { recursive: true });
      execSync(`rm -rf "${dest}"/*`, { stdio: "pipe" });
      execSync(`cp -r "${modelsTmp}/." "${dest}/"`, { stdio: "pipe" });
      try { result.modelCount = parseInt(execSync(`find "${dest}" -name '*.gltf' -type f | wc -l`).toString().trim()) || 0; } catch {}
      job.percent = 85;
      syncJob(job);
    }

    const thumbsTmp = join(tmpDir, "thumbnails");
    if (existsSync(thumbsTmp)) {
      job.percent = 90;
      job.message = "正在恢复缩略图...";
      syncJob(job);

      const dest = join(staticDir, "thumbnails");
      mkdirSync(dest, { recursive: true });
      execSync(`rm -rf "${dest}"/*`, { stdio: "pipe" });
      execSync(`cp -r "${thumbsTmp}/." "${dest}/"`, { stdio: "pipe" });
      try { result.thumbnailCount = parseInt(execSync(`find "${dest}" -name '*.png' -type f | wc -l`).toString().trim()) || 0; } catch {}
      syncJob(job);
    }

    const originalsTmp = join(tmpDir, "originals");
    if (existsSync(originalsTmp)) {
      job.percent = 94;
      job.message = "正在恢复原始文件...";
      syncJob(job);

      const dest = join(staticDir, "originals");
      mkdirSync(dest, { recursive: true });
      execSync(`rm -rf "${dest}"/*`, { stdio: "pipe" });
      execSync(`cp -r "${originalsTmp}/." "${dest}/"`, { stdio: "pipe" });
      syncJob(job);
    }

    job.stage = "done";
    job.percent = 100;
    job.message = "恢复完成";
    job.result = result;
    syncJob(job);

    console.log(`[Restore #${job.id}] Done: ${result.modelCount} models, ${result.thumbnailCount} thumbnails`);
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
    if (existsSync(archPath)) rmSync(archPath, { force: true });
    syncJob(job);
    console.error(`[Restore #${job.id}] Error:`, err.message);
  } finally {
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
  let modelCount = 0;
  let thumbnailCount = 0;
  let dbSize = "unknown";

  try { modelCount = parseInt(execSync(`find "${join(staticDir, "models")}" -name '*.gltf' -type f 2>/dev/null | wc -l`).toString().trim()) || 0; } catch {}
  try { thumbnailCount = parseInt(execSync(`find "${join(staticDir, "thumbnails")}" -name '*.png' -type f 2>/dev/null | wc -l`).toString().trim()) || 0; } catch {}

  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const r = await prisma.$queryRaw<Array<{ pg_size_pretty: string }>>`SELECT pg_size_pretty(pg_database_size(current_database())) as pg_size_pretty`;
    await prisma.$disconnect();
    if (r[0]?.pg_size_pretty) dbSize = r[0].pg_size_pretty;
  } catch {}

  return { modelCount, thumbnailCount, dbSize };
}

// ---- Helpers ----

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}
