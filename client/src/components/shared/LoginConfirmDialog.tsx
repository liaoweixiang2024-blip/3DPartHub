import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SystemSettings } from '../../api/settings';
import { dialogPanelMotion } from '../../lib/motion';
import { getPublicSettingsSnapshot, refreshSiteConfig, usePublicSettings } from '../../lib/publicSettings';
import AuthModal from './AuthModal';
import DialogOverlay from './DialogOverlay';
import Icon from './Icon';
import { isAuthModalEnabled, shouldShowLoginPromptForRequest } from './ProtectedLink';

interface LoginConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  reason: string;
  returnUrl?: string;
  onLogin?: () => void;
}

export default function LoginConfirmDialog({ open, onClose, reason, returnUrl, onLogin }: LoginConfirmDialogProps) {
  const { t } = useTranslation();
  const [authOpen, setAuthOpen] = useState(false);
  const [shouldShowPrompt, setShouldShowPrompt] = useState(false);
  const autoEntryHandledRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const onLoginRef = useRef(onLogin);
  const settingsRef = useRef<Partial<SystemSettings> | undefined>(undefined);
  const promptRequestRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = usePublicSettings();
  const resolvedReturnUrl = returnUrl || `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onLoginRef.current = onLogin;
  }, [onLogin]);

  useEffect(() => {
    settingsRef.current = settings || getPublicSettingsSnapshot();
  }, [settings]);

  const getResolvedSettings = useCallback((): Partial<SystemSettings> => {
    return settingsRef.current || getPublicSettingsSnapshot();
  }, []);

  const handleLogin = useCallback(
    async (knownSettings?: Partial<SystemSettings>) => {
      onCloseRef.current();
      if (onLoginRef.current) {
        onLoginRef.current();
        return;
      }
      let latestSettings = knownSettings || getResolvedSettings();
      try {
        latestSettings = knownSettings || (await refreshSiteConfig());
      } catch {
        latestSettings = knownSettings || getResolvedSettings();
      }
      if (isAuthModalEnabled(latestSettings)) {
        setAuthOpen(true);
        return;
      }
      navigate('/login', { state: { from: resolvedReturnUrl } });
    },
    [getResolvedSettings, navigate, resolvedReturnUrl],
  );

  useEffect(() => {
    if (!open) {
      autoEntryHandledRef.current = false;
      promptRequestRef.current += 1;
      setShouldShowPrompt(false);
      return;
    }

    let cancelled = false;
    const requestId = promptRequestRef.current + 1;
    promptRequestRef.current = requestId;
    const initialSettings = getResolvedSettings();
    setShouldShowPrompt(shouldShowLoginPromptForRequest(resolvedReturnUrl, initialSettings));

    const resolvePromptState = async () => {
      let latestSettings = initialSettings;
      try {
        latestSettings = await refreshSiteConfig();
      } catch {
        latestSettings = getResolvedSettings();
      }
      if (cancelled || promptRequestRef.current !== requestId) return;
      if (shouldShowLoginPromptForRequest(resolvedReturnUrl, latestSettings)) {
        setShouldShowPrompt(true);
        return;
      }
      if (autoEntryHandledRef.current) return;
      autoEntryHandledRef.current = true;
      void handleLogin(latestSettings);
    };

    void resolvePromptState();

    return () => {
      cancelled = true;
    };
  }, [getResolvedSettings, handleLogin, open, resolvedReturnUrl]);

  return (
    <>
      <AnimatePresence>
        {open && shouldShowPrompt && (
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
                <h3 className="text-lg font-bold text-on-surface">{t('protected.loginTitle')}</h3>
              </div>
              <p className="text-sm text-on-surface-variant mb-5">
                {t('protected.loginConfirmDescription', { reason })}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container-highest transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => void handleLogin()}
                  className="flex-1 py-2.5 text-sm font-medium text-on-primary bg-primary-container rounded-lg hover:opacity-90 transition-opacity"
                >
                  {t('protected.goLogin')}
                </button>
              </div>
            </motion.div>
          </DialogOverlay>
        )}
      </AnimatePresence>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} returnUrl={resolvedReturnUrl} />
    </>
  );
}
