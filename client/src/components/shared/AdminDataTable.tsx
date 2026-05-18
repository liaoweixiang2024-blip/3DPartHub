import type {
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { mergeClassName } from './PagePrimitives';

export const ADMIN_TABLE_PANEL_CLASS =
  'overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low';

export const ADMIN_TABLE_CLASS = 'w-full border-separate border-spacing-0 text-xs text-on-surface';

export const ADMIN_TABLE_HEAD_CLASS = 'sticky top-0 z-10';

export const ADMIN_TABLE_HEAD_ROW_CLASS =
  'border-b border-outline-variant/12 bg-surface-container/95 text-xs font-semibold text-on-surface-variant/85 backdrop-blur-md';

export const ADMIN_TABLE_HEAD_CELL_CLASS =
  'h-10 whitespace-nowrap border-b border-outline-variant/12 bg-inherit px-4 py-2 text-left align-middle font-semibold leading-4 tracking-normal first:rounded-tl-xl last:rounded-tr-xl';

export const ADMIN_TABLE_BODY_ROW_CLASS =
  'border-b border-outline-variant/8 transition-colors last:border-b-0 hover:bg-surface-container-high/45';

export const ADMIN_TABLE_CELL_CLASS = 'px-4 py-3 align-middle text-xs leading-5 text-on-surface';

export const ADMIN_TABLE_MUTED_CELL_CLASS = `${ADMIN_TABLE_CELL_CLASS} text-on-surface-variant`;

export const ADMIN_GRID_HEADER_CLASS =
  'sticky top-0 z-10 hidden min-h-10 items-center gap-3 border-b border-outline-variant/12 bg-surface-container/95 px-4 py-2 text-xs font-semibold leading-4 text-on-surface-variant/85 backdrop-blur-md md:grid';

export const ADMIN_GRID_ROW_CLASS =
  'grid items-center gap-3 border-b border-outline-variant/8 px-4 py-3 text-xs transition-colors last:border-b-0 hover:bg-surface-container-high/45';

export const ADMIN_ROW_TITLE_CLASS = 'truncate text-sm font-medium leading-5 text-on-surface';
export const ADMIN_ROW_META_CLASS = 'truncate text-xs leading-5 text-on-surface-variant';

interface AdminTableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

interface AdminTableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  muted?: boolean;
}

type AdminTableHeadCellProps = ThHTMLAttributes<HTMLTableCellElement>;

interface AdminGridProps extends HTMLAttributes<HTMLDivElement> {
  columns: string;
  children: ReactNode;
}

function gridStyle(columns: string, style?: CSSProperties): CSSProperties {
  return { gridTemplateColumns: columns, ...style };
}

export function AdminTable({ children, className, ...props }: AdminTableProps) {
  return (
    <table {...props} className={mergeClassName(ADMIN_TABLE_CLASS, className)}>
      {children}
    </table>
  );
}

export function AdminTableHeadRow({ children, className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className={mergeClassName(ADMIN_TABLE_HEAD_ROW_CLASS, className)}>
      {children}
    </tr>
  );
}

export function AdminTableHeadCell({ children, className, ...props }: AdminTableHeadCellProps) {
  return (
    <th {...props} className={mergeClassName(ADMIN_TABLE_HEAD_CELL_CLASS, className)}>
      {children}
    </th>
  );
}

export function AdminTableBodyRow({ children, className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className={mergeClassName(ADMIN_TABLE_BODY_ROW_CLASS, className)}>
      {children}
    </tr>
  );
}

export function AdminTableCell({ children, className, muted = false, ...props }: AdminTableCellProps) {
  return (
    <td {...props} className={mergeClassName(muted ? ADMIN_TABLE_MUTED_CELL_CLASS : ADMIN_TABLE_CELL_CLASS, className)}>
      {children}
    </td>
  );
}

export function AdminGridHeader({ columns, children, className, style, ...props }: AdminGridProps) {
  return (
    <div {...props} style={gridStyle(columns, style)} className={mergeClassName(ADMIN_GRID_HEADER_CLASS, className)}>
      {children}
    </div>
  );
}

export function AdminGridRow({ columns, children, className, style, ...props }: AdminGridProps) {
  return (
    <div {...props} style={gridStyle(columns, style)} className={mergeClassName(ADMIN_GRID_ROW_CLASS, className)}>
      {children}
    </div>
  );
}
