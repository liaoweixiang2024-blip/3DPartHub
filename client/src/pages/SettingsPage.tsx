import { useState, useEffect, useRef } from 'react';
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
  listBackups,
  importBackup,
  importBackupAsRecord,
  pollImportSaveProgress,
  listServerBackupFiles,
  importBackupFromPath,
  type ServerBackupFile,
  checkUpdate,
  getVersion,
  type SystemSettings,
  type BackupStats,
  type BackupRecord,
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
} from '../api/settings';
import ColorSchemeEditor from '../components/settings/ColorSchemeSettings';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SafeImage from '../components/shared/SafeImage';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
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
import { DEFAULT_PRIVACY_SECTIONS, DEFAULT_TERMS_SECTIONS, type LegalSection } from '../lib/legalContent';
import {
  buildFooterCopyright,
  buildModelDetailCopyright,
  DEFAULT_FOOTER_COPYRIGHT,
  DEFAULT_MODEL_DETAIL_COPYRIGHT,
  DEFAULT_MODEL_DETAIL_DISCLAIMER,
} from '../lib/publicSettings';
import {
  DEFAULT_INTERFACE_THEME,
  INTERFACE_THEME_CATALOG,
  INTERFACE_THEME_OPTIONS,
} from '../themes/interfaceThemes/catalog';
import { DEFAULT_MOBILE_THEME, MOBILE_THEME_OPTIONS } from '../themes/mobileThemes/catalog';
// Note: pollBackupProgress is used by handleExport

const RESTORE_JOB_SOURCE_KEY = 'restoreJobSource';

const DEFAULT_SETTINGS: SystemSettings = {
  require_login_download: false,
  require_login_browse: false,
  allow_register: true,
  daily_download_limit: 0,
  show_watermark: false,
  watermark_text: '3DPartHub',
  watermark_image: '',
  site_title: '3DPartHub',
  site_browser_title: '',
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
  model_detail_disclaimer: DEFAULT_MODEL_DETAIL_DISCLAIMER,
  model_detail_copyright: DEFAULT_MODEL_DETAIL_COPYRIGHT,
  model_detail_copyright_follow_site_title: true,
  legal_privacy_updated_at: '2026 年 4 月',
  legal_terms_updated_at: '2026 年 4 月',
  legal_privacy_sections: JSON.stringify(DEFAULT_PRIVACY_SECTIONS, null, 2),
  legal_terms_sections: JSON.stringify(DEFAULT_TERMS_SECTIONS, null, 2),
  announcement_enabled: false,
  announcement_text: '',
  announcement_type: 'info',
  announcement_color: '',
  maintenance_enabled: false,
  maintenance_auto_enabled: true,
  maintenance_auto_queue_threshold: 50,
  maintenance_title: '系统维护中',
  maintenance_message: '系统正在进行维护、数据恢复或资源重建，部分页面可能暂时不可用。请稍后再访问。',
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
  mat_original_color: '',
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
  viewer_default_preset: 'default',
  viewer_visible_presets: 'original,default,metal,plastic,glass',
  viewer_edge_enabled: true,
  viewer_edge_threshold_angle: 28,
  viewer_edge_vertex_limit: 700000,
  viewer_edge_color: '#000000',
  viewer_edge_opacity: 1.0,
  viewer_edge_width: 1,
  viewer_measure_default_unit: 'auto',
  viewer_measure_record_limit: 12,
  security_email_code_cooldown_seconds: 60,
  security_email_code_ttl_seconds: 600,
  security_captcha_ttl_seconds: 300,
  security_password_min_length: 8,
  security_username_min_length: 2,
  security_username_max_length: 32,
  share_enabled: true,
  share_default_expire_days: 0,
  share_max_expire_days: 0,
  share_default_download_limit: 0,
  share_max_download_limit: 0,
  share_allow_password: true,
  share_allow_custom_expiry: true,
  share_allow_preview: true,
  selection_page_title: '产品选型',
  selection_page_desc: '先选产品大类，再按参数逐步缩小范围',
  selection_enable_match: true,
  selection_thread_priority: JSON.stringify(DEFAULT_THREAD_PRIORITY, null, 2),
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
    'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,ppt,pptx,zip,rar,7z,step,stp,iges,igs,xt,binary',
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
  { value: 'redis', label: 'Redis 缓存' },
  { value: 'memory', label: '内存缓存' },
  { value: 'off', label: '关闭缓存' },
];

const STORAGE_PROVIDER_OPTIONS = [
  { value: 'local', label: '本地存储' },
  { value: 'minio', label: 'MinIO / 私有 S3' },
  { value: 'tencent_cos', label: '腾讯云 COS' },
  { value: 'aliyun_oss', label: '阿里云 OSS' },
  { value: 'qiniu_kodo', label: '七牛云 Kodo' },
  { value: 's3_compatible', label: 'S3 兼容存储' },
];

const CACHE_STORAGE_GROUP_TITLE = '缓存与云存储';
const CACHE_STORAGE_SECTION_TITLES = [
  'Redis 与页面缓存',
  '对象存储服务商',
  '资源目录与访问策略',
  '本地与云同步',
  '图片与资源优化',
] as const;
const SETTING_SECTION_ICONS: Record<string, string> = {
  'Redis 与页面缓存': 'memory',
  对象存储服务商: 'cloud',
  资源目录与访问策略: 'folder_open',
  本地与云同步: 'sync_alt',
  图片与资源优化: 'image',
};

