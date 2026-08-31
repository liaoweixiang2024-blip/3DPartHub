import { cancelPreparedBrowserDownload, downloadBrowserFile, prepareBrowserDownload } from '../lib/browserDownload';
import { BACKUP_CHUNK_SIZE_BYTES, BACKUP_DIRECT_UPLOAD_THRESHOLD_BYTES } from '../lib/uploadLimits';
import { getAccessToken } from '../stores';
import client from './client';
import { unwrapApiData, unwrapResponse } from './response';

const IMPORT_RESTORE_CONFIRM_VALUE = 'RESTORE_IMPORT';

export interface SystemSettings {
  require_login_download: boolean;
  require_login_browse: boolean;
  allow_register: boolean;
  daily_download_limit: number;
  show_watermark: boolean;
  watermark_text: string;
  watermark_image: string;
  site_title: string;
  site_browser_title: string;
  site_app_name: string;
  site_app_icon: string;
  site_app_desc: string;
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
  footer_copyright_follow_site_title: boolean;
  footer_icp_number: string;
  footer_police_number: string;
  model_detail_disclaimer: string;
  model_detail_copyright: string;
  model_detail_copyright_follow_site_title: boolean;
  legal_privacy_updated_at: string;
  legal_terms_updated_at: string;
  legal_privacy_sections: string;
  legal_terms_sections: string;
  announcement_enabled: boolean;
  announcement_text: string;
  announcement_type: string;
  announcement_color: string;
  maintenance_enabled: boolean;
  maintenance_auto_enabled: boolean;
  maintenance_auto_queue_threshold: number;
  maintenance_title: string;
  maintenance_message: string;
  conversion_worker_concurrency: number;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  smtp_secure: boolean;
  email_templates: string;
  interface_theme: string;
  mobile_interface_theme: string;
  user_interface_theme_enabled: boolean;
  home_desktop_list_loading_mode: string;
  home_mobile_list_loading_mode: string;
  ui_default_locale: string;
  ui_enabled_locales: string;
  ui_follow_browser_locale: boolean;
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
  // 3D Material — original (empty = no override)
  mat_original_color: string;
  mat_original_metalness: string | number;
  mat_original_roughness: string | number;
  mat_original_envMapIntensity: string | number;
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
  viewer_default_preset: string;
  viewer_visible_presets: string;
  viewer_edge_enabled: boolean;
  viewer_edge_threshold_angle: number;
  viewer_edge_vertex_limit: number;
  viewer_edge_color: string;
  viewer_edge_opacity: number;
  viewer_edge_width: number;
  viewer_measure_default_unit: string;
  viewer_measure_record_limit: number;
  // Account security
  security_email_code_cooldown_seconds: number;
  security_email_code_ttl_seconds: number;
  security_captcha_ttl_seconds: number;
  security_password_min_length: number;
  security_username_min_length: number;
  security_username_max_length: number;
  // Share policy
  share_default_expire_days: number;
  share_max_expire_days: number;
  share_default_download_limit: number;
  share_max_download_limit: number;
  share_allow_password: boolean;
  share_allow_custom_expiry: boolean;
  share_allow_preview: boolean;
  // Feature toggles
  feature_selection_enabled: boolean;
  feature_inquiry_enabled: boolean;
  feature_product_wall_enabled: boolean;
  feature_tickets_enabled: boolean;
  feature_favorites_enabled: boolean;
  feature_shares_enabled: boolean;
  feature_downloads_enabled: boolean;
  feature_password_reset_enabled: boolean;
  feature_temp_viewer_enabled: boolean;
  require_invite_code: boolean;
  invite_max_active_per_user: number;
  // Selection wizard
  selection_page_title: string;
  selection_page_desc: string;
  selection_enable_match: boolean;
  selection_thread_priority: string;
  // Business dictionaries and policies
  inquiry_statuses: string;
  ticket_statuses: string;
  ticket_classifications: string;
  support_process_steps: string;
  nav_user_items: string;
  nav_admin_items: string;
  nav_items: string;
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
  // Product wall upload limits
  product_wall_max_image_mb: number;
  product_wall_max_batch_count: number;
  product_wall_max_zip_extract: number;
  // Cache and object storage
  cache_driver: string;
  cache_enabled: boolean;
  redis_url: string;
  redis_password: string;
  redis_db: number;
  redis_key_prefix: string;
  redis_tls_enabled: boolean;
  cache_public_settings_ttl_seconds: number;
  cache_model_list_ttl_seconds: number;
  cache_model_detail_ttl_seconds: number;
  cache_search_ttl_seconds: number;
  cache_selection_ttl_seconds: number;
  cache_static_asset_max_age_days: number;
  storage_provider: string;
  storage_endpoint: string;
  storage_region: string;
  storage_bucket: string;
  storage_access_key_id: string;
  storage_access_key_secret: string;
  storage_use_ssl: boolean;
  storage_force_path_style: boolean;
  storage_public_base_url: string;
  storage_cdn_base_url: string;
  storage_image_prefix: string;
  storage_thumbnail_prefix: string;
  storage_model_prefix: string;
  storage_original_prefix: string;
  storage_drawing_prefix: string;
  storage_product_wall_prefix: string;
  storage_attachment_prefix: string;
  storage_backup_prefix: string;
  storage_temp_prefix: string;
  storage_signed_url_enabled: boolean;
  storage_signed_url_ttl_seconds: number;
  storage_upload_multipart_mb: number;
  storage_upload_concurrency: number;
  storage_sync_enabled: boolean;
  storage_sync_delete_extra_enabled: boolean;
  image_cdn_enabled: boolean;
  image_optimize_enabled: boolean;
  image_webp_enabled: boolean;
  image_thumbnail_quality: number;
  image_large_max_width: number;
  image_cache_max_age_days: number;
  resource_cdn_enabled: boolean;
  resource_cache_max_age_days: number;
  resource_download_acceleration_enabled: boolean;
  // Download token TTL
  download_token_ttl_minutes: number;
  // Ticket attachment limits
  ticket_attachment_max_mb: number;
  ticket_attachment_types: string;
  // API rate limiting
  api_rate_limit: number;
  // Login dialog
  auth_modal_enabled: boolean;
  login_dialog_enabled: boolean;
  login_dialog_favorites: boolean;
  login_dialog_downloads: boolean;
  login_dialog_my_shares: boolean;
  login_dialog_profile: boolean;
  login_dialog_support: boolean;
  login_dialog_my_tickets: boolean;
  login_dialog_my_inquiries: boolean;
  login_dialog_projects: boolean;
}

