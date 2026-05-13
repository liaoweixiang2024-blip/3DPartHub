import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import LoginConfirmDialog from '../../../components/shared/LoginConfirmDialog';
import { checkProtectedAccess } from '../../../components/shared/ProtectedLink';
import { getBusinessConfig } from '../../../lib/businessConfig';
import { overlayMotion, sideSheetMotion } from '../../../lib/motion';
import { usePublicSettings } from '../../../lib/publicSettings';
import { preloadRouteForPath } from '../../../lib/routeLoaders';
import { useAuthStore } from '../../../stores/useAuthStore';
import type { MobileNavDrawerThemeProps } from '../types';

export interface MobileNavDrawerAppearance {
  overlayClassName: string;
  sheetClassName: string;
  headerClassName: string;
  titleClassName: string;
  closeButtonClassName: string;
  navClassName: string;
  itemClassName: (active: boolean) => string;
  footerClassName: string;
  footerLinkClassName: string;
  iconSize: number;
}

interface MobileNavDrawerRendererProps extends MobileNavDrawerThemeProps {
  appearance: MobileNavDrawerAppearance;
}

export default function MobileNavDrawerRenderer({ open, onClose, appearance }: MobileNavDrawerRendererProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const { settings } = usePublicSettings();
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
              variants={overlayMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              className={appearance.overlayClassName}
              onClick={onClose}
            />
            <motion.aside
              variants={sideSheetMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              className={appearance.sheetClassName}
              style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                willChange: 'transform',
              }}
              data-mobile-theme-drawer
            >
              <div className={appearance.headerClassName}>
                <span className={appearance.titleClassName}>导航</span>
                <button onClick={onClose} className={appearance.closeButtonClassName}>
                  <Icon name="close" size={24} />
                </button>
              </div>
              <nav className={appearance.navClassName}>
                {navItems.map((item) => {
                  const isActive =
                    location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onPointerEnter={() => preloadRouteForPath(item.path)}
                      onPointerDown={() => preloadRouteForPath(item.path)}
                      onFocus={() => preloadRouteForPath(item.path)}
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
                      className={appearance.itemClassName(isActive)}
                    >
                      <Icon name={item.icon} size={appearance.iconSize} />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              {user && (
                <div className={appearance.footerClassName}>
                  <Link
                    to="/profile"
                    onPointerEnter={() => preloadRouteForPath('/profile')}
                    onPointerDown={() => preloadRouteForPath('/profile')}
                    onFocus={() => preloadRouteForPath('/profile')}
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
                    className={appearance.footerLinkClassName}
                  >
                    <Icon name="settings" size={appearance.iconSize} />
                    个人设置
                  </Link>
                  <button
                    onClick={() => {
                      logout();
                      onClose();
                      navigate('/login');
                    }}
                    className={appearance.footerLinkClassName}
                  >
                    <Icon name="logout" size={appearance.iconSize} />
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
