import { useState, useEffect, useRef, useCallback } from 'react';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { SkeletonList } from '../components/shared/Skeleton';
import TopNav from '../components/shared/TopNav';
import BottomNav from '../components/shared/BottomNav';
import AppSidebar from '../components/shared/Sidebar';
import MobileNavDrawer from '../components/shared/MobileNavDrawer';
import Icon from '../components/shared/Icon';
import SafeImage from '../components/shared/SafeImage';
import { useToast } from '../components/shared/Toast';
import { getSettings, updateSettings, uploadImage, sendTestEmail, getBackupStats, getBackupHealth, checkBackupPolicy, verifyBackup, startBackupJob, pollBackupProgress, downloadBackup, renameBackup, deleteBackup, startRestore, pollRestoreProgress, listBackups, importBackup, importBackupAsRecord, pollImportSaveProgress, listServerBackupFiles, importBackupFromPath, type ServerBackupFile, checkUpdate, getVersion, type SystemSettings, type BackupStats, type BackupRecord, type BackupHealth, type BackupPolicyCheck } from '../api/settings';
import { COLOR_PRESETS, COLOR_KEYS } from '../lib/colorSchemes';
import { applyColorScheme, generatePaletteFromPrimary } from '../lib/colorScheme';
import {
  DEFAULT_ADMIN_NAV,
  DEFAULT_INQUIRY_STATUSES,
  DEFAULT_MOBILE_NAV,
  DEFAULT_SUPPORT_STEPS,
  DEFAULT_THREAD_PRIORITY,
  DEFAULT_TICKET_CLASSIFICATIONS,
  DEFAULT_TICKET_STATUSES,
  DEFAULT_UPLOAD_POLICY,
  DEFAULT_USER_NAV,
  parseSetting,
  type NavItemConfig,
  type StatusConfig,
  type SupportStepConfig,
  type TicketClassificationConfig,
  type UploadPolicy,
} from '../lib/businessConfig';
// Note: pollBackupProgress is used by handleExport

const DEFAULT_SETTINGS: SystemSettings = {
  require_login_download: false,
  require_login_browse: false,
  allow_register: true,
  daily_download_limit: 0,
  allow_comments: true,
  show_watermark: false,
  watermark_text: "3DPartHub",
  watermark_image: "",
  site_title: "3DPartHub",
  site_browser_title: "",
  site_logo: "",
  site_icon: "",
  site_favicon: "/favicon.svg",
  site_logo_display: "logo_and_title",
  site_description: "",
  site_keywords: "",
  contact_email: "",
  contact_phone: "",
  contact_address: "",
  footer_links: "",
  footer_copyright: "",
  announcement_enabled: false,
  announcement_text: "",
  announcement_type: "info",
  announcement_color: "",
  smtp_host: "",
  smtp_port: 465,
  smtp_user: "",
  smtp_pass: "",
  smtp_from: "",
  smtp_secure: true,
  email_templates: "",
  color_scheme: "orange",
  color_custom_dark: "{}",
  color_custom_light: "{}",
  default_theme: "light",
  auto_theme_enabled: false,
  auto_theme_dark_hour: 20,
  auto_theme_light_hour: 8,
  mat_default_color: "#c8cad0",
  mat_default_metalness: 0.5,
  mat_default_roughness: 0.25,
  mat_default_envMapIntensity: 1.5,
  mat_metal_color: "#f0f0f4",
  mat_metal_metalness: 1.0,
  mat_metal_roughness: 0.05,
  mat_metal_envMapIntensity: 2.0,
  mat_plastic_color: "#4499ff",
  mat_plastic_metalness: 0.0,
  mat_plastic_roughness: 0.35,
  mat_plastic_envMapIntensity: 0.6,
  mat_glass_color: "#ffffff",
  mat_glass_metalness: 0.0,
  mat_glass_roughness: 0.0,
  mat_glass_envMapIntensity: 1.0,
  mat_glass_transmission: 0.95,
  mat_glass_ior: 1.5,
  mat_glass_thickness: 0.5,
  viewer_exposure: 1.2,
  viewer_ambient_intensity: 0.6,
  viewer_main_light_intensity: 1.4,
  viewer_fill_light_intensity: 0.6,
  viewer_hemisphere_intensity: 0.3,
  viewer_bg_color: "linear-gradient(180deg, #2a2a3e 0%, #1e2a42 50%, #162040 100%)",
  share_default_expire_days: 0,
  share_max_expire_days: 0,
  share_default_download_limit: 0,
  share_max_download_limit: 0,
  share_allow_password: true,
  share_allow_custom_expiry: true,
  share_allow_preview: true,
  selection_page_title: "产品选型",
  selection_page_desc: "选择产品大类，逐步筛选出精确型号",
  selection_enable_match: true,
  field_aliases: "{}",
  selection_thread_priority: JSON.stringify(DEFAULT_THREAD_PRIORITY, null, 2),
  quote_template: "",
  document_templates: "",
  inquiry_statuses: JSON.stringify(DEFAULT_INQUIRY_STATUSES, null, 2),
  ticket_statuses: JSON.stringify(DEFAULT_TICKET_STATUSES, null, 2),
  ticket_classifications: JSON.stringify(DEFAULT_TICKET_CLASSIFICATIONS, null, 2),
  support_process_steps: JSON.stringify(DEFAULT_SUPPORT_STEPS, null, 2),
  nav_user_items: JSON.stringify(DEFAULT_USER_NAV, null, 2),
  nav_admin_items: JSON.stringify(DEFAULT_ADMIN_NAV, null, 2),
  nav_mobile_items: JSON.stringify(DEFAULT_MOBILE_NAV, null, 2),
  upload_policy: JSON.stringify(DEFAULT_UPLOAD_POLICY, null, 2),
  page_size_policy: JSON.stringify({
    selectionDefault: 50,
    selectionMax: 50000,
    inquiryAdminDefault: 20,
    inquiryAdminMax: 100,
    ticketListMax: 50,
  }, null, 2),
  anti_proxy_enabled: false,
  allowed_hosts: "",
  hotlink_protection_enabled: false,
  allowed_referers: "",
  backup_auto_enabled: false,
  backup_schedule_time: "03:00",
  backup_retention_count: 7,
  backup_mirror_enabled: false,
  backup_mirror_dir: "",
  backup_last_mirror_status: "",
  backup_last_mirror_message: "",
  backup_last_mirror_at: "",
  backup_last_auto_date: "",
  backup_last_auto_status: "",
  backup_last_auto_message: "",
  backup_last_auto_job_id: "",
  backup_last_auto_at: "",
};

interface SettingGroup {
  title: string;
  icon: string;
  items: {
    key: keyof SystemSettings;
    label: string;
    desc: string;
    type: 'switch' | 'number' | 'text' | 'image' | 'textarea' | 'select' | 'color' | 'range' | 'email-test';
    options?: { value: string; label: string }[];
    step?: number;
    min?: number;
    max?: number;
  }[];
}

