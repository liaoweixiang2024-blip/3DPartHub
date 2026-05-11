import type { BottomNavAppearance } from '../../shared/BottomNavRenderer';
import type { MobileNavDrawerAppearance } from '../../shared/MobileNavDrawerRenderer';
import type { SidebarAppearance } from '../../shared/SidebarRenderer';

const fadeVisibility = (visible: boolean) =>
  `relative shrink-0 px-4 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`;

const sidebarItemClassName = (active: boolean) =>
  `flex min-h-10 items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-150 cursor-pointer ${
    active
      ? 'border-primary-container/20 bg-primary-container/10 text-primary-container font-semibold'
      : 'border-transparent text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface'
  }`;

export const workbenchSidebarAppearance: SidebarAppearance = {
  rootClassName: 'hidden md:flex w-60 h-full flex-col bg-surface border-r border-outline-variant/16 py-4 shrink-0',
  navClassName: 'flex-1 px-3 flex flex-col gap-1.5 overflow-y-auto scrollbar-hidden -mt-4',
  navIntroWrapperClassName: 'flex items-center gap-3 px-3 pb-2 pt-1',
  navIntroLabelClassName: 'text-[11px] font-semibold text-on-surface-variant/55',
  navIntroLineClassName: 'flex-1 border-t border-outline-variant/12',
  navIntroLabel: '工作区',
  topFadeWrapperClassName: fadeVisibility,
  topFadeClassName: 'h-4 bg-gradient-to-b from-surface to-transparent pointer-events-none',
  bottomFadeWrapperClassName: fadeVisibility,
  bottomFadeClassName: 'h-4 bg-gradient-to-t from-surface to-transparent pointer-events-none',
  sectionWrapperClassName: 'flex items-center gap-3 px-3 pb-1 pt-4',
  sectionLabelClassName: 'text-[11px] font-semibold text-on-surface-variant/55',
  sectionLineClassName: 'flex-1 border-t border-outline-variant/12',
  itemClassName: sidebarItemClassName,
  itemLabelClassName: 'truncate font-medium',
  footerWrapperClassName: 'border-t border-outline-variant/16 my-3 pt-3 flex flex-col gap-1.5',
  footerButtonClassName:
    'flex min-h-10 w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm text-on-surface-variant transition-colors duration-150 cursor-pointer hover:bg-surface-container-high/70 hover:text-on-surface',
  iconSize: 21,
};

export const workbenchBottomNavAppearance: BottomNavAppearance = {
  rootClassName:
    'bottom-nav fixed inset-x-0 z-[60] min-h-[58px] bg-surface/95 border-t border-outline-variant/12 flex items-center justify-around px-2 backdrop-blur-md',
  linkClassName: (active: boolean) =>
    `flex min-h-[46px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 cursor-pointer active:scale-95 transition-[background-color,color,transform] ${
      active ? 'bg-primary-container/10 text-primary-container' : 'text-on-surface-variant'
    }`,
  labelClassName: (active: boolean) => (active ? 'text-[11px] font-semibold' : 'text-[11px] font-medium'),
  iconSize: 21,
};

export const workbenchMobileDrawerAppearance: MobileNavDrawerAppearance = {
  overlayClassName: 'fixed inset-0 bg-black/45 z-[260]',
  sheetClassName:
    'fixed left-0 top-0 w-[min(86vw,312px)] h-dvh bg-surface z-[270] flex flex-col overflow-y-auto shadow-2xl',
  headerClassName: 'flex items-center justify-between border-b border-outline-variant/12 px-5 py-4',
  titleClassName: 'text-sm font-semibold text-on-surface',
  closeButtonClassName:
    'flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface',
  navClassName: 'flex-1 space-y-1.5 px-3 py-3',
  itemClassName: (active: boolean) =>
    `flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
      active
        ? 'border-primary-container/20 bg-primary-container/10 text-primary-container font-semibold'
        : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/70'
    }`,
  footerClassName: 'border-t border-outline-variant/12 px-5 py-4 space-y-1.5',
  footerLinkClassName:
    'flex min-h-10 items-center gap-3 rounded-lg px-2 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high/70 hover:text-on-surface',
  iconSize: 21,
};
