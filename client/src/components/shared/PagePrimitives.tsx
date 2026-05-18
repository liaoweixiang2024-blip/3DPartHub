import type { ReactNode } from 'react';

interface PageTitleProps {
  children: ReactNode;
  className?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

interface PageBodyProps {
  children: ReactNode;
  className?: string;
}

export const APP_PAGE_TITLE_CLASS = 'app-page-title text-base font-semibold leading-6 text-on-surface md:text-lg';
export const APP_PAGE_TITLE_TRUNCATE_CLASS = `${APP_PAGE_TITLE_CLASS} truncate`;
export const APP_PAGE_DESCRIPTION_CLASS = 'app-page-description text-xs text-on-surface-variant';

export function mergeClassName(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export function PageTitle({ children, className }: PageTitleProps) {
  return <h1 className={mergeClassName(APP_PAGE_TITLE_CLASS, className)}>{children}</h1>;
}

export function PageHeader({ title, description, meta, actions, className }: PageHeaderProps) {
  return (
    <header
      className={mergeClassName(
        'app-page-hero app-page-section-in flex min-h-[54px] flex-col justify-center gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between md:px-5',
        className,
      )}
    >
      <div className="app-page-heading min-w-0">
        <div className="app-page-title-row flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1">
          <PageTitle>{title}</PageTitle>
          {meta ? <span className="app-page-meta text-xs text-on-surface-variant">{meta}</span> : null}
        </div>
        {description ? <p className={mergeClassName(APP_PAGE_DESCRIPTION_CLASS, 'mt-0.5')}>{description}</p> : null}
      </div>
      {actions ? (
        <div className="app-page-action-list flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function PageBody({ children, className }: PageBodyProps) {
  return <div className={mergeClassName('app-page app-page-section-in-delayed space-y-4', className)}>{children}</div>;
}
