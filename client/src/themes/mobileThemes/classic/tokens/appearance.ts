import type { BottomNavAppearance } from '../../shared/BottomNavRenderer';
import type { MobileNavDrawerAppearance } from '../../shared/MobileNavDrawerRenderer';

export const classicMobileBottomNavAppearance: BottomNavAppearance = {
  rootClassName:
    'bottom-nav fixed inset-x-0 z-[60] min-h-14 bg-surface-container-low border-t border-outline-variant/10 flex items-center justify-around px-3',
  linkClassName: (active: boolean) =>
    `flex flex-col items-center gap-0.5 py-1 min-w-[48px] min-h-[44px] justify-center cursor-pointer active:scale-95 transition-transform ${
      active ? 'text-primary-container border-t-2 border-primary-container -mt-px' : 'text-on-surface-variant'
    }`,
  labelClassName: (active: boolean) => (active ? 'text-[10px] font-bold' : 'text-[10px]'),
  iconSize: 22,
};

export const classicMobileDrawerAppearance: MobileNavDrawerAppearance = {
  overlayClassName: 'fixed inset-0 bg-black/50 z-[260]',
  sheetClassName:
    'fixed left-0 top-0 w-[min(82vw,280px)] h-dvh bg-surface-container-low z-[270] flex flex-col overflow-y-auto shadow-2xl',
  headerClassName: 'flex items-center justify-between p-4 border-b border-outline-variant/20',
  titleClassName: 'text-sm font-bold text-on-surface-variant tracking-wider uppercase font-headline',
  closeButtonClassName: 'p-1 text-on-surface-variant',
  navClassName: 'flex-1 py-2',
  itemClassName: (active: boolean) =>
    `flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
      active
        ? 'border-l-4 border-primary-container bg-surface-container-high text-primary-container font-bold'
        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50'
    }`,
  footerClassName: 'border-t border-surface-container-high px-6 py-4 space-y-1',
  footerLinkClassName:
    'flex items-center gap-3 px-0 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors',
  iconSize: 24,
};
