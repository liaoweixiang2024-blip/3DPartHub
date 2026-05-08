import {
  ModelDetailAsideFrame,
  ModelDetailDesktopFrame,
  MODEL_DETAIL_ACTIONS_CLASS,
  MODEL_DETAIL_DOWNLOAD_LIST_CLASS,
  MODEL_DETAIL_DOWNLOAD_ROW_BASE_CLASS,
  MODEL_DETAIL_HEADER_TOP_CLASS,
  MODEL_DETAIL_SECTION_TITLE_CLASS,
  MODEL_DETAIL_SPEC_GRID_CLASS,
  MODEL_DETAIL_SPEC_ITEM_CLASS,
  MODEL_DETAIL_VIEWER_CLASS,
} from './ModelDetailFrame';

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

export default function ModelDetailPageSkeleton() {
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
