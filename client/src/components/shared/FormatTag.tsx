interface FormatTagProps {
  format: string;
}

export default function FormatTag({ format }: FormatTagProps) {
  const upper = format.toUpperCase();

  return (
    <span
      className={`inline-flex items-center bg-surface-container-highest/80 backdrop-blur-md text-on-surface font-mono rounded-sm border border-outline-variant/30 uppercase tracking-wider text-[9px] px-1.5 py-0.5`}
    >
      {upper}
    </span>
  );
}
