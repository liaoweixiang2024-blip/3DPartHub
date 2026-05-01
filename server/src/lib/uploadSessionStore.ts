import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface UploadSession {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  userId: string;
  createdAt: number;
  purpose?: "backup" | "model";
}

const SESSION_DIR = "/tmp/model_upload_sessions";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function sessionPath(uploadId: string) {
  return join(SESSION_DIR, `${uploadId}.json`);
}

export function saveUploadSession(uploadId: string, session: UploadSession) {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(sessionPath(uploadId), JSON.stringify(session));
}

export function loadUploadSession(uploadId: string): UploadSession | undefined {
  try {
    const raw = readFileSync(sessionPath(uploadId), "utf-8");
    return JSON.parse(raw) as UploadSession;
  } catch {
    return undefined;
  }
}

export function deleteUploadSession(uploadId: string) {
  try {
    rmSync(sessionPath(uploadId), { force: true });
  } catch {}
}

// Clean up expired upload sessions and orphan chunk directories
export function cleanupExpiredSessions(chunksDir: string) {
  const now = Date.now();
  try {
    mkdirSync(SESSION_DIR, { recursive: true });
    const files = readdirSync(SESSION_DIR).filter(f => f.endsWith(".json"));
    const activeUploadIds = new Set<string>();
    for (const file of files) {
      try {
        const raw = readFileSync(join(SESSION_DIR, file), "utf-8");
        const session = JSON.parse(raw) as UploadSession;
        const uploadId = file.replace(".json", "");
        if (now - session.createdAt > SESSION_TTL_MS) {
          // Delete session file
          rmSync(join(SESSION_DIR, file), { force: true });
          // Delete chunk directory
          try { rmSync(join(chunksDir, uploadId), { recursive: true, force: true }); } catch {}
          console.log(`[Upload] Cleaned expired session: ${uploadId}`);
        } else {
          activeUploadIds.add(uploadId);
        }
      } catch {}
    }
    cleanupOrphanChunkDirs(chunksDir, activeUploadIds, now);
  } catch {}
}

function cleanupOrphanChunkDirs(chunksDir: string, activeUploadIds: Set<string>, now: number) {
  if (!existsSync(chunksDir)) return;
  for (const entry of readdirSync(chunksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (activeUploadIds.has(entry.name)) continue;
    const dir = join(chunksDir, entry.name);
    try {
      const ageMs = now - statSync(dir).mtime.getTime();
      if (ageMs > SESSION_TTL_MS) {
        rmSync(dir, { recursive: true, force: true });
        console.log(`[Upload] Cleaned orphan chunk directory: ${entry.name}`);
      }
    } catch {}
  }
}
