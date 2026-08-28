import { AnimatePresence, motion } from 'framer-motion';
import { useState, useEffect, lazy, Suspense, useCallback, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { getShareInfo, verifySharePassword, getShareDownloadUrl, type ShareInfo } from '../api/shares';
import type { CameraPreset, ViewMode } from '../components/3d/ModelViewer';
import { MATERIAL_PRESETS, type MaterialPresetKey } from '../components/3d/viewerControls';
import { DEFAULT_VIEWER_TUNING, viewerTuningFromSettings, type ViewerTuning } from '../components/3d/viewerTuning';
import BrandMark from '../components/shared/BrandMark';
import Icon from '../components/shared/Icon';
import {
  MODEL_DETAIL_DOWNLOAD_ROW_INTERACTIVE_CLASS,
  MODEL_DETAIL_MOBILE_BOTTOM_NAV_OFFSET,
  MODEL_DETAIL_SECTION_TITLE_CLASS,
} from '../components/shared/ModelDetailFrame';
import { PageTitle } from '../components/shared/PagePrimitives';
import PageRefreshFallback from '../components/shared/PageRefreshFallback';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import {
  cancelPreparedBrowserDownload,
  downloadBrowserFile,
  openDocumentUrl,
  prepareBrowserDownload,
} from '../lib/browserDownload';
import { getErrorMessage } from '../lib/errorNotifications';
import { bottomSheetMotion, overlayMotion } from '../lib/motion';
import {
  getCachedPublicSettings,
  getDefaultPreset,
  getPublicSettingsSnapshot,
  getSiteTitle,
} from '../lib/publicSettings';

const isWechat = /MicroMessenger/i.test(navigator.userAgent);

const loadCadViewerPanel = () => import('../components/3d/CadViewerPanel');
const CadViewerPanel = lazy(loadCadViewerPanel);

// 预取基础查看器模块（CadViewerPanel 内部按需加载；提前拉起缩短首次渲染等待）
const loadModelViewer = () => import('../components/3d/ModelViewer');

const VIEWER_PREFS_KEY = 'model_viewer_display_prefs_v1';
const noop = () => {};

// 无过期时间的分享，图纸链接用固定版本参数避免每次渲染生成不同 URL
const modelVersionFallback = 1;

// 有效期相对时间（紧凑版，用于元信息行）：<1h 分钟、<24h 小时、≥24h 天，永久显示「永久」
function formatExpiryShort(expiresAt: string | null, t: (key: string, opts?: Record<string, unknown>) => string) {
  if (!expiresAt) return t('sharePage.expiryNever');
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return t('sharePage.expiryExpired');
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return t('sharePage.expiryMinutesShort', { count: minutes });
  const hours = Math.ceil(ms / 3600000);
  if (hours < 24) return t('sharePage.expiryHoursShort', { count: hours });
  return t('sharePage.expiryDaysShort', { count: Math.ceil(hours / 24) });
}

function getShareViewerPrefs() {
  const settings = getPublicSettingsSnapshot();
  const defaultPreset = (getDefaultPreset() as MaterialPresetKey) || 'default';
  const defaultEdges = settings.viewer_edge_enabled !== false;
  try {
    const raw = window.localStorage.getItem(VIEWER_PREFS_KEY);
    if (!raw) return { materialPreset: defaultPreset, showEdges: defaultEdges };
    const parsed = JSON.parse(raw);
    const material = MATERIAL_PRESETS.some((p) => p.key === parsed.materialPreset)
      ? parsed.materialPreset
      : defaultPreset;
    return {
      materialPreset: material as MaterialPresetKey,
      showEdges: typeof parsed.showEdges === 'boolean' ? parsed.showEdges : defaultEdges,
    };
  } catch {
    return { materialPreset: defaultPreset, showEdges: defaultEdges };
  }
}

export default function SharePage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [shareAccessToken, setShareAccessToken] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const mobileDownloadBarRef = useRef<HTMLDivElement>(null);
  const [mobileDownloadBarHeight, setMobileDownloadBarHeight] = useState(0);
  // 移动端「文件下载」抽屉（对齐详情页底部弹层交互）
  const [downloadDrawerOpen, setDownloadDrawerOpen] = useState(false);

  // 查看器显示状态（对齐详情页/临时预览页的访客态工具集）
  const initialPrefs = useRef(getShareViewerPrefs()).current;
  const [activeView, setActiveView] = useState<ViewMode>('solid');
  const [activeCamera, setActiveCamera] = useState<CameraPreset>('iso');
  const [showDimensions, setShowDimensions] = useState(false);
  const [materialPreset, setMaterialPreset] = useState<MaterialPresetKey>(initialPrefs.materialPreset);
  const [showEdges, setShowEdges] = useState(initialPrefs.showEdges);
  const [showAxis, setShowAxis] = useState(false);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipPosition, setClipPosition] = useState(0);
  const [clipDirection, setClipDirection] = useState<'x' | 'y' | 'z'>('x');
  const [clipInverted, setClipInverted] = useState(false);
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const [viewerTuning, setViewerTuning] = useState<ViewerTuning>(DEFAULT_VIEWER_TUNING);

  useEffect(() => {
    getCachedPublicSettings()
      .then((settings) => setViewerTuning(viewerTuningFromSettings(settings as Partial<ViewerTuning>)))
      .catch(() => {});
  }, []);

  const handleResetDisplay = useCallback(() => {
    setActiveView('solid');
    setActiveCamera('iso');
    setShowDimensions(false);
    setMaterialPreset(initialPrefs.materialPreset);
    setShowEdges(initialPrefs.showEdges);
    setShowAxis(false);
    setClipEnabled(false);
    setClipDirection('x');
    setClipPosition(0);
    setClipInverted(false);
  }, [initialPrefs.materialPreset, initialPrefs.showEdges]);

  const handleResetViewerTuning = useCallback(() => setViewerTuning(DEFAULT_VIEWER_TUNING), []);

  useDocumentTitle(info ? `${info.modelName} - ${t('sharePage.preview')}` : t('sharePage.preview'));

  const loadInfo = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getShareInfo(token);
      if (data.allowPreview && data.gltfUrl) void loadCadViewerPanel();
      if (data.allowPreview && data.gltfUrl) void loadModelViewer();
      setInfo(data);
      setNeedPassword(data.hasPassword);
    } catch (err: unknown) {
      const response =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { status?: number; data?: { expired?: boolean } } }).response
          : undefined;
      if (response?.status === 410 || response?.data?.expired) {
        setExpired(true);
      } else {
        setError(getErrorMessage(err, t('sharePage.loadShareFailed')));
      }
    } finally {
      setLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  // 移动端底部操作条：有下载或图纸入口才出现（只读分享也可能带图纸）
  const hasMobileActionBar = !!info && (info.allowDownload || (info.drawings?.length ?? 0) > 0 || !!info.drawingUrl);

  useEffect(() => {
    const bar = mobileDownloadBarRef.current;
    if ((!info?.allowDownload && (info?.drawings?.length ?? 0) === 0 && !info?.drawingUrl) || !bar) {
      setMobileDownloadBarHeight(0);
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.ceil(bar.getBoundingClientRect().height);
      setMobileDownloadBarHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(bar);
    window.addEventListener('resize', updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [
    downloading,
    info?.allowDownload,
    info?.drawingUrl,
    info?.drawings?.length,
    info?.modelName,
    info?.remainingDownloads,
  ]);

  const mobilePreviewCtaHeight =
    !isDesktop && (info?.allowDownload || (info?.drawings?.length ?? 0) > 0 || info?.drawingUrl)
      ? mobileDownloadBarHeight || 96
      : 0;

  useEffect(() => {
    if (isDesktop || !info?.allowPreview || !info.gltfUrl || mobilePreviewCtaHeight <= 0) return;
    // 移动端操作条高度变化后让查看器重新适配模型居中（面板内部响应 resize）
    void mobilePreviewCtaHeight;
  }, [info?.allowPreview, info?.gltfUrl, isDesktop, mobilePreviewCtaHeight]);

  async function handleVerifyPassword() {
    if (!token || !password.trim()) return;
    setPasswordError('');
    try {
      const verified = await verifySharePassword(token, password);
      if (!verified.accessToken) throw new Error(t('sharePage.accessTokenMissing'));
      setShareAccessToken(verified.accessToken);
      setPassword('');
      const data = await getShareInfo(token, verified.accessToken);
      if (data.allowPreview && data.gltfUrl) void loadCadViewerPanel();
      if (data.allowPreview && data.gltfUrl) void loadModelViewer();
      setInfo(data);
      setNeedPassword(false);
    } catch (err: unknown) {
      setPasswordError(getErrorMessage(err, t('sharePage.passwordError')));
    }
  }

  async function handleDownload() {
    if (!token) return;
    if (info?.hasPassword && !shareAccessToken) {
      setNeedPassword(true);
      return;
    }
    const preparedWindow = prepareBrowserDownload();
    setDownloading(true);
    try {
      await downloadBrowserFile(getShareDownloadUrl(token, info?.hasPassword ? shareAccessToken : undefined), {
        preparedWindow,
      });
    } catch (err) {
      cancelPreparedBrowserDownload(preparedWindow);
      setError(getErrorMessage(err, t('sharePage.downloadFailed')));
    } finally {
      setDownloading(false);
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${Number.isInteger(kb) ? kb : kb.toFixed(1)}KB`;
    const mb = kb / 1024;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
  }

  const siteTitle = getSiteTitle();
  const shareContentStyle = {
    '--share-mobile-bottom-offset': MODEL_DETAIL_MOBILE_BOTTOM_NAV_OFFSET,
    '--share-mobile-cta-height': `${mobilePreviewCtaHeight}px`,
  } as CSSProperties;

  // Loading
  if (loading) {
    return <PageRefreshFallback standalone label={t('sharePage.refreshLabel')} />;
  }

  // Expired
  if (expired) {
    return (
      <PublicPageShell>
        <div className="flex flex-1 items-center justify-center bg-surface">
          <div className="text-center">
            <Icon name="link_off" size={56} className="text-on-surface-variant/40 mx-auto mb-4" />
            <PageTitle className="mb-2">{t('sharePage.expiredTitle')}</PageTitle>
            <p className="text-sm text-on-surface-variant mb-4">{t('sharePage.expiredDescription')}</p>
            <Link to="/" className="text-sm text-primary hover:underline">
              {t('sharePage.backHome')}
            </Link>
          </div>
        </div>
      </PublicPageShell>
    );
  }

  // Error
  if (error && !info) {
    return (
      <PublicPageShell>
        <div className="flex flex-1 items-center justify-center bg-surface">
          <div className="text-center">
            <Icon name="error" size={56} className="text-error/50 mx-auto mb-4" />
            <PageTitle className="mb-2">{t('sharePage.loadFailed')}</PageTitle>
            <p className="text-sm text-on-surface-variant mb-4">{error}</p>
            <Link to="/" className="text-sm text-primary hover:underline">
              {t('sharePage.backHome')}
            </Link>
          </div>
        </div>
      </PublicPageShell>
    );
  }

  // Password gate
  if (needPassword && info) {
    return (
      <PublicPageShell>
        <div className="flex flex-1 items-center justify-center bg-surface p-4">
          <div className="w-full max-w-sm">
            <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 overflow-hidden">
              <div className="px-6 py-5 border-b border-outline-variant/10 text-center">
                <BrandMark size="compact" centered className="mx-auto mb-2 max-w-full" />
                <h2 className="text-lg font-bold text-on-surface">{info.modelName}</h2>
                <p className="text-xs text-on-surface-variant mt-1">{t('sharePage.passwordRequired')}</p>
              </div>
              <div className="px-6 py-5 space-y-4">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyPassword()}
                  placeholder={t('sharePage.passwordPlaceholder')}
                  className="w-full bg-surface-container-lowest text-on-surface text-base rounded-md px-4 py-2.5 border border-outline-variant/20 outline-none focus:border-primary"
                  autoFocus
                />
                {passwordError && <p className="text-xs text-error">{passwordError}</p>}
                <button
                  onClick={handleVerifyPassword}
                  className="w-full py-2.5 text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 active:scale-[0.98] transition-all"
                >
                  {t('sharePage.verify')}
                </button>
              </div>
            </div>
            <p className="text-center text-xs text-on-surface-variant mt-4">
              <Link to="/" className="hover:text-primary transition-colors">
                &larr; {t('sharePage.backHome')}
              </Link>
            </p>
          </div>
        </div>
      </PublicPageShell>
    );
  }

  if (!info) return null;

  const downloadDisabled = downloading || (info.downloadLimit > 0 && info.remainingDownloads <= 0);
  // 有密码的分享，图纸接口与下载接口一样需要带上 share_access_token；
  // 无密码分享仅以模型更新时间做缓存版本号（保持与后端 withAssetVersion 一致的语义）
  const drawingVersion = new Date(info.expiresAt ?? 0).getTime();
  const drawingQuery =
    info.hasPassword && shareAccessToken
      ? `share_access_token=${encodeURIComponent(shareAccessToken)}`
      : `v=${encodeURIComponent(String(drawingVersion || modelVersionFallback))}`;
  const buildDrawingHref = (path: string) => `${path}${path.includes('?') ? '&' : '?'}${drawingQuery}`;
  // 后端 /info 已带 drawings 数组；旧缓存窗口回落单条 drawingUrl
  const drawingEntries: Array<{ id: string; name: string; href: string }> = (info.drawings || []).map((d) => ({
    id: d.id,
    name: d.name,
    href: buildDrawingHref(`/api/shares/${encodeURIComponent(token!)}/drawing/${encodeURIComponent(d.id)}`),
  }));
  if (drawingEntries.length === 0 && info.drawingUrl) {
    drawingEntries.push({
      id: '',
      name: t('sharePage.drawingTitle'),
      href: buildDrawingHref(info.drawingUrl),
    });
  }
  // 文件下载行（对齐模型详情页的卡片样式：格式徽章 + 文件名 + 大小 + 圆形操作钮）
  const formatLabel = (info.format || 'STEP').toUpperCase();
  const modelFileName = info.modelName || `${t('sharePage.preview')}.${(info.format || 'step').toLowerCase()}`;
  const fileSizeLabel = formatSize(info.fileSize);
  const limitText =
    info.downloadLimit > 0
      ? t('sharePage.downloadCount', { count: info.downloadCount, limit: info.downloadLimit })
      : '';

  const renderModelDownloadRow = (compact = false) =>
    info.allowDownload ? (
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloadDisabled}
        className={`${MODEL_DETAIL_DOWNLOAD_ROW_INTERACTIVE_CLASS} ${compact ? 'min-h-0 py-1.5' : ''} cursor-pointer text-left disabled:opacity-50`}
        title={downloading ? t('sharePage.downloading') : modelFileName}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={`${compact ? 'h-7 w-7' : 'h-9 w-9'} rounded-lg bg-primary-container/10 flex items-center justify-center shrink-0`}
          >
            <span className={`${compact ? 'text-[8px]' : 'text-[10px]'} font-bold text-primary-container`}>
              {formatLabel.slice(0, 4)}
            </span>
          </div>
          <div className="min-w-0">
            <div className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-on-surface truncate`}>
              {downloading ? t('sharePage.downloading') : modelFileName}
            </div>
            <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-on-surface-variant mt-0.5`}>
              {formatLabel} · {fileSizeLabel}
              {info.downloadLimit > 0 && ` · ${t('sharePage.downloadRemaining', { count: info.remainingDownloads })}`}
            </div>
          </div>
        </div>
        <div className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary active:scale-90 transition-all">
          <Icon name="download" size={16} />
        </div>
      </button>
    ) : null;

  const renderDrawingRow = (drawing: { id: string; name: string; href: string }, compact = false, keySuffix = '') => (
    <a
      key={drawing.id || `drawing-${keySuffix}`}
      href={drawing.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        openDocumentUrl(drawing.href, { title: drawing.name || t('sharePage.drawingTitle') });
      }}
      className={`${MODEL_DETAIL_DOWNLOAD_ROW_INTERACTIVE_CLASS} ${compact ? 'min-h-0 py-1.5' : ''} cursor-pointer text-left`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={`${compact ? 'h-7 w-7' : 'h-9 w-9'} rounded-lg bg-error/10 flex items-center justify-center shrink-0`}
        >
          <span className={`${compact ? 'text-[8px]' : 'text-[10px]'} font-bold text-error`}>PDF</span>
        </div>
        <div className="min-w-0">
          <div
            className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-on-surface truncate`}
            title={drawing.name}
          >
            {drawing.name || t('sharePage.drawingTitle')}
          </div>
          <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-on-surface-variant mt-0.5`}>PDF</div>
        </div>
      </div>
      <div className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon name="open_in_new" size={15} />
      </div>
    </a>
  );

  // 文件下载区块（桌面信息面板用；行间距对齐详情页）
  const hasDownloadSection = info.allowDownload || drawingEntries.length > 0;
  const renderDownloadSection = (options: { compact?: boolean; hideTitle?: boolean } = {}) => {
    const { compact = false, hideTitle = false } = options;
    return hasDownloadSection ? (
      <div>
        {!compact && !hideTitle && (
          <div className={MODEL_DETAIL_SECTION_TITLE_CLASS}>{t('sharePage.fileDownloads')}</div>
        )}
        <div className="flex flex-col gap-1.5">
          {renderModelDownloadRow(compact)}
          {drawingEntries.map((drawing, index) => renderDrawingRow(drawing, compact, String(index)))}
        </div>
        {!compact && limitText && <p className="mt-2 text-xs text-on-surface-variant">{limitText}</p>}
        {compact && limitText && <p className="mt-1.5 px-1 text-[10px] text-on-surface-variant">{limitText}</p>}
      </div>
    ) : null;
  };

  // Main share page
  return (
    <PublicPageShell mobileClassName="flex h-dvh flex-col bg-surface" keepMobileDrawerMounted>
      {/* WeChat open-in-browser guide */}
      {isWechat && (
        <div className="bg-primary-container/90 text-on-primary px-4 py-3 text-center text-sm font-bold relative shrink-0">
          <span>
            {t('sharePage.wechatGuide')} <Icon name="more_horiz" size={14} className="inline" />
          </span>
        </div>
      )}
      <header className="min-h-12 flex items-center justify-between gap-3 px-4 py-2 bg-surface-container-low border-b border-outline-variant/10 shrink-0">
        <span className="text-xs text-on-surface-variant/50 shrink-0">{t('sharePage.preview')}</span>
      </header>

      {/* Content — desktop: side-by-side, mobile: centered preview with a lightweight bottom CTA */}
      <div
        className="relative mb-[var(--share-mobile-bottom-offset)] flex min-h-0 flex-1 flex-col overflow-hidden md:mb-0 md:flex-row"
        style={shareContentStyle}
      >
        {/* 3D Preview */}
        {info.allowPreview && info.gltfUrl ? (
          // 移动端：absolute 容器给底部操作条让位（面板 mobile 根类是 absolute inset-0 铺满容器）
          // 桌面端：面板根类是 flex 子元素（flex-1 + stretch 拿高度），必须直接挂在 flex-row 下——
          // 套任何 display:block 的中间层都会让 flex-1 高度塌成 0（模型渲染进 0 高区域）
          isDesktop ? (
            <Suspense
              fallback={
                <div className="flex w-full items-center justify-center">
                  <Icon name="view_in_ar" size={48} className="text-on-surface-variant/20 animate-pulse" />
                </div>
              }
            >
              <CadViewerPanel
                variant="desktop"
                isAdmin={false}
                modelUrl={info.gltfUrl}
                modelName={info.modelName}
                modelFormat={info.format}
                modelFileSize={formatSize(info.fileSize)}
                activeView={activeView}
                onViewChange={setActiveView}
                activeCamera={activeCamera}
                onCameraChange={setActiveCamera}
                showDimensions={showDimensions}
                onToggleDimensions={() => setShowDimensions(!showDimensions)}
                materialPreset={materialPreset}
                onMaterialChange={setMaterialPreset}
                showEdges={showEdges}
                onToggleEdges={() => setShowEdges(!showEdges)}
                clipEnabled={clipEnabled}
                onToggleClip={() => setClipEnabled((enabled) => !enabled)}
                clipPosition={clipPosition}
                onClipPositionChange={setClipPosition}
                clipDirection={clipDirection}
                onClipDirectionChange={setClipDirection}
                clipInverted={clipInverted}
                onToggleClipInverted={() => setClipInverted((inverted) => !inverted)}
                onResetClip={() => {
                  setClipDirection('x');
                  setClipPosition(0);
                  setClipInverted(false);
                }}
                showAxis={showAxis}
                onToggleAxis={() => setShowAxis(!showAxis)}
                onResetDisplay={handleResetDisplay}
                tuningOpen={false}
                onToggleTuning={noop}
                viewerTuning={viewerTuning}
                onViewerTuningChange={setViewerTuning}
                onApplyViewerPreset={setViewerTuning}
                onResetViewerTuning={handleResetViewerTuning}
                onSaveViewerTuning={noop}
                viewerTuningSaving={false}
                onPseudoFullscreenChange={setViewerFullscreen}
              />
            </Suspense>
          ) : (
            <div className="relative min-h-0 flex-1 bg-surface-container">
              <div className="absolute inset-x-0 top-0 bottom-[var(--share-mobile-cta-height)]">
                <Suspense
                  fallback={
                    <div className="w-full h-full flex items-center justify-center">
                      <Icon name="view_in_ar" size={48} className="text-on-surface-variant/20 animate-pulse" />
                    </div>
                  }
                >
                  <CadViewerPanel
                    variant="mobile"
                    isAdmin={false}
                    modelUrl={info.gltfUrl}
                    modelName={info.modelName}
                    modelFormat={info.format}
                    modelFileSize={formatSize(info.fileSize)}
                    activeView={activeView}
                    onViewChange={setActiveView}
                    activeCamera={activeCamera}
                    onCameraChange={setActiveCamera}
                    showDimensions={showDimensions}
                    onToggleDimensions={() => setShowDimensions(!showDimensions)}
                    materialPreset={materialPreset}
                    onMaterialChange={setMaterialPreset}
                    showEdges={showEdges}
                    onToggleEdges={() => setShowEdges(!showEdges)}
                    clipEnabled={clipEnabled}
                    onToggleClip={() => setClipEnabled((enabled) => !enabled)}
                    clipPosition={clipPosition}
                    onClipPositionChange={setClipPosition}
                    clipDirection={clipDirection}
                    onClipDirectionChange={setClipDirection}
                    clipInverted={clipInverted}
                    onToggleClipInverted={() => setClipInverted((inverted) => !inverted)}
                    onResetClip={() => {
                      setClipDirection('x');
                      setClipPosition(0);
                      setClipInverted(false);
                    }}
                    showAxis={showAxis}
                    onToggleAxis={() => setShowAxis(!showAxis)}
                    onResetDisplay={handleResetDisplay}
                    tuningOpen={false}
                    onToggleTuning={noop}
                    viewerTuning={viewerTuning}
                    onViewerTuningChange={setViewerTuning}
                    onApplyViewerPreset={setViewerTuning}
                    onResetViewerTuning={handleResetViewerTuning}
                    onSaveViewerTuning={noop}
                    viewerTuningSaving={false}
                    onPseudoFullscreenChange={setViewerFullscreen}
                  />
                </Suspense>
              </div>
            </div>
          )
        ) : (
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-surface-container">
            <div className="absolute inset-x-0 top-0 bottom-[var(--share-mobile-cta-height)] flex items-center justify-center md:bottom-0">
              <div className="text-center">
                <Icon name="view_in_ar" size={48} className="mx-auto text-on-surface-variant/20" />
                <p className="mt-3 text-xs text-on-surface-variant">{t('sharePage.noPreview')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Info panel */}
        <div className="hidden w-full shrink-0 space-y-4 border-t border-outline-variant/10 bg-surface-container-low p-5 md:block md:w-80 md:border-l md:border-t-0">
          <div>
            <PageTitle className="break-words text-lg md:text-lg md:normal-case">{info.modelName}</PageTitle>
            {/* 一行紧凑元信息：格式 · 大小 · 有效期（下载次数去掉，图标回归保持美观） */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
              <span className="flex items-center gap-1">
                <Icon name="description" size={12} />
                {formatLabel}
              </span>
              <span className="flex items-center gap-1">
                <Icon name="data_usage" size={12} />
                {fileSizeLabel}
              </span>
              <span
                className="flex items-center gap-1"
                title={
                  info.expiresAt
                    ? t('sharePage.expiryFullTitle', {
                        date: new Date(info.expiresAt).toLocaleString(undefined, {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        }),
                      })
                    : t('sharePage.expiryNever')
                }
              >
                <Icon name="schedule" size={12} />
                {formatExpiryShort(info.expiresAt, t)}
              </span>
            </div>
          </div>

          {info.description && <p className="text-sm text-on-surface-variant break-words">{info.description}</p>}

          {/* File downloads（卡片行样式对齐详情页） */}
          <div className="hidden md:block">{renderDownloadSection()}</div>

          {!info.allowPreview && !info.allowDownload && (
            <div className="bg-surface-container-high/50 rounded-lg p-3 text-center">
              <p className="text-xs text-on-surface-variant">{t('sharePage.infoOnly')}</p>
            </div>
          )}
        </div>

        {hasMobileActionBar && !viewerFullscreen ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 md:hidden">
            <div
              ref={mobileDownloadBarRef}
              className="pointer-events-auto rounded-t-xl border-t border-outline-variant/10 bg-surface-container-low/95 px-2.5 pb-2.5 pt-3 backdrop-blur-md"
            >
              <h2 className="mb-2 line-clamp-1 break-words px-0.5 text-sm font-bold leading-tight text-on-surface">
                {info.modelName}
              </h2>
              <button
                type="button"
                onClick={() => setDownloadDrawerOpen(true)}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary-container text-sm font-medium text-on-primary transition-transform active:scale-[0.98]"
              >
                <Icon name="folder_open" size={18} />
                {t('sharePage.fileDownloads')}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* 移动端文件下载抽屉（对齐详情页底部弹层样式） */}
      <AnimatePresence>
        {downloadDrawerOpen && !isDesktop && info && (
          <>
            <motion.div
              key="share-download-backdrop"
              variants={overlayMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              className="fixed inset-0 z-[200] bg-black/50"
              onClick={() => setDownloadDrawerOpen(false)}
            />
            <motion.div
              key="share-download-sheet"
              variants={bottomSheetMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              className="fixed inset-x-0 bottom-0 z-[201] mx-auto max-w-lg rounded-t-2xl border-t border-outline-variant/20 bg-surface-container-low pb-[env(safe-area-inset-bottom,0px)] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 pb-1 pt-3">
                <h3 className="text-sm font-bold text-on-surface">{t('sharePage.fileDownloads')}</h3>
                <button
                  type="button"
                  onClick={() => setDownloadDrawerOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
                  aria-label={t('sharePage.closeDrawer')}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
              <div className="max-h-[60dvh] overflow-y-auto px-3 pb-4 pt-2">
                {renderDownloadSection({ hideTitle: true })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="hidden h-10 shrink-0 items-center justify-center border-t border-outline-variant/10 md:flex">
        <span className="text-xs text-on-surface-variant/40">{t('sharePage.footerPoweredBy', { siteTitle })}</span>
      </footer>
    </PublicPageShell>
  );
}
