import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { Category } from '../../../../components/home/homeTypes';
import Icon from '../../../../components/shared/Icon';

export default function CategorySidebar({
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
  totalCount: number;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="home-category-sidebar hidden md:flex w-56 bg-surface-container-low flex-col border-r border-primary-container/10 shrink-0 py-4 gap-2">
      <div className="home-category-header px-5 py-3 border-b border-surface">
        <h2 className="home-category-title text-sm font-bold text-on-surface tracking-wider uppercase font-headline">
          {t('home.catalog')}
        </h2>
      </div>
      <div className="flex-1 px-3 py-2 flex flex-col gap-0.5 overflow-y-auto scrollbar-hidden">
        <button
          onClick={() => onSelect('all')}
          className={`home-category-item home-category-item-all w-full flex items-center justify-between px-4 py-2 text-sm transition-colors rounded-sm ${
            activeCategory === 'all'
              ? 'home-category-item-active border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'
          }`}
        >
          <span className="flex items-center gap-2">
            <Icon name="category_all" size={18} />
            {t('home.allModels')}
          </span>
          <span className="home-category-count text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
            {totalCount || categoriesData.reduce((sum, category) => sum + category.count, 0)}
          </span>
        </button>
        {categoriesData.map((category) => {
          const isExpanded = expandedCategories.has(category.id);
          const hasChildren = category.children && category.children.length > 0;
          const isActive =
            category.id === activeCategory ||
            (category.children?.some((child) => child.id === activeCategory) ?? false);
          return (
            <div key={category.id}>
              <button
                onClick={() => {
                  if (hasChildren) {
                    onSelect(category.id);
                    onToggle(category.id);
                  } else {
                    onSelect(category.id);
                  }
                }}
                className={`home-category-item w-full flex items-center justify-between px-4 py-2 text-sm transition-colors rounded-sm ${
                  isActive
                    ? 'home-category-item-active border-l-2 border-primary-container text-primary-container bg-gradient-to-r from-primary-container/15 to-transparent'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon name={category.icon} size={18} />
                  {category.name}
                </span>
                <span className="flex items-center gap-1.5">
                  {hasChildren && (
                    <motion.span
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-on-surface-variant/60"
                    >
                      <Icon name="expand_more" size={14} />
                    </motion.span>
                  )}
                  <span className="home-category-count text-[10px] bg-primary/20 px-1.5 py-0.5 rounded-sm text-primary font-medium">
                    {category.count}
                  </span>
                </span>
              </button>
              <AnimatePresence>
                {hasChildren && isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    {category.children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => onSelect(child.id)}
                        className={`home-category-child w-full text-left ml-8 pr-4 py-1.5 text-[12px] transition-colors flex items-center gap-2 ${
                          activeCategory === child.id
                            ? 'home-category-child-active text-primary-container'
                            : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <span
                          className={`w-1 h-1 rounded-full shrink-0 ${
                            activeCategory === child.id ? 'bg-primary-container' : 'bg-on-surface-variant'
                          }`}
                        />
                        {child.name}
                        <span className="home-category-child-count text-[10px] text-on-surface-variant/60 ml-auto">
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
  );
}
