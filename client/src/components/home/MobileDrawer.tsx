import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { overlayMotion, sideSheetMotion } from '../../lib/motion';
import type { Category } from '../../themes/interfaceThemes/shared/homeTypes';
import Icon from '../shared/Icon';

export function MobileDrawer({
  open,
  onClose,
  expandedCategories,
  activeCategory,
  categories: categoriesData,
  totalCount,
  onToggle,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  expandedCategories: Set<string>;
  activeCategory: string;
  categories: Category[];
  totalCount: number;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  useEffect(() => {
    document.documentElement.classList.toggle('mobile-nav-drawer-open', open);
    return () => document.documentElement.classList.remove('mobile-nav-drawer-open');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            variants={overlayMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-black/50 z-[260]"
            onClick={onClose}
          />
          <motion.aside
            variants={sideSheetMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed left-0 top-0 w-[min(82vw,280px)] h-dvh bg-surface-container-low z-[270] flex flex-col overflow-y-auto scrollbar-hidden shadow-2xl"
            style={{
              paddingTop: 'env(safe-area-inset-top, 0px)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              willChange: 'transform',
            }}
          >
            <div className="flex items-center justify-between p-4 border-b border-outline-variant/20">
              <h2 className="text-sm font-bold text-on-surface-variant tracking-wider uppercase font-headline">
                产品目录
              </h2>
              <button onClick={onClose} className="p-1 text-on-surface-variant">
                <Icon name="close" size={24} />
              </button>
            </div>
            <div className="flex-1 py-2">
              <button
                onClick={() => {
                  onSelect('all');
                  onClose();
                }}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                  activeCategory === 'all'
                    ? 'border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon name="category_all" size={18} />
                  全部模型
                </span>
                <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
                  {totalCount || categoriesData.reduce((s, c) => s + c.count, 0)}
                </span>
              </button>
              {categoriesData.map((cat) => {
                const isExpanded = expandedCategories.has(cat.id);
                const hasChildren = cat.children && cat.children.length > 0;
                const isActive =
                  cat.id === activeCategory || (cat.children?.some((c) => c.id === activeCategory) ?? false);
                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => {
                        if (hasChildren) {
                          onSelect(cat.id);
                          onToggle(cat.id);
                        } else {
                          onSelect(cat.id);
                          onClose();
                        }
                      }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                        isActive
                          ? 'border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name={cat.icon} size={18} />
                        {cat.name}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {hasChildren && (
                          <motion.span
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                            className="text-on-surface-variant/60"
                          >
                            <Icon name="expand_more" size={16} />
                          </motion.span>
                        )}
                        <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
                          {cat.count}
                        </span>
                      </span>
                    </button>
                    <AnimatePresence>
                      {hasChildren && isExpanded && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: 'auto' }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          {cat.children.map((child) => (
                            <button
                              key={child.id}
                              onClick={() => {
                                onSelect(child.id);
                                onClose();
                              }}
                              className={`w-full text-left ml-8 pr-4 py-2 text-[12px] flex items-center gap-2 ${
                                activeCategory === child.id ? 'text-primary-container' : 'text-slate-500'
                              }`}
                            >
                              <span
                                className={`w-1 h-1 rounded-full shrink-0 ${activeCategory === child.id ? 'bg-primary-container' : 'bg-slate-600'}`}
                              />
                              {child.name}
                              <span className="text-[10px] text-on-surface-variant/60 ml-auto">{child.count}</span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
