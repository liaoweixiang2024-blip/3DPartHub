import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../stores/useAuthStore';
import Icon from "../shared/Icon";

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

const navItems = [
  { label: '首页', icon: 'dashboard', href: '/' },
  { label: '收藏', icon: 'star', href: '/favorites' },
  { label: '我的工单', icon: 'assignment_add', href: '/my-tickets' },
  { label: '技术支持', icon: 'support_agent', href: '/support' },
];

export default function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuthStore();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[60]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-0 top-[56px] w-[240px] h-[calc(100vh-56px)] bg-surface-container-low z-[70] flex flex-col overflow-y-auto"
          >
            <div className="px-6 py-4 border-b border-surface">
              <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest font-headline">导航</span>
            </div>
            <nav className="flex-1 py-2">
              {navItems.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                      isActive
                        ? 'border-l-4 border-primary-container bg-surface-container-high text-primary-container font-bold'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50'
                    }`}
                  >
                    <Icon name={item.icon} size={28} fill={isActive} />
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
                <Icon name="settings" size={28} />
                设置
              </Link>
              <button
                onClick={() => { logout(); onClose(); navigate('/login'); }}
                className="flex items-center gap-3 px-0 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <Icon name="logout" size={28} />
                退出
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
