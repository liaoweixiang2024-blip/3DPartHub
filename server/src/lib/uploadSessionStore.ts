import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface UploadSession {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  userId: string;
  createdAt: number;
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
    for (const file of files) {
      try {
        const raw = readFileSync(join(SESSION_DIR, file), "utf-8");
        const session = JSON.parse(raw) as UploadSession;
        if (now - session.createdAt > SESSION_TTL_MS) {
          const uploadId = file.replace(".json", "");
          // Delete session file
          rmSync(join(SESSION_DIR, file), { force: true });
          // Delete chunk directory
          try { rmSync(join(chunksDir, uploadId), { recursive: true, force: true }); } catch {}
          console.log(`[Upload] Cleaned expired session: ${uploadId}`);
        }
      } catch {}
    }
  } catch {}
}
