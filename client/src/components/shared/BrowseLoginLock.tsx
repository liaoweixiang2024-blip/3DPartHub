import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCachedPublicSettings, getPublicSettingsSnapshot } from '../../lib/publicSettings';
import { useAuthStore } from '../../stores/useAuthStore';
import Icon from './Icon';
import { useAuthEntry } from './useAuthEntry';

/**
 * require_login_browse / require_login_selection 开启时匿名访客的全屏锁屏：
 * 背景用骨架卡片 + 大半径模糊示意「内容就在眼前」，前景只有居中提示卡这一处登录提示
 * （不再叠加确认弹窗，避免重复打扰）；「前往登录」直达登录弹窗/登录页。
 */
export default function BrowseLoginLock({ scope = 'models' }: { scope?: 'models' | 'selection' }) {
  const { t } = useTranslation();
  const description = t(scope === 'selection' ? 'home.browseSelectionLoginDescription' : 'home.browseLoginDescription');
  const { authNodes, openAuthEntry } = useAuthEntry();

  return (
    <div className="relative h-dvh overflow-hidden bg-surface">
      {/* 背景：内容示意（骨架卡片）+ 模糊，营造「登录后即可浏览」的效果 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
        <div className="absolute inset-0 scale-110 blur-2xl sm:blur-3xl">
          <div className="grid h-full w-full grid-cols-2 gap-3 p-4 opacity-80 sm:grid-cols-4 sm:gap-4 sm:p-6">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className={`rounded-xl border border-outline-variant/10 ${
                  i % 3 === 0 ? 'bg-surface-container-high/70' : 'bg-surface-container/60'
                } ${i % 4 === 1 ? 'mt-6' : ''} ${i % 4 === 3 ? 'mb-6' : ''}`}
              />
            ))}
          </div>
        </div>
        {/* 轻微压暗，保证前景提示可读 */}
        <div className="absolute inset-0 bg-surface/35" />
      </div>
      {/* 居中提示卡：唯一的登录提示入口 */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-5 px-4 text-center sm:gap-6">
        <span className="grid h-20 w-20 place-items-center rounded-3xl border border-outline-variant/15 bg-surface-container/90 text-on-surface-variant/60 shadow-modal backdrop-blur-sm">
          <Icon name="lock" size={40} />
        </span>
        <div className="max-w-sm">
          <h2 className="text-xl font-bold text-on-surface">{t('protected.loginTitle')}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-on-surface-variant">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => void openAuthEntry()}
          className="rounded-lg bg-primary-container px-8 py-2.5 text-sm font-medium text-on-primary shadow-modal transition-transform active:scale-95 hover:opacity-90"
        >
          {t('protected.goLogin')}
        </button>
      </div>
      {authNodes}
    </div>
  );
}

/**
 * 浏览门槛判定 hook（require_login_browse=模型列表 / require_login_selection=选型页，两开关独立）：
 * 有缓存的公开设置时同步初始化（匿名首访不会先发请求再吃 401），
 * 否则异步补拉最新设置。dataReady=false 表示门槛未判定/被拦截，页面应暂停受门槛约束的请求。
 */
export function useBrowseGate(settingKey: 'require_login_browse' | 'require_login_selection' = 'require_login_browse') {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [state, setState] = useState(() => {
    const snapshot = getPublicSettingsSnapshot();
    if (!snapshot || typeof snapshot[settingKey] !== 'boolean') {
      return { resolved: false, blocked: false };
    }
    const auth = useAuthStore.getState();
    const blocked = snapshot[settingKey] === true && auth.hasHydrated && !auth.isAuthenticated;
    return { resolved: true, blocked };
  });

  useEffect(() => {
    if (isAuthenticated) {
      setState((prev) => (prev.resolved && !prev.blocked ? prev : { resolved: true, blocked: false }));
      return;
    }
    getCachedPublicSettings()
      .then((s) => setState({ resolved: true, blocked: s[settingKey] === true }))
      .catch(() => setState({ resolved: true, blocked: false }));
  }, [isAuthenticated, settingKey]);

  return {
    blocked: state.resolved && state.blocked,
    dataReady: state.resolved && !state.blocked,
  };
}
