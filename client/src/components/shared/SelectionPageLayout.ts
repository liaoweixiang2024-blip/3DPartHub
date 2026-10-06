const selectionMotion =
  'transition-[transform,border-color,background-color,box-shadow,color,opacity] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none';

export const selectionCategoryPanelClass = 'p-3 md:p-4';
export const selectionCategoryGridClass =
  'mx-auto grid w-full max-w-[1800px] grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4';

export function selectionCategoryCardClass(active: boolean) {
  // 悬停/按压反馈只挂 data-[mouse-*] 属性变体（由渲染处的 pointerenter/pointerdown
  // 且 pointerType==='mouse' 才设置）：iPad/横屏手机这类 ≥768px 的触摸设备走的也是
  // 本桌面类，CSS :hover/:active 伪类会在触摸滚动时全程粘在落点卡上不释放（整卡
  // 变深像被选中）；data 属性触摸设置不了，按住滑动一律零反馈。点击确认反馈由
  // pressedCategoryKey 选中高亮承担（所有设备一致）。
  return `group flex w-full items-stretch rounded-lg border text-left ${selectionMotion} data-[mouse-hover=true]:-translate-y-px data-[mouse-press=true]:scale-[0.985] data-[mouse-press=true]:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-container/60 overflow-hidden ${
    active
      ? 'border-primary-container/45 bg-primary-container/8 shadow-[0_8px_20px_rgba(249,115,22,0.12)]'
      : 'border-outline-variant/12 bg-surface-container/50 shadow-[0_1px_2px_rgba(15,23,42,0.04)] data-[mouse-hover=true]:border-primary-container/28 data-[mouse-hover=true]:bg-surface-container/80'
  }`;
}
