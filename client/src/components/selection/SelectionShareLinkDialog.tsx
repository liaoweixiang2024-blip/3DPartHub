import Icon from '../shared/Icon';
import type { ShareLinkDialogState } from './selectionUtils';

export function SelectionShareLinkDialog({
  state,
  onClose,
  onCopy,
  onNativeShare,
  nativeSharePending = false,
}: {
  state: ShareLinkDialogState | null;
  onClose: () => void;
  onCopy: () => void;
  onNativeShare: () => void;
  nativeSharePending?: boolean;
}) {
  if (!state) return null;

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-outline-variant/20 bg-surface-container-high p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container/15 text-primary">
            <Icon name="share" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-on-surface">{state.title}</h3>
            <p className="mt-1 text-sm leading-5 text-on-surface-variant">{state.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
            aria-label="关闭"
            data-tooltip-ignore
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <input
          readOnly
          value={state.url}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-4 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary-container"
        />
        <div className="mt-4 flex gap-2">
          {canNativeShare ? (
            <button
              type="button"
              onClick={onNativeShare}
              disabled={nativeSharePending}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-outline-variant/25 px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-55"
              data-tooltip-ignore
            >
              <Icon name="share" size={16} />
              {nativeSharePending ? '分享中...' : '系统分享'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3 text-sm font-bold text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98]"
            data-tooltip-ignore
          >
            <Icon name="content_copy" size={16} />
            复制链接
          </button>
        </div>
      </div>
    </div>
  );
}
