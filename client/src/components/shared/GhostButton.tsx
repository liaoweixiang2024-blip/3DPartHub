interface GhostButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

export default function GhostButton({
  children,
  onClick,
  className = "",
  disabled = false,
  type = "button",
}: GhostButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm text-sm font-medium border border-outline/40 text-secondary hover:text-on-surface hover:border-on-surface-variant/50 hover:bg-surface-container transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}
