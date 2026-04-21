/**
 * File-based job state sharing for cluster mode.
 *
 * In cluster mode, each worker has its own memory. When a backup/restore/update
 * job starts on Worker A, subsequent poll requests may hit Worker B which has no
 * knowledge of the job. This module persists job state to /tmp so any worker can
 * read the current progress.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const JOB_DIR = "/tmp/model_job_state";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function syncJob(job: { id: string; [key: string]: any }) {
  try {
    mkdirSync(JOB_DIR, { recursive: true });
    writeFileSync(join(JOB_DIR, `${job.id}.json`), JSON.stringify(job));
  } catch {}
}

export function loadJob<T>(id: string): T | undefined {
  try {
    const data = readFileSync(join(JOB_DIR, `${id}.json`), "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}

export function removeJobFile(id: string) {
  try { rmSync(join(JOB_DIR, `${id}.json`), { force: true }); } catch {}
}
