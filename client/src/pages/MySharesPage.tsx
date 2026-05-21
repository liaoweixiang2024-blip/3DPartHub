import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { deleteShare, listShares, type ShareLink } from '../api/shares';
import {
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminManagementPage,
} from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { copyText } from '../lib/clipboard';
import { toolbarMotion } from '../lib/motion';

function getShareUrl(share: ShareLink) {
  const path = share.type === 'selection' ? `/selection/s/${share.token}` : `/share/${share.token}`;
  return `${window.location.origin}${path}`;
}

function getSharePath(share: ShareLink) {
  return share.type === 'selection' ? `/selection/s/${share.token}` : `/share/${share.token}`;
}

function isExpired(expiresAt: string | null) {
  return Boolean(expiresAt && new Date(expiresAt) < new Date());
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN');
}

function ShareTypeBadge({ type }: { type?: ShareLink['type'] }) {
  const isSelection = type === 'selection';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${isSelection ? 'bg-blue-500/10 text-blue-400' : 'bg-primary-container/12 text-primary-container'}`}
    >
      {isSelection ? '选型' : '模型'}
    </span>
  );
}

function BatchToolbar({
  selectedCount,
  onDelete,
  onCancel,
}: {
  selectedCount: number;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      variants={toolbarMotion}
      initial="initial"
      animate="animate"
      exit="exit"
      className="bg-surface-container-high border border-outline-variant/20 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg"
    >
      <span className="text-sm text-on-surface font-medium">已选 {selectedCount} 个</span>
      <div className="flex-1" />
      <button
        onClick={onDelete}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error bg-error/10 rounded-sm border border-error/20 hover:bg-error/20 transition-colors"
      >
        <Icon name="delete" size={14} />
        删除分享
      </button>
      <button
        onClick={onCancel}
        className="flex items-center justify-center w-7 h-7 text-on-surface-variant hover:text-on-surface rounded-sm hover:bg-surface-container-high transition-colors"
      >
        <Icon name="close" size={16} />
      </button>
    </motion.div>
  );
}

function ShareRow({
  item,
  deleting,
  selectMode,
  selected,
  onToggleSelect,
  onCopy,
  onDeleteStart,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  item: ShareLink;
  deleting: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onCopy: (item: ShareLink) => void;
  onDeleteStart: (id: string) => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: (id: string) => void;
}) {
  const expired = isExpired(item.expiresAt);
  const title = item.modelName || item.modelId || '未命名分享';

  return (
    <div
      className={`group flex min-w-0 items-start gap-2 rounded-lg border bg-surface-container-low px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.025)] transition-[background-color,border-color,box-shadow] duration-150 md:items-center md:px-4 md:py-3 ${
        selected
          ? 'border-primary/35 bg-primary-container/8 ring-1 ring-primary/20'
          : 'border-outline-variant/16 hover:border-primary/22 hover:bg-surface-container hover:shadow-[0_8px_22px_rgba(15,23,42,0.04)]'
      }`}
    >
      {selectMode ? (
        <button
          type="button"
          onClick={() => onToggleSelect(item.id)}
          className={`shrink-0 w-5 h-5 rounded-sm border-2 flex items-center justify-center transition-[background-color,border-color,opacity] duration-150 ease-out ${
            selected ? 'bg-primary border-primary' : 'bg-surface/80 border-outline-variant/40 hover:border-primary'
          }`}
          aria-label={selected ? '取消选择' : '选择分享'}
        >
          {selected && <Icon name="check" size={14} className="text-on-primary" />}
        </button>
      ) : null}
      <Link
        to={getSharePath(item)}
        className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary-container/45 md:-mx-2 md:px-2 md:py-1"
      >
        <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
          <ShareTypeBadge type={item.type} />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-on-surface group-hover:text-primary-container">
            {title}
          </h3>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-x-2 overflow-hidden text-[11px] text-on-surface-variant md:flex-wrap md:gap-x-3 md:gap-y-1 md:overflow-visible">
          <span className="inline-flex shrink-0 items-center gap-1">
            <Icon name="visibility" size={12} />
            {item.viewCount}
          </span>
          {item.type !== 'selection' ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              <Icon name="download" size={12} />
              {item.downloadCount}
              {item.downloadLimit > 0 ? `/${item.downloadLimit}` : ''}
            </span>
          ) : null}
          {item.hasPassword ? <span className="shrink-0">有密码</span> : null}
          <span className="shrink-0">{formatDate(item.createdAt)}</span>
          {expired ? (
            <span className="shrink-0 text-error">已过期</span>
          ) : item.expiresAt ? (
            <span className="hidden shrink-0 md:inline">有效至 {formatDate(item.expiresAt)}</span>
          ) : (
            <span className="hidden shrink-0 md:inline">永久有效</span>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center justify-end gap-0.5 md:gap-1.5">
        <Link
          to={getSharePath(item)}
          className="hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface md:inline-flex"
        >
          <Icon name="open_in_new" size={15} />
          打开
        </Link>
        <button
          type="button"
          onClick={() => onCopy(item)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-primary-container transition-colors hover:bg-primary-container/10 md:w-auto md:gap-1.5 md:px-2.5 md:text-xs md:font-medium"
          aria-label="复制链接"
          data-tooltip-ignore
        >
          <Icon name="link" size={15} />
          <span className="hidden md:inline">复制</span>
        </button>
        {selectMode ? null : deleting ? (
          <>
            <button
              type="button"
              onClick={() => onDeleteConfirm(item.id)}
              className="inline-flex h-8 items-center rounded-md bg-error px-2 text-[11px] font-medium text-on-error-container md:px-2.5 md:text-xs"
            >
              确认
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="inline-flex h-8 items-center rounded-md px-2 text-[11px] font-medium text-on-surface-variant hover:bg-surface-container-high md:px-2.5 md:text-xs"
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onDeleteStart(item.id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-error transition-colors hover:bg-error-container/10 md:w-auto md:gap-1.5 md:px-2.5 md:text-xs md:font-medium"
            aria-label="删除"
            data-tooltip-ignore
          >
            <Icon name="delete" size={15} />
            <span className="hidden md:inline">删除</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function MySharesPage() {
  useDocumentTitle('我的分享');
  const { toast } = useToast();
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<ShareLink[]>('/shares/mine', listShares);
  const shares = useMemo(() => data || [], [data]);
  const keyword = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!keyword) return shares;
    return shares.filter((item) =>
      [item.modelName, item.modelId, item.token, item.type === 'selection' ? '选型' : '模型'].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(keyword),
      ),
    );
  }, [keyword, shares]);
  const selectedCount = selectedIds.size;

  useEffect(() => {
    const existingIds = new Set(shares.map((item) => item.id));
    setSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => existingIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shares]);

  async function handleCopy(item: ShareLink) {
    try {
      await copyText(getShareUrl(item));
      toast('链接已复制', 'success');
    } catch {
      toast('复制失败，请手动复制链接', 'error');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteShare(id);
      setDeleteId(null);
      mutate();
      toast('分享已删除', 'success');
    } catch (err: unknown) {
      const detail = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).response : undefined;
      const data = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>).data : undefined;
      const msg =
        typeof data === 'object' && data !== null
          ? ((data as Record<string, unknown>).message as string) ||
            ((data as Record<string, unknown>).detail as string) ||
            '删除失败'
          : '删除失败';
      toast(msg, 'error');
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const visibleIds = filtered.map((item) => item.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function handleBatchDelete() {
    if (!selectedIds.size) return;
    setConfirmOpen(true);
  }

  async function confirmBatchDelete() {
    setConfirmOpen(false);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => deleteShare(id)));
      setSelectedIds(new Set());
      setSelectMode(false);
      mutate();
      toast(`已删除 ${ids.length} 条分享`, 'success');
    } catch (err: unknown) {
      const detail = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).response : undefined;
      const data = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>).data : undefined;
      const msg =
        typeof data === 'object' && data !== null
          ? ((data as Record<string, unknown>).message as string) ||
            ((data as Record<string, unknown>).detail as string) ||
            '批量删除失败'
          : '批量删除失败';
      toast(msg, 'error');
    }
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const headerActions =
    shares.length > 0 ? (
      isDesktop ? (
        <>
          {selectMode && (
            <button onClick={toggleSelectAllVisible} className="text-sm text-primary hover:underline">
              {allVisibleSelected ? '取消全选' : '全选当前'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSelectMode((value) => !value);
              setDeleteId(null);
              if (selectMode) setSelectedIds(new Set());
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-sm border transition-colors ${
              selectMode
                ? 'text-primary border-primary/30 bg-primary-container/10'
                : 'text-on-surface-variant border-outline-variant/20 hover:text-on-surface hover:border-outline-variant/40'
            }`}
          >
            <Icon name={selectMode ? 'close' : 'checklist'} size={16} />
            {selectMode ? '取消选择' : '批量操作'}
          </button>
        </>
      ) : (
        <button
          onClick={() => {
            setSelectMode((value) => !value);
            setDeleteId(null);
            if (selectMode) setSelectedIds(new Set());
          }}
          className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
            selectMode ? 'text-primary border-primary/30' : 'text-on-surface-variant border-outline-variant/20'
          }`}
        >
          {selectMode ? '取消' : '批量操作'}
        </button>
      )
    ) : null;

  const toolbar = shares.length ? (
    <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
      <SearchField
        inputProps={searchInputProps}
        value={searchInputValue}
        onClear={() => setSearch('')}
        placeholder="搜索名称、链接或类型"
        className="flex-1 md:max-w-sm"
      />
    </div>
  ) : null;

  if (isLoading) {
    return (
      <AdminPageShell>
        <AdminManagementPage title="我的分享" description="管理自己创建的模型分享和选型分享链接">
          <AdminLoadingState variant="list" label="分享记录加载中" />
        </AdminManagementPage>
      </AdminPageShell>
    );
  }

  if (error) {
    return (
      <AdminPageShell>
        <AdminManagementPage title="我的分享" description="管理自己创建的模型分享和选型分享链接">
          <AdminErrorState
            title="分享记录加载失败"
            description="请稍后重试，或检查当前登录状态。"
            onRetry={() => mutate()}
          />
        </AdminManagementPage>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell>
      <AdminManagementPage
        title="我的分享"
        meta={`${shares.length} 条记录`}
        description="管理自己创建的模型分享和选型分享链接"
        actions={headerActions}
        toolbar={toolbar}
      >
        {/* Batch toolbar */}
        <AnimatePresence>
          {isDesktop && selectMode && selectedCount > 0 && (
            <div className="mb-4">
              <BatchToolbar
                selectedCount={selectedCount}
                onDelete={handleBatchDelete}
                onCancel={() => {
                  setSelectMode(false);
                  setSelectedIds(new Set());
                }}
              />
            </div>
          )}
          {!isDesktop && selectMode && (
            <motion.div
              variants={toolbarMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              className="mb-3 flex items-center gap-2 bg-surface-container-high rounded-lg px-3 py-2.5 border border-outline-variant/10"
            >
              <button onClick={toggleSelectAllVisible} className="text-xs text-primary">
                {allVisibleSelected ? '取消全选' : '全选'}
              </button>
              <div className="flex-1" />
              <span className="text-xs text-on-surface-variant">{selectedCount} 已选</span>
              <button onClick={handleBatchDelete} className="text-xs text-error px-2 py-1">
                删除分享
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {shares.length === 0 ? (
          <AdminEmptyState
            icon="share"
            title="暂无分享记录"
            description="模型详情页和选型结果页创建的分享链接会显示在这里。"
            action={
              <Link
                to="/"
                className="rounded-md bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
              >
                浏览模型库
              </Link>
            }
          />
        ) : filtered.length === 0 ? (
          <AdminEmptyState
            icon="search_off"
            title="没有匹配的分享"
            description="换个关键词试试。"
            className="min-h-[300px]"
          />
        ) : (
          <section className="min-h-0">
            <div className="flex max-h-full flex-col gap-2.5 overflow-y-auto">
              {filtered.map((item) => (
                <ShareRow
                  key={item.id}
                  item={item}
                  deleting={deleteId === item.id}
                  selectMode={selectMode}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                  onCopy={handleCopy}
                  onDeleteStart={setDeleteId}
                  onDeleteCancel={() => setDeleteId(null)}
                  onDeleteConfirm={handleDelete}
                />
              ))}
            </div>
          </section>
        )}
      </AdminManagementPage>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmBatchDelete}
        title="确认删除分享"
        description={`确定要删除选中的 ${selectedIds.size} 条分享链接吗？`}
        confirmLabel="删除分享"
      />
    </AdminPageShell>
  );
}