const GROUPS: SettingGroup[] = [
  {
    title: '站点与品牌',
    icon: 'domain',
    items: [
      { key: 'site_title', label: '网站名称', desc: '显示在导航栏、登录页和浏览器标签的站点名称', type: 'text' },
      {
        key: 'site_browser_title',
        label: '浏览器标题',
        desc: '浏览器标签页显示的标题，留空则使用网站名称',
        type: 'text',
      },
      {
        key: 'site_logo',
        label: '站点 Logo',
        desc: '用于”仅 Logo”模式，适合横版长条图；导航会按高度自适应，不会拉伸变形',
        type: 'image',
      },
      {
        key: 'site_icon',
        label: '站点图标',
        desc: '用于”图标 + 标题”模式，推荐方形图标；若误传横版图，导航也会限制宽高避免挤压标题',
        type: 'image',
      },
      {
        key: 'site_logo_display',
        label: 'Logo 显示方式',
        desc: '图标 + 标题适合大多数站点；仅 Logo 适合已包含文字的横版品牌图',
        type: 'select',
        options: [
          { value: 'logo_and_title', label: '图标 + 标题' },
          { value: 'logo_only', label: '仅 Logo（长条）' },
          { value: 'title_only', label: '仅标题' },
        ],
      },
      {
        key: 'site_favicon',
        label: 'Favicon 图标',
        desc: '浏览器标签页图标，建议正方形 32×32 或 64×64，支持 ICO/PNG/SVG',
        type: 'image',
      },
      { key: 'site_description', label: '网站描述', desc: '用于 SEO 和分享链接的站点描述', type: 'text' },
      { key: 'site_keywords', label: '关键词', desc: 'SEO 关键词，多个用逗号分隔', type: 'text' },
      { _section: '页脚联系信息' },
      {
        key: 'contact_email',
        label: '联系邮箱',
        desc: '显示在前台页脚的联系信息区，用户可直接点击发送邮件',
        type: 'text',
      },
      { key: 'contact_phone', label: '联系电话', desc: '显示在前台页脚的联系信息区', type: 'text' },
      { key: 'contact_address', label: '联系地址', desc: '显示在前台页脚底部的公司/办公地址', type: 'text' },
      { _section: '模型详情页页脚' },
      {
        key: 'model_detail_disclaimer',
        label: '模型详情说明',
        desc: '显示在模型详情页底部，用于说明模型用途、生产依据等注意事项',
        type: 'textarea',
      },
      {
        key: 'model_detail_copyright_follow_site_title',
        label: '模型详情版权跟随网站名称',
        desc: '开启后根据站点标题自动生成：© 2026 网站名称',
        type: 'switch',
      },
      {
        key: 'model_detail_copyright',
        label: '模型详情版权',
        desc: '关闭跟随网站名称后可手动编辑，例如：© 2026 3DPartHub',
        type: 'text',
      },
      { _section: '友情链接与版权' },
      {
        key: 'footer_links',
        label: '友情链接',
        desc: '显示在前台页脚的相关链接区；保存时会自动过滤空行',
        type: 'textarea',
      },
      {
        key: 'footer_copyright_follow_site_title',
        label: '页脚版权跟随网站名称',
        desc: '开启后根据站点标题自动生成：© 2026 网站名称. All rights reserved.',
        type: 'switch',
      },
      {
        key: 'footer_copyright',
        label: '页脚版权',
        desc: '关闭跟随网站名称后可手动编辑，例如：© 2026 3DPartHub. All rights reserved.',
        type: 'text',
      },
    ],
  },
  {
    title: '外观与主题',
    icon: 'palette',
    items: [
      {
        key: 'interface_theme',
        label: '界面主题',
        desc: '选择前台界面风格，会影响导航、首页、登录页和部分页面模板的展示效果。',
        type: 'select',
        options: INTERFACE_THEME_OPTIONS,
      },
      {
        key: 'mobile_interface_theme',
        label: '移动端主题',
        desc: '移动端独立主题入口；当前默认沿用旧版移动端样式，后续可单独开发和切换移动端主题。',
        type: 'select',
        options: MOBILE_THEME_OPTIONS,
      },
      {
        key: 'user_interface_theme_enabled',
        label: '允许用户自定义前台界面风格',
        desc: '开启后用户可在前台用户菜单里选择“跟随网站默认 / 经典主题 / 工作台主题”，仅影响公开前台桌面页面。',
        type: 'switch',
      },
      {
        key: 'color_scheme',
        label: '配色方案',
        desc: '预设:orange/blue/green/purple/red/teal 或 custom',
        type: 'color-scheme',
      },
      {
        key: 'default_theme',
        label: '默认主题',
        desc: '新用户首次访问时看到的默认外观',
        type: 'select',
        options: [
          { value: 'dark', label: '暗色模式' },
          { value: 'light', label: '亮色模式' },
          { value: 'system', label: '跟随系统' },
        ],
      },
      { key: 'auto_theme_enabled', label: '定时切换', desc: '按时间段自动在亮色和暗色之间切换', type: 'switch' },
      { key: 'auto_theme_dark_hour', label: '暗色开始', desc: '几点切换为暗色模式（24小时制）', type: 'number' },
      { key: 'auto_theme_light_hour', label: '亮色开始', desc: '几点切换为亮色模式（24小时制）', type: 'number' },
    ],
  },
  {
    title: '系统公告',
    icon: 'campaign',
    items: [
      { key: 'announcement_enabled', label: '启用公告', desc: '在首页顶部显示系统公告横幅', type: 'switch' },
      {
        key: 'announcement_text',
        label: '公告内容',
        desc: '支持 HTML，如输入 <a href=”https://...” >链接</a> 可插入超链接',
        type: 'textarea',
      },
      {
        key: 'announcement_type',
        label: '公告样式',
        desc: '选择公告横幅的预设配色方案',
        type: 'select',
        options: [
          { value: 'info', label: '信息 (蓝色)' },
          { value: 'warning', label: '警告 (黄色)' },
          { value: 'error', label: '紧急 (红色)' },
        ],
      },
      {
        key: 'announcement_color',
        label: '自定义颜色',
        desc: '填入十六进制色值（如 #FF6600）覆盖预设配色，留空则使用上方预设样式',
        type: 'color',
      },
    ],
  },
  {
    title: '菜单配置',
    icon: 'menu',
    items: [
      {
        key: 'nav_items',
        label: '侧边栏菜单',
        desc: '统一配置侧边栏菜单，管理员项仅管理员可见',
        type: 'textarea',
      },
      { key: 'nav_mobile_items', label: '移动端底部菜单', desc: '配置移动端底部导航，建议最多 5 项', type: 'textarea' },
    ],
  },
  {
    title: '访问控制',
    icon: 'lock',
    items: [
      { key: 'require_login_browse', label: '登录浏览', desc: '用户必须登录后才能浏览模型列表', type: 'switch' },
      { key: 'require_login_download', label: '登录下载', desc: '用户必须登录后才能下载模型文件', type: 'switch' },
      { key: 'allow_register', label: '开放注册', desc: '允许新用户自行注册账号', type: 'switch' },
      {
        key: 'auth_modal_enabled',
        label: '登录/注册表单弹窗',
        desc: '开启后登录和注册在当前页面弹窗完成；关闭后跳转到独立登录/注册页面',
        type: 'switch',
      },
      {
        key: 'login_dialog_enabled',
        label: '登录提示弹窗',
        desc: '开启后访问受保护页面时先显示“需要登录”的提示弹窗；关闭后按登录/注册表单设置直接登录或跳转',
        type: 'switch',
      },
      { _section: '按页面控制登录提示（仅“登录提示弹窗”开启时生效）' },
      { key: 'login_dialog_favorites', label: '查看收藏', desc: '访问收藏页面时弹出登录确认', type: 'switch' },
      { key: 'login_dialog_downloads', label: '下载历史', desc: '访问下载历史页面时弹出登录确认', type: 'switch' },
      { key: 'login_dialog_my_shares', label: '我的分享', desc: '访问我的分享页面时弹出登录确认', type: 'switch' },
      { key: 'login_dialog_profile', label: '个人设置', desc: '访问个人设置页面时弹出登录确认', type: 'switch' },
      { key: 'login_dialog_support', label: '技术支持', desc: '访问技术支持页面时弹出登录确认', type: 'switch' },
      { key: 'login_dialog_my_tickets', label: '我的工单', desc: '访问我的工单页面时弹出登录确认', type: 'switch' },
      { key: 'login_dialog_my_inquiries', label: '我的询价', desc: '访问我的询价页面时弹出登录确认', type: 'switch' },
      { key: 'login_dialog_projects', label: '我的项目', desc: '访问我的项目页面时弹出登录确认', type: 'switch' },
    ],
  },
  {
    title: '安全防护',
    icon: 'shield',
    items: [
      {
        key: 'anti_proxy_enabled',
        label: '反向代理防护',
        desc: '启用后，通过非授权域名访问将显示警告页面，防止恶意反向代理',
        type: 'switch',
      },
      {
        key: 'allowed_hosts',
        label: '授权域名',
        desc: '允许访问的域名列表，逗号或换行分隔。如：mysite.com, www.mysite.com。填写您部署的正式域名',
        type: 'textarea',
      },
      {
        key: 'hotlink_protection_enabled',
        label: '防盗链保护',
        desc: '阻止外部网站直接引用本站静态资源（图片、模型文件等）',
        type: 'switch',
      },
      {
        key: 'allowed_referers',
        label: '允许的来源域名',
        desc: '允许引用资源的域名列表，逗号分隔。如：mysite.com, www.mysite.com',
        type: 'textarea',
      },
      {
        key: 'security_email_code_cooldown_seconds',
        label: '邮箱验证码间隔',
        desc: '同一邮箱两次发送验证码的最小间隔，单位秒',
        type: 'number',
        min: 10,
        max: 3600,
      },
      {
        key: 'security_email_code_ttl_seconds',
        label: '邮箱验证码有效期',
        desc: '邮箱验证码过期时间，单位秒',
        type: 'number',
        min: 60,
        max: 86400,
      },
      {
        key: 'security_captcha_ttl_seconds',
        label: '图形验证码有效期',
        desc: '图形验证码过期时间，单位秒',
        type: 'number',
        min: 60,
        max: 3600,
      },
      {
        key: 'security_password_min_length',
        label: '注册密码最小长度',
        desc: '新用户注册时密码最少位数',
        type: 'number',
        min: 6,
        max: 64,
      },
      {
        key: 'security_username_min_length',
        label: '用户名最小长度',
        desc: '注册用户名允许的最小长度',
        type: 'number',
        min: 1,
        max: 32,
      },
      {
        key: 'security_username_max_length',
        label: '用户名最大长度',
        desc: '注册用户名允许的最大长度',
        type: 'number',
        min: 1,
        max: 64,
      },
    ],
  },
  {
    title: '下载与分享',
    icon: 'download',
    items: [
      {
        key: 'daily_download_limit',
        label: '每日下载上限',
        desc: '每个用户每天最多下载次数，0 表示不限制',
        type: 'number',
      },
      {
        key: 'download_token_ttl_minutes',
        label: '下载令牌有效期 (分钟)',
        desc: '下载令牌的有效时间，过期后需重新获取',
        type: 'number',
        min: 1,
        max: 60,
      },
      {
        key: 'share_enabled',
        label: '允许分享',
        desc: '关闭后用户将无法创建模型分享链接',
        type: 'switch',
      },
      {
        key: 'share_default_expire_days',
        label: '分享默认有效期',
        desc: '用户创建分享时的默认有效期天数，0 表示永久有效',
        type: 'number',
      },
      {
        key: 'share_max_expire_days',
        label: '分享最大有效期',
        desc: '分享链接最大有效期天数，0 表示不限制',
        type: 'number',
      },
      {
        key: 'share_default_download_limit',
        label: '分享默认下载上限',
        desc: '用户创建分享时的默认下载次数限制，0 表示不限制',
        type: 'number',
      },
      {
        key: 'share_max_download_limit',
        label: '分享最大下载上限',
        desc: '分享链接最大下载次数，0 表示不限制',
        type: 'number',
      },
      {
        key: 'share_allow_password',
        label: '允许设置密码',
        desc: '用户创建分享时是否可以设置访问密码',
        type: 'switch',
      },
      {
        key: 'share_allow_custom_expiry',
        label: '允许自定义有效期',
        desc: '用户创建分享时是否可以自行设置有效期',
        type: 'switch',
      },
      {
        key: 'share_allow_preview',
        label: '默认允许预览',
        desc: '新创建的分享链接默认是否允许 3D 预览',
        type: 'switch',
      },
      { key: 'show_watermark', label: '下载水印', desc: '在下载的模型图片上叠加水印，保护知识产权', type: 'switch' },
      { key: 'watermark_text', label: '水印文字', desc: '水印显示的文字内容，如公司名或品牌名', type: 'text' },
      {
        key: 'watermark_image',
        label: '水印图片',
        desc: '上传透明背景 PNG 图片作为水印，留空则使用文字水印',
        type: 'image',
      },
    ],
  },
  {
    title: '3D 预览',
    icon: 'view_in_ar',
    items: [],
  },
  {
    title: '选型设置',
    icon: 'checklist',
    items: [
      { key: 'selection_page_title', label: '选型页标题', desc: '选型页顶部显示的标题文字', type: 'text' },
      { key: 'selection_page_desc', label: '选型页描述', desc: '显示在选型页标题下方，引导用户开始筛选', type: 'text' },
      { key: 'selection_enable_match', label: '模型匹配', desc: '在选型结果中自动匹配3D模型', type: 'switch' },
      {
        key: 'selection_thread_priority',
        label: '螺纹排序优先级',
        desc: '配置螺纹前缀的排序权重，数值越小越靠前',
        type: 'textarea',
      },
    ],
  },
  {
    title: '业务字典',
    icon: 'tune',
    items: [
      {
        key: 'inquiry_statuses',
        label: '询价状态',
        desc: '用于筛选、标签和通知文案，可配置颜色、标签页展示和终态',
        type: 'textarea',
      },
      { key: 'ticket_statuses', label: '工单状态', desc: '用于状态流转、筛选标签和状态徽标', type: 'textarea' },
      {
        key: 'ticket_classifications',
        label: '工单分类',
        desc: '用于技术支持提交入口，可配置图标、说明和启用状态',
        type: 'textarea',
      },
      {
        key: 'support_process_steps',
        label: '支持流程',
        desc: '用于技术支持页流程展示，可配置图标、标题和说明',
        type: 'textarea',
      },
    ],
  },
  {
    title: '上传与限制',
    icon: 'upload_file',
    items: [
      {
        key: 'upload_policy',
        label: '文件上传与导入限制',
        desc: '配置模型上传、选型图片、选型 Excel 导入、产品图库上传和工单附件限制',
        type: 'textarea',
      },
      {
        key: 'product_wall_max_image_mb',
        label: '产品图库单张上限 (MB)',
        desc: '单张图片文件的最大体积，超出会被拒绝',
        type: 'number',
        min: 1,
        max: 200,
      },
      {
        key: 'product_wall_max_batch_count',
        label: '产品图库批量上限',
        desc: '单次上传（含压缩包内图片）的最大数量',
        type: 'number',
        min: 1,
        max: 200,
      },
      {
        key: 'product_wall_max_zip_extract',
        label: '压缩包提取上限',
        desc: '从单个 zip/rar 压缩包中最多提取的图片数量',
        type: 'number',
        min: 1,
        max: 500,
      },
      {
        key: 'ticket_attachment_max_mb',
        label: '工单附件上限 (MB)',
        desc: '工单消息中单个附件的最大体积',
        type: 'number',
        min: 1,
        max: 200,
      },
      {
        key: 'ticket_attachment_types',
        label: '工单附件类型',
        desc: '用逗号分隔的文件扩展名，如：jpg,png,pdf,step,zip',
        type: 'text',
      },
      {
        key: 'page_size_policy',
        label: '列表分页与批量上限',
        desc: '配置选型、通知、用户、分享、日志等列表分页，以及用户/后台批量下载数量',
        type: 'textarea',
      },
    ],
  },
  {
    title: CACHE_STORAGE_GROUP_TITLE,
    icon: 'storage',
    items: [
      { _section: 'Redis 与页面缓存' },
      {
        key: 'cache_enabled',
        label: '启用缓存',
        desc: '控制公共设置、模型列表、搜索、选型等高频数据的缓存策略',
        type: 'switch',
      },
      {
        key: 'cache_driver',
        label: '缓存驱动',
        desc: 'Redis 适合生产环境；内存缓存适合单机测试；关闭缓存便于调试',
        type: 'select',
        options: CACHE_DRIVER_OPTIONS,
      },
      {
        key: 'redis_url',
        label: 'Redis 地址',
        desc: '例如 redis://127.0.0.1:6379 或 rediss://host:6379；生产环境建议使用独立 Redis',
        type: 'text',
      },
      {
        key: 'redis_password',
        label: 'Redis 密码',
        desc: 'Redis 认证密码；留空表示无密码，保存后会自动隐藏',
        type: 'text',
      },
      {
        key: 'redis_db',
        label: 'Redis 数据库',
        desc: 'Redis DB 编号，默认 0；多项目共用 Redis 时建议单独分配',
        type: 'number',
        min: 0,
        max: 15,
      },
      {
        key: 'redis_key_prefix',
        label: '缓存键前缀',
        desc: '用于隔离不同部署环境，如 3dparthub:prod；修改后建议清理旧缓存',
        type: 'text',
      },
      {
        key: 'redis_tls_enabled',
        label: 'Redis TLS',
        desc: '云厂商 Redis 开启 TLS/SSL 时启用；也可直接使用 rediss:// 地址',
        type: 'switch',
      },
      {
        key: 'cache_test',
        label: 'Redis 连接测试',
        desc: '保存当前缓存配置后，执行 PING、写入、读取和删除测试键',
        type: 'cache-test',
      },
      {
        key: 'cache_public_settings_ttl_seconds',
        label: '公共设置缓存',
        desc: '站点名称、主题、导航等公共设置缓存时间；越短越快生效',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_model_list_ttl_seconds',
        label: '模型列表缓存',
        desc: '首页、模型列表和分类结果的缓存时间；模型频繁更新时建议缩短',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_model_detail_ttl_seconds',
        label: '模型详情缓存',
        desc: '模型详情、规格、下载项等数据缓存时间',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_search_ttl_seconds',
        label: '搜索缓存',
        desc: '顶部搜索、后台搜索、模型搜索的结果缓存时间',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_selection_ttl_seconds',
        label: '选型数据缓存',
        desc: '选型分类、参数和产品数据缓存时间；批量导入后可清理缓存',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'cache_static_asset_max_age_days',
        label: '静态资源缓存',
        desc: '图片、缩略图、模型资源等浏览器缓存天数；配合 CDN 使用效果更好',
        type: 'number',
        min: 0,
        max: 365,
      },
      { _section: '对象存储服务商' },
      {
        key: 'storage_provider',
        label: '存储类型',
        desc: '选择图片、模型文件、附件、备份等资源的存储后端；切换到云存储后需配置访问参数',
        type: 'select',
        options: STORAGE_PROVIDER_OPTIONS,
      },
      {
        key: 'storage_endpoint',
        label: 'Endpoint',
        desc: 'COS/OSS/S3/MinIO 服务地址，例如 cos.ap-guangzhou.myqcloud.com 或 oss-cn-hangzhou.aliyuncs.com',
        type: 'text',
      },
      {
        key: 'storage_region',
        label: '地域 Region',
        desc: '云存储地域，如 ap-guangzhou、oss-cn-hangzhou；本地存储可留空',
        type: 'text',
      },
      {
        key: 'storage_bucket',
        label: 'Bucket',
        desc: '用于保存图片、模型、附件和备份文件的 Bucket 名称',
        type: 'text',
      },
      {
        key: 'storage_access_key_id',
        label: 'Access Key ID',
        desc: '云存储访问密钥 ID；建议使用最小权限账号',
        type: 'text',
      },
      {
        key: 'storage_access_key_secret',
        label: 'Access Key Secret',
        desc: '云存储访问密钥 Secret；保存后会自动隐藏',
        type: 'text',
      },
      {
        key: 'storage_use_ssl',
        label: 'HTTPS 访问',
        desc: '生产环境建议开启；本地 MinIO 调试可按实际情况关闭',
        type: 'switch',
      },
      {
        key: 'storage_force_path_style',
        label: '路径风格访问',
        desc: 'MinIO 或部分 S3 兼容服务需要开启；腾讯云 COS、阿里云 OSS 通常关闭',
        type: 'switch',
      },
      {
        key: 'storage_public_base_url',
        label: '公开访问域名',
        desc: '资源公开访问基础地址，例如对象存储外网域名；留空则由后端生成默认地址',
        type: 'text',
      },
      {
        key: 'storage_cdn_base_url',
        label: 'CDN 加速域名',
        desc: '图片和资源使用的 CDN 域名；开启下方 CDN 开关后优先使用',
        type: 'text',
      },
      {
        key: 'storage_test',
        label: '存储读写测试',
        desc: '保存当前存储配置后，向临时目录写入、读取并删除一个测试对象',
        type: 'storage-test',
      },
      { _section: '资源目录与访问策略' },
      {
        key: 'storage_policy_info',
        label: '目录说明',
        desc: '按资源类型说明本地目录、云端对象前缀和访问策略',
        type: 'storage-policy-info',
      },
      {
        key: 'storage_image_prefix',
        label: '图片目录',
        desc: '模型图片、站点图片等原图目录前缀；本地对应 static/{前缀}，云端对象也使用同一前缀',
        type: 'text',
      },
      {
        key: 'storage_thumbnail_prefix',
        label: '缩略图目录',
        desc: '首页列表、模型卡片、产品图库缩略图目录前缀；建议公开缓存，适合 CDN 加速',
        type: 'text',
      },
      {
        key: 'storage_model_prefix',
        label: '模型文件目录',
        desc: 'STEP/STP/IGES/XT 等可下载模型文件目录前缀；私有下载时会走签名链接策略',
        type: 'text',
      },
      {
        key: 'storage_original_prefix',
        label: '原始文件目录',
        desc: '上传后的原始资源、未转换源文件目录前缀；通常不直接公开访问',
        type: 'text',
      },
      {
        key: 'storage_drawing_prefix',
        label: '图纸目录',
        desc: 'PDF、工程图、说明文档等图纸资源目录前缀；模型详情下载图纸时优先读取这里',
        type: 'text',
      },
      {
        key: 'storage_product_wall_prefix',
        label: '产品图库目录',
        desc: '产品图库批量上传、压缩包提取后的图片目录前缀；会配合缩略图优化降低列表卡顿',
        type: 'text',
      },
      {
        key: 'storage_attachment_prefix',
        label: '附件目录',
        desc: '工单、询价沟通、用户上传附件目录前缀；建议开启私有签名访问',
        type: 'text',
      },
      {
        key: 'storage_backup_prefix',
        label: '备份目录',
        desc: '数据库备份、资源备份、镜像更新包目录前缀；可参与本地与云存储同步',
        type: 'text',
      },
      {
        key: 'storage_temp_prefix',
        label: '临时目录',
        desc: '分片上传、转换过程和临时导入文件目录前缀；不会参与同步，避免未完成文件被发布',
        type: 'text',
      },
      {
        key: 'storage_signed_url_enabled',
        label: '私有签名访问',
        desc: '模型文件、原始文件和附件通过临时签名 URL 访问，适合私有 Bucket',
        type: 'switch',
      },
      {
        key: 'storage_signed_url_ttl_seconds',
        label: '签名链接有效期',
        desc: '下载模型、图纸、附件时生成临时 URL 的有效时间',
        type: 'number',
        min: 60,
        max: 86400,
      },
      {
        key: 'storage_upload_multipart_mb',
        label: '分片大小',
        desc: '大模型和压缩包上传的分片大小，云存储建议 8-64 MB',
        type: 'number',
        min: 5,
        max: 512,
      },
      {
        key: 'storage_upload_concurrency',
        label: '上传并发',
        desc: '大文件分片上传并发数；带宽较小时建议 2-4',
        type: 'number',
        min: 1,
        max: 16,
      },
      { _section: '本地与云同步' },
      {
        key: 'storage_sync_enabled',
        label: '启用同步工具',
        desc: '开启后允许管理员手动执行本地 static 资源与云存储 Bucket 的同步任务',
        type: 'switch',
      },
      {
        key: 'storage_sync_delete_extra_enabled',
        label: '允许删除目标端多余文件',
        desc: '开启后同步面板才允许选择“删除目标端多余文件”；默认关闭，避免误删',
        type: 'switch',
      },
      {
        key: 'storage_sync',
        label: '同步任务',
        desc: '按资源目录执行本地到云端或云端到本地同步，支持进度、停止和记录删除',
        type: 'storage-sync',
      },
      { _section: '图片与资源优化' },
      {
        key: 'image_cdn_enabled',
        label: '图片走 CDN',
        desc: '首页缩略图、模型图片、产品图库图片优先使用 CDN 域名',
        type: 'switch',
      },
      {
        key: 'image_optimize_enabled',
        label: '图片压缩优化',
        desc: '上传后生成轻量缩略图，减少产品墙和模型列表首屏加载压力',
        type: 'switch',
      },
      {
        key: 'image_webp_enabled',
        label: '生成 WebP',
        desc: '支持浏览器优先返回 WebP 缩略图；原图仍保留',
        type: 'switch',
      },
      {
        key: 'image_thumbnail_quality',
        label: '缩略图质量',
        desc: '图片缩略图压缩质量，建议 75-88；数值越高体积越大',
        type: 'number',
        min: 1,
        max: 100,
      },
      {
        key: 'image_large_max_width',
        label: '大图最大宽度',
        desc: '图片预览大图的最大宽度，超出后按比例压缩',
        type: 'number',
        min: 320,
        max: 12000,
      },
      {
        key: 'image_cache_max_age_days',
        label: '图片缓存天数',
        desc: '图片、缩略图、WebP 等资源的浏览器/CDN 缓存天数',
        type: 'number',
        min: 0,
        max: 365,
      },
      {
        key: 'resource_cdn_enabled',
        label: '模型资源走 CDN',
        desc: 'STEP、图纸、附件等静态资源优先使用 CDN 域名；私有下载仍会走签名策略',
        type: 'switch',
      },
      {
        key: 'resource_cache_max_age_days',
        label: '资源缓存天数',
        desc: '模型文件、图纸、附件等资源的浏览器/CDN 缓存天数',
        type: 'number',
        min: 0,
        max: 365,
      },
      {
        key: 'resource_download_acceleration_enabled',
        label: '下载加速',
        desc: '批量下载、模型下载优先使用加速域名；需要 CDN 或对象存储加速服务配合',
        type: 'switch',
      },
    ],
  },
  {
    title: '邮件服务',
    icon: 'mail',
    items: [
      { key: 'smtp_host', label: 'SMTP 服务器', desc: '邮件服务器地址，如 smtp.qq.com', type: 'text' },
      { key: 'smtp_port', label: '端口', desc: 'SMTP 端口，通常 465(SSL) 或 587(TLS)', type: 'number' },
      { key: 'smtp_user', label: '用户名', desc: 'SMTP 登录用户名', type: 'text' },
      { key: 'smtp_pass', label: '密码', desc: 'SMTP 登录密码或授权码', type: 'text' },
      { key: 'smtp_from', label: '发件人', desc: '发件人邮箱地址', type: 'text' },
      { key: 'smtp_secure', label: 'SSL/TLS', desc: '使用安全连接', type: 'switch' },
      { key: 'smtp_test', label: '测试发送', desc: '保存当前 SMTP 配置和模板后发送一封测试邮件', type: 'email-test' },
      {
        key: 'email_templates',
        label: '邮件模板',
        desc: '编辑各业务场景的邮件标题、正文和变量占位符',
        type: 'textarea',
      },
    ],
  },
  {
    title: '法律条款',
    icon: 'description',
    items: [
      {
        key: 'legal_privacy_updated_at',
        label: '隐私声明更新时间',
        desc: '显示在隐私声明标题下方，如：2026 年 4 月',
        type: 'text',
      },
      {
        key: 'legal_privacy_sections',
        label: '隐私声明正文',
        desc: '维护 /legal/privacy 页面的正式条款章节，前台按书面文档格式展示',
        type: 'textarea',
      },
      {
        key: 'legal_terms_updated_at',
        label: '用户协议更新时间',
        desc: '显示在用户协议标题下方，如：2026 年 4 月',
        type: 'text',
      },
      {
        key: 'legal_terms_sections',
        label: '用户协议正文',
        desc: '维护 /legal/terms 页面的正式协议章节，适合放账号、权限、资料使用等规则',
        type: 'textarea',
      },
    ],
  },
  {
    title: '系统运维',
    icon: 'build',
    items: [
      {
        key: 'maintenance_enabled',
        label: '手动维护页',
        desc: '用于数据恢复、系统升级、资源重建等全站维护场景，管理员和后台不受影响',
        type: 'switch',
      },
      {
        key: 'maintenance_auto_enabled',
        label: '重建自动维护',
        desc: '转换队列待处理数量达到阈值时自动显示维护页',
        type: 'switch',
      },
      {
        key: 'maintenance_auto_queue_threshold',
        label: '自动触发阈值',
        desc: '待处理转换任务达到该数量后显示维护页',
        type: 'number',
        min: 1,
        max: 100000,
      },
      { key: 'maintenance_title', label: '维护标题', desc: '维护页主标题', type: 'text' },
      { key: 'maintenance_message', label: '维护说明', desc: '维护页说明文字', type: 'textarea' },
      {
        key: 'conversion_worker_concurrency',
        label: '转换并发数',
        desc: '同时处理的模型转换任务数量，建议先设为 2；大模型较多时过高会占满 CPU 和内存',
        type: 'number',
        min: 1,
        max: 8,
      },
      {
        key: 'api_rate_limit',
        label: 'API 限速 (15分钟)',
        desc: '每个 IP 在 15 分钟内允许的最大请求数，修改后需重启服务生效',
        type: 'number',
        min: 100,
        max: 100000,
      },
      {
        key: 'backup_auto_enabled',
        label: '自动每日备份',
        desc: '开启后服务端每天按设定时间自动创建一次企业级校验备份',
        type: 'switch',
      },
      {
        key: 'backup_schedule_time',
        label: '自动备份时间',
        desc: '24小时制，例如 03:00。建议选择业务低峰期',
        type: 'text',
      },
      {
        key: 'backup_retention_count',
        label: '保留备份份数',
        desc: '自动清理更早的备份，建议至少保留 7 份',
        type: 'number',
        min: 1,
        max: 60,
      },
      {
        key: 'backup_mirror_enabled',
        label: '外部镜像备份',
        desc: '备份成功后自动复制一份到外部目录，建议挂载到独立磁盘或 NAS',
        type: 'switch',
      },
      {
        key: 'backup_mirror_dir',
        label: '外部镜像目录',
        desc: '服务器上的绝对路径，如 /mnt/backup/3dparthub 或 /Volumes/Backup/3dparthub',
        type: 'text',
      },
    ],
  },
];

