/**
 * File-based job state sharing for cluster mode.
 *
 * In cluster mode, each worker has its own memory. When a backup/restore/update
 * job starts on Worker A, subsequent poll requests may hit Worker B which has no
 * knowledge of the job. This module persists job state to /tmp so any worker can
 * read the current progress.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, renameSync } from 'fs';
import { join } from 'path';

const JOB_DIR = '/tmp/model_job_state';

export type PersistedJobState = {
  id: string;
};

export function syncJob<T extends PersistedJobState>(job: T) {
  try {
    mkdirSync(JOB_DIR, { recursive: true });
    const target = join(JOB_DIR, `${job.id}.json`);
    const tmp = join(JOB_DIR, `${job.id}.${process.pid}.tmp`);
    // 统一盖更新时间戳：evictCompleted 按 updatedAt 判断终态任务保留 1 小时，
    // 此前没有任何地方写这个字段 → !job.updatedAt 恒真 → 终态任务立即被逐出内存
    //（当前靠 loadJob 从文件读回兜底，不致 404，但语义错误且依赖 /tmp 存活）。
    writeFileSync(tmp, JSON.stringify({ ...job, updatedAt: Date.now() }));
    renameSync(tmp, target);
  } catch {
    /* best-effort file write */
  }
}

export function loadJob<T>(id: string): T | undefined {
  try {
    const data = readFileSync(join(JOB_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}

export function listJobs<T extends PersistedJobState>(prefix?: string): T[] {
  try {
    mkdirSync(JOB_DIR, { recursive: true });
    return readdirSync(JOB_DIR)
      .filter((file) => file.endsWith('.json') && (!prefix || file.startsWith(prefix)))
      .map((file) => {
        const path = join(JOB_DIR, file);
        const data = JSON.parse(readFileSync(path, 'utf-8')) as T;
        return { data, mtime: statSync(path).mtime.getTime() };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map((entry) => entry.data);
  } catch {
    return [];
  }
}

export function removeJobFile(id: string) {
  try {
    rmSync(join(JOB_DIR, `${id}.json`), { force: true });
  } catch {
    /* best-effort file cleanup */
  }
}