export interface BackupStats {
  modelCount: number;
  thumbnailCount: number;
  dbSize: string;
  dbSizeBytes?: number;
  totalModelCount?: number;
  modelGroupCount?: number;
  categoryCount?: number;
  originalFileCount?: number;
  drawingFileCount?: number;
  modelResourceFileCount?: number;
  modelResourceSize?: number;
  modelResourceSizeText?: string;
  selectionCategoryCount?: number;
  selectionProductCount?: number;
  threadSizeCount?: number;
  selectionResourceFileCount?: number;
  selectionResourceSize?: number;
  selectionResourceSizeText?: string;
  productWallCategoryCount?: number;
  productWallImageCount?: number;
  settingsCount?: number;
  userCount?: number;
  ticketCount?: number;
  ticketMessageCount?: number;
  ticketAttachmentFileCount?: number;
  inquiryCount?: number;
  inquiryItemCount?: number;
  inquiryMessageCount?: number;
  inquiryAttachmentFileCount?: number;
  auditLogCount?: number;
  productWallResourceFileCount?: number;
  productWallResourceSize?: number;
  productWallResourceSizeText?: string;
  uploadResourceFileCount?: number;
  uploadResourceSize?: number;
  uploadResourceSizeText?: string;
  resourceFileCount?: number;
  resourceSize?: number;
  resourceSizeText?: string;
  totalDataSize?: number;
  totalDataSizeText?: string;
}

export interface MaintenanceStatus {
  enabled: boolean;
  manual: boolean;
  automatic: boolean;
  pending: number;
  threshold: number;
  title: string;
  message: string;
}

export interface SettingsConnectivityResult {
  ok: boolean;
  status: 'success' | 'warning' | 'error';
  message: string;
  details: string[];
  provider?: string;
  latencyMs?: number;
}

export type StorageSyncDirection = 'local_to_cloud' | 'cloud_to_local';
export type StorageSyncStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'error';

export interface StorageSyncScope {
  key: string;
  label: string;
  settingKey: string;
  prefix: string;
}

export interface StorageSyncJob {
  id: string;
  direction: StorageSyncDirection;
  status: StorageSyncStatus;
  stage: string;
  percent: number;
  message: string;
  logs: string[];
  startedAt: string;
  finishedAt?: string;
  currentKey?: string;
  totalFiles: number;
  processedFiles: number;
  copiedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  deletedFiles: number;
  totalBytes: number;
  processedBytes: number;
  totalBytesText: string;
  processedBytesText: string;
  scopes: StorageSyncScope[];
  overwrite: boolean;
  deleteExtraneous: boolean;
  error?: string;
}

export interface StorageSyncStatusPayload {
  active: StorageSyncJob | null;
  latest: StorageSyncJob | null;
  jobs: StorageSyncJob[];
  scopes: StorageSyncScope[];
}

export interface BackupRecord {
  id: string;
  filename: string;
  filePath?: string;
  name: string;
  scope?: BackupScope;
  scopeLabel?: string;
  createdAt: string;
  fileSize: number;
  fileSizeText: string;
  modelCount: number;
  thumbnailCount: number;
  /** 模块备份：记录条数（存量记录无此字段，回退 modelCount） */
  itemCount?: number;
  /** 模块备份：资源文件数（存量记录无此字段，回退 thumbnailCount） */
  fileCount?: number;
  dbSize: string;
  archiveSha256?: string;
  archiveSignature?: string;
  encrypted?: boolean;
  encryptionAlgorithm?: string;
  manifestVersion?: string;
  verifiedAt?: string;
}

export interface BackupEncryptionStatus {
  enabled: boolean;
  algorithm: string;
  configuredBy: 'BACKUP_ENCRYPTION_SECRET' | 'BACKUP_ENCRYPTION_KEY' | null;
  recommendedEnvName: 'BACKUP_ENCRYPTION_SECRET';
  legacyEnvName: 'BACKUP_ENCRYPTION_KEY';
}

export interface BackupHealth {
  enabled: boolean;
  scheduleTime: string;
  retentionCount: number;
  mirrorEnabled: boolean;
  mirrorDir?: string;
  status: 'ok' | 'warning' | 'disabled' | 'empty';
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
  encryption?: BackupEncryptionStatus;
}

export interface BackupPolicyCheckItem {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
}

export interface BackupPolicyReportFinding {
  key: string;
  label: string;
  message: string;
}

export interface BackupPolicyReport {
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
  blockers: BackupPolicyReportFinding[];
  warnings: BackupPolicyReportFinding[];
  nextActions: string[];
}

