import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';
import { useAuthStore } from '../../stores/useAuthStore';
import { getCachedPublicSettings } from '../../lib/publicSettings';
import { getBusinessConfig } from '../../lib/businessConfig';
import Icon from '../shared/Icon';

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

  useEffect(() => {
    document.documentElement.classList.toggle('mobile-nav-drawer-open', open);
    return () => document.documentElement.classList.remove('mobile-nav-drawer-open');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[260]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-0 top-0 w-[min(82vw,280px)] h-dvh bg-surface-container-low z-[270] flex flex-col overflow-y-auto shadow-2xl"
            style={{
              paddingTop: 'env(safe-area-inset-top, 0px)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div className="px-6 py-4 border-b border-surface">
              <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest font-headline">
                导航
              </span>
            </div>
            <nav className="flex-1 py-2">
              {navItems.map((item) => {
                const isActive =
                  location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onClose}
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
            <div className="border-t border-surface-container-high px-6 py-4 space-y-1">
              <Link
                to="/profile"
                onClick={onClose}
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
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
