/**
 * File-based job state sharing for cluster mode.
 *
 * In cluster mode, each worker has its own memory. When a backup/restore/update
 * job starts on Worker A, subsequent poll requests may hit Worker B which has no
 * knowledge of the job. This module persists job state to /tmp so any worker can
 * read the current progress.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, renameSync } from "fs";
import { join } from "path";

const JOB_DIR = "/tmp/model_job_state";

export type PersistedJobState = {
  id: string;
};

export function syncJob<T extends PersistedJobState>(job: T) {
  try {
    mkdirSync(JOB_DIR, { recursive: true });
    const target = join(JOB_DIR, `${job.id}.json`);
    const tmp = join(JOB_DIR, `${job.id}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(job));
    renameSync(tmp, target);
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

export function listJobs<T extends PersistedJobState>(prefix?: string): T[] {
  try {
    mkdirSync(JOB_DIR, { recursive: true });
    return readdirSync(JOB_DIR)
      .filter((file) => file.endsWith(".json") && (!prefix || file.startsWith(prefix)))
      .map((file) => {
        const path = join(JOB_DIR, file);
        const data = JSON.parse(readFileSync(path, "utf-8")) as T;
        return { data, mtime: statSync(path).mtime.getTime() };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map((entry) => entry.data);
  } catch {
    return [];
  }
}

export function removeJobFile(id: string) {
  try { rmSync(join(JOB_DIR, `${id}.json`), { force: true }); } catch {}
}
