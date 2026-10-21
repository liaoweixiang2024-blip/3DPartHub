import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { isSafeUrl } from '../lib/sanitizeHtml';
import { useLocation } from 'react-router-dom';
import { mutate as mutateSWR } from 'swr';
import {
  getSettings,
  updateSettings,
  uploadImage,
  sendTestEmail,
  testCacheSettings,
  testStorageSettings,
  getStorageSyncStatus,
  getStorageSyncJob,
  startStorageSyncJob,
  cancelStorageSyncJob,
  deleteStorageSyncJob,
  getBackupStats,
  getBackupHealth,
  checkBackupPolicy,
  startVerifyBackupJob,
  pollVerifyBackupProgress,
  getActiveBackupJob,
  getActiveRestoreJob,
  getActiveImportSaveJob,
  getActiveVerifyBackupJob,
  startBackupJob,
  pollBackupProgress,
  downloadBackup,
  renameBackup,
  deleteBackup,
  startRestore,
  pollRestoreProgress,
  cancelRestore,
  listBackups,
  importBackup,
  importBackupAsRecord,
  hasResumableChunkedUpload,
  pollImportSaveProgress,
  listServerBackupFiles,
  importBackupFromPath,
  fetchInterruptedRestores,
  recoverInterruptedRestore,
  clearLeftoverRestoreDirs,
  type ServerBackupFile,
  type InterruptedRestoreInfo,
  checkUpdate,
  getVersion,
  type SystemSettings,
  type BackupStats,
  type BackupRecord,
  type BackupScope,
  type BackupHealth,
  type BackupPolicyCheck,
  type SettingsConnectivityResult,
  type StorageSyncDirection,
  type StorageSyncJob,
  type StorageSyncScope,
  type StorageSyncStatusPayload,
  scanCleanup,
  executeCleanup,
  type CleanupScanResult,
  type CleanupCategory,
  getUpdateHistory,
  readCachedUpdateHistory,
  writeCachedUpdateHistory,
  type UpdateHistoryEntry,
  type UpdateHistoryStats,
} from '../api/settings';
import {
  ProductWallUploadRolesEditor,
  ProductWallUploadUsersEditor,
} from '../components/product-wall-admin/ProductWallUploadPermissionFields';
import BackupEncryptionNoticeDialog from '../components/settings/BackupEncryptionNoticeDialog';
import ColorSchemeEditor from '../components/settings/ColorSchemeSettings';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { AppSwitch } from '../components/shared/FormControls';
import Icon from '../components/shared/Icon';
import SelectMenu from '../components/shared/SelectMenu';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SafeImage from '../components/shared/SafeImage';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  BACKUP_SCOPE_OPTIONS,
  buildBackupProtectionCards,
  formatOptionalStatNumber,
  formatStatNumber,
  getBackupScopeLabel,
  getBackupStatusClasses,
  getBackupStatusIcon,
  getBackupStatusIconClass,
  toBackupProtectionStatus,
} from '../lib/backupStatus';
import {
  DEFAULT_INQUIRY_STATUSES,
  DEFAULT_ADMIN_NAV,
  DEFAULT_MOBILE_NAV,
  DEFAULT_NAV,
  DEFAULT_SUPPORT_STEPS,
  DEFAULT_THREAD_PRIORITY,
  DEFAULT_TICKET_CLASSIFICATIONS,
  DEFAULT_TICKET_STATUSES,
  DEFAULT_UPLOAD_POLICY,
  DEFAULT_USER_NAV,
  isAdminOnly,
  parseSetting,
  type NavItemConfig,
  type StatusConfig,
  type SupportStepConfig,
  type TicketClassificationConfig,
  type UploadPolicy,
} from '../lib/businessConfig';
import { copyText } from '../lib/clipboard';
import { DEFAULT_PRIVACY_SECTIONS, DEFAULT_TERMS_SECTIONS, type LegalSection } from '../lib/legalContent';
import {
  buildFooterCopyright,
  buildModelDetailCopyright,
  DEFAULT_FOOTER_COPYRIGHT,
  DEFAULT_MODEL_DETAIL_COPYRIGHT,
  DEFAULT_MODEL_DETAIL_DISCLAIMER,
  patchPublicSettings,
} from '../lib/publicSettings';
import { BACKUP_DIRECT_UPLOAD_THRESHOLD_BYTES } from '../lib/uploadLimits';
import {
  DEFAULT_INTERFACE_THEME,
  INTERFACE_THEME_CATALOG,
  INTERFACE_THEME_OPTIONS,
} from '../themes/interfaceThemes/catalog';
import { DEFAULT_MOBILE_THEME, MOBILE_THEME_OPTIONS } from '../themes/mobileThemes/catalog';
// Note: pollBackupProgress is used by handleExport

const RESTORE_JOB_SOURCE_KEY = 'restoreJobSource';
const PUBLIC_APPEARANCE_SETTING_KEYS = [
  'interface_theme',
  'mobile_interface_theme',
  'user_interface_theme_enabled',
  'home_desktop_list_loading_mode',
  'home_mobile_list_loading_mode',
  'ui_default_locale',
  'ui_enabled_locales',
  'ui_follow_browser_locale',
] as const satisfies readonly (keyof SystemSettings)[];
const CONTACT_PHONE_FORMAT_MESSAGE = 'adminSettings.contactPhoneInvalid';

const DEFAULT_SETTINGS: SystemSettings = {
  require_login_download: false,
  require_login_browse: false,
  require_login_selection: false,
  allow_register: true,
  require_invite_code: false,
  invite_max_active_per_user: 10,
  daily_download_limit: 0,
  show_watermark: false,
  watermark_text: '3DPartHub',
  watermark_image: '',
  site_title: '3DPartHub',
  site_browser_title: '',
  site_app_name: '',
  site_app_icon: '',
  site_app_desc: '',
  site_logo: '',
  site_icon: '',
  site_favicon: '/favicon.svg',
  site_logo_display: 'logo_and_title',
  site_description: '',
  site_keywords: '',
  contact_email: '',
  contact_phone: '',
  contact_address: '',
  footer_links: '',
  footer_copyright: DEFAULT_FOOTER_COPYRIGHT,
  footer_copyright_follow_site_title: true,
  footer_icp_number: '',
  footer_police_number: '',
  model_detail_disclaimer: DEFAULT_MODEL_DETAIL_DISCLAIMER,
  model_detail_copyright: DEFAULT_MODEL_DETAIL_COPYRIGHT,
  model_detail_copyright_follow_site_title: true,
  legal_privacy_updated_at: 'adminSettings.egApril2026',
  legal_terms_updated_at: 'adminSettings.egApril2026',
  legal_privacy_sections: JSON.stringify(DEFAULT_PRIVACY_SECTIONS, null, 2),
  legal_terms_sections: JSON.stringify(DEFAULT_TERMS_SECTIONS, null, 2),
  announcement_enabled: false,
  announcement_text: '',
  announcement_type: 'info',
  announcement_color: '',
  maintenance_enabled: false,
  maintenance_auto_enabled: true,
  maintenance_auto_queue_threshold: 50,
  maintenance_title: 'adminSettings.maintenanceTitleDefault',
  maintenance_message: 'adminSettings.maintenanceMessageDefault',
  conversion_worker_concurrency: 1,
  smtp_host: '',
  smtp_port: 465,
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  smtp_secure: true,
  email_templates: '',
  interface_theme: DEFAULT_INTERFACE_THEME,
  mobile_interface_theme: DEFAULT_MOBILE_THEME,
  user_interface_theme_enabled: true,
  home_desktop_list_loading_mode: 'pagination',
  home_mobile_list_loading_mode: 'infinite',
  ui_default_locale: 'zh-CN',
  ui_enabled_locales: 'zh-CN,zh-TW,en-US,ja-JP,ko-KR,de-DE',
  ui_follow_browser_locale: false,
  color_scheme: 'orange',
  color_custom_dark: '{}',
  color_custom_light: '{}',
  default_theme: 'light',
  auto_theme_enabled: false,
  auto_theme_dark_hour: 20,
  auto_theme_light_hour: 8,
  mat_default_color: '#c8cad0',
  mat_default_metalness: 0.5,
  mat_default_roughness: 0.25,
  mat_default_envMapIntensity: 1.5,
  mat_original_color: '#808080',
  mat_original_metalness: '',
  mat_original_roughness: '',
  mat_original_envMapIntensity: '',
  mat_metal_color: '#f0f0f4',
  mat_metal_metalness: 1.0,
  mat_metal_roughness: 0.05,
  mat_metal_envMapIntensity: 2.0,
  mat_plastic_color: '#4499ff',
  mat_plastic_metalness: 0.0,
  mat_plastic_roughness: 0.35,
  mat_plastic_envMapIntensity: 0.6,
  mat_glass_color: '#ffffff',
  mat_glass_metalness: 0.0,
  mat_glass_roughness: 0.0,
  mat_glass_envMapIntensity: 1.0,
  mat_glass_transmission: 0.95,
  mat_glass_ior: 1.5,
  mat_glass_thickness: 0.5,
  viewer_exposure: 1.4,
  viewer_ambient_intensity: 1.0,
  viewer_main_light_intensity: 2.0,
  viewer_fill_light_intensity: 0.8,
  viewer_hemisphere_intensity: 0.5,
  viewer_bg_color: '#ffffff',
  viewer_default_preset: 'original',
  viewer_visible_presets: 'original',
  viewer_edge_enabled: true,
  viewer_edge_threshold_angle: 28,
  viewer_edge_vertex_limit: 700000,
  viewer_edge_color: '#000000',
  viewer_edge_opacity: 0.25,
  viewer_edge_width: 1,
  viewer_measure_default_unit: 'auto',
  viewer_measure_record_limit: 12,
  security_email_code_cooldown_seconds: 60,
  security_email_code_ttl_seconds: 600,
  security_captcha_ttl_seconds: 300,
  security_password_min_length: 8,
  security_username_min_length: 2,
  security_username_max_length: 32,
  share_default_expire_days: 0,
  share_max_expire_days: 0,
  share_default_download_limit: 0,
  share_max_download_limit: 0,
  share_allow_password: true,
  share_allow_custom_expiry: true,
  share_allow_preview: true,
  feature_selection_enabled: true,
  feature_inquiry_enabled: true,
  feature_product_wall_enabled: true,
  feature_tickets_enabled: true,
  feature_favorites_enabled: true,
  feature_shares_enabled: true,
  feature_downloads_enabled: true,
  feature_password_reset_enabled: true,
  feature_temp_viewer_enabled: true,
  selection_page_title: 'adminSettings.featureSelection',
  selection_page_desc: 'adminSettings.selectionPageDescDefault',
  selection_enable_match: true,
  selection_thread_priority: JSON.stringify(DEFAULT_THREAD_PRIORITY, null, 2),
  // 选型导航：开关 + JSON 配置（真实默认在服务端；此处仅兜底空结构，管理在 /admin/category-nav）
  feature_category_nav_enabled: true,
  category_nav_config: JSON.stringify(
    { model: { groups: [], nodes: [] }, selection: { groups: [], nodes: [] } },
    null,
    2,
  ),
  inquiry_statuses: JSON.stringify(DEFAULT_INQUIRY_STATUSES, null, 2),
  ticket_statuses: JSON.stringify(DEFAULT_TICKET_STATUSES, null, 2),
  ticket_classifications: JSON.stringify(DEFAULT_TICKET_CLASSIFICATIONS, null, 2),
  support_process_steps: JSON.stringify(DEFAULT_SUPPORT_STEPS, null, 2),
  nav_items: JSON.stringify(DEFAULT_NAV, null, 2),
  nav_user_items: JSON.stringify(DEFAULT_USER_NAV, null, 2),
  nav_admin_items: JSON.stringify(DEFAULT_ADMIN_NAV, null, 2),
  nav_mobile_items: JSON.stringify(DEFAULT_MOBILE_NAV, null, 2),
  upload_policy: JSON.stringify(DEFAULT_UPLOAD_POLICY, null, 2),
  page_size_policy: JSON.stringify(
    {
      selectionDefault: 50,
      selectionMax: 50000,
      homeDefault: 20,
      homeMax: 10000,
      homeOption1: 20,
      homeOption2: 40,
      homeOption3: 60,
      homeOption4: 120,
      selectionAdminRenderBatch: 120,
      selectionGeneratePreviewPageSize: 50,
      inquiryAdminDefault: 20,
      inquiryAdminMax: 100,
      ticketListMax: 50,
      notificationDefault: 20,
      notificationMax: 100,
      adminUserDefault: 20,
      adminUserMax: 100,
      shareAdminDefault: 20,
      shareAdminMax: 100,
      auditDefault: 50,
      auditMax: 100,
      userBatchDownloadMax: 100,
      adminBatchDownloadMax: 50,
    },
    null,
    2,
  ),
  anti_proxy_enabled: false,
  allowed_hosts: '',
  hotlink_protection_enabled: false,
  allowed_referers: '',
  backup_auto_enabled: false,
  backup_schedule_time: '03:00',
  backup_retention_count: 7,
  backup_mirror_enabled: false,
  backup_mirror_dir: '',
  backup_last_mirror_status: '',
  backup_last_mirror_message: '',
  backup_last_mirror_at: '',
  backup_last_auto_date: '',
  backup_last_auto_status: '',
  backup_last_auto_message: '',
  backup_last_auto_job_id: '',
  backup_last_auto_at: '',
  product_wall_max_image_mb: 50,
  product_wall_max_batch_count: 50,
  product_wall_max_zip_extract: 100,
  product_wall_upload_roles: 'ADMIN,EDITOR,VIEWER,INTERNAL',
  product_wall_upload_allowed_user_ids: '',
  cache_driver: 'redis',
  cache_enabled: true,
  redis_url: 'redis://localhost:6379',
  redis_password: '',
  redis_db: 0,
  redis_key_prefix: '3dparthub',
  redis_tls_enabled: false,
  cache_public_settings_ttl_seconds: 60,
  cache_model_list_ttl_seconds: 300,
  cache_model_detail_ttl_seconds: 300,
  cache_search_ttl_seconds: 60,
  cache_selection_ttl_seconds: 600,
  cache_static_asset_max_age_days: 30,
  storage_provider: 'local',
  storage_endpoint: '',
  storage_region: '',
  storage_bucket: '',
  storage_access_key_id: '',
  storage_access_key_secret: '',
  storage_use_ssl: true,
  storage_force_path_style: false,
  storage_public_base_url: '',
  storage_cdn_base_url: '',
  storage_image_prefix: 'images',
  storage_thumbnail_prefix: 'thumbnails',
  storage_model_prefix: 'models',
  storage_original_prefix: 'originals',
  storage_drawing_prefix: 'drawings',
  storage_product_wall_prefix: 'product-wall',
  storage_attachment_prefix: 'attachments',
  storage_backup_prefix: 'backups',
  storage_temp_prefix: 'temp',
  storage_signed_url_enabled: false,
  storage_signed_url_ttl_seconds: 3600,
  storage_upload_multipart_mb: 16,
  storage_upload_concurrency: 4,
  image_cdn_enabled: false,
  image_optimize_enabled: true,
  image_webp_enabled: true,
  image_thumbnail_quality: 82,
  image_large_max_width: 2560,
  image_cache_max_age_days: 30,
  resource_cdn_enabled: false,
  resource_cache_max_age_days: 30,
  resource_download_acceleration_enabled: false,
  download_token_ttl_minutes: 5,
  ticket_attachment_max_mb: 100,
  ticket_attachment_types:
    'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,ppt,pptx,zip,rar,7z,step,stp,iges,igs,binary',
  api_rate_limit: 5000,
  login_dialog_enabled: true,
  login_dialog_favorites: true,
  login_dialog_downloads: true,
  login_dialog_my_shares: true,
  login_dialog_profile: true,
  login_dialog_support: true,
  login_dialog_my_tickets: true,
  login_dialog_my_inquiries: true,
  login_dialog_projects: true,
  auth_modal_enabled: true,
  storage_sync_enabled: false,
  storage_sync_delete_extra_enabled: false,
};

type SettingItemType =
  | 'switch'
  | 'number'
  | 'text'
  | 'image'
  | 'textarea'
  | 'select'
  | 'color'
  | 'range'
  | 'email-test'
  | 'cache-test'
  | 'storage-test'
  | 'storage-policy-info'
  | 'storage-sync'
  | 'color-scheme';

interface SettingItemBase {
  label: string;
  desc: string;
  options?: { value: string; label: string }[];
  step?: number;
  min?: number;
  max?: number;
  /** 当依赖的开关为 false 时，此项禁用（灰显）。 */
  dependsOn?: keyof SystemSettings;
}

type SystemSettingItem = SettingItemBase & {
  key: keyof SystemSettings;
  type: Exclude<SettingItemType, 'email-test' | 'cache-test' | 'storage-test' | 'storage-policy-info' | 'storage-sync'>;
};

type ActionSettingItem =
  | (SettingItemBase & {
      key: 'smtp_test';
      type: 'email-test';
    })
  | (SettingItemBase & {
      key: 'cache_test';
      type: 'cache-test';
    })
  | (SettingItemBase & {
      key: 'storage_test';
      type: 'storage-test';
    })
  | (SettingItemBase & {
      key: 'storage_policy_info';
      type: 'storage-policy-info';
    })
  | (SettingItemBase & {
      key: 'storage_sync';
      type: 'storage-sync';
    });

type SettingItem = SystemSettingItem | ActionSettingItem;

interface SettingGroup {
  title: string;
  icon: string;
  items: (SettingItem | { _section: string })[];
}

function isSystemSettingKey(key: SettingItem['key']): key is keyof SystemSettings {
  return !['smtp_test', 'cache_test', 'storage_test', 'storage_policy_info', 'storage_sync'].includes(String(key));
}

function isSection(item: SettingItem | { _section: string }): item is { _section: string } {
  return '_section' in item;
}

const CACHE_DRIVER_OPTIONS = [
  { value: 'redis', label: 'adminSettings.cacheDriverRedis' },
  { value: 'memory', label: 'adminSettings.cacheDriverMemory' },
  { value: 'off', label: 'adminSettings.cacheDriverOff' },
];

const UI_LOCALE_OPTIONS = [
  { value: 'zh-CN', label: 'adminSettings.localeZhCN' },
  { value: 'zh-TW', label: 'adminSettings.localeZhTW' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: 'adminSettings.localeJa' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'de-DE', label: 'Deutsch' },
];

const STORAGE_PROVIDER_OPTIONS = [
  { value: 'local', label: 'adminSettings.providerLocal' },
  { value: 'minio', label: 'adminSettings.providerMinio' },
  { value: 'tencent_cos', label: 'adminSettings.providerTencentCos' },
  { value: 'aliyun_oss', label: 'adminSettings.providerAliyunOss' },
  { value: 'qiniu_kodo', label: 'adminSettings.providerQiniu' },
  { value: 's3_compatible', label: 'adminSettings.providerS3Compatible' },
];

const CACHE_STORAGE_GROUP_TITLE = 'adminSettings.groupStorage';
const CACHE_STORAGE_SECTION_TITLES = [
  'adminSettings.tabRedisCache',
  'adminSettings.tabStorageProvider',
  'adminSettings.tabStoragePolicy',
  'adminSettings.tabLocalCloudSync',
  'adminSettings.tabAssetOptimization',
] as const;
const SETTING_SECTION_ICONS: Record<string, string> = {
  'adminSettings.tabRedisCache': 'memory',
  'adminSettings.tabStorageProvider': 'cloud',
  'adminSettings.tabStoragePolicy': 'folder_open',
  'adminSettings.tabLocalCloudSync': 'sync_alt',
  'adminSettings.tabAssetOptimization': 'image',
};

const GROUPS: SettingGroup[] = [
  {
    title: 'adminSettings.tabSiteBrand',
    icon: 'domain',
    items: [
      { key: 'site_title', label: 'adminSettings.siteTitle', desc: 'adminSettings.siteTitleDesc', type: 'text' },
      {
        key: 'site_browser_title',
        label: 'adminSettings.browserTitle',
        desc: 'adminSettings.browserTitleDesc',
        type: 'text',
      },
      {
        key: 'site_app_name',
        label: 'adminSettings.appName',
        desc: 'adminSettings.appNameDesc',
        type: 'text',
      },
      {
        key: 'site_app_icon',
        label: 'adminSettings.appIcon',
        desc: 'adminSettings.appIconDesc',
        type: 'image',
      },
      {
        key: 'site_app_desc',
        label: 'adminSettings.appDescription',
        desc: 'adminSettings.appDescDesc',
        type: 'text',
      },
      {
        key: 'site_logo',
        label: 'adminSettings.siteLogo',
        desc: 'adminSettings.siteLogoDesc',
        type: 'image',
      },
      {
        key: 'site_icon',
        label: 'adminSettings.siteIcon',
        desc: 'adminSettings.siteIconModeDesc',
        type: 'image',
      },
      {
        key: 'site_logo_display',
        label: 'adminSettings.logoDisplayMode',
        desc: 'adminSettings.logoModeDesc',
        type: 'select',
        options: [
          { value: 'logo_and_title', label: 'adminSettings.logoModeIconTitle' },
          { value: 'logo_only', label: 'adminSettings.logoModeLogoOnly' },
          { value: 'title_only', label: 'adminSettings.logoModeTitleOnly' },
        ],
      },
      {
        key: 'site_favicon',
        label: 'adminSettings.faviconIcon',
        desc: 'adminSettings.siteIconDesc',
        type: 'image',
      },
      {
        key: 'site_description',
        label: 'adminSettings.siteDescription',
        desc: 'adminSettings.siteDescriptionDesc',
        type: 'text',
      },
      { key: 'site_keywords', label: 'adminSettings.keywords', desc: 'adminSettings.seoKeywordsDesc', type: 'text' },
      { _section: 'adminSettings.sectionFooterContact' },
      {
        key: 'contact_phone',
        label: 'adminSettings.contactPhone',
        desc: 'adminSettings.contactPhoneEg',
        type: 'text',
      },
      {
        key: 'contact_address',
        label: 'adminSettings.footerAddress',
        desc: 'adminSettings.footerAddressDesc',
        type: 'text',
      },
      { _section: 'adminSettings.sectionModelFooter' },
      {
        key: 'model_detail_disclaimer',
        label: 'adminSettings.modelDetailNotes',
        desc: 'adminSettings.modelCopyrightDesc',
        type: 'textarea',
      },
      {
        key: 'model_detail_copyright_follow_site_title',
        label: 'adminSettings.modelCopyrightFollowSite',
        desc: 'adminSettings.copyrightFollowDesc',
        type: 'switch',
      },
      {
        key: 'model_detail_copyright',
        label: 'adminSettings.modelCopyright',
        desc: 'adminSettings.footerCopyrightManualDesc',
        type: 'text',
      },
      { _section: 'adminSettings.sectionFooterLinks' },
      {
        key: 'footer_links',
        label: 'adminSettings.sectionFriendlyLinks',
        desc: 'adminSettings.footerLinksDesc',
        type: 'textarea',
      },
      {
        key: 'footer_copyright_follow_site_title',
        label: 'adminSettings.footerCopyrightFollowSite',
        desc: 'adminSettings.copyrightFollowEnDesc',
        type: 'switch',
      },
      {
        key: 'footer_copyright',
        label: 'adminSettings.footerCopyright',
        desc: 'adminSettings.footerCopyrightManualEnDesc',
        type: 'text',
      },
      { _section: 'adminSettings.sectionFilingInfo' },
      {
        key: 'footer_icp_number',
        label: 'adminSettings.icpNumber',
        desc: 'adminSettings.icpDesc',
        type: 'text',
      },
      {
        key: 'footer_police_number',
        label: 'adminSettings.policeNumber',
        desc: 'adminSettings.policeNumberDesc',
        type: 'text',
      },
    ],
  },
  {
    title: 'adminSettings.tabAppearance',
    icon: 'palette',
    items: [
      {
        key: 'interface_theme',
        label: 'adminSettings.interfaceTheme',
        desc: 'adminSettings.defaultThemePickerDesc',
        type: 'select',
        options: INTERFACE_THEME_OPTIONS,
      },
      {
        key: 'mobile_interface_theme',
        label: 'adminSettings.mobileTheme',
        desc: 'adminSettings.mobileThemeDesc',
        type: 'select',
        options: MOBILE_THEME_OPTIONS,
      },
      {
        key: 'user_interface_theme_enabled',
        label: 'adminSettings.allowCustomThemeDesc',
        desc: 'adminSettings.allowCustomThemeMenuDesc',
        type: 'switch',
      },
      {
        key: 'home_desktop_list_loading_mode',
        label: 'adminSettings.pcHomeLoadMode',
        desc: 'adminSettings.pcHomeLoadDesc',
        type: 'select',
        options: [
          { value: 'infinite', label: 'adminSettings.loadModeInfinite' },
          { value: 'pagination', label: 'adminSettings.loadModePaged' },
        ],
      },
      {
        key: 'home_mobile_list_loading_mode',
        label: 'adminSettings.mobileHomeLoadMode',
        desc: 'adminSettings.mobileHomeLoadDesc',
        type: 'select',
        options: [
          { value: 'infinite', label: 'adminSettings.loadModeInfinite' },
          { value: 'pagination', label: 'adminSettings.loadModePaged' },
        ],
      },
      { _section: 'adminSettings.sectionUiLanguage' },
      {
        key: 'ui_default_locale',
        label: 'adminSettings.defaultLocale',
        desc: 'adminSettings.defaultLocaleDesc',
        type: 'select',
        options: UI_LOCALE_OPTIONS,
      },
      {
        key: 'ui_enabled_locales',
        label: 'adminSettings.enabledLocales',
        desc: 'adminSettings.enabledLocalesDesc',
        type: 'text',
      },
      {
        key: 'ui_follow_browser_locale',
        label: 'adminSettings.followBrowserLocale',
        desc: 'adminSettings.followBrowserLocaleDesc',
        type: 'switch',
      },
      {
        key: 'color_scheme',
        label: 'adminSettings.colorScheme',
        desc: 'adminSettings.presetEg',
        type: 'color-scheme',
      },
      {
        key: 'default_theme',
        label: 'adminSettings.defaultTheme',
        desc: 'adminSettings.defaultThemeDesc',
        type: 'select',
        options: [
          { value: 'dark', label: 'adminSettings.themeDark' },
          { value: 'light', label: 'adminSettings.themeLight' },
          { value: 'system', label: 'adminSettings.themeFollowSystem' },
        ],
      },
      {
        key: 'auto_theme_enabled',
        label: 'adminSettings.themeSchedule',
        desc: 'adminSettings.themeScheduleDesc',
        type: 'switch',
      },
      {
        key: 'auto_theme_dark_hour',
        label: 'adminSettings.scheduleDarkStart',
        desc: 'adminSettings.scheduleDarkStartDesc',
        type: 'number',
      },
      {
        key: 'auto_theme_light_hour',
        label: 'adminSettings.scheduleLightStart',
        desc: 'adminSettings.scheduleLightStartDesc',
        type: 'number',
      },
    ],
  },
  {
    title: 'adminSettings.tabAnnouncement',
    icon: 'campaign',
    items: [
      {
        key: 'announcement_enabled',
        label: 'adminSettings.enableAnnouncement',
        desc: 'adminSettings.announcementDesc',
        type: 'switch',
      },
      {
        key: 'announcement_text',
        label: 'adminSettings.announcementContent',
        desc: 'adminSettings.announcementHtmlDesc',
        type: 'textarea',
      },
      {
        key: 'announcement_type',
        label: 'adminSettings.announcementStyle',
        desc: 'adminSettings.announcementStyleDesc',
        type: 'select',
        options: [
          { value: 'info', label: 'adminSettings.noticeStyleInfo' },
          { value: 'warning', label: 'adminSettings.noticeStyleWarning' },
          { value: 'error', label: 'adminSettings.noticeStyleCritical' },
        ],
      },
      {
        key: 'announcement_color',
        label: 'adminSettings.customColor',
        desc: 'adminSettings.watermarkColorHint',
        type: 'color',
      },
    ],
  },
  {
    title: 'adminSettings.tabMenuConfig',
    icon: 'menu',
    items: [
      {
        key: 'nav_items',
        label: 'adminSettings.menuSidebar',
        desc: 'adminSettings.menuConfigDesc',
        type: 'textarea',
      },
      {
        key: 'nav_mobile_items',
        label: 'adminSettings.mobileBottomMenu',
        desc: 'adminSettings.mobileMenuDesc',
        type: 'textarea',
      },
    ],
  },
  {
    title: 'adminSettings.tabAccessControl',
    icon: 'lock',
    items: [
      {
        key: 'require_login_browse',
        label: 'adminSettings.loginToBrowse',
        desc: 'adminSettings.loginToBrowseDesc',
        type: 'switch',
      },
      {
        key: 'require_login_selection',
        label: 'adminSettings.loginToBrowseSelection',
        desc: 'adminSettings.loginToBrowseSelectionDesc',
        type: 'switch',
      },
      {
        key: 'require_login_download',
        label: 'adminSettings.loginToDownload',
        desc: 'adminSettings.loginToDownloadDesc',
        type: 'switch',
      },
      {
        key: 'auth_modal_enabled',
        label: 'adminSettings.authModal',
        desc: 'adminSettings.authModalDesc',
        type: 'switch',
      },
      {
        key: 'login_dialog_enabled',
        label: 'adminSettings.browsePromptModal',
        desc: 'adminSettings.browsePromptDesc',
        type: 'switch',
      },
      { _section: 'adminSettings.sectionPerPageGates' },
      {
        key: 'login_dialog_favorites',
        label: 'adminSettings.viewFavorites',
        desc: 'adminSettings.gateFavoritesPrompt',
        type: 'switch',
      },
      {
        key: 'login_dialog_downloads',
        label: 'adminSettings.gateDownloads',
        desc: 'adminSettings.gateDownloadsPrompt',
        type: 'switch',
      },
      {
        key: 'login_dialog_my_shares',
        label: 'adminSettings.gateMySharesPage',
        desc: 'adminSettings.gateMySharesPrompt',
        type: 'switch',
      },
      {
        key: 'login_dialog_profile',
        label: 'adminSettings.gateProfile',
        desc: 'adminSettings.gateProfilePrompt',
        type: 'switch',
      },
      {
        key: 'login_dialog_support',
        label: 'adminSettings.gateSupport',
        desc: 'adminSettings.gateSupportPrompt',
        type: 'switch',
      },
      {
        key: 'login_dialog_my_tickets',
        label: 'adminSettings.gateMyTicketsPage',
        desc: 'adminSettings.gateMyTicketsPrompt',
        type: 'switch',
      },
      {
        key: 'login_dialog_my_inquiries',
        label: 'adminSettings.gateMyInquiries',
        desc: 'adminSettings.gateMyInquiriesPrompt',
        type: 'switch',
      },
      {
        key: 'login_dialog_projects',
        label: 'adminSettings.gateMyProjects',
        desc: 'adminSettings.gateMyProjectsPrompt',
        type: 'switch',
      },
    ],
  },
  {
    title: 'adminSettings.sectionFeatureToggles',
    icon: 'power_settings_new',
    items: [
      {
        key: 'feature_selection_enabled',
        label: 'adminSettings.featureSelection',
        desc: 'adminSettings.selectionOffDesc',
        type: 'switch',
      },
      {
        key: 'feature_inquiry_enabled',
        label: 'adminSettings.featureInquiries',
        desc: 'adminSettings.inquiriesOffDesc',
        type: 'switch',
      },
      {
        key: 'feature_product_wall_enabled',
        label: 'adminSettings.scopeProductWall',
        desc: 'adminSettings.galleryOffDesc',
        type: 'switch',
      },
      {
        key: 'feature_tickets_enabled',
        label: 'adminSettings.ticketSupport',
        desc: 'adminSettings.ticketsOffDesc',
        type: 'switch',
      },
      {
        key: 'feature_favorites_enabled',
        label: 'adminSettings.featureFavorites',
        desc: 'adminSettings.favoritesOffDesc',
        type: 'switch',
      },
      {
        key: 'feature_shares_enabled',
        label: 'adminSettings.featureShares',
        desc: 'adminSettings.sharesOffDesc',
        type: 'switch',
      },
      {
        key: 'feature_downloads_enabled',
        label: 'adminSettings.featureDownloads',
        desc: 'adminSettings.downloadsOffDesc',
        type: 'switch',
      },
      {
        key: 'feature_password_reset_enabled',
        label: 'adminSettings.gatePasswordReset',
        desc: 'adminSettings.passwordResetOffDesc',
        type: 'switch',
      },
      {
        key: 'allow_register',
        label: 'adminSettings.featureRegistration',
        desc: 'adminSettings.registrationDisabledDesc',
        type: 'switch',
      },
      {
        key: 'feature_temp_viewer_enabled',
        label: 'adminSettings.featureTempViewer',
        desc: 'adminSettings.tempViewerOffDesc',
        type: 'switch',
      },
      {
        key: 'require_invite_code',
        label: 'adminSettings.inviteCodeRegistration',
        desc: 'adminSettings.inviteCodeDesc',
        type: 'switch',
      },
      {
        key: 'invite_max_active_per_user',
        label: 'adminSettings.inviteHoldingLimit',
        desc: 'adminSettings.inviteHoldingLimitDesc',
        type: 'number',
        min: 0,
        max: 100,
      },
    ],
  },
  {
    title: 'adminSettings.tabSecurity',
    icon: 'shield',
    items: [
      {
        key: 'anti_proxy_enabled',
        label: 'adminSettings.sectionAntiProxy',
        desc: 'adminSettings.antiProxyDesc',
        type: 'switch',
      },
      {
        key: 'allowed_hosts',
        label: 'adminSettings.authorizedDomains',
        desc: 'adminSettings.allowedDomainsDesc',
        type: 'textarea',
      },
      {
        key: 'hotlink_protection_enabled',
        label: 'adminSettings.hotlinkProtection',
        desc: 'adminSettings.hotlinkProtectionDesc',
        type: 'switch',
      },
      {
        key: 'allowed_referers',
        label: 'adminSettings.allowedReferers',
        desc: 'adminSettings.allowedReferersDesc',
        type: 'textarea',
      },
      {
        key: 'security_email_code_cooldown_seconds',
        label: 'adminSettings.emailCodeInterval',
        desc: 'adminSettings.emailCodeIntervalDesc',
        type: 'number',
        min: 10,
        max: 3600,
      },
      {
        key: 'security_email_code_ttl_seconds',
        label: 'adminSettings.emailCodeTtl',
        desc: 'adminSettings.emailCodeTtlDesc',
        type: 'number',
        min: 60,
        max: 86400,
      },
      {
        key: 'security_captcha_ttl_seconds',
        label: 'adminSettings.captchaTtl',
        desc: 'adminSettings.captchaTtlDesc',
        type: 'number',
        min: 60,
        max: 3600,
      },
      {
        key: 'security_password_min_length',
        label: 'adminSettings.passwordMinLength',
        desc: 'adminSettings.passwordMinLengthDesc',
        type: 'number',
        min: 6,
        max: 64,
      },
      {
        key: 'security_username_min_length',
        label: 'adminSettings.usernameMin',
        desc: 'adminSettings.usernameMinLength',
        type: 'number',
        min: 1,
        max: 32,
      },
      {
        key: 'security_username_max_length',
        label: 'adminSettings.usernameMax',
        desc: 'adminSettings.usernameMaxLength',
        type: 'number',
        min: 1,
        max: 64,
      },
    ],
  },
  {
    title: 'adminSettings.tabDownloadShare',
    icon: 'download',
    items: [
      {
        key: 'daily_download_limit',
        label: 'adminSettings.dailyDownloadLimit',
        desc: 'adminSettings.dailyDownloadLimitDesc',
        type: 'number',
      },
      {
        key: 'download_token_ttl_minutes',
        label: 'adminSettings.downloadTokenTtl',
        desc: 'adminSettings.downloadTokenTtlDesc',
        type: 'number',
        min: 1,
        max: 60,
      },
      {
        key: 'share_default_expire_days',
        label: 'adminSettings.shareDefaultExpiry',
        desc: 'adminSettings.shareDefaultExpiryDesc',
        type: 'number',
      },
      {
        key: 'share_max_expire_days',
        label: 'adminSettings.shareMaxExpiry',
        desc: 'adminSettings.shareMaxExpiryDesc',
        type: 'number',
      },
      {
        key: 'share_default_download_limit',
        label: 'adminSettings.shareDefaultDownloads',
        desc: 'adminSettings.shareDefaultDownloadsDesc',
        type: 'number',
      },
      {
        key: 'share_max_download_limit',
        label: 'adminSettings.shareMaxDownloads',
        desc: 'adminSettings.shareMaxDownloadsDesc',
        type: 'number',
      },
      {
        key: 'share_allow_password',
        label: 'adminSettings.allowSetPassword',
        desc: 'adminSettings.shareAllowPasswordDesc',
        type: 'switch',
      },
      {
        key: 'share_allow_custom_expiry',
        label: 'adminSettings.allowCustomExpiry',
        desc: 'adminSettings.shareAllowCustomExpiryDesc',
        type: 'switch',
      },
      {
        key: 'share_allow_preview',
        label: 'adminSettings.shareDefaultPreview',
        desc: 'adminSettings.shareDefaultPreviewDesc',
        type: 'switch',
      },
      {
        key: 'show_watermark',
        label: 'adminSettings.viewerWatermark',
        desc: 'adminSettings.viewerWatermarkDesc',
        type: 'switch',
      },
      {
        key: 'watermark_text',
        label: 'adminSettings.watermarkText',
        desc: 'adminSettings.watermarkTextDesc',
        type: 'text',
      },
      {
        key: 'watermark_image',
        label: 'adminSettings.watermarkImage',
        desc: 'adminSettings.watermarkImageDesc',
        type: 'image',
      },
    ],
  },
  {
    title: 'adminSettings.tab3dPreview',
    icon: 'view_in_ar',
    items: [],
  },
  {
    title: 'adminSettings.tabSelection',
    icon: 'checklist',
    items: [
      {
        key: 'selection_page_title',
        label: 'adminSettings.selectionPageTitle',
        desc: 'adminSettings.selectionPageTitleDesc',
        type: 'text',
      },
      {
        key: 'selection_page_desc',
        label: 'adminSettings.selectionPageDesc',
        desc: 'adminSettings.selectionPageDescDesc',
        type: 'text',
      },
      {
        key: 'selection_enable_match',
        label: 'adminSettings.selectionModelMatch',
        desc: 'adminSettings.selectionMatchModels',
        type: 'switch',
      },
      {
        key: 'selection_thread_priority',
        label: 'adminSettings.threadSortPriority',
        desc: 'adminSettings.threadSortDesc',
        type: 'textarea',
      },
    ],
  },
  {
    title: 'adminSettings.tabBizDict',
    icon: 'tune',
    items: [
      {
        key: 'inquiry_statuses',
        label: 'adminSettings.inquiryStatuses',
        desc: 'adminSettings.ticketCategoryDesc',
        type: 'textarea',
      },
      {
        key: 'ticket_statuses',
        label: 'adminSettings.ticketStatuses',
        desc: 'adminSettings.ticketStatusDesc',
        type: 'textarea',
      },
      {
        key: 'ticket_classifications',
        label: 'adminSettings.ticketCategories',
        desc: 'adminSettings.supportEntryDesc',
        type: 'textarea',
      },
      {
        key: 'support_process_steps',
        label: 'adminSettings.supportSteps',
        desc: 'adminSettings.supportStepsDesc',
        type: 'textarea',
      },
    ],
  },
  {
    title: 'adminSettings.tabUploadLimits',
    icon: 'upload_file',
    items: [
      {
        key: 'upload_policy',
        label: 'adminSettings.sectionUploadLimits',
        desc: 'adminSettings.tabUploadLimitsDesc',
        type: 'textarea',
      },
      {
        key: 'product_wall_max_image_mb',
        label: 'adminSettings.galleryPerImageMaxMb',
        desc: 'adminSettings.galleryPerImageMaxDesc',
        type: 'number',
        min: 1,
        max: 200,
      },
      {
        key: 'product_wall_max_batch_count',
        label: 'adminSettings.galleryBatchMax',
        desc: 'adminSettings.galleryBatchMaxDesc',
        type: 'number',
        min: 1,
        max: 200,
      },
      {
        key: 'product_wall_max_zip_extract',
        label: 'adminSettings.galleryArchiveMax',
        desc: 'adminSettings.galleryArchiveMaxDesc',
        type: 'number',
        min: 1,
        max: 500,
      },
      {
        key: 'product_wall_upload_roles',
        label: 'adminSettings.galleryUploadRolesFull',
        desc: 'adminSettings.galleryRolesDesc',
        type: 'text',
      },
      {
        key: 'product_wall_upload_allowed_user_ids',
        label: 'adminSettings.galleryAllowedUsers',
        desc: 'adminSettings.galleryAllowedUsersDesc',
        type: 'text',
      },
      {
        key: 'ticket_attachment_max_mb',
        label: 'adminSettings.ticketAttachmentMaxMb',
        desc: 'adminSettings.ticketAttachmentMaxDesc',
        type: 'number',
        min: 1,
        max: 200,
      },
      {
        key: 'ticket_attachment_types',
        label: 'adminSettings.ticketAttachmentTypes',
        desc: 'adminSettings.attachmentTypesDesc',
        type: 'text',
      },
      {
        key: 'page_size_policy',
        label: 'adminSettings.tabListPaging',
        desc: 'adminSettings.tabListPagingDesc',
        type: 'textarea',
      },
    ],
  },
  {
    title: CACHE_STORAGE_GROUP_TITLE,
    icon: 'storage',
    items: [
      { _section: 'adminSettings.tabRedisCache' },
      {
        key: 'redis_url',
        label: 'adminSettings.redisHostReadonly',
        desc: 'adminSettings.redisHostNote',
        type: 'text',
      },
      {
        key: 'redis_password',
        label: 'adminSettings.redisPasswordReadonly',
        desc: 'adminSettings.redisPasswordNote',
        type: 'text',
      },
      {
        key: 'redis_db',
        label: 'adminSettings.redisDbReadonly',
        desc: 'adminSettings.redisDbNote',
        type: 'number',
        min: 0,
        max: 15,
      },
      {
        key: 'redis_key_prefix',
        label: 'adminSettings.redisKeyPrefixReadonly',
        desc: 'adminSettings.redisKeyPrefixNote',
        type: 'text',
      },
      {
        key: 'redis_tls_enabled',
        label: 'adminSettings.redisTlsReadonly',
        desc: 'adminSettings.redisTlsNote',
        type: 'switch',
      },
      {
        key: 'cache_test',
        label: 'adminSettings.redisConnectionTest',
        desc: 'adminSettings.cacheTestSaveDesc',
        type: 'cache-test',
      },
      {
        key: 'cache_public_settings_ttl_seconds',
        label: 'adminSettings.cachePublicSettings',
        desc: 'adminSettings.publicSettingsCacheDesc',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_model_list_ttl_seconds',
        label: 'adminSettings.cacheModelList',
        desc: 'adminSettings.homeCacheDesc',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_model_detail_ttl_seconds',
        label: 'adminSettings.modelDetailCache',
        desc: 'adminSettings.modelDetailCacheDesc',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_search_ttl_seconds',
        label: 'adminSettings.cacheSearch',
        desc: 'adminSettings.searchCacheDesc',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_selection_ttl_seconds',
        label: 'adminSettings.selectionCache',
        desc: 'adminSettings.selectionCacheDesc',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_static_asset_max_age_days',
        label: 'adminSettings.cacheStaticAssets',
        desc: 'adminSettings.assetCacheDaysCdnDesc',
        type: 'number',
        min: 0,
        max: 365,
      },
      { _section: 'adminSettings.tabStorageProvider' },
      {
        key: 'storage_provider',
        label: 'adminSettings.storageProvider',
        desc: 'adminSettings.storageProviderDesc',
        type: 'select',
        options: STORAGE_PROVIDER_OPTIONS,
      },
      {
        key: 'storage_endpoint',
        label: 'Endpoint',
        desc: 'adminSettings.storageEndpointDesc',
        type: 'text',
      },
      {
        key: 'storage_region',
        label: 'adminSettings.storageRegion',
        desc: 'adminSettings.storageRegionDesc',
        type: 'text',
      },
      {
        key: 'storage_bucket',
        label: 'Bucket',
        desc: 'adminSettings.bucketNameDesc',
        type: 'text',
      },
      {
        key: 'storage_access_key_id',
        label: 'Access Key ID',
        desc: 'adminSettings.storageKeyIdDesc',
        type: 'text',
      },
      {
        key: 'storage_access_key_secret',
        label: 'Access Key Secret',
        desc: 'adminSettings.storageKeySecretDesc',
        type: 'text',
      },
      {
        key: 'storage_use_ssl',
        label: 'adminSettings.httpsAccess',
        desc: 'adminSettings.httpsRequiredDesc',
        type: 'switch',
      },
      {
        key: 'storage_force_path_style',
        label: 'adminSettings.pathStyleAccess',
        desc: 'adminSettings.pathStyleDesc',
        type: 'switch',
      },
      {
        key: 'storage_public_base_url',
        label: 'adminSettings.publicBaseUrl',
        desc: 'adminSettings.publicBaseUrlDesc',
        type: 'text',
      },
      {
        key: 'storage_cdn_base_url',
        label: 'adminSettings.cdnDomain',
        desc: 'adminSettings.cdnDomainDesc',
        type: 'text',
      },
      {
        key: 'storage_test',
        label: 'adminSettings.storageReadWriteTest',
        desc: 'adminSettings.storageTestSaveDesc',
        type: 'storage-test',
      },
      { _section: 'adminSettings.tabStoragePolicy' },
      {
        key: 'storage_policy_info',
        label: 'adminSettings.storagePolicyIntro',
        desc: 'adminSettings.storagePolicyDesc',
        type: 'storage-policy-info',
      },
      {
        key: 'storage_image_prefix',
        label: 'adminSettings.dirImages',
        desc: 'adminSettings.dirImagePrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_thumbnail_prefix',
        label: 'adminSettings.dirThumbDir',
        desc: 'adminSettings.dirThumbPrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_model_prefix',
        label: 'adminSettings.dirModelFilesDir',
        desc: 'adminSettings.dirStepPrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_original_prefix',
        label: 'adminSettings.dirOriginal',
        desc: 'adminSettings.dirRawPrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_drawing_prefix',
        label: 'adminSettings.dirDrawingsDir',
        desc: 'adminSettings.dirDrawingPrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_product_wall_prefix',
        label: 'adminSettings.dirGallery',
        desc: 'adminSettings.dirGalleryPrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_attachment_prefix',
        label: 'adminSettings.dirAttachments',
        desc: 'adminSettings.dirTicketPrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_backup_prefix',
        label: 'adminSettings.dirBackups',
        desc: 'adminSettings.dirBackupPrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_temp_prefix',
        label: 'adminSettings.dirTemp',
        desc: 'adminSettings.dirConversionPrefixDesc',
        type: 'text',
      },
      {
        key: 'storage_signed_url_enabled',
        label: 'adminSettings.accessSignedDisabled',
        desc: 'adminSettings.signedUrlFeatureNote',
        type: 'switch',
      },
      {
        key: 'storage_signed_url_ttl_seconds',
        label: 'adminSettings.signedUrlTtl',
        desc: 'adminSettings.signedUrlTtlNote',
        type: 'number',
        min: 60,
        max: 86400,
      },
      {
        key: 'storage_upload_multipart_mb',
        label: 'adminSettings.chunkSizeReadonly',
        desc: 'adminSettings.storageClientControlledNote',
        type: 'number',
        min: 5,
        max: 512,
      },
      {
        key: 'storage_upload_concurrency',
        label: 'adminSettings.uploadConcurrency',
        desc: 'adminSettings.uploadConcurrencyDesc',
        type: 'number',
        min: 1,
        max: 16,
      },
      { _section: 'adminSettings.tabLocalCloudSync' },
      {
        key: 'storage_sync_enabled',
        label: 'adminSettings.enableSyncTool',
        desc: 'adminSettings.syncToolDesc2',
        type: 'switch',
      },
      {
        key: 'storage_sync_delete_extra_enabled',
        label: 'adminSettings.syncAllowDeleteExtra',
        desc: 'adminSettings.allowDeleteExtraDesc',
        type: 'switch',
      },
      {
        key: 'storage_sync',
        label: 'adminSettings.syncJobs',
        desc: 'adminSettings.syncDesc',
        type: 'storage-sync',
      },
      { _section: 'adminSettings.tabAssetOptimization' },
      {
        key: 'image_cdn_enabled',
        label: 'adminSettings.cdnImages',
        desc: 'adminSettings.cdnGalleryDesc',
        type: 'switch',
      },
      {
        key: 'image_optimize_enabled',
        label: 'adminSettings.imageCompression',
        desc: 'adminSettings.thumbGenDesc',
        type: 'switch',
      },
      {
        key: 'image_webp_enabled',
        label: 'adminSettings.generateWebp',
        desc: 'adminSettings.webpDesc',
        type: 'switch',
      },
      {
        key: 'image_thumbnail_quality',
        label: 'adminSettings.thumbQuality',
        desc: 'adminSettings.thumbQualityDesc',
        type: 'number',
        min: 1,
        max: 100,
      },
      {
        key: 'image_large_max_width',
        label: 'adminSettings.previewMaxWidth',
        desc: 'adminSettings.previewMaxWidthDesc',
        type: 'number',
        min: 320,
        max: 12000,
      },
      {
        key: 'image_cache_max_age_days',
        label: 'adminSettings.imageCacheDays',
        desc: 'adminSettings.assetCacheDaysDesc',
        type: 'number',
        min: 0,
        max: 365,
      },
      {
        key: 'resource_cdn_enabled',
        label: 'adminSettings.cdnModelAssets',
        desc: 'adminSettings.cdnForModelsDesc',
        type: 'switch',
      },
      {
        key: 'resource_cache_max_age_days',
        label: 'adminSettings.assetCacheDays',
        desc: 'adminSettings.modelAssetCacheDaysDesc',
        type: 'number',
        min: 0,
        max: 365,
      },
      {
        key: 'resource_download_acceleration_enabled',
        label: 'adminSettings.downloadAccelerationReadonly',
        desc: 'adminSettings.xaccelNote',
        type: 'switch',
      },
    ],
  },
  {
    title: 'adminSettings.tabEmail',
    icon: 'mail',
    items: [
      { key: 'smtp_host', label: 'adminSettings.smtpHost', desc: 'adminSettings.smtpHostDesc', type: 'text' },
      { key: 'smtp_port', label: 'adminSettings.unitPort', desc: 'adminSettings.smtpPortDesc', type: 'number' },
      {
        key: 'smtp_user',
        label: 'adminSettings.placeholderUsername',
        desc: 'adminSettings.smtpUsername',
        type: 'text',
      },
      {
        key: 'smtp_pass',
        label: 'adminSettings.placeholderPassword',
        desc: 'adminSettings.smtpPassword',
        type: 'text',
      },
      { key: 'smtp_from', label: 'adminSettings.smtpSenderName', desc: 'adminSettings.smtpSenderEmail', type: 'text' },
      {
        key: 'contact_email',
        label: 'adminSettings.contactEmail',
        desc: 'adminSettings.supportEmailDesc',
        type: 'text',
      },
      { key: 'smtp_secure', label: 'SSL/TLS', desc: 'adminSettings.useSecureConnection', type: 'switch' },
      { key: 'smtp_test', label: 'adminSettings.testSend', desc: 'adminSettings.smtpTestDesc', type: 'email-test' },
      {
        key: 'email_templates',
        label: 'adminSettings.emailTemplates',
        desc: 'adminSettings.sectionEmailTemplates',
        type: 'textarea',
      },
    ],
  },
  {
    title: 'adminSettings.tabLegal',
    icon: 'description',
    items: [
      {
        key: 'legal_privacy_updated_at',
        label: 'adminSettings.privacyUpdatedAt',
        desc: 'adminSettings.privacyDateDesc',
        type: 'text',
      },
      {
        key: 'legal_privacy_sections',
        label: 'adminSettings.privacyBody',
        desc: 'adminSettings.privacySectionsDesc',
        type: 'textarea',
      },
      {
        key: 'legal_terms_updated_at',
        label: 'adminSettings.termsUpdatedAt',
        desc: 'adminSettings.termsDateDesc',
        type: 'text',
      },
      {
        key: 'legal_terms_sections',
        label: 'adminSettings.termsBody',
        desc: 'adminSettings.termsSectionsDesc',
        type: 'textarea',
      },
    ],
  },
  {
    title: 'adminSettings.tabOpsMaintenance',
    icon: 'build',
    items: [
      {
        key: 'maintenance_enabled',
        label: 'adminSettings.manualMaintenance',
        desc: 'adminSettings.maintenanceModeDesc',
        type: 'switch',
      },
      {
        key: 'maintenance_auto_enabled',
        label: 'adminSettings.rebuildAutoMaintenance',
        desc: 'adminSettings.maintenanceAutoDesc',
        type: 'switch',
      },
      {
        key: 'maintenance_auto_queue_threshold',
        label: 'adminSettings.maintenanceThreshold',
        desc: 'adminSettings.maintenanceThresholdDesc',
        type: 'number',
        min: 1,
        max: 100000,
      },
      {
        key: 'maintenance_title',
        label: 'adminSettings.maintenanceTitle',
        desc: 'adminSettings.maintenanceHeading',
        type: 'text',
      },
      {
        key: 'maintenance_message',
        label: 'adminSettings.maintenanceDescription',
        desc: 'adminSettings.maintenanceBody',
        type: 'textarea',
      },
      {
        key: 'conversion_worker_concurrency',
        label: 'adminSettings.convertConcurrency',
        desc: 'adminSettings.convertConcurrencyDesc',
        type: 'number',
        min: 1,
        max: 8,
      },
      {
        key: 'api_rate_limit',
        label: 'adminSettings.apiRateLimit',
        desc: 'adminSettings.apiRateLimitDesc',
        type: 'number',
        min: 100,
        max: 100000,
      },
      {
        key: 'backup_auto_enabled',
        label: 'adminSettings.autoDailyBackup',
        desc: 'adminSettings.autoBackupDesc',
        type: 'switch',
      },
      {
        key: 'backup_schedule_time',
        label: 'adminSettings.autoBackupTime',
        desc: 'adminSettings.autoBackupTimeHint',
        type: 'text',
      },
      {
        key: 'backup_retention_count',
        label: 'adminSettings.backupRetention',
        desc: 'adminSettings.backupRetentionDesc',
        type: 'number',
        min: 1,
        max: 60,
      },
      {
        key: 'backup_mirror_enabled',
        label: 'adminSettings.mirrorBackup',
        desc: 'adminSettings.mirrorDirDesc',
        type: 'switch',
      },
      {
        key: 'backup_mirror_dir',
        label: 'adminSettings.mirrorDir',
        desc: 'adminSettings.mirrorDirPathEg',
        type: 'text',
      },
    ],
  },
];

