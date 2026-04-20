import client from "./client";
import { getAccessToken } from "../stores";

export interface SystemSettings {
  require_login_download: boolean;
  require_login_browse: boolean;
  allow_register: boolean;
  daily_download_limit: number;
  allow_comments: boolean;
  show_watermark: boolean;
  watermark_text: string;
  watermark_image: string;
  site_title: string;
  site_browser_title: string;
  site_logo: string;
  site_icon: string;
  site_favicon: string;
  site_logo_display: string;
  site_description: string;
  site_keywords: string;
  contact_email: string;
  footer_links: string;
  footer_copyright: string;
  announcement_enabled: boolean;
  announcement_text: string;
  announcement_type: string;
  announcement_color: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  smtp_secure: boolean;
}

export interface BackupStats {
  modelCount: number;
  thumbnailCount: number;
  dbSize: string;
}

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

export interface RestoreResult {
  dbRestored: boolean;
  modelCount: number;
  thumbnailCount: number;
}

function unwrap<T>(res: { data: unknown }): T {
  const d = res.data as any;
  if (d && typeof d === 'object' && 'data' in d) return d.data as T;
  return d as T;
}

export async function getSettings(): Promise<SystemSettings> {
  const res = await client.get("/settings");
  return unwrap<SystemSettings>(res);
}

export async function updateSettings(data: Partial<SystemSettings>): Promise<SystemSettings> {
  const res = await client.put("/settings", data);
  return unwrap<SystemSettings>(res);
}

export async function getPublicSettings(): Promise<Partial<SystemSettings>> {
  const res = await client.get("/settings/public");
  return unwrap<Partial<SystemSettings>>(res);
}

