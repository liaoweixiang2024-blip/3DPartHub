export const SELECTION_TOOLBAR_BUTTON_BASE =
  'box-border inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg border px-2.5 text-xs font-medium leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container/60 disabled:cursor-not-allowed disabled:opacity-50 md:w-[6.25rem] [&_svg]:block [&_svg]:shrink-0';
export const SELECTION_TOOLBAR_BUTTON_PRIMARY = `${SELECTION_TOOLBAR_BUTTON_BASE} border-transparent bg-primary-container text-on-primary shadow-sm hover:opacity-90`;
export const SELECTION_TOOLBAR_BUTTON_SECONDARY = `${SELECTION_TOOLBAR_BUTTON_BASE} border-outline-variant/20 bg-surface-container-lowest/30 text-on-surface-variant hover:border-outline-variant/35 hover:bg-surface-container-high/65 hover:text-on-surface`;
export const SELECTION_ICON_BUTTON_EDIT =
  'grid h-8 w-8 shrink-0 place-items-center rounded-md border border-primary-container/15 bg-primary-container/10 text-primary-container transition-colors hover:bg-primary-container/15';
export const SELECTION_ICON_BUTTON_DELETE =
  'grid h-8 w-8 shrink-0 place-items-center rounded-md border border-error/20 bg-error/10 text-error transition-colors hover:bg-error/16';
