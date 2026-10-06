import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';
import { overlayMotion } from '../../lib/motion';

type DialogOverlayZIndex = 50 | 100 | 120 | 10000;

interface DialogOverlayProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  zIndex?: DialogOverlayZIndex;
  /** Background class. Default: 'bg-black/50 backdrop-blur-sm' */
  backdropClassName?: string;
  /** Align content to bottom on mobile, center on desktop. Default: false */
  bottomOnMobile?: boolean;
  /** Include safe-area-inset-bottom padding on mobile. Default: false */
  safeArea?: boolean;
  /** 移动端底部停在底部菜单栏（z-[60] min-h-14 + 安全区）之上：菜单栏保持可见可点，
      弹窗底部内容（按钮区）不被菜单栏盖住。桌面端不受影响。Default: false */
  aboveBottomNav?: boolean;
  /** Called when the backdrop is clicked. Omit to disable backdrop close. */
  onClose?: () => void;
  /** Use framer-motion overlay variants. Default: true */
  animated?: boolean;
}

const Z_INDEX_CLASSES: Record<DialogOverlayZIndex, string> = {
  50: 'z-50',
  100: 'z-[100]',
  120: 'z-[120]',
  10000: 'z-[10000]',
};

export default function DialogOverlay({
  children,
  zIndex = 120,
  backdropClassName = 'bg-black/50 backdrop-blur-sm',
  bottomOnMobile = false,
  safeArea = false,
  aboveBottomNav = false,
  onClose,
  animated = true,
  className,
  ...rest
}: DialogOverlayProps) {
  const zClass = Z_INDEX_CLASSES[zIndex];
  const alignment = bottomOnMobile ? 'items-end sm:items-center' : 'items-center';
  const padding = safeArea ? 'p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-4' : 'p-4';
  // aboveBottomNav 与 inset-0 拆开写：显式 left/right/top + bottom 偏移，
  // 避免依赖 inset 与 bottom 在样式表里的级联顺序
  const position = aboveBottomNav
    ? 'left-0 right-0 top-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:bottom-0'
    : 'inset-0';

  const combinedClassName =
    `fixed ${position} ${zClass} flex ${alignment} justify-center ${backdropClassName} ${padding} ${className || ''}`.trim();

  if (animated) {
    return (
      <motion.div
        variants={overlayMotion}
        initial="initial"
        animate="animate"
        exit="exit"
        className={combinedClassName}
        onClick={onClose}
        {...rest}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div className={combinedClassName} onClick={onClose}>
      {children}
    </div>
  );
}
