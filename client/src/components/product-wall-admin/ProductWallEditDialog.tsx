import type { ProductWallItem, ProductWallKind } from '../../api/productWall';
import DialogOverlay from '../shared/DialogOverlay';
import Icon from '../shared/Icon';

type WallItem = ProductWallItem;

export function ProductWallEditDialog({
  editTitle,
  editDescription,
  editKind,
  editTags,
  categoryNames,
  setEditTitle,
  setEditDescription,
  setEditKind,
  setEditTags,
  onCancel,
  onSave,
}: {
  editingItem: WallItem;
  editTitle: string;
  editDescription: string;
  editKind: ProductWallKind;
  editTags: string;
  categoryNames: string[];
  setEditTitle: (value: string) => void;
  setEditDescription: (value: string) => void;
  setEditKind: (value: ProductWallKind) => void;
  setEditTags: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <DialogOverlay
      onClose={onCancel}
      zIndex={10000}
      backdropClassName="bg-black/35 backdrop-blur-sm"
      animated={false}
      className="px-4 py-6"
    >
      <form
        className="w-full max-w-lg rounded-sm border border-outline-variant/18 bg-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-primary-container">IMAGE SETTINGS</p>
            <h2 className="mt-1 text-lg font-bold text-on-surface">编辑图片信息</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="关闭"
            data-tooltip-ignore
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">标题</span>
            <input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
              placeholder="例如：不锈钢快插接头"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">描述</span>
            <textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-none border-b border-outline-variant/35 bg-transparent py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
              placeholder="补充图片内容、现场信息或使用场景"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">分类</span>
            <select
              value={editKind}
              onChange={(event) => setEditKind(event.target.value as ProductWallKind)}
              className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
            >
              {categoryNames.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-on-surface-variant">标签</span>
            <input
              value={editTags}
              onChange={(event) => setEditTags(event.target.value)}
              className="mt-1 h-10 w-full border-b border-outline-variant/35 bg-transparent text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
              placeholder="多个标签用逗号隔开"
            />
          </label>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-sm px-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            取消
          </button>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-sm bg-primary-container px-4 text-sm font-semibold text-on-primary-container transition-colors hover:bg-primary-container/90"
          >
            保存
          </button>
        </div>
      </form>
    </DialogOverlay>
  );
}
