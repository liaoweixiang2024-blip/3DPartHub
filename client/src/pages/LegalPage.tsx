import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import AuthModal from '../components/shared/AuthModal';
import Icon from '../components/shared/Icon';
import { isAuthModalEnabled } from '../components/shared/ProtectedLink';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { DEFAULT_PRIVACY_SECTIONS, DEFAULT_TERMS_SECTIONS, parseLegalSections } from '../lib/legalContent';
import { refreshSiteConfig, usePublicSettings } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

function splitParagraphs(content: string) {
  return content
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sectionId(index: number) {
  return `legal-section-${index + 1}`;
}

export default function LegalPage() {
  const { type } = useParams<{ type: string }>();
  const isPrivacy = type === 'privacy';
  const { settings } = usePublicSettings();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  useDocumentTitle(isPrivacy ? '隐私声明' : '用户协议');

  const sections = parseLegalSections(
    isPrivacy ? settings?.legal_privacy_sections : settings?.legal_terms_sections,
    isPrivacy ? DEFAULT_PRIVACY_SECTIONS : DEFAULT_TERMS_SECTIONS,
  );
  const updatedAt = String(
    isPrivacy
      ? settings?.legal_privacy_updated_at || '2026 年 4 月'
      : settings?.legal_terms_updated_at || '2026 年 4 月',
  );
  const preface = isPrivacy
    ? '请用户在使用本站前仔细阅读并理解本隐私声明。本声明说明本站在账号登录、模型资料管理、产品选型、规格查询、工单协作及后台管理过程中如何收集、使用、存储和保护相关信息。'
    : '请用户在使用本站前仔细阅读并充分理解本协议。用户登录、浏览、上传、下载、分享或使用本站功能的行为，即表示用户已理解并同意遵守本协议约定。';
  const activeTitle = isPrivacy ? '隐私声明' : '用户协议';
  const activeIcon = isPrivacy ? 'policy' : 'description';
  const returnUrl = isPrivacy ? '/legal/privacy' : '/legal/terms';
  const dateSummary = `更新 ${updatedAt} · 生效 ${updatedAt}`;
  const actionLinkClass =
    'inline-flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface sm:h-auto sm:w-auto sm:rounded-none sm:bg-transparent sm:p-0 sm:text-sm sm:font-bold sm:hover:bg-transparent';
  const activeActionLinkClass = 'text-primary-container';
  const actionDividerClass = 'h-4 w-px shrink-0 bg-outline-variant/30 sm:h-3.5';
  const tabs = (
    <div className="flex min-w-0 items-center justify-end gap-1 text-sm sm:gap-2.5">
      <Link
        to="/legal/privacy"
        aria-label="隐私声明"
        className={`${actionLinkClass} ${isPrivacy ? activeActionLinkClass : ''}`}
      >
        <Icon name="policy" size={17} className="sm:hidden" />
        <span className="hidden sm:inline">隐私声明</span>
      </Link>
      <span className={actionDividerClass} aria-hidden="true" />
      <Link
        to="/legal/terms"
        aria-label="用户协议"
        className={`${actionLinkClass} ${!isPrivacy ? activeActionLinkClass : ''}`}
      >
        <Icon name="description" size={17} className="sm:hidden" />
        <span className="hidden sm:inline">用户协议</span>
      </Link>
      <span className={actionDividerClass} aria-hidden="true" />
      {isAuthenticated ? (
        <Link to="/profile" aria-label="个人中心" className={actionLinkClass}>
          <Icon name="person" size={16} className="sm:hidden" />
          <span className="hidden sm:inline">个人中心</span>
        </Link>
      ) : (
        <button
          type="button"
          onClick={async () => {
            let latestSettings = settings;
            try {
              latestSettings = await refreshSiteConfig();
            } catch {
              latestSettings = settings;
            }
            if (isAuthModalEnabled(latestSettings)) {
              setAuthOpen(true);
            } else {
              navigate('/login', { state: { from: returnUrl } });
            }
          }}
          aria-label="登录或注册"
          className={actionLinkClass}
        >
          <Icon name="person" size={16} className="sm:hidden" />
          <span className="hidden sm:inline">登录 / 注册</span>
        </button>
      )}
    </div>
  );

  return (
    <AdminPageShell desktopContentClassName="p-6" mobileContentClassName="px-4 py-4 pb-20">
      <AdminManagementPage
        title={activeTitle}
        description="平台服务条款与数据处理说明"
        meta={`最后更新：${updatedAt}`}
        actions={tabs}
        contentClassName="overflow-hidden"
      >
        <AdminContentPanel scroll className="overflow-y-auto bg-surface px-4 py-4 md:px-6 md:py-6">
          <article className="mx-auto w-full max-w-6xl text-on-surface">
            <header className="pb-4 md:pb-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-container/10 text-primary-container">
                  <Icon name={activeIcon} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-sm font-bold text-on-surface">阅读说明</p>
                    <span className="hidden h-3.5 w-px bg-outline-variant/30 sm:block" aria-hidden="true" />
                    <p className="text-xs font-medium text-on-surface-variant">{dateSummary}</p>
                  </div>
                  <p className="mt-2 max-w-4xl text-sm leading-7 text-on-surface-variant md:text-[15px] md:leading-8">
                    {preface}
                  </p>
                </div>
              </div>
            </header>

            <button
              type="button"
              onClick={() => setTocOpen(true)}
              aria-label="打开目录"
              className="fixed right-0 top-[42dvh] z-40 flex h-11 w-9 items-center justify-center rounded-l-lg border border-r-0 border-outline-variant/20 bg-surface-container-lowest text-primary-container shadow-float-dark lg:hidden"
            >
              <Icon name="format_list_bulleted" size={18} />
            </button>
            {tocOpen && (
              <div className="fixed inset-0 z-[320] lg:hidden">
                <button
                  type="button"
                  aria-label="关闭目录"
                  className="absolute inset-0 bg-surface-dim/45"
                  onClick={() => setTocOpen(false)}
                />
                <nav className="absolute bottom-0 right-0 top-0 flex w-[18rem] max-w-[82vw] flex-col border-l border-outline-variant/16 bg-surface px-4 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] pt-[calc(1rem+env(safe-area-inset-top,0px))] shadow-[-12px_0_30px_rgba(0,0,0,0.18)]">
                  <div className="flex items-center justify-between border-b border-outline-variant/12 pb-3">
                    <div className="flex items-center gap-2">
                      <Icon name="format_list_bulleted" size={18} className="text-primary-container" />
                      <p className="text-sm font-bold text-on-surface">阅读目录</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTocOpen(false)}
                      aria-label="关闭目录"
                      className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant transition-colors active:bg-surface-container"
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  <div className="relative min-h-0 flex-1">
                    <ol className="h-full touch-pan-y overflow-y-auto overscroll-y-contain py-2 text-sm text-on-surface-variant scrollbar-hidden [-webkit-overflow-scrolling:touch]">
                      {sections.map((section, i) => (
                        <li
                          key={`mobile-toc-${section.title}-${i}`}
                          className="border-b border-outline-variant/8 last:border-b-0"
                        >
                          <a
                            href={`#${sectionId(i)}`}
                            onClick={() => setTocOpen(false)}
                            className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-3 transition-colors active:bg-surface-container active:text-primary-container"
                          >
                            <span className="shrink-0 text-xs font-bold tabular-nums text-primary-container">
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span className="truncate">{section.title}</span>
                          </a>
                        </li>
                      ))}
                    </ol>
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-surface to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent" />
                  </div>
                </nav>
              </div>
            )}

            <div className="grid gap-5 border-t border-outline-variant/16 lg:grid-cols-[14rem_minmax(0,1fr)]">
              <aside className="hidden py-5 lg:sticky lg:top-4 lg:block lg:self-start">
                <nav className="flex max-h-[calc(100dvh-13rem)] flex-col overflow-hidden border-l border-outline-variant/16 pl-4 pr-1">
                  <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant/10 pb-3">
                    <Icon name="format_list_bulleted" size={17} className="text-primary-container" />
                    <p className="text-sm font-bold text-on-surface">阅读目录</p>
                  </div>
                  <ol className="mt-2 min-h-0 overflow-y-auto text-sm text-on-surface-variant scrollbar-hidden">
                    {sections.map((section, i) => (
                      <li
                        key={`desktop-toc-${section.title}-${i}`}
                        className="min-w-0 border-b border-outline-variant/8 last:border-b-0"
                      >
                        <a
                          href={`#${sectionId(i)}`}
                          className="flex min-w-0 items-center gap-2 py-2.5 transition-colors hover:text-primary-container"
                        >
                          <span className="shrink-0 text-xs font-bold tabular-nums text-primary-container">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span className="truncate">{section.title}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
              </aside>

              <div className="px-0 pb-4 md:pb-6 lg:pr-2">
                {sections.map((section, i) => (
                  <section
                    id={sectionId(i)}
                    key={`${section.title}-${i}`}
                    className="scroll-mt-20 break-inside-avoid border-b border-outline-variant/12 py-5 last:border-b-0 md:py-6 lg:scroll-mt-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-1 shrink-0 text-sm font-bold tabular-nums text-primary-container">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base font-bold leading-7 text-on-surface">{section.title}</h2>
                        <div className="mt-2 max-w-5xl space-y-3">
                          {splitParagraphs(section.content).map((paragraph, paragraphIndex) => (
                            <p
                              key={`${section.title}-${paragraphIndex}`}
                              className="text-justify text-sm leading-7 text-on-surface-variant md:text-[15px] md:leading-8"
                            >
                              {paragraph}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </article>
        </AdminContentPanel>
      </AdminManagementPage>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} returnUrl={returnUrl} />
    </AdminPageShell>
  );
}
