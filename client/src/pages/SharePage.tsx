import { useState, useEffect, lazy, Suspense } from "react";
import { useParams, Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { getSiteTitle, getSiteIcon } from "../lib/publicSettings";
import Icon from "../components/shared/Icon";
import { getShareInfo, verifySharePassword, getShareDownloadUrl, type ShareInfo } from "../api/shares";

const isWechat = /MicroMessenger/i.test(navigator.userAgent);

const ModelViewer = lazy(() => import("../components/3d/ModelViewer"));

export default function SharePage() {
  const { token } = useParams<{ token: string }>();

  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useDocumentTitle(info ? `${info.modelName} - 分享预览` : "分享预览");

  async function loadInfo() {
    if (!token) return;
    try {
      const data = await getShareInfo(token);
      setInfo(data);
      setNeedPassword(data.hasPassword);
    } catch (err: any) {
      const detail = err.response?.data?.detail || "";
      if (err.response?.status === 410 || err.response?.data?.expired) {
        setExpired(true);
      } else {
        setError(detail || "获取分享信息失败");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadInfo(); }, [token]);

  async function handleVerifyPassword() {
    if (!token || !password.trim()) return;
    setPasswordError("");
    try {
      await verifySharePassword(token, password);
      setNeedPassword(false);
    } catch (err: any) {
      setPasswordError(err.response?.data?.detail || "密码错误");
    }
  }

  function handleDownload() {
    if (!token) return;
    setDownloading(true);
    const a = document.createElement("a");
    a.href = getShareDownloadUrl(token);
    a.download = "";
    a.click();
    setTimeout(() => setDownloading(false), 2000);
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  const siteTitle = getSiteTitle();
  const siteIcon = getSiteIcon();

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex items-center gap-3 text-on-surface-variant">
          <Icon name="progress_activity" size={24} className="animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  // Expired
  if (expired) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <Icon name="link_off" size={56} className="text-on-surface-variant/40 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-on-surface mb-2">链接已失效</h1>
          <p className="text-sm text-on-surface-variant mb-4">此分享链接已过期或已被撤销</p>
          <Link to="/" className="text-sm text-primary hover:underline">返回首页</Link>
        </div>
      </div>
    );
  }

  // Error
  if (error && !info) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <Icon name="error" size={56} className="text-error/50 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-on-surface mb-2">加载失败</h1>
          <p className="text-sm text-on-surface-variant mb-4">{error}</p>
          <Link to="/" className="text-sm text-primary hover:underline">返回首页</Link>
        </div>
      </div>
    );
  }

  // Password gate
  if (needPassword && info) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 overflow-hidden">
            <div className="px-6 py-5 border-b border-outline-variant/10 text-center">
              {siteIcon ? (
                <img src={siteIcon} alt={siteTitle} className="h-8 w-8 mx-auto mb-2 object-contain" />
              ) : (
                <Icon name="lock" size={32} className="text-primary-container mx-auto mb-2" />
              )}
              <h2 className="text-lg font-bold text-on-surface">{info.modelName}</h2>
              <p className="text-xs text-on-surface-variant mt-1">此分享链接需要密码访问</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleVerifyPassword()}
                placeholder="请输入访问密码"
                className="w-full bg-surface-container-lowest text-on-surface text-base rounded-md px-4 py-2.5 border border-outline-variant/20 outline-none focus:border-primary"
                autoFocus
              />
              {passwordError && <p className="text-xs text-error">{passwordError}</p>}
              <button
                onClick={handleVerifyPassword}
                className="w-full py-2.5 text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 active:scale-[0.98] transition-all"
              >
                验证
              </button>
            </div>
          </div>
          <p className="text-center text-xs text-on-surface-variant mt-4">
            <Link to="/" className="hover:text-primary transition-colors">← 返回首页</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!info) return null;

  // Main share page
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* WeChat open-in-browser guide */}
      {isWechat && (
        <div className="bg-primary-container/90 text-on-primary px-4 py-3 text-center text-sm font-bold relative shrink-0">
          <span>请点击右上角 <Icon name="more_horiz" size={14} className="inline" /> 选择「在浏览器中打开」</span>
        </div>
      )}
      <header className="h-12 flex items-center justify-between px-4 bg-surface-container-low border-b border-outline-variant/10 shrink-0">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          {siteIcon ? (
            <img src={siteIcon} alt={siteTitle} className="h-6 w-6 object-contain" />
          ) : (
            <Icon name="view_in_ar" size={20} className="text-primary-container" />
          )}
          <span className="text-sm font-bold text-on-surface">{siteTitle}</span>
        </Link>
        <span className="text-xs text-on-surface-variant/50">分享预览</span>
      </header>

      {/* Content — desktop: side-by-side, mobile: stacked scrollable */}
      <div className="flex-1 flex flex-col md:flex-row md:overflow-hidden">
        {/* 3D Preview — fixed height on mobile, flex-fill on desktop */}
        {info.allowPreview && info.gltfUrl && (
          <div className="h-[55vh] md:h-auto md:flex-1 bg-surface-container relative shrink-0">
            <Suspense fallback={
              <div className="w-full h-full flex items-center justify-center">
                <Icon name="view_in_ar" size={48} className="text-on-surface-variant/20 animate-pulse" />
              </div>
            }>
              <ModelViewer
                modelUrl={info.gltfUrl}
                viewMode="solid"
                cameraPreset="iso"
                showDimensions={false}
                showGrid={true}
                clipEnabled={false}
                clipDirection="x"
                clipPosition={0}
                materialPreset="default"
                showAxis={false}
              />
            </Suspense>
          </div>
        )}

        {/* Info panel */}
        <div className="w-full md:w-80 bg-surface-container-low border-t md:border-t-0 md:border-l border-outline-variant/10 p-5 space-y-4 shrink-0">
          <div>
            <h1 className="text-lg font-bold text-on-surface">{info.modelName}</h1>
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
                {info.downloadCount} 次下载
              </span>
            </div>
          </div>

          {info.description && (
            <p className="text-sm text-on-surface-variant">{info.description}</p>
          )}

          {/* Download button */}
          {info.allowDownload && (
            <div className="space-y-2">
              <button
                onClick={handleDownload}
                disabled={downloading || (info.downloadLimit > 0 && info.remainingDownloads <= 0)}
                className="w-full py-2.5 text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <Icon name="download" size={16} />
                {downloading ? "下载中..." : info.downloadLimit > 0 ? `下载（剩余 ${info.remainingDownloads} 次）` : "下载模型"}
              </button>
              {info.downloadLimit > 0 && (
                <p className="text-xs text-on-surface-variant text-center">
                  下载次数：{info.downloadCount} / {info.downloadLimit}
                </p>
              )}
            </div>
          )}

          {!info.allowPreview && !info.allowDownload && (
            <div className="bg-surface-container-high/50 rounded-lg p-3 text-center">
              <p className="text-xs text-on-surface-variant">此链接仅用于查看信息</p>
            </div>
          )}

          {/* Expiry notice */}
          {info.expiresAt && (
            <p className="text-xs text-on-surface-variant/50 text-center">
              链接有效期至 {new Date(info.expiresAt).toLocaleDateString('zh-CN')}
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="h-10 flex items-center justify-center border-t border-outline-variant/10 shrink-0">
        <span className="text-xs text-on-surface-variant/40">由 {siteTitle} 驱动</span>
      </footer>
    </div>
  );
}
