import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

type QuickReplyChipsProps = {
  phrases: string[];
  onPick: (phrase: string) => void;
  className?: string;
  title?: string;
};

export default function QuickReplyChips({ phrases, onPick, className = '', title = '快捷词' }: QuickReplyChipsProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (phrases.length === 0) return null;

  return (
    <div ref={menuRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`grid h-9 w-9 place-items-center rounded-lg border border-outline-variant/20 text-on-surface-variant transition-colors hover:border-primary-container/25 hover:bg-primary-container/8 hover:text-primary-container md:h-10 md:w-10 ${
          open ? 'border-primary-container/30 bg-primary-container/10 text-primary-container' : ''
        }`}
        aria-label={title}
        aria-expanded={open}
      >
        <Icon name="quick_reply" size={17} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-lowest shadow-lg">
          <div className="border-b border-outline-variant/10 px-3 py-2 text-xs font-semibold text-on-surface">
            {title}
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5 scrollbar-hidden">
            {phrases.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => {
                  onPick(phrase);
                  setOpen(false);
                }}
                className="block w-full rounded-lg px-2.5 py-2 text-left text-xs leading-5 text-on-surface-variant transition-colors hover:bg-primary-container/10 hover:text-primary-container"
              >
                {phrase}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
