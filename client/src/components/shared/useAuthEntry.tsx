import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SystemSettings } from '../../api/settings';
import { refreshSiteConfig } from '../../lib/publicSettings';
import AuthModal from './AuthModal';
import LoginConfirmDialog from './LoginConfirmDialog';
import { checkProtectedAccess, isAuthModalEnabled } from './ProtectedLink';

type AuthMode = 'login' | 'register';

interface AuthPromptState {
  open: boolean;
  reason: string;
  returnUrl: string;
}

interface AuthModalState {
  open: boolean;
  mode: AuthMode;
  returnUrl: string;
}

interface UseAuthEntryOptions {
  onBeforeAuth?: () => void;
  onCancelAuth?: () => void;
}

function authRouteForMode(mode: AuthMode) {
  return mode === 'register' ? '/register' : '/login';
}

export function useAuthEntry(settings?: Partial<SystemSettings>, options: UseAuthEntryOptions = {}) {
  const { onBeforeAuth, onCancelAuth } = options;
  const navigate = useNavigate();
  const location = useLocation();
  const [promptState, setPromptState] = useState<AuthPromptState>({ open: false, reason: '', returnUrl: '' });
  const [modalState, setModalState] = useState<AuthModalState>({ open: false, mode: 'login', returnUrl: '' });

  const getCurrentReturnUrl = useCallback(
    () => `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.pathname, location.search],
  );

  const getLatestSettings = useCallback(async () => {
    try {
      return await refreshSiteConfig();
    } catch {
      return settings;
    }
  }, [settings]);

  const openAuthEntry = useCallback(
    async (returnUrl = getCurrentReturnUrl(), mode: AuthMode = 'login') => {
      onBeforeAuth?.();
      const latestSettings = await getLatestSettings();
      if (isAuthModalEnabled(latestSettings)) {
        setModalState({ open: true, mode, returnUrl });
        return;
      }
      navigate(authRouteForMode(mode), { state: { from: returnUrl } });
    },
    [getCurrentReturnUrl, getLatestSettings, navigate, onBeforeAuth],
  );

  const openLoginPrompt = useCallback(
    (reason: string, returnUrl = getCurrentReturnUrl()) => {
      setPromptState({ open: true, reason, returnUrl });
    },
    [getCurrentReturnUrl],
  );

  const closeLoginPrompt = useCallback(() => {
    setPromptState((prev) => ({ ...prev, open: false }));
  }, []);

  const closeAuthModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, open: false }));
    onCancelAuth?.();
  }, [onCancelAuth]);

  const handleProtectedPath = useCallback(
    async (path: string) => {
      const initialAccess = checkProtectedAccess(path, settings);
      if (initialAccess.action === 'allow') return true;

      const latestSettings = await getLatestSettings();
      const access = checkProtectedAccess(path, latestSettings);
      if (access.action === 'allow') {
        navigate(path);
        return true;
      }
      if (access.action === 'dialog') {
        openLoginPrompt(access.reason, access.returnUrl);
        return false;
      }
      await openAuthEntry(access.returnUrl);
      return false;
    },
    [getLatestSettings, navigate, openAuthEntry, openLoginPrompt, settings],
  );

  const handleProtectedLinkClick = useCallback(
    (event: ReactMouseEvent, path: string) => {
      const access = checkProtectedAccess(path, settings);
      if (access.action === 'allow') return;
      event.preventDefault();
      void handleProtectedPath(path);
    },
    [handleProtectedPath, settings],
  );

  const authNodes = useMemo(
    () => (
      <>
        <LoginConfirmDialog
          open={promptState.open}
          onClose={closeLoginPrompt}
          reason={promptState.reason}
          returnUrl={promptState.returnUrl}
          onLogin={() => void openAuthEntry(promptState.returnUrl || getCurrentReturnUrl())}
        />
        <AuthModal
          initialMode={modalState.mode}
          open={modalState.open}
          onClose={closeAuthModal}
          returnUrl={modalState.returnUrl}
        />
      </>
    ),
    [
      closeAuthModal,
      closeLoginPrompt,
      getCurrentReturnUrl,
      modalState.mode,
      modalState.open,
      modalState.returnUrl,
      openAuthEntry,
      promptState.open,
      promptState.reason,
      promptState.returnUrl,
    ],
  );

  return {
    authNodes,
    closeAuthModal,
    closeLoginPrompt,
    handleProtectedLinkClick,
    handleProtectedPath,
    openAuthEntry,
    openLoginPrompt,
  };
}
