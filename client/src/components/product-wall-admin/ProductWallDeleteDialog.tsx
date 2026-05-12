import type { ProductWallItem } from '../../api/productWall';
import Icon from '../shared/Icon';
import SafeImage from '../shared/SafeImage';

type WallItem = ProductWallItem;

export type DeleteDialogState = { type: 'single'; item: WallItem } | { type: 'batch'; ids: string[] } | null;

export function ProductWallDeleteDialog({
  deleteDialog,
  deleting,
  onCancel,
  onConfirm,
}: {
  deleteDialog: DeleteDialogState;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!deleteDialog) return null;

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/42 px-4 py-6 backdrop-blur-md"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <section
        className="w-full max-w-md overflow-hidden rounded-xl border border-outline-variant/16 bg-surface shadow-[0_28px_100px_rgba(0,0,0,0.32)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600">
              <Icon name="delete" size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-[0.18em] text-red-600">DELETE IMAGE</p>
              <h2 className="mt-1 text-lg font-bold tracking-[-0.03em] text-on-surface">确认删除图片？</h2>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                {deleteDialog.type === 'single'
                  ? '删除后图片会从产品图库和图片管理中移除，已上传到本地的图片文件也会一并清理。'
                  : `将删除已选的 ${deleteDialog.ids.length} 张图片，删除后无法恢复。`}
              </p>
            </div>
          </div>

          {deleteDialog.type === 'single' ? (
            <div className="mt-5 flex items-center gap-3 border-y border-outline-variant/12 py-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-surface-container">
                <SafeImage
                  src={deleteDialog.item.image}
                  alt={deleteDialog.item.title}
                  className="h-full w-full object-cover"
                  fallbackClassName="h-full w-full"
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-on-surface">{deleteDialog.item.title}</p>
                <p className="mt-1 text-xs text-on-surface-variant">{deleteDialog.item.kind}</p>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-red-500/16 bg-red-500/6 px-4 py-3 text-sm text-red-700">
              已选择 <span className="font-semibold">{deleteDialog.ids.length}</span> 张图片，请确认是否批量删除。
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-outline-variant/12 bg-surface-container-low/60 px-5 py-4">
          <button
            type="button"
            disabled={deleting}
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-sm px-4 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => onConfirm()}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name={deleting ? 'sync' : 'delete'} size={16} className={deleting ? 'animate-spin' : ''} />
            {deleting ? '删除中' : '确认删除'}
          </button>
        </div>
      </section>
    </div>
  );
}
