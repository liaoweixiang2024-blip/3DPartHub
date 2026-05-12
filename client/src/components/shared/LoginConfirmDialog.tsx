import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { dialogPanelMotion } from '../../lib/motion';
import AuthModal from './AuthModal';
import DialogOverlay from './DialogOverlay';
import Icon from './Icon';

interface LoginConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  reason: string;
  returnUrl?: string;
  onLogin?: () => void;
}

export default function LoginConfirmDialog({ open, onClose, reason, returnUrl, onLogin }: LoginConfirmDialogProps) {
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <>
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
                <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center">
                  <Icon name="lock" size={20} className="text-primary-container" />
                </div>
                <h3 className="text-lg font-bold text-on-surface">需要登录</h3>
              </div>
              <p className="text-sm text-on-surface-variant mb-5">{reason}需要先登录账号，是否前往登录？</p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    onClose();
                    if (onLogin) {
                      onLogin();
                    } else {
                      setAuthOpen(true);
                    }
                  }}
                  className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
                >
                  前往登录
                </button>
              </div>
            </motion.div>
          </DialogOverlay>
        )}
      </AnimatePresence>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} returnUrl={returnUrl} />
    </>
  );
}
