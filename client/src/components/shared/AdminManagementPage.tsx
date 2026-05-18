import type { ReactNode } from 'react';
import { AdminButton } from './AdminControls';
import Icon from './Icon';
import { APP_PAGE_DESCRIPTION_CLASS, APP_PAGE_TITLE_TRUNCATE_CLASS, mergeClassName } from './PagePrimitives';
import { PageRefreshIndicator } from './PageRefreshFallback';

export interface AdminStatItem {
  label: ReactNode;
  value: ReactNode;
  icon?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  onClick?: () => void;
}

interface AdminManagementPageProps {
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headerNavigation?: ReactNode;
  stats?: AdminStatItem[];
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

interface AdminToolbarProps {
  children: ReactNode;
  className?: string;
}

interface AdminContentPanelProps {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}

interface AdminEmptyStateProps {
  icon: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

interface AdminErrorStateProps {
  title?: ReactNode;
  description?: ReactNode;
  retryLabel?: ReactNode;
  onRetry?: () => void;
  className?: string;
}

interface AdminLoadingStateProps {
  variant?: 'table' | 'list' | 'cards' | 'dashboard';
  rows?: number;
  media?: boolean;
  className?: string;
  label?: string;
  tableColumns?: string;
  tableCells?: Array<'checkbox' | 'chip' | 'title' | 'mediaTitle' | 'text' | 'action' | 'actions'>;
}

interface AdminDetailHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  children?: ReactNode;
}

const toneClasses: Record<NonNullable<AdminStatItem['tone']>, string> = {
  primary: 'bg-primary-container/12 text-primary-container',
  success: 'bg-emerald-500/12 text-emerald-400',
  warning: 'bg-amber-500/12 text-amber-400',
  danger: 'bg-error-container/20 text-error',
  info: 'bg-blue-500/12 text-blue-400',
  neutral: 'bg-surface-container-high text-on-surface-variant',
};

export function AdminPageHero({
  title,
  meta,
  description,
  actions,
  headerNavigation,
}: Omit<AdminManagementPageProps, 'toolbar' | 'children' | 'className' | 'contentClassName'>) {
  return (
    <section className="app-page-hero shrink-0 rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-2.5 md:px-5">
      <div className="app-page-hero-inner flex min-h-[54px] items-center justify-between gap-3">
        <div
          className={`app-page-heading min-w-0 ${
            headerNavigation ? 'md:max-w-[min(22rem,34%)] md:flex-none md:pr-2' : 'flex-1'
          }`}
        >
          <div className="app-page-title-row flex min-h-6 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className={APP_PAGE_TITLE_TRUNCATE_CLASS}>{title}</h1>
            {meta ? (
              <span className="app-page-meta shrink-0 rounded-md border border-outline-variant/15 bg-surface-container px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
                {meta}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className={mergeClassName(APP_PAGE_DESCRIPTION_CLASS, 'mt-0.5 line-clamp-1')}>{description}</p>
          ) : null}
        </div>
        {headerNavigation || actions ? (
          <div
            className={`app-page-actions flex min-w-0 items-center justify-end gap-2 ${
              headerNavigation ? 'flex-1' : 'shrink-0 md:flex-wrap'
            }`}
          >
            {headerNavigation ? (
              <div className="app-page-header-nav hidden min-w-0 flex-1 justify-end md:flex">{headerNavigation}</div>
            ) : null}
            {actions ? (
              <div className="app-page-action-list flex shrink-0 items-center justify-end gap-2 md:flex-wrap">
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function AdminDetailHeader({ title, description, actions, onBack, children }: AdminDetailHeaderProps) {
  return (
    <section className="shrink-0 border-b border-outline-variant/10 bg-surface-container px-4 py-2.5">
      <div className="flex min-h-9 min-w-0 items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label=""
          >
            <Icon name="arrow_back" size={20} />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className={APP_PAGE_TITLE_TRUNCATE_CLASS}>{title}</h1>
          {description ? (
            <div className={mergeClassName(APP_PAGE_DESCRIPTION_CLASS, 'mt-0.5 min-w-0')}>{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center justify-end gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div> : null}
    </section>
  );
}

export function AdminStatsGrid({ stats }: { stats: AdminStatItem[] }) {
  return (
    <div className="app-stats-grid grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      {stats.map((item, index) => {
        const content = (
          <>
            {item.icon ? (
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${toneClasses[item.tone || 'primary']}`}
              >
                <Icon name={item.icon} size={15} />
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight text-on-surface">{item.value}</span>
              <span className="block truncate text-[10px] text-on-surface-variant">{item.label}</span>
            </span>
          </>
        );
        const className = `app-stat-card flex min-h-[54px] items-center gap-2.5 rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-2.5 text-left ${
          item.onClick ? 'transition-colors hover:border-outline-variant/25 hover:bg-surface-container' : ''
        }`;
        return item.onClick ? (
          <button key={index} type="button" onClick={item.onClick} className={className}>
            {content}
          </button>
        ) : (
          <div key={index} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function AdminToolbar({ children, className }: AdminToolbarProps) {
  return (
    <div
      className={mergeClassName(
        'app-page-toolbar shrink-0 rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AdminContentPanel({ children, className, scroll = false }: AdminContentPanelProps) {
  return (
    <section
      className={mergeClassName(
        `app-content-panel rounded-xl border border-outline-variant/15 bg-surface-container-low ${scroll ? 'min-h-0 flex-1 overflow-hidden' : ''}`,
        className,
      )}
    >
      {children}
    </section>
  );
}

export function AdminEmptyState({ icon, title, description, action, className }: AdminEmptyStateProps) {
  return (
    <div
      className={mergeClassName(
        'flex min-h-[360px] flex-1 flex-col items-center justify-center px-4 py-16 text-center md:min-h-[420px]',
        className,
      )}
    >
      <span className="grid h-16 w-16 place-items-center rounded-2xl border border-outline-variant/15 bg-surface-container text-on-surface-variant/45">
        <Icon name={icon} size={34} />
      </span>
      <h2 className="mt-4 text-sm font-semibold text-on-surface">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-on-surface-variant">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex items-center justify-center">{action}</div> : null}
    </div>
  );
}

export function AdminErrorState({
  title = '数据加载失败',
  description = '请检查网络或服务状态，稍后重试。',
  retryLabel = '重新加载',
  onRetry,
  className,
}: AdminErrorStateProps) {
  return (
    <AdminEmptyState
      icon="error"
      title={title}
      description={description}
      className={className}
      action={
        onRetry ? (
          <AdminButton onClick={onRetry} icon="refresh" variant="primary">
            {retryLabel}
          </AdminButton>
        ) : null
      }
    />
  );
}

export function AdminLoadingState({ className, label = '内容加载中' }: AdminLoadingStateProps) {
  return (
    <div className={mergeClassName('flex min-h-[320px] flex-1', className)}>
      <PageRefreshIndicator label={label} />
    </div>
  );
}

export function AdminManagementPage({
  title,
  meta,
  description,
  actions,
  headerNavigation,
  stats,
  toolbar,
  children,
  className,
  contentClassName,
}: AdminManagementPageProps) {
  return (
    <div className={mergeClassName('app-page flex h-full min-h-0 flex-col gap-3 md:gap-4', className)}>
      <AdminPageHero
        title={title}
        meta={meta}
        description={description}
        actions={actions}
        headerNavigation={headerNavigation}
        stats={stats}
      />
      {stats?.length ? <AdminStatsGrid stats={stats} /> : null}
      {toolbar ? <AdminToolbar>{toolbar}</AdminToolbar> : null}
      <div className={mergeClassName('app-page-content flex min-h-0 flex-1 flex-col', contentClassName)}>
        {children}
      </div>
    </div>
  );
}
