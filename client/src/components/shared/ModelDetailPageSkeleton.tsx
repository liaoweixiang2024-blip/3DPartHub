import { useMediaQuery } from '../../layouts/hooks/useMediaQuery';
import {
  ModelDetailAsideFrame,
  ModelDetailDesktopFrame,
  MODEL_DETAIL_ACTIONS_CLASS,
  MODEL_DETAIL_DOWNLOAD_LIST_CLASS,
  MODEL_DETAIL_DOWNLOAD_ROW_BASE_CLASS,
  MODEL_DETAIL_HEADER_TOP_CLASS,
  getModelDetailMobilePeekHeight,
  getModelDetailMobilePeekVariant,
  MODEL_DETAIL_SECTION_TITLE_CLASS,
  MODEL_DETAIL_SPEC_GRID_CLASS,
  MODEL_DETAIL_SPEC_ITEM_CLASS,
  MODEL_DETAIL_VIEWER_CLASS,
} from './ModelDetailFrame';
import { PublicPageShell } from './PublicPageShell';

const shimmer = 'animate-pulse rounded-sm bg-surface-container-high';

function SectionTitleSkeleton({ widthClassName }: { widthClassName: string }) {
  return (
    <div className={MODEL_DETAIL_SECTION_TITLE_CLASS}>
      <div className={`${shimmer} h-[13px] ${widthClassName}`} />
    </div>
  );
}

function SpecSkeleton({ labelWidth, valueWidth }: { labelWidth: string; valueWidth: string }) {
  return (
    <div className={MODEL_DETAIL_SPEC_ITEM_CLASS}>
      <div className={`${shimmer} mb-1 h-4 ${labelWidth}`} />
      <div className={`${shimmer} h-5 ${valueWidth}`} />
    </div>
  );
}

function DownloadRowSkeleton() {
  return (
    <div className={MODEL_DETAIL_DOWNLOAD_ROW_BASE_CLASS}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className={`${shimmer} h-5 w-4/5`} />
        <div className={`${shimmer} h-3 w-28`} />
      </div>
    </div>
  );
}

function ModelDetailDesktopSkeleton() {
  return (
    <ModelDetailDesktopFrame layout="skeleton" busy>
      <section className={MODEL_DETAIL_VIEWER_CLASS} data-model-detail-viewer />
      <ModelDetailAsideFrame
        header={
          <>
            <div className={MODEL_DETAIL_HEADER_TOP_CLASS}>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex h-[13px] items-center gap-1.5">
                  <div className={`${shimmer} h-[11px] w-12`} />
                  <div className={`${shimmer} h-[11px] w-3`} />
                  <div className={`${shimmer} h-[11px] w-16`} />
                </div>
                <div className={`${shimmer} mb-2 h-9 w-11/12`} />
              </div>
            </div>
            <div className={MODEL_DETAIL_ACTIONS_CLASS}>
              <div className={`${shimmer} h-10 flex-1`} />
              <div className={`${shimmer} h-10 w-10 shrink-0`} />
              <div className={`${shimmer} h-10 w-10 shrink-0`} />
            </div>
          </>
        }
        specs={
          <>
            <SectionTitleSkeleton widthClassName="w-20" />
            <div className={MODEL_DETAIL_SPEC_GRID_CLASS}>
              <SpecSkeleton labelWidth="w-10" valueWidth="w-16" />
              <SpecSkeleton labelWidth="w-16" valueWidth="w-20" />
              <SpecSkeleton labelWidth="w-16" valueWidth="w-24" />
              <SpecSkeleton labelWidth="w-16" valueWidth="w-28" />
            </div>
          </>
        }
        downloads={
          <>
            <SectionTitleSkeleton widthClassName="w-20" />
            <div className={MODEL_DETAIL_DOWNLOAD_LIST_CLASS}>
              <DownloadRowSkeleton />
            </div>
          </>
        }
        support={
          <>
            <div className="flex min-h-16 items-center rounded-sm bg-surface-container-high p-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className={`${shimmer} h-4 w-28 bg-surface-container-highest`} />
                <div className={`${shimmer} h-3 w-40 bg-surface-container-highest`} />
              </div>
            </div>
            <div className="space-y-1.5 pt-2">
              <div className={`${shimmer} h-3 w-full bg-surface-container-highest/80`} />
              <div className={`${shimmer} h-3 w-5/6 bg-surface-container-highest/80`} />
              <div className={`${shimmer} h-3 w-32 bg-surface-container-highest/70`} />
            </div>
          </>
        }
      />
    </ModelDetailDesktopFrame>
  );
}

function ModelDetailMobileSkeleton({ modelTitle, isAdmin }: { modelTitle?: string | null; isAdmin?: boolean }) {
  const peekVariant = getModelDetailMobilePeekVariant(modelTitle, { isAdmin });
  const mobilePeekHeight = getModelDetailMobilePeekHeight(peekVariant);

  return (
    <PublicPageShell mobileClassName="flex h-dvh flex-col bg-surface" keepMobileDrawerMounted>
      <main
        className="relative min-h-0 flex-1"
        style={{ marginBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
        aria-busy
        aria-live="polite"
      >
        <span className="sr-only">模型详情加载中</span>
        <section
          className="absolute inset-x-0 top-0 overflow-hidden bg-surface-container"
          style={{ bottom: mobilePeekHeight }}
          data-model-detail-viewer
        >
          <div className="absolute left-2 top-2 h-8 w-8 rounded-full bg-surface-container-high/80" />
        </section>

        <section
          className="absolute bottom-0 left-0 right-0 z-30 flex flex-col overflow-hidden rounded-t-2xl border-t border-outline-variant/10 bg-surface-container-low shadow-[0_-2px_20px_rgba(0,0,0,0.25)]"
          style={{ height: mobilePeekHeight }}
          data-model-detail-sidebar
        >
          <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5 pt-2.5">
            <div className="flex flex-1 justify-center">
              <div className="h-1 w-9 rounded-full bg-on-surface-variant/25" />
            </div>
          </div>
          <div className="mt-auto shrink-0 px-4 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className={peekVariant === 'tall' ? 'mb-2 min-h-[2.3rem] space-y-1.5' : 'mb-2 min-h-[1.15rem]'}>
                  <div className={`${shimmer} h-4 w-3/4`} />
                  {peekVariant === 'tall' ? <div className={`${shimmer} h-4 w-1/2`} /> : null}
                </div>
                <div className={`${shimmer} h-3 w-1/2 bg-surface-container-highest/70`} />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className={`${shimmer} h-8 w-8 rounded-full`} />
                <div className={`${shimmer} h-8 w-8 rounded-full`} />
              </div>
            </div>
            <div className={`${shimmer} mt-2.5 h-9 w-full rounded-lg bg-primary-container/20`} />
          </div>
        </section>
      </main>
    </PublicPageShell>
  );
}

export default function ModelDetailPageSkeleton({
  modelTitle,
  isAdmin,
}: {
  modelTitle?: string | null;
  isAdmin?: boolean;
}) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return isDesktop ? (
    <ModelDetailDesktopSkeleton />
  ) : (
    <ModelDetailMobileSkeleton modelTitle={modelTitle} isAdmin={isAdmin} />
  );
}
