import type { CSSProperties, ReactNode } from 'react';

interface PrintPageShellProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function PrintPageShell({ children, className, style }: PrintPageShellProps) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
