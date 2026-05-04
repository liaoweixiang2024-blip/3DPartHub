import { existsSync, linkSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import {
  getImportSaveJob,
  getJob,
  getRestoreJob,
  listBackups,
  startBackupJob,
  startImportSaveJob,
  startRestoreJob,
  verifyBackupArchive,
} from '../src/lib/backup.js';

const prisma = new PrismaClient();

const STATIC_BACKUP_EXCLUDE_DIRS = new Set(['backups', '_backup_db', '_safety_snapshots']);
const UPLOAD_BACKUP_EXCLUDE_DIRS = new Set(['backups', 'chunks', 'batch', '.download_tokens']);

type DbFingerprint = Record<string, { count: number; hash: string }>;
type DirFingerprint = Record<string, { files: number; bytes: number }>;

async function main() {
  console.log('== Backup E2E Check ==');
  console.log('1) Capturing current DB and file fingerprints...');
  const beforeDb = await fingerprintDatabase();
  const beforeFiles = fingerprintBusinessFiles();
  printSummary('Before', beforeDb, beforeFiles);

  console.log('2) Creating a new enterprise backup...');
  const backupId = startBackupJob();
  await waitBackup(backupId);
  const createdRecord = listBackups().find((backup) => backup.id === backupId);
  if (!createdRecord) throw new Error(`Created backup record not found: ${backupId}`);
  await verifyBackupArchive(backupId);
  console.log(`   Created and verified: ${backupId} (${createdRecord.fileSizeText})`);

  console.log('3) Importing the created backup as a new backup record...');
  const sourceArchive = join(process.cwd(), 'static', 'backups', `${backupId}.tar.gz`);
  if (!existsSync(sourceArchive)) throw new Error(`Created archive not found: ${sourceArchive}`);
  const importSource = join(process.cwd(), 'static', 'backups', '.work', `${backupId}.import-source.tar.gz`);
  mkdirSync(join(process.cwd(), 'static', 'backups', '.work'), { recursive: true });
  rmSync(importSource, { force: true });
  linkSync(sourceArchive, importSource);
  const importJobId = startImportSaveJob(importSource, `${backupId}.tar.gz`);
  const importedRecord = await waitImportSave(importJobId);
  await verifyBackupArchive(importedRecord.id);
  console.log(`   Imported and verified: ${importedRecord.id} (${importedRecord.fileSizeText})`);

  console.log('4) Restoring from the imported backup record...');
  const restoreJobId = startRestoreJob(importedRecord.id);
  await waitRestore(restoreJobId);
  console.log(`   Restored from: ${importedRecord.id}`);

  console.log('5) Comparing DB and file fingerprints after restore...');
  const afterDb = await fingerprintDatabase();
  const afterFiles = fingerprintBusinessFiles();
  assertEqual('database fingerprint', beforeDb, afterDb);
  assertEqual('business file fingerprint', beforeFiles, afterFiles);
  printSummary('After', afterDb, afterFiles);

  console.log('== Backup E2E Check Passed ==');
  console.log(
    JSON.stringify(
      {
        createdBackupId: backupId,
        importedBackupId: importedRecord.id,
        restoredFromBackupId: importedRecord.id,
      },
      null,
      2,
    ),
  );
}

async function waitBackup(jobId: string) {
  let last = '';
  while (true) {
    const job = getJob(jobId);
    if (!job) throw new Error(`Backup job not found: ${jobId}`);
    const line = `${job.stage}:${job.percent}:${job.message}`;
    if (line !== last) {
      console.log(`   backup ${job.percent}% ${job.stage} - ${job.message}`);
      last = line;
    }
    if (job.stage === 'done') return;
    if (job.stage === 'error') throw new Error(`Backup failed: ${job.error || job.message}`);
    await delay(2000);
  }
}

async function waitImportSave(jobId: string) {
  let last = '';
  while (true) {
    const job = getImportSaveJob(jobId);
    if (!job) throw new Error(`Import job not found: ${jobId}`);
    const line = `${job.stage}:${job.percent}:${job.message}`;
    if (line !== last) {
      console.log(`   import ${job.percent}% ${job.stage} - ${job.message}`);
      last = line;
    }
    if (job.stage === 'done') {
      if (!job.result) throw new Error(`Import job finished without a result: ${jobId}`);
      return job.result;
    }
    if (job.stage === 'error') throw new Error(`Import failed: ${job.error || job.message}`);
    await delay(2000);
  }
}

async function waitRestore(jobId: string) {
  let last = '';
  while (true) {
    const job = getRestoreJob(jobId);
    if (!job) throw new Error(`Restore job not found: ${jobId}`);
    const line = `${job.stage}:${job.percent}:${job.message}`;
    if (line !== last) {
      console.log(`   restore ${job.percent}% ${job.stage} - ${job.message}`);
      last = line;
    }
    if (job.stage === 'done') return;
    if (job.stage === 'error') throw new Error(`Restore failed: ${job.error || job.message}`);
    await delay(2000);
  }
}

async function fingerprintDatabase(): Promise<DbFingerprint> {
  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name
  `);
  const result: DbFingerprint = {};
  for (const { table_name } of tables) {
    const table = quoteIdentifier(table_name);
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint; hash: string }>>(`
      SELECT
        COUNT(*)::bigint AS count,
        COALESCE(MD5(STRING_AGG(MD5(row_to_json(t)::text), '' ORDER BY MD5(row_to_json(t)::text))), MD5('')) AS hash
      FROM (SELECT * FROM ${table}) t
    `);
    result[table_name] = {
      count: Number(rows[0]?.count || 0),
      hash: rows[0]?.hash || '',
    };
  }
  return result;
}

function fingerprintBusinessFiles(): DirFingerprint {
  const result: DirFingerprint = {};
  const staticDir = join(process.cwd(), 'static');
  for (const dir of discoverStaticBackupDirs(staticDir)) {
    result[`static/${dir}`] = countFiles(join(staticDir, dir));
  }
  const uploadDir = join(process.cwd(), 'uploads');
  for (const dir of discoverUploadBackupDirs(uploadDir)) {
    result[`uploads/${dir}`] = countFiles(join(uploadDir, dir));
  }
  return result;
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

function countFiles(root: string): { files: number; bytes: number } {
  if (!existsSync(root)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    const stats = lstatSync(current);
    if (stats.isDirectory()) {
      for (const name of readdirSync(current)) stack.push(join(current, name));
    } else if (stats.isFile()) {
      files += 1;
      bytes += stats.size;
    }
  }
  return { files, bytes };
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function assertEqual(label: string, before: unknown, after: unknown) {
  const left = JSON.stringify(before);
  const right = JSON.stringify(after);
  if (left !== right) {
    throw new Error(`${label} changed after restore\nbefore=${left}\nafter=${right}`);
  }
}

function printSummary(label: string, db: DbFingerprint, files: DirFingerprint) {
  const dbRows = Object.values(db).reduce((sum, item) => sum + item.count, 0);
  const fileRows = Object.values(files).reduce((sum, item) => sum + item.files, 0);
  const fileBytes = Object.values(files).reduce((sum, item) => sum + item.bytes, 0);
  console.log(
    `   ${label}: ${Object.keys(db).length} tables / ${dbRows} rows; ${fileRows} files / ${formatBytes(fileBytes)}`,
  );
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

main()
  .catch((err) => {
    console.error('== Backup E2E Check Failed ==');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