export interface BackupPolicyCheck {
  status: 'ok' | 'warning' | 'error';
  checkedAt: string;
  estimatedBackupSize: number;
  estimatedBackupSizeText: string;
  checks: BackupPolicyCheckItem[];
  report?: BackupPolicyReport;
}

export interface BackupVerificationResult {
  id: string;
  ok: boolean;
  checkedAt: string;
  fileSize: number;
  fileSizeText: string;
  manifestVersion?: string;
  archiveSha256?: string;
  archiveSignature?: string;
  encrypted?: boolean;
  encryptionAlgorithm?: string;
  message: string;
}

export interface RestoreResult {
  dbRestored: boolean;
  modelCount: number;
  thumbnailCount: number;
  scope?: BackupScope;
  scopeLabel?: string;
  itemCount?: number;
  fileCount?: number;
}

export type BackupScope =
  | 'full'
  | 'models'
  | 'selection'
  | 'product_wall'
  | 'config'
  | 'users'
  | 'tickets'
  | 'inquiries'
  | 'audit';

type HttpError = Error & {
  response?: {
    status?: number;
    data?: unknown;
  };
};

interface JobStartResult {
  jobId?: string;
}

interface ProgressPayload<T = unknown> {
  stage?: string;
  percent?: number;
  message?: string;
  logs?: string[];
  error?: string;
  scope?: BackupScope;
  result?: T;
  /** 备份任务：归档已加密落盘（done 阶段置位） */
  encrypted?: boolean;
  /** 恢复任务：用户已手动取消（与失败区分） */
  cancelled?: boolean;
  /** 恢复任务：已进入数据库 schema 重置，禁止取消 */
  destructiveStarted?: boolean;
}

export interface ActiveBackupJob extends ProgressPayload {
  id: string;
}

export interface ActiveRestoreJob extends ProgressPayload<RestoreResult> {
  id: string;
}

export interface ActiveImportSaveJob extends ProgressPayload<BackupRecord> {
  id: string;
}

export interface ActiveVerifyBackupJob extends ProgressPayload<BackupVerificationResult> {
  id: string;
  backupId: string;
}

function asHttpError(error: unknown): HttpError {
  return error instanceof Error ? (error as HttpError) : (new Error(String(error)) as HttpError);
}

function getResponseMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as {
    detail?: unknown;
    message?: unknown;
    data?: { detail?: unknown; message?: unknown };
  };
  return [data.detail, data.message, data.data?.detail, data.data?.message].find(
    (message): message is string => typeof message === 'string' && message.length > 0,
  );
}

export async function getSettings(): Promise<SystemSettings> {
  const res = await client.get('/settings');
  return unwrapResponse<SystemSettings>(res);
}

export async function updateSettings(data: Partial<SystemSettings>): Promise<SystemSettings> {
  const res = await client.put('/settings', data);
  return unwrapResponse<SystemSettings>(res);
}

export async function getSettingDefaults(keys: string[]): Promise<Record<string, unknown>> {
  const res = await client.post('/settings/defaults', { keys });
  return unwrapResponse<Record<string, unknown>>(res);
}

export async function sendTestEmail(to: string, templateKey = 'smtp_test'): Promise<{ message: string }> {
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
  const res = await client.post('/settings/email/test', { to, siteUrl, templateKey }, { timeout: 30000 });
  return unwrapResponse<{ message: string }>(res);
}

export async function testCacheSettings(): Promise<SettingsConnectivityResult> {
  try {
    const res = await client.post('/settings/cache/test', {}, { timeout: 15000 });
    return unwrapResponse<SettingsConnectivityResult>(res);
  } catch (err: unknown) {
    const payload = (err as { response?: { data?: unknown } })?.response?.data;
    if (payload && typeof payload === 'object' && 'ok' in payload) return payload as SettingsConnectivityResult;
    throw err;
  }
}

export async function testStorageSettings(): Promise<SettingsConnectivityResult> {
  try {
    const res = await client.post('/settings/storage/test', {}, { timeout: 30000 });
    return unwrapResponse<SettingsConnectivityResult>(res);
  } catch (err: unknown) {
    const payload = (err as { response?: { data?: unknown } })?.response?.data;
    if (payload && typeof payload === 'object' && 'ok' in payload) return payload as SettingsConnectivityResult;
    throw err;
  }
}

export async function getStorageSyncStatus(): Promise<StorageSyncStatusPayload> {
  const res = await client.get('/settings/storage/sync');
  return unwrapResponse<StorageSyncStatusPayload>(res);
}

export async function getStorageSyncJob(id: string): Promise<StorageSyncJob> {
  const res = await client.get(`/settings/storage/sync/${id}`);
  return unwrapResponse<StorageSyncJob>(res);
}

export async function startStorageSyncJob(data: {
  direction: StorageSyncDirection;
  scopes?: string[];
  overwrite?: boolean;
  deleteExtraneous?: boolean;
}): Promise<StorageSyncJob> {
  const res = await client.post('/settings/storage/sync', data, { timeout: 30000 });
  return unwrapResponse<StorageSyncJob>(res);
}

export async function cancelStorageSyncJob(id: string): Promise<StorageSyncJob> {
  const res = await client.post(`/settings/storage/sync/${id}/cancel`);
  return unwrapResponse<StorageSyncJob>(res);
}

export async function deleteStorageSyncJob(id: string): Promise<void> {
  await client.delete(`/settings/storage/sync/${id}`);
}

export async function getPublicSettings(): Promise<Partial<SystemSettings>> {
  const res = await client.get('/settings/public');
  return unwrapResponse<Partial<SystemSettings>>(res);
}

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const res = await client.get('/settings/maintenance-status');
  return unwrapResponse<MaintenanceStatus>(res);
}

