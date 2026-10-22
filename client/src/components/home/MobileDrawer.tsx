import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../shared/Icon';
import { useMobileDrawerStore } from '../../stores/useMobileDrawerStore';
import type { Category } from './homeTypes';

/**
 * 面板与遮罩均常驻挂载 + CSS transition 驱动：
 * - 常驻（关闭态 visibility:hidden 不参与绘制）→ 打开首帧零 DOM 构建/布局；
 * - CSS transition 在合成器线程独立运行，主线程再忙也不掉帧（framer-motion 等 JS 动画
 *   逐帧占用主线程，任何抖动都会让动画像降了刷新率）；
 * - visibility 参与 transition 时按离散插值规则整个过渡期保持 visible——打开立即可见、
 *   关闭等滑出动画播完才隐藏，无需手工 delay；
 * - 开合状态走 useMobileDrawerStore，点击入口时页面树零 re-render。
 */
const SHEET_TRANSITION = {
  open: 'transform 0.26s cubic-bezier(0.32, 0.72, 0, 1), visibility 0.26s',
  closed: 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1), visibility 0.22s',
} as const;

export function MobileDrawer({
  expandedCategories,
  activeCategory,
  categories: categoriesData,
  totalCount,
  onToggle,
  onSelect,
}: {
  expandedCategories: Set<string>;
  activeCategory: string;
  categories: Category[];
  /** null = 分类树未返回，显示「—」占位 */
  totalCount: number | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const open = useMobileDrawerStore((s) => s.categoryOpen);
  const closeDrawer = useMobileDrawerStore((s) => s.closeCategory);
  const asideRef = useRef<HTMLElement>(null);

  // 常驻挂载下关闭时焦点可能仍留在抽屉内按钮上，aria 隐藏含焦点元素会被浏览器告警——
  // 主动移走焦点兜底（inert 自身也会清）
  useEffect(() => {
    const el = asideRef.current;
    if (!open && el && el.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [open]);

  return (
    <>
      {/* 遮罩常驻（opacity 切换 + 关闭态穿透点击） */}
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={`fixed inset-0 bg-black/50 z-[260] transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        ref={asideRef}
        inert={!open}
        className="fixed left-0 top-0 w-[min(82vw,280px)] h-dvh bg-surface-container-low z-[270] flex flex-col overflow-y-auto scrollbar-hidden shadow-2xl"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transform: open ? 'translate3d(0, 0, 0)' : 'translate3d(-100%, 0, 0)',
          visibility: open ? 'visible' : 'hidden',
          transition: open ? SHEET_TRANSITION.open : SHEET_TRANSITION.closed,
          willChange: 'transform',
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/20">
          <h2 className="text-sm font-bold text-on-surface-variant tracking-wider uppercase font-headline">
            {t('home.catalog')}
          </h2>
          <button onClick={closeDrawer} className="p-1 text-on-surface-variant">
            <Icon name="close" size={24} />
          </button>
        </div>
        <div className="flex-1 py-2">
          <button
            onClick={() => {
              onSelect('all');
              closeDrawer();
            }}
            className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
              activeCategory === 'all'
                ? 'border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon name="category_all" size={18} />
              {t('home.allModels')}
            </span>
            <span className="text-[10px] tabular-nums bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
              {totalCount ?? (categoriesData.length ? categoriesData.reduce((s, c) => s + c.count, 0) : '—')}
            </span>
          </button>
          {categoriesData.map((cat) => {
            const isExpanded = expandedCategories.has(cat.id);
            const hasChildren = cat.children && cat.children.length > 0;
            const isActive = cat.id === activeCategory || (cat.children?.some((c) => c.id === activeCategory) ?? false);
            return (
              <div key={cat.id}>
                <button
                  onClick={() => {
                    if (hasChildren) {
                      onSelect(cat.id);
                      onToggle(cat.id);
                    } else {
                      onSelect(cat.id);
                      closeDrawer();
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
                    <span className="text-[10px] tabular-nums bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
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
                            closeDrawer();
                          }}
                          className={`w-full text-left ml-8 pr-4 py-2 text-[12px] flex items-center gap-2 ${
                            activeCategory === child.id ? 'text-primary-container' : 'text-slate-500'
                          }`}
                        >
                          <span
                            className={`w-1 h-1 rounded-full shrink-0 ${activeCategory === child.id ? 'bg-primary-container' : 'bg-slate-600'}`}
                          />
                          {child.name}
                          <span className="text-[10px] tabular-nums text-on-surface-variant/60 ml-auto">
                            {child.count}
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
