import { AnimatePresence, motion } from 'framer-motion';
import { dialogPanelMotion } from '../../lib/motion';
import { AdminButton } from './AdminControls';
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
  confirmDisabled?: boolean;
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
  confirmClassName,
  confirmDisabled = false,
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
              <AdminButton onClick={onClose} variant="secondary" className="flex-1">
                取消
              </AdminButton>
              {confirmClassName ? (
                <button
                  onClick={onConfirm}
                  disabled={confirmDisabled}
                  className={`${confirmClassName} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {confirmLabel}
                </button>
              ) : (
                <AdminButton onClick={onConfirm} disabled={confirmDisabled} variant="danger" className="flex-1">
                  {confirmLabel}
                </AdminButton>
              )}
            </div>
          </motion.div>
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}