const SETTINGS_NAV_GROUPS = [
  {
    title: '基础设置',
    icon: 'tune',
    sections: ['站点与品牌', '外观与主题', '系统公告', '菜单配置', '法律条款'],
  },
  {
    title: '访问与安全',
    icon: 'shield',
    sections: ['访问控制', '安全防护'],
  },
  {
    title: '业务内容',
    icon: 'inventory_2',
    sections: ['下载与分享', '3D 预览', '选型设置', '业务字典', '上传与限制', '邮件服务'],
  },
  {
    title: '缓存与云存储',
    icon: 'database',
    sections: [...CACHE_STORAGE_SECTION_TITLES, '缓存清理'],
  },
  {
    title: '运维维护',
    icon: 'build',
    sections: ['系统运维', '数据备份'],
  },
] as const;

type SettingItemSection = {
  title: string;
  items: SettingItem[];
};

function splitSettingGroupSections(group: SettingGroup): SettingItemSection[] {
  const sections: SettingItemSection[] = [];
  let current: SettingItemSection = { title: '基础设置', items: [] };
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
  { key: 'general', label: '通用', icon: 'tune' },
  { key: 'edge', label: '边线', icon: 'content_cut' },
  { key: 'measure', label: '测量', icon: 'straighten' },
  { key: 'light', label: '灯光', icon: 'light_mode' },
  { key: 'material', label: '材质', icon: 'palette' },
];

const MAT_PRESET_OPTIONS: { value: MaterialPresetKey; label: string }[] = [
  { value: 'original', label: '原色' },
  { value: 'default', label: '智能灰' },
  { value: 'metal', label: '金属' },
  { value: 'plastic', label: '塑料' },
  { value: 'glass', label: '玻璃' },
];

