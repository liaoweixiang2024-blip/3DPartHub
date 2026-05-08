import { AnimatePresence, motion } from 'framer-motion';
import { useState, useRef, useEffect, useMemo, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { CategoryItem } from '../../api/categories';
import { useImeSafeSearchInput } from '../../hooks/useImeSafeSearchInput';
import { popoverMotion } from '../../lib/motion';
import Icon from './Icon';
import SearchField from './SearchField';

interface CategorySelectProps {
  categories: CategoryItem[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  autoFocusSearch?: boolean;
  portalDropdown?: boolean;
}

export default function CategorySelect({
  categories,
  value,
  onChange,
  placeholder = '选择分类',
  autoFocusSearch = true,
  portalDropdown = false,
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);
  const { value: search, setValue: setSearch, inputProps: searchInputProps } = useImeSafeSearchInput();
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updatePortalPosition = useCallback(() => {
    if (!portalDropdown || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const viewportPadding = 12;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const placeAbove = availableBelow < 220 && availableAbove > availableBelow;
    const maxHeight = Math.max(180, Math.min(360, placeAbove ? availableAbove - 4 : availableBelow - 4));
    setPortalStyle({
      left: rect.left,
      top: placeAbove ? undefined : rect.bottom + 4,
      bottom: placeAbove ? window.innerHeight - rect.top + 4 : undefined,
      width: rect.width,
      maxHeight,
    });
  }, [portalDropdown]);

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
      const target = e.target as Node;
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !portalDropdown) return;
    updatePortalPosition();
    window.addEventListener('resize', updatePortalPosition);
    window.addEventListener('scroll', updatePortalPosition, true);
    return () => {
      window.removeEventListener('resize', updatePortalPosition);
      window.removeEventListener('scroll', updatePortalPosition, true);
    };
  }, [open, portalDropdown, updatePortalPosition]);

  // Focus search input on open
  useEffect(() => {
    if (open) {
      setSearch('');
      if (autoFocusSearch) {
        setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
      }
    }
  }, [autoFocusSearch, open, setSearch]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const dropdownPanel = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          variants={popoverMotion}
          initial="initial"
          animate="animate"
          exit="exit"
          style={portalDropdown ? portalStyle || undefined : undefined}
          className={
            portalDropdown
              ? 'fixed z-[10060] flex flex-col overflow-hidden rounded-sm border border-outline-variant/20 bg-surface-container-low shadow-lg'
              : 'absolute left-0 right-0 top-full z-50 mt-1 flex flex-col overflow-hidden rounded-sm border border-outline-variant/20 bg-surface-container-low shadow-lg'
          }
        >
          {/* Search input */}
          <div className="border-b border-outline-variant/10 p-2">
            <SearchField
              inputRef={inputRef}
              inputProps={searchInputProps}
              value={search}
              onClear={() => setSearch('')}
              placeholder="搜索分类..."
            />
          </div>

          {/* Category list */}
          <div className="min-h-0 max-h-60 overflow-y-auto scrollbar-thin">
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
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (!open) updatePortalPosition();
          setOpen(!open);
        }}
        className="w-full flex items-center justify-between bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none cursor-pointer text-left min-w-0"
      >
        <span className={`min-w-0 truncate ${selectedName ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
          {selectedName || placeholder}
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} className="text-on-surface-variant shrink-0" />
      </button>

      {portalDropdown && typeof document !== 'undefined' ? createPortal(dropdownPanel, document.body) : dropdownPanel}
    </div>
  );
}
