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
  contact_phone: string;
  contact_address: string;
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
  email_templates: string;
  color_scheme: string;
  color_custom_dark: string;
  color_custom_light: string;
  default_theme: string;
  auto_theme_enabled: boolean;
  auto_theme_dark_hour: number;
  auto_theme_light_hour: number;
  // 3D Material — default
  mat_default_color: string;
  mat_default_metalness: number;
  mat_default_roughness: number;
  mat_default_envMapIntensity: number;
  // 3D Material — metal
  mat_metal_color: string;
  mat_metal_metalness: number;
  mat_metal_roughness: number;
  mat_metal_envMapIntensity: number;
  // 3D Material — plastic
  mat_plastic_color: string;
  mat_plastic_metalness: number;
  mat_plastic_roughness: number;
  mat_plastic_envMapIntensity: number;
  // 3D Material — glass
  mat_glass_color: string;
  mat_glass_metalness: number;
  mat_glass_roughness: number;
  mat_glass_envMapIntensity: number;
  mat_glass_transmission: number;
  mat_glass_ior: number;
  mat_glass_thickness: number;
  // 3D Viewer lighting
  viewer_exposure: number;
  viewer_ambient_intensity: number;
  viewer_main_light_intensity: number;
  viewer_fill_light_intensity: number;
  viewer_hemisphere_intensity: number;
  viewer_bg_color: string;
  // Share policy
  share_default_expire_days: number;
  share_max_expire_days: number;
  share_default_download_limit: number;
  share_max_download_limit: number;
  share_allow_password: boolean;
  share_allow_custom_expiry: boolean;
  share_allow_preview: boolean;
  // Selection wizard
  selection_page_title: string;
  selection_page_desc: string;
  selection_enable_match: boolean;
  field_aliases: string;
  selection_thread_priority: string;
  // Quotation template
  quote_template: string;
  document_templates: string;
  // Business dictionaries and policies
  inquiry_statuses: string;
  ticket_statuses: string;
  ticket_classifications: string;
  support_process_steps: string;
  nav_user_items: string;
  nav_admin_items: string;
  nav_mobile_items: string;
  upload_policy: string;
  page_size_policy: string;
  // Anti-reverse-proxy & hotlink protection
  anti_proxy_enabled: boolean;
  allowed_hosts: string;
  hotlink_protection_enabled: boolean;
  allowed_referers: string;
  // Enterprise backup policy
  backup_auto_enabled: boolean;
  backup_schedule_time: string;
  backup_retention_count: number;
  backup_mirror_enabled: boolean;
  backup_mirror_dir: string;
  backup_last_mirror_status: string;
  backup_last_mirror_message: string;
  backup_last_mirror_at: string;
  backup_last_auto_date: string;
  backup_last_auto_status: string;
  backup_last_auto_message: string;
  backup_last_auto_job_id: string;
  backup_last_auto_at: string;
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
  archiveSha256?: string;
  manifestVersion?: string;
  verifiedAt?: string;
}

export interface BackupHealth {
  enabled: boolean;
  scheduleTime: string;
  retentionCount: number;
  mirrorEnabled: boolean;
  mirrorDir?: string;
  status: "ok" | "warning" | "disabled" | "empty";
  message: string;
  backupCount: number;
  totalSize: number;
  totalSizeText: string;
  latestBackup?: BackupRecord;
  nextRunAt?: string;
  lastAutoStatus?: string;
  lastAutoMessage?: string;
  lastAutoAt?: string;
  lastAutoJobId?: string;
  lastMirrorStatus?: string;
  lastMirrorMessage?: string;
  lastMirrorAt?: string;
}

export interface BackupPolicyCheckItem {
  key: string;
  label: string;
  status: "ok" | "warning" | "error";
  message: string;
}

export interface BackupPolicyCheck {
  status: "ok" | "warning" | "error";
  checkedAt: string;
  estimatedBackupSize: number;
  estimatedBackupSizeText: string;
  checks: BackupPolicyCheckItem[];
}

