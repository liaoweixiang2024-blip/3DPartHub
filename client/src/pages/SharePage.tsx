import { useState, useEffect, lazy, Suspense, useCallback, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { getShareInfo, verifySharePassword, getShareDownloadUrl, type ShareInfo } from '../api/shares';
import { MATERIAL_PRESETS, type MaterialPresetKey } from '../components/3d/viewerControls';
import { dispatchFitModel } from '../components/3d/viewerEvents';
import BrandMark from '../components/shared/BrandMark';
import Icon from '../components/shared/Icon';
import { MODEL_DETAIL_MOBILE_BOTTOM_NAV_OFFSET } from '../components/shared/ModelDetailFrame';
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
import { getDefaultPreset, getPublicSettingsSnapshot, getSiteTitle } from '../lib/publicSettings';

const isWechat = /MicroMessenger/i.test(navigator.userAgent);

const loadModelViewer = () => import('../components/3d/ModelViewer');
const ModelViewer = lazy(loadModelViewer);

const VIEWER_PREFS_KEY = 'model_viewer_display_prefs_v1';

// 无过期时间的分享，图纸链接用固定版本参数避免每次渲染生成不同 URL
const modelVersionFallback = 1;

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
  const { i18n, t } = useTranslation();
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

  useDocumentTitle(info ? `${info.modelName} - ${t('sharePage.preview')}` : t('sharePage.preview'));

  const loadInfo = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getShareInfo(token);
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

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(dispatchFitModel);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
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
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const downloadLabel = downloading
    ? t('sharePage.downloading')
    : info.downloadLimit > 0
      ? t('sharePage.downloadRemaining', { count: info.remainingDownloads })
      : t('sharePage.download');
  const renderDownloadButton = (showLimitText = true) =>
    info.allowDownload ? (
      <div className="space-y-2">
        <button
          onClick={handleDownload}
          disabled={downloadDisabled}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary-container text-sm font-medium text-on-primary transition-transform hover:opacity-90 disabled:opacity-50 active:scale-[0.98]"
        >
          <Icon name="download" size={18} />
          {downloadLabel}
        </button>
        {showLimitText && info.downloadLimit > 0 && (
          <p className="text-center text-xs text-on-surface-variant">
            {t('sharePage.downloadCount', { count: info.downloadCount, limit: info.downloadLimit })}
          </p>
        )}
      </div>
    ) : null;

  // 移动端底部操作条里的图纸入口（桌面端在信息面板里已有）
  const renderMobileDrawingButton = () =>
    drawingEntries.length > 0 ? (
      <>
        {drawingEntries.map((drawing, index) => (
          <a
            key={drawing.id || `drawing-${index}`}
            href={drawing.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openDocumentUrl(drawing.href, { title: drawing.name || t('sharePage.drawingTitle') });
            }}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-surface-container-high text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest active:scale-[0.98]"
          >
            <Icon name="description" size={18} />
            <span className="truncate">{drawing.name || t('sharePage.drawingTitle')}</span>
            <Icon name="open_in_new" size={16} className="text-on-surface-variant/50 shrink-0" />
          </a>
        ))}
      </>
    ) : null;

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
          <div className="relative min-h-0 flex-1 bg-surface-container">
            <div className="absolute inset-x-0 top-0 bottom-[var(--share-mobile-cta-height)] md:bottom-0">
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center">
                    <Icon name="view_in_ar" size={48} className="text-on-surface-variant/20 animate-pulse" />
                  </div>
                }
              >
                <ModelViewer
                  modelUrl={info.gltfUrl}
                  viewMode="solid"
                  cameraPreset="iso"
                  showDimensions={false}
                  showGrid={true}
                  clipEnabled={false}
                  clipDirection="x"
                  clipPosition={0}
                  materialPreset={getShareViewerPrefs().materialPreset}
                  showEdges={getShareViewerPrefs().showEdges}
                  showAxis={false}
                />
              </Suspense>
            </div>
          </div>
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
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-on-surface-variant">
              <span className="flex items-center gap-1">
                <Icon name="description" size={12} />
                {info.format?.toUpperCase()}
              </span>
              <span className="flex items-center gap-1">
                <Icon name="data_usage" size={12} />
                {formatSize(info.fileSize)}
              </span>
              <span className="flex items-center gap-1">
                <Icon name="visibility" size={12} />
                {t('sharePage.downloadTotal', { count: info.downloadCount })}
              </span>
            </div>
          </div>

          {info.description && <p className="text-sm text-on-surface-variant break-words">{info.description}</p>}

          {/* Drawings */}
          {drawingEntries.map((drawing, index) => (
            <a
              key={drawing.id || `drawing-${index}`}
              href={drawing.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.preventDefault();
                openDocumentUrl(drawing.href, { title: drawing.name || t('sharePage.drawingTitle') });
              }}
              className="flex items-center gap-3 rounded-lg bg-surface-container-high px-4 py-3 text-sm text-on-surface hover:bg-surface-container-highest transition-colors"
            >
              <Icon name="description" size={20} className="text-on-surface-variant shrink-0" />
              <span className="truncate" title={drawing.name}>
                {drawing.name || t('sharePage.drawingTitle')}
              </span>
              <Icon name="open_in_new" size={16} className="text-on-surface-variant/50 shrink-0 ml-auto" />
            </a>
          ))}

          {/* Download button */}
          <div className="hidden md:block">{renderDownloadButton()}</div>

          {!info.allowPreview && !info.allowDownload && (
            <div className="bg-surface-container-high/50 rounded-lg p-3 text-center">
              <p className="text-xs text-on-surface-variant">{t('sharePage.infoOnly')}</p>
            </div>
          )}

          {/* Expiry notice */}
          {info.expiresAt && (
            <p className="text-xs text-on-surface-variant/50 text-center">
              {t('sharePage.validUntil', { date: new Date(info.expiresAt).toLocaleDateString(i18n.language) })}
            </p>
          )}
        </div>

        {hasMobileActionBar ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 md:hidden">
            <div
              ref={mobileDownloadBarRef}
              className="pointer-events-auto rounded-t-xl border-t border-outline-variant/10 bg-surface-container-low/95 px-2.5 pb-2.5 pt-3 backdrop-blur-md"
            >
              <h2 className="mb-2 line-clamp-2 break-words px-0.5 text-sm font-bold leading-[1.15rem] text-on-surface">
                {info.modelName}
              </h2>
              <div className="space-y-2">
                {renderDownloadButton(false)}
                {renderMobileDrawingButton()}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <footer className="hidden h-10 shrink-0 items-center justify-center border-t border-outline-variant/10 md:flex">
        <span className="text-xs text-on-surface-variant/40">{t('sharePage.footerPoweredBy', { siteTitle })}</span>
      </footer>
    </PublicPageShell>
  );
}
