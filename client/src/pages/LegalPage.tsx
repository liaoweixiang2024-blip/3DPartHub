import { useParams, Link } from 'react-router-dom';
import useSWR from 'swr';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { DEFAULT_PRIVACY_SECTIONS, DEFAULT_TERMS_SECTIONS, parseLegalSections } from '../lib/legalContent';
import { getCachedPublicSettings } from '../lib/publicSettings';

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
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
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
  const tabs = (
    <div className="flex min-w-0 gap-2">
      <Link
        to="/legal/privacy"
        className={`inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-bold transition-colors ${
          isPrivacy
            ? 'bg-primary-container text-on-primary'
            : 'border border-outline-variant/15 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
        }`}
      >
        隐私声明
      </Link>
      <Link
        to="/legal/terms"
        className={`inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-bold transition-colors ${
          !isPrivacy
            ? 'bg-primary-container text-on-primary'
            : 'border border-outline-variant/15 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
        }`}
      >
        用户协议
      </Link>
    </div>
  );

  return (
    <AdminPageShell desktopContentClassName="p-8" mobileContentClassName="px-4 py-4 pb-20">
      <AdminManagementPage
        title={isPrivacy ? '隐私声明' : '用户协议'}
        description="平台服务条款与数据处理说明"
        meta={`最后更新：${updatedAt}`}
        actions={tabs}
        contentClassName="overflow-hidden"
      >
        <AdminContentPanel scroll className="overflow-y-auto bg-surface p-5 md:p-8">
          <article className="w-full text-on-surface">
            <header className="border-b border-outline-variant/20 pb-7 text-center md:pb-9">
              <h1 className="text-[26px] font-bold tracking-normal md:text-[34px]">
                {isPrivacy ? '隐私声明' : '用户协议'}
              </h1>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-on-surface-variant md:text-sm">
                <span>更新日期：{updatedAt}</span>
                <span>生效日期：{updatedAt}</span>
              </div>
            </header>

            <p className="mt-7 max-w-6xl text-sm leading-8 text-on-surface-variant md:mt-9 md:text-[15px]">{preface}</p>

            <nav className="mt-7 border-y border-outline-variant/12 py-4 md:mt-8">
              <p className="text-sm font-bold text-on-surface">目录</p>
              <ol className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm text-on-surface-variant sm:grid-cols-2 xl:grid-cols-3">
                {sections.map((section, i) => (
                  <li key={`toc-${section.title}-${i}`} className="min-w-0">
                    <a
                      href={`#${sectionId(i)}`}
                      className="flex min-w-0 gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-container-high hover:text-on-surface"
                    >
                      <span className="shrink-0 tabular-nums">{i + 1}.</span>
                      <span className="truncate">{section.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="mt-8 space-y-8 md:mt-10 md:space-y-9">
              {sections.map((section, i) => (
                <section id={sectionId(i)} key={`${section.title}-${i}`} className="scroll-mt-24 break-inside-avoid">
                  <h2 className="border-b border-outline-variant/10 pb-2 text-base font-bold leading-7 text-on-surface md:text-lg">
                    第 {i + 1} 条 {section.title}
                  </h2>
                  <div className="mt-3 max-w-6xl space-y-3">
                    {splitParagraphs(section.content).map((paragraph, paragraphIndex) => (
                      <p
                        key={`${section.title}-${paragraphIndex}`}
                        className="text-justify text-sm leading-7 text-on-surface-variant md:text-[15px] md:leading-8"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </AdminContentPanel>
      </AdminManagementPage>
    </AdminPageShell>
  );
}
