import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { deleteShare, listShares, type ShareLink } from '../api/shares';
import { AdminEmptyState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import { SkeletonList } from '../components/shared/Skeleton';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { copyText } from '../lib/clipboard';

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
      className={`group flex min-w-0 items-start gap-2 border-b border-outline-variant/10 px-3 py-2.5 transition-colors last:border-b-0 md:items-center md:px-4 md:py-3 ${selected ? 'bg-primary-container/5' : ''}`}
    >
      {selectMode ? (
        <button
          type="button"
          onClick={() => onToggleSelect(item.id)}
          className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors md:mt-0 md:self-center ${
            selected
              ? 'border-primary-container bg-primary-container text-on-primary'
              : 'border-outline-variant/35 text-transparent hover:border-primary-container/60'
          }`}
          aria-label={selected ? '取消选择' : '选择分享'}
        >
          <Icon name="check" size={15} />
        </button>
      ) : null}
      <Link
        to={getSharePath(item)}
        className="min-w-0 flex-1 rounded-md outline-none transition-colors hover:bg-surface-container/45 focus-visible:ring-2 focus-visible:ring-primary-container/45 md:-mx-2 md:px-2 md:py-1"
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
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
    } catch (err: any) {
      toast(err.response?.data?.message || err.response?.data?.detail || '删除失败', 'error');
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

  async function handleBatchDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 条分享链接吗？`)) return;
    try {
      await Promise.all(ids.map((id) => deleteShare(id)));
      setSelectedIds(new Set());
      setSelectMode(false);
      mutate();
      toast(`已删除 ${ids.length} 条分享`, 'success');
    } catch (err: any) {
      toast(err.response?.data?.message || err.response?.data?.detail || '批量删除失败', 'error');
    }
  }

  const toolbar = shares.length ? (
    <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
      <div className="relative min-w-0 flex-1 md:max-w-sm">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60"
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索名称、链接或类型"
          className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container px-9 text-sm text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary-container/50"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
            aria-label="清空搜索"
          >
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {selectMode ? (
          <>
            <button
              type="button"
              onClick={toggleSelectAllVisible}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-outline-variant/20 px-3 text-xs font-medium text-on-surface-variant hover:border-primary-container/35 hover:text-on-surface"
            >
              <Icon name="done_all" size={15} />
              {filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id)) ? '取消全选' : '全选当前'}
            </button>
            <button
              type="button"
              onClick={handleBatchDelete}
              disabled={selectedCount === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-error px-3 text-xs font-medium text-on-error-container disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Icon name="delete" size={15} />
              删除{selectedCount ? ` ${selectedCount}` : ''}
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setSelectMode((value) => !value);
            setDeleteId(null);
            if (selectMode) setSelectedIds(new Set());
          }}
          className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
            selectMode
              ? 'bg-surface-container-high text-on-surface'
              : 'border border-outline-variant/20 text-on-surface-variant hover:border-primary-container/35 hover:text-on-surface'
          }`}
        >
          <Icon name={selectMode ? 'close' : 'checklist'} size={15} />
          {selectMode ? '完成' : '批量管理'}
        </button>
      </div>
    </div>
  ) : null;

  if (isLoading) {
    return (
      <AdminPageShell>
        <SkeletonList rows={6} />
      </AdminPageShell>
    );
  }

  if (error) {
    return (
      <AdminPageShell>
        <AdminEmptyState icon="error" title="分享记录加载失败" description="请稍后重试，或检查当前登录状态。" />
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell>
      <AdminManagementPage
        title="我的分享"
        meta={`${shares.length} 条`}
        description="管理自己创建的模型分享和选型分享链接"
        toolbar={toolbar}
      >
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
          <section className="min-h-0 overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low">
            <div className="max-h-full overflow-y-auto">
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
    </AdminPageShell>
  );
}
