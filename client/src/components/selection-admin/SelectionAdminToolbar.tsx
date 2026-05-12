import { useState, useRef, useEffect } from 'react';
import Icon from '../shared/Icon';
import { SELECTION_TOOLBAR_BUTTON_SECONDARY } from './constants';

export function SelectionToolbarButtonContent({ icon, children }: { icon: string; children: string }) {
  return (
    <span className="inline-grid grid-cols-[14px_auto] items-center justify-center gap-1 md:gap-1.5">
      <span className="flex items-center justify-center">
        <Icon name={icon} size={14} />
      </span>
      <span className="whitespace-nowrap">{children}</span>
    </span>
  );
}

export function ToolbarMoreMenu({
  items,
}: {
  items: { label: string; icon: string; action: () => void; disabled?: boolean }[];
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

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
        <SelectionToolbarButtonContent icon="settings">更多设置</SelectionToolbarButtonContent>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[10rem] overflow-hidden rounded-lg border border-outline-variant/15 bg-surface-container-high shadow-lg animate-in fade-in-0 zoom-in-95">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (!item.disabled) {
                  setOpen(false);
                  item.action();
                }
              }}
              disabled={item.disabled}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35"
            >
              <Icon name={item.icon} size={14} />
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