const SETTINGS_NAV_GROUPS = [
  {
    title: 'adminSettings.groupBasic',
    icon: 'tune',
    sections: [
      'adminSettings.tabSiteBrand',
      'adminSettings.tabAppearance',
      'adminSettings.tabAnnouncement',
      'adminSettings.tabMenuConfig',
      'adminSettings.tabLegal',
    ],
  },
  {
    title: 'adminSettings.groupAccess',
    icon: 'shield',
    sections: ['adminSettings.tabAccessControl', 'adminSettings.sectionFeatureToggles', 'adminSettings.tabSecurity'],
  },
  {
    title: 'adminSettings.groupBusiness',
    icon: 'inventory_2',
    sections: [
      'adminSettings.tabDownloadShare',
      'adminSettings.tab3dPreview',
      'adminSettings.tabSelection',
      'adminSettings.tabBizDict',
      'adminSettings.tabUploadLimits',
      'adminSettings.tabEmail',
    ],
  },
  {
    title: 'adminSettings.groupStorage',
    icon: 'database',
    sections: [...CACHE_STORAGE_SECTION_TITLES, 'adminSettings.tabCacheCleanup'],
  },
  {
    title: 'adminSettings.groupOperations',
    icon: 'build',
    sections: ['adminSettings.tabOpsMaintenance', 'adminSettings.tabBackup', 'adminSettings.tabAboutSystem'],
  },
] as const;

type SettingItemSection = {
  title: string;
  items: SettingItem[];
};

function splitSettingGroupSections(group: SettingGroup): SettingItemSection[] {
  const sections: SettingItemSection[] = [];
  let current: SettingItemSection = { title: 'adminSettings.groupBasic', items: [] };
  for (const item of group.items) {
    if (isSection(item)) {
      if (current.items.length > 0) sections.push(current);
      current = { title: item._section, items: [] };
      continue;
    }
    current.items.push(item);
  }
  if (current.items.length > 0) sections.push(current);
  return sections;
}

// ── 3D Preview sub-tabs & material preset definitions ──
type PreviewSubtab = 'general' | 'edge' | 'measure' | 'light' | 'material';
type MaterialPresetKey = 'original' | 'default' | 'metal' | 'plastic' | 'glass';

const PREVIEW_SUBTABS: { key: PreviewSubtab; label: string; icon: string }[] = [
  { key: 'general', label: 'adminSettings.previewTabGeneral', icon: 'tune' },
  { key: 'edge', label: 'adminSettings.viewerEdges', icon: 'content_cut' },
  { key: 'measure', label: 'adminSettings.previewTabMeasure', icon: 'straighten' },
  { key: 'light', label: 'adminSettings.previewTabLight', icon: 'light_mode' },
  { key: 'material', label: 'adminSettings.previewTabMaterial', icon: 'palette' },
];

const MAT_PRESET_OPTIONS: { value: MaterialPresetKey; label: string }[] = [
  { value: 'original', label: 'adminSettings.matPresetOriginal' },
  { value: 'default', label: 'adminSettings.colorSmartGray' },
  { value: 'metal', label: 'adminSettings.matPresetMetal' },
  { value: 'plastic', label: 'adminSettings.matPresetPlastic' },
  { value: 'glass', label: 'adminSettings.matPresetGlass' },
];

const PREVIEW_TAB_ITEMS: Record<Exclude<PreviewSubtab, 'material'>, SystemSettingItem[]> = {
  general: [
    {
      key: 'viewer_default_preset',
      label: 'adminSettings.defaultMatPreset',
      desc: 'adminSettings.defaultMatPresetDesc',
      type: 'select',
      options: MAT_PRESET_OPTIONS,
    },
    { key: 'viewer_visible_presets', label: '__preset_checkboxes__', desc: '', type: 'text' },
  ],
  edge: [
    {
      key: 'viewer_edge_enabled',
      label: 'adminSettings.showEdges',
      desc: 'adminSettings.showEdgesOffDesc',
      type: 'switch',
    },
    {
      key: 'viewer_edge_threshold_angle',
      label: 'adminSettings.edgeAngle',
      desc: 'adminSettings.edgeAngleDesc',
      type: 'range',
      min: 1,
      max: 89,
      step: 1,
    },
    {
      key: 'viewer_edge_vertex_limit',
      label: 'adminSettings.edgeVertexLimit',
      desc: 'adminSettings.edgeVertexLimitDesc',
      type: 'number',
      min: 0,
      max: 5000000,
    },
    { key: 'viewer_edge_color', label: 'adminSettings.edgeColor', desc: 'adminSettings.edgeColorDesc', type: 'color' },
    {
      key: 'viewer_edge_opacity',
      label: 'adminSettings.edgeOpacity',
      desc: 'adminSettings.edgeOpacityHint',
      type: 'range',
      min: 0.1,
      max: 1.0,
      step: 0.05,
    },
    {
      key: 'viewer_edge_width',
      label: 'adminSettings.edgeWidth',
      desc: 'adminSettings.edgeWidthHint',
      type: 'range',
      min: 1,
      max: 5,
      step: 0.1,
    },
  ],
  measure: [
    {
      key: 'viewer_measure_default_unit',
      label: 'adminSettings.measureDefaultUnit',
      desc: 'adminSettings.measureUnitDesc',
      type: 'select',
      options: [
        { value: 'auto', label: 'adminSettings.themeAuto' },
        { value: 'mm', label: 'adminSettings.unitMillimeter' },
        { value: 'cm', label: 'adminSettings.unitCentimeter' },
        { value: 'm', label: 'adminSettings.unitMeter' },
      ],
    },
    {
      key: 'viewer_measure_record_limit',
      label: 'adminSettings.measureHistoryLimit',
      desc: 'adminSettings.measureHistoryDesc',
      type: 'range',
      min: 1,
      max: 100,
      step: 1,
    },
  ],
  light: [
    {
      key: 'viewer_exposure',
      label: 'adminSettings.exposure',
      desc: 'adminSettings.exposureDesc',
      type: 'range',
      min: 0.1,
      max: 3.0,
      step: 0.05,
    },
    {
      key: 'viewer_ambient_intensity',
      label: 'adminSettings.lightAmbientIntensity',
      desc: 'adminSettings.lightAmbientDesc',
      type: 'range',
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    {
      key: 'viewer_main_light_intensity',
      label: 'adminSettings.lightMainIntensity',
      desc: 'adminSettings.lightMainDesc',
      type: 'range',
      min: 0,
      max: 3.0,
      step: 0.05,
    },
    {
      key: 'viewer_fill_light_intensity',
      label: 'adminSettings.lightFillIntensity',
      desc: 'adminSettings.lightFillDesc',
      type: 'range',
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    {
      key: 'viewer_hemisphere_intensity',
      label: 'adminSettings.lightHemiIntensity',
      desc: 'adminSettings.lightHemiDesc',
      type: 'range',
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    { key: 'viewer_bg_color', label: 'adminSettings.bgColor', desc: 'adminSettings.viewerBgDesc', type: 'text' },
  ],
};

interface MatPresetField {
  key: keyof SystemSettings;
  label: string;
  desc: string;
  type: 'range' | 'color';
  min?: number;
  max?: number;
  step?: number;
  canEmpty?: boolean;
}

const MAT_PRESET_FIELDS: Record<MaterialPresetKey, MatPresetField[]> = {
  original: [
    {
      key: 'mat_original_color',
      label: 'adminSettings.colorLabel',
      desc: 'adminSettings.emptyUseModelColor',
      type: 'color',
      canEmpty: true,
    },
    {
      key: 'mat_original_metalness',
      label: 'adminSettings.matMetalness',
      desc: 'adminSettings.emptyUseOriginal',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      canEmpty: true,
    },
    {
      key: 'mat_original_roughness',
      label: 'adminSettings.matRoughness',
      desc: 'adminSettings.emptyUseOriginal',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      canEmpty: true,
    },
    {
      key: 'mat_original_envMapIntensity',
      label: 'adminSettings.matEnvMap',
      desc: 'adminSettings.emptyUseOriginal',
      type: 'range',
      min: 0,
      max: 3,
      step: 0.01,
      canEmpty: true,
    },
  ],
  default: [
    { key: 'mat_default_color', label: 'adminSettings.colorLabel', desc: '', type: 'color' },
    {
      key: 'mat_default_metalness',
      label: 'adminSettings.matMetalness',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_default_roughness',
      label: 'adminSettings.matRoughness',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_default_envMapIntensity',
      label: 'adminSettings.matEnvMap',
      desc: '',
      type: 'range',
      min: 0,
      max: 3,
      step: 0.01,
    },
  ],
  metal: [
    { key: 'mat_metal_color', label: 'adminSettings.colorLabel', desc: '', type: 'color' },
    {
      key: 'mat_metal_metalness',
      label: 'adminSettings.matMetalness',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_metal_roughness',
      label: 'adminSettings.matRoughness',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_metal_envMapIntensity',
      label: 'adminSettings.matEnvMap',
      desc: '',
      type: 'range',
      min: 0,
      max: 3,
      step: 0.01,
    },
  ],
  plastic: [
    { key: 'mat_plastic_color', label: 'adminSettings.colorLabel', desc: '', type: 'color' },
    {
      key: 'mat_plastic_metalness',
      label: 'adminSettings.matMetalness',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_plastic_roughness',
      label: 'adminSettings.matRoughness',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_plastic_envMapIntensity',
      label: 'adminSettings.matEnvMap',
      desc: '',
      type: 'range',
      min: 0,
      max: 3,
      step: 0.01,
    },
  ],
  glass: [
    { key: 'mat_glass_color', label: 'adminSettings.colorLabel', desc: '', type: 'color' },
    {
      key: 'mat_glass_metalness',
      label: 'adminSettings.matMetalness',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_glass_roughness',
      label: 'adminSettings.matRoughness',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_glass_envMapIntensity',
      label: 'adminSettings.matEnvMap',
      desc: '',
      type: 'range',
      min: 0,
      max: 3,
      step: 0.01,
    },
    {
      key: 'mat_glass_transmission',
      label: 'adminSettings.matTransmission',
      desc: '',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      key: 'mat_glass_ior',
      label: 'adminSettings.matRefraction',
      desc: '',
      type: 'range',
      min: 1,
      max: 2.5,
      step: 0.01,
    },
    {
      key: 'mat_glass_thickness',
      label: 'adminSettings.paramThickness',
      desc: '',
      type: 'range',
      min: 0,
      max: 5,
      step: 0.01,
    },
  ],
};

// All 3D preview setting keys (used by reset-to-defaults)
const PREVIEW_SETTING_KEYS: (keyof SystemSettings)[] = [
  'viewer_default_preset',
  'viewer_visible_presets',
  'viewer_edge_enabled',
  'viewer_edge_threshold_angle',
  'viewer_edge_vertex_limit',
  'viewer_edge_color',
  'viewer_edge_opacity',
  'viewer_edge_width',
  'viewer_measure_default_unit',
  'viewer_measure_record_limit',
  'viewer_exposure',
  'viewer_ambient_intensity',
  'viewer_main_light_intensity',
  'viewer_fill_light_intensity',
  'viewer_hemisphere_intensity',
  'viewer_bg_color',
  'mat_original_color',
  'mat_original_metalness',
  'mat_original_roughness',
  'mat_original_envMapIntensity',
  'mat_default_color',
  'mat_default_metalness',
  'mat_default_roughness',
  'mat_default_envMapIntensity',
  'mat_metal_color',
  'mat_metal_metalness',
  'mat_metal_roughness',
  'mat_metal_envMapIntensity',
  'mat_plastic_color',
  'mat_plastic_metalness',
  'mat_plastic_roughness',
  'mat_plastic_envMapIntensity',
  'mat_glass_color',
  'mat_glass_metalness',
  'mat_glass_roughness',
  'mat_glass_envMapIntensity',
  'mat_glass_transmission',
  'mat_glass_ior',
  'mat_glass_thickness',
];

/** Shared progress card — used by backup create, restore, import-restore, import-save, update */
const PROGRESS_COLORS: Record<string, string> = {
  'primary-container': 'var(--color-primary-container)',
  primary: 'var(--color-primary)',
  'emerald-500': '#10b981',
  error: 'var(--color-error)',
};

function TaskProgressCard({
  progress,
  color = 'primary-container',
}: {
  progress: { message: string; percent: number; logs?: string[] };
  color?: string;
}) {
  const { t } = useTranslation();
  const MAX_DISPLAY_LOGS = 200;
  const displayLogs = (progress.logs || []).slice(-MAX_DISPLAY_LOGS);
  const barColor = PROGRESS_COLORS[color] || color;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1">
        <span>{progress.message || t('adminSettings.processing')}</span>
        <span>{progress.percent}%</span>
      </div>
      <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progress.percent}%`, backgroundColor: barColor }}
        />
      </div>
      {displayLogs.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto bg-surface-container-highest/50 rounded p-2 text-[11px] font-mono text-on-surface-variant/70 space-y-0.5">
          {displayLogs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsLoadingState() {
  const { t } = useTranslation();
  return (
    <AdminManagementPage title={t('adminSettings.pageTitle')} description={t('adminSettings.tabAccessControlDesc')}>
      <div className="flex min-h-[360px] flex-1">
        <PageRefreshIndicator label={t('adminSettings.settingsRefreshing')} />
      </div>
    </AdminManagementPage>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return <AppSwitch checked={checked} onChange={onChange} disabled={disabled} />;
}

/**
 * 只读设置项的静态展示——这些值由环境变量/基础设施决定，不可在界面修改。
 * 用状态徽章/等宽文本呈现，而非可点的开关/下拉/输入框，避免「能点不能改」的误导。
 */
function ReadonlySettingValue({ item, value }: { item: SettingItem; value: unknown }) {
  const { t } = useTranslation();
  if (item.type === 'switch') {
    const on = Boolean(value);
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
          on ? 'bg-primary-container/15 text-primary-container' : 'bg-surface-container-high text-on-surface-variant'
        }`}
      >
        <Icon name={on ? 'check_circle' : 'remove_circle'} size={13} />
        {on ? t('adminSettings.statusEnabled') : t('adminSettings.statusDisabled')}
      </span>
    );
  }
  if (item.type === 'select') {
    const opt = item.options?.find((o) => String(o.value) === String(value));
    const label = opt?.label ?? (value === '' || value == null ? '—' : String(value));
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-surface-container-high text-on-surface">
        {label}
      </span>
    );
  }
  // text / number
  const sensitive = isSensitiveTextSettingKey(item.key);
  const empty = value === '' || value === null || value === undefined;
  const text = empty ? '—' : sensitive ? '••••••' : String(value);
  return (
    <span className="inline-flex items-center min-w-0 font-mono text-xs px-2.5 py-1 rounded-md bg-surface-container-high/60 text-on-surface-variant break-all">
      {text}
    </span>
  );
}

function InterfaceThemePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const themes = Object.values(INTERFACE_THEME_CATALOG);
  return (
    <div className="grid w-full max-w-3xl gap-2 md:grid-cols-2">
      {themes.map((theme) => {
        const selected = value === theme.key;
        return (
          <button
            key={theme.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(theme.key)}
            className={`group flex min-h-[76px] items-center gap-3 overflow-hidden rounded-lg border p-2 text-left transition-colors ${
              selected
                ? 'border-primary bg-primary-container/10 shadow-sm'
                : 'border-outline-variant/20 bg-surface-container-lowest hover:border-primary/50'
            }`}
          >
            <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-surface-container sm:h-16 sm:w-24">
              {theme.screenshot ? (
                <SafeImage
                  src={theme.screenshot}
                  alt={t('themeMeta.themePreviewAlt', { defaultValue: '{{name}} 预览', name: theme.label })}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  fallbackIcon="palette"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-on-surface-variant">
                  <Icon name="palette" size={22} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-on-surface">
                  {t(`themeMeta.${theme.key}.label`, { defaultValue: theme.label })}
                </span>
                {selected ? <Icon name="check_circle" size={18} className="text-primary" /> : null}
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-on-surface-variant">
                {t(`themeMeta.${theme.key}.description`, { defaultValue: theme.description })}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

type SettingUpdater = (key: keyof SystemSettings, value: boolean | number | string) => void;

type FooterLinkConfig = { label: string; url: string };
type EmailTemplateConfig = {
  label: string;
  description: string;
  subject: string;
  html: string;
  tokens: string[];
};
type PageSizePolicy = {
  selectionDefault: number;
  selectionMax: number;
  homeDefault: number;
  homeMax: number;
  homeOption1: number;
  homeOption2: number;
  homeOption3: number;
  homeOption4: number;
  selectionAdminRenderBatch: number;
  selectionGeneratePreviewPageSize: number;
  inquiryAdminDefault: number;
  inquiryAdminMax: number;
  ticketListMax: number;
  notificationDefault: number;
  notificationMax: number;
  adminUserDefault: number;
  adminUserMax: number;
  shareAdminDefault: number;
  shareAdminMax: number;
  auditDefault: number;
  auditMax: number;
  userBatchDownloadMax: number;
  adminBatchDownloadMax: number;
};

const emailShellStart = `<div style="max-width:560px;margin:0 auto;background:#ffffff;font-family:Arial,'Microsoft YaHei',sans-serif;color:#1f2937;">
  <div style="padding:24px 28px 18px;border-bottom:1px solid #f3f4f6;">
    <a href="{{actionUrl}}" style="display:inline-flex;align-items:center;gap:12px;text-decoration:none;color:#111827;">
      <img src="{{siteLogo}}" alt="{{siteTitle}}" style="height:36px;max-width:160px;object-fit:contain;border:0;vertical-align:middle;" />
      <strong style="font-size:18px;line-height:1.2;">{{siteTitle}}</strong>
    </a>
  </div>
  <div style="padding:28px;">`;

const emailShellEnd = `  </div>
  <div style="padding:18px 28px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px;line-height:1.7;">
    <div style="margin:0 0 12px;"><a href="{{actionUrl}}" style="display:inline-block;padding:9px 14px;border-radius:8px;background:#f97316;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">{{actionLabel}}</a></div>
    <div>入口：<a href="{{actionUrl}}" style="color:#f97316;text-decoration:none;">{{actionUrl}}</a></div>
    <div>如需帮助，请联系 {{contactEmail}}</div>
    <div>&copy; {{currentYear}} {{siteTitle}}</div>
  </div>
</div>`;

const commonEmailTokens = [
  'siteTitle',
  'siteLogo',
  'siteUrl',
  'actionUrl',
  'actionLabel',
  'contactEmail',
  'currentYear',
  'email',
];

const DEFAULT_EMAIL_TEMPLATES: Record<string, EmailTemplateConfig> = {
  register_verify: {
    label: 'adminSettings.featureRegisterEmailCode',
    description: 'adminSettings.registerEmailCodeDesc',
    subject: 'adminSettings.notifyRegisterCode',
    html: `${emailShellStart}
  <h2 style="margin:0 0 18px;color:#111827;">注册验证码</h2>
  <p style="margin:0 0 12px;font-size:15px;">您的注册验证码为：</p>
  <div style="margin:18px 0;padding:18px;border-radius:10px;background:#fff7ed;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#f97316;">{{code}}</div>
  <p style="margin:0;color:#6b7280;font-size:13px;">验证码 {{expireMinutes}} 分钟内有效，请勿泄露给他人。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'code', 'expireMinutes'],
  },
  smtp_test: {
    label: 'adminSettings.emailTestPanel',
    description: 'adminSettings.testEmailPurpose',
    subject: 'adminSettings.notifyTestEmail',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;color:#f97316;">邮件服务测试成功</h2>
  <p style="margin:0 0 10px;">这是一封来自 {{siteTitle}} 的测试邮件。</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">发送时间：{{testTime}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'testTime'],
  },
  inquiry_submitted: {
    label: 'adminSettings.notifyPrefInquiryCreated',
    description: 'adminSettings.inquiryConfirmEmailDesc',
    subject: 'adminSettings.notifyInquiryReceived',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价已提交</h2>
  <p style="margin:0 0 10px;">您好 {{username}}，我们已收到您的询价。</p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">我们会尽快处理并与您联系。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'inquiryNo'],
  },
  inquiry_status_changed: {
    label: 'adminSettings.notifyPrefInquiryStatus',
    description: 'adminSettings.notifyInquiryStatusDesc',
    subject: 'adminSettings.notifyInquiryStatusUpdated',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价状态已更新</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">当前状态：<strong>{{statusLabel}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">您可以登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'inquiryNo', 'statusLabel'],
  },
  ticket_created: {
    label: 'adminSettings.notifyPrefTicketCreated',
    description: 'adminSettings.ticketConfirmEmailDesc',
    subject: 'adminSettings.notifyTicketReceived',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">工单已创建</h2>
  <p style="margin:0 0 10px;">您好 {{username}}，您的工单已进入处理队列。</p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">我们会尽快回复。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'ticketTitle'],
  },
  ticket_replied: {
    label: 'adminSettings.notifyPrefTicketReply',
    description: 'adminSettings.notifyUserAdminTicketReplyDesc',
    subject: 'adminSettings.notifyTicketNewReply',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">工单有新回复</h2>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看完整内容。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'ticketTitle', 'replyPreview'],
  },
  ticket_status_changed: {
    label: 'adminSettings.notifyPrefTicketStatus',
    description: 'adminSettings.notifyTicketStatusDesc',
    subject: 'adminSettings.notifyTicketStatusUpdated',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">工单状态已更新</h2>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">当前状态：<strong>{{statusLabel}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'ticketTitle', 'statusLabel'],
  },
  ticket_admin_new: {
    label: 'adminSettings.notifyNewTicket',
    description: 'adminSettings.notifyAdminTicketCreatedDesc',
    subject: 'adminSettings.notifyNewTicketPending',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">有新的工单需要处理</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录后台查看并处理。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'ticketTitle'],
  },
  ticket_admin_replied: {
    label: 'adminSettings.notifyUserTicketReply',
    description: 'adminSettings.notifyAdminUserTicketReplyDesc',
    subject: 'adminSettings.notifyTicketNewUserReply',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">工单有新的用户回复</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'ticketTitle', 'replyPreview'],
  },
  inquiry_replied: {
    label: 'adminSettings.notifyPrefInquiryReply',
    description: 'adminSettings.notifyUserAdminInquiryReplyDesc',
    subject: 'adminSettings.notifyInquiryNewReply',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价有新回复</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看完整内容。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'inquiryNo', 'replyPreview'],
  },
  inquiry_admin_new: {
    label: 'adminSettings.notifyNewInquiry',
    description: 'adminSettings.notifyAdminInquiryCreatedDesc',
    subject: 'adminSettings.notifyNewInquiry',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">有新的询价单</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">产品数量：<strong>{{itemCount}}</strong></p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'inquiryNo', 'itemCount'],
  },
  inquiry_admin_replied: {
    label: 'adminSettings.notifyUserInquiryReply',
    description: 'adminSettings.notifyAdminUserInquiryReplyDesc',
    subject: 'adminSettings.notifyInquiryNewUserReply',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价有新的用户回复</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'inquiryNo', 'replyPreview'],
  },
  inquiry_assigned: {
    label: 'adminSettings.notifyPrefInquiryTransfer',
    description: 'adminSettings.notifyInquiryTransferDesc',
    subject: 'adminSettings.notifyInquiryTransferred',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价已转交处理</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">对接人：<strong>{{assigneeName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'inquiryNo', 'assigneeName'],
  },
  favorite_notice: {
    label: 'adminSettings.notifyModelFavorites',
    description: 'adminSettings.notifyOnFavoriteDesc',
    subject: 'adminSettings.notifyModelFavorited',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">您的模型被收藏</h2>
  <p style="margin:0 0 10px;">模型名称：<strong>{{modelName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">您可以登录 {{siteTitle}} 查看模型详情。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'modelName'],
  },
  model_conversion_completed: {
    label: 'adminSettings.convertCompleted',
    description: 'adminSettings.notifyOnConvertDoneDesc',
    subject: 'adminSettings.notifyConvertDone',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">模型转换完成</h2>
  <p style="margin:0 0 10px;">模型文件：<strong>{{modelName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">现在可以预览和下载。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'modelName'],
  },
  model_conversion_failed: {
    label: 'adminSettings.convertFailed',
    description: 'adminSettings.notifyOnConvertFailDesc',
    subject: 'adminSettings.notifyConvertFailed',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;color:#dc2626;">模型转换失败</h2>
  <p style="margin:0 0 10px;">模型文件：<strong>{{modelName}}</strong></p>
  <p style="margin:0 0 10px;">失败原因：{{errorMessage}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'modelName', 'errorMessage'],
  },
  backup_policy_alert: {
    label: 'adminSettings.backupCheckNotify',
    description: 'adminSettings.backupCheckNotifyDesc',
    subject: 'adminSettings.notifyBackupCheckAttention',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;color:#f97316;">备份体检需要关注</h2>
  <p style="margin:0 0 10px;">风险等级：<strong>{{riskLevel}}</strong></p>
  <p style="margin:0 0 10px;">{{summary}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'riskLevel', 'summary'],
  },
  download_notice: {
    label: 'adminSettings.notifyModelDownloads',
    description: 'adminSettings.notifyOnDownloadDesc',
    subject: 'adminSettings.notifyModelDownloaded',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">您的模型被下载</h2>
  <p style="margin:0 0 10px;">模型名称：<strong>{{modelName}}</strong></p>
  <p style="margin:0 0 10px;">下载格式：{{downloadFormat}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'modelName', 'downloadFormat'],
  },
};

const DEFAULT_PAGE_SIZE_POLICY: PageSizePolicy = {
  selectionDefault: 50,
  selectionMax: 50000,
  homeDefault: 20,
  homeMax: 10000,
  homeOption1: 20,
  homeOption2: 40,
  homeOption3: 60,
  homeOption4: 120,
  selectionAdminRenderBatch: 120,
  selectionGeneratePreviewPageSize: 50,
  inquiryAdminDefault: 20,
  inquiryAdminMax: 100,
  ticketListMax: 50,
  notificationDefault: 20,
  notificationMax: 100,
  adminUserDefault: 20,
  adminUserMax: 100,
  shareAdminDefault: 20,
  shareAdminMax: 100,
  auditDefault: 50,
  auditMax: 100,
  userBatchDownloadMax: 100,
  adminBatchDownloadMax: 50,
};

const STRUCTURED_SETTING_KEYS = new Set<keyof SystemSettings>([
  'footer_links',
  'legal_privacy_sections',
  'legal_terms_sections',
  'selection_thread_priority',
  'inquiry_statuses',
  'ticket_statuses',
  'ticket_classifications',
  'support_process_steps',
  'nav_items',
  'nav_mobile_items',
  'upload_policy',
  'page_size_policy',
  'email_templates',
]);

const SENSITIVE_TEXT_SETTING_KEYS = new Set<keyof SystemSettings>([
  'smtp_pass',
  'redis_password',
  'storage_access_key_secret',
]);

function isSensitiveTextSettingKey(key: SettingItem['key']): key is keyof SystemSettings {
  return isSystemSettingKey(key) && SENSITIVE_TEXT_SETTING_KEYS.has(key);
}

/**
 * 后端不实际执行、仅由环境变量或基础设施控制的设置项。在 updateSetting 中拒绝修改，
 * 使其在前端真正「只读」——与 label 的「（只读）」标注一致，避免 admin 误以为修改生效。
 */
const READONLY_SETTING_KEYS = new Set<keyof SystemSettings>([
  'cache_enabled',
  'cache_driver',
  'redis_url',
  'redis_password',
  'redis_db',
  'redis_key_prefix',
  'redis_tls_enabled',
  'storage_signed_url_enabled',
  'storage_signed_url_ttl_seconds',
  'storage_upload_multipart_mb',
  'resource_download_acceleration_enabled',
]);

/** 由环境变量/基础设施决定、不可在界面修改的设置项——渲染为静态信息，而非可点的假控件。 */
function isReadonlySettingItem(item: SettingItem): boolean {
  return isSystemSettingKey(item.key) && READONLY_SETTING_KEYS.has(item.key);
}

const inputClass =
  'w-full min-w-0 bg-surface-container-lowest text-on-surface text-xs rounded-md px-2.5 py-1.5 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30';
const numberInputClass = `${inputClass} text-center`;
const compactListClass = 'space-y-2 w-full max-w-5xl';
const compactPanelClass = 'p-2.5 rounded-lg bg-surface-container-high/30 border border-outline-variant/10';

function normalizeFooterLinks(value: unknown, clean = false): FooterLinkConfig[] {
  const parsed = parseSetting<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  const links = parsed.map((item) => {
    const row = item && typeof item === 'object' ? (item as Partial<FooterLinkConfig>) : {};
    return {
      label: typeof row.label === 'string' ? row.label : '',
      url: typeof row.url === 'string' ? row.url : '',
    };
  });
  if (!clean) return links;
  return links
    .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
    .filter((link) => link.label && link.url);
}

function serializeFooterLinks(value: unknown, clean = false): string {
  return JSON.stringify(normalizeFooterLinks(value, clean), null, 2);
}

function getSettingsSiteTitle(settings: Partial<SystemSettings>): string {
  return String(settings.site_title || '3DPartHub').trim() || '3DPartHub';
}

function resolveFooterCopyright(settings: Partial<SystemSettings>): string {
  return buildFooterCopyright(getSettingsSiteTitle(settings));
}

function resolveModelDetailCopyright(settings: Partial<SystemSettings>): string {
  return buildModelDetailCopyright(getSettingsSiteTitle(settings));
}

function normalizeSettingsForClient(settings: Partial<SystemSettings>): SystemSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings } as SystemSettings;
  const footerFollowsSiteTitle = merged.footer_copyright_follow_site_title !== false;
  const modelDetailFollowsSiteTitle = merged.model_detail_copyright_follow_site_title !== false;
  return {
    ...merged,
    footer_links: serializeFooterLinks(merged.footer_links),
    footer_copyright: String(merged.footer_copyright || DEFAULT_FOOTER_COPYRIGHT),
    footer_copyright_follow_site_title: footerFollowsSiteTitle,
    model_detail_disclaimer: String(merged.model_detail_disclaimer || DEFAULT_MODEL_DETAIL_DISCLAIMER),
    model_detail_copyright: String(merged.model_detail_copyright || DEFAULT_MODEL_DETAIL_COPYRIGHT),
    model_detail_copyright_follow_site_title: modelDetailFollowsSiteTitle,
  };
}

function pickPublicAppearanceSettings(settings: SystemSettings): Partial<SystemSettings> {
  return Object.fromEntries(
    PUBLIC_APPEARANCE_SETTING_KEYS.map((key) => [key, settings[key]]),
  ) as Partial<SystemSettings>;
}

function setJsonSetting<T>(updateSetting: SettingUpdater, key: keyof SystemSettings, value: T) {
  updateSetting(key, JSON.stringify(value, null, 2));
}

function moveListItem<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function parseCsv(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = toNumber(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

function numberSettingUnit(key: keyof SystemSettings) {
  if (key === 'redis_db') return 'DB';
  if (key === 'storage_upload_multipart_mb' || key.includes('_mb')) return 'MB';
  if (key === 'storage_upload_concurrency') return i18n.t('adminSettings.unitConcurrency');
  if (key === 'image_thumbnail_quality') return '%';
  if (key === 'image_large_max_width') return 'px';
  if (key.includes('_seconds')) return i18n.t('adminSettings.unitSeconds');
  if (key.includes('_days')) return i18n.t('adminSettings.unitDays');
  if (key.includes('_hour')) return i18n.t('adminSettings.unitPoints');
  if (key.includes('_limit') || key.includes('_count'))
    return key === 'daily_download_limit' ? i18n.t('adminSettings.unitPerDay') : i18n.t('adminSettings.unitItems');
  if (key.includes('_length')) return i18n.t('adminSettings.unitDigits');
  if (key === 'viewer_edge_threshold_angle') return i18n.t('adminSettings.unitDegrees');
  if (key === 'viewer_edge_vertex_limit') return i18n.t('adminSettings.unitVertex');
  if (key === 'smtp_port') return i18n.t('adminSettings.unitPort');
  return '';
}

function normalizePageSizePolicyForSave(value: unknown) {
  const policy = { ...DEFAULT_PAGE_SIZE_POLICY, ...parseSetting<Partial<PageSizePolicy>>(value, {}) };
  const homeOptions = [policy.homeOption1, policy.homeOption2, policy.homeOption3, policy.homeOption4]
    .map((item, index) => clampNumber(item, [30, 60, 120, 180][index] || 60, 1, 100000))
    .sort((a, b) => a - b);
  const normalized: PageSizePolicy = {
    ...policy,
    homeDefault: clampNumber(policy.homeDefault, DEFAULT_PAGE_SIZE_POLICY.homeDefault, 1, 100000),
    homeMax: clampNumber(policy.homeMax, DEFAULT_PAGE_SIZE_POLICY.homeMax, 1, 100000),
    homeOption1: homeOptions[0],
    homeOption2: homeOptions[1],
    homeOption3: homeOptions[2],
    homeOption4: homeOptions[3],
    selectionDefault: clampNumber(policy.selectionDefault, DEFAULT_PAGE_SIZE_POLICY.selectionDefault, 1, 100000),
    selectionMax: clampNumber(policy.selectionMax, DEFAULT_PAGE_SIZE_POLICY.selectionMax, 1, 100000),
    selectionAdminRenderBatch: clampNumber(
      policy.selectionAdminRenderBatch,
      DEFAULT_PAGE_SIZE_POLICY.selectionAdminRenderBatch,
      20,
      5000,
    ),
    selectionGeneratePreviewPageSize: clampNumber(
      policy.selectionGeneratePreviewPageSize,
      DEFAULT_PAGE_SIZE_POLICY.selectionGeneratePreviewPageSize,
      1,
      5000,
    ),
    inquiryAdminDefault: clampNumber(policy.inquiryAdminDefault, DEFAULT_PAGE_SIZE_POLICY.inquiryAdminDefault, 1, 1000),
    inquiryAdminMax: clampNumber(policy.inquiryAdminMax, DEFAULT_PAGE_SIZE_POLICY.inquiryAdminMax, 1, 5000),
    ticketListMax: clampNumber(policy.ticketListMax, DEFAULT_PAGE_SIZE_POLICY.ticketListMax, 1, 5000),
    notificationDefault: clampNumber(policy.notificationDefault, DEFAULT_PAGE_SIZE_POLICY.notificationDefault, 1, 1000),
    notificationMax: clampNumber(policy.notificationMax, DEFAULT_PAGE_SIZE_POLICY.notificationMax, 1, 5000),
    adminUserDefault: clampNumber(policy.adminUserDefault, DEFAULT_PAGE_SIZE_POLICY.adminUserDefault, 1, 1000),
    adminUserMax: clampNumber(policy.adminUserMax, DEFAULT_PAGE_SIZE_POLICY.adminUserMax, 1, 5000),
    shareAdminDefault: clampNumber(policy.shareAdminDefault, DEFAULT_PAGE_SIZE_POLICY.shareAdminDefault, 1, 1000),
    shareAdminMax: clampNumber(policy.shareAdminMax, DEFAULT_PAGE_SIZE_POLICY.shareAdminMax, 1, 5000),
    auditDefault: clampNumber(policy.auditDefault, DEFAULT_PAGE_SIZE_POLICY.auditDefault, 1, 1000),
    auditMax: clampNumber(policy.auditMax, DEFAULT_PAGE_SIZE_POLICY.auditMax, 1, 5000),
    userBatchDownloadMax: clampNumber(
      policy.userBatchDownloadMax,
      DEFAULT_PAGE_SIZE_POLICY.userBatchDownloadMax,
      1,
      5000,
    ),
    adminBatchDownloadMax: clampNumber(
      policy.adminBatchDownloadMax,
      DEFAULT_PAGE_SIZE_POLICY.adminBatchDownloadMax,
      1,
      5000,
    ),
  };
  normalized.homeMax = Math.max(normalized.homeMax, normalized.homeDefault, normalized.homeOption4);
  normalized.selectionMax = Math.max(normalized.selectionMax, normalized.selectionDefault);
  normalized.inquiryAdminMax = Math.max(normalized.inquiryAdminMax, normalized.inquiryAdminDefault);
  normalized.notificationMax = Math.max(normalized.notificationMax, normalized.notificationDefault);
  normalized.adminUserMax = Math.max(normalized.adminUserMax, normalized.adminUserDefault);
  normalized.shareAdminMax = Math.max(normalized.shareAdminMax, normalized.shareAdminDefault);
  normalized.auditMax = Math.max(normalized.auditMax, normalized.auditDefault);
  return normalized;
}

function normalizeUploadPolicyForSave(value: unknown) {
  const policy = { ...DEFAULT_UPLOAD_POLICY, ...parseSetting<Partial<UploadPolicy>>(value, {}) };
  const supportedFormats = new Set(DEFAULT_UPLOAD_POLICY.modelFormats);
  return {
    ...policy,
    modelFormats: Array.from(
      new Set(
        parseCsv(policy.modelFormats)
          .map((item) => item.toLowerCase())
          .filter((item) => supportedFormats.has(item)),
      ),
    ),
    modelMaxSizeMb: clampNumber(policy.modelMaxSizeMb, DEFAULT_UPLOAD_POLICY.modelMaxSizeMb, 1, 102400),
    chunkSizeMb: clampNumber(policy.chunkSizeMb, DEFAULT_UPLOAD_POLICY.chunkSizeMb, 1, 1024),
    chunkThresholdMb: clampNumber(policy.chunkThresholdMb, DEFAULT_UPLOAD_POLICY.chunkThresholdMb, 1, 102400),
    optionImageMaxSizeMb: clampNumber(policy.optionImageMaxSizeMb, DEFAULT_UPLOAD_POLICY.optionImageMaxSizeMb, 1, 100),
    selectionPdfMaxSizeMb: clampNumber(
      policy.selectionPdfMaxSizeMb,
      DEFAULT_UPLOAD_POLICY.selectionPdfMaxSizeMb,
      1,
      200,
    ),
    selectionImportMaxSizeMb: clampNumber(
      policy.selectionImportMaxSizeMb,
      DEFAULT_UPLOAD_POLICY.selectionImportMaxSizeMb,
      1,
      100,
    ),
    selectionImportMaxRows: clampNumber(
      policy.selectionImportMaxRows,
      DEFAULT_UPLOAD_POLICY.selectionImportMaxRows,
      1,
      200000,
    ),
    selectionImportMaxColumns: clampNumber(
      policy.selectionImportMaxColumns,
      DEFAULT_UPLOAD_POLICY.selectionImportMaxColumns,
      1,
      1000,
    ),
    productWallImageMaxSizeMb: clampNumber(
      policy.productWallImageMaxSizeMb,
      DEFAULT_UPLOAD_POLICY.productWallImageMaxSizeMb,
      1,
      50,
    ),
    productWallUploadMaxFiles: clampNumber(
      policy.productWallUploadMaxFiles,
      DEFAULT_UPLOAD_POLICY.productWallUploadMaxFiles,
      1,
      50,
    ),
    ticketAttachmentMaxSizeMb: clampNumber(
      policy.ticketAttachmentMaxSizeMb,
      DEFAULT_UPLOAD_POLICY.ticketAttachmentMaxSizeMb,
      1,
      100,
    ),
    ticketAttachmentExts: parseCsv(policy.ticketAttachmentExts).map((item) =>
      item.startsWith('.') ? item : `.${item}`,
    ),
  };
}

function parseEditableLegalSections(value: unknown, fallback: LegalSection[]) {
  const source =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;
  if (!Array.isArray(source)) return fallback;
  const rows = source.map((item) => {
    const section = item && typeof item === 'object' ? (item as Partial<LegalSection>) : {};
    return {
      title: typeof section.title === 'string' ? section.title : '',
      content: typeof section.content === 'string' ? section.content : '',
    };
  });
  return rows.length > 0 ? rows : fallback;
}

function normalizeLegalSectionsForSave(value: unknown, fallback: LegalSection[]) {
  const sections = parseEditableLegalSections(value, fallback)
    .map((section) => ({ title: section.title.trim(), content: section.content.trim() }))
    .filter((section) => section.title && section.content);
  return sections.length > 0 ? sections : fallback;
}

function dedupNavItems(json: string): string {
  try {
    const items = JSON.parse(json);
    if (!Array.isArray(items)) return json;
    const seen = new Set<string>();
    const deduped = items.filter((item: { path?: string }) => {
      if (!item.path) return true;
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
    return JSON.stringify(deduped, null, 2);
  } catch {
    return json;
  }
}

function normalizeStringSetting(value: unknown, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

const SUPPORTED_UI_LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE'] as const;

function normalizeUiDefaultLocale(value: unknown): string {
  const locale = String(value || '').trim();
  return SUPPORTED_UI_LOCALES.includes(locale as (typeof SUPPORTED_UI_LOCALES)[number]) ? locale : 'zh-CN';
}

function normalizeUiEnabledLocales(value: unknown): string {
  const locales = Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => SUPPORTED_UI_LOCALES.includes(item as (typeof SUPPORTED_UI_LOCALES)[number])),
    ),
  );
  return locales.length ? locales.join(',') : 'zh-CN,zh-TW,en-US,ja-JP,ko-KR,de-DE';
}

function normalizeContactPhoneSetting(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[－—–]/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ');
}

function isValidContactPhoneSetting(value: unknown): boolean {
  const phone = normalizeContactPhoneSetting(value);
  if (!phone) return true;
  if (phone.length > 32) return false;
  if (!/^\+?[0-9][0-9\s()-]{5,31}$/.test(phone)) return false;

  const digits = phone.replace(/\D/g, '');
  const noSpaceOrParen = phone.replace(/[()\s]/g, '');

  if (/^1[3-9]\d{9}$/.test(digits)) return true;
  if (/^(400|800)-?\d{3}-?\d{4}$/.test(noSpaceOrParen)) return true;
  if (/^0\d{2,3}-?\d{7,8}(-?\d{1,6})?$/.test(noSpaceOrParen)) return true;
  if (phone.startsWith('+') && digits.length >= 8 && digits.length <= 15) return true;

  return false;
}

function validateSettingsBeforeSave(settings: SystemSettings): string | null {
  return isValidContactPhoneSetting(settings.contact_phone) ? null : CONTACT_PHONE_FORMAT_MESSAGE;
}

function normalizeStoragePrefix(value: unknown, fallback: string) {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  return normalized || fallback;
}

function normalizeSettingsForSave(settings: SystemSettings): SystemSettings {
  const usernameMin = clampNumber(settings.security_username_min_length, 2, 1, 64);
  const usernameMax = Math.max(usernameMin, clampNumber(settings.security_username_max_length, 32, 1, 64));
  const footerFollowsSiteTitle = settings.footer_copyright_follow_site_title !== false;
  const modelDetailFollowsSiteTitle = settings.model_detail_copyright_follow_site_title !== false;
  const cacheDriver = CACHE_DRIVER_OPTIONS.some((option) => option.value === settings.cache_driver)
    ? settings.cache_driver
    : DEFAULT_SETTINGS.cache_driver;
  const storageProvider = STORAGE_PROVIDER_OPTIONS.some((option) => option.value === settings.storage_provider)
    ? settings.storage_provider
    : DEFAULT_SETTINGS.storage_provider;
  return {
    ...settings,
    contact_phone: normalizeContactPhoneSetting(settings.contact_phone),
    ui_default_locale: normalizeUiDefaultLocale(settings.ui_default_locale),
    ui_enabled_locales: normalizeUiEnabledLocales(settings.ui_enabled_locales),
    viewer_edge_threshold_angle: clampNumber(settings.viewer_edge_threshold_angle, 28, 1, 89),
    viewer_edge_vertex_limit: clampNumber(settings.viewer_edge_vertex_limit, 700000, 0, 5000000),
    viewer_measure_record_limit: clampNumber(settings.viewer_measure_record_limit, 12, 1, 100),
    viewer_measure_default_unit: ['auto', 'mm', 'cm', 'm'].includes(settings.viewer_measure_default_unit)
      ? settings.viewer_measure_default_unit
      : 'auto',
    security_email_code_cooldown_seconds: clampNumber(settings.security_email_code_cooldown_seconds, 60, 10, 3600),
    security_email_code_ttl_seconds: clampNumber(settings.security_email_code_ttl_seconds, 600, 60, 86400),
    security_captcha_ttl_seconds: clampNumber(settings.security_captcha_ttl_seconds, 300, 60, 3600),
    security_password_min_length: clampNumber(settings.security_password_min_length, 8, 6, 64),
    security_username_min_length: usernameMin,
    security_username_max_length: usernameMax,
    footer_links: serializeFooterLinks(settings.footer_links, true),
    footer_copyright: footerFollowsSiteTitle
      ? resolveFooterCopyright(settings)
      : String(settings.footer_copyright || DEFAULT_FOOTER_COPYRIGHT).trim(),
    footer_copyright_follow_site_title: footerFollowsSiteTitle,
    model_detail_copyright: modelDetailFollowsSiteTitle
      ? resolveModelDetailCopyright(settings)
      : String(settings.model_detail_copyright || DEFAULT_MODEL_DETAIL_COPYRIGHT).trim(),
    model_detail_copyright_follow_site_title: modelDetailFollowsSiteTitle,
    nav_items: dedupNavItems(settings.nav_items),
    nav_mobile_items: dedupNavItems(settings.nav_mobile_items),
    legal_privacy_sections: JSON.stringify(
      normalizeLegalSectionsForSave(settings.legal_privacy_sections, DEFAULT_PRIVACY_SECTIONS),
      null,
      2,
    ),
    legal_terms_sections: JSON.stringify(
      normalizeLegalSectionsForSave(settings.legal_terms_sections, DEFAULT_TERMS_SECTIONS),
      null,
      2,
    ),
    upload_policy: JSON.stringify(normalizeUploadPolicyForSave(settings.upload_policy), null, 2),
    page_size_policy: JSON.stringify(normalizePageSizePolicyForSave(settings.page_size_policy), null, 2),
    cache_driver: cacheDriver,
    redis_url: normalizeStringSetting(settings.redis_url, DEFAULT_SETTINGS.redis_url),
    redis_db: clampNumber(settings.redis_db, DEFAULT_SETTINGS.redis_db, 0, 15),
    redis_key_prefix: normalizeStringSetting(settings.redis_key_prefix, DEFAULT_SETTINGS.redis_key_prefix),
    cache_public_settings_ttl_seconds: clampNumber(settings.cache_public_settings_ttl_seconds, 60, 0, 86400),
    cache_model_list_ttl_seconds: clampNumber(settings.cache_model_list_ttl_seconds, 300, 0, 86400),
    cache_model_detail_ttl_seconds: clampNumber(settings.cache_model_detail_ttl_seconds, 300, 0, 86400),
    cache_search_ttl_seconds: clampNumber(settings.cache_search_ttl_seconds, 60, 0, 86400),
    cache_selection_ttl_seconds: clampNumber(settings.cache_selection_ttl_seconds, 600, 0, 86400),
    cache_static_asset_max_age_days: clampNumber(settings.cache_static_asset_max_age_days, 30, 0, 365),
    storage_provider: storageProvider,
    storage_endpoint: normalizeStringSetting(settings.storage_endpoint),
    storage_region: normalizeStringSetting(settings.storage_region),
    storage_bucket: normalizeStringSetting(settings.storage_bucket),
    storage_access_key_id: normalizeStringSetting(settings.storage_access_key_id),
    storage_public_base_url: normalizeStringSetting(settings.storage_public_base_url),
    storage_cdn_base_url: normalizeStringSetting(settings.storage_cdn_base_url),
    storage_image_prefix: normalizeStoragePrefix(settings.storage_image_prefix, DEFAULT_SETTINGS.storage_image_prefix),
    storage_thumbnail_prefix: normalizeStoragePrefix(
      settings.storage_thumbnail_prefix,
      DEFAULT_SETTINGS.storage_thumbnail_prefix,
    ),
    storage_model_prefix: normalizeStoragePrefix(settings.storage_model_prefix, DEFAULT_SETTINGS.storage_model_prefix),
    storage_original_prefix: normalizeStoragePrefix(
      settings.storage_original_prefix,
      DEFAULT_SETTINGS.storage_original_prefix,
    ),
    storage_drawing_prefix: normalizeStoragePrefix(
      settings.storage_drawing_prefix,
      DEFAULT_SETTINGS.storage_drawing_prefix,
    ),
    storage_product_wall_prefix: normalizeStoragePrefix(
      settings.storage_product_wall_prefix,
      DEFAULT_SETTINGS.storage_product_wall_prefix,
    ),
    storage_attachment_prefix: normalizeStoragePrefix(
      settings.storage_attachment_prefix,
      DEFAULT_SETTINGS.storage_attachment_prefix,
    ),
    storage_backup_prefix: normalizeStoragePrefix(
      settings.storage_backup_prefix,
      DEFAULT_SETTINGS.storage_backup_prefix,
    ),
    storage_temp_prefix: normalizeStoragePrefix(settings.storage_temp_prefix, DEFAULT_SETTINGS.storage_temp_prefix),
    storage_signed_url_ttl_seconds: clampNumber(settings.storage_signed_url_ttl_seconds, 3600, 60, 86400),
    storage_upload_multipart_mb: clampNumber(settings.storage_upload_multipart_mb, 16, 5, 512),
    storage_upload_concurrency: clampNumber(settings.storage_upload_concurrency, 4, 1, 16),
    image_thumbnail_quality: clampNumber(settings.image_thumbnail_quality, 82, 1, 100),
    image_large_max_width: clampNumber(settings.image_large_max_width, 2560, 320, 12000),
    image_cache_max_age_days: clampNumber(settings.image_cache_max_age_days, 30, 0, 365),
    resource_cache_max_age_days: clampNumber(settings.resource_cache_max_age_days, 30, 0, 365),
  };
}

function ListActions({
  index,
  total,
  onMove,
  onDelete,
}: {
  index: number;
  total: number;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        title={t('adminSettings.moveUp')}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className="w-7 h-7 inline-flex items-center justify-center rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <Icon name="expand_less" size={16} />
      </button>
      <button
        type="button"
        title={t('adminSettings.moveDown')}
        disabled={index === total - 1}
        onClick={() => onMove(1)}
        className="w-7 h-7 inline-flex items-center justify-center rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <Icon name="expand_more" size={16} />
      </button>
      <button
        type="button"
        title={t('adminSettings.remove')}
        onClick={onDelete}
        className="w-7 h-7 inline-flex items-center justify-center rounded-md text-error hover:bg-error-container/10 transition-colors"
      >
        <Icon name="delete" size={15} />
      </button>
    </div>
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 text-xs font-medium rounded-md bg-primary-container/15 text-primary-container hover:bg-primary-container/25 transition-colors"
    >
      <Icon name="add" size={14} />
      {label}
    </button>
  );
}

function StatusListEditor({
  itemKey,
  settings,
  updateSetting,
  fallback,
}: {
  itemKey: keyof SystemSettings;
  settings: SystemSettings;
  updateSetting: SettingUpdater;
  fallback: StatusConfig[];
}) {
  const { t } = useTranslation();
  const items = parseSetting<StatusConfig[]>(settings[itemKey], fallback);
  const update = (next: StatusConfig[]) => setJsonSetting(updateSetting, itemKey, next);
  const patch = (index: number, changes: Partial<StatusConfig>) =>
    update(items.map((item, i) => (i === index ? { ...item, ...changes } : item)));

  return (
    <div className={compactListClass}>
      {items.map((item, index) => (
        <div
          key={`${item.value}-${index}`}
          className={`grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr_1fr_auto_auto] gap-2 ${compactPanelClass}`}
        >
          <input
            name="value"
            value={item.value}
            onChange={(e) => patch(index, { value: e.target.value })}
            placeholder={t('adminSettings.statusValueEg')}
            className={inputClass}
          />
          <input
            name="label"
            value={item.label}
            onChange={(e) => patch(index, { label: e.target.value })}
            placeholder={t('adminSettings.displayName')}
            className={inputClass}
          />
          <input
            name="color"
            value={item.color || ''}
            onChange={(e) => patch(index, { color: e.target.value })}
            placeholder={t('adminSettings.noticeTextColorClass')}
            className={inputClass}
          />
          <input
            name="bg"
            value={item.bg || ''}
            onChange={(e) => patch(index, { bg: e.target.value })}
            placeholder={t('adminSettings.bgColorClass')}
            className={inputClass}
          />
          <div className="flex items-center gap-3 px-1">
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <input
                name="tab"
                type="checkbox"
                checked={item.tab === true}
                onChange={(e) => patch(index, { tab: e.target.checked })}
                className="accent-[var(--color-primary-container)]"
              />
              {t('adminSettings.tabDisplayTab')}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <input
                name="terminal"
                type="checkbox"
                checked={item.terminal === true}
                onChange={(e) => patch(index, { terminal: e.target.checked })}
                className="accent-[var(--color-primary-container)]"
              />
              {t('adminSettings.isFinalState')}
            </label>
          </div>
          <ListActions
            index={index}
            total={items.length}
            onMove={(direction) => update(moveListItem(items, index, direction))}
            onDelete={() => update(items.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <AddRowButton
        label={t('adminSettings.addStatus')}
        onClick={() => update([...items, { value: '', label: '', color: '', bg: '', tab: true }])}
      />
    </div>
  );
}

function ClassificationEditor({
  settings,
  updateSetting,
}: {
  settings: SystemSettings;
  updateSetting: SettingUpdater;
}) {
  const { t } = useTranslation();
  const items = parseSetting<TicketClassificationConfig[]>(
    settings.ticket_classifications,
    DEFAULT_TICKET_CLASSIFICATIONS,
  );
  const update = (next: TicketClassificationConfig[]) => setJsonSetting(updateSetting, 'ticket_classifications', next);
  const patch = (index: number, changes: Partial<TicketClassificationConfig>) =>
    update(items.map((item, i) => (i === index ? { ...item, ...changes } : item)));

  return (
    <div className={compactListClass}>
      {items.map((item, index) => (
        <div
          key={`${item.value}-${index}`}
          className={`grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr_2fr_auto_auto] gap-2 ${compactPanelClass}`}
        >
          <input
            name="value"
            value={item.value}
            onChange={(e) => patch(index, { value: e.target.value })}
            placeholder={t('adminSettings.categoryValue')}
            className={inputClass}
          />
          <input
            name="label"
            value={item.label}
            onChange={(e) => patch(index, { label: e.target.value })}
            placeholder={t('adminSettings.displayName')}
            className={inputClass}
          />
          <input
            name="icon"
            value={item.icon}
            onChange={(e) => patch(index, { icon: e.target.value })}
            placeholder={t('adminSettings.iconName')}
            className={inputClass}
          />
          <input
            name="desc"
            value={item.desc}
            onChange={(e) => patch(index, { desc: e.target.value })}
            placeholder={t('adminSettings.fieldDescription')}
            className={inputClass}
          />
          <label className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
            <input
              name="enabled"
              type="checkbox"
              checked={item.enabled !== false}
              onChange={(e) => patch(index, { enabled: e.target.checked })}
              className="accent-[var(--color-primary-container)]"
            />
            {t('adminSettings.enabledToggle')}
          </label>
          <ListActions
            index={index}
            total={items.length}
            onMove={(direction) => update(moveListItem(items, index, direction))}
            onDelete={() => update(items.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <AddRowButton
        label={t('adminSettings.addCategory')}
        onClick={() => update([...items, { value: '', label: '', icon: 'category', desc: '', enabled: true }])}
      />
    </div>
  );
}

function SupportStepsEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const { t } = useTranslation();
  const items = parseSetting<SupportStepConfig[]>(settings.support_process_steps, DEFAULT_SUPPORT_STEPS);
  const update = (next: SupportStepConfig[]) => setJsonSetting(updateSetting, 'support_process_steps', next);
  const patch = (index: number, changes: Partial<SupportStepConfig>) =>
    update(items.map((item, i) => (i === index ? { ...item, ...changes } : item)));

  return (
    <div className={compactListClass}>
      {items.map((item, index) => (
        <div
          key={`${item.title}-${index}`}
          className={`grid grid-cols-1 xl:grid-cols-[1fr_1fr_2fr_auto] gap-2 ${compactPanelClass}`}
        >
          <input
            name="icon"
            value={item.icon}
            onChange={(e) => patch(index, { icon: e.target.value })}
            placeholder={t('adminSettings.iconName')}
            className={inputClass}
          />
          <input
            name="title"
            value={item.title}
            onChange={(e) => patch(index, { title: e.target.value })}
            placeholder={t('adminSettings.fieldTitle')}
            className={inputClass}
          />
          <input
            name="desc"
            value={item.desc}
            onChange={(e) => patch(index, { desc: e.target.value })}
            placeholder={t('adminSettings.fieldDescription')}
            className={inputClass}
          />
          <ListActions
            index={index}
            total={items.length}
            onMove={(direction) => update(moveListItem(items, index, direction))}
            onDelete={() => update(items.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <AddRowButton
        label={t('adminSettings.addStep')}
        onClick={() => update([...items, { icon: 'check_circle', title: '', desc: '' }])}
      />
    </div>
  );
}

const NAV_PRESETS: Record<string, { label: string; icon: string; path: string; roles?: ('USER' | 'ADMIN')[] }[]> = {
  all: [
    { label: 'adminSettings.scopeModels', icon: 'dashboard', path: '/' },
    { label: 'adminSettings.featureSelection', icon: 'tune', path: '/selection' },
    { label: 'adminSettings.scopeProductWall', icon: 'image', path: '/product-wall' },
    { label: 'adminSettings.ticketTypeSpecQuery', icon: 'straighten', path: '/thread-size' },
    { label: 'adminSettings.gateMyFavorites', icon: 'star', path: '/favorites' },
    { label: 'adminSettings.gateMySharesPage', icon: 'share', path: '/my-shares' },
    { label: 'adminSettings.gateDownloads', icon: 'download', path: '/downloads' },
    { label: 'adminSettings.gateMyInquiries', icon: 'request_quote', path: '/my-inquiries' },
    { label: 'adminSettings.gateMyTicketsPage', icon: 'assignment_add', path: '/my-tickets' },
    { label: 'adminSettings.gateSupport', icon: 'support_agent', path: '/support' },
    { label: 'adminSettings.scopeModelManage', icon: 'view_in_ar', path: '/admin/models', roles: ['ADMIN'] },
    { label: 'adminSettings.tabCategoryManage', icon: 'folder', path: '/admin/categories', roles: ['ADMIN'] },
    { label: 'adminSettings.gateSelectionManage', icon: 'tune', path: '/admin/selections', roles: ['ADMIN'] },
    { label: 'adminSettings.gateInquiryManage', icon: 'receipt_long', path: '/admin/inquiries', roles: ['ADMIN'] },
    { label: 'adminSettings.gateMyTickets', icon: 'build', path: '/admin/tickets', roles: ['ADMIN'] },
    { label: 'adminSettings.scopeUserManage', icon: 'group', path: '/admin/users', roles: ['ADMIN'] },
    { label: 'adminSettings.gateMyShares', icon: 'share', path: '/admin/shares', roles: ['ADMIN'] },
    { label: 'adminSettings.downloadStats', icon: 'download', path: '/admin/downloads', roles: ['ADMIN'] },
    { label: 'adminSettings.scopeAuditLog', icon: 'schedule', path: '/admin/audit', roles: ['ADMIN'] },
    { label: 'adminSettings.pageTitle', icon: 'settings', path: '/admin/settings', roles: ['ADMIN'] },
  ],
  mobile: [
    { label: 'adminSettings.gateHome', icon: 'dashboard', path: '/' },
    { label: 'adminSettings.featureSelectionEntry', icon: 'tune', path: '/selection' },
    { label: 'adminSettings.gateFavorites', icon: 'star', path: '/favorites' },
    { label: 'adminSettings.scopeTickets', icon: 'assignment_add', path: '/my-tickets' },
    { label: 'adminSettings.notifyChannelMine', icon: 'person', path: '/profile' },
  ],
};

const ICON_OPTIONS = [
  'dashboard',
  'tune',
  'image',
  'photo_library',
  'straighten',
  'star',
  'share',
  'download',
  'request_quote',
  'assignment_add',
  'support_agent',
  'view_in_ar',
  'folder',
  'build',
  'group',
  'schedule',
  'settings',
  'person',
  'cloud_upload',
  'receipt_long',
  'search',
  'notifications',
  'visibility',
  'link',
  'mail',
  'lock',
  'filter_list',
  'calendar_today',
  'inventory_2',
  'category',
  'bookmark',
  'favorite',
  'edit',
  'delete',
  'send',
  'add',
  'close',
  'check_circle',
  'error',
  'warning',
  'share',
  'attachment',
  'chat',
  'phone',
  'description',
  'shield',
  'campaign',
  'rule',
  'checklist',
  'more_horiz',
  'more_vert',
  'auto_awesome',
  'upload_file',
  'refresh',
  'science',
];

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${inputClass} flex items-center gap-2 text-left`}
      >
        <Icon name={value} size={16} className="shrink-0 text-on-surface-variant" />
        <span className="truncate text-sm">{value}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 min-w-[220px] bg-surface-container-lowest border border-outline-variant/20 rounded-lg shadow-xl p-2 max-h-[240px] overflow-y-auto">
          <div className="grid grid-cols-6 gap-1">
            {ICON_OPTIONS.map((name) => (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className={`p-2 rounded-md flex items-center justify-center transition-colors ${name === value ? 'bg-primary-container/20 text-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
              >
                <Icon name={name} size={20} />
              </button>
            ))}
          </div>
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}

function NavItemsEditor({
  itemKey,
  settings,
  updateSetting,
  fallback,
}: {
  itemKey: keyof SystemSettings;
  settings: SystemSettings;
  updateSetting: SettingUpdater;
  fallback: NavItemConfig[];
}) {
  const { t } = useTranslation();
  const rawItems = parseSetting<NavItemConfig[]>(settings[itemKey], fallback);
  const items = rawItems;
  const update = (next: NavItemConfig[]) => setJsonSetting(updateSetting, itemKey, next);
  const patch = (index: number, changes: Partial<NavItemConfig>) =>
    update(items.map((item: NavItemConfig, i: number) => (i === index ? { ...item, ...changes } : item)));
  const presetKey = itemKey === 'nav_items' ? 'all' : 'mobile';
  const presets = NAV_PRESETS[presetKey];
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(index);
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDropTarget(null);
      return;
    }
    const next = [...items];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    update(next);
    setDragIndex(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropTarget(null);
  };

  const isAdmin = itemKey === 'nav_items';
  const dragHandleClass =
    'cursor-grab active:cursor-grabbing text-on-surface-variant/40 hover:text-on-surface-variant transition-colors';

  return (
    <div className={compactListClass}>
      {/* Header row */}
      <div className="hidden xl:grid xl:grid-cols-[20px_1fr_1fr_2fr_auto_24px] gap-2 px-3 pb-1 text-[11px] text-on-surface-variant/60 font-medium uppercase tracking-wider">
        <span />
        <span>{t('adminSettings.fieldName')}</span>
        <span>{t('adminSettings.fieldIcon')}</span>
        <span>{t('adminSettings.fieldPagePath')}</span>
        <span className="w-10 text-center">{t('adminSettings.enabledToggle')}</span>
        <span />
      </div>
      {items.map((item: NavItemConfig, index: number) => {
        const isPreset = presets.some((p) => p.path === item.path);
        const adminOnly = isAdmin && isAdminOnly(item);
        const isDragging = dragIndex === index;
        const isDropTarget = dropTarget === index && dragIndex !== index;
        return (
          <div
            key={`${item.path}-${index}`}
            draggable={dragIndex === null || dragIndex === index}
            onDragStart={handleDragStart(index)}
            onDragOver={handleDragOver(index)}
            onDrop={handleDrop(index)}
            onDragEnd={handleDragEnd}
            className={`grid grid-cols-1 xl:grid-cols-[20px_1fr_1fr_2fr_auto_24px] gap-2 ${compactPanelClass} ${
              isDragging ? 'opacity-40 scale-[0.98]' : ''
            } ${isDropTarget ? 'ring-2 ring-primary-container/40' : ''} transition-all duration-150`}
          >
            {/* Mobile: drag handle + visibility icon */}
            <div className="flex items-center gap-2 xl:hidden">
              <div className={dragHandleClass} {...({} as React.HTMLAttributes<HTMLDivElement>)}>
                <Icon name="grip_vertical" size={16} />
              </div>
              <span
                title={adminOnly ? t('adminSettings.visibleAdminOnly') : t('adminSettings.visibleAllUsers')}
                className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${adminOnly ? 'text-amber-600' : 'text-green-600'}`}
              >
                <Icon name={adminOnly ? 'admin_panel_settings' : 'visibility'} size={12} />
                {adminOnly ? t('adminSettings.roleAdmin') : t('adminSettings.scopeUsers')}
              </span>
            </div>
            {/* Desktop: drag handle */}
            <div className={`hidden xl:flex items-center justify-center ${dragHandleClass}`}>
              <Icon name="grip_vertical" size={16} />
            </div>
            <label className="space-y-0.5 xl:hidden">
              <span className="text-[10px] text-on-surface-variant">{t('adminSettings.fieldName')}</span>
              <input
                name="label"
                value={item.label}
                onChange={(e) => patch(index, { label: e.target.value })}
                placeholder={t('adminSettings.menuName')}
                className={inputClass}
              />
            </label>
            <label className="space-y-0.5 xl:hidden">
              <span className="text-[10px] text-on-surface-variant">{t('adminSettings.fieldIcon')}</span>
              <IconPicker value={item.icon} onChange={(v) => patch(index, { icon: v })} />
            </label>
            <label className="space-y-0.5 xl:hidden">
              <span className="text-[10px] text-on-surface-variant">{t('adminSettings.fieldPagePath')}</span>
              <SelectMenu
                variant="field"
                ariaLabel={t('adminSettings.fieldPagePath')}
                value={item.path}
                onChange={(value) => patch(index, { path: value })}
                options={[
                  ...(!isPreset ? [{ value: item.path, label: `${item.path}${t('adminSettings.customSuffix')}` }] : []),
                  ...presets.map((p) => ({ value: p.path, label: t(p.label, { defaultValue: p.label }) })),
                ]}
              />
            </label>
            {/* Desktop inline */}
            <input
              name="label"
              value={item.label}
              onChange={(e) => patch(index, { label: e.target.value })}
              placeholder={t('adminSettings.menuName')}
              className={`${inputClass} hidden xl:block`}
            />
            <div className="hidden xl:block">
              <IconPicker value={item.icon} onChange={(v) => patch(index, { icon: v })} />
            </div>
            <div className="hidden xl:flex items-center gap-2">
              <SelectMenu
                variant="field"
                className="flex-1"
                ariaLabel={t('adminSettings.fieldPagePath')}
                value={item.path}
                onChange={(value) => patch(index, { path: value })}
                options={[
                  ...(!isPreset ? [{ value: item.path, label: `${item.path}${t('adminSettings.customSuffix')}` }] : []),
                  ...presets.map((p) => ({ value: p.path, label: t(p.label, { defaultValue: p.label }) })),
                ]}
              />
              <span
                title={adminOnly ? t('adminSettings.visibleAdminOnly') : t('adminSettings.visibleAllUsers')}
                className={`inline-flex items-center gap-0.5 text-[10px] font-medium whitespace-nowrap ${adminOnly ? 'text-amber-600' : 'text-green-600'}`}
              >
                <Icon name={adminOnly ? 'admin_panel_settings' : 'visibility'} size={12} />
                {adminOnly ? t('adminSettings.roleAdmin') : t('adminSettings.scopeUsers')}
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
              <input
                name="enabled"
                type="checkbox"
                checked={item.enabled !== false}
                onChange={(e) => patch(index, { enabled: e.target.checked })}
                className="accent-[var(--color-primary-container)]"
              />
              <span className="xl:hidden">{t('adminSettings.enabledToggle')}</span>
            </label>
            <button
              type="button"
              title={t('adminSettings.remove')}
              onClick={() => update(items.filter((_: NavItemConfig, i: number) => i !== index))}
              className="w-6 h-6 inline-flex items-center justify-center rounded-md text-on-surface-variant/40 hover:text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
      <AddRowButton
        label={t('adminSettings.addMenuItem')}
        onClick={() => update([...items, { label: '', icon: 'circle', path: '/', enabled: true }])}
      />
    </div>
  );
}

function UploadPolicyEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const { t } = useTranslation();
  const policy = { ...DEFAULT_UPLOAD_POLICY, ...parseSetting<Partial<UploadPolicy>>(settings.upload_policy, {}) };
  const update = (changes: Partial<UploadPolicy>) =>
    setJsonSetting(updateSetting, 'upload_policy', { ...policy, ...changes });

  return (
    <div className={`w-full max-w-4xl ${compactPanelClass}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">
          {t('adminSettings.badgeModelUpload')}
        </span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">
          {t('adminSettings.badgeSelectionImport')}
        </span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">
          {t('adminSettings.badgeTicketAttachment')}
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelModelFormats')}</span>
          <input
            name="join"
            value={policy.modelFormats.join(', ')}
            onChange={(e) => update({ modelFormats: parseCsv(e.target.value) })}
            placeholder="step, stp, iges, igs"
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelModelMaxSizeMb')}</span>
          <input
            name="model-max-size-mb"
            type="number"
            min={1}
            value={policy.modelMaxSizeMb}
            onChange={(e) => update({ modelMaxSizeMb: toNumber(e.target.value, policy.modelMaxSizeMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelChunkSizeMb')}</span>
          <input
            name="chunk-size-mb"
            type="number"
            min={1}
            value={policy.chunkSizeMb}
            onChange={(e) => update({ chunkSizeMb: toNumber(e.target.value, policy.chunkSizeMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelChunkThresholdMb')}</span>
          <input
            name="chunk-threshold-mb"
            type="number"
            min={1}
            value={policy.chunkThresholdMb}
            onChange={(e) => update({ chunkThresholdMb: toNumber(e.target.value, policy.chunkThresholdMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelSelectionImageMaxMb')}</span>
          <input
            name="option-image-max-size-mb"
            type="number"
            min={1}
            value={policy.optionImageMaxSizeMb}
            onChange={(e) => update({ optionImageMaxSizeMb: toNumber(e.target.value, policy.optionImageMaxSizeMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelCatalogPdfMaxMb')}</span>
          <input
            name="selection-pdf-max-size-mb"
            type="number"
            min={1}
            value={policy.selectionPdfMaxSizeMb}
            onChange={(e) => update({ selectionPdfMaxSizeMb: toNumber(e.target.value, policy.selectionPdfMaxSizeMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelSelectionImageMime')}</span>
          <input
            name="option-image-mime-pattern"
            value={policy.optionImageMimePattern}
            onChange={(e) => update({ optionImageMimePattern: e.target.value })}
            placeholder="image\\/(png|jpe?g|gif|webp)"
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelSelectionImportMaxMb')}</span>
          <input
            name="selection-import-max-size-mb"
            type="number"
            min={1}
            value={policy.selectionImportMaxSizeMb}
            onChange={(e) =>
              update({ selectionImportMaxSizeMb: toNumber(e.target.value, policy.selectionImportMaxSizeMb) })
            }
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelSelectionImportRows')}</span>
          <input
            name="selection-import-max-rows"
            type="number"
            min={1}
            value={policy.selectionImportMaxRows}
            onChange={(e) =>
              update({ selectionImportMaxRows: toNumber(e.target.value, policy.selectionImportMaxRows) })
            }
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelSelectionImportMaxCols')}</span>
          <input
            name="selection-import-max-columns"
            type="number"
            min={1}
            value={policy.selectionImportMaxColumns}
            onChange={(e) =>
              update({ selectionImportMaxColumns: toNumber(e.target.value, policy.selectionImportMaxColumns) })
            }
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">{t('adminSettings.labelTicketAttachmentMaxMbField')}</span>
          <input
            name="ticket-attachment-max-size-mb"
            type="number"
            min={1}
            value={policy.ticketAttachmentMaxSizeMb}
            onChange={(e) =>
              update({ ticketAttachmentMaxSizeMb: toNumber(e.target.value, policy.ticketAttachmentMaxSizeMb) })
            }
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">
            {t('adminSettings.labelTicketAttachmentFormatsField')}
          </span>
          <input
            name="join"
            value={policy.ticketAttachmentExts.join(', ')}
            onChange={(e) => update({ ticketAttachmentExts: parseCsv(e.target.value) })}
            placeholder=".jpg, .png, .webp"
            className={inputClass}
          />
        </label>
      </div>
    </div>
  );
}

function PageSizePolicyEditor({
  settings,
  updateSetting,
}: {
  settings: SystemSettings;
  updateSetting: SettingUpdater;
}) {
  const { t } = useTranslation();
  const policy = {
    ...DEFAULT_PAGE_SIZE_POLICY,
    ...parseSetting<Partial<PageSizePolicy>>(settings.page_size_policy, {}),
  };
  const update = (key: keyof PageSizePolicy, value: number) =>
    setJsonSetting(updateSetting, 'page_size_policy', { ...policy, [key]: value });
  const fields: { key: keyof PageSizePolicy; label: string }[] = [
    { key: 'homeDefault', label: t('adminSettings.homeDefaultCount') },
    { key: 'homeMax', label: t('adminSettings.homeApiMaxCount') },
    { key: 'homeOption1', label: t('adminSettings.homePagingOption1') },
    { key: 'homeOption2', label: t('adminSettings.homePagingOption2') },
    { key: 'homeOption3', label: t('adminSettings.homePagingOption3') },
    { key: 'homeOption4', label: t('adminSettings.homePagingOption4') },
    { key: 'selectionDefault', label: t('adminSettings.selectionDefaultCount') },
    { key: 'selectionMax', label: t('adminSettings.selectionMaxCount') },
    { key: 'selectionAdminRenderBatch', label: t('adminSettings.selectionAdminBatch') },
    { key: 'selectionGeneratePreviewPageSize', label: t('adminSettings.selectionPreviewCount') },
    { key: 'inquiryAdminDefault', label: t('adminSettings.inquiryAdminDefaultCount') },
    { key: 'inquiryAdminMax', label: t('adminSettings.inquiryAdminMaxCount') },
    { key: 'ticketListMax', label: t('adminSettings.ticketAdminMaxCount') },
    { key: 'notificationDefault', label: t('adminSettings.notifyAdminDefaultCount') },
    { key: 'notificationMax', label: t('adminSettings.notifyAdminMaxCount') },
    { key: 'adminUserDefault', label: t('adminSettings.userAdminDefaultCount') },
    { key: 'adminUserMax', label: t('adminSettings.userAdminMaxCount') },
    { key: 'shareAdminDefault', label: t('adminSettings.shareAdminDefaultCount') },
    { key: 'shareAdminMax', label: t('adminSettings.shareAdminMaxCount') },
    { key: 'auditDefault', label: t('adminSettings.logAdminDefaultCount') },
    { key: 'auditMax', label: t('adminSettings.logAdminMaxCount') },
    { key: 'userBatchDownloadMax', label: t('adminSettings.userBatchDownloadMax') },
    { key: 'adminBatchDownloadMax', label: t('adminSettings.adminBatchDownloadMax') },
  ];

  return (
    <div className={`w-full max-w-4xl ${compactPanelClass}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">
          {t('adminSettings.badgeSelectionAdmin')}
        </span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">
          {t('adminSettings.badgeNotifyUserShare')}
        </span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">
          {t('adminSettings.scopeAuditLog')}
        </span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">
          {t('adminSettings.badgeBatchDownload')}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {fields.map((field) => (
          <label key={field.key} className="space-y-1">
            <span className="text-xs text-on-surface-variant">{field.label}</span>
            <input
              name="policy"
              type="number"
              min={1}
              value={policy[field.key]}
              onChange={(e) => update(field.key, toNumber(e.target.value, policy[field.key]))}
              className={numberInputClass}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function ThreadPriorityEditor({
  settings,
  updateSetting,
}: {
  settings: SystemSettings;
  updateSetting: SettingUpdater;
}) {
  const { t } = useTranslation();
  const priorities = {
    ...DEFAULT_THREAD_PRIORITY,
    ...parseSetting<Record<string, number>>(settings.selection_thread_priority, {}),
  };
  const rows = Object.entries(priorities).map(([prefix, rank]) => ({ prefix, rank }));
  const updateRows = (nextRows: { prefix: string; rank: number }[]) => {
    setJsonSetting(
      updateSetting,
      'selection_thread_priority',
      nextRows.reduce<Record<string, number>>((acc, row) => {
        acc[row.prefix] = toNumber(row.rank);
        return acc;
      }, {}),
    );
  };

  return (
    <div className="space-y-2 w-full max-w-2xl">
      {rows.map((row, index) => (
        <div key={`${row.prefix}-${index}`} className={`grid grid-cols-[1fr_1fr_auto] gap-2 ${compactPanelClass}`}>
          <input
            name="prefix"
            value={row.prefix}
            onChange={(e) =>
              updateRows(rows.map((item, i) => (i === index ? { ...item, prefix: e.target.value } : item)))
            }
            placeholder={t('adminSettings.threadPrefixEg')}
            className={inputClass}
          />
          <input
            name="rank"
            type="number"
            value={row.rank}
            onChange={(e) =>
              updateRows(
                rows.map((item, i) => (i === index ? { ...item, rank: toNumber(e.target.value, item.rank) } : item)),
              )
            }
            placeholder={t('adminSettings.sortWeight')}
            className={numberInputClass}
          />
          <ListActions
            index={index}
            total={rows.length}
            onMove={(direction) => updateRows(moveListItem(rows, index, direction))}
            onDelete={() => updateRows(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <AddRowButton
        label={t('adminSettings.addPrefix')}
        onClick={() => updateRows([...rows, { prefix: '', rank: rows.length }])}
      />
    </div>
  );
}

function FooterLinksEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const { t } = useTranslation();
  const links = normalizeFooterLinks(settings.footer_links);
  const update = (next: FooterLinkConfig[]) =>
    setJsonSetting(updateSetting, 'footer_links', normalizeFooterLinks(next));
  const patch = (index: number, changes: Partial<FooterLinkConfig>) =>
    update(links.map((link, i) => (i === index ? { ...link, ...changes } : link)));

  return (
    <div className="w-full max-w-5xl space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
        <div className={`${compactPanelClass} space-y-1.5`}>
          <p className="text-xs font-semibold text-on-surface">{t('adminSettings.friendlyLinksBlock')}</p>
          <p className="text-[11px] leading-5 text-on-surface-variant">{t('adminSettings.friendlyLinksHint')}</p>
        </div>
        <div className={`${compactPanelClass} space-y-1.5`}>
          <p className="text-xs font-semibold text-on-surface">{t('adminSettings.footerCopyright')}</p>
          <p className="text-[11px] font-medium text-on-surface">
            {settings.footer_copyright_follow_site_title
              ? resolveFooterCopyright(settings)
              : settings.footer_copyright || DEFAULT_FOOTER_COPYRIGHT}
          </p>
          <p className="text-[11px] leading-5 text-on-surface-variant">{t('adminSettings.footerCopyrightHint')}</p>
        </div>
      </div>
      <div className="space-y-2">
        {links.length === 0 ? (
          <div className={`${compactPanelClass} text-xs text-on-surface-variant`}>
            {t('adminSettings.noFriendlyLinksYet')}
          </div>
        ) : (
          links.map((link, index) => (
            <div
              key={`footer-link-${index}`}
              className={`grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 ${compactPanelClass}`}
            >
              <input
                name="label"
                value={link.label}
                onChange={(e) => patch(index, { label: e.target.value })}
                placeholder={t('adminSettings.linkText')}
                className={inputClass}
              />
              <input
                name="url"
                value={link.url}
                onChange={(e) => patch(index, { url: e.target.value })}
                placeholder={t('adminSettings.egAboutOrUrl')}
                inputMode="url"
                className={inputClass}
              />
              <ListActions
                index={index}
                total={links.length}
                onMove={(direction) => update(moveListItem(links, index, direction))}
                onDelete={() => update(links.filter((_, i) => i !== index))}
              />
            </div>
          ))
        )}
      </div>
      <AddRowButton
        label={t('adminSettings.addFriendlyLink')}
        onClick={() => update([...links, { label: '', url: '' }])}
      />
    </div>
  );
}

function LegalSectionsEditor({
  itemKey,
  settings,
  updateSetting,
  fallback,
}: {
  itemKey: 'legal_privacy_sections' | 'legal_terms_sections';
  settings: SystemSettings;
  updateSetting: SettingUpdater;
  fallback: LegalSection[];
}) {
  const { t } = useTranslation();
  const sections = parseEditableLegalSections(settings[itemKey], fallback);
  const [activeIndex, setActiveIndex] = useState(0);
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, sections.length - 1));
  const activeSection = sections[safeActiveIndex] || { title: '', content: '' };
  const update = (next: LegalSection[]) => setJsonSetting(updateSetting, itemKey, next);
  const patch = (index: number, changes: Partial<LegalSection>) =>
    update(sections.map((section, i) => (i === index ? { ...section, ...changes } : section)));
  const deleteSection = (index: number) => {
    update(sections.filter((_, i) => i !== index));
    setActiveIndex(Math.max(0, index - 1));
  };
  const addSection = () => {
    const next = [...sections, { title: '', content: '' }];
    update(next);
    setActiveIndex(next.length - 1);
  };

  return (
    <div className="w-full max-w-6xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-on-surface">
            {t('adminSettings.legalDocsCount', { count: sections.length })}
          </p>
          <p className="text-[11px] text-on-surface-variant">{t('adminSettings.legalEditorHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addSection}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary-container/15 px-2.5 text-xs font-medium text-primary-container transition-colors hover:bg-primary-container/25"
          >
            <Icon name="add" size={14} />
            {t('adminSettings.addSection')}
          </button>
          <button
            type="button"
            onClick={() => {
              update(fallback);
              setActiveIndex(0);
            }}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="restore" size={14} />
            {t('adminSettings.restoreDefaults')}
          </button>
        </div>
      </div>

      <div className="grid min-h-[420px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1 custom-scrollbar lg:max-h-[560px]">
            {sections.map((section, index) => (
              <button
                key={`${section.title}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                  index === safeActiveIndex
                    ? 'bg-primary-container/15 text-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface'
                }`}
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-bold tabular-nums ${index === safeActiveIndex ? 'bg-primary-container text-on-primary' : 'bg-surface-container-high'}`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {section.title || t('adminSettings.untitledSection')}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">
                {t('adminSettings.sectionItemNo', { index: safeActiveIndex + 1 })}
              </p>
              <p className="text-xs text-on-surface-variant">{t('adminSettings.sectionTocHint')}</p>
            </div>
            <ListActions
              index={safeActiveIndex}
              total={sections.length}
              onMove={(direction) => {
                update(moveListItem(sections, safeActiveIndex, direction));
                setActiveIndex(safeActiveIndex + direction);
              }}
              onDelete={() => deleteSection(safeActiveIndex)}
            />
          </div>

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-on-surface-variant">
                {t('adminSettings.sectionTitleLabel')}
              </span>
              <input
                name="title"
                value={activeSection.title}
                onChange={(e) => patch(safeActiveIndex, { title: e.target.value })}
                placeholder={t('adminSettings.egDefinitionAndSubject')}
                className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2.5 border border-outline-variant/20 outline-none focus:border-primary"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-on-surface-variant">{t('adminSettings.sectionBodyLabel')}</span>
              <textarea
                name="content"
                value={activeSection.content}
                onChange={(e) => patch(safeActiveIndex, { content: e.target.value })}
                placeholder={t('adminSettings.legalBodyDesc')}
                rows={14}
                className="min-h-72 w-full resize-y rounded-md border border-outline-variant/20 bg-surface-container-lowest px-3 py-3 text-sm leading-7 text-on-surface outline-none focus:border-primary"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailTestPanel({
  value,
  onChange,
  onSend,
  testing,
  changed,
  saving,
  settings,
  templateLabel,
  templateKey,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  testing: boolean;
  changed: boolean;
  saving: boolean;
  settings: SystemSettings;
  templateLabel: string;
  templateKey: string;
}) {
  const { t } = useTranslation();
  const smtpReady = Boolean(settings.smtp_host && settings.smtp_user && settings.smtp_pass);
  const from = settings.smtp_from || settings.smtp_user || t('adminSettings.notSet');
  return (
    <div className="w-full max-w-6xl">
      <div className="flex flex-col xl:flex-row xl:items-center gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-high/25 p-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0 xl:flex-nowrap xl:shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${smtpReady ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <span className="text-sm font-semibold text-on-surface whitespace-nowrap">
            {smtpReady ? t('adminSettings.smtpReadyToTest') : t('adminSettings.smtpIncomplete')}
          </span>
          <span className="h-7 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2 text-xs min-w-0">
            <span className="text-on-surface-variant shrink-0">{t('adminSettings.smtpSenderName')}</span>
            <span className="text-on-surface font-medium truncate max-w-48">{from}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1 text-xs">
          <span className="h-7 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2 min-w-0 whitespace-nowrap leading-none">
            <span className="text-on-surface-variant shrink-0">{t('adminSettings.serverShort')}</span>
            <span className="text-on-surface font-medium truncate max-w-40">
              {settings.smtp_host || t('adminSettings.notConfigured')}
            </span>
          </span>
          <span className="h-7 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2 whitespace-nowrap leading-none">
            <span className="text-on-surface-variant">{t('adminSettings.unitPort')}</span>
            <span className="text-on-surface font-medium">{settings.smtp_port || 465}</span>
          </span>
          <span className="h-7 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2 whitespace-nowrap leading-none">
            <span className="text-on-surface-variant">{t('adminSettings.connectionLabel')}</span>
            <span className="text-on-surface font-medium">{settings.smtp_secure ? 'SSL/TLS' : 'STARTTLS'}</span>
          </span>
          <span className="h-7 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2 whitespace-nowrap leading-none">
            <span className="text-on-surface-variant">{t('adminSettings.templatesLabel')}</span>
            <span className="text-on-surface font-medium truncate max-w-36" title={templateKey}>
              {templateLabel}
            </span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(220px,320px)_auto] gap-2 xl:ml-auto shrink-0">
          <input
            name="value"
            type="email"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="test@example.com"
            className="h-10 w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={testing || saving}
            className="h-10 inline-flex items-center justify-center gap-1.5 px-4 text-xs font-semibold bg-primary-container text-on-primary rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
          >
            <Icon name={testing ? 'progress_activity' : 'send'} size={14} />
            {testing
              ? t('adminSettings.sending')
              : changed
                ? t('adminSettings.saveAndTest')
                : t('adminSettings.sendTest')}
          </button>
        </div>
      </div>
    </div>
  );
}

function isConnectivityResult(value: unknown): value is SettingsConnectivityResult {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'message' in value &&
    'details' in value &&
    Array.isArray((value as SettingsConnectivityResult).details),
  );
}

type ApiErrorLike = {
  message?: unknown;
  jobId?: unknown;
  response?: {
    data?: unknown;
  };
};

function apiErrorLike(err: unknown): ApiErrorLike {
  return err && typeof err === 'object' ? (err as ApiErrorLike) : {};
}

function errorPayloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as { message?: unknown; detail?: unknown };
  if (typeof data.message === 'string' && data.message) return data.message;
  if (typeof data.detail === 'string' && data.detail) return data.detail;
  return null;
}

function errorMessage(err: unknown, fallback: string): string {
  const error = apiErrorLike(err);
  return errorPayloadMessage(error.response?.data) || (typeof error.message === 'string' ? error.message : fallback);
}

function errorJobId(err: unknown): string | null {
  const jobId = apiErrorLike(err).jobId;
  return typeof jobId === 'string' && jobId ? jobId : null;
}

function connectivityTone(result: SettingsConnectivityResult | null) {
  if (!result) return 'border-outline-variant/10 bg-surface-container-high/25 text-on-surface-variant';
  if (result.status === 'success') return 'border-emerald-500/20 bg-emerald-500/8 text-emerald-600';
  if (result.status === 'warning') return 'border-amber-500/25 bg-amber-500/8 text-amber-600';
  return 'border-error/25 bg-error-container/10 text-error';
}

function SettingsConnectivityTestPanel({
  icon,
  title,
  summary,
  buttonLabel,
  testingLabel,
  testing,
  changed,
  saving,
  result,
  onRun,
}: {
  icon: string;
  title: string;
  summary: string;
  buttonLabel: string;
  testingLabel: string;
  testing: boolean;
  changed: boolean;
  saving: boolean;
  result: SettingsConnectivityResult | null;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const tone = connectivityTone(result);
  return (
    <div className="w-full max-w-6xl">
      <div className={`rounded-lg border p-3 ${tone}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-container-lowest/70 text-current">
              <Icon
                name={result?.status === 'success' ? 'check_circle' : result?.status === 'error' ? 'error' : icon}
                size={18}
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">{result?.message || title}</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {result
                  ? [result.provider, result.latencyMs ? `${result.latencyMs}ms` : ''].filter(Boolean).join(' · ')
                  : summary}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRun}
            disabled={testing || saving}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary-container px-4 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Icon name={testing ? 'progress_activity' : icon} size={14} />
            {testing ? testingLabel : changed ? t('adminSettings.saveAndTest') : buttonLabel}
          </button>
        </div>
        {result?.details?.length ? (
          <div className="mt-3 space-y-1 rounded-md border border-outline-variant/10 bg-surface-container-lowest/60 p-2.5">
            {result.details.map((detail, index) => (
              <p key={`${detail}-${index}`} className="break-all text-xs leading-5 text-on-surface-variant">
                {detail}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StoragePolicyInfoPanel({ settings }: { settings: SystemSettings }) {
  const { t } = useTranslation();
  const rows: { label: string; key: keyof SystemSettings; policy: string; note: string }[] = [
    {
      label: t('adminSettings.dirImageOriginals'),
      key: 'storage_image_prefix',
      policy: settings.image_cdn_enabled ? t('adminSettings.accessPublicCdn') : t('adminSettings.accessPublic'),
      note: t('adminSettings.dirSiteImages'),
    },
    {
      label: t('adminSettings.dirThumbnails'),
      key: 'storage_thumbnail_prefix',
      policy: settings.image_cdn_enabled ? t('adminSettings.accessPublicCdn') : t('adminSettings.accessPublic'),
      note: t('adminSettings.dirHomeLists'),
    },
    {
      label: t('adminSettings.dirModelFiles'),
      key: 'storage_model_prefix',
      policy: settings.storage_signed_url_enabled
        ? t('adminSettings.accessSignedDownload')
        : t('adminSettings.accessAuthDownload'),
      note: t('adminSettings.dirStepModels'),
    },
    {
      label: t('adminSettings.dirOriginalFiles'),
      key: 'storage_original_prefix',
      policy: settings.storage_signed_url_enabled
        ? t('adminSettings.accessSigned')
        : t('adminSettings.notRecommendedPublic'),
      note: t('adminSettings.dirRawSources'),
    },
    {
      label: t('adminSettings.dirDrawings'),
      key: 'storage_drawing_prefix',
      policy: settings.storage_signed_url_enabled
        ? t('adminSettings.accessSignedDownload')
        : t('adminSettings.accessAuthDownload'),
      note: t('adminSettings.dirDrawingDocs'),
    },
    {
      label: t('adminSettings.scopeProductWall'),
      key: 'storage_product_wall_prefix',
      policy: settings.image_cdn_enabled ? t('adminSettings.accessPublicCdn') : t('adminSettings.accessPublic'),
      note: t('adminSettings.dirGalleryOriginals'),
    },
    {
      label: t('adminSettings.dirThreadAttachments'),
      key: 'storage_attachment_prefix',
      policy: settings.storage_signed_url_enabled ? t('adminSettings.accessSigned') : t('adminSettings.accessAuthed'),
      note: t('adminSettings.dirTicketAttachments'),
    },
    {
      label: t('adminSettings.dirBackupFiles'),
      key: 'storage_backup_prefix',
      policy: t('adminSettings.gateAdmin'),
      note: t('adminSettings.dirBackupAssets'),
    },
    {
      label: t('adminSettings.dirTemp'),
      key: 'storage_temp_prefix',
      policy: t('adminSettings.syncExcluded'),
      note: t('adminSettings.dirConversionTemp'),
    },
  ];

  return (
    <div className="w-full max-w-6xl rounded-lg border border-outline-variant/10 bg-surface-container-high/20 p-3">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-container-lowest text-primary">
          <Icon name="folder_open" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">{t('adminSettings.storagePolicyNotesHeading')}</p>
          <p className="mt-0.5 text-xs leading-5 text-on-surface-variant">{t('adminSettings.storagePolicyHint')}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-outline-variant/10">
        <div className="grid grid-cols-[88px_minmax(0,1fr)_112px] gap-0 bg-surface-container text-xs font-semibold text-on-surface-variant sm:grid-cols-[120px_minmax(0,1fr)_140px_minmax(0,1fr)]">
          <div className="px-3 py-2">{t('adminSettings.colResource')}</div>
          <div className="px-3 py-2">{t('adminSettings.colDirectory')}</div>
          <div className="px-3 py-2">{t('adminSettings.colPolicy')}</div>
          <div className="hidden px-3 py-2 sm:block">{t('adminSettings.fieldDescription')}</div>
        </div>
        {rows.map((row) => {
          const prefix = String(settings[row.key] || '').replace(/^\/+|\/+$/g, '') || '-';
          return (
            <div
              key={row.key}
              className="grid grid-cols-[88px_minmax(0,1fr)_112px] border-t border-outline-variant/5 text-xs sm:grid-cols-[120px_minmax(0,1fr)_140px_minmax(0,1fr)]"
            >
              <div className="px-3 py-2 font-medium text-on-surface">{row.label}</div>
              <div className="min-w-0 px-3 py-2 font-mono text-on-surface-variant">
                <span className="break-all">{prefix === '-' ? '-' : `static/${prefix}`}</span>
              </div>
              <div className="px-3 py-2 text-on-surface-variant">{row.policy}</div>
              <div className="hidden px-3 py-2 text-on-surface-variant sm:block">{row.note}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function storageSyncStatusLabel(status?: StorageSyncJob['status']) {
  switch (status) {
    case 'queued':
      return i18n.t('adminSettings.statusQueued');
    case 'running':
      return i18n.t('adminSettings.syncRunning');
    case 'done':
      return i18n.t('adminSettings.statusCompleted');
    case 'cancelled':
      return i18n.t('adminSettings.statusStopped');
    case 'error':
      return i18n.t('adminSettings.statusFailed');
    default:
      return i18n.t('adminSettings.statusNotStarted');
  }
}

function storageSyncStatusClass(status?: StorageSyncJob['status']) {
  if (status === 'done') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600';
  if (status === 'error') return 'border-error/20 bg-error-container/10 text-error';
  if (status === 'running' || status === 'queued') return 'border-primary/20 bg-primary-container/10 text-primary';
  return 'border-outline-variant/10 bg-surface-container-high/30 text-on-surface-variant';
}

function formatStorageSyncTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function StorageSyncPanel({ settings }: { settings: SystemSettings }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [payload, setPayload] = useState<StorageSyncStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [direction, setDirection] = useState<StorageSyncDirection>('local_to_cloud');
  const [selectedScopeKeys, setSelectedScopeKeys] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(true);
  const [deleteExtraneous, setDeleteExtraneous] = useState(false);
  const [deleteJobTarget, setDeleteJobTarget] = useState<StorageSyncJob | null>(null);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);

  async function refreshStatus(silent = false) {
    if (!silent) setLoading(true);
    try {
      const next = await getStorageSyncStatus();
      setPayload(next);
      setSelectedScopeKeys((current) => {
        if (current.length > 0) return current;
        return next.scopes.map((scope) => scope.key);
      });
    } catch (err: unknown) {
      if (!silent) toast(errorMessage(err, t('adminSettings.syncStatusLoadFailed')), 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    refreshStatus();
    // The storage-sync panel owns this request lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const active = payload?.active;
    if (!active || (active.status !== 'running' && active.status !== 'queued')) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const next = await getStorageSyncJob(active.id);
        setPayload((current) =>
          current
            ? {
                ...current,
                active: next.status === 'running' || next.status === 'queued' ? next : null,
                latest: next,
                jobs: current.jobs.map((job) => (job.id === next.id ? next : job)),
              }
            : current,
        );
        if (next.status !== 'running' && next.status !== 'queued') {
          refreshStatus(true);
        }
      } catch {
        refreshStatus(true);
      }
    }, 1500);
    return () => window.clearInterval(timer);
    // Polling is tied to the current active job identity/status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.active?.id, payload?.active?.status]);

  const scopes = payload?.scopes || [];
  const activeJob = payload?.active;
  const latestJob = payload?.latest;
  const canDeleteExtra = Boolean(settings.storage_sync_delete_extra_enabled);
  const disabled = !settings.storage_sync_enabled || working || Boolean(activeJob);

  async function handleStart() {
    if (!settings.storage_sync_enabled) {
      toast(t('adminSettings.enableSyncToolFirst'), 'error');
      return;
    }
    if (selectedScopeKeys.length === 0) {
      toast(t('adminSettings.pickAtLeastOneSyncDir'), 'error');
      return;
    }
    setWorking(true);
    try {
      const job = await startStorageSyncJob({
        direction,
        scopes: selectedScopeKeys,
        overwrite,
        deleteExtraneous: canDeleteExtra ? deleteExtraneous : false,
      });
      setPayload((current) =>
        current
          ? { ...current, active: job, latest: job, jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)] }
          : current,
      );
      toast(t('adminSettings.syncStarted'));
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.syncStartFailed')), 'error');
    } finally {
      setWorking(false);
    }
  }

  async function handleCancel() {
    if (!activeJob) return;
    setWorking(true);
    try {
      const job = await cancelStorageSyncJob(activeJob.id);
      setPayload((current) =>
        current
          ? {
              ...current,
              active: null,
              latest: job,
              jobs: current.jobs.map((item) => (item.id === job.id ? job : item)),
            }
          : current,
      );
      toast(t('adminSettings.syncStopped'));
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.stopSyncFailed')), 'error');
    } finally {
      setWorking(false);
    }
  }

  async function handleDelete(job: StorageSyncJob) {
    setWorking(true);
    try {
      await deleteStorageSyncJob(job.id);
      setPayload((current) =>
        current
          ? {
              ...current,
              active: current.active?.id === job.id ? null : current.active,
              latest: current.latest?.id === job.id ? null : current.latest,
              jobs: current.jobs.filter((item) => item.id !== job.id),
            }
          : current,
      );
      toast(t('adminSettings.syncRecordDeleted'));
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.deleteSyncRecordFailed')), 'error');
    } finally {
      setWorking(false);
    }
  }

  function toggleScope(scope: StorageSyncScope) {
    setSelectedScopeKeys((current) =>
      current.includes(scope.key) ? current.filter((item) => item !== scope.key) : [...current, scope.key],
    );
  }

  return (
    <div className="w-full max-w-6xl space-y-3">
      <div className={`rounded-lg border p-3 ${storageSyncStatusClass(activeJob?.status || latestJob?.status)}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-container-lowest/70 text-current">
              <Icon name={activeJob ? 'sync' : latestJob?.status === 'done' ? 'check_circle' : 'sync_alt'} size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">
                {activeJob
                  ? activeJob.message || t('adminSettings.syncingAssets')
                  : latestJob?.message || t('adminSettings.noRunningSyncJobs')}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {activeJob || latestJob
                  ? `${storageSyncStatusLabel((activeJob || latestJob)?.status)} · ${formatStorageSyncTime((activeJob || latestJob)?.startedAt)}`
                  : t('adminSettings.syncToolDesc')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => refreshStatus()}
              disabled={loading || working}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-outline-variant/15 bg-surface-container-lowest px-3 text-xs font-semibold text-on-surface transition-colors hover:border-primary/40 disabled:opacity-50"
            >
              <Icon name={loading ? 'progress_activity' : 'refresh'} size={14} />
              {t('adminSettings.refresh')}
            </button>
            {activeJob ? (
              <button
                type="button"
                onClick={handleCancel}
                disabled={working}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-error-container px-3 text-xs font-semibold text-error transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Icon name="stop_circle" size={14} />
                {t('adminSettings.stop')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStartConfirmOpen(true)}
                disabled={disabled || selectedScopeKeys.length === 0}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary-container px-4 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Icon name={working ? 'progress_activity' : 'play_arrow'} size={14} />
                {t('adminSettings.startSync')}
              </button>
            )}
          </div>
        </div>

        {(activeJob || latestJob) && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-surface-container-lowest/70">
              <div
                className="h-full rounded-full bg-current transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, (activeJob || latestJob)?.percent || 0))}%` }}
              />
            </div>
            <div className="mt-2 grid gap-2 text-xs text-on-surface-variant sm:grid-cols-4">
              <span>
                {t('adminSettings.syncProgress', { percent: Math.round((activeJob || latestJob)?.percent || 0) })}
              </span>
              <span>
                {t('adminSettings.syncFiles', {
                  processed: (activeJob || latestJob)?.processedFiles || 0,
                  total: (activeJob || latestJob)?.totalFiles || 0,
                })}
              </span>
              <span>
                {t('adminSettings.syncBytes', {
                  processed: (activeJob || latestJob)?.processedBytesText || '0 B',
                  total: (activeJob || latestJob)?.totalBytesText || '',
                })}
                {(activeJob || latestJob)?.totalBytesText || '0 B'}
              </span>
              <span>{t('adminSettings.syncFailedCount', { count: (activeJob || latestJob)?.failedFiles || 0 })}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-lg border border-outline-variant/10 bg-surface-container-high/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-on-surface">{t('adminSettings.syncDirectories')}</p>
            <button
              type="button"
              onClick={() =>
                setSelectedScopeKeys((current) =>
                  current.length === scopes.length ? [] : scopes.map((scope) => scope.key),
                )
              }
              className="text-xs font-medium text-primary hover:underline"
            >
              {selectedScopeKeys.length === scopes.length
                ? t('adminSettings.deselectAll')
                : t('adminSettings.selectAll')}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {scopes.map((scope) => {
              const checked = selectedScopeKeys.includes(scope.key);
              return (
                <button
                  key={scope.key}
                  type="button"
                  onClick={() => toggleScope(scope)}
                  className={`flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                    checked
                      ? 'border-primary/30 bg-primary-container/10 text-on-surface'
                      : 'border-outline-variant/10 bg-surface-container-lowest/70 text-on-surface-variant hover:border-primary/30'
                  }`}
                >
                  <Icon name={checked ? 'check_circle' : 'radio_button_unchecked'} size={16} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {t(scope.label, { defaultValue: scope.label })}
                    </span>
                    <span className="block truncate text-[11px] font-mono opacity-70">{scope.prefix || '-'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-outline-variant/10 bg-surface-container-high/20 p-3">
          <div>
            <p className="mb-2 text-sm font-semibold text-on-surface">{t('adminSettings.directionLabel')}</p>
            <div className="grid gap-2">
              {[
                { value: 'local_to_cloud', label: t('adminSettings.directionLocalToCloudArrow'), icon: 'cloud_upload' },
                {
                  value: 'cloud_to_local',
                  label: t('adminSettings.directionCloudToLocalArrow'),
                  icon: 'cloud_download',
                },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDirection(option.value as StorageSyncDirection)}
                  className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors ${
                    direction === option.value
                      ? 'border-primary/30 bg-primary-container/10 text-primary'
                      : 'border-outline-variant/10 bg-surface-container-lowest/70 text-on-surface-variant'
                  }`}
                >
                  <Icon name={option.icon} size={15} />
                  {t(option.label, { defaultValue: option.label })}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-xs text-on-surface">
            {t('adminSettings.overwriteExisting')}
            <Switch checked={overwrite} onChange={setOverwrite} />
          </label>
          <label
            className={`flex items-center justify-between gap-3 text-xs ${
              canDeleteExtra ? 'text-on-surface' : 'text-on-surface-variant/50'
            }`}
          >
            {t('adminSettings.deleteExtraFiles')}
            <Switch
              checked={canDeleteExtra && deleteExtraneous}
              onChange={setDeleteExtraneous}
              disabled={!canDeleteExtra}
            />
          </label>
          {!settings.storage_sync_enabled ? (
            <p className="rounded-md bg-yellow-500/10 px-3 py-2 text-xs leading-5 text-yellow-600">
              {t('adminSettings.needEnableSyncToolFirst')}
            </p>
          ) : null}
        </div>
      </div>

      {payload?.jobs?.length ? (
        <div className="rounded-lg border border-outline-variant/10 bg-surface-container-high/20">
          <div className="flex items-center justify-between gap-2 border-b border-outline-variant/10 px-3 py-2">
            <p className="text-sm font-semibold text-on-surface">{t('adminSettings.recentSyncRecords')}</p>
            <span className="text-xs text-on-surface-variant">
              {t('adminSettings.countRecords', { count: payload.jobs.length })}
            </span>
          </div>
          <div className="divide-y divide-outline-variant/5">
            {payload.jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-on-surface">
                    {job.direction === 'local_to_cloud'
                      ? t('adminSettings.directionLocalToCloud')
                      : t('adminSettings.directionCloudToLocal')}{' '}
                    · {storageSyncStatusLabel(job.status)}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">
                    {formatStorageSyncTime(job.startedAt)} ·{' '}
                    {t('adminSettings.syncRecordStats', {
                      copied: job.copiedFiles,
                      skipped: job.skippedFiles,
                      deleted: job.deletedFiles,
                      failed: job.failedFiles,
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteJobTarget(job)}
                  disabled={working || activeJob?.id === job.id}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-error-container/10 hover:text-error disabled:opacity-40"
                >
                  <Icon name="delete" size={14} />
                  {t('adminSettings.deleteRecord')}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteJobTarget)}
        onClose={() => setDeleteJobTarget(null)}
        onConfirm={() => {
          const target = deleteJobTarget;
          if (!target) return;
          setDeleteJobTarget(null);
          void handleDelete(target);
        }}
        title={t('adminSettings.confirmDeleteSyncRecord')}
        description={t('adminSettings.confirmDeleteSyncRecordDesc', {
          job:
            deleteJobTarget?.direction === 'cloud_to_local'
              ? t('adminSettings.directionCloudToLocal')
              : t('adminSettings.directionLocalToCloud'),
        })}
        confirmLabel={t('adminSettings.confirmDeleteTitle')}
        confirmDisabled={working}
      />
      <ConfirmDialog
        open={startConfirmOpen}
        onClose={() => setStartConfirmOpen(false)}
        onConfirm={() => {
          setStartConfirmOpen(false);
          void handleStart();
        }}
        icon="cloud_sync"
        iconColor="text-primary"
        iconBg="bg-primary/15"
        title={t('adminSettings.confirmStartSync')}
        description={t('adminSettings.confirmStartSyncDesc', {
          direction:
            direction === 'cloud_to_local'
              ? t('adminSettings.directionCloudToLocalArrow')
              : t('adminSettings.directionLocalToCloudArrow'),
          extra: deleteExtraneous && canDeleteExtra ? t('adminSettings.deleteExtraWarningOn') : '',
        })}
        confirmLabel={t('adminSettings.startSync')}
      />
    </div>
  );
}

function renderEmailSample(source: string, settings: SystemSettings) {
  const vars: Record<string, string> = {
    siteTitle: settings.site_title || '3DPartHub',
    siteLogo: settings.site_logo || `${window.location.origin}/favicon.svg`,
    siteUrl: window.location.origin,
    actionUrl: `${window.location.origin}/my-inquiries/demo`,
    actionLabel: i18n.t('adminSettings.openDetail'),
    contactEmail: settings.contact_email || settings.smtp_from || settings.smtp_user || 'support@example.com',
    currentYear: String(new Date().getFullYear()),
    email: 'test@example.com',
    code: '826419',
    expireMinutes: '10',
    testTime: new Date().toLocaleString('zh-CN', { hour12: false }),
    username: i18n.t('adminSettings.roleCustomer'),
    inquiryNo: 'INQ-20260427-001',
    itemCount: '3',
    statusLabel: i18n.t('adminSettings.statusProcessing'),
    ticketTitle: i18n.t('adminSettings.ticketTypeDownloadIssue'),
    replyPreview: i18n.t('adminSettings.ticketReceivedBody'),
    assigneeName: i18n.t('adminSettings.roleSalesEngineer'),
    modelName: i18n.t('adminSettings.egStepModels'),
    errorMessage: i18n.t('adminSettings.sampleErrorMessage'),
    riskLevel: i18n.t('adminSettings.riskMedium'),
    summary: i18n.t('adminSettings.backupDirLowSpace'),
    downloadFormat: 'STEP',
  };
  return source.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => vars[key] ?? '');
}

function withEmailActionLinks(html: string): string {
  const legacyHeader = 'href="{{siteUrl}}" style="display:inline-flex;';
  const actionHeader = 'href="{{actionUrl}}" style="display:inline-flex;';
  const legacyFooter = '<div><a href="{{siteUrl}}" style="color:#f97316;text-decoration:none;">{{siteUrl}}</a></div>';
  const actionFooter =
    '<div style="margin:0 0 12px;"><a href="{{actionUrl}}" style="display:inline-block;padding:9px 14px;border-radius:8px;background:#f97316;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">{{actionLabel}}</a></div>\n' +
    i18n.t('adminSettings.emailTplEntranceDiv');
  return html.split(legacyHeader).join(actionHeader).split(legacyFooter).join(actionFooter);
}

function getEmailTemplates(settings: SystemSettings) {
  const custom = parseSetting<Record<string, Partial<EmailTemplateConfig>>>(settings.email_templates, {});
  return Object.fromEntries(
    Object.entries(DEFAULT_EMAIL_TEMPLATES).map(([key, fallback]) => {
      const item = custom[key] || {};
      const legacyHtml =
        typeof item.html === 'string' && !item.html.includes('{{siteLogo}}') && !item.html.includes('siteLogo');
      return [
        key,
        {
          ...fallback,
          ...item,
          html: withEmailActionLinks(legacyHtml ? fallback.html : item.html || fallback.html),
          tokens: Array.from(new Set([...(fallback.tokens || []), ...((item.tokens as string[] | undefined) || [])])),
        },
      ];
    }),
  ) as Record<string, EmailTemplateConfig>;
}

function EmailTemplatesEditor({
  settings,
  updateSetting,
  activeKey,
  onActiveKeyChange,
}: {
  settings: SystemSettings;
  updateSetting: SettingUpdater;
  activeKey: string;
  onActiveKeyChange: (key: string) => void;
}) {
  const { t } = useTranslation();
  const templates = getEmailTemplates(settings);
  const keys = Object.keys(templates);
  const resolvedActiveKey = templates[activeKey] ? activeKey : keys[0] || 'smtp_test';
  const active = templates[resolvedActiveKey] || templates[keys[0]];
  const previewSubject = active ? renderEmailSample(t(active.subject, { defaultValue: active.subject }), settings) : '';
  const previewHtml = active ? renderEmailSample(active.html, settings) : '';
  const update = (next: Record<string, EmailTemplateConfig>) => setJsonSetting(updateSetting, 'email_templates', next);
  const patch = (key: string, changes: Partial<EmailTemplateConfig>) =>
    update({
      ...templates,
      [key]: { ...templates[key], ...changes },
    });
  const resetActive = () => {
    if (!DEFAULT_EMAIL_TEMPLATES[resolvedActiveKey]) return;
    patch(resolvedActiveKey, DEFAULT_EMAIL_TEMPLATES[resolvedActiveKey]);
  };

  return (
    <div className="w-full max-w-6xl rounded-lg border border-outline-variant/10 bg-surface-container-high/20 overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] min-h-[620px]">
        <div className="border-b xl:border-b-0 xl:border-r border-outline-variant/10 bg-surface-container-high/35">
          <div className="p-2 space-y-1">
            {keys.map((key) => {
              const item = templates[key];
              const activeItem = key === resolvedActiveKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onActiveKeyChange(key)}
                  className={`w-full text-left rounded-md px-3 py-2.5 transition-colors ${activeItem ? 'bg-primary-container/15 text-on-surface' : 'hover:bg-surface-container-highest/50 text-on-surface-variant'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate">{item.label || key}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-lowest/80 text-on-surface-variant shrink-0">
                      {(item.tokens || []).length}
                    </span>
                  </div>
                  <p className="text-[11px] mt-1 truncate opacity-75">{item.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {active && (
          <div className="min-w-0">
            <div className="p-4 border-b border-outline-variant/10 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-on-surface">{active.label}</h4>
                  <code className="text-[10px] text-on-surface-variant bg-surface-container-lowest border border-outline-variant/10 rounded px-2 py-1">
                    {resolvedActiveKey}
                  </code>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">{active.description}</p>
              </div>
              <button
                type="button"
                onClick={resetActive}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
              >
                <Icon name="restore" size={14} />
                {t('adminSettings.restoreDefaults')}
              </button>
            </div>

            <div className="grid grid-cols-1 2xl:grid-cols-[1.1fr_0.9fr] gap-4 p-4">
              <div className="space-y-4 min-w-0">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-on-surface-variant">
                    {t('adminSettings.emailSubjectLabel')}
                  </span>
                  <input
                    name="subject"
                    value={active.subject}
                    onChange={(e) => patch(resolvedActiveKey, { subject: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2.5 border border-outline-variant/20 outline-none focus:border-primary"
                  />
                </label>

                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-on-surface-variant">
                    {t('adminSettings.availableVars')}
                  </span>
                  <div className="flex flex-wrap gap-1.5 rounded-md bg-surface-container-lowest/60 border border-outline-variant/10 p-2">
                    {(active.tokens || []).map((token) => (
                      <button
                        key={token}
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(`{{${token}}}`)}
                        className="text-[10px] px-2 py-1 rounded bg-primary-container/10 text-primary-container hover:bg-primary-container/20 transition-colors font-mono"
                        title={t('adminSettings.clickToCopy')}
                      >
                        {`{{${token}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-on-surface-variant">
                    {t('adminSettings.htmlBodyLabel')}
                  </span>
                  <textarea
                    name="html"
                    value={active.html}
                    onChange={(e) => patch(resolvedActiveKey, { html: e.target.value })}
                    rows={18}
                    spellCheck={false}
                    className="w-full bg-surface-container-lowest text-on-surface text-xs leading-5 rounded-md px-3 py-3 border border-outline-variant/20 outline-none focus:border-primary resize-y font-mono"
                  />
                </label>
              </div>

              <div className="space-y-2 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-on-surface-variant">{t('adminSettings.preview')}</span>
                  <span className="text-[10px] text-on-surface-variant">
                    {t('adminSettings.previewWithSampleData')}
                  </span>
                </div>
                <div className="rounded-md border border-outline-variant/10 bg-white overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
                    <p className="text-[11px] text-slate-500">Subject</p>
                    <p className="text-sm text-slate-900 truncate">{previewSubject}</p>
                  </div>
                  <iframe
                    title={`${active.label} ${t('adminSettings.previewWord')}`}
                    srcDoc={previewHtml}
                    className="w-full h-[420px] bg-white"
                    sandbox=""
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StructuredSettingEditor({
  itemKey,
  settings,
  updateSetting,
  emailTemplateKey,
  onEmailTemplateKeyChange,
}: {
  itemKey: keyof SystemSettings;
  settings: SystemSettings;
  updateSetting: SettingUpdater;
  emailTemplateKey: string;
  onEmailTemplateKeyChange: (key: string) => void;
}) {
  switch (itemKey) {
    case 'footer_links':
      return <FooterLinksEditor settings={settings} updateSetting={updateSetting} />;
    case 'legal_privacy_sections':
      return (
        <LegalSectionsEditor
          itemKey={itemKey}
          settings={settings}
          updateSetting={updateSetting}
          fallback={DEFAULT_PRIVACY_SECTIONS}
        />
      );
    case 'legal_terms_sections':
      return (
        <LegalSectionsEditor
          itemKey={itemKey}
          settings={settings}
          updateSetting={updateSetting}
          fallback={DEFAULT_TERMS_SECTIONS}
        />
      );
    case 'selection_thread_priority':
      return <ThreadPriorityEditor settings={settings} updateSetting={updateSetting} />;
    case 'inquiry_statuses':
      return (
        <StatusListEditor
          itemKey={itemKey}
          settings={settings}
          updateSetting={updateSetting}
          fallback={DEFAULT_INQUIRY_STATUSES}
        />
      );
    case 'ticket_statuses':
      return (
        <StatusListEditor
          itemKey={itemKey}
          settings={settings}
          updateSetting={updateSetting}
          fallback={DEFAULT_TICKET_STATUSES}
        />
      );
    case 'ticket_classifications':
      return <ClassificationEditor settings={settings} updateSetting={updateSetting} />;
    case 'support_process_steps':
      return <SupportStepsEditor settings={settings} updateSetting={updateSetting} />;
    case 'nav_items':
      return (
        <NavItemsEditor itemKey={itemKey} settings={settings} updateSetting={updateSetting} fallback={DEFAULT_NAV} />
      );
    case 'nav_mobile_items':
      return (
        <NavItemsEditor
          itemKey={itemKey}
          settings={settings}
          updateSetting={updateSetting}
          fallback={DEFAULT_MOBILE_NAV}
        />
      );
    case 'upload_policy':
      return <UploadPolicyEditor settings={settings} updateSetting={updateSetting} />;
    case 'page_size_policy':
      return <PageSizePolicyEditor settings={settings} updateSetting={updateSetting} />;
    case 'email_templates':
      return (
        <EmailTemplatesEditor
          settings={settings}
          updateSetting={updateSetting}
          activeKey={emailTemplateKey}
          onActiveKeyChange={onEmailTemplateKeyChange}
        />
      );
    default:
      return null;
  }
}

function Content() {
  const { t } = useTranslation();
  const location = useLocation();
  const { toast } = useToast();
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  // 记录「正在上传哪个设置项」而非全局布尔：任一图片项上传时只让该项按钮进入
  // 「上传中...」态。全局布尔会让两处上传控件（站点与品牌 / 界面预览）的所有按钮
  // 同时变文案变宽，同行元素被推移——表现为「一起跳动」。
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testEmailTemplateKey, setTestEmailTemplateKey] = useState('smtp_test');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingCache, setTestingCache] = useState(false);
  const [testingStorage, setTestingStorage] = useState(false);
  const [cacheTestResult, setCacheTestResult] = useState<SettingsConnectivityResult | null>(null);
  const [storageTestResult, setStorageTestResult] = useState<SettingsConnectivityResult | null>(null);
  const [activeTab, setActiveTab] = useState(GROUPS[0]?.title || 'adminSettings.tabAccessControl');
  const [previewSubtab, setPreviewSubtab] = useState<PreviewSubtab>('general');
  const [matPresetEdit, setMatPresetEdit] = useState<MaterialPresetKey>('default');
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 切换设置 tab 时把内容区滚回顶部，避免沿用上个 tab 的滚动位置
  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  // Backup state
  const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
  const [backupHealth, setBackupHealth] = useState<BackupHealth | null>(null);
  const [backupPolicyCheck, setBackupPolicyCheck] = useState<BackupPolicyCheck | null>(null);
  const [checkingBackupPolicy, setCheckingBackupPolicy] = useState(false);
  const [verifyingBackupId, setVerifyingBackupId] = useState<string | null>(null);
  const [backupList, setBackupList] = useState<BackupRecord[]>([]);
  // 硬中断（断电/OOM/容器被杀）的恢复任务：非空时在备份页顶部渲染红色告警条，
  // 提供一键回滚到恢复前快照 + 残留旧目录清理
  const [interruptedRestores, setInterruptedRestores] = useState<InterruptedRestoreInfo[]>([]);
  const [recoveringSnapshot, setRecoveringSnapshot] = useState<string | null>(null);
  const [leftoverCleanupBusy, setLeftoverCleanupBusy] = useState(false);
  const [backupScope, setBackupScope] = useState<BackupScope>('full');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ stage: '', percent: 0, message: '', logs: [] as string[] });
  const [verifyProgress, setVerifyProgress] = useState({ stage: '', percent: 0, message: '', logs: [] as string[] });
  const [importing, setImporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [restoreConfirmFile, setRestoreConfirmFile] = useState<File | null>(null);
  const [serverFiles, setServerFiles] = useState<ServerBackupFile[]>([]);
  const [loadingServerFiles, setLoadingServerFiles] = useState(false);
  const [serverFileConfirm, setServerFileConfirm] = useState<ServerBackupFile | null>(null);
  const [serverFilesScanned, setServerFilesScanned] = useState(false);
  // 二次确认弹窗开关（长耗时/重操作，防误触）
  const [policyCheckConfirmOpen, setPolicyCheckConfirmOpen] = useState(false);
  // 体检明细默认收起——保护卡已展示各项状态，逐项检查列表仅在需要排查时展开
  const [policyDetailOpen, setPolicyDetailOpen] = useState(false);
  // 保障胶囊点击展开的详情项（null=全部收起）
  const [protectionDetailKey, setProtectionDetailKey] = useState<string | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  // 备份完成且归档已加密时弹一次告知（密钥保管提醒，防「密钥丢了备份打不开」）
  const [backupEncryptedNoticeOpen, setBackupEncryptedNoticeOpen] = useState(false);
  const [cleanupScanConfirmOpen, setCleanupScanConfirmOpen] = useState(false);
  const [verifyConfirmId, setVerifyConfirmId] = useState<string | null>(null);

  // Update state
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<{
    current: string;
    remote: string;
    updateAvailable: boolean;
    releaseUrl?: string;
    releaseNotes?: string;
  } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  // 版本更新时间线（关于系统页）——初始值取本地缓存，进页秒开不闪加载态
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryEntry[]>(() => readCachedUpdateHistory().entries);
  const [updateHistoryStats, setUpdateHistoryStats] = useState<UpdateHistoryStats | null>(
    () => readCachedUpdateHistory().stats,
  );
  const [updateHistoryLoading, setUpdateHistoryLoading] = useState(false);
  const [updateHistoryLoaded, setUpdateHistoryLoaded] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [restoreForce, setRestoreForce] = useState(false);
  const [backupDeleteConfirm, setBackupDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ stage: '', percent: 0, message: '', logs: [] as string[] });
  const backupInputRef = useRef<HTMLInputElement>(null);
  const backupActionInFlight = useRef(false);
  const restoreActionInFlight = useRef(false);
  const restoreCancelRequestedRef = useRef(false);
  const importActionInFlight = useRef(false);
  const verifyActionInFlight = useRef(false);
  const backupDeleteInFlight = useRef(false);
  const backupDownloadInFlight = useRef(false);
  const policyCheckInFlight = useRef(false);
  const jobToastKeys = useRef<Set<string>>(new Set());

  // Cleanup state
  const [cleanupScan, setCleanupScan] = useState<CleanupScanResult | null>(null);
  const [cleanupScanning, setCleanupScanning] = useState(false);
  const [cleanupSelectedKeys, setCleanupSelectedKeys] = useState<Set<string>>(new Set());
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);

  // Global busy state — prevent concurrent admin operations
  const adminBusy = exporting || importing || restoring || !!verifyingBackupId || !!deletingBackupId;
  const selectedBackupScope =
    BACKUP_SCOPE_OPTIONS.find((option) => option.value === backupScope) || BACKUP_SCOPE_OPTIONS[0];
  // 各备份范围的当前数量（合入创建备份选择卡，替代原「备份范围概览」统计卡区块）
  const backupScopeCounts: Partial<Record<BackupScope, string>> = backupStats
    ? {
        full: backupStats.totalDataSizeText || backupStats.dbSize,
        models: t('adminSettings.statModels', { count: formatStatNumber(backupStats.modelCount) }),
        selection: t('adminSettings.statSelectionProducts', {
          count: formatOptionalStatNumber(backupStats.selectionProductCount),
        }),
        product_wall: t('adminSettings.statGalleryImages', {
          count: formatOptionalStatNumber(backupStats.productWallImageCount),
        }),
        config: t('adminSettings.statConfigItems', { count: formatOptionalStatNumber(backupStats.settingsCount) }),
        users: t('adminSettings.statUserAccounts', { count: formatOptionalStatNumber(backupStats.userCount) }),
        tickets: t('adminSettings.statTickets', { count: formatOptionalStatNumber(backupStats.ticketCount) }),
        inquiries: t('adminSettings.statInquiries', { count: formatOptionalStatNumber(backupStats.inquiryCount) }),
        audit: t('adminSettings.statAuditRecords', { count: formatOptionalStatNumber(backupStats.auditLogCount) }),
      }
    : {};
  const backupProtectionCards = backupHealth ? buildBackupProtectionCards(backupHealth, backupPolicyCheck) : [];
  const backupPolicyIssueCount = backupPolicyCheck
    ? backupPolicyCheck.checks.filter((check) => check.status !== 'ok').length
    : 0;

  function toastJobOnce(
    namespace: string,
    jobId: string | null | undefined,
    message: string,
    type: 'success' | 'error' | 'info' = 'success',
  ) {
    const key = `${namespace}:${jobId || 'unknown'}`;
    if (jobToastKeys.current.has(key)) return;

    if (jobId) {
      const storageKey = `jobToast:${key}`;
      try {
        if (window.sessionStorage.getItem(storageKey)) return;
        window.sessionStorage.setItem(storageKey, '1');
      } catch {
        // sessionStorage can be unavailable in some privacy modes; in-memory guard still works.
      }
    }

    jobToastKeys.current.add(key);
    toast(message, type);
  }

  function toastBackupCreatedOnce(jobId?: string | null) {
    toastJobOnce('backup-create', jobId, t('adminSettings.backupCreated'));
  }

  function toastRestoreSuccessOnce(
    jobId: string | null | undefined,
    result: {
      modelCount: number;
      thumbnailCount: number;
      scope?: BackupScope;
      scopeLabel?: string;
      itemCount?: number;
      fileCount?: number;
    },
  ) {
    if (result.scope && result.scope !== 'full') {
      toastJobOnce(
        'backup-restore',
        jobId,
        t('adminSettings.restoreSuccessDetail', {
          scope: getBackupScopeLabel(result.scope, result.scopeLabel),
          count: result.itemCount ?? result.modelCount,
          files: result.fileCount ?? result.thumbnailCount,
        }),
      );
      return;
    }
    // 预览图数量统计已不再可靠（缩略图格式从 png 转 jpg 后统计口径失效，恒为 0），提示语只保留模型数
    toastJobOnce('backup-restore', jobId, t('adminSettings.restoreSuccessModels', { count: result.modelCount }));
  }

  function toastImportSaveSuccessOnce(jobId?: string | null) {
    toastJobOnce('backup-import-save', jobId, t('adminSettings.backupSavedToList'));
  }

  function toastVerifySuccessOnce(jobId: string | null | undefined, message?: string) {
    toastJobOnce('backup-verify', jobId, message || t('adminSettings.backupVerifyPassed'));
  }

  useEffect(() => {
    loadSettings();
    loadBackupStats();
    loadBackupHealth();
    loadBackupList();
    loadVersion();

    // Resume in-progress tasks from previous session (page refresh)
    resumePendingJobs();
    // Only runs once to hydrate settings and resume persisted backup jobs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resumePendingJobs() {
    // Resume backup job
    let backupJobId = localStorage.getItem('backupJobId');
    try {
      const activeBackup = await getActiveBackupJob();
      if (activeBackup?.id) {
        backupJobId = activeBackup.id;
        localStorage.setItem('backupJobId', activeBackup.id);
        setExportProgress({
          stage: activeBackup.stage || 'resuming',
          percent: activeBackup.percent ?? 0,
          message: activeBackup.message || t('adminSettings.resumingBackupJob'),
          logs: activeBackup.logs || [],
        });
      } else if (backupJobId) {
        localStorage.removeItem('backupJobId');
        backupJobId = null;
      }
    } catch {
      // Active job lookup is best-effort; the normal saved-job resume still works.
    }
    if (backupJobId) {
      setExporting(true);
      setExportProgress((prev) =>
        prev.stage ? prev : { stage: 'resuming', percent: 0, message: t('adminSettings.resumingBackupJob'), logs: [] },
      );
      try {
        const { encrypted } = await pollBackupProgress(backupJobId, (stage, percent, message, logs) => {
          setExportProgress({ stage, percent, message, logs: logs || [] });
        });
        toastBackupCreatedOnce(backupJobId);
        if (encrypted) setBackupEncryptedNoticeOpen(true);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      } catch (err: unknown) {
        toast(errorMessage(err, t('adminSettings.backupJobFailed')), 'error');
      } finally {
        localStorage.removeItem('backupJobId');
        setExporting(false);
        setExportProgress({ stage: '', percent: 0, message: '', logs: [] });
      }
    }

    // Resume restore job
    let restoreJobId = localStorage.getItem('restoreJobId');
    try {
      const activeRestore = await getActiveRestoreJob();
      if (activeRestore?.id) {
        restoreJobId = activeRestore.id;
        localStorage.setItem('restoreJobId', activeRestore.id);
        setRestoreProgress({
          stage: activeRestore.stage || 'resuming',
          percent: activeRestore.percent ?? 0,
          message: activeRestore.message || t('adminSettings.resumingRestoreJob'),
          logs: activeRestore.logs || [],
        });
      } else if (restoreJobId) {
        localStorage.removeItem('restoreJobId');
        localStorage.removeItem('restoreConfirmBackupId');
        restoreJobId = null;
      }
    } catch {
      // Best-effort active lookup; saved job id still works.
    }
    if (restoreJobId) {
      const savedBackupId = localStorage.getItem('restoreConfirmBackupId');
      const restoreJobSource = localStorage.getItem(RESTORE_JOB_SOURCE_KEY);
      if (savedBackupId) setRestoreConfirmId(savedBackupId);
      if (savedBackupId || restoreJobSource === 'backup-record') {
        setRestoring(true);
      } else {
        setImporting(true);
      }
      setRestoreProgress((prev) =>
        prev.stage
          ? prev
          : {
              stage: 'resuming',
              percent: 0,
              message: savedBackupId ? t('adminSettings.resumingBackupRecords') : t('adminSettings.resumingImportJob'),
              logs: [],
            },
      );
      try {
        const result = await pollRestoreProgress(restoreJobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toastRestoreSuccessOnce(restoreJobId, result);
        setRestoreConfirmId(null);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      } catch (err: unknown) {
        handleRestoreFlowError(err, t('adminSettings.restoreFailed'));
      } finally {
        localStorage.removeItem('restoreJobId');
        localStorage.removeItem('restoreConfirmBackupId');
        localStorage.removeItem(RESTORE_JOB_SOURCE_KEY);
        setRestoring(false);
        setImporting(false);
        setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
      }
    }

    // Resume import-save job
    let importSaveJobId = localStorage.getItem('importSaveJobId');
    try {
      const activeImportSave = await getActiveImportSaveJob();
      if (activeImportSave?.id) {
        importSaveJobId = activeImportSave.id;
        localStorage.setItem('importSaveJobId', activeImportSave.id);
        setRestoreProgress({
          stage: activeImportSave.stage || 'resuming',
          percent: activeImportSave.percent ?? 0,
          message: activeImportSave.message || t('adminSettings.resumingImportSaveJob'),
          logs: activeImportSave.logs || [],
        });
      } else if (importSaveJobId) {
        localStorage.removeItem('importSaveJobId');
        importSaveJobId = null;
      }
    } catch {
      // Best-effort active lookup; saved job id still works.
    }
    if (importSaveJobId) {
      setImporting(true);
      setRestoreProgress((prev) =>
        prev.stage
          ? prev
          : { stage: 'resuming', percent: 0, message: t('adminSettings.resumingImportSaveJob'), logs: [] },
      );
      try {
        await pollImportSaveProgress(importSaveJobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toastImportSaveSuccessOnce(importSaveJobId);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      } catch (err: unknown) {
        toast(errorMessage(err, t('adminSettings.importSaveFailed')), 'error');
      } finally {
        localStorage.removeItem('importSaveJobId');
        setImporting(false);
        setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
      }
    }

    try {
      const activeVerify = await getActiveVerifyBackupJob();
      if (activeVerify?.id && activeVerify.backupId) {
        setVerifyingBackupId(activeVerify.backupId);
        setVerifyProgress({
          stage: activeVerify.stage || 'validating_archive',
          percent: activeVerify.percent ?? 0,
          message: activeVerify.message || t('adminSettings.resumingVerifyJob'),
          logs: activeVerify.logs || [],
        });
        try {
          const result = await pollVerifyBackupProgress(activeVerify.id, (stage, percent, message, logs) => {
            setVerifyProgress({ stage, percent, message, logs: logs || [] });
          });
          toastVerifySuccessOnce(activeVerify.id, result.message);
          loadBackupList();
          loadBackupHealth();
        } catch (err: unknown) {
          toast(errorMessage(err, t('adminSettings.backupVerifyFailed')), 'error');
        } finally {
          setVerifyingBackupId(null);
          setVerifyProgress({ stage: '', percent: 0, message: '', logs: [] });
        }
      }
    } catch {
      // Best-effort active lookup; manual verification still works.
    }
  }

  async function loadSettings() {
    try {
      const data = await getSettings();
      setSettings(normalizeSettingsForClient(data));
    } catch {
      toast(t('adminSettings.loadSettingsFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadBackupStats() {
    try {
      const stats = await getBackupStats();
      setBackupStats(stats);
    } catch {
      // Stats are informational — failure doesn't block the page
    }
  }

  async function loadBackupHealth() {
    try {
      const health = await getBackupHealth();
      setBackupHealth(health);
    } catch {
      // Health is informational — failure doesn't block the page
    }
  }

  async function handleBackupPolicyCheck() {
    if (policyCheckInFlight.current) return;
    policyCheckInFlight.current = true;
    setCheckingBackupPolicy(true);
    try {
      const result = await checkBackupPolicy();
      setBackupPolicyCheck(result);
      if (result.status === 'ok') toast(t('adminSettings.policyCheckPassed'), 'success');
      else if (result.status === 'warning') toast(t('adminSettings.policyCheckHasWarnings'), 'info');
      else toast(t('adminSettings.policyCheckFoundErrors'), 'error');
      loadBackupHealth();
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.policyCheckFailed')), 'error');
    } finally {
      policyCheckInFlight.current = false;
      setCheckingBackupPolicy(false);
    }
  }

  async function handleVerifyBackup(id: string) {
    if (verifyActionInFlight.current) return;
    verifyActionInFlight.current = true;
    setVerifyingBackupId(id);
    setVerifyProgress({ stage: 'queued', percent: 0, message: t('adminSettings.preparingVerifiedBackup'), logs: [] });
    try {
      const jobId = await startVerifyBackupJob(id);
      const result = await pollVerifyBackupProgress(jobId, (stage, percent, message, logs) => {
        setVerifyProgress({ stage, percent, message, logs: logs || [] });
      });
      toastVerifySuccessOnce(jobId, result.message);
      loadBackupList();
      loadBackupHealth();
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.backupVerifyFailed')), 'error');
    } finally {
      verifyActionInFlight.current = false;
      setVerifyingBackupId(null);
      setVerifyProgress({ stage: '', percent: 0, message: '', logs: [] });
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const validationMessage = validateSettingsBeforeSave(settings);
      if (validationMessage) {
        toast(validationMessage, 'error');
        return;
      }
      const normalizedSettings = normalizeSettingsForSave(settings);
      if (JSON.stringify(normalizedSettings) !== JSON.stringify(settings)) {
        setSettings(normalizedSettings);
      }
      const data = await updateSettings(normalizedSettings);
      const nextSettings = normalizeSettingsForClient({ ...normalizedSettings, ...data });
      setSettings(nextSettings);
      setChanged(false);
      // Refresh site config: re-fetch settings, apply title/logo/favicon, notify components
      const { refreshSiteConfig } = await import('../lib/publicSettings');
      await refreshSiteConfig();
      patchPublicSettings(pickPublicAppearanceSettings(nextSettings));
      loadBackupHealth();
      toast(t('adminSettings.settingsSaved'), 'success');
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.saveFailed')), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveCurrentSettingsSilently() {
    const validationMessage = validateSettingsBeforeSave(settings);
    if (validationMessage) throw new Error(validationMessage);
    const normalizedSettings = normalizeSettingsForSave(settings);
    if (JSON.stringify(normalizedSettings) !== JSON.stringify(settings)) {
      setSettings(normalizedSettings);
    }
    const data = await updateSettings(normalizedSettings);
    const nextSettings = normalizeSettingsForClient({ ...normalizedSettings, ...data });
    setSettings(nextSettings);
    setChanged(false);
    const { refreshSiteConfig } = await import('../lib/publicSettings');
    await refreshSiteConfig();
    patchPublicSettings(pickPublicAppearanceSettings(nextSettings));
  }

  function updateSetting(key: keyof SystemSettings, value: boolean | number | string) {
    if (READONLY_SETTING_KEYS.has(key)) return;
    setSettings((prev) => {
      let next: SystemSettings;
      if (key === 'footer_copyright_follow_site_title') {
        next = {
          ...prev,
          footer_copyright_follow_site_title: value as boolean,
          footer_copyright: value ? resolveFooterCopyright(prev) : DEFAULT_FOOTER_COPYRIGHT,
        };
        return next;
      }
      if (key === 'model_detail_copyright_follow_site_title') {
        next = {
          ...prev,
          model_detail_copyright_follow_site_title: value as boolean,
          model_detail_copyright: value ? resolveModelDetailCopyright(prev) : DEFAULT_MODEL_DETAIL_COPYRIGHT,
        };
        return next;
      }
      next = { ...prev, [key]: value };
      if (key === 'interface_theme') {
        void mutateSWR('publicSettings', next, { revalidate: false });
      }
      return next;
    });
    setChanged(true);
  }

  function handleReset3DPreview() {
    const defaults = Object.fromEntries(
      PREVIEW_SETTING_KEYS.map((key) => [key, DEFAULT_SETTINGS[key]]),
    ) as Partial<SystemSettings>;
    setSettings((prev) => ({ ...prev, ...defaults }) as SystemSettings);
    setChanged(true);
    toast(t('adminSettings.resetToPresetDone'), 'success');
  }

  async function handleSendTestEmail() {
    if (!testEmailTo.trim()) {
      toast(t('adminSettings.enterTestEmail'), 'error');
      return;
    }
    setTestingEmail(true);
    try {
      if (changed) {
        const validationMessage = validateSettingsBeforeSave(settings);
        if (validationMessage) {
          toast(validationMessage, 'error');
          return;
        }
        const normalizedSettings = normalizeSettingsForSave(settings);
        const nextSettings = await updateSettings(normalizedSettings);
        setSettings(normalizeSettingsForClient({ ...normalizedSettings, ...nextSettings }));
        setChanged(false);
      }
      const templates = getEmailTemplates(settings);
      const templateKey = templates[testEmailTemplateKey] ? testEmailTemplateKey : 'smtp_test';
      await sendTestEmail(testEmailTo.trim(), templateKey);
      toast(t('adminSettings.testEmailSent'), 'success');
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.testEmailFailed')), 'error');
    } finally {
      setTestingEmail(false);
    }
  }

  function readConnectivityError(err: unknown, fallback: string): SettingsConnectivityResult {
    const payload = apiErrorLike(err).response?.data;
    if (isConnectivityResult(payload)) return payload;
    return {
      ok: false,
      status: 'error',
      message: errorMessage(err, fallback),
      details: [],
    };
  }

  async function handleTestCacheSettings() {
    setTestingCache(true);
    setCacheTestResult(null);
    try {
      if (changed) {
        await saveCurrentSettingsSilently();
      }
      const result = await testCacheSettings();
      setCacheTestResult(result);
      toast(result.message, result.status === 'success' ? 'success' : 'info');
    } catch (err: unknown) {
      const result = readConnectivityError(err, t('adminSettings.cacheTestFailed'));
      setCacheTestResult(result);
      toast(result.message, 'error');
    } finally {
      setTestingCache(false);
    }
  }

  async function handleTestStorageSettings() {
    setTestingStorage(true);
    setStorageTestResult(null);
    try {
      if (changed) {
        await saveCurrentSettingsSilently();
      }
      const result = await testStorageSettings();
      setStorageTestResult(result);
      toast(result.message, result.status === 'success' ? 'success' : 'info');
    } catch (err: unknown) {
      const result = readConnectivityError(err, t('adminSettings.storageTestFailed'));
      setStorageTestResult(result);
      toast(result.message, 'error');
    } finally {
      setTestingStorage(false);
    }
  }

  /** 读取 PNG 宽高；返回 null 表示非 PNG 或读取失败（跳过校验） */
  function readPngDimensions(file: File): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const buf = new Uint8Array(reader.result as ArrayBuffer);
          const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
          if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return resolve(null);
          const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
          resolve({ width: view.getUint32(16), height: view.getUint32(20) });
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 方形图标上传前的尺寸提示。
   * 返回：'abort'（严重不符，用户选择不上传——当前实现为过小图标直接拦）、
   * 提示文案（警告但允许继续）、''（无需提示）。
   */
  async function checkSquareIconSize(file: File, key: string): Promise<'abort' | '' | string> {
    const dims = await readPngDimensions(file);
    if (!dims) return '';
    const { width, height } = dims;
    const label =
      key === 'site_app_icon'
        ? t('adminSettings.appIcon')
        : key === 'site_icon'
          ? t('adminSettings.siteIcon')
          : t('adminSettings.faviconIcon');
    if (width !== height) {
      toast(t('adminSettings.iconSquareAdvice', { label, width, height }), 'error');
      return 'abort';
    }
    if (key === 'site_app_icon' && width < 192) {
      toast(t('adminSettings.appIconMinSize', { width }), 'info');
    }
    return '';
  }

  async function handleImageUpload(key: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // 方形图标类上传前先量尺寸：非正方形/过小的应用图标会导致 Chrome 桌面安装
    // 流程弃用该图标（PWA 规范要求 ≥144 且建议正方形），提前给出提示
    if (['site_app_icon', 'site_icon', 'site_favicon'].includes(key) && file.type === 'image/png') {
      const sizeWarn = await checkSquareIconSize(file, key);
      if (sizeWarn === 'abort') {
        if (imageInputRefs.current[key]) imageInputRefs.current[key]!.value = '';
        return;
      }
      if (sizeWarn) toast(sizeWarn, 'info');
    }
    setUploadingKey(key);
    try {
      const { url } = await uploadImage(file, key);
      setSettings((prev) => ({ ...prev, [key]: url }));
      setChanged(true);
      toast(t('adminSettings.imageUploadedSaveNow'), 'success');
    } catch {
      toast(t('adminSettings.uploadFailed'), 'error');
    } finally {
      setUploadingKey(null);
      if (imageInputRefs.current[key]) imageInputRefs.current[key]!.value = '';
    }
  }

  async function handleExport() {
    if (backupActionInFlight.current) return;
    backupActionInFlight.current = true;
    setExporting(true);
    setExportProgress({ stage: 'dumping', percent: 0, message: t('adminSettings.preparing'), logs: [] });
    try {
      const jobId = await startBackupJob(backupScope);
      localStorage.setItem('backupJobId', jobId);
      const { encrypted } = await pollBackupProgress(jobId, (stage, percent, message, logs) => {
        setExportProgress({ stage, percent, message, logs: logs || [] });
      });
      toastBackupCreatedOnce(jobId);
      if (encrypted) setBackupEncryptedNoticeOpen(true);
      localStorage.removeItem('backupJobId');
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
    } catch (err: unknown) {
      const existingJobId = errorJobId(err);
      if (existingJobId) {
        toast(t('adminSettings.backupAlreadyRunningProgressRestored'), 'info');
        localStorage.setItem('backupJobId', existingJobId);
        try {
          const { encrypted } = await pollBackupProgress(existingJobId, (stage, percent, message, logs) => {
            setExportProgress({ stage, percent, message, logs: logs || [] });
          });
          toastBackupCreatedOnce(existingJobId);
          if (encrypted) setBackupEncryptedNoticeOpen(true);
          loadBackupList();
          loadBackupStats();
          loadBackupHealth();
        } catch (pollErr: unknown) {
          toast(errorMessage(pollErr, t('adminSettings.queryBackupProgressFailed')), 'error');
        } finally {
          localStorage.removeItem('backupJobId');
        }
      } else {
        localStorage.removeItem('backupJobId');
        toast(errorMessage(err, t('adminSettings.exportFailed')), 'error');
      }
    } finally {
      backupActionInFlight.current = false;
      setExporting(false);
      setExportProgress({ stage: '', percent: 0, message: '', logs: [] });
    }
  }

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    try {
      const info = await checkUpdate();
      setUpdateInfo(info);
      if (!info.updateAvailable) {
        toast(t('adminSettings.alreadyLatestVersion'), 'success');
      }
    } catch {
      toast(t('adminSettings.checkUpdatesFailed'), 'error');
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function loadUpdateHistory() {
    if (updateHistoryLoading) return;
    setUpdateHistoryLoading(true);
    try {
      const { entries, stats } = await getUpdateHistory();
      setUpdateHistory(entries);
      setUpdateHistoryStats(stats);
      setUpdateHistoryLoaded(true);
      writeCachedUpdateHistory(entries, stats);
    } catch {
      // 拉取失败保留空列表，UI 显示重试入口
    } finally {
      setUpdateHistoryLoading(false);
    }
  }

  async function loadBackupList() {
    try {
      const list = await listBackups();
      setBackupList(list);
    } catch {
      // Backup list load failure — user can still use the page
    }
    // 中断恢复检测与备份列表同生命周期刷新（初始加载/恢复完成/导入完成后都会走到这里）
    try {
      setInterruptedRestores(await fetchInterruptedRestores());
    } catch {
      // best-effort：检测失败不阻塞页面
    }
  }

  async function loadInterruptedRestoresOnly() {
    try {
      setInterruptedRestores(await fetchInterruptedRestores());
    } catch {
      // best-effort
    }
  }

  async function handleRecoverInterrupted(info: InterruptedRestoreInfo) {
    if (!info.durableSnapshot || recoveringSnapshot) return;
    const when = info.startedAt ? new Date(info.startedAt).toLocaleString() : t('adminSettings.unknownTime');
    if (
      !window.confirm(
        t('adminSettings.confirmRollbackTitle', { time: when }) +
          '\n\n' +
          t('adminSettings.rollbackNoteDbReset') +
          '\n' +
          t('adminSettings.rollbackNoteKeepOpen') +
          '\n' +
          t('adminSettings.rollbackNoteResyncFiles'),
      )
    )
      return;
    setRecoveringSnapshot(info.durableSnapshot);
    toast(t('adminSettings.rollbackStarted'), 'info', 8000);
    try {
      await recoverInterruptedRestore(info.durableSnapshot);
    } catch {
      // 代理可能掐断长连接但服务端会继续执行完成——不提示失败，靠轮询感知结果
    }
    // 轮询直到该快照从中断列表消失（每 10s，最长 30 分钟）
    for (let i = 0; i < 180; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      let current: InterruptedRestoreInfo[] = [];
      try {
        current = await fetchInterruptedRestores();
      } catch {
        continue;
      }
      setInterruptedRestores(current);
      if (!current.some((item) => item.durableSnapshot === info.durableSnapshot)) {
        toast(t('adminSettings.rollbackSucceeded'), 'success');
        setRecoveringSnapshot(null);
        loadBackupList();
        return;
      }
    }
    setRecoveringSnapshot(null);
    toast(t('adminSettings.rollbackStillRunning'), 'info', 8000);
  }

  async function handleClearLeftoverDirs() {
    if (leftoverCleanupBusy) return;
    if (
      !window.confirm(
        t('adminSettings.confirmClearLeftoverTitle') +
          '\n\n' +
          t('adminSettings.leftoverNoteIrreversible') +
          '\n' +
          t('adminSettings.rollbackNoteOnlyAfter'),
      )
    )
      return;
    setLeftoverCleanupBusy(true);
    try {
      const result = await clearLeftoverRestoreDirs();
      if (result.ok) {
        toast(result.message || t('adminSettings.cleanedResidualDirs', { count: result.removed }), 'success');
      } else {
        toast(result.message || t('adminSettings.someResidualCleanupFailed'), 'error');
      }
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.cleanupResidualFailed')), 'error');
    } finally {
      setLeftoverCleanupBusy(false);
      loadInterruptedRestoresOnly();
    }
  }

  async function loadVersion() {
    try {
      const v = await getVersion();
      setCurrentVersion(v || 'unknown');
    } catch {
      setCurrentVersion('unknown');
    }
  }

  function handleBackupFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.tar.gz') && !lowerName.endsWith('.tgz')) {
      toast(t('adminSettings.chooseTarGzFile'), 'error');
      return;
    }
    // 大文件分块上传支持断点续传：检测是否有同指纹的未完成会话，提示用户会自动跳过已传分块
    if (file.size >= BACKUP_DIRECT_UPLOAD_THRESHOLD_BYTES && hasResumableChunkedUpload(file)) {
      toast(t('adminSettings.resumeDetected'), 'info');
    }
    setRestoreConfirmFile(file);
  }

  async function handleImport(mode: 'restore' | 'save') {
    if (!restoreConfirmFile) return;
    if (importActionInFlight.current) return;
    importActionInFlight.current = true;
    setImporting(true);
    setUploadProgress(0);
    try {
      if (mode === 'save') {
        // Save as backup record (no restore)
        const isLarge = restoreConfirmFile.size >= BACKUP_DIRECT_UPLOAD_THRESHOLD_BYTES;
        let importSaveJobId: string | null = null;
        await importBackupAsRecord(
          restoreConfirmFile,
          isLarge ? 'chunked' : 'direct',
          (p) => setUploadProgress(p),
          (stage, percent, message, logs) => {
            setRestoreProgress({ stage, percent, message, logs: logs || [] });
          },
          (jobId) => {
            // Persist jobId for page refresh resume
            importSaveJobId = jobId;
            localStorage.setItem('importSaveJobId', jobId);
          },
        );
        toastImportSaveSuccessOnce(importSaveJobId);
        setRestoreConfirmFile(null);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      } else {
        // Direct import and restore
        const jobId = await importBackup(
          restoreConfirmFile,
          (p) => {
            setUploadProgress(p);
          },
          (phase) => {
            if (phase === 'merging') {
              setRestoreProgress({
                stage: 'uploading',
                percent: 100,
                message: t('adminSettings.chunksMerging'),
                logs: [],
              });
            } else if (phase === 'starting') {
              setRestoreProgress({
                stage: 'uploading',
                percent: 100,
                message: t('adminSettings.mergeDoneStartingRestore'),
                logs: [],
              });
            }
          },
        );
        localStorage.setItem('restoreJobId', jobId);
        localStorage.setItem(RESTORE_JOB_SOURCE_KEY, 'import-file');
        setRestoreProgress({
          stage: 'uploading',
          percent: 0,
          message: t('adminSettings.uploadDoneStartingRestore'),
          logs: [],
        });
        const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toastRestoreSuccessOnce(jobId, result);
        setRestoreConfirmFile(null);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      }
    } catch (err: unknown) {
      handleRestoreFlowError(err, t('adminSettings.actionFailed'));
    } finally {
      localStorage.removeItem('restoreJobId');
      localStorage.removeItem('importSaveJobId');
      localStorage.removeItem(RESTORE_JOB_SOURCE_KEY);
      importActionInFlight.current = false;
      setImporting(false);
      setUploadProgress(0);
      setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  }

  async function handleLoadServerFiles() {
    setLoadingServerFiles(true);
    try {
      const files = await listServerBackupFiles();
      setServerFiles(files);
      setServerFilesScanned(true);
    } catch {
      toast(t('adminSettings.fetchServerFilesFailed'), 'error');
    } finally {
      setLoadingServerFiles(false);
    }
  }

  async function handleServerFileImport(file: ServerBackupFile) {
    if (importActionInFlight.current) return;
    importActionInFlight.current = true;
    setServerFileConfirm(null);
    setImporting(true);
    setRestoreProgress({
      stage: 'starting',
      percent: 0,
      message: t('adminSettings.restoringFromServerPath'),
      logs: [],
    });
    try {
      const jobId = await importBackupFromPath(file.path);
      localStorage.setItem('restoreJobId', jobId);
      localStorage.setItem(RESTORE_JOB_SOURCE_KEY, 'server-file');
      const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
        setRestoreProgress({ stage, percent, message, logs: logs || [] });
      });
      toastRestoreSuccessOnce(jobId, result);
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
    } catch (err: unknown) {
      handleRestoreFlowError(err, t('adminSettings.restoreFailed'));
    } finally {
      localStorage.removeItem('restoreJobId');
      localStorage.removeItem(RESTORE_JOB_SOURCE_KEY);
      importActionInFlight.current = false;
      setImporting(false);
      setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
    }
  }

  async function handleDownloadBackup(id: string) {
    // 防重入：大文件从点击到浏览器下载条出现可能有数秒延迟（令牌请求 + 代理缓冲），
    // 期间页面无任何反馈，重复点击会拉起多个并行下载——第二个文件名带 (1)，
    // 表现为「下载完又下载一遍」。
    if (backupDownloadInFlight.current) return;
    backupDownloadInFlight.current = true;
    try {
      toast(t('adminSettings.downloadStarted'), 'success');
      const { rangeSupported } = await downloadBackup(id);
      // 下载已正常发起；这是链路体检结果：代理/CDN 剥 Range 时大文件中断后会整单重下
      if (rangeSupported === false) {
        toast(t('adminSettings.noResumeSupported'), 'info', 8000);
      }
    } catch {
      toast(t('adminSettings.downloadFailed'), 'error');
    } finally {
      backupDownloadInFlight.current = false;
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    try {
      await renameBackup(id, renameValue.trim());
      setRenamingId(null);
      setRenameValue('');
      loadBackupList();
      toast(t('adminSettings.renamed'), 'success');
    } catch {
      toast(t('adminSettings.renameFailed'), 'error');
    }
  }

  async function handleDelete(id: string) {
    if (backupDeleteInFlight.current) return;
    backupDeleteInFlight.current = true;
    setBackupDeleteConfirm(null);
    setDeletingBackupId(id);
    try {
      await deleteBackup(id);
      setBackupList((list) => list.filter((backup) => backup.id !== id));
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
      toast(t('adminSettings.backupDeleted'), 'success');
    } catch (err: unknown) {
      loadBackupList();
      toast(errorMessage(err, t('adminSettings.deleteFailed')), 'error');
    } finally {
      backupDeleteInFlight.current = false;
      setDeletingBackupId(null);
    }
  }

  function handleRestoreRequest(id: string) {
    setRestoreForce(false);
    setRestoreConfirmId(id);
  }

  async function handleCancelRestore() {
    const jobId = localStorage.getItem('restoreJobId');
    if (!jobId) {
      toast(t('adminSettings.noActiveRestoreFound'), 'info');
      return;
    }
    if (!window.confirm(t('adminSettings.confirmStopRestore'))) return;
    restoreCancelRequestedRef.current = true;
    try {
      const r = await cancelRestore(jobId);
      if (r.cancelled) {
        toast(r.message || t('adminSettings.restoreStopped'), 'success');
      } else {
        restoreCancelRequestedRef.current = false;
        toast(r.message || t('adminSettings.cannotStopRestoreNow'), 'info');
      }
    } catch (err: unknown) {
      restoreCancelRequestedRef.current = false;
      toast(errorMessage(err, t('adminSettings.stopRestoreFailed')), 'error');
    }
  }

  function handleRestoreFlowError(err: unknown, fallback: string) {
    if (restoreCancelRequestedRef.current) {
      restoreCancelRequestedRef.current = false;
      return; // 取消的提示已由 handleCancelRestore 发出，这里静默吞掉 poll 的拒绝
    }
    toast(errorMessage(err, fallback), 'error');
  }

  const restoreStageLocked = restoreProgress.stage === 'restoring_db' || restoreProgress.stage === 'restoring_files';
  const cancelRestoreButton = restoreProgress.message ? (
    <div className="mt-2 flex justify-end">
      <button
        type="button"
        disabled={restoreStageLocked}
        onClick={handleCancelRestore}
        title={restoreStageLocked ? t('adminSettings.restoreCannotCancel') : t('adminSettings.stopRestoreSafe')}
        className="px-2.5 py-1.5 text-xs font-medium bg-error-container/10 text-error rounded-md hover:bg-error-container/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
      >
        <Icon name="block" size={13} />
        {t('adminSettings.stopRestore')}
      </button>
    </div>
  ) : null;

  async function handleRestoreConfirm() {
    if (!restoreConfirmId) return;
    if (restoreActionInFlight.current) return;
    restoreActionInFlight.current = true;
    setRestoring(true);
    setRestoreProgress({ stage: 'starting', percent: 0, message: t('adminSettings.startingRestore'), logs: [] });
    try {
      const jobId = await startRestore(restoreConfirmId, restoreForce);
      localStorage.setItem('restoreJobId', jobId);
      localStorage.setItem('restoreConfirmBackupId', restoreConfirmId);
      localStorage.setItem(RESTORE_JOB_SOURCE_KEY, 'backup-record');
      const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
        setRestoreProgress({ stage, percent, message, logs: logs || [] });
      });
      toastRestoreSuccessOnce(jobId, result);
      setRestoreConfirmId(null);
      setRestoreForce(false);
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
    } catch (err: unknown) {
      handleRestoreFlowError(err, t('adminSettings.restoreFailed'));
    } finally {
      localStorage.removeItem('restoreJobId');
      localStorage.removeItem('restoreConfirmBackupId');
      localStorage.removeItem(RESTORE_JOB_SOURCE_KEY);
      restoreActionInFlight.current = false;
      setRestoring(false);
      setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
    }
  }

  async function handleCleanupScan() {
    if (cleanupScanning) return;
    setCleanupScanning(true);
    setCleanupScan(null);
    setCleanupSelectedKeys(new Set());
    try {
      const result = await scanCleanup();
      setCleanupScan(result);
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.scanFailed')), 'error');
    } finally {
      setCleanupScanning(false);
    }
  }

  async function handleCleanupSelectedConfirm() {
    if (cleanupSelectedKeys.size === 0 || cleanupRunning) return;
    setCleanupConfirmOpen(false);
    setCleanupRunning(true);
    try {
      const result = await executeCleanup(Array.from(cleanupSelectedKeys));
      toast(
        t('adminSettings.cleanupDoneSummary', {
          count: result.deletedCount,
          size: result.freedSizeText,
          extra: result.failedCount > 0 ? t('adminSettings.cleanupFailedSuffix', { count: result.failedCount }) : '',
        }),
        result.failedCount > 0 ? 'info' : 'success',
      );
      setCleanupSelectedKeys(new Set());
      const newScan = await scanCleanup();
      setCleanupScan(newScan);
    } catch (err: unknown) {
      toast(errorMessage(err, t('adminSettings.cleanupFailed')), 'error');
    } finally {
      setCleanupRunning(false);
    }
  }

  useEffect(() => {
    if (location.hash === '#backup') {
      setActiveTab(t('adminSettings.tabBackup'));
    }
  }, [location.hash]);

  useEffect(() => {
    if (location.hash !== '#backup' || activeTab !== 'adminSettings.tabBackup') return;
    window.setTimeout(() => {
      document.getElementById('backup')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [activeTab, location.hash]);

  // 进入「关于系统」页自动拉取版本更新时间线（失败可手动重试）。
  // 首次进页若已有本地缓存则直接展示并跳过请求（服务端长期缓存 + 新版本才全量刷新，
  // 缓存内容极少变化）；手动点刷新按钮仍会强制拉取。
  useEffect(() => {
    if (activeTab === 'adminSettings.tabAboutSystem' && !updateHistoryLoaded && !updateHistoryLoading) {
      if (updateHistory.length > 0) {
        setUpdateHistoryLoaded(true);
      } else {
        void loadUpdateHistory();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  if (loading) {
    return <SettingsLoadingState />;
  }

  const cacheStorageGroup = GROUPS.find((group) => group.title === CACHE_STORAGE_GROUP_TITLE);
  const cacheStorageSections = cacheStorageGroup ? splitSettingGroupSections(cacheStorageGroup) : [];
  const cacheStorageSectionTabs = cacheStorageSections.map((section) => ({
    title: section.title,
    icon: SETTING_SECTION_ICONS[section.title] || 'storage',
  }));
  const tabs = [
    ...GROUPS.filter((group) => group.title !== CACHE_STORAGE_GROUP_TITLE).map((group) => ({
      title: group.title,
      icon: group.icon,
    })),
    ...cacheStorageSectionTabs,
    // title 必须存键（与 GROUPS/SETTINGS_NAV_GROUPS.sections/activeTab 比较链一致）；
    // 显示文案由 tabItems 的 t(tab.title, {defaultValue}) 负责。此前误用 t() 返回值，
    // 键值世界不一致导致 navGroups 匹配失败——备份/缓存清理/关于系统三个 tab 整体消失
    { title: 'adminSettings.tabBackup', icon: 'cloud_upload' },
    { title: 'adminSettings.tabCacheCleanup', icon: 'cleaning_services' },
    { title: 'adminSettings.tabAboutSystem', icon: 'info' },
  ];
  const resolvedActiveTab = activeTab === CACHE_STORAGE_GROUP_TITLE ? CACHE_STORAGE_SECTION_TITLES[0] : activeTab;
  const activeGroup = GROUPS.find((group) => group.title === resolvedActiveTab);
  const activeCacheStorageSection = cacheStorageSections.find((section) => section.title === resolvedActiveTab);
  const activeContentGroup =
    activeGroup ||
    (activeCacheStorageSection
      ? {
          title: activeCacheStorageSection.title,
          icon: SETTING_SECTION_ICONS[activeCacheStorageSection.title] || 'storage',
          items: activeCacheStorageSection.items,
        }
      : undefined);
  const tabItems = tabs.map((tab) => ({
    value: tab.title,
    label: t(tab.title, { defaultValue: tab.title }),
    icon: tab.icon,
  }));
  const tabItemMap = new Map(tabItems.map((tab) => [tab.value, tab]));
  const navGroups = SETTINGS_NAV_GROUPS.map((group) => ({
    ...group,
    sections: group.sections
      .map((section) => tabItemMap.get(section))
      .filter((section): section is (typeof tabItems)[number] => Boolean(section)),
  })).filter((group) => group.sections.length > 0);
  const activeNavGroup =
    navGroups.find((group) => group.sections.some((section) => section.value === resolvedActiveTab)) || navGroups[0];
  const primaryTabItems = navGroups.map((group) => ({
    value: group.title,
    label: t(group.title, { defaultValue: group.title }),
    icon: group.icon,
  }));
  const secondaryTabItems = activeNavGroup?.sections || tabItems;
  const handlePrimaryTabChange = (value: string) => {
    const nextGroup = navGroups.find((group) => group.title === value);
    const nextTab = nextGroup?.sections[0]?.value;
    if (nextTab) {
      setActiveTab(nextTab);
    }
  };

  const headerActions = (
    <div className="flex min-h-10 shrink-0 items-center justify-end gap-2">
      <span
        className={`hidden items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs md:inline-flex ${changed ? 'text-amber-500' : 'text-on-surface-variant'}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${changed ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        {/* 两个文案都是 7 个字（CJK 等宽），切换时宽度不变，避免页面抖动 */}
        {changed ? t('adminSettings.hasUnsavedChanges') : t('adminSettings.configSaved')}
      </span>
      <button
        onClick={handleSave}
        disabled={!changed || saving}
        className="inline-flex h-9 w-[6.25rem] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3.5 text-xs font-bold text-on-primary shadow-sm transition-colors hover:opacity-95 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none md:h-8"
      >
        <Icon name="save" size={14} />
        {saving ? t('adminSettings.saving') : t('adminSettings.saveSettings')}
      </button>
    </div>
  );
  const settingsHeaderNavigation = (
    <ResponsiveSectionTabs
      tabs={primaryTabItems}
      value={activeNavGroup?.title || primaryTabItems[0]?.value || ''}
      onChange={handlePrimaryTabChange}
      mobileTitle={t('adminSettings.settingGroups')}
      mobileTriggerVariant="surface"
      desktopVariant="prominent"
      desktopAlign="end"
      className="w-full min-w-0"
    />
  );
  const secondarySettingsNavigation =
    secondaryTabItems.length > 1 ? (
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest/80 px-2 py-2 shadow-sm shadow-black/5">
        <ResponsiveSectionTabs
          tabs={secondaryTabItems}
          value={resolvedActiveTab}
          onChange={setActiveTab}
          mobileTitle={t('adminSettings.settingItem')}
          mobileTriggerVariant="surface"
          desktopVariant="subtle"
          className="w-full min-w-0"
        />
      </div>
    ) : null;
  const mobileSettingsPicker = (
    <div className="grid gap-2 md:hidden">
      <ResponsiveSectionTabs
        tabs={primaryTabItems}
        value={activeNavGroup?.title || primaryTabItems[0]?.value || ''}
        onChange={handlePrimaryTabChange}
        mobileTitle={t('adminSettings.settingGroups')}
        mobileTriggerVariant="surface"
      />
      {secondarySettingsNavigation}
    </div>
  );
  const emailTemplatesForTest = getEmailTemplates(settings);
  const fallbackEmailTemplateKey = emailTemplatesForTest.smtp_test
    ? 'smtp_test'
    : Object.keys(emailTemplatesForTest)[0] || 'smtp_test';
  const resolvedTestEmailTemplateKey = emailTemplatesForTest[testEmailTemplateKey]
    ? testEmailTemplateKey
    : fallbackEmailTemplateKey;
  const resolvedTestEmailTemplate = emailTemplatesForTest[resolvedTestEmailTemplateKey];

  return (
    <>
      <AdminManagementPage
        title={t('adminSettings.pageTitle')}
        description={t('adminSettings.tabAccessControlDesc')}
        actions={headerActions}
        headerNavigation={settingsHeaderNavigation}
        contentClassName="min-h-0 overflow-hidden"
      >
        <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 md:grid-rows-[auto_minmax(0,1fr)]">
          {mobileSettingsPicker}
          <div className="hidden min-w-0 md:block">{secondarySettingsNavigation}</div>
          <AdminContentPanel scroll className="h-full overflow-hidden">
            <div ref={scrollContainerRef} className="h-full overflow-y-auto overflow-x-hidden p-4 custom-scrollbar">
              <div key={resolvedActiveTab} className="admin-tab-panel flex flex-col gap-4">
                {activeContentGroup
                  ? [activeContentGroup].map((group) => {
                      const is3DPreview = group.title === 'adminSettings.tab3dPreview';

                      // ── 3D Preview: custom tabbed layout ──
                      if (is3DPreview) {
                        return (
                          <div key={group.title}>
                            <div className="flex items-center justify-between px-4 py-2">
                              <div className="flex gap-1 overflow-x-auto">
                                {PREVIEW_SUBTABS.map((tab) => (
                                  <button
                                    key={tab.key}
                                    onClick={() => setPreviewSubtab(tab.key)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                                      previewSubtab === tab.key
                                        ? 'bg-primary-container/20 text-primary-container'
                                        : 'text-on-surface-variant hover:bg-surface-container-high'
                                    }`}
                                  >
                                    <Icon name={tab.icon} size={14} />
                                    {t(tab.label, { defaultValue: tab.label })}
                                  </button>
                                ))}
                              </div>
                              <button
                                onClick={handleReset3DPreview}
                                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface shrink-0 ml-2"
                              >
                                <Icon name="restart_alt" size={14} />
                                {t('adminSettings.restorePreset')}
                              </button>
                            </div>

                            <div className="divide-y divide-outline-variant/5">
                              {/* Material tab: dropdown + dynamic fields */}
                              {previewSubtab === 'material' ? (
                                <>
                                  <div className="px-4 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-3 lg:gap-6 lg:items-center">
                                    <div className="min-w-0 max-w-2xl">
                                      <p className="text-sm font-medium text-on-surface">
                                        {t('adminSettings.choosePreset')}
                                      </p>
                                      <p className="text-xs text-on-surface-variant mt-0.5">
                                        {t('adminSettings.choosePresetDesc')}
                                      </p>
                                    </div>
                                    <SelectMenu
                                      variant="field"
                                      className="lg:max-w-sm"
                                      ariaLabel={t('adminSettings.materialPreset')}
                                      value={matPresetEdit}
                                      onChange={(value) => setMatPresetEdit(value as MaterialPresetKey)}
                                      options={MAT_PRESET_OPTIONS.map((opt) => ({
                                        value: opt.value,
                                        label: t(opt.label, { defaultValue: opt.label }),
                                      }))}
                                    />
                                  </div>
                                  {MAT_PRESET_FIELDS[matPresetEdit].map((field) => {
                                    const val = settings[field.key];
                                    const isEmpty = val === '' || val === undefined;
                                    return (
                                      <div
                                        key={field.key}
                                        className="px-4 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-3 lg:gap-6 lg:items-center hover:bg-surface-container-high/30 transition-colors"
                                      >
                                        <div className="min-w-0 max-w-2xl">
                                          <p className="text-sm font-medium text-on-surface">
                                            {t(field.label, { defaultValue: field.label })}
                                            {field.canEmpty && !isEmpty && (
                                              <button
                                                onClick={() => updateSetting(field.key, '')}
                                                className="ml-2 text-[10px] text-error hover:underline"
                                              >
                                                {t('adminSettings.reset')}
                                              </button>
                                            )}
                                          </p>
                                          <p className="text-xs text-on-surface-variant mt-0.5">{field.desc}</p>
                                        </div>
                                        {field.type === 'color' ? (
                                          <div className="flex items-center gap-2 w-full lg:max-w-sm lg:justify-self-start">
                                            {!isEmpty && (
                                              <span
                                                className="w-6 h-6 rounded-md border border-outline-variant/30 shrink-0"
                                                style={{ backgroundColor: val as string }}
                                              />
                                            )}
                                            <input
                                              name="text"
                                              type="text"
                                              value={(val as string) || ''}
                                              onChange={(e) => updateSetting(field.key, e.target.value)}
                                              placeholder={
                                                field.canEmpty ? t('adminSettings.edgeColorEmptyOriginal') : '#FF6600'
                                              }
                                              className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 font-mono"
                                            />
                                            <input
                                              name="color"
                                              type="color"
                                              value={(val as string) || '#000000'}
                                              onChange={(e) => updateSetting(field.key, e.target.value)}
                                              className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                                            />
                                          </div>
                                        ) : field.canEmpty ? (
                                          <div className="space-y-2 w-full lg:max-w-sm">
                                            <div className="flex items-center gap-2">
                                              <Switch
                                                checked={!isEmpty}
                                                onChange={(on) => {
                                                  if (on) {
                                                    updateSetting(field.key, field.min ?? 0);
                                                  } else {
                                                    updateSetting(field.key, '');
                                                  }
                                                }}
                                              />
                                              <span className="text-xs text-on-surface-variant">
                                                {isEmpty
                                                  ? t('adminSettings.matOriginal')
                                                  : t('adminSettings.customOverride')}
                                              </span>
                                            </div>
                                            {!isEmpty && (
                                              <div className="flex items-center gap-3">
                                                <input
                                                  name="number"
                                                  type="range"
                                                  min={field.min ?? 0}
                                                  max={field.max ?? 1}
                                                  step={field.step ?? 0.01}
                                                  value={Number(val) || (field.min ?? 0)}
                                                  onChange={(e) => updateSetting(field.key, parseFloat(e.target.value))}
                                                  className="w-full accent-[var(--color-primary-container)]"
                                                />
                                                <span className="text-xs font-mono text-on-surface w-10 text-right">
                                                  {(Number(val) || 0).toFixed(
                                                    field.step && field.step < 0.1
                                                      ? 2
                                                      : field.step && field.step < 1
                                                        ? 1
                                                        : 0,
                                                  )}
                                                </span>
                                              </div>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-3 w-full lg:max-w-sm lg:justify-self-start">
                                            <input
                                              name="number"
                                              type="range"
                                              min={field.min ?? 0}
                                              max={field.max ?? 1}
                                              step={field.step ?? 0.01}
                                              value={Number(val) || 0}
                                              onChange={(e) => updateSetting(field.key, parseFloat(e.target.value))}
                                              className="w-full accent-[var(--color-primary-container)]"
                                            />
                                            <span className="text-xs font-mono text-on-surface w-10 text-right">
                                              {(Number(val) || 0).toFixed(
                                                field.step && field.step < 0.1
                                                  ? 2
                                                  : field.step && field.step < 1
                                                    ? 1
                                                    : 0,
                                              )}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </>
                              ) : (
                                /* Non-material tabs: standard rendering */
                                PREVIEW_TAB_ITEMS[previewSubtab as Exclude<PreviewSubtab, 'material'>].map(
                                  (item, itemIndex) => {
                                    const structuredEditor =
                                      isSystemSettingKey(item.key) && STRUCTURED_SETTING_KEYS.has(item.key) ? (
                                        <StructuredSettingEditor
                                          itemKey={item.key}
                                          settings={settings}
                                          updateSetting={updateSetting}
                                          emailTemplateKey={resolvedTestEmailTemplateKey}
                                          onEmailTemplateKeyChange={setTestEmailTemplateKey}
                                        />
                                      ) : null;
                                    const isWideControl =
                                      Boolean(structuredEditor) ||
                                      item.key === 'interface_theme' ||
                                      item.type === 'textarea';
                                    const rowClass =
                                      item.type === 'color-scheme'
                                        ? 'px-4 sm:px-6 py-4 flex flex-col gap-4'
                                        : isWideControl
                                          ? 'px-4 sm:px-6 py-4 flex flex-col gap-3'
                                          : 'px-4 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-3 lg:gap-6 lg:items-center';
                                    const loginDialogDisabled =
                                      item.key.startsWith('login_dialog_') &&
                                      item.key !== 'login_dialog_enabled' &&
                                      !settings.login_dialog_enabled;
                                    return (
                                      <div
                                        key={`preview-${item.key}-${itemIndex}`}
                                        className={`${rowClass} ${loginDialogDisabled ? 'opacity-40 pointer-events-none' : 'hover:bg-surface-container-high/30'} transition-colors`}
                                      >
                                        {item.key === 'interface_theme' ? (
                                          <InterfaceThemePicker
                                            value={settings.interface_theme}
                                            onChange={(nextTheme) => updateSetting('interface_theme', nextTheme)}
                                          />
                                        ) : item.type === 'color-scheme' ? (
                                          <ColorSchemeEditor settings={settings} updateSetting={updateSetting} />
                                        ) : (
                                          <>
                                            <div className="min-w-0 max-w-2xl">
                                              <p className="text-sm font-medium text-on-surface">
                                                {item.label === '__preset_checkboxes__'
                                                  ? t('adminSettings.visiblePresets')
                                                  : t(item.label, { defaultValue: item.label })}
                                              </p>
                                              <p className="text-xs text-on-surface-variant mt-0.5">
                                                {item.label === '__preset_checkboxes__'
                                                  ? t('adminSettings.visiblePresetsDesc')
                                                  : item.desc}
                                              </p>
                                            </div>
                                            {item.key === 'viewer_visible_presets' ? (
                                              <div className="flex flex-wrap gap-2">
                                                {MAT_PRESET_OPTIONS.map((opt) => {
                                                  const current = String(settings.viewer_visible_presets ?? '');
                                                  const selected =
                                                    current.trim() === ''
                                                      ? MAT_PRESET_OPTIONS.map((o) => o.value)
                                                      : current
                                                          .split(',')
                                                          .map((s) => s.trim())
                                                          .filter(Boolean);
                                                  const enabled = selected.includes(opt.value);
                                                  return (
                                                    <button
                                                      key={opt.value}
                                                      onClick={() => {
                                                        let next: string[];
                                                        if (enabled && selected.length <= 1) return;
                                                        if (enabled) {
                                                          next = selected.filter((k) => k !== opt.value);
                                                        } else {
                                                          next = [...selected, opt.value];
                                                        }
                                                        updateSetting('viewer_visible_presets', next.join(','));
                                                      }}
                                                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                                        enabled
                                                          ? 'bg-primary-container/20 text-primary-container border-primary-container/30'
                                                          : 'bg-surface-container-highest/20 text-on-surface-variant/50 border-outline-variant/10'
                                                      }`}
                                                    >
                                                      <Icon name={enabled ? 'check_circle' : 'circle'} size={14} />
                                                      {t(opt.label, { defaultValue: opt.label })}
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            ) : item.key === 'ui_enabled_locales' ? (
                                              <div className="flex flex-wrap gap-2">
                                                {UI_LOCALE_OPTIONS.map((opt) => {
                                                  const current = String(settings.ui_enabled_locales ?? '');
                                                  const selected =
                                                    current.trim() === ''
                                                      ? UI_LOCALE_OPTIONS.map((o) => o.value)
                                                      : current
                                                          .split(',')
                                                          .map((s) => s.trim())
                                                          .filter(Boolean);
                                                  const enabled = selected.includes(opt.value);
                                                  return (
                                                    <button
                                                      key={opt.value}
                                                      onClick={() => {
                                                        if (enabled && selected.length <= 1) return;
                                                        const next = enabled
                                                          ? selected.filter((k) => k !== opt.value)
                                                          : [...selected, opt.value];
                                                        updateSetting('ui_enabled_locales', next.join(','));
                                                      }}
                                                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                                        enabled
                                                          ? 'bg-primary-container/20 text-primary-container border-primary-container/30'
                                                          : 'bg-surface-container-highest/20 text-on-surface-variant/50 border-outline-variant/10'
                                                      }`}
                                                    >
                                                      <Icon name={enabled ? 'check_circle' : 'circle'} size={14} />
                                                      {t(opt.label, { defaultValue: opt.label })}
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            ) : item.key === 'product_wall_upload_roles' ? (
                                              <ProductWallUploadRolesEditor
                                                value={String(settings.product_wall_upload_roles ?? '')}
                                                onChange={(next) => updateSetting('product_wall_upload_roles', next)}
                                              />
                                            ) : item.key === 'product_wall_upload_allowed_user_ids' ? (
                                              <ProductWallUploadUsersEditor
                                                value={String(settings.product_wall_upload_allowed_user_ids ?? '')}
                                                onChange={(next) =>
                                                  updateSetting('product_wall_upload_allowed_user_ids', next)
                                                }
                                              />
                                            ) : (
                                              structuredEditor ||
                                              (isReadonlySettingItem(item) ? (
                                                <ReadonlySettingValue item={item} value={settings[item.key]} />
                                              ) : item.type === 'switch' ? (
                                                <Switch
                                                  checked={settings[item.key] as boolean}
                                                  onChange={(v) => updateSetting(item.key, v)}
                                                  disabled={
                                                    loginDialogDisabled ||
                                                    (item.dependsOn ? settings[item.dependsOn] !== true : false)
                                                  }
                                                />
                                              ) : item.type === 'image' ? (
                                                <div className="flex flex-wrap items-center gap-3 min-w-0 lg:justify-self-start">
                                                  {settings[item.key] && (
                                                    <SafeImage
                                                      src={settings[item.key] as string}
                                                      alt={t('adminSettings.preview')}
                                                      className={`${['site_icon', 'site_favicon', 'site_app_icon'].includes(String(item.key)) ? 'h-12 w-12' : 'h-12 w-32'} object-contain bg-surface-container-lowest rounded border border-outline-variant/20`}
                                                      fallbackIcon="image"
                                                    />
                                                  )}
                                                  <div className="flex items-center gap-2">
                                                    <input
                                                      name="text"
                                                      ref={(el) => {
                                                        imageInputRefs.current[item.key] = el;
                                                      }}
                                                      type="file"
                                                      accept="image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico"
                                                      onChange={(e) => handleImageUpload(item.key, e)}
                                                      className="hidden"
                                                    />
                                                    <button
                                                      onClick={() => imageInputRefs.current[item.key]?.click()}
                                                      disabled={uploadingKey !== null}
                                                      className="px-3 py-1.5 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 disabled:opacity-50 transition-colors"
                                                    >
                                                      {uploadingKey === item.key
                                                        ? t('adminSettings.uploading')
                                                        : settings[item.key]
                                                          ? t('adminSettings.changeImage')
                                                          : t('adminSettings.uploadImage')}
                                                    </button>
                                                    {settings[item.key] && (
                                                      <button
                                                        onClick={() => {
                                                          updateSetting(item.key, '');
                                                        }}
                                                        className="px-2 py-1.5 text-xs text-error hover:bg-error-container/10 rounded-md transition-colors"
                                                      >
                                                        {t('adminSettings.removeItem')}
                                                      </button>
                                                    )}
                                                  </div>
                                                </div>
                                              ) : item.type === 'number' ? (
                                                <div className="flex items-center gap-2 min-w-0 lg:justify-self-start">
                                                  <input
                                                    name="settings"
                                                    type="number"
                                                    min={item.min ?? 0}
                                                    max={item.max}
                                                    value={settings[item.key] as number}
                                                    onChange={(e) => {
                                                      const raw = parseFloat(e.target.value) || 0;
                                                      const min = item.min ?? 0;
                                                      const max = item.max ?? Number.MAX_SAFE_INTEGER;
                                                      updateSetting(item.key, Math.min(max, Math.max(min, raw)));
                                                    }}
                                                    className="w-28 bg-surface-container-lowest text-on-surface text-sm text-center rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                                                  />
                                                  {numberSettingUnit(item.key) && (
                                                    <span className="text-xs text-on-surface-variant">
                                                      {numberSettingUnit(item.key)}
                                                    </span>
                                                  )}
                                                </div>
                                              ) : item.type === 'range' ? (
                                                <div className="flex items-center gap-3 w-full lg:max-w-sm lg:justify-self-start">
                                                  <input
                                                    name="number"
                                                    type="range"
                                                    min={item.min ?? 0}
                                                    max={item.max ?? 1}
                                                    step={item.step ?? 0.01}
                                                    value={Number(settings[item.key]) || 0}
                                                    onChange={(e) =>
                                                      updateSetting(item.key, parseFloat(e.target.value))
                                                    }
                                                    className="w-full accent-[var(--color-primary-container)]"
                                                  />
                                                  <span className="text-xs font-mono text-on-surface w-10 text-right">
                                                    {(Number(settings[item.key]) || 0).toFixed(
                                                      item.step && item.step < 0.1
                                                        ? 2
                                                        : item.step && item.step < 1
                                                          ? 1
                                                          : 0,
                                                    )}
                                                  </span>
                                                </div>
                                              ) : item.type === 'textarea' ? (
                                                <div className="w-full">
                                                  <textarea
                                                    name="settings"
                                                    value={settings[item.key] as string}
                                                    onChange={(e) => updateSetting(item.key, e.target.value)}
                                                    placeholder={t(item.desc, { defaultValue: item.desc })}
                                                    rows={3}
                                                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 resize-y font-mono"
                                                  />
                                                </div>
                                              ) : item.type === 'select' ? (
                                                <SelectMenu
                                                  variant="field"
                                                  className="lg:max-w-sm"
                                                  ariaLabel={t(item.label, { defaultValue: item.label })}
                                                  value={(settings[item.key] as string) ?? ''}
                                                  onChange={(value) => updateSetting(item.key, value)}
                                                  options={(item.options ?? []).map((opt) => ({
                                                    value: opt.value,
                                                    label: t(opt.label, { defaultValue: opt.label }),
                                                  }))}
                                                />
                                              ) : item.type === 'color' ? (
                                                <div className="flex items-center gap-2 w-full lg:max-w-sm lg:justify-self-start">
                                                  {settings[item.key] && (
                                                    <span
                                                      className="w-6 h-6 rounded-md border border-outline-variant/30 shrink-0"
                                                      style={{ backgroundColor: settings[item.key] as string }}
                                                    />
                                                  )}
                                                  <input
                                                    name="settings"
                                                    type="text"
                                                    value={settings[item.key] as string}
                                                    onChange={(e) => updateSetting(item.key, e.target.value)}
                                                    placeholder="#FF6600"
                                                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 font-mono"
                                                  />
                                                  <input
                                                    name="color"
                                                    type="color"
                                                    value={(settings[item.key] as string) || '#000000'}
                                                    onChange={(e) => updateSetting(item.key, e.target.value)}
                                                    className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                                                  />
                                                </div>
                                              ) : (
                                                <input
                                                  name="settings"
                                                  type={
                                                    item.key === 'contact_phone'
                                                      ? 'tel'
                                                      : isSensitiveTextSettingKey(item.key)
                                                        ? 'password'
                                                        : 'text'
                                                  }
                                                  inputMode={item.key === 'contact_phone' ? 'tel' : undefined}
                                                  maxLength={item.key === 'contact_phone' ? 32 : undefined}
                                                  value={settings[item.key] as string}
                                                  onChange={(e) => updateSetting(item.key, e.target.value)}
                                                  placeholder={t(item.desc, { defaultValue: item.desc })}
                                                  className="w-full lg:max-w-md bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30"
                                                />
                                              ))
                                            )}
                                          </>
                                        )}
                                      </div>
                                    );
                                  },
                                )
                              )}
                            </div>
                          </div>
                        );
                      }

                      // ── Standard group rendering ──
                      return (
                        <div key={group.title}>
                          <div className="divide-y divide-outline-variant/5">
                            {group.items.map((item, itemIndex) => {
                              if (isSection(item)) {
                                return (
                                  <div key={`section-${itemIndex}`} className="px-4 sm:px-6 pt-5 pb-1">
                                    <p className="text-xs font-bold uppercase tracking-wider text-primary/70">
                                      {t(item._section, { defaultValue: item._section })}
                                    </p>
                                    <div className="mt-1 h-px bg-outline-variant/10" />
                                  </div>
                                );
                              }
                              const structuredEditor =
                                isSystemSettingKey(item.key) && STRUCTURED_SETTING_KEYS.has(item.key) ? (
                                  <StructuredSettingEditor
                                    itemKey={item.key}
                                    settings={settings}
                                    updateSetting={updateSetting}
                                    emailTemplateKey={resolvedTestEmailTemplateKey}
                                    onEmailTemplateKeyChange={setTestEmailTemplateKey}
                                  />
                                ) : null;
                              const isWideControl =
                                Boolean(structuredEditor) ||
                                item.key === 'interface_theme' ||
                                item.type === 'textarea' ||
                                item.type === 'email-test' ||
                                item.type === 'cache-test' ||
                                item.type === 'storage-test' ||
                                item.type === 'storage-policy-info' ||
                                item.type === 'storage-sync';
                              const rowClass =
                                item.type === 'color-scheme'
                                  ? 'px-4 sm:px-6 py-4 flex flex-col gap-4'
                                  : isWideControl
                                    ? 'px-4 sm:px-6 py-4 flex flex-col gap-3'
                                    : 'px-4 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-3 lg:gap-6 lg:items-center';
                              const loginDialogDisabled =
                                item.key.startsWith('login_dialog_') &&
                                item.key !== 'login_dialog_enabled' &&
                                !settings.login_dialog_enabled;
                              const generatedCopyrightValue =
                                item.key === 'footer_copyright' && settings.footer_copyright_follow_site_title
                                  ? resolveFooterCopyright(settings)
                                  : item.key === 'model_detail_copyright' &&
                                      settings.model_detail_copyright_follow_site_title
                                    ? resolveModelDetailCopyright(settings)
                                    : '';
                              const copyrightInputLocked = Boolean(generatedCopyrightValue);
                              return (
                                <div
                                  key={`${group.title}-${item.key}-${itemIndex}`}
                                  className={`${rowClass} ${loginDialogDisabled ? 'opacity-40 pointer-events-none' : 'hover:bg-surface-container-high/30'} transition-colors`}
                                >
                                  {item.key === 'interface_theme' ? (
                                    <InterfaceThemePicker
                                      value={settings.interface_theme}
                                      onChange={(nextTheme) => updateSetting('interface_theme', nextTheme)}
                                    />
                                  ) : item.type === 'color-scheme' ? (
                                    <ColorSchemeEditor settings={settings} updateSetting={updateSetting} />
                                  ) : (
                                    <>
                                      <div className="min-w-0 max-w-2xl">
                                        <p className="text-sm font-medium text-on-surface">
                                          {t(item.label, { defaultValue: item.label })}
                                        </p>
                                        <p className="text-xs text-on-surface-variant mt-0.5">
                                          {t(item.desc, { defaultValue: item.desc })}
                                        </p>
                                      </div>
                                      {item.key === 'ui_enabled_locales' ? (
                                        <div className="flex flex-wrap gap-2">
                                          {UI_LOCALE_OPTIONS.map((opt) => {
                                            const current = String(settings.ui_enabled_locales ?? '');
                                            const selected =
                                              current.trim() === ''
                                                ? UI_LOCALE_OPTIONS.map((o) => o.value)
                                                : current
                                                    .split(',')
                                                    .map((s) => s.trim())
                                                    .filter(Boolean);
                                            const enabled = selected.includes(opt.value);
                                            return (
                                              <button
                                                key={opt.value}
                                                onClick={() => {
                                                  if (enabled && selected.length <= 1) return;
                                                  const next = enabled
                                                    ? selected.filter((k) => k !== opt.value)
                                                    : [...selected, opt.value];
                                                  updateSetting('ui_enabled_locales', next.join(','));
                                                }}
                                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                                  enabled
                                                    ? 'bg-primary-container/20 text-primary-container border-primary-container/30'
                                                    : 'bg-surface-container-highest/20 text-on-surface-variant/50 border-outline-variant/10'
                                                }`}
                                              >
                                                <Icon name={enabled ? 'check_circle' : 'circle'} size={14} />
                                                {t(opt.label, { defaultValue: opt.label })}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      ) : item.key === 'product_wall_upload_roles' ? (
                                        <ProductWallUploadRolesEditor
                                          value={String(settings.product_wall_upload_roles ?? '')}
                                          onChange={(next) => updateSetting('product_wall_upload_roles', next)}
                                        />
                                      ) : item.key === 'product_wall_upload_allowed_user_ids' ? (
                                        <ProductWallUploadUsersEditor
                                          value={String(settings.product_wall_upload_allowed_user_ids ?? '')}
                                          onChange={(next) =>
                                            updateSetting('product_wall_upload_allowed_user_ids', next)
                                          }
                                        />
                                      ) : (
                                        structuredEditor ||
                                        (item.type === 'email-test' ? (
                                          <EmailTestPanel
                                            value={testEmailTo}
                                            onChange={setTestEmailTo}
                                            onSend={handleSendTestEmail}
                                            testing={testingEmail}
                                            changed={changed}
                                            saving={saving}
                                            settings={settings}
                                            templateLabel={
                                              (resolvedTestEmailTemplate
                                                ? t(resolvedTestEmailTemplate.label, {
                                                    defaultValue: resolvedTestEmailTemplate.label,
                                                  })
                                                : '') || resolvedTestEmailTemplateKey
                                            }
                                            templateKey={resolvedTestEmailTemplateKey}
                                          />
                                        ) : item.type === 'cache-test' ? (
                                          <SettingsConnectivityTestPanel
                                            icon="memory"
                                            title={t('adminSettings.runRedisTest')}
                                            summary={t('adminSettings.cacheTestDesc')}
                                            buttonLabel={t('adminSettings.testRedis')}
                                            testingLabel={t('adminSettings.testing')}
                                            testing={testingCache}
                                            changed={changed}
                                            saving={saving}
                                            result={cacheTestResult}
                                            onRun={handleTestCacheSettings}
                                          />
                                        ) : item.type === 'storage-test' ? (
                                          <SettingsConnectivityTestPanel
                                            icon="storage"
                                            title={t('adminSettings.runStorageTest')}
                                            summary={t('adminSettings.storageTestDesc')}
                                            buttonLabel={t('adminSettings.testStorage')}
                                            testingLabel={t('adminSettings.testing')}
                                            testing={testingStorage}
                                            changed={changed}
                                            saving={saving}
                                            result={storageTestResult}
                                            onRun={handleTestStorageSettings}
                                          />
                                        ) : item.type === 'storage-policy-info' ? (
                                          <StoragePolicyInfoPanel settings={settings} />
                                        ) : item.type === 'storage-sync' ? (
                                          <StorageSyncPanel settings={settings} />
                                        ) : isReadonlySettingItem(item) ? (
                                          <ReadonlySettingValue item={item} value={settings[item.key]} />
                                        ) : item.type === 'switch' ? (
                                          <Switch
                                            checked={settings[item.key] as boolean}
                                            onChange={(v) => updateSetting(item.key, v)}
                                            disabled={loginDialogDisabled}
                                          />
                                        ) : item.type === 'image' ? (
                                          <div className="flex flex-wrap items-center gap-3 min-w-0 lg:justify-self-start">
                                            {settings[item.key] && (
                                              <SafeImage
                                                src={settings[item.key] as string}
                                                alt={t('adminSettings.preview')}
                                                className={`${['site_icon', 'site_favicon', 'site_app_icon'].includes(String(item.key)) ? 'h-12 w-12' : 'h-12 w-32'} object-contain bg-surface-container-lowest rounded border border-outline-variant/20`}
                                                fallbackIcon="image"
                                              />
                                            )}
                                            <div className="flex items-center gap-2">
                                              <input
                                                name="text"
                                                ref={(el) => {
                                                  imageInputRefs.current[item.key] = el;
                                                }}
                                                type="file"
                                                accept="image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico"
                                                onChange={(e) => handleImageUpload(item.key, e)}
                                                className="hidden"
                                              />
                                              <button
                                                onClick={() => imageInputRefs.current[item.key]?.click()}
                                                disabled={uploadingKey !== null}
                                                className="px-3 py-1.5 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 disabled:opacity-50 transition-colors"
                                              >
                                                {uploadingKey === item.key
                                                  ? t('adminSettings.uploading')
                                                  : settings[item.key]
                                                    ? t('adminSettings.changeImage')
                                                    : t('adminSettings.uploadImage')}
                                              </button>
                                              {settings[item.key] && (
                                                <button
                                                  onClick={() => {
                                                    updateSetting(item.key, '');
                                                  }}
                                                  className="px-2 py-1.5 text-xs text-error hover:bg-error-container/10 rounded-md transition-colors"
                                                >
                                                  {t('adminSettings.removeItem')}
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        ) : item.type === 'number' ? (
                                          <div className="flex items-center gap-2 min-w-0 lg:justify-self-start">
                                            <input
                                              name="settings"
                                              type="number"
                                              min={item.min ?? 0}
                                              max={item.max}
                                              value={settings[item.key] as number}
                                              onChange={(e) => {
                                                const raw = parseFloat(e.target.value) || 0;
                                                const min = item.min ?? 0;
                                                const max = item.max ?? Number.MAX_SAFE_INTEGER;
                                                updateSetting(item.key, Math.min(max, Math.max(min, raw)));
                                              }}
                                              className="w-28 bg-surface-container-lowest text-on-surface text-sm text-center rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                                            />
                                            {numberSettingUnit(item.key) && (
                                              <span className="text-xs text-on-surface-variant">
                                                {numberSettingUnit(item.key)}
                                              </span>
                                            )}
                                          </div>
                                        ) : item.type === 'range' ? (
                                          <div className="flex items-center gap-3 w-full lg:max-w-sm lg:justify-self-start">
                                            <input
                                              name="number"
                                              type="range"
                                              min={item.min ?? 0}
                                              max={item.max ?? 1}
                                              step={item.step ?? 0.01}
                                              value={Number(settings[item.key]) || 0}
                                              onChange={(e) => updateSetting(item.key, parseFloat(e.target.value))}
                                              className="w-full accent-[var(--color-primary-container)]"
                                            />
                                            <span className="text-xs font-mono text-on-surface w-10 text-right">
                                              {(Number(settings[item.key]) || 0).toFixed(
                                                item.step && item.step < 0.1 ? 2 : item.step && item.step < 1 ? 1 : 0,
                                              )}
                                            </span>
                                          </div>
                                        ) : item.type === 'textarea' ? (
                                          <div className="w-full">
                                            <textarea
                                              name="settings"
                                              value={settings[item.key] as string}
                                              onChange={(e) => updateSetting(item.key, e.target.value)}
                                              placeholder={t(item.desc, { defaultValue: item.desc })}
                                              rows={3}
                                              className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 resize-y font-mono"
                                            />
                                            {item.key === 'allowed_hosts' && typeof window !== 'undefined' && (
                                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                                <span className="text-xs text-on-surface-variant">
                                                  {t('adminSettings.currentAccessDomain')}
                                                </span>
                                                <code className="text-xs font-mono text-primary-container bg-primary-container/10 px-2 py-0.5 rounded break-all">
                                                  {window.location.host}
                                                </code>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const current = ((settings.allowed_hosts as string) || '').trim();
                                                    const host = window.location.host;
                                                    const updated = current ? `${current}, ${host}` : host;
                                                    updateSetting('allowed_hosts', updated);
                                                  }}
                                                  className="text-xs text-primary-container hover:underline"
                                                >
                                                  {t('adminSettings.authorizeDomain')}
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        ) : item.type === 'select' ? (
                                          <SelectMenu
                                            variant="field"
                                            className="lg:max-w-sm"
                                            ariaLabel={t(item.label, { defaultValue: item.label })}
                                            value={(settings[item.key] as string) ?? ''}
                                            onChange={(value) => updateSetting(item.key, value)}
                                            options={(item.options ?? []).map((opt) => ({
                                              value: opt.value,
                                              label: t(opt.label, { defaultValue: opt.label }),
                                            }))}
                                          />
                                        ) : item.type === 'color' ? (
                                          <div className="flex items-center gap-2 w-full lg:max-w-sm lg:justify-self-start">
                                            {settings[item.key] && (
                                              <span
                                                className="w-6 h-6 rounded-md border border-outline-variant/30 shrink-0"
                                                style={{ backgroundColor: settings[item.key] as string }}
                                              />
                                            )}
                                            <input
                                              name="settings"
                                              type="text"
                                              value={settings[item.key] as string}
                                              onChange={(e) => updateSetting(item.key, e.target.value)}
                                              placeholder="#FF6600"
                                              className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 font-mono"
                                            />
                                            <input
                                              name="color"
                                              type="color"
                                              value={(settings[item.key] as string) || '#000000'}
                                              onChange={(e) => updateSetting(item.key, e.target.value)}
                                              className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                                            />
                                          </div>
                                        ) : (
                                          <input
                                            name="copyright-input-locked"
                                            type={
                                              item.key === 'contact_phone'
                                                ? 'tel'
                                                : isSensitiveTextSettingKey(item.key)
                                                  ? 'password'
                                                  : 'text'
                                            }
                                            inputMode={item.key === 'contact_phone' ? 'tel' : undefined}
                                            maxLength={item.key === 'contact_phone' ? 32 : undefined}
                                            value={
                                              copyrightInputLocked
                                                ? generatedCopyrightValue
                                                : (settings[item.key] as string)
                                            }
                                            onChange={(e) => {
                                              if (!copyrightInputLocked) updateSetting(item.key, e.target.value);
                                            }}
                                            placeholder={t(item.desc, { defaultValue: item.desc })}
                                            disabled={copyrightInputLocked}
                                            className={`w-full lg:max-w-md bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 ${
                                              copyrightInputLocked
                                                ? 'cursor-not-allowed text-on-surface-variant/70 border-outline-variant/10 bg-surface-container-high/40'
                                                : ''
                                            }`}
                                          />
                                        ))
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  : null}

                {activeTab === 'adminSettings.tabBackup' && (
                  <>
                    {/* Data Backup Section */}
                    <div
                      id="backup"
                      className="scroll-mt-24 bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden"
                    >
                      {/* 硬中断恢复告警：恢复任务在破坏性阶段被断电/OOM/容器重启打断时，
                          数据库可能处于不完整状态，且恢复前快照已持久化——提供一键回滚入口 */}
                      {interruptedRestores.length > 0 && (
                        <div className="mx-4 mt-4 sm:mx-6 rounded-lg border border-error/40 bg-error-container/10 p-4 space-y-3">
                          <div className="flex items-start gap-2">
                            <Icon name="warning" size={18} className="text-error mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-error">
                                {t('adminSettings.interruptedRestoreTitle')}
                              </p>
                              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                                {t('adminSettings.interruptedRestoreBody')}
                              </p>
                            </div>
                          </div>
                          {interruptedRestores.map((info) => (
                            <div
                              key={info.jobId + info.durableSnapshot}
                              className="rounded-md border border-outline-variant/30 bg-surface/60 p-3 space-y-2"
                            >
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                                <span>
                                  {t('adminSettings.interruptedJob')} <span className="font-mono">{info.jobId}</span>
                                </span>
                                {info.startedAt && (
                                  <span>
                                    {t('adminSettings.startedAtTime', {
                                      time: new Date(info.startedAt).toLocaleString(),
                                    })}
                                  </span>
                                )}
                              </div>
                              {info.durableSnapshot ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleRecoverInterrupted(info)}
                                    disabled={Boolean(recoveringSnapshot)}
                                    className="px-3 py-1.5 text-xs font-bold bg-error text-white rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1"
                                  >
                                    <Icon name="restore" size={13} />
                                    {recoveringSnapshot === info.durableSnapshot
                                      ? t('adminSettings.rollbackInProgress')
                                      : t('adminSettings.rollbackOneClick')}
                                  </button>
                                  <span className="text-xs text-on-surface-variant">
                                    {t('adminSettings.rollbackScopeDesc')}
                                  </span>
                                </div>
                              ) : (
                                <p className="text-xs text-on-surface-variant leading-relaxed">
                                  {t('adminSettings.dbOkFilesInterrupted')}
                                  {t('adminSettings.dbOkFilesAdvice')}
                                </p>
                              )}
                              {(info.leftoverRestoreBackupDirs?.length ?? 0) > 0 && (
                                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-outline-variant/20">
                                  <span className="text-xs text-on-surface-variant">
                                    {t('adminSettings.leftoverDirsCount', {
                                      count: info.leftoverRestoreBackupDirs!.length,
                                    })}
                                    {t('adminSettings.leftoverDirsCleanHint')}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={handleClearLeftoverDirs}
                                    disabled={leftoverCleanupBusy}
                                    className="px-2.5 py-1 text-[11px] font-medium text-error border border-error/40 rounded-md hover:bg-error/10 disabled:opacity-50 transition-colors"
                                  >
                                    {leftoverCleanupBusy
                                      ? t('adminSettings.cleaningEllipsis')
                                      : t('adminSettings.cleanupResidualDirs')}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="divide-y divide-outline-variant/5">
                        {/* 备份保障 + 创建备份（融合区块） */}
                        <div className="px-4 py-4 sm:px-6">
                          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <p className="text-sm font-medium text-on-surface">
                                {t('adminSettings.backupAndProtection')}
                              </p>
                              <p className="text-xs text-on-surface-variant mt-0.5">
                                {t('adminSettings.backupScopeHint')}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {backupStats?.totalDataSizeText && (
                                <span className="text-xs text-on-surface-variant">
                                  {t('adminSettings.fullSiteAbout', { size: backupStats.totalDataSizeText })}
                                </span>
                              )}
                              {backupHealth && (
                                <button
                                  onClick={() => setPolicyCheckConfirmOpen(true)}
                                  disabled={checkingBackupPolicy || adminBusy}
                                  className="px-2.5 py-1.5 text-[11px] font-medium text-primary-container hover:bg-primary-container/10 rounded-md disabled:opacity-50 transition-colors flex items-center gap-1"
                                >
                                  <Icon name="fact_check" size={13} />
                                  {checkingBackupPolicy
                                    ? t('adminSettings.healthChecking')
                                    : t('adminSettings.policyCheck')}
                                </button>
                              )}
                            </div>
                          </div>

                          {backupHealth && (
                            <div className="mb-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {backupProtectionCards.map((card) => {
                                  const expanded = protectionDetailKey === card.key;
                                  return (
                                    <button
                                      key={card.key}
                                      type="button"
                                      onClick={() => setProtectionDetailKey(expanded ? null : card.key)}
                                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${getBackupStatusClasses(card.status)} ${
                                        expanded ? 'ring-1 ring-current/30' : 'hover:brightness-95'
                                      }`}
                                      title={card.detail}
                                    >
                                      <Icon name={card.icon} size={13} />
                                      <span>{card.label}</span>
                                      <span className="opacity-70">{card.value}</span>
                                      {card.status !== 'ok' && (
                                        <Icon
                                          name={expanded ? 'expand_less' : 'expand_more'}
                                          size={12}
                                          className="opacity-70"
                                        />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                              {protectionDetailKey && (
                                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-lowest/70 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                                  {(() => {
                                    const card = backupProtectionCards.find((c) => c.key === protectionDetailKey);
                                    if (!card) return null;
                                    return (
                                      <>
                                        <p className="min-w-0 text-xs leading-relaxed text-on-surface-variant">
                                          <span className={`font-medium ${getBackupStatusIconClass(card.status)}`}>
                                            {card.label} · {card.value}
                                          </span>
                                          <span className="mx-1.5 text-on-surface-variant/40">|</span>
                                          {card.detail}
                                        </p>
                                        {card.action && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (card.action?.targetTab === '__scroll_create__') {
                                                setProtectionDetailKey(null);
                                                return;
                                              }
                                              if (card.action?.targetTab) setActiveTab(card.action.targetTab);
                                            }}
                                            className="shrink-0 rounded-md border border-primary/25 bg-primary-container/10 px-2.5 py-1 text-[11px] font-medium text-primary-container transition-colors hover:bg-primary-container/20 flex items-center gap-1"
                                          >
                                            {card.action.text}
                                            <Icon name="chevron_right" size={12} />
                                          </button>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              )}
                              {backupPolicyCheck && (
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
                                  <span
                                    className={`rounded-full border px-2 py-0.5 font-medium ${getBackupStatusClasses(toBackupProtectionStatus(backupPolicyCheck.status))}`}
                                  >
                                    {backupPolicyCheck.status === 'ok'
                                      ? t('adminSettings.healthPassed')
                                      : backupPolicyCheck.status === 'error'
                                        ? t('adminSettings.issueErrorCount', { count: backupPolicyIssueCount })
                                        : t('adminSettings.issueWarningCount', { count: backupPolicyIssueCount })}
                                  </span>
                                  <span>
                                    {t('adminSettings.checkTime', {
                                      time: new Date(backupPolicyCheck.checkedAt).toLocaleString(),
                                    })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setPolicyDetailOpen((open) => !open)}
                                    className="text-primary-container hover:underline flex items-center gap-0.5"
                                  >
                                    {policyDetailOpen
                                      ? t('adminSettings.collapseDetails')
                                      : t('adminSettings.viewDetails')}
                                    <Icon name={policyDetailOpen ? 'expand_less' : 'expand_more'} size={12} />
                                  </button>
                                  {policyDetailOpen && (
                                    <div className="w-full grid gap-1.5 md:grid-cols-2">
                                      {backupPolicyCheck.checks.map((check) => (
                                        <div
                                          key={check.key}
                                          className="flex min-w-0 items-start gap-2 rounded-md border border-outline-variant/10 bg-surface-container-low/50 px-2.5 py-1.5 text-[11px]"
                                        >
                                          <Icon
                                            name={getBackupStatusIcon(toBackupProtectionStatus(check.status))}
                                            size={13}
                                            className={`mt-0.5 shrink-0 ${getBackupStatusIconClass(toBackupProtectionStatus(check.status))}`}
                                          />
                                          <div className="min-w-0">
                                            <p className="font-medium text-on-surface">{check.label}</p>
                                            <p className="mt-0.5 break-all text-on-surface-variant">{check.message}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          <div
                            className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5"
                            role="listbox"
                            aria-label={t('adminSettings.backupScope')}
                          >
                            {BACKUP_SCOPE_OPTIONS.map((option) => {
                              const active = option.value === backupScope;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  role="option"
                                  aria-selected={active}
                                  onClick={() => setBackupScope(option.value)}
                                  disabled={adminBusy}
                                  className={`group flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-colors ${
                                    active
                                      ? 'border-primary/40 bg-primary-container/10'
                                      : 'border-outline-variant/15 bg-surface-container-lowest hover:border-primary/25 hover:bg-surface-container-low'
                                  } disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                  <span className="flex w-full items-center gap-1.5">
                                    <span
                                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                                        active
                                          ? 'bg-primary-container/15 text-primary-container'
                                          : 'bg-surface-container-high text-on-surface-variant'
                                      }`}
                                    >
                                      <Icon name={option.icon} size={14} />
                                    </span>
                                    <span
                                      className={`min-w-0 flex-1 truncate text-xs font-semibold ${
                                        active ? 'text-primary-container' : 'text-on-surface'
                                      }`}
                                    >
                                      {t(option.label, { defaultValue: option.label })}
                                    </span>
                                    {active && (
                                      <Icon name="check" size={13} className="shrink-0 text-primary-container" />
                                    )}
                                  </span>
                                  <span className="line-clamp-2 min-h-[2rem] text-[10px] leading-snug text-on-surface-variant">
                                    {backupScopeCounts[option.value] && (
                                      <span className="mr-1 font-medium text-on-surface/70">
                                        {backupScopeCounts[option.value]}
                                      </span>
                                    )}
                                    {t(option.desc, { defaultValue: option.desc })}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <button
                            onClick={() => setExportConfirmOpen(true)}
                            disabled={adminBusy || exporting}
                            className="mt-2 w-full px-4 py-2.5 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 shrink-0"
                          >
                            <Icon name="add" size={14} />
                            {exporting
                              ? `${exportProgress.percent}%`
                              : t('adminSettings.createScopeBackup', {
                                  scope: t(selectedBackupScope.label, { defaultValue: selectedBackupScope.label }),
                                })}
                          </button>
                          {exporting && <TaskProgressCard progress={exportProgress} />}
                        </div>

                        {/* Backup List */}
                        {backupList.length > 0 && (
                          <div className="px-4 py-4 sm:px-6">
                            <p className="text-sm font-medium text-on-surface mb-3">
                              {t('adminSettings.backupRecords')}
                            </p>
                            <div className="space-y-2">
                              {backupList.map((b) => (
                                <div
                                  key={b.id}
                                  className="bg-surface-container-high/30 rounded-lg border border-outline-variant/10 p-3 sm:p-4"
                                >
                                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                      {renamingId === b.id ? (
                                        <div className="flex flex-col gap-2 mb-2 sm:flex-row sm:items-center">
                                          <input
                                            name="rename-value"
                                            type="text"
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') handleRename(b.id);
                                              if (e.key === 'Escape') {
                                                setRenamingId(null);
                                                setRenameValue('');
                                              }
                                            }}
                                            className="flex-1 bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-1.5 border border-outline-variant/30 outline-none focus:border-primary"
                                            autoFocus
                                          />
                                          <div className="grid grid-cols-2 gap-2 sm:flex">
                                            <button
                                              onClick={() => handleRename(b.id)}
                                              className="px-2 py-1.5 text-xs text-primary-container hover:bg-primary-container/10 rounded-md"
                                            >
                                              {t('common.save')}
                                            </button>
                                            <button
                                              onClick={() => {
                                                setRenamingId(null);
                                                setRenameValue('');
                                              }}
                                              className="px-2 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded-md"
                                            >
                                              {t('common.cancel')}
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-sm font-medium text-on-surface truncate">{b.name}</p>
                                      )}
                                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1.5 text-xs text-on-surface-variant sm:flex sm:flex-wrap sm:gap-x-4">
                                        <span>{new Date(b.createdAt).toLocaleString('zh-CN')}</span>
                                        <span>{getBackupScopeLabel(b.scope, b.scopeLabel)}</span>
                                        <span>{b.fileSizeText}</span>
                                        {b.scope && b.scope !== 'full' ? (
                                          <>
                                            <span>
                                              {t('adminSettings.recordCountShort', {
                                                count: b.itemCount ?? b.modelCount ?? 0,
                                              })}
                                            </span>
                                            <span>
                                              {t('adminSettings.assetFileCount', {
                                                count: b.fileCount ?? b.thumbnailCount ?? 0,
                                              })}
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <span>
                                              {t('adminSettings.stepModelCount', { count: b.modelCount ?? 0 })}
                                            </span>
                                            <span>{t('adminSettings.dbSizeShort', { size: b.dbSize })}</span>
                                          </>
                                        )}
                                        {b.manifestVersion && (
                                          <span>
                                            {t('adminSettings.manifestVersionShort', { version: b.manifestVersion })}
                                          </span>
                                        )}
                                        {b.verifiedAt && <span>{t('adminSettings.verifiedBadge')}</span>}
                                        {b.encrypted && (
                                          <span className="inline-flex items-center gap-0.5 text-green-600">
                                            <Icon name="lock" size={11} />
                                            {t('adminSettings.encryptedBadge')}
                                          </span>
                                        )}
                                      </div>
                                      {b.filePath && (
                                        <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
                                          <span className="shrink-0 text-xs text-on-surface-variant">
                                            {t('adminSettings.pathLabel')}
                                          </span>
                                          <code className="min-w-0 truncate font-mono text-[11px] text-on-surface-variant/80 bg-surface-container-lowest/40 px-1.5 py-0.5 rounded">
                                            {b.filePath}
                                          </code>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              copyText(b.filePath!)
                                                .then(() => toast(t('adminSettings.pathCopied'), 'success'))
                                                .catch(() => toast(t('adminSettings.copyFailed'), 'error'));
                                            }}
                                            title={t('adminSettings.copyPath')}
                                            className="shrink-0 text-on-surface-variant/60 hover:text-on-surface-variant transition-colors"
                                          >
                                            <Icon name="content_copy" size={13} />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:flex lg:flex-wrap lg:items-center lg:gap-1.5 lg:shrink-0">
                                      <button
                                        onClick={() => handleRestoreRequest(b.id)}
                                        disabled={adminBusy}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-primary-container/15 text-primary-container rounded-md hover:bg-primary-container/25 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="restore" size={13} />
                                        {t('adminSettings.restoreAction')}
                                      </button>
                                      <button
                                        onClick={() => handleDownloadBackup(b.id)}
                                        disabled={adminBusy}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="download" size={13} />
                                        {t('common.download')}
                                      </button>
                                      <button
                                        onClick={() => setVerifyConfirmId(b.id)}
                                        disabled={adminBusy || verifyingBackupId === b.id}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="verified" size={13} />
                                        {verifyingBackupId === b.id
                                          ? `${verifyProgress.percent}%`
                                          : t('adminSettings.verify')}
                                      </button>
                                      <button
                                        onClick={() => {
                                          setRenamingId(b.id);
                                          setRenameValue(b.name);
                                        }}
                                        disabled={adminBusy}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="edit" size={13} />
                                        {t('adminSettings.renameAction')}
                                      </button>
                                      <button
                                        onClick={() => setBackupDeleteConfirm({ id: b.id, name: b.name })}
                                        disabled={adminBusy || deletingBackupId === b.id}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-error-container/10 text-error rounded-md hover:bg-error-container/20 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="delete" size={13} />
                                        {deletingBackupId === b.id
                                          ? t('adminSettings.deleting')
                                          : t('adminSettings.remove')}
                                      </button>
                                    </div>
                                  </div>

                                  {verifyingBackupId === b.id && (
                                    <div className="mt-3">
                                      <TaskProgressCard progress={verifyProgress} color="primary" />
                                    </div>
                                  )}

                                  {restoreConfirmId === b.id && (
                                    <div className="mt-3 bg-error-container/10 border border-error/20 rounded-md p-3">
                                      <div className="flex items-start gap-2">
                                        <Icon name="warning" size={18} className="text-error shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                          {!restoring ? (
                                            <>
                                              <p className="text-xs font-medium text-on-surface">
                                                {t('adminSettings.confirmRestoreToBackup')}
                                              </p>
                                              <p className="text-xs text-error/80 mt-1">
                                                {b.scope === 'users'
                                                  ? t('adminSettings.confirmRestoreUsers')
                                                  : b.scope && b.scope !== 'full'
                                                    ? t('adminSettings.confirmScopedRestoreOverwrite', {
                                                        scope: getBackupScopeLabel(b.scope, b.scopeLabel),
                                                      })
                                                    : t('adminSettings.confirmRestoreOverwrite')}
                                              </p>
                                              <label className="flex items-start gap-2 mt-2 cursor-pointer select-none">
                                                <input
                                                  name="restore-force"
                                                  type="checkbox"
                                                  checked={restoreForce}
                                                  onChange={(e) => setRestoreForce(e.target.checked)}
                                                  className="mt-0.5 accent-primary"
                                                />
                                                <span className="text-[11px] leading-tight text-on-surface-variant">
                                                  {t('adminSettings.skipSignatureCheck')}
                                                  <span className="block text-on-surface-variant/70">
                                                    {t('adminSettings.skipSignatureCheckDesc')}
                                                  </span>
                                                </span>
                                              </label>
                                              <div className="grid grid-cols-1 gap-2 mt-2 sm:flex">
                                                <button
                                                  onClick={handleRestoreConfirm}
                                                  className="px-3 py-1 text-xs font-medium bg-error text-on-error-container rounded-md hover:opacity-90 transition-opacity"
                                                >
                                                  {t('adminSettings.confirmRestoreAction')}
                                                </button>
                                                <button
                                                  onClick={() => setRestoreConfirmId(null)}
                                                  className="px-3 py-1 text-xs text-on-surface-variant border border-outline-variant/30 rounded-md hover:bg-surface-container-high/50 transition-colors"
                                                >
                                                  {t('common.cancel')}
                                                </button>
                                              </div>
                                            </>
                                          ) : (
                                            <>
                                              <TaskProgressCard progress={restoreProgress} color="primary" />
                                              {cancelRestoreButton}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Import from file */}
                        <div className="px-4 py-4 sm:px-6">
                          <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                            <div>
                              <p className="text-sm font-medium text-on-surface">{t('adminSettings.importRestore')}</p>
                              <p className="text-xs text-on-surface-variant mt-0.5">
                                {t('adminSettings.importRestoreDesc')}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:flex">
                              <input
                                name="file"
                                ref={backupInputRef}
                                type="file"
                                accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
                                onChange={handleBackupFileSelect}
                                className="hidden"
                              />
                              <button
                                onClick={() => backupInputRef.current?.click()}
                                disabled={adminBusy}
                                className="px-4 py-2.5 sm:py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                              >
                                <Icon name="upload" size={14} />
                                {t('adminSettings.localUpload')}
                              </button>
                              <button
                                onClick={() => {
                                  setServerFileConfirm(null);
                                  handleLoadServerFiles();
                                }}
                                disabled={adminBusy}
                                className="px-4 py-2.5 sm:py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                              >
                                <Icon name="folder" size={14} />
                                {t('adminSettings.serverFile')}
                              </button>
                            </div>
                          </div>

                          {importing && (
                            <div className="mt-3">
                              {/* Phase 1: Upload（独立进度段，切换到服务端阶段后隐藏，避免回跳） */}
                              {!restoreProgress.message && uploadProgress < 100 && (
                                <TaskProgressCard
                                  progress={{ message: t('adminSettings.uploading'), percent: uploadProgress }}
                                />
                              )}
                              {/* Phase 2: Server processing（服务端任务有自己的 0-100 进度） */}
                              {(restoreProgress.message || uploadProgress >= 100) && (
                                <div className="space-y-2">
                                  <TaskProgressCard
                                    progress={{
                                      message: restoreProgress.message || t('adminSettings.uploadDoneProcessing'),
                                      percent: restoreProgress.message ? restoreProgress.percent : 100,
                                      logs: restoreProgress.logs,
                                    }}
                                  />
                                  {cancelRestoreButton}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Server file list */}
                          {loadingServerFiles && (
                            <div className="mt-3 text-xs text-on-surface-variant animate-pulse">
                              {t('adminSettings.scanningServerFiles')}
                            </div>
                          )}
                          {!loadingServerFiles && serverFiles.length > 0 && !importing && (
                            <div className="mt-3 border border-outline-variant/20 rounded-md divide-y divide-outline-variant/10">
                              {serverFiles.map((f) => (
                                <div
                                  key={f.path}
                                  className="flex flex-col gap-2 px-3 py-3 hover:bg-surface-container-high/30 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-on-surface truncate">{f.name}</p>
                                    <p className="text-xs text-on-surface-variant">
                                      {(f.size / 1024 / 1024).toFixed(1)} MB ·{' '}
                                      {new Date(f.modifiedAt).toLocaleString('zh-CN')}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => setServerFileConfirm(f)}
                                    disabled={adminBusy}
                                    className="w-full sm:w-auto sm:ml-2 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/10 disabled:opacity-50 transition-colors shrink-0"
                                  >
                                    {t('adminSettings.restoreAction')}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {!loadingServerFiles && serverFilesScanned && serverFiles.length === 0 && (
                            <div className="mt-3 text-xs text-on-surface-variant">
                              {t('adminSettings.noServerBackupFiles')}
                            </div>
                          )}

                          {/* Server file confirm dialog */}
                          {serverFileConfirm && !importing && (
                            <div className="mt-3 bg-error-container/10 border border-error/20 rounded-md p-4">
                              <div className="flex items-start gap-3">
                                <Icon name="warning" size={20} className="text-error shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-on-surface">
                                    {t('adminSettings.confirmServerFileRestore')}
                                  </p>
                                  <p className="text-xs text-on-surface-variant mt-1">
                                    {t('adminSettings.fileLabelColon')}
                                    {serverFileConfirm.name}（{(serverFileConfirm.size / 1024 / 1024).toFixed(1)} MB）
                                  </p>
                                  <p className="text-xs text-on-surface-variant mt-0.5 break-all">
                                    {t('adminSettings.pathLabelColon')}
                                    {serverFileConfirm.path}
                                  </p>
                                  <div className="mt-3 grid grid-cols-1 gap-2 sm:flex">
                                    <button
                                      onClick={() => handleServerFileImport(serverFileConfirm)}
                                      className="px-4 py-1.5 text-xs font-medium text-on-error bg-error rounded-md hover:bg-error/90 transition-colors"
                                    >
                                      {t('adminSettings.confirmRestoreOverwriteData')}
                                    </button>
                                    <button
                                      onClick={() => setServerFileConfirm(null)}
                                      className="px-4 py-1.5 text-xs text-on-surface-variant border border-outline-variant/30 rounded-md hover:bg-surface-container-high/50 transition-colors"
                                    >
                                      {t('common.cancel')}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {restoreConfirmFile && !importing && (
                            <div className="mt-3 bg-error-container/10 border border-error/20 rounded-md p-4">
                              <div className="flex items-start gap-3">
                                <Icon name="warning" size={20} className="text-error shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-on-surface">
                                    {t('adminSettings.chooseImportMethod')}
                                  </p>
                                  <p className="text-xs text-on-surface-variant mt-1">
                                    {t('adminSettings.fileLabelColon')}
                                    {restoreConfirmFile.name}（{(restoreConfirmFile.size / 1024 / 1024).toFixed(1)} MB）
                                  </p>
                                  <div className="mt-3 space-y-2">
                                    <button
                                      onClick={() => handleImport('restore')}
                                      className="w-full text-left px-3 py-2 bg-error/10 border border-error/20 rounded-md hover:bg-error/15 transition-colors"
                                    >
                                      <p className="text-xs font-medium text-error">
                                        {t('adminSettings.directRestore')}
                                      </p>
                                      <p className="text-xs text-on-surface-variant mt-0.5">
                                        {t('adminSettings.directRestoreDesc')}
                                      </p>
                                    </button>
                                    <button
                                      onClick={() => handleImport('save')}
                                      className="w-full text-left px-3 py-2 bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/15 transition-colors"
                                    >
                                      <p className="text-xs font-medium text-primary">
                                        {t('adminSettings.saveToBackupList')}
                                      </p>
                                      <p className="text-xs text-on-surface-variant mt-0.5">
                                        {t('adminSettings.saveToBackupListDesc')}
                                      </p>
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => setRestoreConfirmFile(null)}
                                    className="mt-2 px-4 py-1 text-xs text-on-surface-variant border border-outline-variant/30 rounded-md hover:bg-surface-container-high/50 transition-colors"
                                  >
                                    {t('common.cancel')}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === 'adminSettings.tabAboutSystem' && (
                  <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
                    <div className="divide-y divide-outline-variant/5">
                      {/* Program intro */}
                      <div className="px-6 py-4">
                        <p className="text-sm font-medium text-on-surface">{t('adminSettings.aboutIntro')}</p>
                        <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
                          3DPartHub{t('adminSettings.aboutIntroBody')}
                        </p>
                        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-on-surface-variant/50">
                          <span>{t('adminSettings.copyright2026')}</span>
                          <a
                            href="http://wpa.qq.com/msgrd?v=3&uin=255955956&site=qq&menu=yes"
                            target="_blank"
                            rel="noopener noreferrer"
                            title="QQ 255955956"
                            aria-label="QQ 255955956"
                            className="inline-flex items-center opacity-70 hover:opacity-100 transition-opacity"
                          >
                            <Icon name="chat" size={12} />
                          </a>
                          <a
                            href="https://github.com/liaoweixiang2024-blip"
                            target="_blank"
                            rel="noopener noreferrer"
                            title="GitHub"
                            aria-label="GitHub"
                            className="inline-flex items-center opacity-70 hover:opacity-100 transition-opacity"
                          >
                            {/* lucide 已移除品牌 logo，内联 GitHub 官方 mark（24×24 viewBox） */}
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                            </svg>
                          </a>
                          <a
                            href="https://liaoweixiang.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            title="liaoweixiang.com"
                            aria-label="liaoweixiang.com"
                            className="inline-flex items-center opacity-70 hover:opacity-100 transition-opacity"
                          >
                            <Icon name="link" size={12} />
                          </a>
                        </p>
                      </div>

                      {/* System Update — version detection only */}
                      <div className="px-6 py-4">
                        <div className="flex items-center justify-between gap-4 mb-3">
                          <div>
                            <p className="text-sm font-medium text-on-surface">{t('adminSettings.versionCheck')}</p>
                            <p className="text-xs text-on-surface-variant mt-0.5">
                              {t('adminSettings.currentVersion')}:{' '}
                              <span className="font-mono text-primary-container">
                                {currentVersion || updateInfo?.current || '—'}
                              </span>
                              {updateInfo &&
                                !updateInfo.updateAvailable &&
                                (updateInfo.current || currentVersion) !== 'unknown' && (
                                  <span className="ml-1.5 text-emerald-400">{t('adminSettings.upToDateBadge')}</span>
                                )}
                              {updateInfo?.updateAvailable && (
                                <>
                                  {' '}
                                  {t('adminSettings.latestVersionPrefix')}{' '}
                                  <span className="font-mono text-emerald-400">{updateInfo.remote}</span>
                                </>
                              )}
                            </p>
                          </div>
                          <button
                            onClick={handleCheckUpdate}
                            disabled={checkingUpdate || adminBusy}
                            className="px-4 py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                          >
                            <Icon
                              name={checkingUpdate ? 'loader' : 'search'}
                              size={14}
                              className={checkingUpdate ? 'animate-spin' : ''}
                            />
                            {checkingUpdate ? t('adminSettings.checking') : t('adminSettings.checkUpdates')}
                          </button>
                        </div>

                        {updateInfo?.updateAvailable && (
                          <div className="mt-2 rounded-md bg-primary/10 border border-primary/20 overflow-hidden">
                            {/* Version comparison header */}
                            <div className="px-4 py-3 bg-primary/5 border-b border-primary/10">
                              <div className="flex items-center gap-3">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 font-mono">
                                  {updateInfo.current}
                                </span>
                                <Icon name="arrow_forward" size={16} className="text-primary" />
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
                                  {updateInfo.remote}
                                </span>
                                <span className="text-xs font-medium text-primary">
                                  {t('adminSettings.newVersionFound')}
                                </span>
                              </div>
                            </div>

                            {/* Release notes */}
                            {updateInfo.releaseNotes && (
                              <div className="px-4 py-3">
                                <p className="text-xs font-medium text-on-surface mb-2">
                                  {t('adminSettings.releaseNotes')}
                                </p>
                                <div className="max-h-48 overflow-y-auto text-xs text-on-surface-variant/80 space-y-0.5 whitespace-pre-line bg-surface-container/50 rounded p-3">
                                  {updateInfo.releaseNotes}
                                </div>
                              </div>
                            )}

                            {/* Upgrade command */}
                            <div className="px-4 py-3 border-t border-primary/10">
                              <p className="text-xs text-on-surface-variant mb-2">
                                {t('adminSettings.autoUpdateHint')}
                              </p>
                              <div className="bg-surface-container rounded p-3 font-mono text-xs text-on-surface select-all space-y-1">
                                <div>cd /opt/3dparthub</div>
                                <div>
                                  curl -L -o docker-compose.yml
                                  https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
                                </div>
                                <div>touch .env</div>
                                <div>
                                  grep -q '^IMAGE_TAG=' .env && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=latest/' .env || echo
                                  'IMAGE_TAG=latest' &gt;&gt; .env
                                </div>
                                <div>docker compose pull</div>
                                <div>docker compose up -d --force-recreate</div>
                              </div>
                              <p className="text-[10px] text-on-surface-variant/50 mt-2">
                                {t('adminSettings.shellHint')}
                                api
                              </p>
                              {updateInfo.releaseUrl && isSafeUrl(updateInfo.releaseUrl) && (
                                <a
                                  href={updateInfo.releaseUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-block mt-2 text-xs text-primary hover:underline"
                                >
                                  {t('adminSettings.viewGithubRelease')}
                                </a>
                              )}
                            </div>
                          </div>
                        )}

                        {updateInfo?.releaseNotes && !updateInfo.updateAvailable && (
                          <div className="mt-2 rounded-md bg-surface-container/60 border border-outline-variant/20 overflow-hidden">
                            <div className="px-4 py-3 border-b border-outline-variant/10">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-medium text-on-surface">
                                  {t('adminSettings.latestReleaseNotes')}
                                </p>
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 font-mono">
                                  {updateInfo.remote}
                                </span>
                              </div>
                            </div>
                            <div className="px-4 py-3">
                              <div className="max-h-48 overflow-y-auto text-xs text-on-surface-variant/80 space-y-0.5 whitespace-pre-line bg-surface-container/50 rounded p-3">
                                {updateInfo.releaseNotes}
                              </div>
                              {updateInfo.releaseUrl && isSafeUrl(updateInfo.releaseUrl) && (
                                <a
                                  href={updateInfo.releaseUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-block mt-2 text-xs text-primary hover:underline"
                                >
                                  {t('adminSettings.viewGithubRelease')}
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Version update timeline */}
                      <div className="px-6 py-4">
                        <div className="flex items-center justify-between gap-4 mb-4">
                          <div>
                            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-on-surface">
                              {t('adminSettings.versionHistory')}
                              {/* 三个统计均覆盖全部 GitHub release（服务端翻页拉全量计算，
                                  非仅展示的 20 条）；旧缓存缺 major/minor 时只显示总数 */}
                              <span className="rounded-sm bg-primary-container/15 px-1.5 py-0.5 text-[10px] font-medium text-primary-container">
                                {t('adminSettings.versionStatsTotal', {
                                  count: updateHistoryStats?.total ?? updateHistory.length,
                                })}
                              </span>
                              {typeof updateHistoryStats?.major === 'number' &&
                                typeof updateHistoryStats?.minor === 'number' && (
                                  <>
                                    <span className="rounded-sm bg-surface-container-high px-1.5 py-0.5 text-[10px] font-medium text-on-surface-variant">
                                      {t('adminSettings.versionStatsMajor', { count: updateHistoryStats.major })}
                                    </span>
                                    <span className="rounded-sm bg-surface-container-high px-1.5 py-0.5 text-[10px] font-medium text-on-surface-variant">
                                      {t('adminSettings.versionStatsMinor', { count: updateHistoryStats.minor })}
                                    </span>
                                  </>
                                )}
                            </p>
                            <p className="text-xs text-on-surface-variant mt-0.5">
                              {t('adminSettings.versionHistoryDesc')}
                            </p>
                          </div>
                          <button
                            onClick={loadUpdateHistory}
                            disabled={updateHistoryLoading}
                            className="px-3 py-1.5 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
                          >
                            <Icon name="refresh" size={14} className={updateHistoryLoading ? 'animate-spin' : ''} />
                            {t('adminSettings.refresh')}
                          </button>
                        </div>

                        {updateHistoryLoading && !updateHistoryLoaded ? (
                          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                            <Icon name="refresh" size={14} className="animate-spin" />
                            {t('adminSettings.loadingVersionHistory')}
                          </div>
                        ) : updateHistory.length === 0 ? (
                          <div className="rounded-md border border-outline-variant/20 bg-surface-container/40 px-4 py-3 text-xs text-on-surface-variant">
                            {t('adminSettings.noVersionHistory')}
                            {updateHistoryLoaded ? t('adminSettings.fetchFailedRetryHint') : ''}
                          </div>
                        ) : (
                          <div className="relative pl-5">
                            {/* timeline vertical line */}
                            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-outline-variant/25" />
                            <div className="space-y-4">
                              {updateHistory.map((entry) => {
                                const isCurrent = (currentVersion || updateInfo?.current || '') === entry.version;
                                const expanded = expandedVersion === entry.version;
                                const publishedText = entry.publishedAt
                                  ? new Date(entry.publishedAt).toLocaleString('zh-CN', {
                                      year: 'numeric',
                                      month: '2-digit',
                                      day: '2-digit',
                                    })
                                  : '';
                                return (
                                  <div key={entry.version} className="relative">
                                    {/* node dot */}
                                    <span
                                      className={`absolute -left-5 top-1.5 h-[11px] w-[11px] rounded-full border-2 ${
                                        isCurrent
                                          ? 'bg-emerald-500 border-emerald-500/40'
                                          : 'bg-primary border-primary/40'
                                      }`}
                                    />
                                    <button
                                      onClick={() => setExpandedVersion(expanded ? null : entry.version)}
                                      className="w-full text-left"
                                    >
                                      {/* 单行布局：徽章/日期/箭头不收缩，长标题弹性截断省略号——
                                          flex-wrap 会让长标题换行，一条记录占多行破坏时间线节奏 */}
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span
                                          className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border shrink-0 ${
                                            isCurrent
                                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                              : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/20'
                                          }`}
                                        >
                                          {entry.version}
                                        </span>
                                        {isCurrent && (
                                          <span className="text-[10px] font-medium text-emerald-400 shrink-0">
                                            {t('adminSettings.currentVersion')}
                                          </span>
                                        )}
                                        {publishedText && (
                                          <span className="text-[11px] text-on-surface-variant/70 shrink-0">
                                            {publishedText}
                                          </span>
                                        )}
                                        {entry.title && (
                                          <span className="flex-1 min-w-0 truncate text-xs text-on-surface/90">
                                            {entry.title}
                                          </span>
                                        )}
                                        <Icon
                                          name={expanded ? 'expand_less' : 'expand_more'}
                                          size={16}
                                          className="text-on-surface-variant/60 shrink-0"
                                        />
                                      </div>
                                    </button>
                                    {expanded && entry.notes && (
                                      <div className="mt-2 ml-1 rounded-md bg-surface-container/50 border border-outline-variant/15 p-3">
                                        <div className="max-h-64 overflow-y-auto text-xs text-on-surface-variant/85 whitespace-pre-line leading-relaxed">
                                          {entry.notes}
                                        </div>
                                        {isSafeUrl(entry.releaseUrl) && (
                                          <a
                                            href={entry.releaseUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-block mt-2 text-xs text-primary hover:underline"
                                          >
                                            {t('adminSettings.viewGithubRelease')}
                                          </a>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {updateHistory.length > 0 && (
                          <a
                            href="https://github.com/liaoweixiang2024-blip/3DPartHub/releases"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-4 ml-5 inline-flex items-center gap-1 text-xs text-on-surface-variant/70 hover:text-primary transition-colors"
                          >
                            {t('adminSettings.moreHistoryVersions')}
                            <Icon name="open_in_new" size={12} />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'adminSettings.tabCacheCleanup' && (
                  <div className="space-y-4">
                    {/* Scan header */}
                    <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <h3 className="text-sm font-semibold text-on-surface">
                            {t('adminSettings.cacheJunkCleanup')}
                          </h3>
                          <p className="text-xs text-on-surface-variant mt-1">{t('adminSettings.cacheJunkDesc')}</p>
                        </div>
                        <button
                          onClick={() => setCleanupScanConfirmOpen(true)}
                          disabled={cleanupScanning || cleanupRunning}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-container px-4 text-xs font-bold text-on-primary shadow-sm transition-colors hover:opacity-95 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none"
                        >
                          <Icon name={cleanupScanning ? 'hourglass_empty' : 'search'} size={14} />
                          {cleanupScanning ? t('adminSettings.scanning') : t('adminSettings.startScan')}
                        </button>
                      </div>
                    </div>

                    {/* Scan results */}
                    {cleanupScan && (
                      <>
                        {cleanupScan.totalFiles === 0 ? (
                          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 flex items-center gap-3">
                            <Icon name="verified" size={20} className="text-emerald-500 shrink-0" />
                            <div>
                              <p className="text-sm font-medium text-on-surface">{t('adminSettings.systemIsClean')}</p>
                              <p className="text-xs text-on-surface-variant mt-0.5">{t('adminSettings.noJunkFound')}</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Summary */}
                            <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <Icon name="info" size={16} className="text-on-surface-variant" />
                                <span className="text-sm text-on-surface">
                                  {t('adminSettings.junkFoundPrefix')}
                                  <strong>{cleanupScan.totalFiles}</strong>
                                  {t('adminSettings.junkFoundMiddle')}
                                  <strong>{cleanupScan.totalSizeText}</strong>
                                </span>
                              </div>

                              {/* Category list */}
                              <div className="space-y-2">
                                {cleanupScan.categories.map((cat: CleanupCategory) => {
                                  const selected = cleanupSelectedKeys.has(cat.key);
                                  return (
                                    <label
                                      key={cat.key}
                                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                                        selected
                                          ? 'bg-primary-container/20 border-primary/30'
                                          : 'bg-surface-container-high/40 border-outline-variant/10 hover:bg-surface-container-high/60'
                                      }`}
                                    >
                                      <input
                                        name="selected"
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() => {
                                          setCleanupSelectedKeys((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(cat.key)) next.delete(cat.key);
                                            else next.add(cat.key);
                                            return next;
                                          });
                                        }}
                                        disabled={cleanupRunning}
                                        className="h-4 w-4 rounded border-outline-variant text-primary accent-primary"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 text-sm text-on-surface">
                                          <span className="font-medium">{cat.label}</span>
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                                            {t('adminSettings.junkFileCount', { count: cat.count })}
                                          </span>
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                                            {cat.totalSizeText}
                                          </span>
                                        </div>
                                        {cat.samplePaths.length > 0 && (
                                          <p className="text-xs text-on-surface-variant mt-1 truncate">
                                            {t('adminSettings.samplePrefix')} {cat.samplePaths.join(', ')}
                                          </p>
                                        )}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>

                              {/* Select all + Clean button */}
                              <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-outline-variant/10">
                                <button
                                  onClick={() => {
                                    if (cleanupSelectedKeys.size === cleanupScan.categories.length) {
                                      setCleanupSelectedKeys(new Set());
                                    } else {
                                      setCleanupSelectedKeys(
                                        new Set(cleanupScan.categories.map((c: CleanupCategory) => c.key)),
                                      );
                                    }
                                  }}
                                  disabled={cleanupRunning}
                                  className="text-xs text-primary hover:underline disabled:text-on-surface-variant"
                                >
                                  {cleanupSelectedKeys.size === cleanupScan.categories.length
                                    ? t('adminSettings.deselectAll')
                                    : t('adminSettings.selectAll')}
                                </button>
                                <button
                                  onClick={() => {
                                    if (cleanupSelectedKeys.size === 0 || cleanupRunning) return;
                                    setCleanupConfirmOpen(true);
                                  }}
                                  disabled={cleanupSelectedKeys.size === 0 || cleanupRunning}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-error/90 px-4 text-xs font-bold text-white shadow-sm transition-colors hover:opacity-95 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none"
                                >
                                  <Icon name={cleanupRunning ? 'hourglass_empty' : 'delete'} size={14} />
                                  {cleanupRunning
                                    ? t('adminSettings.cleaning')
                                    : t('adminSettings.cleanSelectedWithCount', { count: cleanupSelectedKeys.size })}
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </AdminContentPanel>
        </div>
      </AdminManagementPage>
      <ConfirmDialog
        open={Boolean(backupDeleteConfirm)}
        onClose={() => {
          if (!backupDeleteInFlight.current) setBackupDeleteConfirm(null);
        }}
        onConfirm={() => {
          const target = backupDeleteConfirm;
          if (target) void handleDelete(target.id);
        }}
        title={t('adminSettings.confirmDeleteBackupTitle')}
        description={t('adminSettings.confirmDeleteBackupDesc', { name: backupDeleteConfirm?.name || '' })}
        confirmLabel={t('adminSettings.confirmDeleteTitle')}
        confirmDisabled={backupDeleteInFlight.current}
      />
      <ConfirmDialog
        open={cleanupConfirmOpen}
        onClose={() => setCleanupConfirmOpen(false)}
        onConfirm={() => void handleCleanupSelectedConfirm()}
        icon="delete_sweep"
        title={t('adminSettings.confirmCleanupCache')}
        description={t('adminSettings.confirmCleanSelected', { count: cleanupSelectedKeys.size })}
        confirmLabel={cleanupRunning ? t('adminSettings.cleaning') : t('adminSettings.cleanSelected')}
        confirmDisabled={cleanupSelectedKeys.size === 0 || cleanupRunning}
      />
      <ConfirmDialog
        open={policyCheckConfirmOpen}
        onClose={() => setPolicyCheckConfirmOpen(false)}
        onConfirm={() => {
          setPolicyCheckConfirmOpen(false);
          void handleBackupPolicyCheck();
        }}
        icon="fact_check"
        iconColor="text-primary"
        iconBg="bg-primary/15"
        title={t('adminSettings.confirmPolicyCheckTitle')}
        description={t('adminSettings.confirmPolicyCheck')}
        confirmLabel={t('adminSettings.startHealthCheck')}
      />
      <ConfirmDialog
        open={exportConfirmOpen}
        onClose={() => setExportConfirmOpen(false)}
        onConfirm={() => {
          setExportConfirmOpen(false);
          void handleExport();
        }}
        icon="backup"
        iconColor="text-primary"
        iconBg="bg-primary/15"
        title={t('adminSettings.confirmCreateBackupTitle')}
        description={t('adminSettings.confirmCreateBackup')}
        confirmLabel={t('adminSettings.createBackup')}
      />
      <ConfirmDialog
        open={cleanupScanConfirmOpen}
        onClose={() => setCleanupScanConfirmOpen(false)}
        onConfirm={() => {
          setCleanupScanConfirmOpen(false);
          void handleCleanupScan();
        }}
        icon="search"
        iconColor="text-primary"
        iconBg="bg-primary/15"
        title={t('adminSettings.confirmCacheScanTitle')}
        description={t('adminSettings.confirmCacheScan')}
        confirmLabel={t('adminSettings.startScan')}
      />
      <ConfirmDialog
        open={Boolean(verifyConfirmId)}
        onClose={() => setVerifyConfirmId(null)}
        onConfirm={() => {
          const id = verifyConfirmId;
          setVerifyConfirmId(null);
          if (id) void handleVerifyBackup(id);
        }}
        icon="verified"
        iconColor="text-primary"
        iconBg="bg-primary/15"
        title={t('adminSettings.confirmVerifyBackupTitle')}
        description={t('adminSettings.confirmVerifyBackup')}
        confirmLabel={t('adminSettings.startVerify')}
      />
      <BackupEncryptionNoticeDialog
        open={backupEncryptedNoticeOpen}
        onClose={() => setBackupEncryptedNoticeOpen(false)}
        secretEnvName={backupHealth?.encryption?.recommendedEnvName}
      />
    </>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('adminSettings.pageTitle'));

  return (
    <AdminPageShell>
      <Content />
    </AdminPageShell>
  );
}
