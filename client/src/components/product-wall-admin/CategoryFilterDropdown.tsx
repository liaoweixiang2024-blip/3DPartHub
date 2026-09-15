import { useEffect, useRef, useState } from 'react';
import type { ProductWallCategory } from '../../api/productWall';
import Icon from '../shared/Icon';

interface CategoryFilterDropdownProps {
  categories: ProductWallCategory[];
  value: string;
  allValue: string;
  allLabel: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

/** 分类筛选下拉：自绘弹出菜单（与 SearchField 同套外观），替代操作系统原生 select */
export default function CategoryFilterDropdown({
  categories,
  value,
  allValue,
  allLabel,
  onChange,
  ariaLabel,
}: CategoryFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isAll = value === allValue || !categories.some((category) => category.name === value);
  const activeName = isAll ? allLabel : value;
  const effectiveValue = isAll ? allValue : value;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const renderItem = (key: string, label: string, icon: string) => {
    const active = key === effectiveValue;
    return (
      <button
        key={key}
        type="button"
        role="option"
        aria-selected={active}
        onClick={() => {
          onChange(key);
          setOpen(false);
        }}
        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
          active
            ? 'bg-primary-container/12 font-medium text-primary-container'
            : 'text-on-surface hover:bg-surface-container-high'
        }`}
      >
        <Icon
          name={icon}
          size={15}
          className={`shrink-0 ${active ? 'text-primary-container' : 'text-on-surface-variant'}`}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active ? <Icon name="check" size={14} className="shrink-0" /> : null}
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? allLabel}
        title={activeName}
        data-tooltip-ignore
        className={`flex h-9 max-w-[200px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
          open
            ? 'border-primary-container/45 bg-surface-container-high/65 text-on-surface'
            : 'border-outline-variant/20 bg-surface-container-lowest/30 text-on-surface-variant hover:border-outline-variant/35 hover:bg-surface-container-high/65 hover:text-on-surface'
        }`}
      >
        <Icon name="folder" size={14} className={`shrink-0 ${isAll ? '' : 'text-primary-container'}`} />
        <span className="min-w-0 truncate leading-none">{activeName}</span>
        <Icon
          name="expand_more"
          size={14}
          className={`shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute right-0 top-full z-30 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-lg border border-outline-variant/16 bg-surface py-1.5 shadow-panel custom-scrollbar"
        >
          <div className="px-1">
            {renderItem(allValue, allLabel, 'apps')}
            {categories.map((category) => renderItem(category.name, category.name, 'folder'))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
