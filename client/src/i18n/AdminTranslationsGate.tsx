import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../components/shared/Icon';
import { ensureAdminTranslationsLoaded, normalizeLocale, type SupportedLocale } from './index';

/**
 * 后台管理文案加载闸门：包住所有 /admin/* 路由的内容。
 *
 * admin-only 命名空间（15 个，~2100 条）不在主语言包里——前台访客首屏
 * 不下载（见 resources.ts / i18n/index.ts 的按需注入链路）。本组件在进入
 * 后台时补载当前语言（+zh-CN 兜底）的 admin 包。
 *
 * 时序：children 保持挂载但 invisible——admin 页面的懒加载 chunk 与语言包
 * chunk 并行下载；未就绪期间页面内 t() 可能返回裸键，被覆盖层遮住不可见；
 * 就绪后 setState 揭幕，整棵子树重渲染取到已注入的翻译。不采用「就绪前
 * 不渲染 children」——那会把页面 chunk 的加载串行到语言包之后。
 */
export function AdminTranslationsGate({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const locale = normalizeLocale(i18n.language);
  const [revealedLocale, setRevealedLocale] = useState<SupportedLocale | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureAdminTranslationsLoaded(locale).then(() => {
      if (!cancelled) setRevealedLocale(locale);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (revealedLocale === locale) return <>{children}</>;

  return (
    <>
      <div className="invisible" aria-hidden="true">
        {children}
      </div>
      <div className="fixed inset-0 z-[600] flex items-center justify-center bg-surface-dim/95">
        <Icon name="progress_activity" size={40} className="animate-spin text-primary motion-reduce:animate-none" />
      </div>
    </>
  );
}
