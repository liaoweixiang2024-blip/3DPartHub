import { useState, useEffect, useRef, useCallback } from 'react';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import TopNav from '../components/shared/TopNav';
import BottomNav from '../components/shared/BottomNav';
import AppSidebar from '../components/shared/Sidebar';
import MobileNavDrawer from '../components/shared/MobileNavDrawer';
import Icon from '../components/shared/Icon';
import { useToast } from '../components/shared/Toast';
import { getSettings, updateSettings, uploadImage, getBackupStats, startBackupJob, pollBackupProgress, downloadBackup, renameBackup, deleteBackup, startRestore, pollRestoreProgress, listBackups, importBackup, importBackupAsRecord, checkUpdate, startUpdate, pollUpdateProgress, type SystemSettings, type BackupStats, type BackupRecord } from '../api/settings';
import { COLOR_PRESETS, COLOR_KEYS, type ColorKey } from '../lib/colorSchemes';
import { applyColorScheme, generatePaletteFromPrimary } from '../lib/colorScheme';
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
  site_logo: "/static/logo/logo.svg",
  site_icon: "/static/logo/icon.svg",
  site_favicon: "/favicon.svg",
  site_logo_display: "logo_and_title",
  site_description: "",
  site_keywords: "",
  contact_email: "",
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
  color_scheme: "orange",
  color_custom_dark: "{}",
  color_custom_light: "{}",
  default_theme: "dark",
  auto_theme_enabled: false,
  auto_theme_dark_hour: 20,
  auto_theme_light_hour: 8,
};

