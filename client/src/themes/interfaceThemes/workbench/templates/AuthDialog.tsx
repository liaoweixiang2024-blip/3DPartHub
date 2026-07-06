import { motion } from 'framer-motion';
import Icon from '../../../../components/shared/Icon';
import type { AuthDialogThemeProps } from '../../types';

export default function WorkbenchAuthDialog({
  mode,
  brand,
  title,
  subtitle,
  children,
  closeLabel,
  onClose,
}: AuthDialogThemeProps) {
  return (
    <motion.section
      className={`app-auth-dialog app-auth-dialog-${mode} relative flex min-h-0 w-full max-w-[27rem] flex-col overflow-hidden rounded-2xl border border-outline-variant/14 bg-surface-container-low shadow-modal`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <Icon name="close" size={18} />
        <span className="sr-only">{closeLabel}</span>
      </button>

      <div className="app-auth-header shrink-0 border-b border-outline-variant/10 px-6 pb-5 pt-6 text-center sm:px-7">
        {brand}
        {title}
        {subtitle}
      </div>

      <div className="app-auth-body min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    </motion.section>
  );
}