const GROUPS: SettingGroup[] = [
  {
    title: '访问控制',
    icon: 'lock',
    items: [
      { key: 'require_login_browse', label: '登录浏览', desc: '用户必须登录后才能浏览模型列表', type: 'switch' },
      { key: 'require_login_download', label: '登录下载', desc: '用户必须登录后才能下载模型文件', type: 'switch' },
      { key: 'allow_register', label: '开放注册', desc: '允许新用户自行注册账号', type: 'switch' },
    ],
  },
  {
    title: '内容管理',
    icon: 'chat',
    items: [
      { key: 'allow_comments', label: '允许评论', desc: '用户可以在模型详情页发表评论', type: 'switch' },
    ],
  },
  {
    title: '站点信息',
    icon: 'domain',
    items: [
      { key: 'site_title', label: '网站名称', desc: '显示在导航栏、登录页和浏览器标签的站点名称', type: 'text' },
      { key: 'site_browser_title', label: '浏览器标题', desc: '浏览器标签页显示的标题，留空则使用网站名称', type: 'text' },
      { key: 'site_logo', label: '站点 Logo', desc: '用于“仅 Logo”模式，适合横版长条图；导航会按高度自适应，不会拉伸变形', type: 'image' },
      { key: 'site_icon', label: '站点图标', desc: '用于“图标 + 标题”模式，推荐方形图标；若误传横版图，导航也会限制宽高避免挤压标题', type: 'image' },
      { key: 'site_logo_display', label: 'Logo 显示方式', desc: '图标 + 标题适合大多数站点；仅 Logo 适合已包含文字的横版品牌图', type: 'select', options: [
        { value: 'logo_and_title', label: '图标 + 标题' },
        { value: 'logo_only', label: '仅 Logo（长条）' },
        { value: 'title_only', label: '仅标题' },
      ] },
      { key: 'site_favicon', label: 'Favicon 图标', desc: '浏览器标签页图标，建议正方形 32×32 或 64×64，支持 ICO/PNG/SVG', type: 'image' },
      { key: 'site_description', label: '网站描述', desc: '用于 SEO 和分享链接的站点描述', type: 'text' },
      { key: 'site_keywords', label: '关键词', desc: 'SEO 关键词，多个用逗号分隔', type: 'text' },
      { key: 'contact_email', label: '联系邮箱', desc: '显示在页脚的联系邮箱，用户可直接点击发送邮件', type: 'text' },
    ],
  },
  {
    title: '页脚设置',
    icon: 'link',
    items: [
      { key: 'footer_copyright', label: '版权信息', desc: '页脚左侧显示的版权文字，如：© 2024 公司名称 版权所有', type: 'text' },
      { key: 'footer_links', label: '页脚链接', desc: '管理页脚链接的显示文字和跳转地址', type: 'textarea' },
    ],
  },
  {
    title: '系统公告',
    icon: 'campaign',
    items: [
      { key: 'announcement_enabled', label: '启用公告', desc: '在首页顶部显示系统公告横幅', type: 'switch' },
      { key: 'announcement_text', label: '公告内容', desc: '支持 HTML，如输入 <a href="https://..." >链接</a> 可插入超链接', type: 'textarea' },
      { key: 'announcement_type', label: '公告样式', desc: '选择公告横幅的预设配色方案', type: 'select', options: [
        { value: 'info', label: '信息 (蓝色)' },
        { value: 'warning', label: '警告 (黄色)' },
        { value: 'error', label: '紧急 (红色)' },
      ] },
      { key: 'announcement_color', label: '自定义颜色', desc: '填入十六进制色值（如 #FF6600）覆盖预设配色，留空则使用上方预设样式', type: 'color' },
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
      { key: 'email_templates', label: '邮件模板', desc: '编辑各业务场景的邮件标题、正文和变量占位符', type: 'textarea' },
    ],
  },
  {
    title: '下载限制',
    icon: 'download',
    items: [
      { key: 'daily_download_limit', label: '每日下载上限', desc: '每个用户每天最多下载次数，0 表示不限制', type: 'number' },
    ],
  },
  {
    title: '分享设置',
    icon: 'share',
    items: [
      { key: 'share_default_expire_days', label: '默认有效期', desc: '用户创建分享时的默认有效期天数，0 表示永久有效', type: 'number' },
      { key: 'share_max_expire_days', label: '最大有效期', desc: '分享链接最大有效期天数，0 表示不限制', type: 'number' },
      { key: 'share_default_download_limit', label: '默认下载上限', desc: '用户创建分享时的默认下载次数限制，0 表示不限制', type: 'number' },
      { key: 'share_max_download_limit', label: '最大下载上限', desc: '分享链接最大下载次数，0 表示不限制', type: 'number' },
      { key: 'share_allow_password', label: '允许设置密码', desc: '用户创建分享时是否可以设置访问密码', type: 'switch' },
      { key: 'share_allow_custom_expiry', label: '允许自定义有效期', desc: '用户创建分享时是否可以自行设置有效期', type: 'switch' },
      { key: 'share_allow_preview', label: '默认允许预览', desc: '新创建的分享链接默认是否允许 3D 预览', type: 'switch' },
    ],
  },
  {
    title: '3D 预览设置',
    icon: 'view_in_ar',
    items: [
      { key: 'viewer_bg_color', label: '预览背景色', desc: '支持 CSS 渐变，如 linear-gradient(180deg, #1a1a2e, #16213e)', type: 'text' },
      { key: 'show_watermark', label: '3D 水印', desc: '在 3D 模型预览中显示水印标识', type: 'switch' },
      { key: 'watermark_image', label: '水印图片', desc: '上传水印图片（PNG/SVG），建议使用透明背景', type: 'image' },
      { key: 'viewer_exposure', label: '曝光度', desc: '色调映射曝光值，越高越亮', type: 'range', min: 0.2, max: 3.0, step: 0.1 },
      { key: 'viewer_ambient_intensity', label: '环境光', desc: '环境光强度', type: 'range', min: 0, max: 2.0, step: 0.1 },
      { key: 'viewer_main_light_intensity', label: '主光源', desc: '主方向光强度', type: 'range', min: 0, max: 3.0, step: 0.1 },
      { key: 'viewer_fill_light_intensity', label: '补光', desc: '补光方向光强度', type: 'range', min: 0, max: 2.0, step: 0.1 },
      { key: 'viewer_hemisphere_intensity', label: '半球光', desc: '天空/地面双色光强度', type: 'range', min: 0, max: 2.0, step: 0.1 },
      { key: 'mat_default_color', label: '默认材质 · 颜色', desc: '默认材质的基础颜色', type: 'color' },
      { key: 'mat_default_metalness', label: '默认材质 · 金属度', desc: '0 = 非金属，1 = 全金属', type: 'range', min: 0, max: 1.0, step: 0.05 },
      { key: 'mat_default_roughness', label: '默认材质 · 粗糙度', desc: '0 = 镜面，1 = 完全粗糙', type: 'range', min: 0, max: 1.0, step: 0.05 },
      { key: 'mat_default_envMapIntensity', label: '默认材质 · 环境反射', desc: '环境贴图反射强度', type: 'range', min: 0, max: 3.0, step: 0.1 },
      { key: 'mat_metal_color', label: '金属材质 · 颜色', desc: '金属材质的基础颜色', type: 'color' },
      { key: 'mat_metal_metalness', label: '金属材质 · 金属度', desc: '1.0 = 全金属', type: 'range', min: 0, max: 1.0, step: 0.05 },
      { key: 'mat_metal_roughness', label: '金属材质 · 粗糙度', desc: '0 = 亮面，1 = 哑光', type: 'range', min: 0, max: 1.0, step: 0.05 },
      { key: 'mat_metal_envMapIntensity', label: '金属材质 · 环境反射', desc: '环境贴图反射强度', type: 'range', min: 0, max: 3.0, step: 0.1 },
      { key: 'mat_plastic_color', label: '塑料材质 · 颜色', desc: '塑料材质的基础颜色', type: 'color' },
      { key: 'mat_plastic_metalness', label: '塑料材质 · 金属度', desc: '0 = 非金属', type: 'range', min: 0, max: 1.0, step: 0.05 },
      { key: 'mat_plastic_roughness', label: '塑料材质 · 粗糙度', desc: '表面粗糙程度', type: 'range', min: 0, max: 1.0, step: 0.05 },
      { key: 'mat_plastic_envMapIntensity', label: '塑料材质 · 环境反射', desc: '环境贴图反射强度', type: 'range', min: 0, max: 3.0, step: 0.1 },
      { key: 'mat_glass_color', label: '玻璃材质 · 颜色', desc: '玻璃材质的基础颜色', type: 'color' },
      { key: 'mat_glass_roughness', label: '玻璃材质 · 粗糙度', desc: '0 = 完全透明', type: 'range', min: 0, max: 1.0, step: 0.05 },
      { key: 'mat_glass_transmission', label: '玻璃材质 · 透射率', desc: '光线透过率，1 = 全透', type: 'range', min: 0, max: 1.0, step: 0.05 },
      { key: 'mat_glass_ior', label: '玻璃材质 · 折射率', desc: '折射率 (IOR)，玻璃约 1.5', type: 'range', min: 1.0, max: 2.5, step: 0.1 },
      { key: 'mat_glass_thickness', label: '玻璃材质 · 厚度', desc: '影响折射效果', type: 'range', min: 0, max: 2.0, step: 0.1 },
    ],
  },
  {
    title: '外观设置',
    icon: 'dark_mode',
    items: [
      { key: 'color_scheme', label: '配色方案', desc: '预设:orange/blue/green/purple/red/teal 或 custom', type: 'color-scheme' as any },
      { key: 'default_theme', label: '默认主题', desc: '新用户首次访问时看到的默认外观', type: 'select', options: [
        { value: 'dark', label: '暗色模式' },
        { value: 'light', label: '亮色模式' },
        { value: 'system', label: '跟随系统' },
      ] },
      { key: 'auto_theme_enabled', label: '定时切换', desc: '按时间段自动在亮色和暗色之间切换', type: 'switch' },
      { key: 'auto_theme_dark_hour', label: '暗色开始', desc: '几点切换为暗色模式（24小时制）', type: 'number' },
      { key: 'auto_theme_light_hour', label: '亮色开始', desc: '几点切换为亮色模式（24小时制）', type: 'number' },
    ],
  },
  {
    title: '选型设置',
    icon: 'checklist',
    items: [
      { key: 'selection_page_title', label: '选型页标题', desc: '选型页顶部显示的标题文字', type: 'text' },
      { key: 'selection_page_desc', label: '选型页描述', desc: '选型页标题下方的描述文字', type: 'text' },
      { key: 'selection_enable_match', label: '模型匹配', desc: '在选型结果中自动匹配3D模型', type: 'switch' },
      { key: 'field_aliases', label: '字段别名', desc: '配置字段间的等价匹配关系，多个别名用逗号分隔', type: 'textarea' },
      { key: 'selection_thread_priority', label: '螺纹排序优先级', desc: '配置螺纹前缀的排序权重，数值越小越靠前', type: 'textarea' },
    ],
  },
  {
    title: '业务字典',
    icon: 'rule',
    items: [
      { key: 'inquiry_statuses', label: '询价状态', desc: '用于筛选、标签和通知文案，可配置颜色、标签页展示和终态', type: 'textarea' },
      { key: 'ticket_statuses', label: '工单状态', desc: '用于状态流转、筛选标签和状态徽标', type: 'textarea' },
      { key: 'ticket_classifications', label: '工单分类', desc: '用于技术支持提交入口，可配置图标、说明和启用状态', type: 'textarea' },
      { key: 'support_process_steps', label: '支持流程', desc: '用于技术支持页流程展示，可配置图标、标题和说明', type: 'textarea' },
    ],
  },
  {
    title: '菜单配置',
    icon: 'menu',
    items: [
      { key: 'nav_user_items', label: '用户侧边栏菜单', desc: '配置用户侧边栏的菜单名称、图标、路径和启用状态', type: 'textarea' },
      { key: 'nav_admin_items', label: '管理员侧边栏菜单', desc: '配置管理员侧边栏的菜单名称、图标、路径和启用状态', type: 'textarea' },
      { key: 'nav_mobile_items', label: '移动端底部菜单', desc: '配置移动端底部导航，建议最多 5 项', type: 'textarea' },
    ],
  },
  {
    title: '上传策略',
    icon: 'upload_file',
    items: [
      { key: 'upload_policy', label: '上传策略', desc: '配置模型、选项图片和工单附件的格式与大小限制', type: 'textarea' },
      { key: 'page_size_policy', label: '分页策略', desc: '配置选型、询价和工单列表的默认分页与上限', type: 'textarea' },
    ],
  },
  {
    title: '安全防护',
    icon: 'build',
    items: [
      { key: 'anti_proxy_enabled', label: '反向代理防护', desc: '启用后，通过非授权域名访问将显示警告页面，防止恶意反向代理', type: 'switch' },
      { key: 'allowed_hosts', label: '授权域名', desc: '允许访问的域名列表，逗号或换行分隔。如：mysite.com, www.mysite.com。填写您部署的正式域名', type: 'textarea' },
      { key: 'hotlink_protection_enabled', label: '防盗链保护', desc: '阻止外部网站直接引用本站静态资源（图片、模型文件等）', type: 'switch' },
      { key: 'allowed_referers', label: '允许的来源域名', desc: '允许引用资源的域名列表，逗号分隔。如：mysite.com, www.mysite.com', type: 'textarea' },
    ],
  },
  {
    title: '备份策略',
    icon: 'shield',
    items: [
      { key: 'backup_auto_enabled', label: '自动每日备份', desc: '开启后服务端每天按设定时间自动创建一次企业级校验备份', type: 'switch' },
      { key: 'backup_schedule_time', label: '自动备份时间', desc: '24小时制，例如 03:00。建议选择业务低峰期', type: 'text' },
      { key: 'backup_retention_count', label: '保留备份份数', desc: '自动清理更早的备份，建议至少保留 7 份', type: 'number', min: 1, max: 60 },
      { key: 'backup_mirror_enabled', label: '外部镜像备份', desc: '备份成功后自动复制一份到外部目录，建议挂载到独立磁盘或 NAS', type: 'switch' },
      { key: 'backup_mirror_dir', label: '外部镜像目录', desc: '服务器上的绝对路径，如 /mnt/backup/3dparthub 或 /Volumes/Backup/3dparthub', type: 'text' },
    ],
  },
];