const PREVIEW_TAB_ITEMS: Record<Exclude<PreviewSubtab, 'material'>, SystemSettingItem[]> = {
  general: [
    {
      key: 'viewer_default_preset',
      label: '默认材质预设',
      desc: '打开模型详情页时默认使用的材质风格',
      type: 'select',
      options: MAT_PRESET_OPTIONS,
    },
    { key: 'viewer_visible_presets', label: '__preset_checkboxes__', desc: '', type: 'text' },
  ],
  edge: [
    { key: 'viewer_edge_enabled', label: '显示边线', desc: '关闭后模型默认不叠加实体边线', type: 'switch' },
    {
      key: 'viewer_edge_threshold_angle',
      label: '边线角度',
      desc: '数值越小边线越多，模型更清晰但更耗性能',
      type: 'range',
      min: 1,
      max: 89,
      step: 1,
    },
    {
      key: 'viewer_edge_vertex_limit',
      label: '边线顶点上限',
      desc: '顶点超过该数量时跳过边线叠加，0 表示不限制',
      type: 'number',
      min: 0,
      max: 5000000,
    },
    { key: 'viewer_edge_color', label: '边线颜色', desc: '3D 模型边线叠加的颜色', type: 'color' },
    {
      key: 'viewer_edge_opacity',
      label: '边线透明度',
      desc: '1.0 = 完全不透明，0.1 = 几乎透明',
      type: 'range',
      min: 0.1,
      max: 1.0,
      step: 0.05,
    },
    {
      key: 'viewer_edge_width',
      label: '边线宽度',
      desc: '1 = 标准细线，数值越大线越粗',
      type: 'range',
      min: 1,
      max: 5,
      step: 0.1,
    },
  ],
  measure: [
    {
      key: 'viewer_measure_default_unit',
      label: '测量默认单位',
      desc: '测量工具打开时默认使用的单位',
      type: 'select',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'mm', label: '毫米 mm' },
        { value: 'cm', label: '厘米 cm' },
        { value: 'm', label: '米 m' },
      ],
    },
    {
      key: 'viewer_measure_record_limit',
      label: '测量记录数量',
      desc: '测量面板最多保留最近多少条记录',
      type: 'range',
      min: 1,
      max: 100,
      step: 1,
    },
  ],
  light: [
    {
      key: 'viewer_exposure',
      label: '曝光度',
      desc: '场景整体亮度，1.0 为标准曝光',
      type: 'range',
      min: 0.1,
      max: 3.0,
      step: 0.05,
    },
    {
      key: 'viewer_ambient_intensity',
      label: '环境光强度',
      desc: '场景全局填充光，影响整体基础亮度',
      type: 'range',
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    {
      key: 'viewer_main_light_intensity',
      label: '主灯强度',
      desc: '主要定向光源，决定模型主体明暗对比',
      type: 'range',
      min: 0,
      max: 3.0,
      step: 0.05,
    },
    {
      key: 'viewer_fill_light_intensity',
      label: '补光强度',
      desc: '对侧柔光，减轻主灯产生的阴影',
      type: 'range',
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    {
      key: 'viewer_hemisphere_intensity',
      label: '半球光强度',
      desc: '天地渐变光，模拟自然天空散射',
      type: 'range',
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    { key: 'viewer_bg_color', label: '背景色', desc: '3D 视图背景，支持纯色或 CSS 渐变', type: 'text' },
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
    { key: 'mat_original_color', label: '颜色', desc: '留空使用模型自带颜色', type: 'color', canEmpty: true },
    {
      key: 'mat_original_metalness',
      label: '金属度',
      desc: '留空使用模型原始值',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      canEmpty: true,
    },
    {
      key: 'mat_original_roughness',
      label: '粗糙度',
      desc: '留空使用模型原始值',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      canEmpty: true,
    },
    {
      key: 'mat_original_envMapIntensity',
      label: '环境反射',
      desc: '留空使用模型原始值',
      type: 'range',
      min: 0,
      max: 3,
      step: 0.01,
      canEmpty: true,
    },
  ],
  default: [
    { key: 'mat_default_color', label: '颜色', desc: '', type: 'color' },
    { key: 'mat_default_metalness', label: '金属度', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_default_roughness', label: '粗糙度', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_default_envMapIntensity', label: '环境反射', desc: '', type: 'range', min: 0, max: 3, step: 0.01 },
  ],
  metal: [
    { key: 'mat_metal_color', label: '颜色', desc: '', type: 'color' },
    { key: 'mat_metal_metalness', label: '金属度', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_metal_roughness', label: '粗糙度', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_metal_envMapIntensity', label: '环境反射', desc: '', type: 'range', min: 0, max: 3, step: 0.01 },
  ],
  plastic: [
    { key: 'mat_plastic_color', label: '颜色', desc: '', type: 'color' },
    { key: 'mat_plastic_metalness', label: '金属度', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_plastic_roughness', label: '粗糙度', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_plastic_envMapIntensity', label: '环境反射', desc: '', type: 'range', min: 0, max: 3, step: 0.01 },
  ],
  glass: [
    { key: 'mat_glass_color', label: '颜色', desc: '', type: 'color' },
    { key: 'mat_glass_metalness', label: '金属度', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_glass_roughness', label: '粗糙度', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_glass_envMapIntensity', label: '环境反射', desc: '', type: 'range', min: 0, max: 3, step: 0.01 },
    { key: 'mat_glass_transmission', label: '透射率', desc: '', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mat_glass_ior', label: '折射率', desc: '', type: 'range', min: 1, max: 2.5, step: 0.01 },
    { key: 'mat_glass_thickness', label: '厚度', desc: '', type: 'range', min: 0, max: 5, step: 0.01 },
  ],
};

// All 3D preview setting keys (used by reset-to-defaults)
const PREVIEW_SETTING_KEYS: (keyof SystemSettings)[] = [
  'viewer_default_preset',
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
  const MAX_DISPLAY_LOGS = 200;
  const displayLogs = (progress.logs || []).slice(-MAX_DISPLAY_LOGS);
  const barColor = PROGRESS_COLORS[color] || color;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1">
        <span>{progress.message || '处理中...'}</span>
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
  return (
    <AdminManagementPage title="系统设置" description="配置平台的全局行为和访问策略">
      <div className="flex min-h-[360px] flex-1">
        <PageRefreshIndicator label="系统设置刷新中" />
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
  return (
    <button
      onClick={disabled ? undefined : () => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${checked ? 'bg-primary-container' : 'bg-outline-variant/30'}`}
      disabled={disabled}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

function InterfaceThemePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
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
                  alt={`${theme.label} 预览`}
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
                <span className="truncate text-sm font-semibold text-on-surface">{theme.label}</span>
                {selected ? <Icon name="check_circle" size={18} className="text-primary" /> : null}
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-on-surface-variant">{theme.description}</p>
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
    <a href="{{siteUrl}}" style="display:inline-flex;align-items:center;gap:12px;text-decoration:none;color:#111827;">
      <img src="{{siteLogo}}" alt="{{siteTitle}}" style="height:36px;max-width:160px;object-fit:contain;border:0;vertical-align:middle;" />
      <strong style="font-size:18px;line-height:1.2;">{{siteTitle}}</strong>
    </a>
  </div>
  <div style="padding:28px;">`;

const emailShellEnd = `  </div>
  <div style="padding:18px 28px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px;line-height:1.7;">
    <div><a href="{{siteUrl}}" style="color:#f97316;text-decoration:none;">{{siteUrl}}</a></div>
    <div>如需帮助，请联系 {{contactEmail}}</div>
    <div>&copy; {{currentYear}} {{siteTitle}}</div>
  </div>
</div>`;

const commonEmailTokens = ['siteTitle', 'siteLogo', 'siteUrl', 'contactEmail', 'currentYear', 'email'];

const DEFAULT_EMAIL_TEMPLATES: Record<string, EmailTemplateConfig> = {
  register_verify: {
    label: '注册邮箱验证码',
    description: '用户注册账号时发送验证码',
    subject: '{{siteTitle}} 注册验证码',
    html: `${emailShellStart}
  <h2 style="margin:0 0 18px;color:#111827;">注册验证码</h2>
  <p style="margin:0 0 12px;font-size:15px;">您的注册验证码为：</p>
  <div style="margin:18px 0;padding:18px;border-radius:10px;background:#fff7ed;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#f97316;">{{code}}</div>
  <p style="margin:0;color:#6b7280;font-size:13px;">验证码 {{expireMinutes}} 分钟内有效，请勿泄露给他人。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'code', 'expireMinutes'],
  },
  smtp_test: {
    label: '邮件服务测试',
    description: '管理员在系统设置中测试 SMTP 配置',
    subject: '{{siteTitle}} 邮件测试',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;color:#f97316;">邮件服务测试成功</h2>
  <p style="margin:0 0 10px;">这是一封来自 {{siteTitle}} 的测试邮件。</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">发送时间：{{testTime}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'testTime'],
  },
  inquiry_submitted: {
    label: '询价提交通知',
    description: '用户提交询价后发送确认或通知',
    subject: '{{siteTitle}} 已收到您的询价 {{inquiryNo}}',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价已提交</h2>
  <p style="margin:0 0 10px;">您好 {{username}}，我们已收到您的询价。</p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">我们会尽快处理并与您联系。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'inquiryNo'],
  },
  inquiry_status_changed: {
    label: '询价状态变更',
    description: '询价状态更新时通知用户',
    subject: '{{siteTitle}} 询价 {{inquiryNo}} 状态已更新',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价状态已更新</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">当前状态：<strong>{{statusLabel}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">您可以登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'inquiryNo', 'statusLabel'],
  },
  ticket_created: {
    label: '工单创建通知',
    description: '用户提交技术支持工单后发送确认',
    subject: '{{siteTitle}} 已收到您的工单',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">工单已创建</h2>
  <p style="margin:0 0 10px;">您好 {{username}}，您的工单已进入处理队列。</p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">我们会尽快回复。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'ticketTitle'],
  },
  ticket_replied: {
    label: '工单回复通知',
    description: '管理员回复工单时通知用户',
    subject: '{{siteTitle}} 您的工单有新回复',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">工单有新回复</h2>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看完整内容。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'ticketTitle', 'replyPreview'],
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
  if (key === 'storage_upload_concurrency') return '并发';
  if (key === 'image_thumbnail_quality') return '%';
  if (key === 'image_large_max_width') return 'px';
  if (key.includes('_seconds')) return '秒';
  if (key.includes('_days')) return '天';
  if (key.includes('_hour')) return '点';
  if (key.includes('_limit') || key.includes('_count')) return key === 'daily_download_limit' ? '次/天' : '个';
  if (key.includes('_length')) return '位';
  if (key === 'viewer_edge_threshold_angle') return '度';
  if (key === 'viewer_edge_vertex_limit') return '顶点';
  if (key === 'smtp_port') return '端口';
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
  return {
    ...policy,
    modelFormats: Array.from(new Set(parseCsv(policy.modelFormats).map((item) => item.toLowerCase()))),
    modelMaxSizeMb: clampNumber(policy.modelMaxSizeMb, DEFAULT_UPLOAD_POLICY.modelMaxSizeMb, 1, 102400),
    chunkSizeMb: clampNumber(policy.chunkSizeMb, DEFAULT_UPLOAD_POLICY.chunkSizeMb, 1, 1024),
    chunkThresholdMb: clampNumber(policy.chunkThresholdMb, DEFAULT_UPLOAD_POLICY.chunkThresholdMb, 1, 102400),
    optionImageMaxSizeMb: clampNumber(policy.optionImageMaxSizeMb, DEFAULT_UPLOAD_POLICY.optionImageMaxSizeMb, 1, 100),
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
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        title="上移"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className="w-7 h-7 inline-flex items-center justify-center rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <Icon name="expand_less" size={16} />
      </button>
      <button
        type="button"
        title="下移"
        disabled={index === total - 1}
        onClick={() => onMove(1)}
        className="w-7 h-7 inline-flex items-center justify-center rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <Icon name="expand_more" size={16} />
      </button>
      <button
        type="button"
        title="删除"
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
            value={item.value}
            onChange={(e) => patch(index, { value: e.target.value })}
            placeholder="状态值，如 submitted"
            className={inputClass}
          />
          <input
            value={item.label}
            onChange={(e) => patch(index, { label: e.target.value })}
            placeholder="显示名称"
            className={inputClass}
          />
          <input
            value={item.color || ''}
            onChange={(e) => patch(index, { color: e.target.value })}
            placeholder="文字色 class"
            className={inputClass}
          />
          <input
            value={item.bg || ''}
            onChange={(e) => patch(index, { bg: e.target.value })}
            placeholder="背景色 class"
            className={inputClass}
          />
          <div className="flex items-center gap-3 px-1">
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <input
                type="checkbox"
                checked={item.tab === true}
                onChange={(e) => patch(index, { tab: e.target.checked })}
                className="accent-[var(--color-primary-container)]"
              />
              标签页
            </label>
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <input
                type="checkbox"
                checked={item.terminal === true}
                onChange={(e) => patch(index, { terminal: e.target.checked })}
                className="accent-[var(--color-primary-container)]"
              />
              终态
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
        label="添加状态"
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
            value={item.value}
            onChange={(e) => patch(index, { value: e.target.value })}
            placeholder="分类值"
            className={inputClass}
          />
          <input
            value={item.label}
            onChange={(e) => patch(index, { label: e.target.value })}
            placeholder="显示名称"
            className={inputClass}
          />
          <input
            value={item.icon}
            onChange={(e) => patch(index, { icon: e.target.value })}
            placeholder="图标名"
            className={inputClass}
          />
          <input
            value={item.desc}
            onChange={(e) => patch(index, { desc: e.target.value })}
            placeholder="说明"
            className={inputClass}
          />
          <label className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
            <input
              type="checkbox"
              checked={item.enabled !== false}
              onChange={(e) => patch(index, { enabled: e.target.checked })}
              className="accent-[var(--color-primary-container)]"
            />
            启用
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
        label="添加分类"
        onClick={() => update([...items, { value: '', label: '', icon: 'category', desc: '', enabled: true }])}
      />
    </div>
  );
}

function SupportStepsEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
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
            value={item.icon}
            onChange={(e) => patch(index, { icon: e.target.value })}
            placeholder="图标名"
            className={inputClass}
          />
          <input
            value={item.title}
            onChange={(e) => patch(index, { title: e.target.value })}
            placeholder="标题"
            className={inputClass}
          />
          <input
            value={item.desc}
            onChange={(e) => patch(index, { desc: e.target.value })}
            placeholder="说明"
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
        label="添加流程"
        onClick={() => update([...items, { icon: 'check_circle', title: '', desc: '' }])}
      />
    </div>
  );
}

const NAV_PRESETS: Record<string, { label: string; icon: string; path: string; roles?: ('USER' | 'ADMIN')[] }[]> = {
  all: [
    { label: '模型库', icon: 'dashboard', path: '/' },
    { label: '产品选型', icon: 'tune', path: '/selection' },
    { label: '产品图库', icon: 'image', path: '/product-wall' },
    { label: '规格查询', icon: 'straighten', path: '/thread-size' },
    { label: '我的收藏', icon: 'star', path: '/favorites' },
    { label: '我的分享', icon: 'share', path: '/my-shares' },
    { label: '下载历史', icon: 'download', path: '/downloads' },
    { label: '我的询价', icon: 'request_quote', path: '/my-inquiries' },
    { label: '我的工单', icon: 'assignment_add', path: '/my-tickets' },
    { label: '技术支持', icon: 'support_agent', path: '/support' },
    { label: '模型管理', icon: 'view_in_ar', path: '/admin/models', roles: ['ADMIN'] },
    { label: '分类管理', icon: 'folder', path: '/admin/categories', roles: ['ADMIN'] },
    { label: '选型管理', icon: 'tune', path: '/admin/selections', roles: ['ADMIN'] },
    { label: '询价管理', icon: 'receipt_long', path: '/admin/inquiries', roles: ['ADMIN'] },
    { label: '工单处理', icon: 'build', path: '/admin/tickets', roles: ['ADMIN'] },
    { label: '用户管理', icon: 'group', path: '/admin/users', roles: ['ADMIN'] },
    { label: '分享管理', icon: 'share', path: '/admin/shares', roles: ['ADMIN'] },
    { label: '下载统计', icon: 'download', path: '/admin/downloads', roles: ['ADMIN'] },
    { label: '操作日志', icon: 'schedule', path: '/admin/audit', roles: ['ADMIN'] },
    { label: '系统设置', icon: 'settings', path: '/admin/settings', roles: ['ADMIN'] },
  ],
  mobile: [
    { label: '首页', icon: 'dashboard', path: '/' },
    { label: '选型', icon: 'tune', path: '/selection' },
    { label: '收藏', icon: 'star', path: '/favorites' },
    { label: '工单', icon: 'assignment_add', path: '/my-tickets' },
    { label: '我的', icon: 'person', path: '/profile' },
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
        <span>名称</span>
        <span>图标</span>
        <span>页面路径</span>
        <span className="w-10 text-center">启用</span>
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
                title={adminOnly ? '仅管理员可见' : '所有用户可见'}
                className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${adminOnly ? 'text-amber-600' : 'text-green-600'}`}
              >
                <Icon name={adminOnly ? 'admin_panel_settings' : 'visibility'} size={12} />
                {adminOnly ? '管理员' : '用户'}
              </span>
            </div>
            {/* Desktop: drag handle */}
            <div className={`hidden xl:flex items-center justify-center ${dragHandleClass}`}>
              <Icon name="grip_vertical" size={16} />
            </div>
            <label className="space-y-0.5 xl:hidden">
              <span className="text-[10px] text-on-surface-variant">名称</span>
              <input
                value={item.label}
                onChange={(e) => patch(index, { label: e.target.value })}
                placeholder="菜单名称"
                className={inputClass}
              />
            </label>
            <label className="space-y-0.5 xl:hidden">
              <span className="text-[10px] text-on-surface-variant">图标</span>
              <IconPicker value={item.icon} onChange={(v) => patch(index, { icon: v })} />
            </label>
            <label className="space-y-0.5 xl:hidden">
              <span className="text-[10px] text-on-surface-variant">页面路径</span>
              <select
                value={item.path}
                onChange={(e) => patch(index, { path: e.target.value })}
                className={`${inputClass} truncate`}
              >
                {!isPreset && <option value={item.path}>{item.path}（自定义）</option>}
                {presets.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {/* Desktop inline */}
            <input
              value={item.label}
              onChange={(e) => patch(index, { label: e.target.value })}
              placeholder="菜单名称"
              className={`${inputClass} hidden xl:block`}
            />
            <div className="hidden xl:block">
              <IconPicker value={item.icon} onChange={(v) => patch(index, { icon: v })} />
            </div>
            <div className="hidden xl:flex items-center gap-2">
              <select
                value={item.path}
                onChange={(e) => patch(index, { path: e.target.value })}
                className={`${inputClass} truncate flex-1`}
              >
                {!isPreset && <option value={item.path}>{item.path}（自定义）</option>}
                {presets.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span
                title={adminOnly ? '仅管理员可见' : '所有用户可见'}
                className={`inline-flex items-center gap-0.5 text-[10px] font-medium whitespace-nowrap ${adminOnly ? 'text-amber-600' : 'text-green-600'}`}
              >
                <Icon name={adminOnly ? 'admin_panel_settings' : 'visibility'} size={12} />
                {adminOnly ? '管理员' : '用户'}
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
              <input
                type="checkbox"
                checked={item.enabled !== false}
                onChange={(e) => patch(index, { enabled: e.target.checked })}
                className="accent-[var(--color-primary-container)]"
              />
              <span className="xl:hidden">启用</span>
            </label>
            <button
              type="button"
              title="删除"
              onClick={() => update(items.filter((_: NavItemConfig, i: number) => i !== index))}
              className="w-6 h-6 inline-flex items-center justify-center rounded-md text-on-surface-variant/40 hover:text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
      <AddRowButton
        label="添加菜单"
        onClick={() => update([...items, { label: '', icon: 'circle', path: '/', enabled: true }])}
      />
    </div>
  );
}

function UploadPolicyEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const policy = { ...DEFAULT_UPLOAD_POLICY, ...parseSetting<Partial<UploadPolicy>>(settings.upload_policy, {}) };
  const update = (changes: Partial<UploadPolicy>) =>
    setJsonSetting(updateSetting, 'upload_policy', { ...policy, ...changes });

  return (
    <div className={`w-full max-w-4xl ${compactPanelClass}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">模型上传</span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">选型导入</span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">工单附件</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">模型格式</span>
          <input
            value={policy.modelFormats.join(', ')}
            onChange={(e) => update({ modelFormats: parseCsv(e.target.value) })}
            placeholder="step, stp, x_t, xt"
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">模型大小上限 MB</span>
          <input
            type="number"
            min={1}
            value={policy.modelMaxSizeMb}
            onChange={(e) => update({ modelMaxSizeMb: toNumber(e.target.value, policy.modelMaxSizeMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">分片大小 MB</span>
          <input
            type="number"
            min={1}
            value={policy.chunkSizeMb}
            onChange={(e) => update({ chunkSizeMb: toNumber(e.target.value, policy.chunkSizeMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">启用分片阈值 MB</span>
          <input
            type="number"
            min={1}
            value={policy.chunkThresholdMb}
            onChange={(e) => update({ chunkThresholdMb: toNumber(e.target.value, policy.chunkThresholdMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">选型图片上限 MB</span>
          <input
            type="number"
            min={1}
            value={policy.optionImageMaxSizeMb}
            onChange={(e) => update({ optionImageMaxSizeMb: toNumber(e.target.value, policy.optionImageMaxSizeMb) })}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">选型图片 MIME 规则</span>
          <input
            value={policy.optionImageMimePattern}
            onChange={(e) => update({ optionImageMimePattern: e.target.value })}
            placeholder="image\\/(png|jpe?g|gif|webp)"
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-on-surface-variant">选型导入文件上限 MB</span>
          <input
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
          <span className="text-xs text-on-surface-variant">选型单次导入行数</span>
          <input
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
          <span className="text-xs text-on-surface-variant">选型导入列数上限</span>
          <input
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
          <span className="text-xs text-on-surface-variant">工单附件上限 MB</span>
          <input
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
          <span className="text-xs text-on-surface-variant">工单附件格式</span>
          <input
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
  const policy = {
    ...DEFAULT_PAGE_SIZE_POLICY,
    ...parseSetting<Partial<PageSizePolicy>>(settings.page_size_policy, {}),
  };
  const update = (key: keyof PageSizePolicy, value: number) =>
    setJsonSetting(updateSetting, 'page_size_policy', { ...policy, [key]: value });
  const fields: { key: keyof PageSizePolicy; label: string }[] = [
    { key: 'homeDefault', label: '首页默认条数' },
    { key: 'homeMax', label: '首页接口最大条数' },
    { key: 'homeOption1', label: '首页分页选项 1' },
    { key: 'homeOption2', label: '首页分页选项 2' },
    { key: 'homeOption3', label: '首页分页选项 3' },
    { key: 'homeOption4', label: '首页分页选项 4' },
    { key: 'selectionDefault', label: '选型默认条数' },
    { key: 'selectionMax', label: '选型最大条数' },
    { key: 'selectionAdminRenderBatch', label: '选型后台加载批次' },
    { key: 'selectionGeneratePreviewPageSize', label: '选型生成预览条数' },
    { key: 'inquiryAdminDefault', label: '询价后台默认条数' },
    { key: 'inquiryAdminMax', label: '询价后台最大条数' },
    { key: 'ticketListMax', label: '工单列表最大条数' },
    { key: 'notificationDefault', label: '通知默认条数' },
    { key: 'notificationMax', label: '通知最大条数' },
    { key: 'adminUserDefault', label: '用户后台默认条数' },
    { key: 'adminUserMax', label: '用户后台最大条数' },
    { key: 'shareAdminDefault', label: '分享后台默认条数' },
    { key: 'shareAdminMax', label: '分享后台最大条数' },
    { key: 'auditDefault', label: '日志默认条数' },
    { key: 'auditMax', label: '日志最大条数' },
    { key: 'userBatchDownloadMax', label: '用户批量下载上限' },
    { key: 'adminBatchDownloadMax', label: '后台批量下载上限' },
  ];

  return (
    <div className={`w-full max-w-4xl ${compactPanelClass}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">选型后台</span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">通知/用户/分享</span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">操作日志</span>
        <span className="rounded-full bg-primary-container/10 px-2 py-1 text-primary-container">批量下载</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {fields.map((field) => (
          <label key={field.key} className="space-y-1">
            <span className="text-xs text-on-surface-variant">{field.label}</span>
            <input
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
            value={row.prefix}
            onChange={(e) =>
              updateRows(rows.map((item, i) => (i === index ? { ...item, prefix: e.target.value } : item)))
            }
            placeholder="前缀，如 R / G / NPT"
            className={inputClass}
          />
          <input
            type="number"
            value={row.rank}
            onChange={(e) =>
              updateRows(
                rows.map((item, i) => (i === index ? { ...item, rank: toNumber(e.target.value, item.rank) } : item)),
              )
            }
            placeholder="排序权重"
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
      <AddRowButton label="添加前缀" onClick={() => updateRows([...rows, { prefix: '', rank: rows.length }])} />
    </div>
  );
}

function FooterLinksEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const links = normalizeFooterLinks(settings.footer_links);
  const update = (next: FooterLinkConfig[]) =>
    setJsonSetting(updateSetting, 'footer_links', normalizeFooterLinks(next));
  const patch = (index: number, changes: Partial<FooterLinkConfig>) =>
    update(links.map((link, i) => (i === index ? { ...link, ...changes } : link)));

  return (
    <div className="w-full max-w-5xl space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
        <div className={`${compactPanelClass} space-y-1.5`}>
          <p className="text-xs font-semibold text-on-surface">友情链接区块</p>
          <p className="text-[11px] leading-5 text-on-surface-variant">
            添加后会在前台页脚归入“相关链接”。保存时会自动过滤空行，避免无效链接出现在页面上。
          </p>
        </div>
        <div className={`${compactPanelClass} space-y-1.5`}>
          <p className="text-xs font-semibold text-on-surface">页脚版权</p>
          <p className="text-[11px] font-medium text-on-surface">
            {settings.footer_copyright_follow_site_title
              ? resolveFooterCopyright(settings)
              : settings.footer_copyright || DEFAULT_FOOTER_COPYRIGHT}
          </p>
          <p className="text-[11px] leading-5 text-on-surface-variant">
            可选择跟随网站名称自动生成，也可以关闭开关后手动编辑。
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {links.length === 0 ? (
          <div className={`${compactPanelClass} text-xs text-on-surface-variant`}>暂无友情链接，可以从下方添加。</div>
        ) : (
          links.map((link, index) => (
            <div
              key={`footer-link-${index}`}
              className={`grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 ${compactPanelClass}`}
            >
              <input
                value={link.label}
                onChange={(e) => patch(index, { label: e.target.value })}
                placeholder="链接文字"
                className={inputClass}
              />
              <input
                value={link.url}
                onChange={(e) => patch(index, { url: e.target.value })}
                placeholder="/about 或 https://example.com"
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
      <AddRowButton label="添加友情链接" onClick={() => update([...links, { label: '', url: '' }])} />
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
          <p className="text-xs font-semibold text-on-surface">正式条款文档 · {sections.length} 个章节</p>
          <p className="text-[11px] text-on-surface-variant">
            左侧选择章节，右侧编辑标题和正文；正文换行会在前台拆成自然段。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addSection}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary-container/15 px-2.5 text-xs font-medium text-primary-container transition-colors hover:bg-primary-container/25"
          >
            <Icon name="add" size={14} />
            添加章节
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
            恢复默认
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
                <span className="min-w-0 flex-1 truncate font-medium">{section.title || '未命名章节'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">第 {safeActiveIndex + 1} 条</p>
              <p className="text-xs text-on-surface-variant">当前章节会同步出现在前台目录中，可点击目录跳转。</p>
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
              <span className="text-xs font-medium text-on-surface-variant">章节标题</span>
              <input
                value={activeSection.title}
                onChange={(e) => patch(safeActiveIndex, { title: e.target.value })}
                placeholder="例如：定义与适用主体"
                className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2.5 border border-outline-variant/20 outline-none focus:border-primary"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-on-surface-variant">章节正文</span>
              <textarea
                value={activeSection.content}
                onChange={(e) => patch(safeActiveIndex, { content: e.target.value })}
                placeholder="每一行或空行会作为前台自然段展示，适合维护正式条款内容。"
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
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  testing: boolean;
  changed: boolean;
  saving: boolean;
  settings: SystemSettings;
}) {
  const smtpReady = Boolean(settings.smtp_host && settings.smtp_user && settings.smtp_pass);
  const from = settings.smtp_from || settings.smtp_user || '未设置';
  return (
    <div className="w-full max-w-6xl">
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 rounded-lg border border-outline-variant/10 bg-surface-container-high/25 p-3">
        <div className="flex items-center gap-3 min-w-0 xl:w-72 shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${smtpReady ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface truncate">
              {smtpReady ? 'SMTP 配置已具备测试条件' : 'SMTP 配置还不完整'}
            </p>
            <p className="text-xs text-on-surface-variant truncate">发件人 {from}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1 text-xs">
          <span className="h-10 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2.5 min-w-0 whitespace-nowrap leading-none">
            <span className="text-on-surface-variant shrink-0">服务器</span>
            <span className="text-on-surface font-medium truncate max-w-40">{settings.smtp_host || '未配置'}</span>
          </span>
          <span className="h-10 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2.5 whitespace-nowrap leading-none">
            <span className="text-on-surface-variant">端口</span>
            <span className="text-on-surface font-medium">{settings.smtp_port || 465}</span>
          </span>
          <span className="h-10 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2.5 whitespace-nowrap leading-none">
            <span className="text-on-surface-variant">连接</span>
            <span className="text-on-surface font-medium">{settings.smtp_secure ? 'SSL/TLS' : 'STARTTLS'}</span>
          </span>
          <span className="h-10 inline-flex items-center gap-1 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 px-2.5 whitespace-nowrap leading-none">
            <span className="text-on-surface-variant">模板</span>
            <span className="text-on-surface font-medium">smtp_test</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(220px,320px)_auto] gap-2 xl:ml-auto shrink-0">
          <input
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
            {testing ? '发送中...' : changed ? '保存并测试' : '发送测试'}
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
            {testing ? testingLabel : changed ? '保存并测试' : buttonLabel}
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
  const rows: { label: string; key: keyof SystemSettings; policy: string; note: string }[] = [
    {
      label: '图片原图',
      key: 'storage_image_prefix',
      policy: settings.image_cdn_enabled ? '公开缓存 / CDN' : '公开访问',
      note: '站点图片、模型原图',
    },
    {
      label: '缩略图',
      key: 'storage_thumbnail_prefix',
      policy: settings.image_cdn_enabled ? '公开缓存 / CDN' : '公开访问',
      note: '首页、模型卡片、产品图库列表',
    },
    {
      label: '模型文件',
      key: 'storage_model_prefix',
      policy: settings.storage_signed_url_enabled ? '私有签名下载' : '后端鉴权下载',
      note: 'STEP/STP/IGES/XT 等模型资源',
    },
    {
      label: '原始文件',
      key: 'storage_original_prefix',
      policy: settings.storage_signed_url_enabled ? '私有签名访问' : '不建议公开',
      note: '上传源文件和转换源',
    },
    {
      label: '图纸文件',
      key: 'storage_drawing_prefix',
      policy: settings.storage_signed_url_enabled ? '私有签名下载' : '后端鉴权下载',
      note: 'PDF、工程图、说明文档',
    },
    {
      label: '产品图库',
      key: 'storage_product_wall_prefix',
      policy: settings.image_cdn_enabled ? '公开缓存 / CDN' : '公开访问',
      note: '图库原图、批量导入图片',
    },
    {
      label: '沟通附件',
      key: 'storage_attachment_prefix',
      policy: settings.storage_signed_url_enabled ? '私有签名访问' : '后端鉴权访问',
      note: '工单、询价、用户附件',
    },
    {
      label: '备份文件',
      key: 'storage_backup_prefix',
      policy: '管理员访问',
      note: '数据库备份、资源备份、更新包',
    },
    {
      label: '临时目录',
      key: 'storage_temp_prefix',
      policy: '不参与同步',
      note: '分片上传、转换中间文件',
    },
  ];

  return (
    <div className="w-full max-w-6xl rounded-lg border border-outline-variant/10 bg-surface-container-high/20 p-3">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-container-lowest text-primary">
          <Icon name="folder_open" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">目录与访问策略说明</p>
          <p className="mt-0.5 text-xs leading-5 text-on-surface-variant">
            本地存储对应 server/static 下的目录；云存储使用相同对象前缀，方便迁移、同步和 CDN 配置。
          </p>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-outline-variant/10">
        <div className="grid grid-cols-[88px_minmax(0,1fr)_112px] gap-0 bg-surface-container text-xs font-semibold text-on-surface-variant sm:grid-cols-[120px_minmax(0,1fr)_140px_minmax(0,1fr)]">
          <div className="px-3 py-2">资源</div>
          <div className="px-3 py-2">目录 / 前缀</div>
          <div className="px-3 py-2">策略</div>
          <div className="hidden px-3 py-2 sm:block">说明</div>
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
      return '排队中';
    case 'running':
      return '同步中';
    case 'done':
      return '已完成';
    case 'cancelled':
      return '已停止';
    case 'error':
      return '失败';
    default:
      return '未开始';
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
  const { toast } = useToast();
  const [payload, setPayload] = useState<StorageSyncStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [direction, setDirection] = useState<StorageSyncDirection>('local_to_cloud');
  const [selectedScopeKeys, setSelectedScopeKeys] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(true);
  const [deleteExtraneous, setDeleteExtraneous] = useState(false);

  async function refreshStatus(silent = false) {
    if (!silent) setLoading(true);
    try {
      const next = await getStorageSyncStatus();
      setPayload(next);
      setSelectedScopeKeys((current) => {
        if (current.length > 0) return current;
        return next.scopes.map((scope) => scope.key);
      });
    } catch (err: any) {
      if (!silent) toast(err.message || '同步状态加载失败', 'error');
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
      toast('请先开启“启用同步工具”并保存设置', 'error');
      return;
    }
    if (selectedScopeKeys.length === 0) {
      toast('请选择至少一个同步目录', 'error');
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
      toast('同步任务已开始');
    } catch (err: any) {
      toast(err.message || '同步任务启动失败', 'error');
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
      toast('同步任务已停止');
    } catch (err: any) {
      toast(err.message || '停止同步失败', 'error');
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
      toast('同步记录已删除');
    } catch (err: any) {
      toast(err.message || '删除同步记录失败', 'error');
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
                {activeJob ? activeJob.message || '正在同步资源' : latestJob?.message || '暂无正在运行的同步任务'}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {activeJob || latestJob
                  ? `${storageSyncStatusLabel((activeJob || latestJob)?.status)} · ${formatStorageSyncTime((activeJob || latestJob)?.startedAt)}`
                  : '可按资源目录执行本地与云端同步'}
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
              刷新
            </button>
            {activeJob ? (
              <button
                type="button"
                onClick={handleCancel}
                disabled={working}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-error-container px-3 text-xs font-semibold text-error transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Icon name="stop_circle" size={14} />
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={disabled || selectedScopeKeys.length === 0}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary-container px-4 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Icon name={working ? 'progress_activity' : 'play_arrow'} size={14} />
                开始同步
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
              <span>进度 {Math.round((activeJob || latestJob)?.percent || 0)}%</span>
              <span>
                文件 {(activeJob || latestJob)?.processedFiles || 0}/{(activeJob || latestJob)?.totalFiles || 0}
              </span>
              <span>
                体积 {(activeJob || latestJob)?.processedBytesText || '0 B'}/
                {(activeJob || latestJob)?.totalBytesText || '0 B'}
              </span>
              <span>失败 {(activeJob || latestJob)?.failedFiles || 0}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-lg border border-outline-variant/10 bg-surface-container-high/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-on-surface">同步目录</p>
            <button
              type="button"
              onClick={() =>
                setSelectedScopeKeys((current) =>
                  current.length === scopes.length ? [] : scopes.map((scope) => scope.key),
                )
              }
              className="text-xs font-medium text-primary hover:underline"
            >
              {selectedScopeKeys.length === scopes.length ? '取消全选' : '全选'}
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
                    <span className="block truncate text-xs font-semibold">{scope.label}</span>
                    <span className="block truncate text-[11px] font-mono opacity-70">{scope.prefix || '-'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-outline-variant/10 bg-surface-container-high/20 p-3">
          <div>
            <p className="mb-2 text-sm font-semibold text-on-surface">方向</p>
            <div className="grid gap-2">
              {[
                { value: 'local_to_cloud', label: '本地 → 云端', icon: 'cloud_upload' },
                { value: 'cloud_to_local', label: '云端 → 本地', icon: 'cloud_download' },
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
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-xs text-on-surface">
            覆盖同名文件
            <Switch checked={overwrite} onChange={setOverwrite} />
          </label>
          <label
            className={`flex items-center justify-between gap-3 text-xs ${
              canDeleteExtra ? 'text-on-surface' : 'text-on-surface-variant/50'
            }`}
          >
            删除目标端多余文件
            <Switch
              checked={canDeleteExtra && deleteExtraneous}
              onChange={setDeleteExtraneous}
              disabled={!canDeleteExtra}
            />
          </label>
          {!settings.storage_sync_enabled ? (
            <p className="rounded-md bg-yellow-500/10 px-3 py-2 text-xs leading-5 text-yellow-600">
              需要先开启“启用同步工具”并保存设置。
            </p>
          ) : null}
        </div>
      </div>

      {payload?.jobs?.length ? (
        <div className="rounded-lg border border-outline-variant/10 bg-surface-container-high/20">
          <div className="flex items-center justify-between gap-2 border-b border-outline-variant/10 px-3 py-2">
            <p className="text-sm font-semibold text-on-surface">最近同步记录</p>
            <span className="text-xs text-on-surface-variant">{payload.jobs.length} 条</span>
          </div>
          <div className="divide-y divide-outline-variant/5">
            {payload.jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-on-surface">
                    {job.direction === 'local_to_cloud' ? '本地到云端' : '云端到本地'} ·{' '}
                    {storageSyncStatusLabel(job.status)}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">
                    {formatStorageSyncTime(job.startedAt)} · 复制 {job.copiedFiles} · 跳过 {job.skippedFiles} · 删除{' '}
                    {job.deletedFiles} · 失败 {job.failedFiles}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(job)}
                  disabled={working || activeJob?.id === job.id}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-error-container/10 hover:text-error disabled:opacity-40"
                >
                  <Icon name="delete" size={14} />
                  删除记录
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderEmailSample(source: string, settings: SystemSettings) {
  const vars: Record<string, string> = {
    siteTitle: settings.site_title || '3DPartHub',
    siteLogo: settings.site_logo || `${window.location.origin}/favicon.svg`,
    siteUrl: window.location.origin,
    contactEmail: settings.contact_email || settings.smtp_from || settings.smtp_user || 'support@example.com',
    currentYear: String(new Date().getFullYear()),
    email: 'test@example.com',
    code: '826419',
    expireMinutes: '10',
    testTime: new Date().toLocaleString('zh-CN', { hour12: false }),
    username: '客户',
    inquiryNo: 'INQ-20260427-001',
    statusLabel: '处理中',
    ticketTitle: '模型下载问题',
    replyPreview: '我们已收到您的问题，正在进一步确认。',
  };
  return source.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => vars[key] ?? '');
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
          html: legacyHtml ? fallback.html : item.html || fallback.html,
          tokens: Array.from(new Set([...(fallback.tokens || []), ...((item.tokens as string[] | undefined) || [])])),
        },
      ];
    }),
  ) as Record<string, EmailTemplateConfig>;
}

function EmailTemplatesEditor({
  settings,
  updateSetting,
}: {
  settings: SystemSettings;
  updateSetting: SettingUpdater;
}) {
  const templates = getEmailTemplates(settings);
  const keys = Object.keys(templates);
  const [activeKey, setActiveKey] = useState(keys[0] || 'register_verify');
  const active = templates[activeKey] || templates[keys[0]];
  const previewSubject = active ? renderEmailSample(active.subject, settings) : '';
  const previewHtml = active ? renderEmailSample(active.html, settings) : '';
  const update = (next: Record<string, EmailTemplateConfig>) => setJsonSetting(updateSetting, 'email_templates', next);
  const patch = (key: string, changes: Partial<EmailTemplateConfig>) =>
    update({
      ...templates,
      [key]: { ...templates[key], ...changes },
    });
  const resetActive = () => {
    if (!DEFAULT_EMAIL_TEMPLATES[activeKey]) return;
    patch(activeKey, DEFAULT_EMAIL_TEMPLATES[activeKey]);
  };

  return (
    <div className="w-full max-w-6xl rounded-lg border border-outline-variant/10 bg-surface-container-high/20 overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] min-h-[620px]">
        <div className="border-b xl:border-b-0 xl:border-r border-outline-variant/10 bg-surface-container-high/35">
          <div className="p-4 border-b border-outline-variant/10">
            <p className="text-sm font-semibold text-on-surface">邮件模板</p>
            <p className="text-xs text-on-surface-variant mt-1">按业务场景维护标题、正文和变量。</p>
          </div>
          <div className="p-2 space-y-1">
            {keys.map((key) => {
              const item = templates[key];
              const activeItem = key === activeKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveKey(key)}
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
                    {activeKey}
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
                恢复默认
              </button>
            </div>

            <div className="grid grid-cols-1 2xl:grid-cols-[1.1fr_0.9fr] gap-4 p-4">
              <div className="space-y-4 min-w-0">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-on-surface-variant">邮件标题</span>
                  <input
                    value={active.subject}
                    onChange={(e) => patch(activeKey, { subject: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2.5 border border-outline-variant/20 outline-none focus:border-primary"
                  />
                </label>

                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-on-surface-variant">可用变量</span>
                  <div className="flex flex-wrap gap-1.5 rounded-md bg-surface-container-lowest/60 border border-outline-variant/10 p-2">
                    {(active.tokens || []).map((token) => (
                      <button
                        key={token}
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(`{{${token}}}`)}
                        className="text-[10px] px-2 py-1 rounded bg-primary-container/10 text-primary-container hover:bg-primary-container/20 transition-colors font-mono"
                        title="点击复制"
                      >
                        {`{{${token}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-on-surface-variant">HTML 正文</span>
                  <textarea
                    value={active.html}
                    onChange={(e) => patch(activeKey, { html: e.target.value })}
                    rows={18}
                    spellCheck={false}
                    className="w-full bg-surface-container-lowest text-on-surface text-xs leading-5 rounded-md px-3 py-3 border border-outline-variant/20 outline-none focus:border-primary resize-y font-mono"
                  />
                </label>
              </div>

              <div className="space-y-2 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-on-surface-variant">预览</span>
                  <span className="text-[10px] text-on-surface-variant">已用示例数据预览</span>
                </div>
                <div className="rounded-md border border-outline-variant/10 bg-white overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
                    <p className="text-[11px] text-slate-500">Subject</p>
                    <p className="text-sm text-slate-900 truncate">{previewSubject}</p>
                  </div>
                  <iframe
                    title={`${active.label} 预览`}
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
}: {
  itemKey: keyof SystemSettings;
  settings: SystemSettings;
  updateSetting: SettingUpdater;
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
      return <EmailTemplatesEditor settings={settings} updateSetting={updateSetting} />;
    default:
      return null;
  }
}

function Content() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingCache, setTestingCache] = useState(false);
  const [testingStorage, setTestingStorage] = useState(false);
  const [cacheTestResult, setCacheTestResult] = useState<SettingsConnectivityResult | null>(null);
  const [storageTestResult, setStorageTestResult] = useState<SettingsConnectivityResult | null>(null);
  const [activeTab, setActiveTab] = useState(GROUPS[0]?.title || '访问控制');
  const [previewSubtab, setPreviewSubtab] = useState<PreviewSubtab>('general');
  const [matPresetEdit, setMatPresetEdit] = useState<MaterialPresetKey>('default');
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Backup state
  const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
  const [backupHealth, setBackupHealth] = useState<BackupHealth | null>(null);
  const [backupPolicyCheck, setBackupPolicyCheck] = useState<BackupPolicyCheck | null>(null);
  const [checkingBackupPolicy, setCheckingBackupPolicy] = useState(false);
  const [verifyingBackupId, setVerifyingBackupId] = useState<string | null>(null);
  const [backupList, setBackupList] = useState<BackupRecord[]>([]);
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
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [backupDeleteConfirm, setBackupDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ stage: '', percent: 0, message: '', logs: [] as string[] });
  const backupInputRef = useRef<HTMLInputElement>(null);
  const backupActionInFlight = useRef(false);
  const restoreActionInFlight = useRef(false);
  const importActionInFlight = useRef(false);
  const verifyActionInFlight = useRef(false);
  const policyCheckInFlight = useRef(false);
  const jobToastKeys = useRef<Set<string>>(new Set());

  // Cleanup state
  const [cleanupScan, setCleanupScan] = useState<CleanupScanResult | null>(null);
  const [cleanupScanning, setCleanupScanning] = useState(false);
  const [cleanupSelectedKeys, setCleanupSelectedKeys] = useState<Set<string>>(new Set());
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);

  // Global busy state — prevent concurrent admin operations
  const adminBusy = exporting || importing || restoring || !!verifyingBackupId;

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
    toastJobOnce('backup-create', jobId, '备份创建成功');
  }

  function toastRestoreSuccessOnce(
    jobId: string | null | undefined,
    result: { modelCount: number; thumbnailCount: number },
  ) {
    toastJobOnce(
      'backup-restore',
      jobId,
      `恢复成功：${result.modelCount} 个 STEP 模型，${result.thumbnailCount} 张缩略图`,
    );
  }

  function toastImportSaveSuccessOnce(jobId?: string | null) {
    toastJobOnce('backup-import-save', jobId, '备份文件已保存到备份记录列表');
  }

  function toastVerifySuccessOnce(jobId: string | null | undefined, message?: string) {
    toastJobOnce('backup-verify', jobId, message || '备份校验通过');
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
          message: activeBackup.message || '正在恢复备份任务...',
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
        prev.stage ? prev : { stage: 'resuming', percent: 0, message: '正在恢复备份任务...', logs: [] },
      );
      try {
        await pollBackupProgress(backupJobId, (stage, percent, message, logs) => {
          setExportProgress({ stage, percent, message, logs: logs || [] });
        });
        toastBackupCreatedOnce(backupJobId);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      } catch (err: any) {
        toast(err.message || '备份任务失败', 'error');
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
          message: activeRestore.message || '正在恢复备份恢复任务...',
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
              message: savedBackupId ? '正在恢复备份记录...' : '正在恢复导入任务...',
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
      } catch (err: any) {
        toast(err.message || '恢复失败', 'error');
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
          message: activeImportSave.message || '正在恢复导入保存任务...',
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
        prev.stage ? prev : { stage: 'resuming', percent: 0, message: '正在恢复导入保存任务...', logs: [] },
      );
      try {
        await pollImportSaveProgress(importSaveJobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toastImportSaveSuccessOnce(importSaveJobId);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      } catch (err: any) {
        toast(err.message || '导入保存失败', 'error');
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
          message: activeVerify.message || '正在恢复校验任务...',
          logs: activeVerify.logs || [],
        });
        try {
          const result = await pollVerifyBackupProgress(activeVerify.id, (stage, percent, message, logs) => {
            setVerifyProgress({ stage, percent, message, logs: logs || [] });
          });
          toastVerifySuccessOnce(activeVerify.id, result.message);
          loadBackupList();
          loadBackupHealth();
        } catch (err: any) {
          toast(err.message || '备份校验失败', 'error');
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
      toast('加载设置失败', 'error');
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
      if (result.status === 'ok') toast('备份策略体检通过', 'success');
      else if (result.status === 'warning') toast('备份策略体检有警告，请查看详情', 'info');
      else toast('备份策略体检发现错误，请查看详情', 'error');
      loadBackupHealth();
    } catch (err: any) {
      toast(err.message || '备份策略体检失败', 'error');
    } finally {
      policyCheckInFlight.current = false;
      setCheckingBackupPolicy(false);
    }
  }

  async function handleVerifyBackup(id: string) {
    if (verifyActionInFlight.current) return;
    verifyActionInFlight.current = true;
    setVerifyingBackupId(id);
    setVerifyProgress({ stage: 'queued', percent: 0, message: '正在准备校验备份...', logs: [] });
    try {
      const jobId = await startVerifyBackupJob(id);
      const result = await pollVerifyBackupProgress(jobId, (stage, percent, message, logs) => {
        setVerifyProgress({ stage, percent, message, logs: logs || [] });
      });
      toastVerifySuccessOnce(jobId, result.message);
      loadBackupList();
      loadBackupHealth();
    } catch (err: any) {
      toast(err.response?.data?.message || err.message || '备份校验失败', 'error');
    } finally {
      verifyActionInFlight.current = false;
      setVerifyingBackupId(null);
      setVerifyProgress({ stage: '', percent: 0, message: '', logs: [] });
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const normalizedSettings = normalizeSettingsForSave(settings);
      if (JSON.stringify(normalizedSettings) !== JSON.stringify(settings)) {
        setSettings(normalizedSettings);
      }
      const data = await updateSettings(normalizedSettings);
      setSettings(normalizeSettingsForClient({ ...normalizedSettings, ...data }));
      setChanged(false);
      // Refresh site config: re-fetch settings, apply title/logo/favicon, notify components
      const { refreshSiteConfig } = await import('../lib/publicSettings');
      await refreshSiteConfig();
      loadBackupHealth();
      toast('设置已保存', 'success');
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveCurrentSettingsSilently() {
    const normalizedSettings = normalizeSettingsForSave(settings);
    if (JSON.stringify(normalizedSettings) !== JSON.stringify(settings)) {
      setSettings(normalizedSettings);
    }
    const data = await updateSettings(normalizedSettings);
    setSettings(normalizeSettingsForClient({ ...normalizedSettings, ...data }));
    setChanged(false);
    const { refreshSiteConfig } = await import('../lib/publicSettings');
    await refreshSiteConfig();
  }

  function updateSetting(key: keyof SystemSettings, value: boolean | number | string) {
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
    toast('已恢复为默认设置，点击保存生效', 'success');
  }

  async function handleSendTestEmail() {
    if (!testEmailTo.trim()) {
      toast('请输入测试收件邮箱', 'error');
      return;
    }
    setTestingEmail(true);
    try {
      if (changed) {
        const normalizedSettings = normalizeSettingsForSave(settings);
        const nextSettings = await updateSettings(normalizedSettings);
        setSettings(normalizeSettingsForClient({ ...normalizedSettings, ...nextSettings }));
        setChanged(false);
      }
      await sendTestEmail(testEmailTo.trim());
      toast('测试邮件已发送', 'success');
    } catch (err: any) {
      toast(err.response?.data?.detail || err.message || '测试邮件发送失败', 'error');
    } finally {
      setTestingEmail(false);
    }
  }

  function readConnectivityError(err: any, fallback: string): SettingsConnectivityResult {
    const payload = err?.response?.data;
    if (isConnectivityResult(payload)) return payload;
    return {
      ok: false,
      status: 'error',
      message: err?.response?.data?.message || err?.response?.data?.detail || err?.message || fallback,
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
    } catch (err: any) {
      const result = readConnectivityError(err, '缓存测试失败');
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
    } catch (err: any) {
      const result = readConnectivityError(err, '存储测试失败');
      setStorageTestResult(result);
      toast(result.message, 'error');
    } finally {
      setTestingStorage(false);
    }
  }

  async function handleImageUpload(key: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadImage(file, key);
      setSettings((prev) => ({ ...prev, [key]: url }));
      setChanged(true);
      toast('图片已上传，请保存设置', 'success');
    } catch {
      toast('上传失败', 'error');
    } finally {
      setUploading(false);
      if (imageInputRefs.current[key]) imageInputRefs.current[key]!.value = '';
    }
  }

  async function handleExport() {
    if (backupActionInFlight.current) return;
    backupActionInFlight.current = true;
    setExporting(true);
    setExportProgress({ stage: 'dumping', percent: 0, message: '正在准备...', logs: [] });
    try {
      const jobId = await startBackupJob();
      localStorage.setItem('backupJobId', jobId);
      await pollBackupProgress(jobId, (stage, percent, message, logs) => {
        setExportProgress({ stage, percent, message, logs: logs || [] });
      });
      toastBackupCreatedOnce(jobId);
      localStorage.removeItem('backupJobId');
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
    } catch (err: any) {
      if (err.jobId) {
        toast('已有备份任务正在进行中，已恢复进度显示', 'info');
        localStorage.setItem('backupJobId', err.jobId);
        try {
          await pollBackupProgress(err.jobId, (stage, percent, message, logs) => {
            setExportProgress({ stage, percent, message, logs: logs || [] });
          });
          toastBackupCreatedOnce(err.jobId);
          loadBackupList();
          loadBackupStats();
          loadBackupHealth();
        } catch (pollErr: any) {
          toast(pollErr.message || '查询备份进度失败', 'error');
        } finally {
          localStorage.removeItem('backupJobId');
        }
      } else {
        localStorage.removeItem('backupJobId');
        toast(err.message || '导出失败', 'error');
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
        toast('当前已是最新版本', 'success');
      }
    } catch {
      toast('检查更新失败', 'error');
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function loadBackupList() {
    try {
      const list = await listBackups();
      setBackupList(list);
    } catch {
      // Backup list load failure — user can still use the page
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
    if (!file.name.endsWith('.tar.gz') && !file.name.endsWith('.tgz')) {
      toast('请选择 .tar.gz 格式的备份文件', 'error');
      return;
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
        const isLarge = restoreConfirmFile.size >= 100 * 1024 * 1024;
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
        const jobId = await importBackup(restoreConfirmFile, (p) => {
          setUploadProgress(p);
        });
        localStorage.setItem('restoreJobId', jobId);
        localStorage.setItem(RESTORE_JOB_SOURCE_KEY, 'import-file');
        setRestoreProgress({ stage: 'uploading', percent: 100, message: '上传完成，正在恢复...', logs: [] });
        const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toastRestoreSuccessOnce(jobId, result);
        setRestoreConfirmFile(null);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      }
    } catch (err: any) {
      toast(err.message || '操作失败', 'error');
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
      toast('获取服务器文件列表失败', 'error');
    } finally {
      setLoadingServerFiles(false);
    }
  }

  async function handleServerFileImport(file: ServerBackupFile) {
    if (importActionInFlight.current) return;
    importActionInFlight.current = true;
    setServerFileConfirm(null);
    setImporting(true);
    setRestoreProgress({ stage: 'starting', percent: 0, message: '正在从服务器路径恢复...', logs: [] });
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
    } catch (err: any) {
      toast(err.message || '恢复失败', 'error');
    } finally {
      localStorage.removeItem('restoreJobId');
      localStorage.removeItem(RESTORE_JOB_SOURCE_KEY);
      importActionInFlight.current = false;
      setImporting(false);
      setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
    }
  }

  async function handleDownloadBackup(id: string) {
    try {
      await downloadBackup(id);
    } catch {
      toast('下载失败', 'error');
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    try {
      await renameBackup(id, renameValue.trim());
      setRenamingId(null);
      setRenameValue('');
      loadBackupList();
      toast('已重命名', 'success');
    } catch {
      toast('重命名失败', 'error');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBackup(id);
      setBackupDeleteConfirm(null);
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
      toast('已删除', 'success');
    } catch {
      toast('删除失败', 'error');
    }
  }

  function handleRestoreRequest(id: string) {
    setRestoreConfirmId(id);
  }

  async function handleRestoreConfirm() {
    if (!restoreConfirmId) return;
    if (restoreActionInFlight.current) return;
    restoreActionInFlight.current = true;
    setRestoring(true);
    setRestoreProgress({ stage: 'starting', percent: 0, message: '正在启动恢复...', logs: [] });
    try {
      const jobId = await startRestore(restoreConfirmId);
      localStorage.setItem('restoreJobId', jobId);
      localStorage.setItem('restoreConfirmBackupId', restoreConfirmId);
      localStorage.setItem(RESTORE_JOB_SOURCE_KEY, 'backup-record');
      const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
        setRestoreProgress({ stage, percent, message, logs: logs || [] });
      });
      toastRestoreSuccessOnce(jobId, result);
      setRestoreConfirmId(null);
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
    } catch (err: any) {
      toast(err.message || '恢复失败', 'error');
    } finally {
      localStorage.removeItem('restoreJobId');
      localStorage.removeItem('restoreConfirmBackupId');
      localStorage.removeItem(RESTORE_JOB_SOURCE_KEY);
      restoreActionInFlight.current = false;
      setRestoring(false);
      setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
    }
  }

  async function handleCleanupSelectedConfirm() {
    if (cleanupSelectedKeys.size === 0 || cleanupRunning) return;
    setCleanupConfirmOpen(false);
    setCleanupRunning(true);
    try {
      const result = await executeCleanup(Array.from(cleanupSelectedKeys));
      toast(
        `清理完成：删除 ${result.deletedCount} 个文件，释放 ${result.freedSizeText}${
          result.failedCount > 0 ? `，${result.failedCount} 个文件删除失败` : ''
        }`,
        result.failedCount > 0 ? 'info' : 'success',
      );
      setCleanupSelectedKeys(new Set());
      const newScan = await scanCleanup();
      setCleanupScan(newScan);
    } catch (err: any) {
      toast(err.message || '清理失败', 'error');
    } finally {
      setCleanupRunning(false);
    }
  }

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
    { title: '数据备份', icon: 'cloud_upload' },
    { title: '缓存清理', icon: 'cleaning_services' },
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
  const tabItems = tabs.map((tab) => ({ value: tab.title, label: tab.title, icon: tab.icon }));
  const tabItemMap = new Map(tabItems.map((tab) => [tab.value, tab]));
  const navGroups = SETTINGS_NAV_GROUPS.map((group) => ({
    ...group,
    sections: group.sections
      .map((section) => tabItemMap.get(section))
      .filter((section): section is (typeof tabItems)[number] => Boolean(section)),
  })).filter((group) => group.sections.length > 0);
  const activeNavGroup =
    navGroups.find((group) => group.sections.some((section) => section.value === resolvedActiveTab)) || navGroups[0];
  const primaryTabItems = navGroups.map((group) => ({ value: group.title, label: group.title, icon: group.icon }));
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
        className={`hidden items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs md:inline-flex ${changed ? 'text-amber-500' : 'text-on-surface-variant'}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${changed ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        {changed ? '有未保存修改' : '当前配置已保存'}
      </span>
      <button
        onClick={handleSave}
        disabled={!changed || saving}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3.5 text-xs font-bold text-on-primary shadow-sm transition-all hover:-translate-y-px hover:opacity-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none md:h-8"
      >
        <Icon name="save" size={14} />
        {saving ? '保存中...' : '保存设置'}
      </button>
    </div>
  );
  const settingsHeaderNavigation = (
    <ResponsiveSectionTabs
      tabs={primaryTabItems}
      value={activeNavGroup?.title || primaryTabItems[0]?.value || ''}
      onChange={handlePrimaryTabChange}
      mobileTitle="设置分组"
      mobileTriggerVariant="surface"
      desktopVariant="prominent"
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
          mobileTitle="设置项"
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
        mobileTitle="设置分组"
        mobileTriggerVariant="surface"
      />
      {secondarySettingsNavigation}
    </div>
  );

  return (
    <>
      <AdminManagementPage
        title="系统设置"
        description="配置平台的全局行为和访问策略"
        actions={headerActions}
        headerNavigation={settingsHeaderNavigation}
        contentClassName="min-h-0 overflow-hidden"
      >
        <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 md:grid-rows-[auto_minmax(0,1fr)]">
          {mobileSettingsPicker}
          <div className="hidden min-w-0 md:block">{secondarySettingsNavigation}</div>
          <AdminContentPanel scroll className="h-full overflow-hidden">
            <div className="h-full overflow-y-auto overflow-x-hidden p-4 custom-scrollbar">
              <div key={resolvedActiveTab} className="admin-tab-panel flex flex-col gap-4">
                {activeContentGroup
                  ? [activeContentGroup].map((group) => {
                      const is3DPreview = group.title === '3D 预览';

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
                                    {tab.label}
                                  </button>
                                ))}
                              </div>
                              <button
                                onClick={handleReset3DPreview}
                                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface shrink-0 ml-2"
                              >
                                <Icon name="restart_alt" size={14} />
                                恢复默认
                              </button>
                            </div>

                            <div className="divide-y divide-outline-variant/5">
                              {/* Material tab: dropdown + dynamic fields */}
                              {previewSubtab === 'material' ? (
                                <>
                                  <div className="px-4 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-3 lg:gap-6 lg:items-center">
                                    <div className="min-w-0 max-w-2xl">
                                      <p className="text-sm font-medium text-on-surface">选择预设</p>
                                      <p className="text-xs text-on-surface-variant mt-0.5">选择要编辑的材质预设方案</p>
                                    </div>
                                    <select
                                      value={matPresetEdit}
                                      onChange={(e) => setMatPresetEdit(e.target.value as MaterialPresetKey)}
                                      className="w-full lg:max-w-sm bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                                    >
                                      {MAT_PRESET_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
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
                                            {field.label}
                                            {field.canEmpty && !isEmpty && (
                                              <button
                                                onClick={() => updateSetting(field.key, '')}
                                                className="ml-2 text-[10px] text-error hover:underline"
                                              >
                                                重置
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
                                              type="text"
                                              value={(val as string) || ''}
                                              onChange={(e) => updateSetting(field.key, e.target.value)}
                                              placeholder={field.canEmpty ? '留空 = 使用模型原色' : '#FF6600'}
                                              className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 font-mono"
                                            />
                                            <input
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
                                                {isEmpty ? '使用模型原色' : '自定义覆盖'}
                                              </span>
                                            </div>
                                            {!isEmpty && (
                                              <div className="flex items-center gap-3">
                                                <input
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
                                                {item.label === '__preset_checkboxes__' ? '可见预设' : item.label}
                                              </p>
                                              <p className="text-xs text-on-surface-variant mt-0.5">
                                                {item.label === '__preset_checkboxes__'
                                                  ? '勾选要在模型查看器工具栏中显示的材质预设'
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
                                                      {opt.label}
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            ) : (
                                              structuredEditor ||
                                              (item.type === 'switch' ? (
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
                                                      alt="预览"
                                                      className={`${item.key === 'site_icon' || item.key === 'site_favicon' ? 'h-12 w-12' : 'h-12 w-32'} object-contain bg-surface-container-lowest rounded border border-outline-variant/20`}
                                                      fallbackIcon="image"
                                                    />
                                                  )}
                                                  <div className="flex items-center gap-2">
                                                    <input
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
                                                      disabled={uploading}
                                                      className="px-3 py-1.5 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 disabled:opacity-50 transition-colors"
                                                    >
                                                      {uploading
                                                        ? '上传中...'
                                                        : settings[item.key]
                                                          ? '更换图片'
                                                          : '上传图片'}
                                                    </button>
                                                    {settings[item.key] && (
                                                      <button
                                                        onClick={() => {
                                                          updateSetting(item.key, '');
                                                        }}
                                                        className="px-2 py-1.5 text-xs text-error hover:bg-error-container/10 rounded-md transition-colors"
                                                      >
                                                        移除
                                                      </button>
                                                    )}
                                                  </div>
                                                </div>
                                              ) : item.type === 'number' ? (
                                                <div className="flex items-center gap-2 min-w-0 lg:justify-self-start">
                                                  <input
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
                                                    value={settings[item.key] as string}
                                                    onChange={(e) => updateSetting(item.key, e.target.value)}
                                                    placeholder={item.desc}
                                                    rows={3}
                                                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 resize-y font-mono"
                                                  />
                                                </div>
                                              ) : item.type === 'select' ? (
                                                <select
                                                  value={settings[item.key] as string}
                                                  onChange={(e) => updateSetting(item.key, e.target.value)}
                                                  className="w-full lg:max-w-sm bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                                                >
                                                  {item.options?.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                      {opt.label}
                                                    </option>
                                                  ))}
                                                </select>
                                              ) : item.type === 'color' ? (
                                                <div className="flex items-center gap-2 w-full lg:max-w-sm lg:justify-self-start">
                                                  {settings[item.key] && (
                                                    <span
                                                      className="w-6 h-6 rounded-md border border-outline-variant/30 shrink-0"
                                                      style={{ backgroundColor: settings[item.key] as string }}
                                                    />
                                                  )}
                                                  <input
                                                    type="text"
                                                    value={settings[item.key] as string}
                                                    onChange={(e) => updateSetting(item.key, e.target.value)}
                                                    placeholder="#FF6600"
                                                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 font-mono"
                                                  />
                                                  <input
                                                    type="color"
                                                    value={(settings[item.key] as string) || '#000000'}
                                                    onChange={(e) => updateSetting(item.key, e.target.value)}
                                                    className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                                                  />
                                                </div>
                                              ) : (
                                                <input
                                                  type={isSensitiveTextSettingKey(item.key) ? 'password' : 'text'}
                                                  value={settings[item.key] as string}
                                                  onChange={(e) => updateSetting(item.key, e.target.value)}
                                                  placeholder={item.desc}
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
                                      {item._section}
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
                                        <p className="text-sm font-medium text-on-surface">{item.label}</p>
                                        <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
                                      </div>
                                      {structuredEditor ||
                                        (item.type === 'email-test' ? (
                                          <EmailTestPanel
                                            value={testEmailTo}
                                            onChange={setTestEmailTo}
                                            onSend={handleSendTestEmail}
                                            testing={testingEmail}
                                            changed={changed}
                                            saving={saving}
                                            settings={settings}
                                          />
                                        ) : item.type === 'cache-test' ? (
                                          <SettingsConnectivityTestPanel
                                            icon="memory"
                                            title="执行 Redis 真实读写测试"
                                            summary="会先保存当前设置，再执行 PING、写入、读取和删除测试键"
                                            buttonLabel="测试 Redis"
                                            testingLabel="测试中..."
                                            testing={testingCache}
                                            changed={changed}
                                            saving={saving}
                                            result={cacheTestResult}
                                            onRun={handleTestCacheSettings}
                                          />
                                        ) : item.type === 'storage-test' ? (
                                          <SettingsConnectivityTestPanel
                                            icon="storage"
                                            title="执行存储真实读写测试"
                                            summary="会先保存当前设置，再写入、读取并删除一个临时对象"
                                            buttonLabel="测试存储"
                                            testingLabel="测试中..."
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
                                                alt="预览"
                                                className={`${item.key === 'site_icon' || item.key === 'site_favicon' ? 'h-12 w-12' : 'h-12 w-32'} object-contain bg-surface-container-lowest rounded border border-outline-variant/20`}
                                                fallbackIcon="image"
                                              />
                                            )}
                                            <div className="flex items-center gap-2">
                                              <input
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
                                                disabled={uploading}
                                                className="px-3 py-1.5 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 disabled:opacity-50 transition-colors"
                                              >
                                                {uploading ? '上传中...' : settings[item.key] ? '更换图片' : '上传图片'}
                                              </button>
                                              {settings[item.key] && (
                                                <button
                                                  onClick={() => {
                                                    updateSetting(item.key, '');
                                                  }}
                                                  className="px-2 py-1.5 text-xs text-error hover:bg-error-container/10 rounded-md transition-colors"
                                                >
                                                  移除
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        ) : item.type === 'number' ? (
                                          <div className="flex items-center gap-2 min-w-0 lg:justify-self-start">
                                            <input
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
                                              value={settings[item.key] as string}
                                              onChange={(e) => updateSetting(item.key, e.target.value)}
                                              placeholder={item.desc}
                                              rows={3}
                                              className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 resize-y font-mono"
                                            />
                                            {item.key === 'allowed_hosts' && typeof window !== 'undefined' && (
                                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                                <span className="text-xs text-on-surface-variant">当前访问域名：</span>
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
                                                  加入授权
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        ) : item.type === 'select' ? (
                                          <select
                                            value={settings[item.key] as string}
                                            onChange={(e) => updateSetting(item.key, e.target.value)}
                                            className="w-full lg:max-w-sm bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                                          >
                                            {item.options?.map((opt) => (
                                              <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                              </option>
                                            ))}
                                          </select>
                                        ) : item.type === 'color' ? (
                                          <div className="flex items-center gap-2 w-full lg:max-w-sm lg:justify-self-start">
                                            {settings[item.key] && (
                                              <span
                                                className="w-6 h-6 rounded-md border border-outline-variant/30 shrink-0"
                                                style={{ backgroundColor: settings[item.key] as string }}
                                              />
                                            )}
                                            <input
                                              type="text"
                                              value={settings[item.key] as string}
                                              onChange={(e) => updateSetting(item.key, e.target.value)}
                                              placeholder="#FF6600"
                                              className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 font-mono"
                                            />
                                            <input
                                              type="color"
                                              value={(settings[item.key] as string) || '#000000'}
                                              onChange={(e) => updateSetting(item.key, e.target.value)}
                                              className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                                            />
                                          </div>
                                        ) : (
                                          <input
                                            type={isSensitiveTextSettingKey(item.key) ? 'password' : 'text'}
                                            value={
                                              copyrightInputLocked
                                                ? generatedCopyrightValue
                                                : (settings[item.key] as string)
                                            }
                                            onChange={(e) => {
                                              if (!copyrightInputLocked) updateSetting(item.key, e.target.value);
                                            }}
                                            placeholder={item.desc}
                                            disabled={copyrightInputLocked}
                                            className={`w-full lg:max-w-md bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 ${
                                              copyrightInputLocked
                                                ? 'cursor-not-allowed text-on-surface-variant/70 border-outline-variant/10 bg-surface-container-high/40'
                                                : ''
                                            }`}
                                          />
                                        ))}
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

                {activeTab === '数据备份' && (
                  <>
                    {/* Data Backup Section */}
                    <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
                      <div className="divide-y divide-outline-variant/5">
                        {/* Backup health */}
                        {backupHealth && (
                          <div className="px-4 py-4 sm:px-6">
                            <div
                              className={`rounded-lg border p-4 ${
                                backupHealth.status === 'ok'
                                  ? 'bg-green-500/10 border-green-500/20'
                                  : backupHealth.status === 'warning'
                                    ? 'bg-yellow-500/10 border-yellow-500/20'
                                    : 'bg-surface-container-high/40 border-outline-variant/10'
                              }`}
                            >
                              <div className="space-y-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Icon
                                      name={
                                        backupHealth.status === 'ok'
                                          ? 'verified_user'
                                          : backupHealth.status === 'warning'
                                            ? 'warning'
                                            : 'info'
                                      }
                                      size={18}
                                      className={
                                        backupHealth.status === 'ok'
                                          ? 'text-green-500'
                                          : backupHealth.status === 'warning'
                                            ? 'text-yellow-500'
                                            : 'text-on-surface-variant'
                                      }
                                    />
                                    <p className="text-sm font-medium text-on-surface">企业级备份状态</p>
                                  </div>
                                  <p className="text-xs text-on-surface-variant mt-1">{backupHealth.message}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs sm:flex sm:flex-wrap">
                                  <span className="px-2 py-1 rounded bg-surface-container-lowest/70 text-on-surface-variant">
                                    自动备份 {backupHealth.enabled ? `每日 ${backupHealth.scheduleTime}` : '未开启'}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-surface-container-lowest/70 text-on-surface-variant">
                                    保留 {backupHealth.retentionCount} 份
                                  </span>
                                  <span className="px-2 py-1 rounded bg-surface-container-lowest/70 text-on-surface-variant">
                                    共 {backupHealth.backupCount} 份 / {backupHealth.totalSizeText}
                                  </span>
                                  <span className="px-2 py-1 rounded bg-surface-container-lowest/70 text-on-surface-variant">
                                    外部镜像 {backupHealth.mirrorEnabled ? '已开启' : '未开启'}
                                  </span>
                                </div>
                                <button
                                  onClick={handleBackupPolicyCheck}
                                  disabled={checkingBackupPolicy || adminBusy}
                                  className="w-full sm:w-auto px-3 py-2 text-xs font-medium bg-primary-container/15 text-primary-container rounded-md hover:bg-primary-container/25 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                                >
                                  <Icon name="fact_check" size={14} />
                                  {checkingBackupPolicy ? '体检中...' : '策略体检'}
                                </button>
                              </div>
                              <div className="mt-3 grid gap-1 text-xs text-on-surface-variant sm:flex sm:flex-wrap sm:gap-x-4">
                                {backupHealth.latestBackup && (
                                  <span>
                                    最近备份：{new Date(backupHealth.latestBackup.createdAt).toLocaleString('zh-CN')}
                                  </span>
                                )}
                                {backupHealth.nextRunAt && (
                                  <span>下次自动：{new Date(backupHealth.nextRunAt).toLocaleString('zh-CN')}</span>
                                )}
                                {backupHealth.lastAutoMessage && <span>自动任务：{backupHealth.lastAutoMessage}</span>}
                                {backupHealth.mirrorDir && <span>镜像目录：{backupHealth.mirrorDir}</span>}
                                {backupHealth.lastMirrorMessage && (
                                  <span>镜像状态：{backupHealth.lastMirrorMessage}</span>
                                )}
                              </div>
                              {backupPolicyCheck && (
                                <div className="mt-3 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 p-3">
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant mb-2">
                                    <span>
                                      体检时间：{new Date(backupPolicyCheck.checkedAt).toLocaleString('zh-CN')}
                                    </span>
                                    <span>预计备份大小：{backupPolicyCheck.estimatedBackupSizeText}</span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {backupPolicyCheck.checks.map((check) => (
                                      <div key={check.key} className="flex items-start gap-2 text-xs">
                                        <Icon
                                          name={
                                            check.status === 'ok'
                                              ? 'check_circle'
                                              : check.status === 'warning'
                                                ? 'warning'
                                                : 'error'
                                          }
                                          size={14}
                                          className={
                                            check.status === 'ok'
                                              ? 'text-green-500'
                                              : check.status === 'warning'
                                                ? 'text-yellow-500'
                                                : 'text-error'
                                          }
                                        />
                                        <span className="font-medium text-on-surface shrink-0">{check.label}</span>
                                        <span className="text-on-surface-variant break-all">{check.message}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Stats */}
                        <div className="px-4 py-4 sm:px-6">
                          <div className="grid grid-cols-1 gap-2 text-sm sm:flex sm:flex-wrap sm:gap-4">
                            {backupStats && (
                              <>
                                <div className="flex items-center justify-between gap-2 bg-surface-container-high/50 px-3 py-2 sm:py-1.5 rounded-md">
                                  <Icon name="view_in_ar" size={14} className="text-primary-container" />
                                  <span className="text-on-surface-variant">STEP 模型</span>
                                  <span className="font-medium text-on-surface">{backupStats.modelCount} 个</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 bg-surface-container-high/50 px-3 py-2 sm:py-1.5 rounded-md">
                                  <Icon name="wallpaper" size={14} className="text-primary-container" />
                                  <span className="text-on-surface-variant">预览图</span>
                                  <span className="font-medium text-on-surface">{backupStats.thumbnailCount} 张</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 bg-surface-container-high/50 px-3 py-2 sm:py-1.5 rounded-md">
                                  <Icon name="data_usage" size={14} className="text-primary-container" />
                                  <span className="text-on-surface-variant">数据库</span>
                                  <span className="font-medium text-on-surface">{backupStats.dbSize}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Export */}
                        <div className="px-4 py-4 sm:px-6">
                          <div className="flex flex-col gap-3 mb-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                            <div>
                              <p className="text-sm font-medium text-on-surface">创建备份</p>
                              <p className="text-xs text-on-surface-variant mt-0.5">
                                打包数据库、模型文件和缩略图到服务器
                              </p>
                            </div>
                            <button
                              onClick={handleExport}
                              disabled={adminBusy}
                              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 shrink-0"
                            >
                              <Icon name="add" size={14} />
                              {exporting ? `${exportProgress.percent}%` : '创建备份'}
                            </button>
                          </div>
                          {exporting && <TaskProgressCard progress={exportProgress} />}
                        </div>

                        {/* Backup List */}
                        {backupList.length > 0 && (
                          <div className="px-4 py-4 sm:px-6">
                            <p className="text-sm font-medium text-on-surface mb-3">备份记录</p>
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
                                              保存
                                            </button>
                                            <button
                                              onClick={() => {
                                                setRenamingId(null);
                                                setRenameValue('');
                                              }}
                                              className="px-2 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded-md"
                                            >
                                              取消
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-sm font-medium text-on-surface truncate">{b.name}</p>
                                      )}
                                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1.5 text-xs text-on-surface-variant sm:flex sm:flex-wrap sm:gap-x-4">
                                        <span>{new Date(b.createdAt).toLocaleString('zh-CN')}</span>
                                        <span>{b.fileSizeText}</span>
                                        <span>{b.modelCount ?? 0} 个 STEP 模型</span>
                                        <span>{b.thumbnailCount ?? 0} 张预览图</span>
                                        <span>数据库 {b.dbSize}</span>
                                        {b.manifestVersion && <span>清单 v{b.manifestVersion}</span>}
                                        {b.verifiedAt && <span>已校验</span>}
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:flex lg:flex-wrap lg:items-center lg:gap-1.5 lg:shrink-0">
                                      <button
                                        onClick={() => handleRestoreRequest(b.id)}
                                        disabled={adminBusy}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-primary-container/15 text-primary-container rounded-md hover:bg-primary-container/25 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="restore" size={13} />
                                        恢复
                                      </button>
                                      <button
                                        onClick={() => handleDownloadBackup(b.id)}
                                        disabled={adminBusy}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="download" size={13} />
                                        下载
                                      </button>
                                      <button
                                        onClick={() => handleVerifyBackup(b.id)}
                                        disabled={adminBusy || verifyingBackupId === b.id}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="verified" size={13} />
                                        {verifyingBackupId === b.id ? `${verifyProgress.percent}%` : '校验'}
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
                                        重命名
                                      </button>
                                      <button
                                        onClick={() => setBackupDeleteConfirm({ id: b.id, name: b.name })}
                                        disabled={adminBusy}
                                        className="px-2.5 py-2 lg:py-1.5 text-xs font-medium bg-error-container/10 text-error rounded-md hover:bg-error-container/20 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                                      >
                                        <Icon name="delete" size={13} />
                                        删除
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
                                              <p className="text-xs font-medium text-on-surface">确认恢复到此备份？</p>
                                              <p className="text-xs text-error/80 mt-1">
                                                此操作将覆盖当前数据库和模型文件，不可撤销！
                                              </p>
                                              <div className="grid grid-cols-1 gap-2 mt-2 sm:flex">
                                                <button
                                                  onClick={handleRestoreConfirm}
                                                  className="px-3 py-1 text-xs font-medium bg-error text-on-error-container rounded-md hover:opacity-90 transition-opacity"
                                                >
                                                  确认恢复
                                                </button>
                                                <button
                                                  onClick={() => setRestoreConfirmId(null)}
                                                  className="px-3 py-1 text-xs text-on-surface-variant border border-outline-variant/30 rounded-md hover:bg-surface-container-high/50 transition-colors"
                                                >
                                                  取消
                                                </button>
                                              </div>
                                            </>
                                          ) : (
                                            <TaskProgressCard progress={restoreProgress} color="primary" />
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
                              <p className="text-sm font-medium text-on-surface">导入恢复</p>
                              <p className="text-xs text-on-surface-variant mt-0.5">
                                上传备份文件恢复数据（将覆盖当前数据）
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:flex">
                              <input
                                ref={backupInputRef}
                                type="file"
                                onChange={handleBackupFileSelect}
                                className="hidden"
                              />
                              <button
                                onClick={() => backupInputRef.current?.click()}
                                disabled={adminBusy}
                                className="px-4 py-2.5 sm:py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                              >
                                <Icon name="upload" size={14} />
                                本地上传
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
                                服务器文件
                              </button>
                            </div>
                          </div>

                          {importing && (
                            <div className="mt-3">
                              {/* Phase 1: Upload */}
                              {!restoreProgress.message && uploadProgress < 100 && (
                                <TaskProgressCard progress={{ message: '上传中...', percent: uploadProgress }} />
                              )}
                              {/* Phase 2: Server processing */}
                              {(restoreProgress.message || uploadProgress >= 100) && (
                                <TaskProgressCard
                                  progress={{
                                    message: restoreProgress.message || '上传完成，正在处理...',
                                    percent: restoreProgress.message ? restoreProgress.percent : 100,
                                    logs: restoreProgress.logs,
                                  }}
                                />
                              )}
                            </div>
                          )}

                          {/* Server file list */}
                          {loadingServerFiles && (
                            <div className="mt-3 text-xs text-on-surface-variant animate-pulse">
                              正在扫描服务器文件...
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
                                    恢复
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {!loadingServerFiles && serverFilesScanned && serverFiles.length === 0 && (
                            <div className="mt-3 text-xs text-on-surface-variant">未找到服务器上的备份文件</div>
                          )}

                          {/* Server file confirm dialog */}
                          {serverFileConfirm && !importing && (
                            <div className="mt-3 bg-error-container/10 border border-error/20 rounded-md p-4">
                              <div className="flex items-start gap-3">
                                <Icon name="warning" size={20} className="text-error shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-on-surface">确认从服务器文件恢复</p>
                                  <p className="text-xs text-on-surface-variant mt-1">
                                    文件：{serverFileConfirm.name}（{(serverFileConfirm.size / 1024 / 1024).toFixed(1)}{' '}
                                    MB）
                                  </p>
                                  <p className="text-xs text-on-surface-variant mt-0.5 break-all">
                                    路径：{serverFileConfirm.path}
                                  </p>
                                  <div className="mt-3 grid grid-cols-1 gap-2 sm:flex">
                                    <button
                                      onClick={() => handleServerFileImport(serverFileConfirm)}
                                      className="px-4 py-1.5 text-xs font-medium text-on-error bg-error rounded-md hover:bg-error/90 transition-colors"
                                    >
                                      确认恢复（将覆盖当前数据）
                                    </button>
                                    <button
                                      onClick={() => setServerFileConfirm(null)}
                                      className="px-4 py-1.5 text-xs text-on-surface-variant border border-outline-variant/30 rounded-md hover:bg-surface-container-high/50 transition-colors"
                                    >
                                      取消
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
                                  <p className="text-sm font-medium text-on-surface">选择导入方式</p>
                                  <p className="text-xs text-on-surface-variant mt-1">
                                    文件：{restoreConfirmFile.name}（
                                    {(restoreConfirmFile.size / 1024 / 1024).toFixed(1)} MB）
                                  </p>
                                  <div className="mt-3 space-y-2">
                                    <button
                                      onClick={() => handleImport('restore')}
                                      className="w-full text-left px-3 py-2 bg-error/10 border border-error/20 rounded-md hover:bg-error/15 transition-colors"
                                    >
                                      <p className="text-xs font-medium text-error">直接恢复</p>
                                      <p className="text-xs text-on-surface-variant mt-0.5">
                                        立即覆盖当前数据库和模型文件（不可撤销）
                                      </p>
                                    </button>
                                    <button
                                      onClick={() => handleImport('save')}
                                      className="w-full text-left px-3 py-2 bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/15 transition-colors"
                                    >
                                      <p className="text-xs font-medium text-primary">保存到备份列表</p>
                                      <p className="text-xs text-on-surface-variant mt-0.5">
                                        保存后可随时通过「恢复备份」按需恢复
                                      </p>
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => setRestoreConfirmFile(null)}
                                    className="mt-2 px-4 py-1 text-xs text-on-surface-variant border border-outline-variant/30 rounded-md hover:bg-surface-container-high/50 transition-colors"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* System Update — version detection only */}
                        <div className="px-6 py-4 border-t border-outline-variant/10">
                          <div className="flex items-center justify-between gap-4 mb-3">
                            <div>
                              <p className="text-sm font-medium text-on-surface">版本检测</p>
                              <p className="text-xs text-on-surface-variant mt-0.5">
                                当前版本:{' '}
                                <span className="font-mono text-primary-container">
                                  {currentVersion || updateInfo?.current || '—'}
                                </span>
                                {updateInfo &&
                                  !updateInfo.updateAvailable &&
                                  (updateInfo.current || currentVersion) !== 'unknown' && (
                                    <span className="ml-1.5 text-emerald-400">· 已是最新</span>
                                  )}
                                {updateInfo?.updateAvailable && (
                                  <>
                                    {' '}
                                    · 最新版本: <span className="font-mono text-emerald-400">{updateInfo.remote}</span>
                                  </>
                                )}
                              </p>
                            </div>
                            <button
                              onClick={handleCheckUpdate}
                              disabled={checkingUpdate || adminBusy}
                              className="px-4 py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                            >
                              <Icon name="search" size={14} className={checkingUpdate ? 'animate-spin' : ''} />
                              {checkingUpdate ? '检查中...' : '检查更新'}
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
                                  <span className="text-xs font-medium text-primary">发现新版本</span>
                                </div>
                              </div>

                              {/* Release notes */}
                              {updateInfo.releaseNotes && (
                                <div className="px-4 py-3">
                                  <p className="text-xs font-medium text-on-surface mb-2">更新内容</p>
                                  <div className="max-h-48 overflow-y-auto text-xs text-on-surface-variant/80 space-y-0.5 whitespace-pre-line bg-surface-container/50 rounded p-3">
                                    {updateInfo.releaseNotes}
                                  </div>
                                </div>
                              )}

                              {/* Upgrade command */}
                              <div className="px-4 py-3 border-t border-primary/10">
                                <p className="text-xs text-on-surface-variant mb-2">
                                  服务器默认启用自动更新；如需立即更新，执行：
                                </p>
                                <div className="bg-surface-container rounded p-3 font-mono text-xs text-on-surface select-all space-y-1">
                                  <div>cd /opt/3dparthub</div>
                                  <div>
                                    curl -L -o docker-compose.yml
                                    https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
                                  </div>
                                  <div>touch .env</div>
                                  <div>
                                    grep -q '^IMAGE_TAG=' .env && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=latest/' .env ||
                                    echo 'IMAGE_TAG=latest' &gt;&gt; .env
                                  </div>
                                  <div>docker compose pull</div>
                                  <div>docker compose up -d --force-recreate</div>
                                </div>
                                <p className="text-[10px] text-on-surface-variant/50 mt-2">
                                  不要复制 shell 提示符；升级后数据库会自动迁移，请查看日志确认: docker compose logs -f
                                  api
                                </p>
                                {updateInfo.releaseUrl && (
                                  <a
                                    href={updateInfo.releaseUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block mt-2 text-xs text-primary hover:underline"
                                  >
                                    查看 GitHub Release 详情 →
                                  </a>
                                )}
                              </div>
                            </div>
                          )}

                          {updateInfo?.releaseNotes && !updateInfo.updateAvailable && (
                            <div className="mt-2 rounded-md bg-surface-container/60 border border-outline-variant/20 overflow-hidden">
                              <div className="px-4 py-3 border-b border-outline-variant/10">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-xs font-medium text-on-surface">最新版本更新内容</p>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 font-mono">
                                    {updateInfo.remote}
                                  </span>
                                </div>
                              </div>
                              <div className="px-4 py-3">
                                <div className="max-h-48 overflow-y-auto text-xs text-on-surface-variant/80 space-y-0.5 whitespace-pre-line bg-surface-container/50 rounded p-3">
                                  {updateInfo.releaseNotes}
                                </div>
                                {updateInfo.releaseUrl && (
                                  <a
                                    href={updateInfo.releaseUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block mt-2 text-xs text-primary hover:underline"
                                  >
                                    查看 GitHub Release 详情 →
                                  </a>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === '缓存清理' && (
                  <div className="space-y-4">
                    {/* Scan header */}
                    <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <h3 className="text-sm font-semibold text-on-surface">缓存垃圾清理</h3>
                          <p className="text-xs text-on-surface-variant mt-1">
                            扫描磁盘上与数据库记录不匹配的孤立文件、过期临时文件等，释放磁盘空间
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            if (cleanupScanning) return;
                            setCleanupScanning(true);
                            setCleanupScan(null);
                            setCleanupSelectedKeys(new Set());
                            try {
                              const result = await scanCleanup();
                              setCleanupScan(result);
                            } catch (err: any) {
                              toast(err.message || '扫描失败', 'error');
                            } finally {
                              setCleanupScanning(false);
                            }
                          }}
                          disabled={cleanupScanning || cleanupRunning}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-container px-4 text-xs font-bold text-on-primary shadow-sm transition-all hover:-translate-y-px hover:opacity-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none"
                        >
                          <Icon name={cleanupScanning ? 'hourglass_empty' : 'search'} size={14} />
                          {cleanupScanning ? '扫描中...' : '开始扫描'}
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
                              <p className="text-sm font-medium text-on-surface">系统很干净</p>
                              <p className="text-xs text-on-surface-variant mt-0.5">未发现缓存垃圾文件</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Summary */}
                            <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <Icon name="info" size={16} className="text-on-surface-variant" />
                                <span className="text-sm text-on-surface">
                                  发现 <strong>{cleanupScan.totalFiles}</strong> 个垃圾文件，共{' '}
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
                                            {cat.count} 个文件
                                          </span>
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                                            {cat.totalSizeText}
                                          </span>
                                        </div>
                                        {cat.samplePaths.length > 0 && (
                                          <p className="text-xs text-on-surface-variant mt-1 truncate">
                                            示例: {cat.samplePaths.join(', ')}
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
                                  {cleanupSelectedKeys.size === cleanupScan.categories.length ? '取消全选' : '全选'}
                                </button>
                                <button
                                  onClick={() => {
                                    if (cleanupSelectedKeys.size === 0 || cleanupRunning) return;
                                    setCleanupConfirmOpen(true);
                                  }}
                                  disabled={cleanupSelectedKeys.size === 0 || cleanupRunning}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-error/90 px-4 text-xs font-bold text-white shadow-sm transition-all hover:-translate-y-px hover:opacity-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none"
                                >
                                  <Icon name={cleanupRunning ? 'hourglass_empty' : 'delete'} size={14} />
                                  {cleanupRunning ? '清理中...' : `清理选中 (${cleanupSelectedKeys.size})`}
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
        onClose={() => setBackupDeleteConfirm(null)}
        onConfirm={() => {
          if (backupDeleteConfirm) void handleDelete(backupDeleteConfirm.id);
        }}
        title="确认删除备份"
        description={`确定要删除备份「${backupDeleteConfirm?.name || ''}」吗？`}
        confirmLabel="确认删除"
      />
      <ConfirmDialog
        open={cleanupConfirmOpen}
        onClose={() => setCleanupConfirmOpen(false)}
        onConfirm={() => void handleCleanupSelectedConfirm()}
        icon="delete_sweep"
        title="确认清理缓存"
        description={`将清理选中的 ${cleanupSelectedKeys.size} 个分类缓存文件，此操作不可撤销。`}
        confirmLabel={cleanupRunning ? '清理中...' : '清理选中'}
        confirmDisabled={cleanupSelectedKeys.size === 0 || cleanupRunning}
      />
    </>
  );
}

export default function SettingsPage() {
  useDocumentTitle('系统设置');

  return (
    <AdminPageShell>
      <Content />
    </AdminPageShell>
  );
}
