import { motion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { popoverMotion } from '../../lib/motion';
import Icon from './Icon';

export interface SelectMenuOption {
  value: string;
  label: ReactNode;
  /** 触发器与选项行左侧的小图标（Material 名） */
  icon?: string;
  /** 分组标题项：不可选中，仅作弹层内的组分隔标题（value 需组内唯一，如 `heading:组名`） */
  heading?: boolean;
}

interface SelectMenuProps {
  options: SelectMenuOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** toolbar：工具栏筛选（h-9）；chip：行内/批量小尺寸（h-7）；field：表单字段（占满宽） */
  variant?: 'toolbar' | 'chip' | 'field';
  /** value 不在 options 中时触发器显示的占位（如「选择角色」） */
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const TRIGGER_CLASS: Record<NonNullable<SelectMenuProps['variant']>, string> = {
  toolbar:
    'h-9 w-auto gap-1.5 rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 text-sm hover:border-outline-variant/40',
  chip: 'h-7 w-auto gap-1 rounded-md border border-outline-variant/20 bg-surface-container-high px-2 text-xs hover:border-outline-variant/40',
  field:
    'h-auto w-full gap-2 rounded-md border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-sm hover:border-outline-variant/40',
};

/**
 * 主题化下拉选择：替代原生 <select>（原生弹出层不跟主题/暗色模式，观感割裂）。
 * 弹层走 fixed + portal（表格行/工具栏贴近视口底部时自动向上翻），点击外部或 Esc 关闭。
 */
export default function SelectMenu({
  options,
  value,
  onChange,
  ariaLabel,
  variant = 'toolbar',
  placeholder,
  className,
  disabled = false,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);
  const triggerLabel = selected ? selected.label : (placeholder ?? options[0]?.label ?? '');

  const updatePosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 12;
    const estimatedMaxHeight = 320;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const placeAbove = availableBelow < Math.min(220, estimatedMaxHeight) && availableAbove > availableBelow;
    setPortalStyle({
      position: 'fixed',
      left: rect.left,
      minWidth: rect.width,
      top: placeAbove ? undefined : rect.bottom + 4,
      bottom: placeAbove ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: placeAbove ? Math.max(180, availableAbove - 4) : Math.max(180, availableBelow - 4),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
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

  const commit = (option: SelectMenuOption) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  return (
    <div ref={rootRef} className={`relative inline-flex ${disabled ? 'opacity-50' : ''} ${className ?? ''}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className={`inline-flex shrink-0 cursor-pointer items-center justify-between text-on-surface outline-none transition-colors focus-visible:border-primary ${
          TRIGGER_CLASS[variant]
        } ${open ? 'border-primary/50' : ''}`}
      >
        {selected?.icon ? (
          <Icon name={selected.icon} size={14} className="shrink-0 text-on-surface-variant/60" />
        ) : null}
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <Icon
          name="expand_more"
          size={16}
          className={`shrink-0 text-on-surface-variant/60 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {/* portal 放在动画层之外：AnimatePresence 直接包 portal 子节点不渲染
          （只认直接 motion 子节点；CategorySelect 同款结构——portal 在外、motion 在内）。
          关闭即卸载、不做退场动画，入场用 popoverMotion */}
      {open && portalStyle && typeof document !== 'undefined'
        ? createPortal(
            <motion.ul
              role="listbox"
              style={portalStyle}
              initial={popoverMotion.initial}
              animate={popoverMotion.animate}
              className="z-50 w-max min-w-[8rem] overflow-y-auto rounded-lg border border-outline-variant/15 bg-surface-container py-1 shadow-xl shadow-black/10 custom-scrollbar"
              /* 弹层挂在 body（portal），不在 root 容器内——不拦截的话选项自身的
                 pointerdown 会被「点击外部关闭」误判，弹层在 click 落地前就被卸载 */
              onPointerDown={(event) => event.stopPropagation()}
            >
              {options.map((option) => {
                const active = option.value === value;
                if (option.heading) {
                  return (
                    <li
                      key={option.value}
                      role="presentation"
                      className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant/60 first:pt-1"
                    >
                      {option.label}
                    </li>
                  );
                }
                return (
                  <li key={option.value || 'empty'} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        commit(option);
                      }}
                      className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                        active
                          ? 'font-medium text-primary-container'
                          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                      }`}
                    >
                      {option.icon ? <Icon name={option.icon} size={14} className="shrink-0 opacity-70" /> : null}
                      <span className="min-w-0 truncate">{option.label}</span>
                      {active ? <Icon name="check" size={14} className="ml-auto shrink-0" /> : null}
                    </button>
                  </li>
                );
              })}
            </motion.ul>,
            document.body,
          )
        : null}
    </div>
  );
}
