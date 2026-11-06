import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../shared/Icon';

/* 导出清单的文件名确认弹窗：预填默认名（不含扩展名），可直接下载也可改名。
   与 SelectionShareLinkDialog 同款弹窗（移动端底部弹起 / 桌面居中） */
export function SelectionExportDialog({
  open,
  defaultFileName,
  pending = false,
  onDownload,
  onClose,
}: {
  open: boolean;
  /** 默认文件名（不含 .xlsx 扩展名），打开时预填 */
  defaultFileName: string;
  /** 下载进行中（首次动态 import write-excel-file 有短暂延迟） */
  pending?: boolean;
  onDownload: (fileName: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultFileName);
  const inputRef = useRef<HTMLInputElement>(null);

  /* 每次打开重置为默认名并全选——连续导出（改数量再导）不会残留上次的改名 */
  useEffect(() => {
    if (open) {
      setName(defaultFileName);
      // 弹窗动画一帧后再聚焦，避免 focus 与 opacity 动画争抢
      const id = window.setTimeout(() => inputRef.current?.select(), 50);
      return () => window.clearTimeout(id);
    }
  }, [open, defaultFileName]);

  if (!open) return null;

  /* 清理 Windows/macOS 文件系统非法字符与控制字符；全清理后为空则回退默认名 */
  const sanitize = (value: string) =>
    value
      .replace(/[\\/:*?"<>|\p{Cc}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim() || defaultFileName;

  const submit = () => {
    if (pending) return;
    onDownload(sanitize(name));
  };

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
            <Icon name="download" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-on-surface">{t('selectionPage.inquiryCart.exportTitle')}</h3>
            <p className="mt-1 text-sm leading-5 text-on-surface-variant">
              {t('selectionPage.inquiryCart.exportDialog.hint')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
            aria-label={t('common.close')}
            data-tooltip-ignore
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <label className="mt-4 block text-xs font-medium text-on-surface-variant" htmlFor="selection-export-filename">
          {t('selectionPage.inquiryCart.exportDialog.fileNameLabel')}
        </label>
        <div className="mt-1.5 flex h-10 items-center rounded-lg border border-outline-variant/20 bg-surface-container-low pl-3 focus-within:border-primary-container">
          <input
            id="selection-export-filename"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') onClose();
            }}
            placeholder={defaultFileName}
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/40"
          />
          {/* 扩展名缀饰：常亮展示，用户只编辑主名 */}
          <span className="shrink-0 px-3 text-sm text-on-surface-variant/60">.xlsx</span>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-outline-variant/25 px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-55"
            data-tooltip-ignore
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3 text-sm font-bold text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
            data-tooltip-ignore
          >
            {pending ? (
              <Icon name="refresh" size={16} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Icon name="download" size={16} />
            )}
            {t('selectionPage.inquiryCart.exportDialog.download')}
          </button>
        </div>
      </div>
    </div>
  );
}
