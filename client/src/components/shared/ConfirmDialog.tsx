import { AnimatePresence, motion } from 'framer-motion';
import { dialogPanelMotion } from '../../lib/motion';
import DialogOverlay from './DialogOverlay';
import Icon from './Icon';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  icon?: string;
  iconColor?: string;
  iconBg?: string;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmClassName?: string;
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  icon = 'warning',
  iconColor = 'text-error',
  iconBg = 'bg-error/15',
  title,
  description,
  confirmLabel = '确认',
  confirmClassName = 'flex-1 py-2.5 text-sm font-medium text-on-primary bg-error rounded-lg hover:opacity-90 transition-opacity',
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <DialogOverlay onClose={onClose} zIndex={10000}>
          <motion.div
            variants={dialogPanelMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-surface-container-high rounded-xl shadow-2xl p-6 w-full max-w-xs border border-outline-variant/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center`}>
                <Icon name={icon} size={20} className={iconColor} />
              </div>
              <h3 className="text-lg font-bold text-on-surface">{title}</h3>
            </div>
            <p className="text-sm text-on-surface-variant mb-5">{description}</p>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors"
              >
                取消
              </button>
              <button onClick={onConfirm} className={confirmClassName}>
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
