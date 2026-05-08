const selectionMotion =
  'transition-[transform,border-color,background-color,box-shadow,color,opacity] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none';

export const selectionCategoryPanelClass = 'p-3 md:p-4';
export const selectionCategoryGridClass =
  'mx-auto grid w-full max-w-[1800px] grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4';

export function selectionCategoryCardClass(active: boolean) {
  return `group flex w-full items-stretch rounded-lg border text-left ${selectionMotion} active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-container/60 overflow-hidden ${
    active
      ? 'border-primary-container/45 bg-primary-container/8 shadow-[0_8px_20px_rgba(249,115,22,0.12)]'
      : 'border-outline-variant/12 bg-surface-container/50 shadow-[0_1px_2px_rgba(15,23,42,0.04)] group-hover:border-primary-container/28 group-hover:bg-surface-container/80'
  }`;
}