export async function uploadImage(file: File, key: string): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await client.post(`/settings/upload-image?key=${encodeURIComponent(key)}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return unwrap<{ url: string }>(res);
}

export async function getBackupStats(): Promise<BackupStats> {
  const res = await client.get("/settings/backup/stats");
  return unwrap<BackupStats>(res);
}

export async function listBackups(): Promise<BackupRecord[]> {
  const res = await client.get("/settings/backup/list");
  return unwrap<BackupRecord[]>(res);
}

export async function startBackupJob(): Promise<string> {
  const res = await client.post("/settings/backup/create", {}, { timeout: 30000 });
  const data = res.data as any;
  const jobId = data?.data?.jobId ?? data?.jobId;
  if (!jobId) throw new Error("启动备份失败");
  return jobId;
}

export async function pollBackupProgress(
  jobId: string,
  onProgress?: (stage: string, percent: number, message: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let consecutiveErrors = 0;
    const MAX_ERRORS = 5;
    const poll = setInterval(async () => {
      try {
        const res = await client.get(`/settings/backup/progress/${jobId}`, { timeout: 15000 });
        consecutiveErrors = 0;
        const d = (res.data as any)?.data ?? res.data;
        onProgress?.(d.stage, d.percent, d.message);
        if (d.stage === "done") {
          clearInterval(poll);
          resolve(jobId);
        } else if (d.stage === "error") {
          clearInterval(poll);
          reject(new Error(d.error || "备份失败"));
        }
      } catch (err: any) {
        consecutiveErrors++;
        const status = err.response?.status;
        // Job not found — server restarted or job expired
        if (status === 404) {
          clearInterval(poll);
          reject(new Error("备份任务不存在，服务器可能已重启"));
          return;
        }
        // Transient network errors — retry up to MAX_ERRORS times
        if (consecutiveErrors >= MAX_ERRORS) {
          clearInterval(poll);
          reject(new Error(err.response?.data?.message || err.message || "查询进度失败"));
        }
        // Otherwise silently retry on next interval
      }
    }, 1500);
  });
}

export async function downloadBackup(id: string): Promise<void> {
  const token = getAccessToken();
  if (!token) throw new Error("未登录");
  window.open(`/api/settings/backup/download/${id}?token=${encodeURIComponent(token)}`, "_blank");
}

export async function renameBackup(id: string, name: string): Promise<BackupRecord> {
  const res = await client.put(`/settings/backup/rename/${id}`, { name });
  return unwrap<BackupRecord>(res);
}

export async function deleteBackup(id: string): Promise<void> {
  await client.delete(`/settings/backup/delete/${id}`);
}

export async function startRestore(id: string): Promise<string> {
  const res = await client.post(`/settings/backup/restore/${id}`, {}, { timeout: 30000 });
  const data = res.data as any;
  const jobId = data?.data?.jobId ?? data?.jobId;
  if (!jobId) throw new Error("启动恢复失败");
  return jobId;
}

export async function pollRestoreProgress(
  jobId: string,
  onProgress?: (stage: string, percent: number, message: string) => void,
): Promise<RestoreResult> {
  return new Promise((resolve, reject) => {
    let consecutiveErrors = 0;
    const MAX_ERRORS = 5;
    const poll = setInterval(async () => {
      try {
        const res = await client.get(`/settings/backup/restore-progress/${jobId}`, { timeout: 15000 });
        consecutiveErrors = 0;
        const d = (res.data as any)?.data ?? res.data;
        onProgress?.(d.stage, d.percent, d.message);
        if (d.stage === "done") {
          clearInterval(poll);
          resolve(d.result ?? { dbRestored: true, modelCount: 0, thumbnailCount: 0 });
        } else if (d.stage === "error") {
          clearInterval(poll);
          reject(new Error(d.error || "恢复失败"));
        }
      } catch (err: any) {
        consecutiveErrors++;
        const status = err.response?.status;
        if (status === 404) {
          clearInterval(poll);
          reject(new Error("恢复任务不存在，服务器可能已重启"));
          return;
        }
        if (consecutiveErrors >= MAX_ERRORS) {
          clearInterval(poll);
          reject(new Error(err.response?.data?.message || err.message || "查询进度失败"));
        }
      }
    }, 1500);
  });
}

export async function importBackupAsRecord(
  file: File,
  mode: "direct" | "chunked",
  onUploadProgress?: (percent: number) => void,
): Promise<BackupRecord> {
  if (mode === "chunked" && file.size >= 100 * 1024 * 1024) {
    return chunkedSaveAsRecord(file, onUploadProgress);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/settings/backup/import-save");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onUploadProgress) {
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const record = data?.data ?? data;
          resolve(record);
        } catch { reject(new Error("解析响应失败")); }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || err.message || "保存失败"));
        } catch { reject(new Error(`保存失败 (${xhr.status})`)); }
      }
    };
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.ontimeout = () => reject(new Error("上传超时"));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    const formData = new FormData();
    formData.append("file", file);
    xhr.timeout = 7200000;
    xhr.send(formData);
  });
}

async function chunkedSaveAsRecord(file: File, onProgress?: (percent: number) => void): Promise<BackupRecord> {
  const CHUNK_SIZE = 10 * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  const { data: initResp } = await client.post("/upload/init", {
    fileName: file.name, fileSize: file.size, totalChunks,
  });
  const initData = (initResp as any)?.data ?? initResp;
  const uploadId = initData.uploadId;
  if (!uploadId) throw new Error("初始化上传失败");

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    let retries = 3;
    while (retries > 0) {
      try {
        await fetch(`/api/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${getAccessToken()}` },
          body: chunk,
        });
        break;
      } catch {
        retries--;
        if (retries === 0) throw new Error(`分块 ${i + 1}/${totalChunks} 上传失败`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    onProgress?.(Math.round(((i + 1) / totalChunks) * 100));
  }

  const { data: completeResp } = await client.post("/upload/complete", { uploadId });
  const completeData = (completeResp as any)?.data ?? completeResp;
  const filePath = completeData.filePath;

  const { data: saveResp } = await client.post("/settings/backup/import-save-chunked", { filePath, fileName: file.name });
  const saveData = (saveResp as any)?.data ?? saveResp;
  return saveData;
}

export async function importBackup(
  file: File,
  onUploadProgress?: (percent: number) => void,
): Promise<string> {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk
  const fileSize = file.size;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  // Small files (< 100MB): direct upload
  if (fileSize < 100 * 1024 * 1024) {
    return directUpload(file, onUploadProgress);
  }

  // Large files: chunked upload with resume support
  try {
    // Step 1: Init chunked upload
    const { data: initResp } = await client.post("/upload/init", {
      fileName: file.name,
      fileSize,
      totalChunks,
    });
    const initData = (initResp as any)?.data ?? initResp;
    const uploadId = initData.uploadId;
    if (!uploadId) throw new Error("初始化上传失败");

    // Step 2: Upload chunks with retry
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunk = file.slice(start, end);

      let retries = 3;
      while (retries > 0) {
        try {
          await fetch(`/api/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${getAccessToken()}` },
            body: chunk,
          });
          break;
        } catch {
          retries--;
          if (retries === 0) throw new Error(`分块 ${i + 1}/${totalChunks} 上传失败`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      onUploadProgress?.(Math.round(((i + 1) / totalChunks) * 100));
    }

    // Step 3: Complete upload — merges chunks into final file
    const { data: completeResp } = await client.post("/upload/complete", { uploadId });
    const completeData = (completeResp as any)?.data ?? completeResp;
    const filePath = completeData.filePath;
    if (!filePath) throw new Error("合并文件失败");

    // Step 4: Start restore from merged file
    const { data: restoreResp } = await client.post("/settings/backup/import-chunked", { filePath });
    const restoreData = (restoreResp as any)?.data ?? restoreResp;
    const jobId = restoreData.jobId;
    if (!jobId) throw new Error("启动恢复失败");

    return jobId;
  } catch (err: any) {
    throw new Error(err.response?.data?.detail || err.message || "分块上传失败");
  }
}

function directUpload(file: File, onProgress?: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/settings/backup/import");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const jobId = data?.data?.jobId ?? data?.jobId;
          if (jobId) resolve(jobId);
          else reject(new Error("导入响应异常"));
        } catch {
          reject(new Error("解析响应失败"));
        }
      } else if (xhr.status === 401) {
        reject(new Error("登录已过期，请刷新页面后重试"));
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || err.message || "导入失败"));
        } catch {
          reject(new Error(`导入失败 (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.ontimeout = () => reject(new Error("上传超时"));

    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    const formData = new FormData();
    formData.append("file", file);
    xhr.timeout = 7200000;
    xhr.send(formData);
  });
}
