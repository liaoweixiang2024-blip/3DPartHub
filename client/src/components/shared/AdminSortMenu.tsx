import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * 管理页排序/单选下拉：替代原生 <select>（系统样式与站点不搭、展开跳系统面板显卡顿）。
 * 触发按钮与工具栏次级按钮同款；浮层样式与 ToolbarMoreMenu 一致。
 */
export default function AdminSortMenu({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeLabel = options.find((o) => o.value === value)?.label ?? '';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-sm text-on-surface-variant hover:text-on-surface"
      >
        {activeLabel}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="opacity-70" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[9rem] overflow-hidden rounded-lg border border-outline-variant/15 bg-surface-container-high shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  if (!active) onChange(option.value);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'text-on-surface'
                    : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                }`}
              >
                <span className="w-3.5 shrink-0">{active ? <Icon name="check" size={13} /> : null}</span>
                <span className="whitespace-nowrap">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
