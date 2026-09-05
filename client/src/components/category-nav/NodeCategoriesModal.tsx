import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../shared/Icon';

/**
 * 节点分类弹窗：点击拓扑图节点后弹出——无边框悬浮式。
 *
 * - 遮罩：整页微微模糊 + 轻压暗，内容直接悬浮其上（无卡片边框/面板）
 * - 中间：节点大图（投影悬浮；未配图回退默认插画）→ 标题 → 分类网格（毛玻璃白底圆角块，无边框）
 * - 分类卡整卡可点（无按钮）→ 新窗口打开首页分类过滤
 * - 交互：点遮罩 / Esc / 右上角 × 关闭
 */

/** 单条分类行：名称 + 模型库目标 */
export interface ModalCategoryItem {
  label: string;
  imageUrl?: string;
  /** 无图兜底：分类目录的 Material 图标名 */
  fallbackIcon?: string;
  /** 模型库目标 categoryId */
  modelCategoryId?: string;
}

export default function NodeCategoriesModal({
  open,
  onClose,
  nodeLabel,
  nodeImage,
  fallbackIcon,
  items,
  onModelCategoryClick,
}: {
  open: boolean;
  onClose: () => void;
  nodeLabel: string;
  nodeImage?: string;
  /** 未配节点图/分类图时的兜底：该卡位的默认 SMC 插画 */
  fallbackIcon?: ReactNode;
  items: ModalCategoryItem[];
  onModelCategoryClick?: (categoryId: string) => void;
}) {
  // Esc 关闭；打开时锁定背景滚动
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={nodeLabel}
    >
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 关闭按钮：悬浮右上角 */}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute -top-1 right-0 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/25 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-white/40"
        >
          <Icon name="close" size={20} />
        </button>

        {/* 节点大图：无边框直接悬浮，投影分层；未配图回退默认插画（强制放大覆盖 h-20 等原尺寸类）。手机端缩档（sm:max-h-48） */}
        {nodeImage || fallbackIcon ? (
          <div className="grid max-h-48 shrink-0 place-items-center pb-2 sm:max-h-80">
            {nodeImage ? (
              <img src={nodeImage} alt={nodeLabel} className="max-h-48 object-contain drop-shadow-2xl sm:max-h-80" />
            ) : (
              <div className="node-modal-hero drop-shadow-2xl">{fallbackIcon}</div>
            )}
          </div>
        ) : null}

        {/* 标题：白字投影，居中 */}
        <h2 className="shrink-0 pb-4 pt-1 text-center text-xl font-bold text-white drop-shadow-md">{nodeLabel}</h2>

        {/* 分类网格：毛玻璃白块，无边框；整卡可点（新窗口打开模型库分类）。手机端 2 列紧凑网格，底部避开刘海。
            单条分类用紧凑行式卡（图标/图片槽收窄），避免整行大卡里图标孤零零悬空 */}
        <div
          className="min-h-0 flex-1 overflow-y-auto pb-2"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <div className={`grid gap-2.5 sm:gap-4 ${items.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {items.map((it, i) =>
              it.modelCategoryId ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onModelCategoryClick?.(it.modelCategoryId!)}
                  className={`hover-card flex items-center justify-center gap-3 rounded-xl bg-white/90 px-4 py-3 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-xl ${
                    items.length === 1 ? 'mx-auto w-full max-w-xs flex-row' : 'flex-col pb-4 pt-3'
                  }`}
                >
                  {items.length === 1 ? (
                    // 单条：横排紧凑行——小图/图标圆片 + 名称，不再撑满 aspect 大槽
                    <>
                      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden">
                        {it.imageUrl ? (
                          <img
                            src={it.imageUrl}
                            alt={it.label}
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        ) : it.fallbackIcon ? (
                          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-container/10">
                            <Icon name={it.fallbackIcon} size={22} className="text-primary-container" />
                          </span>
                        ) : (
                          <Icon name="image" size={24} className="text-on-surface-variant/30" />
                        )}
                      </span>
                      <span className="min-w-0 truncate text-sm font-semibold text-on-surface">{it.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden">
                        {it.imageUrl ? (
                          <img
                            src={it.imageUrl}
                            alt={it.label}
                            className="h-full w-full object-contain p-1"
                            loading="lazy"
                          />
                        ) : it.fallbackIcon ? (
                          // 无图兜底：分类目录的 Material 图标（浅色底圆片 + 主题色图标，排版比图片小一档）
                          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-container/10">
                            <Icon name={it.fallbackIcon} size={22} className="text-primary-container" />
                          </span>
                        ) : (
                          <Icon name="image" size={26} className="text-on-surface-variant/30" />
                        )}
                      </span>
                      <span className="flex w-full min-w-0 items-center justify-center pt-2 text-center">
                        <span className="min-w-0 truncate text-sm font-semibold text-on-surface">{it.label}</span>
                      </span>
                    </>
                  )}
                </button>
              ) : (
                <div
                  key={i}
                  className={`flex items-center justify-center gap-3 rounded-xl bg-white/90 px-4 py-3 opacity-90 shadow-lg backdrop-blur-sm ${
                    items.length === 1 ? 'mx-auto w-full max-w-xs flex-row' : 'flex-col pb-4 pt-3'
                  }`}
                >
                  {items.length === 1 ? (
                    <>
                      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden">
                        {it.imageUrl ? (
                          <img
                            src={it.imageUrl}
                            alt={it.label}
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        ) : it.fallbackIcon ? (
                          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-container/10">
                            <Icon name={it.fallbackIcon} size={22} className="text-primary-container" />
                          </span>
                        ) : (
                          <Icon name="image" size={24} className="text-on-surface-variant/30" />
                        )}
                      </span>
                      <span className="min-w-0 truncate text-sm font-semibold text-on-surface">{it.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden">
                        {it.imageUrl ? (
                          <img
                            src={it.imageUrl}
                            alt={it.label}
                            className="h-full w-full object-contain p-1"
                            loading="lazy"
                          />
                        ) : it.fallbackIcon ? (
                          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-container/10">
                            <Icon name={it.fallbackIcon} size={22} className="text-primary-container" />
                          </span>
                        ) : (
                          <Icon name="image" size={26} className="text-on-surface-variant/30" />
                        )}
                      </span>
                      <span className="flex w-full min-w-0 items-center justify-center pt-2 text-center">
                        <span className="min-w-0 truncate text-sm font-semibold text-on-surface">{it.label}</span>
                      </span>
                    </>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