/** Shared progress card — used by backup create, restore, import-restore, import-save, update */
const PROGRESS_COLORS: Record<string, string> = {
  'primary-container': 'var(--color-primary-container)',
  'primary': 'var(--color-primary)',
  'emerald-500': '#10b981',
  'error': 'var(--color-error)',
};

function TaskProgressCard({ progress, color = 'primary-container' }: {
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
          {displayLogs.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      )}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${checked ? 'bg-primary-container' : 'bg-outline-variant/30'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

function ColorSchemeEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: (key: keyof SystemSettings, value: boolean | number | string) => void }) {
  const [customMode, setCustomMode] = useState<'generate' | 'advanced'>('generate');
  const [customPrimary, setCustomPrimary] = useState('#3b82f6');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const currentScheme = (settings.color_scheme as string) || 'orange';
  const isCustom = currentScheme === 'custom';

  // Parse custom colors from JSON strings
  let customDark: Record<string, string> = {};
  let customLight: Record<string, string> = {};
  try { customDark = JSON.parse((settings.color_custom_dark as string) || '{}'); } catch {
    // Invalid custom color JSON falls back to an empty dark palette.
  }
  try { customLight = JSON.parse((settings.color_custom_light as string) || '{}'); } catch {
    // Invalid custom color JSON falls back to an empty light palette.
  }

  // Live preview
  const preview = useCallback(() => {
    applyColorScheme(currentScheme, settings.color_custom_dark as string, settings.color_custom_light as string);
  }, [currentScheme, settings.color_custom_dark, settings.color_custom_light]);

  useEffect(() => { preview(); }, [preview]);

  function selectPreset(key: string) {
    updateSetting('color_scheme', key);
  }

  function handleGenerate() {
    const palette = generatePaletteFromPrimary(customPrimary);
    const darkJson = JSON.stringify(palette.dark);
    const lightJson = JSON.stringify(palette.light);
    updateSetting('color_scheme', 'custom');
    updateSetting('color_custom_dark', darkJson);
    updateSetting('color_custom_light', lightJson);
  }

  function updateCustomColor(mode: 'dark' | 'light', key: string, value: string) {
    const current = mode === 'dark' ? { ...customDark } : { ...customLight };
    current[key] = value;
    updateSetting(mode === 'dark' ? 'color_custom_dark' : 'color_custom_light', JSON.stringify(current));
    if (currentScheme !== 'custom') {
      updateSetting('color_scheme', 'custom');
    }
  }

  return (
    <>
      <div>
        <p className="text-sm font-medium text-on-surface mb-1">配色方案</p>
        <p className="text-xs text-on-surface-variant mb-3">选择预设配色或自定义主题色，实时预览效果</p>

        {/* Preset swatches */}
        <div className="flex flex-wrap gap-3">
          {Object.entries(COLOR_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => selectPreset(key)}
              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border-2 transition-all ${
                currentScheme === key
                  ? 'border-primary-container bg-primary-container/10 shadow-sm'
                  : 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-high/30'
              }`}
            >
              <span
                className="w-8 h-8 rounded-full shadow-inner border border-white/10"
                style={{ backgroundColor: preset.primary }}
              />
              <span className="text-[10px] text-on-surface-variant font-medium">{preset.label}</span>
            </button>
          ))}
          {/* Custom option */}
          <button
            onClick={() => selectPreset('custom')}
            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border-2 transition-all ${
              isCustom
                ? 'border-primary-container bg-primary-container/10 shadow-sm'
                : 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-high/30'
            }`}
          >
            <span className="w-8 h-8 rounded-full border-2 border-dashed border-on-surface-variant/40 flex items-center justify-center">
              <Icon name="colorize" size={14} className="text-on-surface-variant/60" />
            </span>
            <span className="text-[10px] text-on-surface-variant font-medium">自定义</span>
          </button>
        </div>
      </div>

      {/* Custom color section */}
      {isCustom && (
        <div className="bg-surface-container-high/30 rounded-lg border border-outline-variant/10 p-4 space-y-4">
          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setCustomMode('generate')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                customMode === 'generate' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-highest/50 text-on-surface-variant'
              }`}
            >
              从主色生成
            </button>
            <button
              onClick={() => setCustomMode('advanced')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                customMode === 'advanced' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-highest/50 text-on-surface-variant'
              }`}
            >
              高级自定义
            </button>
          </div>

          {customMode === 'generate' ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-on-surface-variant">主色调：</span>
                <input
                  type="color"
                  value={customPrimary}
                  onChange={(e) => setCustomPrimary(e.target.value)}
                  className="w-10 h-8 rounded cursor-pointer border border-outline-variant/30 p-0"
                />
                <span className="text-xs text-on-surface-variant font-mono">{customPrimary}</span>
              </div>
              <button
                onClick={handleGenerate}
                className="px-4 py-1.5 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 transition-colors"
              >
                生成色板
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-primary-container hover:underline"
              >
                <Icon name={showAdvanced ? 'expand_less' : 'expand_more'} size={14} />
                {showAdvanced ? '收起颜色编辑器' : '展开颜色编辑器'}
              </button>
              {showAdvanced && (
                <div className="space-y-3">
                  <p className="text-xs text-on-surface-variant">分别设置暗色和亮色模式下的各颜色变量。留空则使用全局默认值。</p>
                  {(['dark', 'light'] as const).map(mode => (
                    <div key={mode}>
                      <p className="text-xs font-medium text-on-surface mb-2">{mode === 'dark' ? '暗色模式' : '亮色模式'}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        {COLOR_KEYS.map(ck => {
                          const val = (mode === 'dark' ? customDark : customLight)[ck] || '';
                          return (
                            <div key={ck} className="flex items-center gap-1.5 min-w-0">
                              <input
                                type="color"
                                value={val || '#888888'}
                                onChange={(e) => updateCustomColor(mode, ck, e.target.value)}
                                className="w-5 h-5 rounded cursor-pointer border-0 p-0 shrink-0"
                              />
                              <span className="text-[10px] text-on-surface-variant w-24 truncate shrink-0">{ck}</span>
                              <input
                                type="text"
                                value={val}
                                onChange={(e) => updateCustomColor(mode, ck, e.target.value)}
                                placeholder="默认"
                                className="flex-1 min-w-0 bg-surface-container-lowest text-on-surface text-[10px] rounded px-1.5 py-0.5 border border-outline-variant/15 outline-none focus:border-primary font-mono"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
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
  inquiryAdminDefault: number;
  inquiryAdminMax: number;
  ticketListMax: number;
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
  inquiryAdminDefault: 20,
  inquiryAdminMax: 100,
  ticketListMax: 50,
};

const STRUCTURED_SETTING_KEYS = new Set<keyof SystemSettings>([
  'footer_links',
  'field_aliases',
  'selection_thread_priority',
  'inquiry_statuses',
  'ticket_statuses',
  'ticket_classifications',
  'support_process_steps',
  'nav_user_items',
  'nav_admin_items',
  'nav_mobile_items',
  'upload_policy',
  'page_size_policy',
  'email_templates',
]);

const ADVANCED_SETTING_KEYS = new Set<string>([
  'site_favicon',
  'site_description',
  'site_keywords',
  'footer_links',
  'announcement_type',
  'announcement_color',
  'email_templates',
  'share_max_expire_days',
  'share_max_download_limit',
  'share_allow_custom_expiry',
  'share_allow_preview',
  'viewer_exposure',
  'viewer_ambient_intensity',
  'viewer_main_light_intensity',
  'viewer_fill_light_intensity',
  'viewer_hemisphere_intensity',
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
  'mat_glass_roughness',
  'mat_glass_transmission',
  'mat_glass_ior',
  'mat_glass_thickness',
  'auto_theme_enabled',
  'auto_theme_dark_hour',
  'auto_theme_light_hour',
  'field_aliases',
  'selection_thread_priority',
  'inquiry_statuses',
  'ticket_statuses',
  'ticket_classifications',
  'support_process_steps',
  'nav_user_items',
  'nav_admin_items',
  'nav_mobile_items',
  'upload_policy',
  'page_size_policy',
  'allowed_hosts',
  'allowed_referers',
  'backup_mirror_enabled',
  'backup_mirror_dir',
]);

const inputClass = 'w-full min-w-0 bg-surface-container-lowest text-on-surface text-xs rounded-md px-2.5 py-1.5 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30';
const numberInputClass = `${inputClass} text-center`;
const compactListClass = 'space-y-2 w-full max-w-5xl';
const compactPanelClass = 'p-2.5 rounded-lg bg-surface-container-high/30 border border-outline-variant/10';

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
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ListActions({ index, total, onMove, onDelete }: {
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

function StatusListEditor({ itemKey, settings, updateSetting, fallback }: {
  itemKey: keyof SystemSettings;
  settings: SystemSettings;
  updateSetting: SettingUpdater;
  fallback: StatusConfig[];
}) {
  const items = parseSetting<StatusConfig[]>(settings[itemKey], fallback);
  const update = (next: StatusConfig[]) => setJsonSetting(updateSetting, itemKey, next);
  const patch = (index: number, changes: Partial<StatusConfig>) => update(items.map((item, i) => i === index ? { ...item, ...changes } : item));

  return (
    <div className={compactListClass}>
      {items.map((item, index) => (
        <div key={`${item.value}-${index}`} className={`grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr_1fr_auto_auto] gap-2 ${compactPanelClass}`}>
          <input value={item.value} onChange={(e) => patch(index, { value: e.target.value })} placeholder="状态值，如 submitted" className={inputClass} />
          <input value={item.label} onChange={(e) => patch(index, { label: e.target.value })} placeholder="显示名称" className={inputClass} />
          <input value={item.color || ''} onChange={(e) => patch(index, { color: e.target.value })} placeholder="文字色 class" className={inputClass} />
          <input value={item.bg || ''} onChange={(e) => patch(index, { bg: e.target.value })} placeholder="背景色 class" className={inputClass} />
          <div className="flex items-center gap-3 px-1">
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <input type="checkbox" checked={item.tab === true} onChange={(e) => patch(index, { tab: e.target.checked })} className="accent-[var(--color-primary-container)]" />
              标签页
            </label>
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <input type="checkbox" checked={item.terminal === true} onChange={(e) => patch(index, { terminal: e.target.checked })} className="accent-[var(--color-primary-container)]" />
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
      <AddRowButton label="添加状态" onClick={() => update([...items, { value: '', label: '', color: '', bg: '', tab: true }])} />
    </div>
  );
}

function ClassificationEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const items = parseSetting<TicketClassificationConfig[]>(settings.ticket_classifications, DEFAULT_TICKET_CLASSIFICATIONS);
  const update = (next: TicketClassificationConfig[]) => setJsonSetting(updateSetting, 'ticket_classifications', next);
  const patch = (index: number, changes: Partial<TicketClassificationConfig>) => update(items.map((item, i) => i === index ? { ...item, ...changes } : item));

  return (
    <div className={compactListClass}>
      {items.map((item, index) => (
        <div key={`${item.value}-${index}`} className={`grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr_2fr_auto_auto] gap-2 ${compactPanelClass}`}>
          <input value={item.value} onChange={(e) => patch(index, { value: e.target.value })} placeholder="分类值" className={inputClass} />
          <input value={item.label} onChange={(e) => patch(index, { label: e.target.value })} placeholder="显示名称" className={inputClass} />
          <input value={item.icon} onChange={(e) => patch(index, { icon: e.target.value })} placeholder="图标名" className={inputClass} />
          <input value={item.desc} onChange={(e) => patch(index, { desc: e.target.value })} placeholder="说明" className={inputClass} />
          <label className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
            <input type="checkbox" checked={item.enabled !== false} onChange={(e) => patch(index, { enabled: e.target.checked })} className="accent-[var(--color-primary-container)]" />
            启用
          </label>
          <ListActions index={index} total={items.length} onMove={(direction) => update(moveListItem(items, index, direction))} onDelete={() => update(items.filter((_, i) => i !== index))} />
        </div>
      ))}
      <AddRowButton label="添加分类" onClick={() => update([...items, { value: '', label: '', icon: 'category', desc: '', enabled: true }])} />
    </div>
  );
}

function SupportStepsEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const items = parseSetting<SupportStepConfig[]>(settings.support_process_steps, DEFAULT_SUPPORT_STEPS);
  const update = (next: SupportStepConfig[]) => setJsonSetting(updateSetting, 'support_process_steps', next);
  const patch = (index: number, changes: Partial<SupportStepConfig>) => update(items.map((item, i) => i === index ? { ...item, ...changes } : item));

  return (
    <div className={compactListClass}>
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} className={`grid grid-cols-1 xl:grid-cols-[1fr_1fr_2fr_auto] gap-2 ${compactPanelClass}`}>
          <input value={item.icon} onChange={(e) => patch(index, { icon: e.target.value })} placeholder="图标名" className={inputClass} />
          <input value={item.title} onChange={(e) => patch(index, { title: e.target.value })} placeholder="标题" className={inputClass} />
          <input value={item.desc} onChange={(e) => patch(index, { desc: e.target.value })} placeholder="说明" className={inputClass} />
          <ListActions index={index} total={items.length} onMove={(direction) => update(moveListItem(items, index, direction))} onDelete={() => update(items.filter((_, i) => i !== index))} />
        </div>
      ))}
      <AddRowButton label="添加流程" onClick={() => update([...items, { icon: 'check_circle', title: '', desc: '' }])} />
    </div>
  );
}

function NavItemsEditor({ itemKey, settings, updateSetting, fallback }: {
  itemKey: keyof SystemSettings;
  settings: SystemSettings;
  updateSetting: SettingUpdater;
  fallback: NavItemConfig[];
}) {
  const items = parseSetting<NavItemConfig[]>(settings[itemKey], fallback);
  const update = (next: NavItemConfig[]) => setJsonSetting(updateSetting, itemKey, next);
  const patch = (index: number, changes: Partial<NavItemConfig>) => update(items.map((item, i) => i === index ? { ...item, ...changes } : item));

  return (
    <div className={compactListClass}>
      {items.map((item, index) => (
        <div key={`${item.path}-${index}`} className={`grid grid-cols-1 xl:grid-cols-[1fr_1fr_2fr_auto_auto] gap-2 ${compactPanelClass}`}>
          <input value={item.label} onChange={(e) => patch(index, { label: e.target.value })} placeholder="菜单名称" className={inputClass} />
          <input value={item.icon} onChange={(e) => patch(index, { icon: e.target.value })} placeholder="图标名" className={inputClass} />
          <input value={item.path} onChange={(e) => patch(index, { path: e.target.value })} placeholder="路径，如 /admin/models" className={inputClass} />
          <label className="flex items-center gap-1.5 text-xs text-on-surface-variant px-1">
            <input type="checkbox" checked={item.enabled !== false} onChange={(e) => patch(index, { enabled: e.target.checked })} className="accent-[var(--color-primary-container)]" />
            启用
          </label>
          <ListActions index={index} total={items.length} onMove={(direction) => update(moveListItem(items, index, direction))} onDelete={() => update(items.filter((_, i) => i !== index))} />
        </div>
      ))}
      <AddRowButton label="添加菜单" onClick={() => update([...items, { label: '', icon: 'circle', path: '/', enabled: true }])} />
    </div>
  );
}

function UploadPolicyEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const policy = { ...DEFAULT_UPLOAD_POLICY, ...parseSetting<Partial<UploadPolicy>>(settings.upload_policy, {}) };
  const update = (changes: Partial<UploadPolicy>) => setJsonSetting(updateSetting, 'upload_policy', { ...policy, ...changes });

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-3 w-full max-w-4xl ${compactPanelClass}`}>
      <label className="space-y-1">
        <span className="text-xs text-on-surface-variant">模型格式</span>
        <input value={policy.modelFormats.join(', ')} onChange={(e) => update({ modelFormats: parseCsv(e.target.value) })} placeholder="step, stp, x_t, xt" className={inputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-on-surface-variant">模型大小上限 MB</span>
        <input type="number" min={1} value={policy.modelMaxSizeMb} onChange={(e) => update({ modelMaxSizeMb: toNumber(e.target.value, policy.modelMaxSizeMb) })} className={numberInputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-on-surface-variant">分片大小 MB</span>
        <input type="number" min={1} value={policy.chunkSizeMb} onChange={(e) => update({ chunkSizeMb: toNumber(e.target.value, policy.chunkSizeMb) })} className={numberInputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-on-surface-variant">启用分片阈值 MB</span>
        <input type="number" min={1} value={policy.chunkThresholdMb} onChange={(e) => update({ chunkThresholdMb: toNumber(e.target.value, policy.chunkThresholdMb) })} className={numberInputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-on-surface-variant">选型图片上限 MB</span>
        <input type="number" min={1} value={policy.optionImageMaxSizeMb} onChange={(e) => update({ optionImageMaxSizeMb: toNumber(e.target.value, policy.optionImageMaxSizeMb) })} className={numberInputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-on-surface-variant">选型图片 MIME 规则</span>
        <input value={policy.optionImageMimePattern} onChange={(e) => update({ optionImageMimePattern: e.target.value })} placeholder="image\\/(png|jpe?g|gif|webp)" className={inputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-on-surface-variant">工单附件上限 MB</span>
        <input type="number" min={1} value={policy.ticketAttachmentMaxSizeMb} onChange={(e) => update({ ticketAttachmentMaxSizeMb: toNumber(e.target.value, policy.ticketAttachmentMaxSizeMb) })} className={numberInputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-on-surface-variant">工单附件格式</span>
        <input value={policy.ticketAttachmentExts.join(', ')} onChange={(e) => update({ ticketAttachmentExts: parseCsv(e.target.value) })} placeholder=".jpg, .png, .webp" className={inputClass} />
      </label>
    </div>
  );
}

function PageSizePolicyEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const policy = { ...DEFAULT_PAGE_SIZE_POLICY, ...parseSetting<Partial<PageSizePolicy>>(settings.page_size_policy, {}) };
  const update = (key: keyof PageSizePolicy, value: number) => setJsonSetting(updateSetting, 'page_size_policy', { ...policy, [key]: value });
  const fields: { key: keyof PageSizePolicy; label: string }[] = [
    { key: 'selectionDefault', label: '选型默认条数' },
    { key: 'selectionMax', label: '选型最大条数' },
    { key: 'inquiryAdminDefault', label: '询价后台默认条数' },
    { key: 'inquiryAdminMax', label: '询价后台最大条数' },
    { key: 'ticketListMax', label: '工单列表最大条数' },
  ];

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 w-full max-w-4xl ${compactPanelClass}`}>
      {fields.map(field => (
        <label key={field.key} className="space-y-1">
          <span className="text-xs text-on-surface-variant">{field.label}</span>
          <input type="number" min={1} value={policy[field.key]} onChange={(e) => update(field.key, toNumber(e.target.value, policy[field.key]))} className={numberInputClass} />
        </label>
      ))}
    </div>
  );
}

function ThreadPriorityEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const priorities = { ...DEFAULT_THREAD_PRIORITY, ...parseSetting<Record<string, number>>(settings.selection_thread_priority, {}) };
  const rows = Object.entries(priorities).map(([prefix, rank]) => ({ prefix, rank }));
  const updateRows = (nextRows: { prefix: string; rank: number }[]) => {
    setJsonSetting(updateSetting, 'selection_thread_priority', nextRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.prefix] = toNumber(row.rank);
      return acc;
    }, {}));
  };

  return (
    <div className="space-y-2 w-full max-w-2xl">
      {rows.map((row, index) => (
        <div key={`${row.prefix}-${index}`} className={`grid grid-cols-[1fr_1fr_auto] gap-2 ${compactPanelClass}`}>
          <input value={row.prefix} onChange={(e) => updateRows(rows.map((item, i) => i === index ? { ...item, prefix: e.target.value } : item))} placeholder="前缀，如 R / G / NPT" className={inputClass} />
          <input type="number" value={row.rank} onChange={(e) => updateRows(rows.map((item, i) => i === index ? { ...item, rank: toNumber(e.target.value, item.rank) } : item))} placeholder="排序权重" className={numberInputClass} />
          <ListActions index={index} total={rows.length} onMove={(direction) => updateRows(moveListItem(rows, index, direction))} onDelete={() => updateRows(rows.filter((_, i) => i !== index))} />
        </div>
      ))}
      <AddRowButton label="添加前缀" onClick={() => updateRows([...rows, { prefix: '', rank: rows.length }])} />
    </div>
  );
}

function FieldAliasesEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const aliases = parseSetting<Record<string, string[]>>(settings.field_aliases, {});
  const rows = Object.entries(aliases).map(([field, values]) => ({ field, values }));
  const updateRows = (nextRows: { field: string; values: string[] }[]) => {
    setJsonSetting(updateSetting, 'field_aliases', nextRows.reduce<Record<string, string[]>>((acc, row) => {
      if (row.field.trim()) acc[row.field.trim()] = row.values;
      return acc;
    }, {}));
  };

  return (
    <div className="space-y-2 w-full max-w-4xl">
      {rows.map((row, index) => (
        <div key={`${row.field}-${index}`} className={`grid grid-cols-1 xl:grid-cols-[1fr_2fr_auto] gap-2 ${compactPanelClass}`}>
          <input value={row.field} onChange={(e) => updateRows(rows.map((item, i) => i === index ? { ...item, field: e.target.value } : item))} placeholder="标准字段名，如 管径" className={inputClass} />
          <input value={row.values.join(', ')} onChange={(e) => updateRows(rows.map((item, i) => i === index ? { ...item, values: parseCsv(e.target.value) } : item))} placeholder="别名，用逗号分隔" className={inputClass} />
          <ListActions index={index} total={rows.length} onMove={(direction) => updateRows(moveListItem(rows, index, direction))} onDelete={() => updateRows(rows.filter((_, i) => i !== index))} />
        </div>
      ))}
      <AddRowButton label="添加字段别名" onClick={() => updateRows([...rows, { field: '', values: [] }])} />
    </div>
  );
}

function FooterLinksEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const links = parseSetting<FooterLinkConfig[]>(settings.footer_links, []);
  const update = (next: FooterLinkConfig[]) => setJsonSetting(updateSetting, 'footer_links', next);
  const patch = (index: number, changes: Partial<FooterLinkConfig>) => update(links.map((link, i) => i === index ? { ...link, ...changes } : link));

  return (
    <div className="space-y-2 w-full max-w-4xl">
      {links.map((link, index) => (
        <div key={`${link.url}-${index}`} className={`grid grid-cols-1 xl:grid-cols-[1fr_2fr_auto] gap-2 ${compactPanelClass}`}>
          <input value={link.label} onChange={(e) => patch(index, { label: e.target.value })} placeholder="链接文字" className={inputClass} />
          <input value={link.url} onChange={(e) => patch(index, { url: e.target.value })} placeholder="/about 或 https://example.com" className={inputClass} />
          <ListActions index={index} total={links.length} onMove={(direction) => update(moveListItem(links, index, direction))} onDelete={() => update(links.filter((_, i) => i !== index))} />
        </div>
      ))}
      <AddRowButton label="添加页脚链接" onClick={() => update([...links, { label: '', url: '' }])} />
    </div>
  );
}

function EmailTestPanel({ value, onChange, onSend, testing, changed, saving, settings }: {
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
            <p className="text-sm font-semibold text-on-surface truncate">{smtpReady ? 'SMTP 配置已具备测试条件' : 'SMTP 配置还不完整'}</p>
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
  return Object.fromEntries(Object.entries(DEFAULT_EMAIL_TEMPLATES).map(([key, fallback]) => {
    const item = custom[key] || {};
    const legacyHtml = typeof item.html === 'string' && !item.html.includes('{{siteLogo}}') && !item.html.includes('siteLogo');
    return [key, {
      ...fallback,
      ...item,
      html: legacyHtml ? fallback.html : (item.html || fallback.html),
      tokens: Array.from(new Set([...(fallback.tokens || []), ...((item.tokens as string[] | undefined) || [])])),
    }];
  })) as Record<string, EmailTemplateConfig>;
}

function EmailTemplatesEditor({ settings, updateSetting }: { settings: SystemSettings; updateSetting: SettingUpdater }) {
  const templates = getEmailTemplates(settings);
  const keys = Object.keys(templates);
  const [activeKey, setActiveKey] = useState(keys[0] || 'register_verify');
  const active = templates[activeKey] || templates[keys[0]];
  const previewSubject = active ? renderEmailSample(active.subject, settings) : '';
  const previewHtml = active ? renderEmailSample(active.html, settings) : '';
  const update = (next: Record<string, EmailTemplateConfig>) => setJsonSetting(updateSetting, 'email_templates', next);
  const patch = (key: string, changes: Partial<EmailTemplateConfig>) => update({
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
            {keys.map(key => {
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-lowest/80 text-on-surface-variant shrink-0">{(item.tokens || []).length}</span>
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
                  <code className="text-[10px] text-on-surface-variant bg-surface-container-lowest border border-outline-variant/10 rounded px-2 py-1">{activeKey}</code>
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
                    {(active.tokens || []).map(token => (
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

function StructuredSettingEditor({ itemKey, settings, updateSetting }: {
  itemKey: keyof SystemSettings;
  settings: SystemSettings;
  updateSetting: SettingUpdater;
}) {
  switch (itemKey) {
    case 'footer_links':
      return <FooterLinksEditor settings={settings} updateSetting={updateSetting} />;
    case 'field_aliases':
      return <FieldAliasesEditor settings={settings} updateSetting={updateSetting} />;
    case 'selection_thread_priority':
      return <ThreadPriorityEditor settings={settings} updateSetting={updateSetting} />;
    case 'inquiry_statuses':
      return <StatusListEditor itemKey={itemKey} settings={settings} updateSetting={updateSetting} fallback={DEFAULT_INQUIRY_STATUSES} />;
    case 'ticket_statuses':
      return <StatusListEditor itemKey={itemKey} settings={settings} updateSetting={updateSetting} fallback={DEFAULT_TICKET_STATUSES} />;
    case 'ticket_classifications':
      return <ClassificationEditor settings={settings} updateSetting={updateSetting} />;
    case 'support_process_steps':
      return <SupportStepsEditor settings={settings} updateSetting={updateSetting} />;
    case 'nav_user_items':
      return <NavItemsEditor itemKey={itemKey} settings={settings} updateSetting={updateSetting} fallback={DEFAULT_USER_NAV} />;
    case 'nav_admin_items':
      return <NavItemsEditor itemKey={itemKey} settings={settings} updateSetting={updateSetting} fallback={DEFAULT_ADMIN_NAV} />;
    case 'nav_mobile_items':
      return <NavItemsEditor itemKey={itemKey} settings={settings} updateSetting={updateSetting} fallback={DEFAULT_MOBILE_NAV} />;
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
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [expandedAdvancedGroups, setExpandedAdvancedGroups] = useState<Set<string>>(() => new Set());
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const g of GROUPS) {
      if (g.items.length > 5) set.add(g.title);
    }
    return set;
  });

  // Backup state
  const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
  const [backupHealth, setBackupHealth] = useState<BackupHealth | null>(null);
  const [backupPolicyCheck, setBackupPolicyCheck] = useState<BackupPolicyCheck | null>(null);
  const [checkingBackupPolicy, setCheckingBackupPolicy] = useState(false);
  const [verifyingBackupId, setVerifyingBackupId] = useState<string | null>(null);
  const [backupList, setBackupList] = useState<BackupRecord[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ stage: "", percent: 0, message: "", logs: [] as string[] });
  const [importing, setImporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [restoreConfirmFile, setRestoreConfirmFile] = useState<File | null>(null);
  const [serverFiles, setServerFiles] = useState<ServerBackupFile[]>([]);
  const [loadingServerFiles, setLoadingServerFiles] = useState(false);
  const [serverFileConfirm, setServerFileConfirm] = useState<ServerBackupFile | null>(null);
  const [serverFilesScanned, setServerFilesScanned] = useState(false);

  // Update state
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [updateInfo, setUpdateInfo] = useState<{ current: string; remote: string; updateAvailable: boolean; releaseUrl?: string; releaseNotes?: string } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ stage: '', percent: 0, message: '', logs: [] as string[] });
  const backupInputRef = useRef<HTMLInputElement>(null);

  // Global busy state — prevent concurrent admin operations
  const adminBusy = exporting || importing || restoring;

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
    const backupJobId = localStorage.getItem('backupJobId');
    if (backupJobId) {
      setExporting(true);
      setExportProgress({ stage: 'resuming', percent: 0, message: '正在恢复备份任务...', logs: [] });
      try {
        await pollBackupProgress(backupJobId, (stage, percent, message, logs) => {
          setExportProgress({ stage, percent, message, logs: logs || [] });
        });
        toast('备份导出成功', 'success');
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
    const restoreJobId = localStorage.getItem('restoreJobId');
    if (restoreJobId) {
      const savedBackupId = localStorage.getItem('restoreConfirmBackupId');
      if (savedBackupId) setRestoreConfirmId(savedBackupId);
      setRestoring(true);
      setRestoreProgress({ stage: 'resuming', percent: 0, message: '正在恢复恢复任务...', logs: [] });
      try {
        const result = await pollRestoreProgress(restoreJobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toast(`恢复成功：${result.modelCount} 个 STEP 模型，${result.thumbnailCount} 张缩略图`, 'success');
        setRestoreConfirmId(null);
        loadBackupList();
        loadBackupStats();
        loadBackupHealth();
      } catch (err: any) {
        toast(err.message || '恢复失败', 'error');
      } finally {
        localStorage.removeItem('restoreJobId');
        localStorage.removeItem('restoreConfirmBackupId');
        setRestoring(false);
        setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
      }
    }

    // Resume import-save job
    const importSaveJobId = localStorage.getItem('importSaveJobId');
    if (importSaveJobId) {
      setImporting(true);
      setRestoreProgress({ stage: 'resuming', percent: 0, message: '正在恢复导入保存任务...', logs: [] });
      try {
        await pollImportSaveProgress(importSaveJobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toast('备份文件已保存到备份记录列表', 'success');
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
  }

  async function loadSettings() {
    try {
      const data = await getSettings();
      setSettings(data);
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
      setCheckingBackupPolicy(false);
    }
  }

  async function handleVerifyBackup(id: string) {
    setVerifyingBackupId(id);
    try {
      const result = await verifyBackup(id);
      toast(result.message || '备份校验通过', 'success');
      loadBackupList();
      loadBackupHealth();
    } catch (err: any) {
      toast(err.response?.data?.message || err.message || '备份校验失败', 'error');
    } finally {
      setVerifyingBackupId(null);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const data = await updateSettings(settings);
      setSettings(data);
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

  function updateSetting(key: keyof SystemSettings, value: boolean | number | string) {
    setSettings(prev => ({ ...prev, [key]: value }));
    setChanged(true);
  }

  async function handleSendTestEmail() {
    if (!testEmailTo.trim()) {
      toast('请输入测试收件邮箱', 'error');
      return;
    }
    setTestingEmail(true);
    try {
      if (changed) {
        const nextSettings = await updateSettings(settings);
        setSettings(nextSettings);
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

  async function handleImageUpload(key: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadImage(file, key);
      setSettings(prev => ({ ...prev, [key]: url }));
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
    setExporting(true);
    setExportProgress({ stage: "dumping", percent: 0, message: "正在准备...", logs: [] });
    try {
      const jobId = await startBackupJob();
      localStorage.setItem('backupJobId', jobId);
      await pollBackupProgress(jobId, (stage, percent, message, logs) => {
        setExportProgress({ stage, percent, message, logs: logs || [] });
      });
      toast('备份导出成功', 'success');
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
          toast('备份导出成功', 'success');
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
      setExporting(false);
      setExportProgress({ stage: "", percent: 0, message: "", logs: [] });
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
    setImporting(true);
    setUploadProgress(0);
    try {
      if (mode === 'save') {
        // Save as backup record (no restore)
        const isLarge = restoreConfirmFile.size >= 100 * 1024 * 1024;
        await importBackupAsRecord(
          restoreConfirmFile,
          isLarge ? 'chunked' : 'direct',
          (p) => setUploadProgress(p),
          (stage, percent, message, logs) => {
            setRestoreProgress({ stage, percent, message, logs: logs || [] });
          },
          (jobId) => {
            // Persist jobId for page refresh resume
            localStorage.setItem('importSaveJobId', jobId);
          },
        );
        toast('备份文件已保存到备份记录列表', 'success');
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
        setRestoreProgress({ stage: 'uploading', percent: 100, message: '上传完成，正在恢复...', logs: [] });
        const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toast(`恢复成功：${result.modelCount} 个 STEP 模型，${result.thumbnailCount} 张缩略图`, 'success');
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
    setServerFileConfirm(null);
    setImporting(true);
    setRestoreProgress({ stage: 'starting', percent: 0, message: '正在从服务器路径恢复...', logs: [] });
    try {
      const jobId = await importBackupFromPath(file.path);
      localStorage.setItem('restoreJobId', jobId);
      const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
        setRestoreProgress({ stage, percent, message, logs: logs || [] });
      });
      toast(`恢复成功：${result.modelCount} 个 STEP 模型，${result.thumbnailCount} 张缩略图`, 'success');
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
    } catch (err: any) {
      toast(err.message || '恢复失败', 'error');
    } finally {
      localStorage.removeItem('restoreJobId');
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
    if (!window.confirm('确定要删除这个备份吗？')) return;
    try {
      await deleteBackup(id);
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
    setRestoring(true);
    setRestoreProgress({ stage: 'starting', percent: 0, message: '正在启动恢复...', logs: [] });
    try {
      const jobId = await startRestore(restoreConfirmId);
      localStorage.setItem('restoreJobId', jobId);
      localStorage.setItem('restoreConfirmBackupId', restoreConfirmId);
      const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
        setRestoreProgress({ stage, percent, message, logs: logs || [] });
      });
      toast(`恢复成功：${result.modelCount} 个 STEP 模型，${result.thumbnailCount} 张缩略图`, 'success');
      setRestoreConfirmId(null);
      loadBackupList();
      loadBackupStats();
      loadBackupHealth();
    } catch (err: any) {
      toast(err.message || '恢复失败', 'error');
    } finally {
      localStorage.removeItem('restoreJobId');
      localStorage.removeItem('restoreConfirmBackupId');
      setRestoring(false);
      setRestoreProgress({ stage: '', percent: 0, message: '', logs: [] });
    }
  }

  if (loading) {
    return <SkeletonList rows={6} />;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">系统设置</h2>
          <p className="text-sm text-on-surface-variant mt-1">配置平台的全局行为和访问策略</p>
        </div>
        {(() => {
          const allKeys = [...GROUPS.map(g => g.title), '数据备份'];
          const allCollapsed = allKeys.every(k => collapsedGroups.has(k));
          return (
            <button
              onClick={() => setCollapsedGroups(allCollapsed ? new Set() : new Set(allKeys))}
              className="text-sm text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1"
            >
              <Icon name={allCollapsed ? 'expand_less' : 'expand_more'} size={16} />
              {allCollapsed ? '全部展开' : '全部收起'}
            </button>
          );
        })()}
      </div>

      <div className="flex flex-col gap-6 pb-20">
        {GROUPS.map(group => {
          const collapsed = collapsedGroups.has(group.title);
          const advancedItems = group.items.filter(item => ADVANCED_SETTING_KEYS.has(String(item.key)));
          const advancedExpanded = expandedAdvancedGroups.has(group.title);
          const visibleItems = advancedExpanded
            ? group.items
            : group.items.filter(item => !ADVANCED_SETTING_KEYS.has(String(item.key)));
          const shownCount = collapsed ? group.items.length : visibleItems.length;
          return (
          <div key={group.title} className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
            <div
              className="px-4 sm:px-6 py-4 border-b border-outline-variant/10 bg-surface-container-high/50 flex items-center gap-2.5 cursor-pointer select-none hover:bg-surface-container-high/80 transition-colors"
              onClick={() => setCollapsedGroups(prev => {
                const next = new Set(prev);
                if (next.has(group.title)) next.delete(group.title);
                else next.add(group.title);
                return next;
              })}
            >
              <Icon name={group.icon} size={18} className="text-primary-container" />
              <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider flex-1">{group.title}</h3>
              <span className="text-sm text-on-surface-variant mr-3">
                {advancedItems.length > 0 && !collapsed ? `${shownCount}/${group.items.length}` : group.items.length} 项
              </span>
              <Icon name={collapsed ? 'expand_more' : 'expand_less'} size={18} className="text-on-surface-variant" />
            </div>
            {!collapsed && (
            <div className="divide-y divide-outline-variant/5">
              {visibleItems.map((item, itemIndex) => {
                const structuredEditor = STRUCTURED_SETTING_KEYS.has(item.key)
                  ? <StructuredSettingEditor itemKey={item.key} settings={settings} updateSetting={updateSetting} />
                  : null;
                const isWideControl = Boolean(structuredEditor) || item.type === 'textarea' || item.type === 'email-test';
                const rowClass = item.type === 'color-scheme'
                  ? 'px-4 sm:px-6 py-4 flex flex-col gap-4'
                  : isWideControl
                    ? 'px-4 sm:px-6 py-4 flex flex-col gap-3'
                    : 'px-4 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] gap-3 lg:gap-6 lg:items-center';
                return (
                <div key={`${group.title}-${item.key}-${itemIndex}`} className={`${rowClass} hover:bg-surface-container-high/30 transition-colors`}>
                  {item.type === 'color-scheme' ? (
                    <ColorSchemeEditor settings={settings} updateSetting={updateSetting} />
                  ) : (<>
                  <div className="min-w-0 max-w-2xl">
                    <p className="text-sm font-medium text-on-surface">{item.label}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
                  </div>
                  {structuredEditor || (item.type === 'email-test' ? (
                    <EmailTestPanel
                      value={testEmailTo}
                      onChange={setTestEmailTo}
                      onSend={handleSendTestEmail}
                      testing={testingEmail}
                      changed={changed}
                      saving={saving}
                      settings={settings}
                    />
                  ) : item.type === 'switch' ? (
                    <Switch
                      checked={settings[item.key] as boolean}
                      onChange={(v) => updateSetting(item.key, v)}
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
                          ref={(el) => { imageInputRefs.current[item.key] = el; }}
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
                            onClick={() => { updateSetting(item.key, ''); }}
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
                        min={0}
                        value={settings[item.key] as number}
                        onChange={(e) => updateSetting(item.key, Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-28 bg-surface-container-lowest text-on-surface text-sm text-center rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                      />
                      {item.key === 'daily_download_limit' && <span className="text-xs text-on-surface-variant">次/天</span>}
                    </div>
                  ) : item.type === 'range' ? (
                    <div className="flex items-center gap-3 w-full lg:max-w-sm lg:justify-self-start">
                      <input
                        type="range"
                        min={item.min ?? 0}
                        max={item.max ?? 1}
                        step={item.step ?? 0.01}
                        value={settings[item.key] as number}
                        onChange={(e) => updateSetting(item.key, parseFloat(e.target.value))}
                        className="w-full accent-[var(--color-primary-container)]"
                      />
                      <span className="text-xs font-mono text-on-surface w-10 text-right">{(settings[item.key] as number).toFixed(item.step && item.step < 0.1 ? 2 : item.step && item.step < 1 ? 1 : 0)}</span>
                    </div>
                  ) : item.type === 'textarea' ? (
                    <div className="w-full">
                      <textarea
                        value={settings[item.key] as string}
                        onChange={(e) => updateSetting(item.key, e.target.value)}
                        placeholder={item.desc}
                        rows={item.key === 'quote_template' ? 20 : 3}
                        className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 resize-y font-mono"
                      />
                      {item.key === 'allowed_hosts' && typeof window !== 'undefined' && (
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="text-xs text-on-surface-variant">当前访问域名：</span>
                          <code className="text-xs font-mono text-primary-container bg-primary-container/10 px-2 py-0.5 rounded break-all">{window.location.host}</code>
                          <button
                            type="button"
                            onClick={() => {
                              const current = (settings.allowed_hosts as string || '').trim();
                              const host = window.location.host;
                              const updated = current ? `${current}, ${host}` : host;
                              updateSetting('allowed_hosts', updated);
                            }}
                            className="text-xs text-primary-container hover:underline"
                          >加入授权</button>
                        </div>
                      )}
                    </div>
                  ) : item.type === 'select' ? (
                    <select
                      value={settings[item.key] as string}
                      onChange={(e) => updateSetting(item.key, e.target.value)}
                      className="w-full lg:max-w-sm bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                    >
                      {item.options?.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
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
                      type="text"
                      value={settings[item.key] as string}
                      onChange={(e) => updateSetting(item.key, e.target.value)}
                      placeholder={item.desc}
                      className="w-full lg:max-w-md bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30"
                    />
                  ))}
                  </>)}
                </div>
              );
              })}
              {advancedItems.length > 0 && (
                <div className="px-4 sm:px-6 py-3 bg-surface-container-high/15">
                  <button
                    type="button"
                    onClick={() => setExpandedAdvancedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has(group.title)) next.delete(group.title);
                      else next.add(group.title);
                      return next;
                    })}
                    className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed border-outline-variant/25 bg-surface-container-lowest/30 px-3 py-2 text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 transition-colors"
                  >
                    <Icon name={advancedExpanded ? 'expand_less' : 'expand_more'} size={15} />
                    {advancedExpanded ? '收起高级设置' : `展开高级设置（${advancedItems.length} 项）`}
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        );
      })}

        {/* Data Backup Section */}
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
          <div
            className="px-6 py-4 border-b border-outline-variant/10 bg-surface-container-high/50 flex items-center gap-2.5 cursor-pointer select-none hover:bg-surface-container-high/80 transition-colors"
            onClick={() => setCollapsedGroups(prev => {
              const next = new Set(prev);
              if (next.has('数据备份')) next.delete('数据备份');
              else next.add('数据备份');
              return next;
            })}
          >
            <Icon name="cloud_upload" size={18} className="text-primary-container" />
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider flex-1">数据备份</h3>
            <span className="text-sm text-on-surface-variant mr-3">5 项</span>
            <Icon name={collapsedGroups.has('数据备份') ? 'expand_more' : 'expand_less'} size={18} className="text-on-surface-variant" />
          </div>
          {!collapsedGroups.has('数据备份') && (
          <div className="divide-y divide-outline-variant/5">
            {/* Backup health */}
            {backupHealth && (
              <div className="px-6 py-4">
                <div className={`rounded-lg border p-4 ${
                  backupHealth.status === 'ok'
                    ? 'bg-green-500/10 border-green-500/20'
                    : backupHealth.status === 'warning'
                      ? 'bg-yellow-500/10 border-yellow-500/20'
                      : 'bg-surface-container-high/40 border-outline-variant/10'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon
                          name={backupHealth.status === 'ok' ? 'verified_user' : backupHealth.status === 'warning' ? 'warning' : 'info'}
                          size={18}
                          className={backupHealth.status === 'ok' ? 'text-green-500' : backupHealth.status === 'warning' ? 'text-yellow-500' : 'text-on-surface-variant'}
                        />
                        <p className="text-sm font-medium text-on-surface">企业级备份状态</p>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-1">{backupHealth.message}</p>
                    </div>
                    <button
                      onClick={handleBackupPolicyCheck}
                      disabled={checkingBackupPolicy || adminBusy}
                      className="px-3 py-1.5 text-xs font-medium bg-primary-container/15 text-primary-container rounded-md hover:bg-primary-container/25 disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
                    >
                      <Icon name="fact_check" size={14} />
                      {checkingBackupPolicy ? '体检中...' : '策略体检'}
                    </button>
                    <div className="flex flex-wrap gap-2 text-xs">
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
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant">
                    {backupHealth.latestBackup && <span>最近备份：{new Date(backupHealth.latestBackup.createdAt).toLocaleString('zh-CN')}</span>}
                    {backupHealth.nextRunAt && <span>下次自动：{new Date(backupHealth.nextRunAt).toLocaleString('zh-CN')}</span>}
                    {backupHealth.lastAutoMessage && <span>自动任务：{backupHealth.lastAutoMessage}</span>}
                    {backupHealth.mirrorDir && <span>镜像目录：{backupHealth.mirrorDir}</span>}
                    {backupHealth.lastMirrorMessage && <span>镜像状态：{backupHealth.lastMirrorMessage}</span>}
                  </div>
                  {backupPolicyCheck && (
                    <div className="mt-3 rounded-md bg-surface-container-lowest/70 border border-outline-variant/10 p-3">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant mb-2">
                        <span>体检时间：{new Date(backupPolicyCheck.checkedAt).toLocaleString('zh-CN')}</span>
                        <span>预计备份大小：{backupPolicyCheck.estimatedBackupSizeText}</span>
                      </div>
                      <div className="space-y-1.5">
                        {backupPolicyCheck.checks.map(check => (
                          <div key={check.key} className="flex items-start gap-2 text-xs">
                            <Icon
                              name={check.status === 'ok' ? 'check_circle' : check.status === 'warning' ? 'warning' : 'error'}
                              size={14}
                              className={check.status === 'ok' ? 'text-green-500' : check.status === 'warning' ? 'text-yellow-500' : 'text-error'}
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
            <div className="px-6 py-4">
              <div className="flex flex-wrap gap-4 text-sm">
                {backupStats && (
                  <>
                    <div className="flex items-center gap-2 bg-surface-container-high/50 px-3 py-1.5 rounded-md">
                      <Icon name="view_in_ar" size={14} className="text-primary-container" />
                      <span className="text-on-surface-variant">STEP 模型</span>
                      <span className="font-medium text-on-surface">{backupStats.modelCount} 个</span>
                    </div>
                    <div className="flex items-center gap-2 bg-surface-container-high/50 px-3 py-1.5 rounded-md">
                      <Icon name="wallpaper" size={14} className="text-primary-container" />
                      <span className="text-on-surface-variant">预览图</span>
                      <span className="font-medium text-on-surface">{backupStats.thumbnailCount} 张</span>
                    </div>
                    <div className="flex items-center gap-2 bg-surface-container-high/50 px-3 py-1.5 rounded-md">
                      <Icon name="data_usage" size={14} className="text-primary-container" />
                      <span className="text-on-surface-variant">数据库</span>
                      <span className="font-medium text-on-surface">{backupStats.dbSize}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Export */}
            <div className="px-6 py-4">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <p className="text-sm font-medium text-on-surface">创建备份</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">打包数据库、模型文件和缩略图到服务器</p>
                </div>
                <button
                  onClick={handleExport}
                  disabled={adminBusy}
                  className="px-4 py-2 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <Icon name="add" size={14} />
                  {exporting ? `${exportProgress.percent}%` : '创建备份'}
                </button>
              </div>
              {exporting && (
                <TaskProgressCard progress={exportProgress} />
              )}
            </div>

            {/* Backup List */}
            {backupList.length > 0 && (
              <div className="px-6 py-4">
                <p className="text-sm font-medium text-on-surface mb-3">备份记录</p>
                <div className="space-y-2">
                  {backupList.map(b => (
                    <div key={b.id} className="bg-surface-container-high/30 rounded-lg border border-outline-variant/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {renamingId === b.id ? (
                            <div className="flex items-center gap-2 mb-2">
                              <input
                                type="text"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(b.id); if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); } }}
                                className="flex-1 bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-1.5 border border-outline-variant/30 outline-none focus:border-primary"
                                autoFocus
                              />
                              <button onClick={() => handleRename(b.id)} className="px-2 py-1.5 text-xs text-primary-container hover:bg-primary-container/10 rounded-md">保存</button>
                              <button onClick={() => { setRenamingId(null); setRenameValue(''); }} className="px-2 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded-md">取消</button>
                            </div>
                          ) : (
                            <p className="text-sm font-medium text-on-surface truncate">{b.name}</p>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-on-surface-variant">
                            <span>{new Date(b.createdAt).toLocaleString('zh-CN')}</span>
                            <span>{b.fileSizeText}</span>
                            <span>{b.modelCount ?? 0} 个 STEP 模型</span>
                            <span>{b.thumbnailCount ?? 0} 张预览图</span>
                            <span>数据库 {b.dbSize}</span>
                            {b.manifestVersion && <span>清单 v{b.manifestVersion}</span>}
                            {b.verifiedAt && <span>已校验</span>}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button onClick={() => handleRestoreRequest(b.id)} disabled={adminBusy} className="px-2.5 py-1.5 text-xs font-medium bg-primary-container/15 text-primary-container rounded-md hover:bg-primary-container/25 disabled:opacity-50 transition-colors flex items-center gap-1">
                            <Icon name="restore" size={13} />恢复
                          </button>
                          <button onClick={() => handleDownloadBackup(b.id)} disabled={adminBusy} className="px-2.5 py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 disabled:opacity-50 transition-colors flex items-center gap-1">
                            <Icon name="download" size={13} />下载
                          </button>
                          <button onClick={() => handleVerifyBackup(b.id)} disabled={adminBusy || verifyingBackupId === b.id} className="px-2.5 py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 disabled:opacity-50 transition-colors flex items-center gap-1">
                            <Icon name="verified" size={13} />{verifyingBackupId === b.id ? '校验中' : '校验'}
                          </button>
                          <button onClick={() => { setRenamingId(b.id); setRenameValue(b.name); }} disabled={adminBusy} className="px-2.5 py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 disabled:opacity-50 transition-colors flex items-center gap-1">
                            <Icon name="edit" size={13} />重命名
                          </button>
                          <button onClick={() => handleDelete(b.id)} disabled={adminBusy} className="px-2.5 py-1.5 text-xs font-medium bg-error-container/10 text-error rounded-md hover:bg-error-container/20 disabled:opacity-50 transition-colors flex items-center gap-1">
                            <Icon name="delete" size={13} />删除
                          </button>
                        </div>
                      </div>

                      {restoreConfirmId === b.id && (
                        <div className="mt-3 bg-error-container/10 border border-error/20 rounded-md p-3">
                          <div className="flex items-start gap-2">
                            <Icon name="warning" size={18} className="text-error shrink-0 mt-0.5" />
                            <div className="flex-1">
                              {!restoring ? (
                                <>
                                  <p className="text-xs font-medium text-on-surface">确认恢复到此备份？</p>
                                  <p className="text-xs text-error/80 mt-1">此操作将覆盖当前数据库和模型文件，不可撤销！</p>
                                  <div className="flex gap-2 mt-2">
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
            <div className="px-6 py-4">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <p className="text-sm font-medium text-on-surface">导入恢复</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">上传备份文件恢复数据（将覆盖当前数据）</p>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={backupInputRef}
                    type="file"
                    onChange={handleBackupFileSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => backupInputRef.current?.click()}
                    disabled={adminBusy}
                    className="px-4 py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    <Icon name="upload" size={14} />
                    本地上传
                  </button>
                  <button
                    onClick={() => { setServerFileConfirm(null); handleLoadServerFiles(); }}
                    disabled={adminBusy}
                    className="px-4 py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
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
                <div className="mt-3 text-xs text-on-surface-variant animate-pulse">正在扫描服务器文件...</div>
              )}
              {!loadingServerFiles && serverFiles.length > 0 && !importing && (
                <div className="mt-3 border border-outline-variant/20 rounded-md divide-y divide-outline-variant/10">
                  {serverFiles.map(f => (
                    <div key={f.path} className="flex items-center justify-between px-3 py-2 hover:bg-surface-container-high/30">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-on-surface truncate">{f.name}</p>
                        <p className="text-xs text-on-surface-variant">{(f.size / 1024 / 1024).toFixed(1)} MB · {new Date(f.modifiedAt).toLocaleString('zh-CN')}</p>
                      </div>
                      <button
                        onClick={() => setServerFileConfirm(f)}
                        disabled={adminBusy}
                        className="ml-2 px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/10 disabled:opacity-50 transition-colors shrink-0"
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
                        文件：{serverFileConfirm.name}（{(serverFileConfirm.size / 1024 / 1024).toFixed(1)} MB）
                      </p>
                      <p className="text-xs text-on-surface-variant mt-0.5">路径：{serverFileConfirm.path}</p>
                      <div className="mt-3 flex gap-2">
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
                        文件：{restoreConfirmFile.name}（{(restoreConfirmFile.size / 1024 / 1024).toFixed(1)} MB）
                      </p>
                      <div className="mt-3 space-y-2">
                        <button
                          onClick={() => handleImport('restore')}
                          className="w-full text-left px-3 py-2 bg-error/10 border border-error/20 rounded-md hover:bg-error/15 transition-colors"
                        >
                          <p className="text-xs font-medium text-error">直接恢复</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">立即覆盖当前数据库和模型文件（不可撤销）</p>
                        </button>
                        <button
                          onClick={() => handleImport('save')}
                          className="w-full text-left px-3 py-2 bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/15 transition-colors"
                        >
                          <p className="text-xs font-medium text-primary">保存到备份列表</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">保存后可随时通过「恢复备份」按需恢复</p>
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
                    当前版本: <span className="font-mono text-primary-container">{currentVersion || updateInfo?.current || '—'}</span>
                    {updateInfo && !updateInfo.updateAvailable && (updateInfo.current || currentVersion) !== 'unknown' && (
                      <span className="ml-1.5 text-emerald-400">· 已是最新</span>
                    )}
                    {updateInfo?.updateAvailable && (
                      <> · 最新版本: <span className="font-mono text-emerald-400">{updateInfo.remote}</span></>
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 font-mono">{updateInfo.current}</span>
                      <Icon name="arrow_forward" size={16} className="text-primary" />
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">{updateInfo.remote}</span>
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
                    <p className="text-xs text-on-surface-variant mb-2">在服务器上执行以下命令升级：</p>
                    <div className="bg-surface-container rounded p-3 font-mono text-xs text-on-surface select-all space-y-1">
                      <div><span className="text-on-surface-variant/50">$</span> docker compose pull</div>
                      <div><span className="text-on-surface-variant/50">$</span> docker compose up -d</div>
                    </div>
                    <p className="text-[10px] text-on-surface-variant/50 mt-2">升级后数据库会自动迁移，请查看日志确认: docker compose logs -f api</p>
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 font-mono">{updateInfo.remote}</span>
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
          )}
        </div>
      </div>

      {/* Floating save button */}
      {changed && (
        <div className="fixed bottom-4 right-4 z-50 animate-[fadeInUp_0.2s_ease-out]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-primary-container text-on-primary rounded-xl text-sm font-bold shadow-lg hover:opacity-90 disabled:opacity-50 active:scale-95 transition-all"
          >
            <Icon name="save" size={16} />
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      )}
    </>
  );
}

export default function SettingsPage() {
  useDocumentTitle('系统设置');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <Content />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen(prev => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <div className="px-4 py-4 pb-20">
          <Content />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
