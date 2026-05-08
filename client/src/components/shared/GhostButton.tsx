interface GhostButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export default function GhostButton({
  children,
  onClick,
  className = '',
  disabled = false,
  type = 'button',
}: GhostButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm text-sm font-medium border border-outline/40 text-secondary transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out hover:border-on-surface-variant/50 hover:bg-surface-container hover:text-on-surface active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${className}`}
    >
      {children}
    </button>
  );
}
