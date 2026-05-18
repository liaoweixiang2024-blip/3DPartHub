import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Icon from './Icon';

export type AdminButtonVariant = 'primary' | 'secondary' | 'tonal' | 'danger' | 'ghost' | 'warning' | 'success';
export type AdminButtonSize = 'sm' | 'md' | 'icon-sm' | 'icon-md';

const baseButtonClass =
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container/60 disabled:cursor-not-allowed disabled:opacity-50';

const buttonSizeClasses: Record<AdminButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-md px-2.5 text-xs',
  md: 'h-9 gap-1.5 rounded-lg px-3 text-xs',
  'icon-sm': 'h-8 w-8 rounded-md p-0',
  'icon-md': 'h-9 w-9 rounded-lg p-0',
};

const buttonVariantClasses: Record<AdminButtonVariant, string> = {
  primary: 'border border-transparent bg-primary-container text-on-primary shadow-sm hover:opacity-90',
  secondary:
    'border border-outline-variant/20 bg-surface-container-lowest/30 text-on-surface-variant hover:border-outline-variant/35 hover:bg-surface-container-high/65 hover:text-on-surface',
  tonal:
    'border border-primary-container/15 bg-primary-container/10 text-primary-container hover:bg-primary-container/15',
  danger: 'border border-error/20 bg-error/10 text-error hover:bg-error/15',
  ghost:
    'border border-transparent bg-transparent text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface',
  warning: 'border border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500/15',
  success: 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15',
};

export function adminButtonClass({
  active = false,
  className,
  size = 'md',
  variant = 'secondary',
}: {
  active?: boolean;
  className?: string;
  size?: AdminButtonSize;
  variant?: AdminButtonVariant;
} = {}) {
  return [
    baseButtonClass,
    buttonSizeClasses[size],
    active ? buttonVariantClasses.tonal : buttonVariantClasses[variant],
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export function adminIconSize(size: AdminButtonSize = 'md') {
  return size === 'sm' || size === 'icon-sm' ? 14 : 16;
}

interface AdminButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children?: ReactNode;
  icon?: string;
  iconClassName?: string;
  iconSize?: number;
  size?: AdminButtonSize;
  variant?: AdminButtonVariant;
}

export function AdminButton({
  active,
  children,
  className,
  icon,
  iconClassName,
  iconSize,
  size = 'md',
  type = 'button',
  variant = 'secondary',
  ...props
}: AdminButtonProps) {
  return (
    <button type={type} className={adminButtonClass({ active, className, size, variant })} {...props}>
      {icon ? <Icon name={icon} size={iconSize ?? adminIconSize(size)} className={iconClassName} /> : null}
      {children}
    </button>
  );
}

interface AdminIconButtonProps extends Omit<AdminButtonProps, 'children' | 'icon'> {
  icon: string;
}

export function AdminIconButton({
  'aria-label': ariaLabel,
  icon,
  iconClassName,
  iconSize,
  size = 'icon-md',
  ...props
}: AdminIconButtonProps) {
  return (
    <AdminButton
      aria-label={ariaLabel}
      icon={icon}
      iconClassName={iconClassName}
      iconSize={iconSize ?? adminIconSize(size)}
      size={size}
      {...props}
    />
  );
}
