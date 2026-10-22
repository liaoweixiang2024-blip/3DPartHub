import type { Variants } from 'framer-motion';

const motionSpring = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 34,
  mass: 0.9,
};

export const motionDuration = {
  instant: 0.08,
  fast: 0.14,
  base: 0.2,
  modal: 0.24,
  sheet: 0.28,
} as const;

export const motionEase = {
  standard: [0.2, 0, 0, 1],
  emphasized: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1],
} as const;

export const overlayMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: motionDuration.fast, ease: motionEase.standard } },
  exit: { opacity: 0, transition: { duration: motionDuration.fast, ease: motionEase.exit } },
} satisfies Variants;

export const dialogPanelMotion = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: motionSpring },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 8,
    transition: { duration: motionDuration.fast, ease: motionEase.exit },
  },
} satisfies Variants;

export const bottomSheetMotion = {
  initial: { opacity: 0, y: 32 },
  animate: { opacity: 1, y: 0, transition: motionSpring },
  exit: { opacity: 0, y: 24, transition: { duration: motionDuration.base, ease: motionEase.exit } },
} satisfies Variants;

export const sideSheetMotion = {
  initial: { x: '-100%', opacity: 0.9 },
  animate: { x: 0, opacity: 1, transition: { duration: motionDuration.sheet, ease: motionEase.emphasized } },
  exit: { x: '-100%', opacity: 0.9, transition: { duration: motionDuration.base, ease: motionEase.exit } },
} satisfies Variants;

/** 常驻挂载的侧滑面板（移动端导航/分类抽屉）：面板 DOM 提前建好，打开首帧零挂载/布局成本，
    只有合成器 transform 动画——条件挂载在低端机上首帧建整棵 DOM 会掉帧（「卡一下再滑」）。
    关闭态 visibility:hidden 跳过 paint 与命中测试；visibility 是离散值：打开立即显示，
    关闭经 delay 在滑出动画播完后才隐藏（不能提前隐藏，否则看不到退出动画）。
    位移用弹簧而非时长曲线：tween+emphasized 长尾在结尾近乎「爬行」，感知黏滞；
    弹簧快速到位无长尾，与 iOS 原生侧滑手感一致（与 dialogPanelMotion 同款参数）。 */
export const sideSheetPersistentMotion = {
  closed: {
    x: '-100%',
    visibility: 'hidden',
    transition: {
      ...motionSpring,
      visibility: { delay: 0.35 },
    },
  },
  open: {
    x: '0%',
    visibility: 'visible',
    transition: motionSpring,
  },
} satisfies Variants;

export const popoverMotion = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: motionDuration.fast, ease: motionEase.standard } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: motionDuration.instant, ease: motionEase.exit } },
} satisfies Variants;

export const toolbarMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: motionDuration.base, ease: motionEase.standard } },
  exit: { opacity: 0, y: 8, transition: { duration: motionDuration.fast, ease: motionEase.exit } },
} satisfies Variants;

export const toastMotion = {
  initial: { opacity: 0, x: 32, scale: 0.98 },
  animate: { opacity: 1, x: 0, scale: 1, transition: { duration: motionDuration.base, ease: motionEase.standard } },
  exit: { opacity: 0, x: 24, scale: 0.98, transition: { duration: motionDuration.fast, ease: motionEase.exit } },
} satisfies Variants;

export const listItemMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: motionDuration.base, ease: motionEase.standard } },
} satisfies Variants;
