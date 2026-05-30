import type { SystemSettings } from '../api/settings';
import { DEFAULT_INTERFACE_THEME, INTERFACE_THEME_OPTIONS } from '../themes/interfaceThemes/catalog';
import { DEFAULT_MOBILE_THEME, MOBILE_THEME_OPTIONS } from '../themes/mobileThemes/catalog';
import {
  parseSetting,
  type UploadPolicy,
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
} from './businessConfig';
import { DEFAULT_PRIVACY_SECTIONS, DEFAULT_TERMS_SECTIONS, type LegalSection } from './legalContent';
import {
  buildFooterCopyright,
  buildModelDetailCopyright,
  DEFAULT_FOOTER_COPYRIGHT,
  DEFAULT_MODEL_DETAIL_COPYRIGHT,
  DEFAULT_MODEL_DETAIL_DISCLAIMER,
} from './publicSettings';

// ── Constants ──

export const RESTORE_JOB_SOURCE_KEY = 'restoreJobSource';

export const DEFAULT_SETTINGS: SystemSettings = {
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
  storage_sync_enabled: false,
  storage_sync_delete_extra_enabled: false,
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
  auth_modal_enabled: true,
  login_dialog_enabled: true,
  login_dialog_favorites: true,
  login_dialog_downloads: true,
  login_dialog_my_shares: true,
  login_dialog_profile: true,
  login_dialog_support: true,
  login_dialog_my_tickets: true,
  login_dialog_my_inquiries: true,
  login_dialog_projects: true,
};

// ── Types ──

export type SettingItemType =
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

export interface SettingItemBase {
  label: string;
  desc: string;
  options?: { value: string; label: string }[];
  step?: number;
  min?: number;
  max?: number;
}

export type SystemSettingItem = SettingItemBase & {
  key: keyof SystemSettings;
  type: Exclude<SettingItemType, 'email-test' | 'cache-test' | 'storage-test' | 'storage-policy-info' | 'storage-sync'>;
};

export type ActionSettingItem =
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

export type SettingItem = SystemSettingItem | ActionSettingItem;

export interface SettingGroup {
  title: string;
  icon: string;
  items: (SettingItem | { _section: string })[];
}

export function isSystemSettingKey(key: SettingItem['key']): key is keyof SystemSettings {
  return !['smtp_test', 'cache_test', 'storage_test', 'storage_policy_info', 'storage_sync'].includes(String(key));
}

export function isSection(item: SettingItem | { _section: string }): item is { _section: string } {
  return '_section' in item;
}

// ── Cache/Storage constants ──

export const CACHE_DRIVER_OPTIONS = [
  { value: 'redis', label: 'Redis 缓存' },
  { value: 'memory', label: '内存缓存' },
  { value: 'off', label: '关闭缓存' },
];

export const STORAGE_PROVIDER_OPTIONS = [
  { value: 'local', label: '本地存储' },
  { value: 'minio', label: 'MinIO / 私有 S3' },
  { value: 'tencent_cos', label: '腾讯云 COS' },
  { value: 'aliyun_oss', label: '阿里云 OSS' },
  { value: 'qiniu_kodo', label: '七牛云 Kodo' },
  { value: 's3_compatible', label: 'S3 兼容存储' },
];

export const CACHE_STORAGE_GROUP_TITLE = '缓存与云存储';
export const CACHE_STORAGE_DEFAULT_SECTION = 'Redis 与页面缓存';
export const SETTING_SECTION_ICONS: Record<string, string> = {
  'Redis 与页面缓存': 'memory',
  对象存储服务商: 'cloud',
  资源目录与访问策略: 'folder_open',
  本地与云同步: 'sync_alt',
  图片与资源优化: 'image',
};

// ── Setting groups ──