interface SettingGroup {
  title: string;
  icon: string;
  items: {
    key: keyof SystemSettings;
    label: string;
    desc: string;
    type: 'switch' | 'number' | 'text' | 'image' | 'textarea' | 'select' | 'color';
    options?: { value: string; label: string }[];
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
    icon: 'tune',
    items: [
      { key: 'allow_comments', label: '允许评论', desc: '用户可以在模型详情页发表评论', type: 'switch' },
      { key: 'show_watermark', label: '3D 水印', desc: '在 3D 模型预览中显示水印标识', type: 'switch' },
      { key: 'watermark_image', label: '水印图片', desc: '上传水印图片（PNG/SVG），建议使用透明背景', type: 'image' },
    ],
  },
  {
    title: '站点信息',
    icon: 'palette',
    items: [
      { key: 'site_title', label: '网站名称', desc: '显示在导航栏、登录页和浏览器标签的站点名称', type: 'text' },
      { key: 'site_browser_title', label: '浏览器标题', desc: '浏览器标签页显示的标题，留空则使用网站名称', type: 'text' },
      { key: 'site_logo', label: '站点 Logo', desc: '仅 Logo 模式使用，建议横版长条形，宽高比 5:1，SVG/PNG 透明背景', type: 'image' },
      { key: 'site_icon', label: '站点图标', desc: 'Logo + 标题模式使用，建议正方形 64×64，SVG/PNG 透明背景', type: 'image' },
      { key: 'site_logo_display', label: 'Logo 显示方式', desc: '仅 Logo = 横版长条；Logo + 标题 = 方形图标 + 文字', type: 'select', options: [
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
    icon: 'more_horiz',
    items: [
      { key: 'footer_copyright', label: '版权信息', desc: '页脚左侧显示的版权文字，如：© 2024 公司名称 版权所有', type: 'text' },
      { key: 'footer_links', label: '页脚链接', desc: 'JSON 格式，如：[{"label":"关于我们","url":"/about"},{"label":"使用条款","url":"/terms"}]', type: 'textarea' },
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
    title: '外观设置',
    icon: 'palette',
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
];

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
  try { customDark = JSON.parse((settings.color_custom_dark as string) || '{}'); } catch {}
  try { customLight = JSON.parse((settings.color_custom_light as string) || '{}'); } catch {}

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
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {COLOR_KEYS.map(ck => {
                          const val = (mode === 'dark' ? customDark : customLight)[ck] || '';
                          return (
                            <div key={ck} className="flex items-center gap-1.5">
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

function Content() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Backup state
  const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
  const [backupList, setBackupList] = useState<BackupRecord[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ stage: "", percent: 0, message: "", logs: [] as string[] });
  const [importing, setImporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [restoreConfirmFile, setRestoreConfirmFile] = useState<File | null>(null);

  // Update state
  const [updateInfo, setUpdateInfo] = useState<{ current: string; remote: string; updateAvailable: boolean; warning?: string } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({ stage: "", percent: 0, message: "", logs: [] as string[] });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ stage: '', percent: 0, message: '', logs: [] as string[] });
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Clear stale backup job ID from previous sessions
    localStorage.removeItem('backupJobId');

    loadSettings();
    loadBackupStats();
    loadBackupList();
  }, []);

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
    } catch {}
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
    setExportProgress({ stage: "dumping", percent: 0, message: "正在准备..." });
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
    } catch (err: any) {
      localStorage.removeItem('backupJobId');
      toast(err.message || '导出失败', 'error');
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

  async function handleUpdate() {
    setUpdating(true);
    let lastStage = "pulling";
    setUpdateProgress({ stage: "pulling", percent: 0, message: "正在准备更新..." });
    try {
      const jobId = await startUpdate();
      await pollUpdateProgress(jobId, (stage, percent, message, logs) => {
        lastStage = stage;
        setUpdateProgress({ stage, percent, message, logs: logs || [] });
      });
      toast('更新成功，页面即将刷新...', 'success');
      setTimeout(() => window.location.reload(), 3000);
    } catch (err: any) {
      if (lastStage === "restarting" || !navigator.onLine) {
        toast('服务正在重启，页面即将刷新...', 'success');
        setTimeout(() => window.location.reload(), 5000);
      } else {
        toast(err.message || '更新失败', 'error');
      }
    } finally {
      setUpdating(false);
    }
  }

  async function loadBackupList() {
    try {
      const list = await listBackups();
      setBackupList(list);
    } catch {}
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
        await importBackupAsRecord(restoreConfirmFile, isLarge ? 'chunked' : 'direct', (p) => {
          setUploadProgress(p);
        });
        toast('备份文件已保存到备份记录列表', 'success');
        setRestoreConfirmFile(null);
        loadBackupList();
        loadBackupStats();
      } else {
        // Direct import and restore
        const jobId = await importBackup(restoreConfirmFile, (p) => {
          setUploadProgress(p);
        });
        setRestoreProgress({ stage: 'uploading', percent: 100, message: '上传完成，正在恢复...', logs: [] });
        const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
          setRestoreProgress({ stage, percent, message, logs: logs || [] });
        });
        toast(`恢复成功：${result.modelCount} 个模型，${result.thumbnailCount} 张缩略图`, 'success');
        setRestoreConfirmFile(null);
        loadBackupList();
        loadBackupStats();
      }
    } catch (err: any) {
      toast(err.message || '操作失败', 'error');
    } finally {
      setImporting(false);
      setUploadProgress(0);
      setRestoreProgress({ stage: '', percent: 0, message: '' });
      if (backupInputRef.current) backupInputRef.current.value = '';
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
      const result = await pollRestoreProgress(jobId, (stage, percent, message, logs) => {
        setRestoreProgress({ stage, percent, message, logs: logs || [] });
      });
      toast(`恢复成功：${result.modelCount} 个模型，${result.thumbnailCount} 张缩略图`, 'success');
      setRestoreConfirmId(null);
      loadBackupList();
      loadBackupStats();
    } catch (err: any) {
      toast(err.message || '恢复失败', 'error');
    } finally {
      setRestoring(false);
      setRestoreProgress({ stage: '', percent: 0, message: '' });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Icon name="autorenew" size={32} className="text-on-surface-variant/30 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">系统设置</h2>
          <p className="text-sm text-on-surface-variant mt-1">配置平台的全局行为和访问策略</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !changed}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary-container text-on-primary rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 active:scale-95 transition-all"
        >
          <Icon name="save" size={16} />
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {GROUPS.map(group => (
          <div key={group.title} className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 bg-surface-container-high/50 flex items-center gap-2.5">
              <Icon name={group.icon} size={18} className="text-primary-container" />
              <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">{group.title}</h3>
            </div>
            <div className="divide-y divide-outline-variant/5">
              {group.items.map(item => (
                <div key={item.key} className={`px-6 py-4 flex ${item.type === 'textarea' ? 'flex-col gap-3' : item.type === 'color-scheme' ? 'flex-col gap-4' : 'items-center justify-between gap-4'} hover:bg-surface-container-high/30 transition-colors`}>
                  {item.type === 'color-scheme' ? (
                    <ColorSchemeEditor settings={settings} updateSetting={updateSetting} />
                  ) : (<>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface">{item.label}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
                  </div>
                  {item.type === 'switch' ? (
                    <Switch
                      checked={settings[item.key] as boolean}
                      onChange={(v) => updateSetting(item.key, v)}
                    />
                  ) : item.type === 'image' ? (
                    <div className="flex items-center gap-3">
                      {settings[item.key] && (
                        <img
                          src={settings[item.key] as string}
                          alt="预览"
                          className="w-20 h-12 object-contain bg-surface-container-lowest rounded border border-outline-variant/20"
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
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        min={0}
                        value={settings[item.key] as number}
                        onChange={(e) => updateSetting(item.key, Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-20 bg-surface-container-lowest text-on-surface text-sm text-center rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                      />
                      {item.key === 'daily_download_limit' && <span className="text-xs text-on-surface-variant">次/天</span>}
                    </div>
                  ) : item.type === 'textarea' ? (
                    <textarea
                      value={settings[item.key] as string}
                      onChange={(e) => updateSetting(item.key, e.target.value)}
                      placeholder={item.desc}
                      rows={3}
                      className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 resize-y font-mono"
                    />
                  ) : item.type === 'select' ? (
                    <select
                      value={settings[item.key] as string}
                      onChange={(e) => updateSetting(item.key, e.target.value)}
                      className="bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
                    >
                      {item.options?.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : item.type === 'color' ? (
                    <div className="flex items-center gap-2 shrink-0">
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
                        className="w-24 bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30 font-mono"
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
                      className="w-56 bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary placeholder:text-on-surface-variant/30"
                    />
                  )}
                  </>)}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Data Backup Section */}
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant/10 bg-surface-container-high/50 flex items-center gap-2.5">
            <Icon name="cloud_upload" size={18} className="text-primary-container" />
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">数据备份</h3>
          </div>
          <div className="divide-y divide-outline-variant/5">
            {/* Stats */}
            <div className="px-6 py-4">
              <div className="flex flex-wrap gap-4 text-sm">
                {backupStats && (
                  <>
                    <div className="flex items-center gap-2 bg-surface-container-high/50 px-3 py-1.5 rounded-md">
                      <Icon name="view_in_ar" size={14} className="text-primary-container" />
                      <span className="text-on-surface-variant">模型</span>
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
                  disabled={exporting}
                  className="px-4 py-2 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <Icon name="add" size={14} />
                  {exporting ? `${exportProgress.percent}%` : '创建备份'}
                </button>
              </div>
              {exporting && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1">
                    <span>{exportProgress.message}</span>
                    <span>{exportProgress.percent}%</span>
                  </div>
                  <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-container rounded-full transition-all duration-500"
                      style={{ width: `${exportProgress.percent}%` }}
                    />
                  </div>
                  {exportProgress.logs.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto bg-surface-container-highest/50 rounded p-2 text-[11px] font-mono text-on-surface-variant/70 space-y-0.5">
                      {exportProgress.logs.map((log, i) => <div key={i}>{log}</div>)}
                    </div>
                  )}
                </div>
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
                            <span>{b.modelCount} 个模型</span>
                            <span>{b.thumbnailCount} 张预览图</span>
                            <span>数据库 {b.dbSize}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button onClick={() => handleRestoreRequest(b.id)} className="px-2.5 py-1.5 text-xs font-medium bg-primary-container/15 text-primary-container rounded-md hover:bg-primary-container/25 transition-colors flex items-center gap-1">
                            <Icon name="restore" size={13} />恢复
                          </button>
                          <button onClick={() => handleDownloadBackup(b.id)} className="px-2.5 py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 transition-colors flex items-center gap-1">
                            <Icon name="download" size={13} />下载
                          </button>
                          <button onClick={() => { setRenamingId(b.id); setRenameValue(b.name); }} className="px-2.5 py-1.5 text-xs font-medium bg-surface-container-high/60 text-on-surface-variant rounded-md hover:bg-surface-container-highest/50 transition-colors flex items-center gap-1">
                            <Icon name="edit" size={13} />重命名
                          </button>
                          <button onClick={() => handleDelete(b.id)} className="px-2.5 py-1.5 text-xs font-medium bg-error-container/10 text-error rounded-md hover:bg-error-container/20 transition-colors flex items-center gap-1">
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
                                <>
                                  <p className="text-xs font-medium text-on-surface">{restoreProgress.message || '恢复中...'}</p>
                                  <div className="mt-2 w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
                                    <div
                                      className="h-full bg-primary rounded-full transition-all duration-500"
                                      style={{ width: `${restoreProgress.percent}%` }}
                                    />
                                  </div>
                                  <p className="text-xs text-on-surface-variant mt-1">{restoreProgress.percent}%</p>
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
            <div className="px-6 py-4">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <p className="text-sm font-medium text-on-surface">导入恢复</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">上传备份文件恢复数据（将覆盖当前数据）</p>
                </div>
                <div>
                  <input
                    ref={backupInputRef}
                    type="file"
                    onChange={handleBackupFileSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => backupInputRef.current?.click()}
                    disabled={importing}
                    className="px-4 py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    <Icon name="upload" size={14} />
                    选择文件
                  </button>
                </div>
              </div>

              {importing && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1">
                    <span>{restoreProgress.message || (uploadProgress < 100 ? '上传中...' : '上传完成，正在处理...')}</span>
                    <span>{restoreProgress.message ? `${restoreProgress.percent}%` : `${uploadProgress}%`}</span>
                  </div>
                  <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-container rounded-full transition-all duration-300"
                      style={{ width: `${restoreProgress.message ? restoreProgress.percent : uploadProgress}%` }}
                    />
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

            {/* System Update */}
            <div className="px-6 py-4 border-t border-outline-variant/10">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <p className="text-sm font-medium text-on-surface">系统更新</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    当前版本: <span className="font-mono text-primary-container">{updateInfo?.current || '—'}</span>
                    {updateInfo?.updateAvailable && (
                      <> · 最新版本: <span className="font-mono text-emerald-400">{updateInfo.remote}</span></>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate}
                    className="px-4 py-2 text-xs font-medium border border-outline-variant/40 text-on-surface-variant rounded-md hover:text-on-surface hover:bg-surface-container-high/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    <Icon name="search" size={14} className={checkingUpdate ? 'animate-spin' : ''} />
                    {checkingUpdate ? '检查中...' : '检查更新'}
                  </button>
                  {updateInfo?.updateAvailable && !updating && (
                    <button
                      onClick={handleUpdate}
                      className="px-4 py-2 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 transition-colors flex items-center gap-1.5"
                    >
                      <Icon name="sync" size={14} />
                      立即更新
                    </button>
                  )}
                </div>
              </div>

              {updateInfo?.warning && (
                <div className="mt-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-amber-400">{updateInfo.warning}</p>
                </div>
              )}

              {updating && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1">
                    <span>{updateProgress.message}</span>
                    <span>{updateProgress.percent}%</span>
                  </div>
                  <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: `${updateProgress.percent}%` }}
                    />
                  </div>
                  {updateProgress.logs.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto bg-surface-container-highest/50 rounded p-2 text-[11px] font-mono text-on-surface-variant/70 space-y-0.5">
                      {updateProgress.logs.map((log, i) => <div key={i}>{log}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
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
    <div className="flex flex-col h-screen bg-surface">
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
