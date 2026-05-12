export const SELECTION_TOOLBAR_BUTTON_BASE =
  'box-border inline-flex h-9 w-full shrink-0 items-center justify-center rounded-md border px-1.5 text-[11px] font-bold leading-none transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-35 md:w-[5.9rem] md:px-2 md:text-xs [&_svg]:block [&_svg]:shrink-0';
export const SELECTION_TOOLBAR_BUTTON_PRIMARY = `${SELECTION_TOOLBAR_BUTTON_BASE} border-primary-container bg-primary-container text-on-primary hover:opacity-90`;
export const SELECTION_TOOLBAR_BUTTON_SECONDARY = `${SELECTION_TOOLBAR_BUTTON_BASE} border-outline-variant/18 bg-surface-container-lowest text-on-surface-variant hover:border-primary-container/35 hover:bg-surface-container-high hover:text-on-surface`;
export const SELECTION_ICON_BUTTON_EDIT =
  'grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary-container/12 bg-primary-container/8 text-primary-container transition-colors hover:border-primary-container/25 hover:bg-primary-container/14';
export const SELECTION_ICON_BUTTON_DELETE =
  'grid h-8 w-8 shrink-0 place-items-center rounded-full border border-error/10 bg-error/6 text-error/75 transition-colors hover:border-error/22 hover:bg-error/10 hover:text-error';
