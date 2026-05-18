import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAnnouncement, getCachedPublicSettings } from '../../lib/publicSettings';
import { sanitizeHtml } from '../../lib/sanitizeHtml';
import FormatTag from '../shared/FormatTag';
import Icon from '../shared/Icon';
import ModelThumbnail from '../shared/ModelThumbnail';
import type { Product } from './homeTypes';

export function AnnouncementBanner() {
  const [ann, setAnn] = useState({ enabled: false, text: '', type: 'info', color: '' });
  const [dismissed, setDismissed] = useState(false);
  const safeAnnouncementHtml = useMemo(() => sanitizeHtml(ann.text), [ann.text]);

  useEffect(() => {
    getCachedPublicSettings().then(() => {
      setAnn(getAnnouncement());
    });
  }, []);

  if (!ann.enabled || !ann.text || dismissed) return null;

  const presetColors: Record<string, string> = {
    info: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    warning: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    error: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  const style = ann.color
    ? { backgroundColor: `${ann.color}18`, borderColor: `${ann.color}40`, color: ann.color }
    : undefined;
  const className = ann.color
    ? 'flex items-center gap-2 px-4 py-2 rounded-md border text-sm mb-4'
    : `flex items-center gap-2 px-4 py-2 rounded-md border text-sm mb-4 ${presetColors[ann.type] || presetColors.info}`;

  return (
    <div className={className} style={style}>
      <Icon name="campaign" size={18} className="shrink-0" />
      <span
        className="flex-1 [&_a]:font-medium [&_a]:underline hover:[&_a]:opacity-80"
        dangerouslySetInnerHTML={{ __html: safeAnnouncementHtml }}
      />
      <button onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export const HOME_GRID_CARD_CLASS =
  'home-model-card block group bg-surface-container-high rounded-sm overflow-hidden transition-[box-shadow] duration-200 ease-out hover:shadow-xl flex flex-col relative';
export const HOME_GRID_MEDIA_CLASS =
  'home-model-card-media aspect-square bg-surface-container-lowest relative overflow-hidden flex items-center justify-center';
export const HOME_GRID_BODY_CLASS = 'flex-1 flex flex-col p-2.5';
export const HOME_GRID_ACTIONS_CLASS = 'flex items-center gap-2 mt-auto pt-2';
export const HOME_GRID_ACTION_BUTTON_CLASS =
  'flex h-7 flex-1 items-center justify-center gap-1 rounded-sm px-3 text-xs';
export const HOME_LIST_CARD_CLASS =
  'home-model-card relative flex group bg-surface-container-high rounded-sm overflow-hidden transition-[box-shadow] duration-200 ease-out hover:shadow-lg';
export const HOME_LIST_MEDIA_CLASS =
  'home-model-card-media w-32 shrink-0 bg-surface-container-lowest relative overflow-hidden flex items-center justify-center';
export const HOME_LIST_BODY_CLASS = 'flex-1 flex flex-col justify-center p-3 min-w-0';
export const HOME_LIST_ACTIONS_CLASS = 'flex items-center gap-2';
export const HOME_LIST_ACTION_BUTTON_CLASS = 'flex items-center gap-1 rounded-sm px-3 py-1 text-xs';

export function HomeGridCardContent({
  media,
  title,
  meta,
  actions,
}: {
  media: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <>
      <div className={HOME_GRID_MEDIA_CLASS}>{media}</div>
      <div className={`${HOME_GRID_BODY_CLASS} home-model-card-body`}>
        {title}
        {meta ? <div className="home-model-card-meta home-model-card-meta-grid">{meta}</div> : null}
        <div className={`${HOME_GRID_ACTIONS_CLASS} home-model-card-actions`}>{actions}</div>
      </div>
    </>
  );
}

export function HomeListCardContent({
  media,
  title,
  meta,
  actions,
}: {
  media: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  actions: ReactNode;
}) {
  return (
    <>
      <div className={HOME_LIST_MEDIA_CLASS}>{media}</div>
      <div className={`${HOME_LIST_BODY_CLASS} home-model-card-body`}>
        {title}
        <div className="home-model-card-meta mb-2 flex items-center gap-3 text-xs text-on-surface-variant">{meta}</div>
        <div className={`${HOME_LIST_ACTIONS_CLASS} home-model-card-actions`}>{actions}</div>
      </div>
    </>
  );
}

export function SkeletonCard() {
  return (
    <div className={`${HOME_GRID_CARD_CLASS} animate-pulse`} data-home-skeleton-card>
      <HomeGridCardContent
        media={
          <>
            <div className="absolute left-2 top-2 h-5 w-10 rounded-sm bg-surface-container-high" />
            <div className="absolute right-2 top-2 h-5 w-14 rounded-sm bg-surface-container-high" />
          </>
        }
        title={<div className="h-4 w-5/6 rounded bg-surface-container-lowest" />}
        actions={
          <>
            <div className={`${HOME_GRID_ACTION_BUTTON_CLASS} bg-surface-container-lowest`} />
            <div className={`${HOME_GRID_ACTION_BUTTON_CLASS} bg-surface-container-lowest`} />
          </>
        }
      />
    </div>
  );
}

export function SkeletonListCard() {
  return (
    <div className={`${HOME_LIST_CARD_CLASS} min-h-[128px] animate-pulse`} data-home-skeleton-card>
      <HomeListCardContent
        media={<div className="absolute left-1.5 top-1.5 h-5 w-10 rounded-sm bg-surface-container-high" />}
        title={<div className="mb-1 h-5 w-4/5 rounded bg-surface-container-lowest" />}
        meta={
          <>
            <div className="h-4 w-16 rounded bg-surface-container-lowest" />
            <div className="h-4 w-20 rounded bg-surface-container-lowest" />
          </>
        }
        actions={
          <>
            <div className={`${HOME_LIST_ACTION_BUTTON_CLASS} h-6 w-20 bg-surface-container-lowest`} />
            <div className={`${HOME_LIST_ACTION_BUTTON_CLASS} h-6 w-20 bg-surface-container-lowest`} />
            <div className={`${HOME_LIST_ACTION_BUTTON_CLASS} h-6 w-20 bg-surface-container-lowest`} />
          </>
        }
      />
    </div>
  );
}

export function ModelEmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="home-model-empty-state flex flex-col items-center justify-center gap-4 py-20">
      <Icon name="search_off" size={48} className="text-on-surface-variant/30" />
      <div className="text-center">
        <p className="text-on-surface-variant">没有找到匹配的模型</p>
        {searchQuery.trim() && (
          <p className="mt-1 text-xs text-on-surface-variant/60">可以提交需求，请管理员补充或完善模型库。</p>
        )}
      </div>
      {searchQuery.trim() && (
        <a
          href="/support"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-container px-4 py-2 text-sm font-bold text-on-primary transition-opacity hover:opacity-90"
        >
          <Icon name="assignment_add" size={16} />
          申请完善模型
        </a>
      )}
    </div>
  );
}

export function HeroPosterImage({ product }: { product?: Product }) {
  if (!product?.thumbnailUrl) return <Icon name="view_in_ar" size={280} className="text-primary-container/10" />;
  return (
    <ModelThumbnail
      src={product.thumbnailUrl}
      alt=""
      className="h-full w-full object-cover opacity-30 blur-[1px] scale-105"
    />
  );
}

export { FormatTag };
