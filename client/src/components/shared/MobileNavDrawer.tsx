import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { getBusinessConfig } from '../../lib/businessConfig';
import { getCachedPublicSettings } from '../../lib/publicSettings';
import { useAuthStore } from '../../stores/useAuthStore';
import Icon from '../shared/Icon';
import LoginConfirmDialog from '../shared/LoginConfirmDialog';
import { checkProtectedAccess } from '../shared/ProtectedLink';

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuthStore();
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const isAdmin = user?.role === 'ADMIN';
  const business = getBusinessConfig(settings);
  const navItems = isAdmin ? business.adminNav : business.userNav;
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginReturnUrl, setLoginReturnUrl] = useState('');
  const [loginDialogReason, setLoginDialogReason] = useState('');

  useEffect(() => {
    document.documentElement.classList.toggle('mobile-nav-drawer-open', open);
    return () => document.documentElement.classList.remove('mobile-nav-drawer-open');
  }, [open]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="fixed inset-0 bg-black/50 z-[260]"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: '-100%', opacity: 0.6 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0.6 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="fixed left-0 top-0 w-[min(82vw,280px)] h-dvh bg-surface-container-low z-[270] flex flex-col overflow-y-auto shadow-2xl"
              style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                willChange: 'transform',
              }}
            >
              <div className="flex items-center justify-between p-4 border-b border-outline-variant/20">
                <span className="text-sm font-bold text-on-surface-variant tracking-wider uppercase font-headline">
                  导航
                </span>
                <button onClick={onClose} className="p-1 text-on-surface-variant">
                  <Icon name="close" size={24} />
                </button>
              </div>
              <nav className="flex-1 py-2">
                {navItems.map((item) => {
                  const isActive =
                    location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={(e) => {
                        const result = checkProtectedAccess(item.path);
                        if (result.action === 'dialog') {
                          e.preventDefault();
                          setLoginReturnUrl(result.returnUrl);
                          setLoginDialogReason(result.reason);
                          setLoginDialogOpen(true);
                        } else if (result.action === 'redirect') {
                          e.preventDefault();
                          onClose();
                          navigate('/login', { state: { from: result.returnUrl } });
                        } else {
                          onClose();
                        }
                      }}
                      className={`flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                        isActive
                          ? 'border-l-4 border-primary-container bg-surface-container-high text-primary-container font-bold'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50'
                      }`}
                    >
                      <Icon name={item.icon} size={24} />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              {user && (
                <div className="border-t border-surface-container-high px-6 py-4 space-y-1">
                  <Link
                    to="/profile"
                    onClick={(e) => {
                      const result = checkProtectedAccess('/profile');
                      if (result.action === 'dialog') {
                        e.preventDefault();
                        setLoginReturnUrl(result.returnUrl);
                        setLoginDialogReason(result.reason);
                        setLoginDialogOpen(true);
                      } else if (result.action === 'redirect') {
                        e.preventDefault();
                        onClose();
                        navigate('/login', { state: { from: '/profile' } });
                      } else {
                        onClose();
                      }
                    }}
                    className="flex items-center gap-3 px-0 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <Icon name="settings" size={24} />
                    个人设置
                  </Link>
                  <button
                    onClick={() => {
                      logout();
                      onClose();
                      navigate('/login');
                    }}
                    className="flex items-center gap-3 px-0 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <Icon name="logout" size={24} />
                    退出
                  </button>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <LoginConfirmDialog
        open={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        reason={loginDialogReason}
        returnUrl={loginReturnUrl}
      />
    </>
  );
}