export const GROUPS: SettingGroup[] = [
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
        desc: '用于"仅 Logo"模式，适合横版长条图；导航会按高度自适应，不会拉伸变形',
        type: 'image',
      },
      {
        key: 'site_icon',
        label: '站点图标',
        desc: '用于"图标 + 标题"模式，推荐方形图标；若误传横版图，导航也会限制宽高避免挤压标题',
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
        desc: '支持 HTML，如输入 <a href="https://..." >链接</a> 可插入超链接',
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
        label: '统一上传策略',
        desc: '模型、批量压缩包、PDF 图纸、选型导入、产品图库、工单和询价附件都在这里调整',
        type: 'textarea',
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
        desc: 'STEP/STP/IGES 等可下载模型文件目录前缀；私有下载时会走签名链接策略',
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
      {
        key: 'contact_email',
        label: '联系邮箱',
        desc: '用于邮件模板底部的帮助联系邮箱；留空时使用发件人邮箱',
        type: 'text',
      },
      { key: 'smtp_secure', label: 'SSL/TLS', desc: '使用安全连接', type: 'switch' },
      { key: 'smtp_test', label: '测试发送', desc: '保存当前 SMTP 配置和模板后发送一封测试邮件', type: 'email-test' },
      {
        key: 'email_templates',
        label: '邮件模板',
        desc: '注册验证码、测试邮件和业务通知模板',
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

// ── Section splitting ──

export type SettingItemSection = {
  title: string;
  items: SettingItem[];
};

export function splitSettingGroupSections(group: SettingGroup): SettingItemSection[] {
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

export type PreviewSubtab = 'general' | 'edge' | 'measure' | 'light' | 'material';
export type MaterialPresetKey = 'original' | 'default' | 'metal' | 'plastic' | 'glass';

export const PREVIEW_SUBTABS: { key: PreviewSubtab; label: string; icon: string }[] = [
  { key: 'general', label: '通用', icon: 'tune' },
  { key: 'edge', label: '边线', icon: 'content_cut' },
  { key: 'measure', label: '测量', icon: 'straighten' },
  { key: 'light', label: '灯光', icon: 'light_mode' },
  { key: 'material', label: '材质', icon: 'palette' },
];

export const MAT_PRESET_OPTIONS: { value: MaterialPresetKey; label: string }[] = [
  { value: 'original', label: '原色' },
  { value: 'default', label: '智能灰' },
  { value: 'metal', label: '金属' },
  { value: 'plastic', label: '塑料' },
  { value: 'glass', label: '玻璃' },
];

export const PREVIEW_TAB_ITEMS: Record<Exclude<PreviewSubtab, 'material'>, SystemSettingItem[]> = {
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

export interface MatPresetField {
  key: keyof SystemSettings;
  label: string;
  desc: string;
  type: 'range' | 'color';
  min?: number;
  max?: number;
  step?: number;
  canEmpty?: boolean;
}

export const MAT_PRESET_FIELDS: Record<MaterialPresetKey, MatPresetField[]> = {
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
export const PREVIEW_SETTING_KEYS: (keyof SystemSettings)[] = [
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

/** Shared progress card colors — used by backup create, restore, import-restore, import-save, update */
export const PROGRESS_COLORS: Record<string, string> = {
  'primary-container': 'var(--color-primary-container)',
  primary: 'var(--color-primary)',
  'emerald-500': '#10b981',
  error: 'var(--color-error)',
};

// ── More types ──

export type SettingUpdater = (key: keyof SystemSettings, value: boolean | number | string) => void;
export type FooterLinkConfig = { label: string; url: string };
export type EmailTemplateConfig = {
  label: string;
  description: string;
  subject: string;
  html: string;
  tokens: string[];
};
export type PageSizePolicy = {
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

export const emailShellStart = `<div style="max-width:560px;margin:0 auto;background:#ffffff;font-family:Arial,'Microsoft YaHei',sans-serif;color:#1f2937;">
  <div style="padding:24px 28px 18px;border-bottom:1px solid #f3f4f6;">
    <a href="{{actionUrl}}" style="display:inline-flex;align-items:center;gap:12px;text-decoration:none;color:#111827;">
      <img src="{{siteLogo}}" alt="{{siteTitle}}" style="height:36px;max-width:160px;object-fit:contain;border:0;vertical-align:middle;" />
      <strong style="font-size:18px;line-height:1.2;">{{siteTitle}}</strong>
    </a>
  </div>
  <div style="padding:28px;">`;

export const emailShellEnd = `  </div>
  <div style="padding:18px 28px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px;line-height:1.7;">
    <div style="margin:0 0 12px;"><a href="{{actionUrl}}" style="display:inline-block;padding:9px 14px;border-radius:8px;background:#f97316;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">{{actionLabel}}</a></div>
    <div>入口：<a href="{{actionUrl}}" style="color:#f97316;text-decoration:none;">{{actionUrl}}</a></div>
    <div>如需帮助，请联系 {{contactEmail}}</div>
    <div>&copy; {{currentYear}} {{siteTitle}}</div>
  </div>
</div>`;

export const commonEmailTokens = [
  'siteTitle',
  'siteLogo',
  'siteUrl',
  'actionUrl',
  'actionLabel',
  'contactEmail',
  'currentYear',
  'email',
];

export const DEFAULT_EMAIL_TEMPLATES: Record<string, EmailTemplateConfig> = {
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
  ticket_status_changed: {
    label: '工单状态变更',
    description: '工单状态更新时通知用户',
    subject: '{{siteTitle}} 工单状态已更新',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">工单状态已更新</h2>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">当前状态：<strong>{{statusLabel}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'ticketTitle', 'statusLabel'],
  },
  ticket_admin_new: {
    label: '新工单提醒',
    description: '用户创建工单时通知管理员',
    subject: '{{siteTitle}} 有新的工单需要处理',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">有新的工单需要处理</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录后台查看并处理。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'ticketTitle'],
  },
  ticket_admin_replied: {
    label: '工单用户回复提醒',
    description: '用户回复工单时通知管理员',
    subject: '{{siteTitle}} 工单有新的用户回复',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">工单有新的用户回复</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">工单标题：<strong>{{ticketTitle}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'ticketTitle', 'replyPreview'],
  },
  inquiry_replied: {
    label: '询价回复通知',
    description: '管理员回复询价时通知用户',
    subject: '{{siteTitle}} 询价 {{inquiryNo}} 有新回复',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价有新回复</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看完整内容。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'inquiryNo', 'replyPreview'],
  },
  inquiry_admin_new: {
    label: '新询价提醒',
    description: '用户提交询价时通知管理员',
    subject: '{{siteTitle}} 有新的询价单 {{inquiryNo}}',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">有新的询价单</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">产品数量：<strong>{{itemCount}}</strong></p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'inquiryNo', 'itemCount'],
  },
  inquiry_admin_replied: {
    label: '询价用户回复提醒',
    description: '用户回复询价时通知管理员',
    subject: '{{siteTitle}} 询价 {{inquiryNo}} 有新的用户回复',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价有新的用户回复</h2>
  <p style="margin:0 0 10px;">提交用户：<strong>{{username}}</strong></p>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">回复摘要：{{replyPreview}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'username', 'inquiryNo', 'replyPreview'],
  },
  inquiry_assigned: {
    label: '询价转交通知',
    description: '询价转交销售时通知用户或销售',
    subject: '{{siteTitle}} 询价 {{inquiryNo}} 已转交处理',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">询价已转交处理</h2>
  <p style="margin:0 0 10px;">询价编号：<strong>{{inquiryNo}}</strong></p>
  <p style="margin:0 0 10px;">对接人：<strong>{{assigneeName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">请登录 {{siteTitle}} 查看详情。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'inquiryNo', 'assigneeName'],
  },
  favorite_notice: {
    label: '模型收藏提醒',
    description: '模型被收藏时通知上传者',
    subject: '{{siteTitle}} 您的模型被收藏',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">您的模型被收藏</h2>
  <p style="margin:0 0 10px;">模型名称：<strong>{{modelName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">您可以登录 {{siteTitle}} 查看模型详情。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'modelName'],
  },
  model_conversion_completed: {
    label: '模型转换完成',
    description: '模型转换成功后通知上传者',
    subject: '{{siteTitle}} 模型转换完成',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">模型转换完成</h2>
  <p style="margin:0 0 10px;">模型文件：<strong>{{modelName}}</strong></p>
  <p style="margin:0;color:#6b7280;font-size:13px;">现在可以预览和下载。</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'modelName'],
  },
  model_conversion_failed: {
    label: '模型转换失败',
    description: '模型转换失败后通知上传者',
    subject: '{{siteTitle}} 模型转换失败',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;color:#dc2626;">模型转换失败</h2>
  <p style="margin:0 0 10px;">模型文件：<strong>{{modelName}}</strong></p>
  <p style="margin:0 0 10px;">失败原因：{{errorMessage}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'modelName', 'errorMessage'],
  },
  backup_policy_alert: {
    label: '备份体检提醒',
    description: '备份体检发现风险时通知管理员',
    subject: '{{siteTitle}} 备份体检需要关注',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;color:#f97316;">备份体检需要关注</h2>
  <p style="margin:0 0 10px;">风险等级：<strong>{{riskLevel}}</strong></p>
  <p style="margin:0 0 10px;">{{summary}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'riskLevel', 'summary'],
  },
  download_notice: {
    label: '模型下载提醒',
    description: '模型被下载时通知上传者',
    subject: '{{siteTitle}} 您的模型被下载',
    html: `${emailShellStart}
  <h2 style="margin:0 0 14px;">您的模型被下载</h2>
  <p style="margin:0 0 10px;">模型名称：<strong>{{modelName}}</strong></p>
  <p style="margin:0 0 10px;">下载格式：{{downloadFormat}}</p>
${emailShellEnd}`,
    tokens: [...commonEmailTokens, 'modelName', 'downloadFormat'],
  },
};

export const DEFAULT_PAGE_SIZE_POLICY: PageSizePolicy = {
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

// ── Structured/sensitive setting keys ──

export const STRUCTURED_SETTING_KEYS = new Set<keyof SystemSettings>([
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

export const SENSITIVE_TEXT_SETTING_KEYS = new Set<keyof SystemSettings>([
  'smtp_pass',
  'redis_password',
  'storage_access_key_secret',
]);

export function isSensitiveTextSettingKey(key: SettingItem['key']): key is keyof SystemSettings {
  return isSystemSettingKey(key) && SENSITIVE_TEXT_SETTING_KEYS.has(key);
}

// ── CSS class constants ──

export const inputClass =
  'w-full min-w-0 bg-surface-container-lowest text-on-surface text-xs rounded-md px-2.5 py-1.5 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30';
export const numberInputClass = `${inputClass} text-center`;
export const compactListClass = 'space-y-2 w-full max-w-5xl';
export const compactPanelClass = 'p-2.5 rounded-lg bg-surface-container-high/30 border border-outline-variant/10';

// ── Utility functions ──

export function normalizeFooterLinks(value: unknown, clean = false): FooterLinkConfig[] {
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

export function serializeFooterLinks(value: unknown, clean = false): string {
  return JSON.stringify(normalizeFooterLinks(value, clean), null, 2);
}

export function getSettingsSiteTitle(settings: Partial<SystemSettings>): string {
  return String(settings.site_title || '3DPartHub').trim() || '3DPartHub';
}

export function resolveFooterCopyright(settings: Partial<SystemSettings>): string {
  return buildFooterCopyright(getSettingsSiteTitle(settings));
}

export function resolveModelDetailCopyright(settings: Partial<SystemSettings>): string {
  return buildModelDetailCopyright(getSettingsSiteTitle(settings));
}

export function normalizeSettingsForClient(settings: Partial<SystemSettings>): SystemSettings {
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

export function setJsonSetting<T>(updateSetting: SettingUpdater, key: keyof SystemSettings, value: T) {
  updateSetting(key, JSON.stringify(value, null, 2));
}

export function moveListItem<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function parseCsv(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampNumber(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = toNumber(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

export function numberSettingUnit(key: keyof SystemSettings) {
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

export function normalizePageSizePolicyForSave(value: unknown) {
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

export function normalizeUploadPolicyForSave(value: unknown) {
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
    modelDrawingMaxSizeMb: clampNumber(
      policy.modelDrawingMaxSizeMb,
      DEFAULT_UPLOAD_POLICY.modelDrawingMaxSizeMb,
      1,
      102400,
    ),
    batchArchiveMaxSizeMb: clampNumber(
      policy.batchArchiveMaxSizeMb,
      DEFAULT_UPLOAD_POLICY.batchArchiveMaxSizeMb,
      1,
      102400,
    ),
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
    productWallArchiveExtractMaxFiles: clampNumber(
      policy.productWallArchiveExtractMaxFiles,
      DEFAULT_UPLOAD_POLICY.productWallArchiveExtractMaxFiles,
      1,
      500,
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

export function parseEditableLegalSections(value: unknown, fallback: LegalSection[]) {
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

export function normalizeLegalSectionsForSave(value: unknown, fallback: LegalSection[]) {
  const sections = parseEditableLegalSections(value, fallback)
    .map((section) => ({ title: section.title.trim(), content: section.content.trim() }))
    .filter((section) => section.title && section.content);
  return sections.length > 0 ? sections : fallback;
}

export function dedupNavItems(json: string): string {
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

export function normalizeStringSetting(value: unknown, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function normalizeStoragePrefix(value: unknown, fallback: string) {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  return normalized || fallback;
}

export function normalizeSettingsForSave(settings: SystemSettings): SystemSettings {
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
