import Icon from '../shared/Icon';
import { useDelayedVisible } from './selectionUtils';

export function SelectionInlineLoading({ label }: { label: string }) {
  const showLabel = useDelayedVisible(true, 1500);

  return (
    <div
      className="flex min-h-[148px] flex-col items-center justify-center gap-2.5 py-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-low shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
        <Icon name="refresh" size={24} className="animate-spin text-primary-container motion-reduce:animate-none" />
      </div>
      {showLabel ? <p className="text-xs font-medium text-on-surface-variant">{label}...</p> : null}
    </div>
  );
}
