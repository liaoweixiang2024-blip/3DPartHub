import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ACTIVE_DOWNLOAD_DIR = process.env.ACTIVE_MODEL_DOWNLOAD_DIR || join(tmpdir(), '3dparthub_active_downloads');
const ACTIVE_DOWNLOAD_STALE_MS = 2 * 60 * 60 * 1000;

function modelKey(modelId: string): string {
  return createHash('sha256').update(modelId).digest('hex').slice(0, 24);
}

function ensureDir() {
  mkdirSync(ACTIVE_DOWNLOAD_DIR, { recursive: true });
}

function cleanupStaleLocks(now = Date.now()) {
  if (!existsSync(ACTIVE_DOWNLOAD_DIR)) return;
  for (const file of readdirSync(ACTIVE_DOWNLOAD_DIR)) {
    if (!file.endsWith('.json')) continue;
    const fullPath = join(ACTIVE_DOWNLOAD_DIR, file);
    try {
      const age = now - statSync(fullPath).mtimeMs;
      if (age > ACTIVE_DOWNLOAD_STALE_MS) rmSync(fullPath, { force: true });
    } catch {
      // Ignore stale lock cleanup failures; they should not break downloads or deletes.
    }
  }
}

export function trackActiveModelDownload(modelId: string): () => void {
  let lockPath: string | null = null;
  try {
    ensureDir();
    cleanupStaleLocks();
    lockPath = join(ACTIVE_DOWNLOAD_DIR, `${modelKey(modelId)}-${randomUUID()}.json`);
    writeFileSync(lockPath, JSON.stringify({ modelId, startedAt: new Date().toISOString(), pid: process.pid }));
  } catch {
    return () => {};
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (lockPath) rmSync(lockPath, { force: true });
    } catch {
      // Best effort only.
    }
  };
}

export function hasActiveModelDownload(modelId: string): boolean {
  cleanupStaleLocks();
  if (!existsSync(ACTIVE_DOWNLOAD_DIR)) return false;
  const prefix = `${modelKey(modelId)}-`;
  try {
    return readdirSync(ACTIVE_DOWNLOAD_DIR).some((file) => file.startsWith(prefix) && file.endsWith('.json'));
  } catch {
    return false;
  }
}

export function clearActiveModelDownloadLocksForTest() {
  try {
    rmSync(ACTIVE_DOWNLOAD_DIR, { recursive: true, force: true });
  } catch {
    // Test cleanup only.
  }
}