export async function uploadImage(file: File, key: string): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await client.post(`/settings/upload-image?key=${encodeURIComponent(key)}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return unwrapResponse<{ url: string }>(res);
}

export async function getBackupStats(): Promise<BackupStats> {
  const res = await client.get('/settings/backup/stats');
  return unwrapResponse<BackupStats>(res);
}

export async function getBackupHealth(): Promise<BackupHealth> {
  const res = await client.get('/settings/backup/health');
  return unwrapResponse<BackupHealth>(res);
}

export async function checkBackupPolicy(): Promise<BackupPolicyCheck> {
  const res = await client.post('/settings/backup/check', {}, { timeout: 120000 });
  return unwrapResponse<BackupPolicyCheck>(res);
}

export async function startVerifyBackupJob(id: string): Promise<string> {
  const res = await client.post(`/settings/backup/verify/${id}`, {}, { timeout: 120000 });
  const data = unwrapResponse<JobStartResult>(res);
  const jobId = data.jobId;
  if (!jobId) throw new Error('启动备份校验失败');
  return jobId;
}

export async function pollVerifyBackupProgress(
  jobId: string,
  onProgress?: (stage: string, percent: number, message: string, logs?: string[]) => void,
  signal?: AbortSignal,
): Promise<BackupVerificationResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let consecutiveErrors = 0;
    let lastStage = 'validating_archive';
    let lastPercent = 0;
    let lastLogs: string[] = [];
    const MAX_ERRORS = 240;
    const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
    const poll = setInterval(async () => {
      if (signal?.aborted) {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      try {
        const res = await client.get(`/settings/backup/verify-progress/${jobId}`, { timeout: 15000, signal });
        consecutiveErrors = 0;
        const d = unwrapResponse<ProgressPayload<BackupVerificationResult>>(res);
        lastStage = d.stage || lastStage;
        lastPercent = Number.isFinite(Number(d.percent)) ? Number(d.percent) : lastPercent;
        lastLogs = Array.isArray(d.logs) ? d.logs : lastLogs;
        onProgress?.(d.stage || lastStage, d.percent ?? lastPercent, d.message || '', d.logs);
        if (d.stage === 'done') {
          clearInterval(poll);
          if (d.result) resolve(d.result);
          else reject(new Error('备份校验结果异常'));
        } else if (d.stage === 'error') {
          clearInterval(poll);
          reject(new Error(d.error || '备份校验失败'));
        }
      } catch (err: unknown) {
        if (signal?.aborted) {
          clearInterval(poll);
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const httpError = asHttpError(err);
        consecutiveErrors++;
        const status = httpError.response?.status;
        if (status === 404) {
          clearInterval(poll);
          reject(new Error('校验任务不存在，服务器可能已重启'));
          return;
        }
        const retryable = !status || RETRYABLE_STATUSES.has(status);
        if (retryable) {
          onProgress?.(lastStage, lastPercent, '后台正在校验或服务正在重连，任务会继续等待...', lastLogs);
        } else {
          clearInterval(poll);
          reject(new Error(getResponseMessage(httpError.response?.data) || httpError.message || '查询校验进度失败'));
          return;
        }
        if (consecutiveErrors >= MAX_ERRORS) {
          clearInterval(poll);
          reject(new Error('校验仍在后台执行，但进度接口暂时无法连接；请稍后刷新页面确认结果'));
        }
      }
    }, 1500);
    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export async function listBackups(): Promise<BackupRecord[]> {
  const res = await client.get('/settings/backup/list');
  return unwrapResponse<BackupRecord[]>(res);
}

export async function getActiveBackupJob(): Promise<ActiveBackupJob | null> {
  const res = await client.get('/settings/backup/active');
  return unwrapResponse<ActiveBackupJob | null>(res);
}

export async function getActiveRestoreJob(): Promise<ActiveRestoreJob | null> {
  const res = await client.get('/settings/backup/restore-active');
  return unwrapResponse<ActiveRestoreJob | null>(res);
}

export async function getActiveImportSaveJob(): Promise<ActiveImportSaveJob | null> {
  const res = await client.get('/settings/backup/import-save-active');
  return unwrapResponse<ActiveImportSaveJob | null>(res);
}

export async function getActiveVerifyBackupJob(): Promise<ActiveVerifyBackupJob | null> {
  const res = await client.get('/settings/backup/verify-active');
  return unwrapResponse<ActiveVerifyBackupJob | null>(res);
}

export async function startBackupJob(scope: BackupScope = 'full'): Promise<string> {
  try {
    const res = await client.post('/settings/backup/create', { scope }, { timeout: 30000 });
    const data = unwrapResponse<JobStartResult>(res);
    const jobId = data.jobId;
    if (!jobId) throw new Error('启动备份失败');
    return jobId;
  } catch (err: unknown) {
    const httpError = asHttpError(err);
    const responseData = httpError.response?.data;
    const responseJob = unwrapApiData<JobStartResult>(responseData);
    const message = getResponseMessage(responseData);
    if (httpError.response?.status === 409) {
      const conflictError = new Error(message || '已有备份、恢复或校验任务正在进行中，请等待完成后再试');
      (conflictError as Error & { jobId?: string }).jobId = responseJob.jobId;
      throw conflictError;
    }
    throw new Error(message || httpError.message || '启动备份失败');
  }
}

export async function pollBackupProgress(
  jobId: string,
  onProgress?: (stage: string, percent: number, message: string, logs?: string[]) => void,
  signal?: AbortSignal,
): Promise<{ jobId: string; encrypted: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let consecutiveErrors = 0;
    let lastStage = 'packing';
    let lastPercent = 0;
    let lastLogs: string[] = [];
    const MAX_ERRORS = 240; // 6 minutes at the current 1.5s polling interval
    const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
    const poll = setInterval(async () => {
      if (signal?.aborted) {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      try {
        const res = await client.get(`/settings/backup/progress/${jobId}`, { timeout: 15000, signal });
        consecutiveErrors = 0;
        const d = unwrapResponse<ProgressPayload>(res);
        lastStage = d.stage || lastStage;
        lastPercent = Number.isFinite(Number(d.percent)) ? Number(d.percent) : lastPercent;
        lastLogs = Array.isArray(d.logs) ? d.logs : lastLogs;
        onProgress?.(d.stage || lastStage, d.percent ?? lastPercent, d.message || '', d.logs);
        if (d.stage === 'done') {
          clearInterval(poll);
          resolve({ jobId, encrypted: Boolean(d.encrypted) });
        } else if (d.stage === 'error') {
          clearInterval(poll);
          reject(new Error(d.error || '备份失败'));
        }
      } catch (err: unknown) {
        if (signal?.aborted) {
          clearInterval(poll);
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const httpError = asHttpError(err);
        consecutiveErrors++;
        const status = httpError.response?.status;
        // Job not found — server restarted or job expired
        if (status === 404) {
          clearInterval(poll);
          reject(new Error('备份任务不存在，服务器可能已重启'));
          return;
        }
        const retryable = !status || RETRYABLE_STATUSES.has(status);
        if (retryable) {
          onProgress?.(lastStage, lastPercent, '后台正在打包或服务正在重连，备份任务会继续等待...', lastLogs);
        } else {
          clearInterval(poll);
          const message = getResponseMessage(httpError.response?.data);
          reject(new Error(message || httpError.message || '查询备份进度失败'));
          return;
        }
        // Transient network errors — keep the workbench informative and wait longer
        if (consecutiveErrors >= MAX_ERRORS) {
          clearInterval(poll);
          reject(new Error('备份仍在后台执行，但进度接口暂时无法连接；请稍后刷新备份列表确认结果'));
        }
        // Otherwise silently retry on next interval
      }
    }, 1500);
    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export async function downloadBackup(id: string): Promise<void> {
  // Get a short-lived one-time download token, then open download
  const preparedWindow = prepareBrowserDownload();
  try {
    const { data: resp } = await client.post(`/settings/backup/download-token/${id}`);
    const created = unwrapApiData<{ token?: string; url?: string }>(resp);
    const url =
      created.url ||
      (created.token
        ? `/api/settings/backup/download/${encodeURIComponent(id)}/${encodeURIComponent(created.token)}`
        : '');
    if (!url) throw new Error('获取下载令牌失败');
    await downloadBrowserFile(url, { preparedWindow });
  } catch (error) {
    cancelPreparedBrowserDownload(preparedWindow);
    throw error;
  }
}

export async function renameBackup(id: string, name: string): Promise<BackupRecord> {
  const res = await client.put(`/settings/backup/rename/${id}`, { name });
  return unwrapResponse<BackupRecord>(res);
}

export async function deleteBackup(id: string): Promise<void> {
  await client.delete(`/settings/backup/delete/${id}`, { data: { confirm: id } });
}

export async function startRestore(id: string, force = false): Promise<string> {
  const res = await client.post(`/settings/backup/restore/${id}`, { confirm: id, force }, { timeout: 30000 });
  const data = unwrapResponse<JobStartResult>(res);
  const jobId = data.jobId;
  if (!jobId) throw new Error('启动恢复失败');
  return jobId;
}

export async function pollRestoreProgress(
  jobId: string,
  onProgress?: (
    stage: string,
    percent: number,
    message: string,
    logs?: string[],
    meta?: { cancelled?: boolean; destructiveStarted?: boolean },
  ) => void,
  signal?: AbortSignal,
): Promise<RestoreResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let consecutiveErrors = 0;
    let lastStage = 'extracting';
    let lastPercent = 0;
    let lastLogs: string[] = [];
    let lastCancelled = false;
    let lastDestructive = false;
    const MAX_ERRORS = 240;
    const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
    const poll = setInterval(async () => {
      if (signal?.aborted) {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      try {
        const res = await client.get(`/settings/backup/restore-progress/${jobId}`, { timeout: 15000, signal });
        consecutiveErrors = 0;
        const d = unwrapResponse<ProgressPayload<RestoreResult>>(res);
        lastStage = d.stage || lastStage;
        lastPercent = Number.isFinite(Number(d.percent)) ? Number(d.percent) : lastPercent;
        lastLogs = Array.isArray(d.logs) ? d.logs : lastLogs;
        lastCancelled = !!d.cancelled;
        lastDestructive = !!d.destructiveStarted;
        onProgress?.(d.stage || '', d.percent ?? 0, d.message || '', d.logs, {
          cancelled: lastCancelled,
          destructiveStarted: lastDestructive,
        });
        if (d.stage === 'done') {
          clearInterval(poll);
          resolve(d.result ?? { dbRestored: true, modelCount: 0, thumbnailCount: 0 });
        } else if (d.stage === 'error') {
          clearInterval(poll);
          reject(new Error(d.cancelled ? '恢复已取消' : d.error || '恢复失败'));
        }
      } catch (err: unknown) {
        if (signal?.aborted) {
          clearInterval(poll);
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const httpError = asHttpError(err);
        consecutiveErrors++;
        const status = httpError.response?.status;
        if (status === 404) {
          clearInterval(poll);
          reject(new Error('恢复任务不存在，服务器可能已重启'));
          return;
        }
        const retryable = !status || RETRYABLE_STATUSES.has(status);
        if (retryable) {
          onProgress?.(lastStage, lastPercent, '后台正在恢复或服务正在重连，任务会继续等待...', lastLogs, {
            cancelled: lastCancelled,
            destructiveStarted: lastDestructive,
          });
        } else {
          clearInterval(poll);
          reject(new Error(getResponseMessage(httpError.response?.data) || httpError.message || '查询恢复进度失败'));
          return;
        }
        if (consecutiveErrors >= MAX_ERRORS) {
          clearInterval(poll);
          reject(new Error('恢复仍在后台执行，但进度接口暂时无法连接；请稍后刷新页面确认结果'));
        }
      }
    }, 1500);
    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export async function cancelRestore(jobId: string): Promise<{ cancelled: boolean; message: string }> {
  const res = await client.post(`/settings/backup/restore/cancel/${jobId}`, {}, { timeout: 30000 });
  return unwrapResponse<{ cancelled: boolean; message: string }>(res);
}

export async function importBackupAsRecord(
  file: File,
  mode: 'direct' | 'chunked',
  onUploadProgress?: (percent: number) => void,
  onServerProgress?: (stage: string, percent: number, message: string, logs?: string[]) => void,
  onJobId?: (jobId: string) => void,
): Promise<BackupRecord> {
  let jobId: string;
  if (mode === 'chunked' && file.size >= BACKUP_DIRECT_UPLOAD_THRESHOLD_BYTES) {
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
    xhr.open('POST', '/api/settings/backup/import-save');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onUploadProgress) {
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const id = unwrapApiData<JobStartResult>(data).jobId;
          if (id) resolve(id);
          else reject(new Error('导入响应异常'));
        } catch {
          reject(new Error('解析响应失败'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || err.message || '保存失败'));
        } catch {
          reject(new Error(`保存失败 (${xhr.status})`));
        }
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    const formData = new FormData();
    formData.append('file', file);
    xhr.timeout = 7200000;
    xhr.send(formData);
  });
}

export async function pollImportSaveProgress(
  jobId: string,
  onProgress?: (stage: string, percent: number, message: string, logs?: string[]) => void,
  signal?: AbortSignal,
): Promise<BackupRecord> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let consecutiveErrors = 0;
    let lastStage = 'verifying_archive';
    let lastPercent = 0;
    let lastLogs: string[] = [];
    const MAX_ERRORS = 240;
    const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
    const poll = setInterval(async () => {
      if (signal?.aborted) {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      try {
        const res = await client.get(`/settings/backup/import-save-progress/${jobId}`, { timeout: 15000, signal });
        consecutiveErrors = 0;
        const d = unwrapResponse<ProgressPayload<BackupRecord>>(res);
        lastStage = d.stage || lastStage;
        lastPercent = Number.isFinite(Number(d.percent)) ? Number(d.percent) : lastPercent;
        lastLogs = Array.isArray(d.logs) ? d.logs : lastLogs;
        onProgress?.(d.stage || '', d.percent ?? 0, d.message || '', d.logs);
        if (d.stage === 'done') {
          clearInterval(poll);
          if (d.result) resolve(d.result);
          else reject(new Error('保存备份失败'));
        } else if (d.stage === 'error') {
          clearInterval(poll);
          reject(new Error(d.error || '保存备份失败'));
        }
      } catch (err: unknown) {
        if (signal?.aborted) {
          clearInterval(poll);
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const httpError = asHttpError(err);
        consecutiveErrors++;
        const status = httpError.response?.status;
        if (status === 404) {
          clearInterval(poll);
          reject(new Error('导入保存任务不存在，服务器可能已重启'));
          return;
        }
        const retryable = !status || RETRYABLE_STATUSES.has(status);
        if (retryable) {
          onProgress?.(lastStage, lastPercent, '后台正在导入或服务正在重连，任务会继续等待...', lastLogs);
        } else {
          clearInterval(poll);
          reject(new Error(getResponseMessage(httpError.response?.data) || httpError.message || '查询导入进度失败'));
          return;
        }
        if (consecutiveErrors >= MAX_ERRORS) {
          clearInterval(poll);
          reject(new Error('导入保存仍在后台执行，但进度接口暂时无法连接；请稍后刷新页面确认结果'));
        }
      }
    }, 2000);
    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function initChunkedUpload(file: File): Promise<string> {
  const totalChunks = Math.ceil(file.size / BACKUP_CHUNK_SIZE_BYTES);
  const { data: initResp } = await client.post('/upload/init', {
    fileName: file.name,
    fileSize: file.size,
    totalChunks,
    purpose: 'backup',
  });
  const initData = unwrapApiData<{ uploadId?: string }>(initResp);
  const uploadId = initData.uploadId;
  if (!uploadId) throw new Error('初始化上传失败');
  return uploadId;
}

/** 会话已上传的分片索引（会话过期/不属于当前用户返回 null） */
async function queryUploadedChunks(
  uploadId: string,
): Promise<{ uploadedIndexes: number[]; totalChunks: number } | null> {
  try {
    const { data } = await client.get(`/upload/status`, { params: { uploadId }, timeout: 15000 });
    const d = unwrapApiData<{ uploadedIndexes?: number[]; totalChunks?: number }>(data);
    if (!Array.isArray(d.uploadedIndexes) || !Number.isFinite(Number(d.totalChunks))) return null;
    return { uploadedIndexes: d.uploadedIndexes, totalChunks: Number(d.totalChunks) };
  } catch {
    return null;
  }
}

async function uploadFileInChunks(
  file: File,
  uploadId: string,
  onProgress?: (percent: number) => void,
  skipIndexes?: Set<number>,
) {
  const totalChunks = Math.ceil(file.size / BACKUP_CHUNK_SIZE_BYTES);
  let done = skipIndexes ? countContiguousOrTotal(skipIndexes, totalChunks) : 0;
  if (skipIndexes && skipIndexes.size > 0) {
    onProgress?.(Math.round((done / totalChunks) * 100));
  }

  for (let i = 0; i < totalChunks; i++) {
    if (skipIndexes?.has(i)) continue;
    const start = i * BACKUP_CHUNK_SIZE_BYTES;
    const end = Math.min(start + BACKUP_CHUNK_SIZE_BYTES, file.size);
    const chunk = file.slice(start, end);

    let retries = 3;
    while (retries > 0) {
      try {
        await client.put(`/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, chunk, {
          headers: { 'Content-Type': 'application/octet-stream' },
          timeout: 300000,
        });
        break;
      } catch (err: unknown) {
        const httpError = asHttpError(err);
        retries--;
        if (retries === 0) {
          throw new Error(getResponseMessage(httpError.response?.data) || `分块 ${i + 1}/${totalChunks} 上传失败`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    done += 1;
    onProgress?.(Math.round((done / totalChunks) * 100));
  }
}

function countContiguousOrTotal(uploaded: Set<number>, totalChunks: number): number {
  let count = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (uploaded.has(i)) count += 1;
    else break;
  }
  return count;
}

