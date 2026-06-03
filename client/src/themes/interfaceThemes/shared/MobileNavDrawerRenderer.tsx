import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import { checkProtectedAccess } from '../../../components/shared/ProtectedLink';
import { useAuthEntry } from '../../../components/shared/useAuthEntry';
import { localizeNavItems } from '../../../i18n/nav';
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
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const { settings } = usePublicSettings();
  const isAdmin = user?.role === 'ADMIN';
  const business = getBusinessConfig(settings);
  const navItems = localizeNavItems(isAdmin ? business.adminNav : business.userNav, t, 'mobile');
  const { authNodes, handleProtectedLinkClick } = useAuthEntry(settings, { onBeforeAuth: onClose });

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
            >
              <div className={appearance.headerClassName}>
                <span className={appearance.titleClassName}>{t('common.navigation')}</span>
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
                        const result = checkProtectedAccess(item.path, settings);
                        if (result.action === 'allow') {
                          onClose();
                          return;
                        }
                        handleProtectedLinkClick(e, item.path);
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
                      const result = checkProtectedAccess('/profile', settings);
                      if (result.action === 'allow') {
                        onClose();
                        return;
                      }
                      handleProtectedLinkClick(e, '/profile');
                    }}
                    className={appearance.footerLinkClassName}
                  >
                    <Icon name="settings" size={appearance.iconSize} />
                    {t('nav.profileSettings')}
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
                    {t('common.logout')}
                  </button>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      {authNodes}
    </>
  );
}
