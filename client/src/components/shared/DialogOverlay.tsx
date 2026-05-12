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
  onClose,
  animated = true,
  className,
  ...rest
}: DialogOverlayProps) {
  const zClass = Z_INDEX_CLASSES[zIndex];
  const alignment = bottomOnMobile ? 'items-end sm:items-center' : 'items-center';
  const padding = safeArea ? 'p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-4' : 'p-4';

  const combinedClassName =
    `fixed inset-0 ${zClass} flex ${alignment} justify-center ${backdropClassName} ${padding} ${className || ''}`.trim();

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
