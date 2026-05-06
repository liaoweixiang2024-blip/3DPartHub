interface FormatTagProps {
  format: string;
  size?: 'default' | 'xs';
}

export default function FormatTag({ format, size = 'default' }: FormatTagProps) {
  const upper = format.toUpperCase();

  return (
    <span
      className={`inline-flex items-center bg-surface-container-highest/80 backdrop-blur-md text-on-surface font-mono rounded-sm border border-outline-variant/30 uppercase tracking-wider ${
        size === 'xs' ? 'text-[7px] px-1 py-px' : 'text-[9px] px-1.5 py-0.5'
      }`}
    >
      {upper}
    </span>
  );
}
