import { useState, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Icon from './Icon';
import type { CategoryItem } from '../../api/categories';

interface CategorySelectProps {
  categories: CategoryItem[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

export default function CategorySelect({ categories, value, onChange, placeholder = '选择分类' }: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find selected category name
  const selectedName = useMemo(() => {
    if (!value) return '';
    for (const c of categories) {
      if (c.id === value) return c.name;
      if (c.children) {
        for (const ch of c.children) {
          if (ch.id === value) return `${c.name} / ${ch.name}`;
        }
      }
    }
    return '';
  }, [categories, value]);

  // Filter categories by search
  const filtered = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories
      .map((c) => {
        const nameMatch = c.name.toLowerCase().includes(q);
        const matchedChildren = c.children?.filter((ch) => ch.name.toLowerCase().includes(q)) || [];
        if (nameMatch) return { ...c, children: c.children };
        if (matchedChildren.length > 0) return { ...c, children: matchedChildren };
        return null;
      })
      .filter(Boolean) as CategoryItem[];
  }, [categories, search]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search input on open
  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none cursor-pointer text-left min-w-0"
      >
        <span className={`min-w-0 truncate ${selectedName ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
          {selectedName || placeholder}
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} className="text-on-surface-variant shrink-0" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface-container-low border border-outline-variant/20 rounded-sm shadow-lg overflow-hidden"
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/10">
              <Icon name="search" size={14} className="text-on-surface-variant shrink-0" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索分类..."
                className="bg-transparent border-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 w-full"
              />
            </div>

            {/* Category list */}
            <div className="max-h-60 overflow-y-auto scrollbar-thin">
              {/* Uncategorized option */}
              <button
                type="button"
                onClick={() => handleSelect('')}
                className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                  !value
                    ? 'bg-primary-container/20 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <Icon name="folder_off" size={14} className="shrink-0" />
                未分类
              </button>

              {filtered.length === 0 && (
                <div className="px-3 py-4 text-sm text-on-surface-variant text-center">无匹配分类</div>
              )}

              {filtered.map((cat) => (
                <div key={cat.id}>
                  {/* Parent category */}
                  <button
                    type="button"
                    onClick={() => handleSelect(cat.id)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                      value === cat.id
                        ? 'bg-primary-container/20 text-primary'
                        : 'text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    <Icon name={cat.icon || 'folder'} size={14} className="shrink-0 text-on-surface-variant" />
                    <span className="font-medium min-w-0 break-words">{cat.name}</span>
                    {cat.count !== undefined && (
                      <span className="text-[10px] text-on-surface-variant/60 ml-auto">{cat.count}</span>
                    )}
                  </button>

                  {/* Children */}
                  {cat.children?.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => handleSelect(child.id)}
                      className={`w-full text-left pl-8 pr-3 py-1.5 text-sm transition-colors flex items-center gap-2 ${
                        value === child.id
                          ? 'bg-primary-container/20 text-primary'
                          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                      }`}
                    >
                      <span className="text-on-surface-variant/30">└</span>
                      <span className="min-w-0 break-words">{child.name}</span>
                      {child.count !== undefined && (
                        <span className="text-[10px] text-on-surface-variant/60 ml-auto">{child.count}</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
