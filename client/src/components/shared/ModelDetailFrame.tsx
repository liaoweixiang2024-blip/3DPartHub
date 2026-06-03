import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PublicPageShell } from './PublicPageShell';

export const MODEL_DETAIL_SHELL_CLASS = 'flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface';
export const MODEL_DETAIL_MAIN_CLASS = 'flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row';
export const MODEL_DETAIL_DESKTOP_MAIN_CLASS = 'flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row';
export type ModelDetailMobilePeekVariant = 'compact' | 'tall';
export const MODEL_DETAIL_MOBILE_COMPACT_PEEK_HEIGHT = 118;
export const MODEL_DETAIL_MOBILE_TALL_PEEK_HEIGHT = 134;
export const MODEL_DETAIL_MOBILE_BOTTOM_NAV_OFFSET = 'max(3.5rem, calc(2.75rem + env(safe-area-inset-bottom, 0px)))';
export const MODEL_DETAIL_VIEWER_CLASS =
  'relative bg-surface-container min-w-0 flex-1 md:w-[60%] overflow-hidden border-r border-outline-variant/20 shrink-0';
export const MODEL_DETAIL_ASIDE_CLASS =
  'model-detail-sidebar-scroll w-full md:w-[40%] md:min-w-[400px] md:max-w-[500px] bg-surface-container-low overflow-y-auto flex flex-col shrink-0 min-h-0';
export const MODEL_DETAIL_HEADER_CLASS = 'border-b border-outline-variant/10 p-6 lg:p-8';
export const MODEL_DETAIL_HEADER_TOP_CLASS = 'mb-4 flex items-start justify-between';
export const MODEL_DETAIL_ACTIONS_CLASS = 'mt-6 flex gap-3';
export const MODEL_DETAIL_SECTION_TITLE_CLASS =
  'mb-4 border-b border-outline-variant/20 pb-2 text-[11px] uppercase tracking-[0.05em] text-on-surface-variant';
export const MODEL_DETAIL_SPECS_CLASS = 'p-6 pb-4 lg:p-8 lg:pb-4';
export const MODEL_DETAIL_SPEC_GRID_CLASS = 'grid grid-cols-2 gap-x-4 gap-y-2';
export const MODEL_DETAIL_SPEC_ITEM_CLASS = 'flex flex-col border-b border-outline-variant/10 py-2';
export const MODEL_DETAIL_VARIANTS_CLASS = 'px-8 pt-4';
export const MODEL_DETAIL_DOWNLOADS_CLASS = 'bg-surface-container-low p-6 pt-4 lg:p-8 lg:pt-4';
export const MODEL_DETAIL_DOWNLOAD_LIST_CLASS = 'flex flex-col gap-2';
export const MODEL_DETAIL_DOWNLOAD_ROW_BASE_CLASS =
  'milled-inset flex min-h-[60px] items-center justify-between rounded-sm border border-outline-variant/10 bg-surface-container-lowest p-3 transition-colors group';
export const MODEL_DETAIL_DOWNLOAD_ROW_INTERACTIVE_CLASS = `${MODEL_DETAIL_DOWNLOAD_ROW_BASE_CLASS} hover:border-primary/50`;
export const MODEL_DETAIL_SUPPORT_CLASS =
  'mt-auto space-y-3 border-t border-outline-variant/20 bg-surface-container p-5 lg:p-6';

function estimateTitleUnits(title: string) {
  return Array.from(title).reduce((total, char) => {
    if (/\s/.test(char)) return total + 0.35;
    if (/[\u2e80-\u9fff\uff00-\uffef]/u.test(char)) return total + 1;
    if (/[A-Z0-9]/.test(char)) return total + 0.62;
    return total + 0.55;
  }, 0);
}

export function getModelDetailMobilePeekVariant(
  title?: string | null,
  options: { isAdmin?: boolean; fallback?: ModelDetailMobilePeekVariant } = {},
): ModelDetailMobilePeekVariant {
  const normalized = title?.trim();
  if (!normalized) return options.fallback || 'compact';
  if (normalized.includes('\n')) return 'tall';

  const viewportWidth = typeof window === 'undefined' ? 375 : window.innerWidth || 375;
  const sidePadding = 32;
  const actionWidth = options.isAdmin ? 104 : 70;
  const availableTitleWidth = Math.max(160, viewportWidth - sidePadding - actionWidth);
  const titleBudget = availableTitleWidth / 14;

  return estimateTitleUnits(normalized) > titleBudget ? 'tall' : 'compact';
}

export function getModelDetailMobilePeekHeight(variant: ModelDetailMobilePeekVariant) {
  return variant === 'tall' ? MODEL_DETAIL_MOBILE_TALL_PEEK_HEIGHT : MODEL_DETAIL_MOBILE_COMPACT_PEEK_HEIGHT;
}

export function ModelDetailDesktopFrame({
  layout,
  children,
  overlays,
  busy = false,
}: {
  layout: 'skeleton' | 'ready';
  children: ReactNode;
  overlays?: ReactNode;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <PublicPageShell className={MODEL_DETAIL_SHELL_CLASS}>
      <main
        className={layout === 'skeleton' ? MODEL_DETAIL_DESKTOP_MAIN_CLASS : MODEL_DETAIL_MAIN_CLASS}
        aria-busy={busy || undefined}
        aria-live={busy ? 'polite' : undefined}
        data-model-detail-layout={layout}
      >
        {busy && <span className="sr-only">{t('modelDetail.loading')}</span>}
        {children}
      </main>
      {overlays}
    </PublicPageShell>
  );
}

export function ModelDetailAsideFrame({
  header,
  specs,
  variants,
  downloads,
  support,
}: {
  header: ReactNode;
  specs: ReactNode;
  variants?: ReactNode;
  downloads: ReactNode;
  support: ReactNode;
}) {
  return (
    <aside className={MODEL_DETAIL_ASIDE_CLASS} data-model-detail-sidebar>
      <div className={MODEL_DETAIL_HEADER_CLASS} data-model-detail-header>
        {header}
      </div>
      <div className={MODEL_DETAIL_SPECS_CLASS} data-model-detail-specs>
        {specs}
      </div>
      {variants}
      <div className={MODEL_DETAIL_DOWNLOADS_CLASS} data-model-detail-downloads>
        {downloads}
      </div>
      <div className={MODEL_DETAIL_SUPPORT_CLASS} data-model-detail-support>
        {support}
      </div>
    </aside>
  );
}