async function completeChunkedUpload(uploadId: string): Promise<{ filePath: string }> {
  const { data: completeResp } = await client.post('/upload/complete', { uploadId });
  const completeData = unwrapApiData<{ filePath?: string }>(completeResp);
  if (!completeData.filePath) throw new Error('合并文件失败');
  return { filePath: completeData.filePath };
}

async function chunkedSaveAsRecordJob(file: File, onProgress?: (percent: number) => void): Promise<string> {
  const filePath = await uploadChunkedWithResume(file, onProgress);

  const { data: saveResp } = await client.post('/settings/backup/import-save-chunked', {
    filePath,
    fileName: file.name,
  });
  const saveData = unwrapApiData<JobStartResult>(saveResp);
  const jobId = saveData?.jobId;
  if (!jobId) throw new Error('启动保存任务失败');
  return jobId;
}

/** 分块上传断点续传的本地持久化（uploadId + 文件指纹），页面刷新后可续传 */
const CHUNKED_UPLOAD_RESUME_KEY = 'backupChunkedUploadResume';

type ChunkedUploadResume = {
  uploadId: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
};

function fileFingerprintMatches(saved: ChunkedUploadResume, file: File): boolean {
  return saved.fileName === file.name && saved.fileSize === file.size && saved.lastModified === file.lastModified;
}

