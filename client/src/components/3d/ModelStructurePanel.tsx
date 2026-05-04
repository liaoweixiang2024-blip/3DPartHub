import { useMemo, useState } from 'react';
import Icon from '../shared/Icon';
import type { ModelPartItem } from './viewerEvents';

interface ModelStructurePanelProps {
  variant: 'desktop' | 'mobile';
  parts: ModelPartItem[];
  selectedPartId?: string | null;
  hiddenPartIds: string[];
  isolatedPartId?: string | null;
  onSelect: (partId: string | null) => void;
  onToggleHidden: (partId: string) => void;
  onIsolate: (partId: string | null) => void;
  onShowAll: () => void;
  onClose: () => void;
}

function formatCount(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export default function ModelStructurePanel({
  variant,
  parts,
  selectedPartId,
  hiddenPartIds,
  isolatedPartId,
  onSelect,
  onToggleHidden,
  onIsolate,
  onShowAll,
  onClose,
}: ModelStructurePanelProps) {
  const [query, setQuery] = useState('');
  const hiddenSet = useMemo(() => new Set(hiddenPartIds), [hiddenPartIds]);
  const filteredParts = useMemo(() => {
    const text = query.trim().toLowerCase();
    const result = text ? parts.filter((part) => `${part.name} ${part.path}`.toLowerCase().includes(text)) : parts;
    return result.slice(0, 400);
  }, [parts, query]);
  const visibleCount = parts.filter(
    (part) => (!isolatedPartId || part.id === isolatedPartId) && !hiddenSet.has(part.id),
  ).length;
  const totalTriangles = useMemo(() => parts.reduce((sum, part) => sum + part.triangleCount, 0), [parts]);

  const panelClass =
    variant === 'mobile'
      ? 'absolute left-3 right-12 top-14 bottom-4 z-40'
      : 'absolute left-4 top-20 bottom-4 z-30 w-80';

  return (
    <div
      className={`${panelClass} micro-glass rounded-md border border-outline-variant/20 bg-surface/92 shadow-xl backdrop-blur-xl flex flex-col overflow-hidden`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/15 px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="view_sidebar" size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-on-surface">模型结构</h3>
          </div>
          <p className="mt-1 text-[11px] text-on-surface-variant">
            {visibleCount}/{parts.length} 可见 · {formatCount(totalTriangles)} 面
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭模型结构"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="space-y-2 border-b border-outline-variant/15 p-3">
        <div className="flex items-center gap-2 rounded-sm border border-outline-variant/20 bg-surface-container-low px-2 py-1.5">
          <Icon name="search" size={14} className="text-on-surface-variant" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索零件"
            className="min-w-0 flex-1 bg-transparent text-xs text-on-surface outline-none placeholder:text-on-surface-variant/50"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onShowAll}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-outline-variant/20 px-2 py-1.5 text-[11px] text-on-surface-variant hover:border-primary/30 hover:text-on-surface"
          >
            <Icon name="visibility" size={13} />
            全部显示
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-outline-variant/20 px-2 py-1.5 text-[11px] text-on-surface-variant hover:border-primary/30 hover:text-on-surface"
          >
            <Icon name="close" size={13} />
            取消选中
          </button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {parts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-on-surface-variant">
            <Icon name="view_in_ar" size={30} className="opacity-40" />
            正在读取零件结构
          </div>
        ) : filteredParts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-on-surface-variant">
            <Icon name="search_off" size={30} className="opacity-40" />
            没有匹配的零件
          </div>
        ) : (
          <div className="space-y-1">
            {filteredParts.map((part, index) => {
              const hidden = hiddenSet.has(part.id);
              const isolated = isolatedPartId === part.id;
              const selected = selectedPartId === part.id;
              return (
                <div
                  key={`${part.id || part.name || 'part'}-${index}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(part.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelect(part.id);
                  }}
                  className={`group flex w-full items-center gap-2 rounded-sm border px-2 py-2 text-left transition-colors ${
                    selected
                      ? 'border-primary/40 bg-primary-container/15'
                      : 'border-transparent hover:border-outline-variant/20 hover:bg-surface-container-high/60'
                  } ${hidden ? 'opacity-45' : ''}`}
                >
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${isolated ? 'bg-primary' : selected ? 'bg-cyan-400' : 'bg-outline-variant/60'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-on-surface">{part.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-on-surface-variant">
                      {formatCount(part.vertexCount)} 点 · {formatCount(part.triangleCount)} 面
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      title={hidden ? '显示零件' : '隐藏零件'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleHidden(part.id);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                    >
                      <Icon name={hidden ? 'visibility_off' : 'visibility'} size={14} />
                    </button>
                    <button
                      type="button"
                      title={isolated ? '取消隔离' : '隔离零件'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onIsolate(isolated ? null : part.id);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
                    >
                      <Icon name="locate_fixed" size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {filteredParts.length >= 400 && (
        <div className="border-t border-outline-variant/15 px-3 py-2 text-[10px] text-on-surface-variant">
          当前仅显示前 400 个匹配零件，请用搜索缩小范围。
        </div>
      )}
    </div>
  );
}
