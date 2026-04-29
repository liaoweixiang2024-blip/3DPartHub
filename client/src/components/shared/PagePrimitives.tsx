import type { ReactNode } from "react";

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

export function mergeClassName(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export function PageTitle({ children, className }: PageTitleProps) {
  return (
    <h1
      className={mergeClassName(
        "text-lg font-bold leading-6 text-on-surface md:font-headline md:text-2xl md:leading-8 md:uppercase",
        className
      )}
    >
      {children}
    </h1>
  );
}

export function PageHeader({ title, description, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={mergeClassName("flex min-h-[56px] flex-col justify-center gap-3 sm:min-h-[64px] sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="min-w-0">
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
          <PageTitle>{title}</PageTitle>
          {meta ? <span className="text-xs text-on-surface-variant">{meta}</span> : null}
        </div>
        {description ? <p className="mt-1 text-sm text-on-surface-variant">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageBody({ children, className }: PageBodyProps) {
  return <div className={mergeClassName("space-y-4", className)}>{children}</div>;
}