function readChunkedUploadResume(): ChunkedUploadResume | null {
  try {
    const raw = localStorage.getItem(CHUNKED_UPLOAD_RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChunkedUploadResume;
    return typeof parsed.uploadId === 'string' && Number.isFinite(parsed.fileSize) ? parsed : null;
  } catch {
    return null;
  }
}

function writeChunkedUploadResume(file: File, uploadId: string) {
  try {
    localStorage.setItem(
      CHUNKED_UPLOAD_RESUME_KEY,
      JSON.stringify({ uploadId, fileName: file.name, fileSize: file.size, lastModified: file.lastModified }),
    );
  } catch {
    /* localStorage 满了/被禁用——续传能力降级为从头传，不影响功能 */
  }
}

function clearChunkedUploadResume() {
  try {
    localStorage.removeItem(CHUNKED_UPLOAD_RESUME_KEY);
  } catch {
    /* best-effort */
  }
}

/** 取可续传的分块会话：指纹匹配 + 服务端会话仍存活。返回 null 则重新初始化。 */
async function resumableChunkSession(
  file: File,
): Promise<{ uploadId: string; uploaded: Set<number>; resumed: boolean } | null> {
  const saved = readChunkedUploadResume();
  if (!saved || !fileFingerprintMatches(saved, file)) return null;
  const status = await queryUploadedChunks(saved.uploadId);
  if (!status || status.totalChunks !== Math.ceil(file.size / BACKUP_CHUNK_SIZE_BYTES)) return null;
  return {
    uploadId: saved.uploadId,
    uploaded: new Set(status.uploadedIndexes),
    resumed: status.uploadedIndexes.length > 0,
  };
}

/** 纯本地指纹检查（选文件时提示用，不发请求；实际上传时再向服务端确认会话存活） */
export function hasResumableChunkedUpload(file: File): boolean {
  const saved = readChunkedUploadResume();
  return Boolean(saved && fileFingerprintMatches(saved, file));
}

async function uploadChunkedWithResume(
  file: File,
  onProgress?: (percent: number) => void,
  onPhaseChange?: (phase: 'uploading' | 'merging' | 'starting') => void,
): Promise<string> {
  const resumedSession = await resumableChunkSession(file);
  let uploadId: string;
  let uploaded: Set<number> | undefined;
  if (resumedSession) {
    uploadId = resumedSession.uploadId;
    uploaded = resumedSession.uploaded;
  } else {
    uploadId = await initChunkedUpload(file);
    writeChunkedUploadResume(file, uploadId);
  }
  await uploadFileInChunks(file, uploadId, onProgress, uploaded);
  // 分块合并是服务端同步拼接整个文件，大备份可能数十秒到数分钟——
  // 先切阶段文案，避免上传 100% 后界面假死在合并等待上
  onPhaseChange?.('merging');
  const { filePath } = await completeChunkedUpload(uploadId);
  clearChunkedUploadResume();
  return filePath;
}

export async function importBackup(
  file: File,
  onUploadProgress?: (percent: number) => void,
  onPhaseChange?: (phase: 'uploading' | 'merging' | 'starting') => void,
): Promise<string> {
  const fileSize = file.size;

  // Small files: direct upload. Larger backups use the chunked flow.
  if (fileSize < BACKUP_DIRECT_UPLOAD_THRESHOLD_BYTES) {
    return directUpload(file, onUploadProgress);
  }

  // Large files: chunked upload
  try {
    const filePath = await uploadChunkedWithResume(file, onUploadProgress, onPhaseChange);

    // Start restore from merged file
    onPhaseChange?.('starting');
    const { data: restoreResp } = await client.post('/settings/backup/import-chunked', {
      filePath,
      confirm: IMPORT_RESTORE_CONFIRM_VALUE,
    });
    const restoreData = unwrapApiData<JobStartResult>(restoreResp);
    const jobId = restoreData.jobId;
    if (!jobId) throw new Error('启动恢复失败');

    return jobId;
  } catch (err: unknown) {
    const httpError = asHttpError(err);
    throw new Error(getResponseMessage(httpError.response?.data) || httpError.message || '分块上传失败');
  }
}

function directUpload(file: File, onProgress?: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/settings/backup/import');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const jobId = unwrapApiData<JobStartResult>(data).jobId;
          if (jobId) resolve(jobId);
          else reject(new Error('导入响应异常'));
        } catch {
          reject(new Error('解析响应失败'));
        }
      } else if (xhr.status === 401) {
        reject(new Error('登录已过期，请刷新页面后重试'));
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || err.message || '导入失败'));
        } catch {
          reject(new Error(`导入失败 (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('上传超时'));

    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('X-Danger-Confirm', IMPORT_RESTORE_CONFIRM_VALUE);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('confirm', IMPORT_RESTORE_CONFIRM_VALUE);
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
  const res = await client.get('/settings/backup/server-files');
  const data = unwrapResponse<ServerBackupFile[]>(res);
  return Array.isArray(data) ? data : [];
}

export async function importBackupFromPath(serverPath: string): Promise<string> {
  const { data: resp } = await client.post('/settings/backup/import-path', {
    path: serverPath,
    confirm: IMPORT_RESTORE_CONFIRM_VALUE,
  });
  const inner = unwrapApiData<JobStartResult>(resp);
  const jobId = inner?.jobId;
  if (!jobId) throw new Error('启动恢复失败');
  return jobId;
}

// ===== System Update =====

export async function getVersion(): Promise<string> {
  const res = await client.get('/settings/version', { timeout: 10000 });
  return unwrapResponse<{ current: string }>(res).current || 'unknown';
}

export interface UpdateCheckResult {
  current: string;
  remote: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  releaseNotes?: string;
}

export async function checkUpdate(): Promise<UpdateCheckResult> {
  const res = await client.get('/settings/update/check', { timeout: 30000 });
  return unwrapResponse<UpdateCheckResult>(res);
}

export interface UpdateHistoryEntry {
  version: string;
  title?: string;
  publishedAt?: string;
  releaseUrl: string;
  notes: string;
}

export async function getUpdateHistory(): Promise<UpdateHistoryEntry[]> {
  const res = await client.get('/settings/update/history', { timeout: 30000 });
  const data = unwrapResponse<{ entries: UpdateHistoryEntry[] }>(res);
  return data?.entries ?? [];
}

// 版本历史本地缓存（localStorage）：进「关于系统」页先秒开缓存内容，
// 服务端只在有新版本发布时才会重新拉全量（见 server/src/lib/update.ts），
// 拿到的结果本身变化极少，本地再缓存一层避免每次进页都发请求。
const UPDATE_HISTORY_STORAGE_KEY = 'update_history_cache';

export function readCachedUpdateHistory(): UpdateHistoryEntry[] {
  try {
    const raw = localStorage.getItem(UPDATE_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { entries?: UpdateHistoryEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export function writeCachedUpdateHistory(entries: UpdateHistoryEntry[]): void {
  try {
    localStorage.setItem(UPDATE_HISTORY_STORAGE_KEY, JSON.stringify({ entries, ts: Date.now() }));
  } catch {
    // 存储满/隐私模式写入失败可忽略
  }
}

// ===== Garbage Cleanup =====

export interface CleanupCategory {
  key: string;
  label: string;
  count: number;
  totalSize: number;
  totalSizeText: string;
  samplePaths: string[];
}

export interface CleanupScanResult {
  categories: CleanupCategory[];
  totalFiles: number;
  totalSize: number;
  totalSizeText: string;
}

export interface CleanupResult {
  deletedCount: number;
  freedBytes: number;
  freedSizeText: string;
  failedCount: number;
  errors?: string[];
}

export async function scanCleanup(): Promise<CleanupScanResult> {
  const res = await client.get('/settings/cleanup/scan', { timeout: 60000 });
  return unwrapResponse<CleanupScanResult>(res);
}

export async function executeCleanup(targets: string[]): Promise<CleanupResult> {
  const res = await client.post('/settings/cleanup/execute', { targets }, { timeout: 120000 });
  return unwrapResponse<CleanupResult>(res);
}