export interface BackupVerificationResult {
  id: string;
  ok: boolean;
  checkedAt: string;
  fileSize: number;
  fileSizeText: string;
  manifestVersion?: string;
  archiveSha256?: string;
  message: string;
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

export async function sendTestEmail(to: string): Promise<{ message: string }> {
  const res = await client.post("/settings/email/test", { to }, { timeout: 30000 });
  return unwrap<{ message: string }>(res);
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

export async function getBackupHealth(): Promise<BackupHealth> {
  const res = await client.get("/settings/backup/health");
  return unwrap<BackupHealth>(res);
}

export async function checkBackupPolicy(): Promise<BackupPolicyCheck> {
  const res = await client.post("/settings/backup/check", {}, { timeout: 120000 });
  return unwrap<BackupPolicyCheck>(res);
}

export async function verifyBackup(id: string): Promise<BackupVerificationResult> {
  const res = await client.post(`/settings/backup/verify/${id}`, {}, { timeout: 120000 });
  return unwrap<BackupVerificationResult>(res);
}

export async function listBackups(): Promise<BackupRecord[]> {
  const res = await client.get("/settings/backup/list");
  return unwrap<BackupRecord[]>(res);
}

export async function startBackupJob(): Promise<string> {
  try {
    const res = await client.post("/settings/backup/create", {}, { timeout: 30000 });
    const data = res.data as any;
    const jobId = data?.data?.jobId ?? data?.jobId;
    if (!jobId) throw new Error("启动备份失败");
    return jobId;
  } catch (err: any) {
    const responseData = err.response?.data;
    const message =
      responseData?.detail ||
      responseData?.message ||
      responseData?.data?.detail ||
      responseData?.data?.message;
    if (err.response?.status === 409) {
      const conflictError = new Error(message || "已有备份或恢复任务正在进行中，请等待完成后再试");
      (conflictError as Error & { jobId?: string }).jobId = responseData?.jobId || responseData?.data?.jobId;
      throw conflictError;
    }
    throw new Error(message || err.message || "启动备份失败");
  }
}

export async function pollBackupProgress(
  jobId: string,
  onProgress?: (stage: string, percent: number, message: string, logs?: string[]) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let consecutiveErrors = 0;
    const MAX_ERRORS = 5;
    const poll = setInterval(async () => {
      try {
        const res = await client.get(`/settings/backup/progress/${jobId}`, { timeout: 15000 });
        consecutiveErrors = 0;
        const d = (res.data as any)?.data ?? res.data;
        onProgress?.(d.stage, d.percent, d.message, d.logs);
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
  // Get a short-lived one-time download token, then open download
  const { data: resp } = await client.post(`/settings/backup/download-token/${id}`);
  const token = (resp as any)?.data?.token ?? (resp as any)?.token;
  if (!token) throw new Error("获取下载令牌失败");
  window.open(`/api/settings/backup/download/${token}`, "_blank");
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
  onProgress?: (stage: string, percent: number, message: string, logs?: string[]) => void,
): Promise<RestoreResult> {
  return new Promise((resolve, reject) => {
    let consecutiveErrors = 0;
    const MAX_ERRORS = 5;
    const poll = setInterval(async () => {
      try {
        const res = await client.get(`/settings/backup/restore-progress/${jobId}`, { timeout: 15000 });
        consecutiveErrors = 0;
        const d = (res.data as any)?.data ?? res.data;
        onProgress?.(d.stage, d.percent, d.message, d.logs);
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
  onServerProgress?: (stage: string, percent: number, message: string, logs?: string[]) => void,
  onJobId?: (jobId: string) => void,
): Promise<BackupRecord> {
  let jobId: string;
  if (mode === "chunked" && file.size >= 100 * 1024 * 1024) {
    jobId = await chunkedSaveAsRecordJob(file, onUploadProgress);
  } else {
    jobId = await directSaveAsRecordJob(file, onUploadProgress);
  }
  // Expose jobId for persistence (page refresh resume)
  onJobId?.(jobId);
  // Poll until import-save job completes
  return pollImportSaveProgress(jobId, onServerProgress);
}

async function directSaveAsRecordJob(file: File, onUploadProgress?: (percent: number) => void): Promise<string> {
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
          const id = data?.data?.jobId ?? data?.jobId;
          if (id) resolve(id);
          else reject(new Error("导入响应异常"));
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

export async function pollImportSaveProgress(
  jobId: string,
  onProgress?: (stage: string, percent: number, message: string, logs?: string[]) => void,
): Promise<BackupRecord> {
  return new Promise((resolve, reject) => {
    let consecutiveErrors = 0;
    const poll = setInterval(async () => {
      try {
        const res = await client.get(`/settings/backup/import-save-progress/${jobId}`, { timeout: 15000 });
        consecutiveErrors = 0;
        const d = (res.data as any)?.data ?? res.data;
        onProgress?.(d.stage, d.percent, d.message, d.logs);
        if (d.stage === "done") {
          clearInterval(poll);
          resolve(d.result);
        } else if (d.stage === "error") {
          clearInterval(poll);
          reject(new Error(d.error || "保存备份失败"));
        }
      } catch (err: any) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          clearInterval(poll);
          reject(new Error(err.response?.data?.detail || err.message || "查询进度失败"));
        }
      }
    }, 2000);
  });
}

const BACKUP_CHUNK_SIZE = 10 * 1024 * 1024;

async function initChunkedUpload(file: File): Promise<string> {
  const totalChunks = Math.ceil(file.size / BACKUP_CHUNK_SIZE);
  const { data: initResp } = await client.post("/upload/init", {
    fileName: file.name,
    fileSize: file.size,
    totalChunks,
  });
  const initData = (initResp as any)?.data ?? initResp;
  const uploadId = initData.uploadId;
  if (!uploadId) throw new Error("初始化上传失败");
  return uploadId;
}

async function uploadFileInChunks(
  file: File,
  uploadId: string,
  onProgress?: (percent: number) => void,
) {
  const totalChunks = Math.ceil(file.size / BACKUP_CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * BACKUP_CHUNK_SIZE;
    const end = Math.min(start + BACKUP_CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    let retries = 3;
    while (retries > 0) {
      try {
        await client.put(`/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, chunk, {
          headers: { "Content-Type": "application/octet-stream" },
          timeout: 300000,
        });
        break;
      } catch (err: any) {
        retries--;
        if (retries === 0) {
          throw new Error(err.response?.data?.detail || `分块 ${i + 1}/${totalChunks} 上传失败`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    onProgress?.(Math.round(((i + 1) / totalChunks) * 100));
  }
}

async function completeChunkedUpload(uploadId: string): Promise<{ filePath: string }> {
  const { data: completeResp } = await client.post("/upload/complete", { uploadId });
  const completeData = (completeResp as any)?.data ?? completeResp;
  if (!completeData.filePath) throw new Error("合并文件失败");
  return completeData;
}

async function chunkedSaveAsRecordJob(file: File, onProgress?: (percent: number) => void): Promise<string> {
  const uploadId = await initChunkedUpload(file);
  await uploadFileInChunks(file, uploadId, onProgress);
  const { filePath } = await completeChunkedUpload(uploadId);

  const { data: saveResp } = await client.post("/settings/backup/import-save-chunked", { filePath, fileName: file.name });
  const saveData = (saveResp as any)?.data ?? saveResp;
  const jobId = saveData?.jobId;
  if (!jobId) throw new Error("启动保存任务失败");
  return jobId;
}

export async function importBackup(
  file: File,
  onUploadProgress?: (percent: number) => void,
): Promise<string> {
  const fileSize = file.size;

  // Small files (< 100MB): direct upload
  if (fileSize < 100 * 1024 * 1024) {
    return directUpload(file, onUploadProgress);
  }

  // Large files: chunked upload
  try {
    const uploadId = await initChunkedUpload(file);
    await uploadFileInChunks(file, uploadId, onUploadProgress);
    const { filePath } = await completeChunkedUpload(uploadId);

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

// ===== Server-local backup import =====

export interface ServerBackupFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export async function listServerBackupFiles(): Promise<ServerBackupFile[]> {
  const res = await client.get("/settings/backup/server-files");
  const data = (res.data as any)?.data ?? res.data;
  return Array.isArray(data) ? data : [];
}

export async function importBackupFromPath(serverPath: string): Promise<string> {
  const { data: resp } = await client.post("/settings/backup/import-path", { path: serverPath });
  const inner = (resp as any)?.data ?? resp;
  const jobId = inner?.jobId;
  if (!jobId) throw new Error("启动恢复失败");
  return jobId;
}

// ===== System Update =====

export async function getVersion(): Promise<string> {
  const res = await client.get("/settings/version", { timeout: 10000 });
  return unwrap<{ current: string }>(res).current || "unknown";
}

export interface UpdateCheckResult {
  current: string;
  remote: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  releaseNotes?: string;
}

export async function checkUpdate(): Promise<UpdateCheckResult> {
  const res = await client.get("/settings/update/check", { timeout: 30000 });
  return unwrap<UpdateCheckResult>(res);
}
