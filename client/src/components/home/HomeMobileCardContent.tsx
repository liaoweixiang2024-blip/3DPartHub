import type { ReactNode } from 'react';
import { HOME_MOBILE_CARD_CLASS, HOME_MOBILE_MEDIA_CLASS, HOME_MOBILE_BODY_CLASS } from './homeUtils';

export function HomeMobileCardContent({
  media,
  title,
  action,
}: {
  media: ReactNode;
  title: ReactNode;
  action: ReactNode;
}) {
  return (
    <>
      <div className={HOME_MOBILE_MEDIA_CLASS}>{media}</div>
      <div className={HOME_MOBILE_BODY_CLASS}>
        {title}
        {action}
      </div>
    </>
  );
}

export function SkeletonCardMobile() {
  return (
    <div className={`${HOME_MOBILE_CARD_CLASS} animate-pulse`} data-home-skeleton-card>
      <HomeMobileCardContent
        media={
          <>
            <div className="absolute left-1.5 top-1.5 h-3.5 w-8 rounded-sm bg-surface-container-high" />
            <div className="absolute right-1.5 top-1.5 h-3.5 w-10 rounded-sm bg-surface-container-high" />
          </>
        }
        title={
          <div className="mb-1.5 space-y-1.5">
            <div className="h-2.5 w-5/6 rounded bg-surface-container-lowest" />
            <div className="h-2.5 w-2/3 rounded bg-surface-container-lowest" />
          </div>
        }
        action={<div className="mt-auto h-7 w-full rounded-sm bg-surface-container-lowest" />}
      />
    </div>
  );
}
