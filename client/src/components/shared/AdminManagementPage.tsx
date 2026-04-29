import type { ReactNode } from "react";
import Icon from "./Icon";
import { mergeClassName } from "./PagePrimitives";

export interface AdminStatItem {
  label: ReactNode;
  value: ReactNode;
  icon?: string;
  tone?: "primary" | "success" | "warning" | "danger" | "info" | "neutral";
  onClick?: () => void;
}

interface AdminManagementPageProps {
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
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

const toneClasses: Record<NonNullable<AdminStatItem["tone"]>, string> = {
  primary: "bg-primary-container/12 text-primary-container",
  success: "bg-emerald-500/12 text-emerald-400",
  warning: "bg-amber-500/12 text-amber-400",
  danger: "bg-error-container/20 text-error",
  info: "bg-blue-500/12 text-blue-400",
  neutral: "bg-surface-container-high text-on-surface-variant",
};

export function AdminPageHero({ title, meta, description, actions }: Omit<AdminManagementPageProps, "toolbar" | "children" | "className" | "contentClassName">) {
  return (
    <section className="shrink-0 rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 md:px-5">
      <div className="flex min-h-[58px] items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="truncate text-lg font-bold leading-7 tracking-tight text-on-surface md:text-xl">{title}</h1>
            {meta ? <span className="rounded-md border border-outline-variant/15 bg-surface-container px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">{meta}</span> : null}
          </div>
          {description ? <p className="mt-0.5 line-clamp-1 text-xs text-on-surface-variant">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}

export function AdminStatsGrid({ stats }: { stats: AdminStatItem[] }) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      {stats.map((item, index) => {
        const content = (
          <>
            {item.icon ? (
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneClasses[item.tone || "primary"]}`}>
                <Icon name={item.icon} size={16} />
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="block truncate text-base font-bold leading-tight text-on-surface">{item.value}</span>
              <span className="block truncate text-[10px] text-on-surface-variant">{item.label}</span>
            </span>
          </>
        );
        const className = `flex min-h-[58px] items-center gap-2.5 rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-2.5 text-left ${
          item.onClick ? "transition-colors hover:border-outline-variant/25 hover:bg-surface-container" : ""
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
    <div className={mergeClassName("shrink-0 rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-2", className)}>
      {children}
    </div>
  );
}

export function AdminContentPanel({ children, className, scroll = false }: AdminContentPanelProps) {
  return (
    <section
      className={mergeClassName(
        `rounded-xl border border-outline-variant/15 bg-surface-container-low ${scroll ? "min-h-0 flex-1 overflow-hidden" : ""}`,
        className
      )}
    >
      {children}
    </section>
  );
}

export function AdminEmptyState({ icon, title, description, action, className }: AdminEmptyStateProps) {
  return (
    <div className={mergeClassName("flex min-h-[360px] flex-1 flex-col items-center justify-center px-4 py-16 text-center md:min-h-[420px]", className)}>
      <span className="grid h-16 w-16 place-items-center rounded-2xl border border-outline-variant/15 bg-surface-container text-on-surface-variant/45">
        <Icon name={icon} size={34} />
      </span>
      <h2 className="mt-4 text-sm font-semibold text-on-surface">{title}</h2>
      {description ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-on-surface-variant">{description}</p> : null}
      {action ? <div className="mt-5 flex items-center justify-center">{action}</div> : null}
    </div>
  );
}

export function AdminManagementPage({ title, meta, description, actions, stats, toolbar, children, className, contentClassName }: AdminManagementPageProps) {
  return (
    <div className={mergeClassName("flex h-full min-h-0 flex-col gap-3 md:gap-4", className)}>
      <AdminPageHero title={title} meta={meta} description={description} actions={actions} stats={stats} />
      {stats?.length ? <AdminStatsGrid stats={stats} /> : null}
      {toolbar ? <AdminToolbar>{toolbar}</AdminToolbar> : null}
      <div className={mergeClassName("flex min-h-0 flex-1 flex-col", contentClassName)}>{children}</div>
    </div>
  );
}
