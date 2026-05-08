import type { Transition, Variants } from 'framer-motion';

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

export const motionSpring = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.9,
} satisfies Transition;

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

export const listContainerMotion = {
  animate: { transition: { staggerChildren: 0.025, delayChildren: 0.02 } },
} satisfies Variants;

export const listItemMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: motionDuration.base, ease: motionEase.standard } },
} satisfies Variants;
