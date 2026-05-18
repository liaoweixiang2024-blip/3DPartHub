import Icon from '../shared/Icon';
import { useDelayedVisible } from './selectionUtils';

export function SelectionLoadingOverlay({ label }: { label: string }) {
  const showLabel = useDelayedVisible(true, 1500);

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 rounded-xl bg-surface-container-low/70 backdrop-blur-[1px]"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-low shadow-float">
        <Icon name="refresh" size={22} className="animate-spin text-primary-container motion-reduce:animate-none" />
      </div>
      {showLabel ? <p className="text-xs font-medium text-on-surface-variant">{label}...</p> : null}
    </div>
  );
}
