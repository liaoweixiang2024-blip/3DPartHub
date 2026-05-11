import type { BottomNavAppearance } from '../../shared/BottomNavRenderer';
import type { MobileNavDrawerAppearance } from '../../shared/MobileNavDrawerRenderer';
import type { SidebarAppearance } from '../../shared/SidebarRenderer';

const fadeVisibility = (visible: boolean) =>
  `relative shrink-0 px-3 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`;

const sidebarItemClassName = (active: boolean) =>
  `flex items-center gap-4 px-6 py-3 text-sm transition-colors duration-150 cursor-pointer rounded-sm border-l-4 ${
    active
      ? 'text-primary-container border-primary-container bg-surface-container-high font-bold'
      : 'text-on-surface-variant border-transparent hover:bg-surface-container-high hover:text-on-surface'
  }`;

export const classicSidebarAppearance: SidebarAppearance = {
  rootClassName:
    'hidden md:flex w-56 h-full flex-col py-4 bg-surface-container-low border-r border-outline-variant/20 shrink-0',
  navClassName: 'flex-1 px-3 flex flex-col gap-1 overflow-y-auto scrollbar-hidden -mt-4',
  topFadeWrapperClassName: fadeVisibility,
  topFadeClassName: 'h-4 bg-gradient-to-b from-surface-container-low to-transparent pointer-events-none',
  bottomFadeWrapperClassName: fadeVisibility,
  bottomFadeClassName: 'h-4 bg-gradient-to-t from-surface-container-low to-transparent pointer-events-none',
  sectionWrapperClassName: 'flex items-center gap-3 px-4 pt-4 pb-1',
  sectionLabelClassName: 'text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/40',
  sectionLineClassName: 'flex-1 border-t border-outline-variant/15',
  itemClassName: sidebarItemClassName,
  itemLabelClassName: 'font-headline uppercase tracking-widest',
  footerWrapperClassName: 'border-t border-outline-variant/20 my-3 pt-4 flex flex-col gap-1',
  footerButtonClassName:
    'flex items-center gap-4 px-6 py-3 text-sm transition-colors duration-150 cursor-pointer rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface w-full border-l-4 border-transparent',
  iconSize: 24,
};

export const classicBottomNavAppearance: BottomNavAppearance = {
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
